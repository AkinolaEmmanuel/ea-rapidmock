import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { createMailboxService } from './service.mjs';
const enrollmentCode = 'a-long-private-invitation-code-for-tests';
const signingKey = 'a-long-mailgun-webhook-secret-for-tests';
let service, time;
beforeEach(() => { time = Date.parse('2026-11-16T12:00:00Z'); service = createMailboxService({ domain: 'inbox.example.com', enrollmentCode, signingKey, now: () => time }); });
afterEach(() => service.close());
async function call(path, { method = 'GET', token, body } = {}) {
  const response = await service.handle(new Request(`https://mail.example.com${path}`, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }));
  return { status: response.status, data: await response.json() };
}
async function connect() { return (await call('/v1/installations', { method: 'POST', body: { enrollmentCode } })).data.token; }
async function create(token, identityId = 'test-identity') { return (await call('/v1/mailboxes', { method: 'POST', token, body: { identityId } })).data; }
async function inbound(address, { token = 'unique-webhook-token-1234', timestamp = String(Math.floor(time / 1000)), signature, text = 'Your verification code is 123456', id = '<message-1@example.com>' } = {}) {
  const form = new FormData();
  for (const [key, value] of Object.entries({ timestamp, token, signature: signature ?? createHmac('sha256', signingKey).update(timestamp + token).digest('hex'), recipient: address, from: 'App <noreply@example.com>', subject: 'Verify your account', 'body-plain': text, 'Message-Id': id })) form.set(key, value);
  const response = await service.handle(new Request('https://mail.example.com/webhooks/mailgun', { method: 'POST', body: form }));
  return response.status;
}
describe('owned-domain mailbox service', () => {
  it('receives a signed message and returns it only to its owning installation', async () => {
    const token = await connect(), box = await create(token);
    expect(box.address).toMatch(/^rm-[a-f0-9]{32}@inbox.example.com$/);
    expect(await inbound(box.address)).toBe(200);
    const list = await call(`/v1/mailboxes/${box.id}/messages`, { token });
    expect(list.data.messages).toHaveLength(1);
    const message = await call(`/v1/mailboxes/${box.id}/messages/${list.data.messages[0].id}`, { token });
    expect(message.data.text).toContain('123456');
    const other = await connect();
    expect((await call(`/v1/mailboxes/${box.id}/messages`, { token: other })).status).toBe(404);
    expect((await call(`/v1/mailboxes/${box.id}/messages`)).status).toBe(401);
  });
  it('rejects bad invitations, signatures, and stale deliveries', async () => {
    expect((await call('/v1/installations', { method: 'POST', body: { enrollmentCode: 'wrong' } })).status).toBe(403);
    const token = await connect(), box = await create(token);
    expect(await inbound(box.address, { signature: '0'.repeat(64) })).toBe(401);
    expect(await inbound(box.address, { timestamp: String(Math.floor(time / 1000) - 301) })).toBe(401);
    expect((await call(`/v1/mailboxes/${box.id}/messages`, { token })).data.messages).toHaveLength(0);
  });
  it('is idempotent for mailbox creation and duplicate webhook deliveries', async () => {
    const token = await connect(), box = await create(token);
    expect(await create(token)).toEqual(box);
    await inbound(box.address); await inbound(box.address);
    await inbound(box.address, { token: 'another-delivery-token', text: 'Duplicate with new signature' });
    expect((await call(`/v1/mailboxes/${box.id}/messages`, { token })).data.messages).toHaveLength(1);
  });
  it('expires mailboxes and messages and allows a replacement address', async () => {
    const token = await connect(), box = await create(token); await inbound(box.address);
    time += 61 * 60000;
    expect((await call(`/v1/mailboxes/${box.id}/messages`, { token })).status).toBe(404);
    expect((await create(token)).address).not.toBe(box.address);
  });
  it('deletes a mailbox and prevents further retrieval', async () => {
    const token = await connect(), box = await create(token); await inbound(box.address);
    expect((await call(`/v1/mailboxes/${box.id}`, { method: 'DELETE', token })).status).toBe(200);
    expect((await call(`/v1/mailboxes/${box.id}/messages`, { token })).status).toBe(404);
  });
  it('limits active mailboxes per installation', async () => {
    const token = await connect(); for (let i = 0; i < 20; i++) await create(token, `identity-${i}`);
    expect((await call('/v1/mailboxes', { method: 'POST', token, body: { identityId: 'extra' } })).status).toBe(429);
  });
});
