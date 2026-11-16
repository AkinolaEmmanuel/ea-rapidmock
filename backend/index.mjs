import { createServer } from 'node:http';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createMailboxService } from './service.mjs';

const database = resolve(process.env.DATABASE_PATH || './data/mailboxes.sqlite');
mkdirSync(dirname(database), { recursive: true });
const service = createMailboxService({ database, domain: process.env.MAIL_DOMAIN, enrollmentCode: process.env.ENROLLMENT_CODE, signingKey: process.env.MAILGUN_WEBHOOK_SIGNING_KEY, ttlMinutes: Number(process.env.MAILBOX_TTL_MINUTES || 60) });
const server = createServer(async (incoming, outgoing) => {
  try {
    let size = 0; const chunks = [];
    for await (const chunk of incoming) {
      size += chunk.length;
      if (size > 1024 * 1024) { outgoing.writeHead(413, { Connection: 'close' }); outgoing.end('Message too large'); incoming.destroy(); return; }
      chunks.push(chunk);
    }
    const request = new Request(`http://localhost${incoming.url}`, { method: incoming.method, headers: incoming.headers, ...(!['GET', 'HEAD'].includes(incoming.method) ? { body: Buffer.concat(chunks) } : {}) });
    const response = await service.handle(request, incoming.socket.remoteAddress || 'unknown');
    outgoing.writeHead(response.status, Object.fromEntries(response.headers)); outgoing.end(Buffer.from(await response.arrayBuffer()));
  } catch { outgoing.writeHead(400); outgoing.end('Invalid request'); }
});
server.requestTimeout = 15000; server.headersTimeout = 10000;
const cleanupTimer = setInterval(service.cleanup, 60000); cleanupTimer.unref();
server.listen(Number(process.env.PORT || 8787), process.env.HOST || '127.0.0.1', () => console.log(`RapidMock mailbox service listening on port ${server.address().port}`));
function shutdown() { clearInterval(cleanupTimer); server.close(() => { service.close(); process.exit(0); }); }
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
