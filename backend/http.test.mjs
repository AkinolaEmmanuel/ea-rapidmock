import { it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import { createHmac, randomUUID } from 'node:crypto';
import { unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

it('receives signed mail through the actual HTTP server', async () => {
  const database = join(tmpdir(), `rapidmock-${randomUUID()}.sqlite`);
  const secret = 'test-webhook-key-not-a-real-provider-secret';
  const invitation = 'test-invitation-for-http-integration-only';
  const child = spawn(process.execPath, [fileURLToPath(new URL('./index.mjs', import.meta.url))], { env: { ...process.env, HOST: '127.0.0.1', PORT: '0', DATABASE_PATH: database, MAIL_DOMAIN: 'inbox.example.com', MAILGUN_WEBHOOK_SIGNING_KEY: secret, ENROLLMENT_CODE: invitation }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  try {
    const port = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('HTTP server startup timed out.')), 8000);
      child.once('error', e => { clearTimeout(timeout); reject(e); });
      child.once('exit', code => { clearTimeout(timeout); reject(new Error(`HTTP server exited during startup: ${code}`)); });
      child.stdout.on('data', data => { const match = /listening on port (\d+)/.exec(String(data)); if (match) { clearTimeout(timeout); resolve(match[1]); } });
    });
    const base = `http://127.0.0.1:${port}`;
    const health = await fetch(`${base}/health`); expect((await health.json()).ok).toBe(true);
    const enrolled = await fetch(`${base}/v1/installations`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enrollmentCode: invitation }) });
    const { token } = await enrolled.json(); expect(enrolled.status).toBe(201);
    const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
    const created = await fetch(`${base}/v1/mailboxes`, { method: 'POST', headers, body: JSON.stringify({ identityId: 'http-test' }) });
    const box = await created.json(); expect(created.status).toBe(201);
    const timestamp = String(Math.floor(Date.now() / 1000)), webhookToken = randomUUID();
    const form = new URLSearchParams({ timestamp, token: webhookToken, signature: createHmac('sha256', secret).update(timestamp + webhookToken).digest('hex'), recipient: box.address, from: 'test@example.com', subject: 'HTTP verification', 'body-plain': 'Verification code: 654321' });
    const delivered = await fetch(`${base}/webhooks/mailgun`, { method: 'POST', body: form }); expect(delivered.status).toBe(200);
    const inbox = await fetch(`${base}/v1/mailboxes/${box.id}/messages`, { headers });
    expect((await inbox.json()).messages[0].preview).toContain('654321');
  } finally {
    if (child.exitCode === null) { const exited = new Promise(resolve => child.once('exit', resolve)); child.kill(); await exited; }
    for (const path of [database, `${database}-wal`, `${database}-shm`]) { try { unlinkSync(path); } catch { /* SQLite can remove journal files on clean shutdown. */ } }
  }
}, 15000);
