import PostalMime from 'postal-mime';

const hex = bytes => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
const random = () => hex(crypto.getRandomValues(new Uint8Array(32)));
export const shortAlias = () => Array.from(crypto.getRandomValues(new Uint8Array(12)), byte => '0123456789abcdefghjkmnpqrstvwxyz'[byte & 31]).join('');
const hash = async value => hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))));
const json = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
class ApiError extends Error { constructor(status, message) { super(message); this.status = status; } }
const fail = (status, message) => { throw new ApiError(status, message); };
const boxView = row => ({ id: row.id, identityId: row.identity_id, address: row.address, expiresAt: new Date(row.expires_at).toISOString() });
const messageView = row => ({ id: row.id, from: row.sender, subject: row.subject, receivedAt: new Date(row.received_at).toISOString(), ...(row.preview === undefined ? { text: row.body } : { preview: row.preview }) });
function config(env) {
  if (!env.DB || !/^(?:[a-z0-9-]+\.)+[a-z]{2,}$/i.test(env.MAIL_DOMAIN || '')) fail(503, 'Mailbox service is not configured.');
  const ttl = Number(env.MAILBOX_TTL_MINUTES || 60);
  if (!Number.isInteger(ttl) || ttl < 15 || ttl > 1440) fail(503, 'Mailbox lifetime is not configured correctly.');
  const prefix = env.MAIL_LOCAL_PREFIX || 'm';
  if (!/^[a-z][a-z0-9-]{0,20}$/.test(prefix)) fail(503, 'Receiving alias prefix is not configured correctly.');
  return { domain: env.MAIL_DOMAIN.toLowerCase(), ttl, prefix };
}
async function limit(db, key, max, duration, now) {
  const row = await db.prepare('INSERT INTO rate_limits (key,count,expires_at) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN expires_at<=? THEN 1 ELSE count+1 END, expires_at=CASE WHEN expires_at<=? THEN ? ELSE expires_at END RETURNING count').bind(key, now + duration, now, now, now + duration).first();
  if (row.count > max) fail(429, 'Too many requests. Try again later.');
}
async function body(request) {
  if (!request.headers.get('content-type')?.startsWith('application/json')) fail(415, 'Use a JSON request body.');
  if (Number(request.headers.get('content-length')) > 4096) fail(413, 'Request body is too large.');
  const reader = request.body?.getReader(); if (!reader) fail(400, 'Request body is required.');
  let total = 0, parts = [];
  try { while (true) { const { done, value } = await reader.read(); if (done) break; total += value.byteLength; if (total > 4096) { await reader.cancel(); fail(413, 'Request body is too large.'); } parts.push(value); } }
  finally { reader.releaseLock(); }
  const bytes = new Uint8Array(total); let offset = 0; for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  const parsed = JSON.parse(new TextDecoder().decode(bytes));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) fail(400, 'Use a JSON object.');
  return parsed;
}
async function owner(request, env, now) {
  const token = (request.headers.get('authorization') || '').replace(/^Bearer /, '');
  if (!/^[a-f0-9]{64}$/.test(token)) fail(401, 'Connect this extension to the mailbox service.');
  const found = await env.DB.prepare('SELECT id FROM installations WHERE token_hash=?').bind(await hash(token)).first();
  if (!found) fail(401, 'Mailbox credentials are invalid. Reconnect the service.');
  await limit(env.DB, `read:${found.id}`, 120, 60000, now);
  return found.id;
}
async function ownedBox(env, id, installationId, now) {
  const found = await env.DB.prepare('SELECT * FROM mailboxes WHERE id=? AND installation_id=? AND expires_at>?').bind(id, installationId, now).first();
  if (!found) fail(404, 'This mailbox is missing or has expired.');
  return found;
}
export async function fetchHandler(request, env) {
  try {
    const { domain, ttl, prefix } = config(env), now = Date.now();
    const { pathname } = new URL(request.url);
    if (pathname === '/health' && request.method === 'GET') return json({ ok: true, version: '1', domain, ttlMinutes: ttl });
    if (pathname === '/v1/installations' && request.method === 'POST') {
      if (!env.ENROLLMENT_CODE || env.ENROLLMENT_CODE.length < 24 || env.ENROLLMENT_CODE.startsWith('replace-')) fail(503, 'Configure the enrollment secret before connecting clients.');
      await limit(env.DB, `enroll:${await hash(request.headers.get('CF-Connecting-IP') || 'local')}`, 10, 3600000, now);
      const data = await body(request);
      // Compare fixed-length SHA-256 values without retaining the invitation.
      const expected = await hash(env.ENROLLMENT_CODE), supplied = await hash(String(data.enrollmentCode || ''));
      let difference = 0; for (let i = 0; i < expected.length; i++) difference |= expected.charCodeAt(i) ^ supplied.charCodeAt(i);
      if (difference) fail(403, 'Invitation code is incorrect.');
      const id = crypto.randomUUID(), token = random();
      await env.DB.prepare('INSERT INTO installations VALUES (?,?,?)').bind(id, await hash(token), now).run();
      return json({ id, token, domain, ttlMinutes: ttl }, 201);
    }
    const installationId = await owner(request, env, now);
    if (pathname === '/v1/mailboxes' && request.method === 'POST') {
      const data = await body(request);
      if (typeof data.identityId !== 'string' || !/^[a-z0-9-]{1,100}$/i.test(data.identityId)) fail(400, 'A valid identity ID is required.');
      const existing = await env.DB.prepare('SELECT * FROM mailboxes WHERE installation_id=? AND identity_id=? AND expires_at>?').bind(installationId, data.identityId, now).first();
      if (existing) return json(boxView(existing));
      await limit(env.DB, `create:${installationId}`, 20, 3600000, now);
      const id = crypto.randomUUID();
      // A single atomic conditional insert enforces the concurrent active quota.
      for (let attempt = 0; attempt < 5; attempt++) {
        const address = `${prefix}+${shortAlias()}@${domain}`;
        await env.DB.batch([
          env.DB.prepare('DELETE FROM mailboxes WHERE installation_id=? AND identity_id=? AND expires_at<=?').bind(installationId, data.identityId, now),
          env.DB.prepare('INSERT OR IGNORE INTO mailboxes (id,installation_id,identity_id,address,expires_at,created_at) SELECT ?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM mailboxes WHERE installation_id=? AND expires_at>?)<20').bind(id, installationId, data.identityId, address, now + ttl * 60000, now, installationId, now),
        ]);
        const created = await env.DB.prepare('SELECT * FROM mailboxes WHERE installation_id=? AND identity_id=? AND expires_at>?').bind(installationId, data.identityId, now).first();
        if (created) return json(boxView(created), created.id === id ? 201 : 200);
        const count = await env.DB.prepare('SELECT COUNT(*) AS count FROM mailboxes WHERE installation_id=? AND expires_at>?').bind(installationId, now).first();
        if (count.count >= 20) fail(429, 'Maximum 20 active mailboxes per installation.');
      }
      fail(503, 'Could not allocate a unique address. Please try again.');
    }
    if (pathname === '/v1/mailboxes' && request.method === 'GET') {
      const rows = await env.DB.prepare('SELECT * FROM mailboxes WHERE installation_id=? AND expires_at>? ORDER BY created_at DESC').bind(installationId, now).all();
      return json({ mailboxes: rows.results.map(boxView) });
    }
    const match = /^\/v1\/mailboxes\/([a-f0-9-]+)(?:\/messages(?:\/([a-f0-9-]+))?)?$/.exec(pathname);
    if (!match) fail(404, 'Endpoint not found.');
    const box = await ownedBox(env, match[1], installationId, now);
    if (pathname.endsWith('/messages') && request.method === 'DELETE') { await env.DB.prepare('DELETE FROM messages WHERE mailbox_id=?').bind(box.id).run(); return json({ deleted: true }); }
    if (match[2] && request.method === 'DELETE') {
      const found = await env.DB.prepare('SELECT id FROM messages WHERE id=? AND mailbox_id=?').bind(match[2], box.id).first();
      if (!found) fail(404, 'Message not found.');
      await env.DB.prepare('DELETE FROM messages WHERE id=? AND mailbox_id=?').bind(match[2], box.id).run(); return json({ deleted: true });
    }
    if (pathname.endsWith(box.id) && request.method === 'DELETE') { await env.DB.prepare('DELETE FROM mailboxes WHERE id=? AND installation_id=?').bind(box.id, installationId).run(); return json({ deleted: true }); }
    if (pathname.endsWith('/messages') && request.method === 'GET') {
      const rows = await env.DB.prepare('SELECT id,sender,subject,received_at,substr(body,1,180) AS preview FROM messages WHERE mailbox_id=? ORDER BY received_at DESC,rowid DESC').bind(box.id).all();
      return json({ mailbox: boxView(box), messages: rows.results.map(messageView) });
    }
    if (match[2] && request.method === 'GET') {
      const found = await env.DB.prepare('SELECT * FROM messages WHERE id=? AND mailbox_id=?').bind(match[2], box.id).first();
      if (!found) fail(404, 'Message not found.');
      return json(messageView(found));
    }
    fail(405, 'Method not allowed.');
  } catch (error) {
    if (error instanceof ApiError) return json({ error: error.message }, error.status);
    if (error instanceof SyntaxError || error instanceof TypeError) return json({ error: 'Invalid request body.' }, 400);
    return json({ error: 'Mailbox service error.' }, 500);
  }
}
function htmlText(html) {
  return html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/\s+/g, ' ').trim();
}
export async function emailHandler(message, env) {
  const { domain } = config(env), now = Date.now();
  if (!message.to.toLowerCase().endsWith(`@${domain}`)) { message.setReject('Receiving domain is not configured for this service.'); return; }
  if (message.rawSize > 512000) { message.setReject('Message exceeds the 500 KB test inbox limit.'); return; }
  const box = await env.DB.prepare('SELECT id FROM mailboxes WHERE address=? AND expires_at>?').bind(message.to.toLowerCase(), now).first();
  if (!box) { message.setReject('Mailbox does not exist or has expired.'); return; }
  const parsed = await PostalMime.parse(message.raw);
  const text = (parsed.text || htmlText(parsed.html || '')).slice(0, 100000);
  const sender = (parsed.from?.name ? `${parsed.from.name} <${parsed.from.address}>` : parsed.from?.address || message.from).slice(0, 500);
  const providerId = (message.headers.get('message-id') || await hash(`${sender}\n${parsed.subject || ''}\n${text}`)).slice(0, 1000);
  await env.DB.batch([
    env.DB.prepare('INSERT OR IGNORE INTO messages (id,mailbox_id,provider_id,sender,subject,body,received_at) SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM mailboxes WHERE id=? AND expires_at>?)').bind(crypto.randomUUID(), box.id, providerId, sender, (parsed.subject || '').slice(0, 500), text, now, box.id, now),
    env.DB.prepare('DELETE FROM messages WHERE mailbox_id=? AND id NOT IN (SELECT id FROM messages WHERE mailbox_id=? ORDER BY received_at DESC,rowid DESC LIMIT 50)').bind(box.id, box.id),
  ]);
}
export async function cleanup(env) {
  const now = Date.now();
  await env.DB.batch([env.DB.prepare('DELETE FROM mailboxes WHERE expires_at<=?').bind(now), env.DB.prepare('DELETE FROM rate_limits WHERE expires_at<=?').bind(now)]);
}
export default { fetch: fetchHandler, email: emailHandler, scheduled: (_event, env, ctx) => ctx.waitUntil(cleanup(env)) };
