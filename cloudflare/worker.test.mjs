import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { cleanup, emailHandler, fetchHandler } from './worker.mjs';

let sql, env;
const invitation = 'cloudflare-invitation-code-for-tests-only';
function statement(query, args = []) {
  return {
    bind: (...values) => statement(query, values),
    first: async () => sql.prepare(query).get(...args) || null,
    all: async () => ({ results: sql.prepare(query).all(...args) }),
    run: async () => ({ meta: sql.prepare(query).run(...args) }),
    execute: () => sql.prepare(query).run(...args),
  };
}
beforeEach(() => {
  sql = new DatabaseSync(':memory:'); sql.exec('PRAGMA foreign_keys=ON');
  sql.exec(readFileSync(new URL('./migrations/0001_initial.sql', import.meta.url), 'utf8'));
  env = { MAIL_DOMAIN: 'inbox.polowo.store', MAILBOX_TTL_MINUTES: '60', ENROLLMENT_CODE: invitation, DB: { prepare: query => statement(query), batch: async statements => { sql.exec('BEGIN'); try { const results = statements.map(s => s.execute()); sql.exec('COMMIT'); return results; } catch (error) { sql.exec('ROLLBACK'); throw error; } } } };
});
afterEach(() => { sql.close(); vi.restoreAllMocks(); });
async function call(path, { method = 'GET', token, body } = {}) {
  const response = await fetchHandler(new Request(`https://rapidmock.example${path}`, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), env);
  return { status: response.status, data: await response.json() };
}
async function connect() { return (await call('/v1/installations', { method: 'POST', body: { enrollmentCode: invitation } })).data.token; }
async function create(token, identityId = 'identity-1') { return (await call('/v1/mailboxes', { method: 'POST', token, body: { identityId } })).data; }
function email(address, extra = {}) {
  const mime = `From: Test App <app@example.com>\r\nTo: ${address}\r\nSubject: Verify account\r\nMessage-ID: <cloudflare-test@example.com>\r\nMIME-Version: 1.0\r\nContent-Type: multipart/alternative; boundary="boundary"\r\n\r\n--boundary\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\nVmVyaWZpY2F0aW9uIGNvZGU6IDEyMzQ1Ng==\r\n--boundary\r\nContent-Type: text/html\r\n\r\n<b>Verification code: 123456</b>\r\n--boundary--\r\n`;
  return { from: 'app@example.com', to: address, headers: new Headers({ 'message-id': '<cloudflare-test@example.com>' }), raw: new Response(mime).body, rawSize: new TextEncoder().encode(mime).length, setReject: vi.fn(), ...extra };
}
describe('Cloudflare Worker mailbox API and inbound MIME processing', () => {
  it('uses the extension API contract and parses a MIME message into its owned inbox', async () => {
    const token = await connect(), box = await create(token);
    expect(box.address).toMatch(/^m\+[0123456789abcdefghjkmnpqrstvwxyz]{12}@inbox.polowo.store$/);
    expect(box.address.length).toBe(33);
    const delivered = email(box.address); await emailHandler(delivered, env);
    expect(delivered.setReject).not.toHaveBeenCalled();
    const list = await call(`/v1/mailboxes/${box.id}/messages`, { token });
    expect(list.data.messages).toHaveLength(1);
    const message = await call(`/v1/mailboxes/${box.id}/messages/${list.data.messages[0].id}`, { token });
    expect(message.data.text).toContain('123456');
    expect((await create(token)).id).toBe(box.id);
  });
  it('isolates installations and never exposes another inbox', async () => {
    const owner = await connect(), other = await connect(), box = await create(owner);
    expect((await call(`/v1/mailboxes/${box.id}/messages`, { token: other })).status).toBe(404);
    expect((await call(`/v1/mailboxes/${box.id}/messages`)).status).toBe(401);
    expect((await call('/v1/installations', { method: 'POST', body: { enrollmentCode: 'wrong' } })).status).toBe(403);
  });
  it('clears messages without disabling the address, and prevents cross-owner deletion', async () => {
    const token = await connect(), other = await connect(), box = await create(token);
    await emailHandler(email(box.address), env);
    const list = (await call(`/v1/mailboxes/${box.id}/messages`, { token })).data.messages;
    expect((await call(`/v1/mailboxes/${box.id}/messages/${list[0].id}`, { method: 'DELETE', token: other })).status).toBe(404);
    expect((await call(`/v1/mailboxes/${box.id}/messages/${list[0].id}`, { method: 'DELETE', token })).status).toBe(200);
    await emailHandler(email(box.address), env);
    expect((await call(`/v1/mailboxes/${box.id}/messages`, { method: 'DELETE', token: other })).status).toBe(404);
    expect((await call(`/v1/mailboxes/${box.id}/messages`, { method: 'DELETE', token })).status).toBe(200);
    expect((await call(`/v1/mailboxes/${box.id}/messages`, { token })).data.messages).toEqual([]);
    expect((await create(token)).address).toBe(box.address);
    await emailHandler(email(box.address), env);
    expect((await call(`/v1/mailboxes/${box.id}/messages`, { token })).data.messages).toHaveLength(1);
  });
  it('retries a short-address collision instead of sharing or failing an inbox', async () => {
    const token = await connect();
    const rng = vi.spyOn(crypto, 'getRandomValues');
    rng.mockImplementationOnce(array => { array.fill(0); return array; });
    const first = await create(token, 'original');
    rng.mockImplementationOnce(array => { array.fill(0); return array; }).mockImplementationOnce(array => { array.fill(1); return array; });
    const second = await create(token, 'replacement');
    expect(first.address).toBe('m+000000000000@inbox.polowo.store');
    expect(second.address).toBe('m+111111111111@inbox.polowo.store');
    expect(second.id).not.toBe(first.id);
  });
  it('deduplicates delivery, rejects unallocated addresses and oversized messages', async () => {
    const token = await connect(), box = await create(token);
    await emailHandler(email(box.address), env); await emailHandler(email(box.address), env);
    expect((await call(`/v1/mailboxes/${box.id}/messages`, { token })).data.messages).toHaveLength(1);
    for (const candidate of [email('unknown@inbox.polowo.store'), email('unknown@other.example'), email(box.address, { rawSize: 600000 })]) { await emailHandler(candidate, env); expect(candidate.setReject).toHaveBeenCalledOnce(); }
  });
  it('hides expired mail immediately and removes it on cleanup', async () => {
    const token = await connect(), box = await create(token); await emailHandler(email(box.address), env);
    const future = Date.now() + 61 * 60000; vi.spyOn(Date, 'now').mockReturnValue(future);
    expect((await call(`/v1/mailboxes/${box.id}/messages`, { token })).status).toBe(404);
    await cleanup(env);
    expect(sql.prepare('SELECT COUNT(*) AS count FROM messages').get().count).toBe(0);
    expect((await create(token)).id).not.toBe(box.id);
  });
  it('deletes messages with a mailbox and limits concurrent allocations', async () => {
    const token = await connect(), box = await create(token); await emailHandler(email(box.address), env);
    expect((await call(`/v1/mailboxes/${box.id}`, { token, method: 'DELETE' })).status).toBe(200);
    expect(sql.prepare('SELECT COUNT(*) AS count FROM messages').get().count).toBe(0);
    const other = await connect();
    const results = await Promise.all(Array.from({ length: 21 }, (_, i) => call('/v1/mailboxes', { method: 'POST', token: other, body: { identityId: `concurrent-${i}` } })));
    expect(results.filter(r => r.status === 201)).toHaveLength(20);
    expect(results.filter(r => r.status === 429)).toHaveLength(1);
  });
});
