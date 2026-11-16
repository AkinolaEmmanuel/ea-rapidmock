import { DatabaseSync } from 'node:sqlite';
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

const hash = value => createHash('sha256').update(value).digest('hex');
const equal = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const fail = (status, message) => { throw new HttpError(status, message); };

export function createMailboxService({ database = ':memory:', domain, enrollmentCode, signingKey, ttlMinutes = 60, now = Date.now }) {
  if (!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(domain || '')) throw new Error('Set MAIL_DOMAIN to a receiving domain.');
  if (!enrollmentCode || enrollmentCode.length < 24 || !signingKey || signingKey.length < 24 || enrollmentCode.startsWith('replace-') || signingKey.startsWith('replace-')) throw new Error('Configure real enrollment and webhook signing secrets, at least 24 characters each.');
  if (!Number.isInteger(ttlMinutes) || ttlMinutes < 15 || ttlMinutes > 1440) throw new Error('MAILBOX_TTL_MINUTES must be between 15 and 1440.');
  const db = new DatabaseSync(database);
  db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS installations (id TEXT PRIMARY KEY, token_hash TEXT UNIQUE NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS mailboxes (id TEXT PRIMARY KEY, installation_id TEXT NOT NULL REFERENCES installations(id) ON DELETE CASCADE, identity_id TEXT NOT NULL, address TEXT UNIQUE NOT NULL, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL, UNIQUE(installation_id, identity_id));
    CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, mailbox_id TEXT NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE, provider_id TEXT NOT NULL, sender TEXT NOT NULL, subject TEXT NOT NULL, body TEXT NOT NULL, received_at INTEGER NOT NULL, UNIQUE(mailbox_id,provider_id));
    CREATE TABLE IF NOT EXISTS webhook_tokens (token_hash TEXT PRIMARY KEY, received_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS mailbox_expiry ON mailboxes(expires_at);
    CREATE INDEX IF NOT EXISTS mailbox_messages ON messages(mailbox_id,received_at);`);
  const attempts = new Map();
  function rateLimit(key, limit, windowMs) {
    const time = now();
    for (const [k, v] of attempts) if (v.until <= time) attempts.delete(k);
    const value = attempts.get(key) || { count: 0, until: time + windowMs };
    if (++value.count > limit || (!attempts.has(key) && attempts.size > 10000)) fail(429, 'Too many requests. Try again later.');
    attempts.set(key, value);
  }
  function cleanup() {
    db.prepare('DELETE FROM mailboxes WHERE expires_at<=?').run(now());
    db.prepare('DELETE FROM webhook_tokens WHERE received_at<?').run(now() - 600000);
  }
  function authorize(request) {
    const token = (request.headers.get('authorization') || '').replace(/^Bearer /, '');
    if (!/^[a-f0-9]{64}$/.test(token)) fail(401, 'Connect this extension to the mailbox service.');
    const installation = db.prepare('SELECT id FROM installations WHERE token_hash=?').get(hash(token));
    if (!installation) fail(401, 'Mailbox service credentials are invalid. Reconnect the service.');
    rateLimit(`read:${installation.id}`, 120, 60000);
    return installation.id;
  }
  function mailbox(id, owner) {
    const row = db.prepare('SELECT * FROM mailboxes WHERE id=? AND installation_id=?').get(id, owner);
    if (!row) fail(404, 'This mailbox is missing or has expired.');
    return row;
  }
  const publicMailbox = row => ({ id: row.id, identityId: row.identity_id, address: row.address, expiresAt: new Date(row.expires_at).toISOString() });
  const json = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
  async function handle(request, remoteAddress = 'local') {
    try {
      cleanup();
      const { pathname } = new URL(request.url);
      if (pathname === '/health' && request.method === 'GET') return json({ ok: true, version: '1', domain, ttlMinutes });
      if (pathname === '/webhooks/mailgun' && request.method === 'POST') {
        // Mailgun forward() uses form fields, not its event-webhook JSON format.
        const type = request.headers.get('content-type') || '';
        if (!/^(multipart\/form-data|application\/x-www-form-urlencoded)/i.test(type)) fail(415, 'Use Mailgun forward() form delivery.');
        const form = await request.formData();
        const get = name => typeof form.get(name) === 'string' ? form.get(name) : '';
        const timestamp = get('timestamp'), token = get('token'), signature = get('signature');
        if (!/^\d{10,}$/.test(timestamp) || token.length < 10 || token.length > 200 || !/^[a-f0-9]{64}$/i.test(signature) || Math.abs(now() - Number(timestamp) * 1000) > 300000) fail(401, 'Invalid or stale webhook signature.');
        const expected = createHmac('sha256', signingKey).update(timestamp + token).digest('hex');
        if (!equal(expected, signature.toLowerCase())) fail(401, 'Invalid webhook signature.');
        // Duplicate signed deliveries are acknowledged without writing again.
        if (db.prepare('SELECT token_hash FROM webhook_tokens WHERE token_hash=?').get(hash(token))) return json({ accepted: true });
        const recipient = get('recipient').trim().toLowerCase();
        const box = db.prepare('SELECT * FROM mailboxes WHERE address=? AND expires_at>?').get(recipient, now());
        if (!box) { db.prepare('INSERT OR IGNORE INTO webhook_tokens VALUES (?,?)').run(hash(token), now()); return json({ accepted: true }); }
        const providerId = get('Message-Id') || get('message-id') || hash(`${get('sender')}\n${get('subject')}\n${get('body-plain')}`);
        db.exec('BEGIN IMMEDIATE');
        try {
          db.prepare('INSERT OR IGNORE INTO webhook_tokens VALUES (?,?)').run(hash(token), now());
          db.prepare('INSERT OR IGNORE INTO messages VALUES (?,?,?,?,?,?,?)').run(randomUUID(), box.id, providerId.slice(0, 1000), (get('from') || get('sender')).slice(0, 500), get('subject').slice(0, 500), (get('stripped-text') || get('body-plain')).slice(0, 100000), now());
          db.prepare('DELETE FROM messages WHERE mailbox_id=? AND id NOT IN (SELECT id FROM messages WHERE mailbox_id=? ORDER BY received_at DESC,rowid DESC LIMIT 50)').run(box.id, box.id);
          db.exec('COMMIT');
        } catch (error) { db.exec('ROLLBACK'); throw error; }
        return json({ accepted: true });
      }
      if (pathname === '/v1/installations' && request.method === 'POST') {
        rateLimit(`enroll:${remoteAddress}`, 10, 3600000);
        const data = await request.json();
        if (!equal(hash(String(data.enrollmentCode || '')), hash(enrollmentCode))) fail(403, 'Invitation code is incorrect.');
        const id = randomUUID(), token = randomBytes(32).toString('hex');
        db.prepare('INSERT INTO installations VALUES (?,?,?)').run(id, hash(token), now());
        return json({ id, token, domain, ttlMinutes }, 201);
      }
      const owner = authorize(request);
      if (pathname === '/v1/mailboxes' && request.method === 'POST') {
        const data = await request.json();
        if (typeof data.identityId !== 'string' || !/^[a-z0-9-]{1,100}$/i.test(data.identityId)) fail(400, 'A valid identity ID is required.');
        const existing = db.prepare('SELECT * FROM mailboxes WHERE installation_id=? AND identity_id=?').get(owner, data.identityId);
        if (existing) return json(publicMailbox(existing));
        rateLimit(`create:${owner}`, 20, 3600000);
        if (db.prepare('SELECT COUNT(*) AS count FROM mailboxes WHERE installation_id=?').get(owner).count >= 20) fail(429, 'Maximum 20 active mailboxes per installation.');
        const id = randomUUID(), address = `rm-${randomBytes(16).toString('hex')}@${domain.toLowerCase()}`;
        db.prepare('INSERT INTO mailboxes VALUES (?,?,?,?,?,?)').run(id, owner, data.identityId, address, now() + ttlMinutes * 60000, now());
        return json(publicMailbox(mailbox(id, owner)), 201);
      }
      if (pathname === '/v1/mailboxes' && request.method === 'GET') return json({ mailboxes: db.prepare('SELECT * FROM mailboxes WHERE installation_id=? ORDER BY created_at DESC').all(owner).map(publicMailbox) });
      const match = /^\/v1\/mailboxes\/([a-f0-9-]+)(?:\/messages(?:\/([a-f0-9-]+))?)?$/.exec(pathname);
      if (!match) fail(404, 'Endpoint not found.');
      const box = mailbox(match[1], owner);
      if (pathname.endsWith('/messages') && request.method === 'DELETE') { db.prepare('DELETE FROM messages WHERE mailbox_id=?').run(box.id); return json({ deleted: true }); }
      if (match[2] && request.method === 'DELETE') {
        const deleted = db.prepare('DELETE FROM messages WHERE id=? AND mailbox_id=?').run(match[2], box.id);
        if (!deleted.changes) fail(404, 'Message not found.');
        return json({ deleted: true });
      }
      if (pathname.endsWith(box.id) && request.method === 'DELETE') { db.prepare('DELETE FROM mailboxes WHERE id=?').run(box.id); return json({ deleted: true }); }
      if (pathname.endsWith('/messages') && request.method === 'GET') {
        const rows = db.prepare('SELECT id,sender,subject,received_at,substr(body,1,180) AS preview FROM messages WHERE mailbox_id=? ORDER BY received_at DESC,rowid DESC').all(box.id);
        return json({ mailbox: publicMailbox(box), messages: rows.map(r => ({ id: r.id, from: r.sender, subject: r.subject, receivedAt: new Date(r.received_at).toISOString(), preview: r.preview })) });
      }
      if (match[2] && request.method === 'GET') {
        const row = db.prepare('SELECT * FROM messages WHERE id=? AND mailbox_id=?').get(match[2], box.id);
        if (!row) fail(404, 'Message not found.');
        return json({ id: row.id, from: row.sender, subject: row.subject, text: row.body, receivedAt: new Date(row.received_at).toISOString() });
      }
      fail(405, 'Method not allowed.');
    } catch (error) {
      if (error instanceof HttpError) return json({ error: error.message }, error.status);
      if (error instanceof SyntaxError || error instanceof TypeError) return json({ error: 'Invalid request body.' }, 400);
      return json({ error: 'Mailbox service error.' }, 500);
    }
  }
  return { handle, cleanup, close: () => db.close() };
}
