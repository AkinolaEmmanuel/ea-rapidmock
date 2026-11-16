export interface MailboxInfo { id: string; identityId: string; address: string; expiresAt: string }
export const DEFAULT_MAIL_SERVICE = 'https://mail-api.polowo.store';
export interface MailMessage { id: string; from: string; subject: string; receivedAt: string; preview?: string; text?: string }
export type MailCommand =
  | { action: 'status' }
  | { action: 'connect'; baseUrl: string; enrollmentCode: string }
  | { action: 'disconnect' }
  | { action: 'create'; identityId: string }
  | { action: 'messages'; mailboxId: string }
  | { action: 'message'; mailboxId: string; messageId: string }
  | { action: 'clear'; mailboxId: string }
  | { action: 'deleteMessage'; mailboxId: string; messageId: string }
  | { action: 'delete'; mailboxId: string };
export class MailApiError extends Error { constructor(message: string, public status = 0) { super(message); } }
export function serviceUrl(value: string) {
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Use the service origin only, such as https://mail.example.com.');
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw new Error('Use HTTPS for the mailbox service, or HTTP on localhost for development.');
  return url.origin;
}
export async function handleMailCommand(command: MailCommand): Promise<unknown> {
  const saved = await chrome.storage.local.get('mailService');
  const session = saved.mailService as { baseUrl: string; token: string; domain: string } | undefined;
  async function api(path: string, method = 'GET', body?: unknown, connection = session) {
    if (!connection) throw new MailApiError('Connect your mailbox service first.');
    const response = await fetch(`${serviceUrl(connection.baseUrl)}${path}`, { method, headers: { 'Content-Type': 'application/json', ...(connection.token ? { Authorization: `Bearer ${connection.token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), credentials: 'omit', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(10000) });
    const data = await response.json();
    if (!response.ok) throw new MailApiError(typeof data.error === 'string' ? data.error : 'Mailbox service request failed.', response.status);
    return data;
  }
  switch (command.action) {
    case 'status': return { connected: !!session, baseUrl: session?.baseUrl || '', domain: session?.domain || '' };
    case 'connect': {
      const baseUrl = serviceUrl(command.baseUrl);
      const data = await api('/v1/installations', 'POST', { enrollmentCode: command.enrollmentCode }, { baseUrl, token: '', domain: '' });
      if (typeof data.token !== 'string' || !/^[a-f0-9]{64}$/.test(data.token) || typeof data.domain !== 'string') throw new Error('Invalid response from the mailbox service.');
      await chrome.storage.local.set({ mailService: { baseUrl, token: data.token, domain: data.domain } });
      return { connected: true, baseUrl, domain: data.domain };
    }
    case 'disconnect': await chrome.storage.local.remove('mailService'); return { connected: false };
    case 'create': return api('/v1/mailboxes', 'POST', { identityId: command.identityId });
    case 'messages': return api(`/v1/mailboxes/${encodeURIComponent(command.mailboxId)}/messages`);
    case 'message': return api(`/v1/mailboxes/${encodeURIComponent(command.mailboxId)}/messages/${encodeURIComponent(command.messageId)}`);
    case 'clear': return api(`/v1/mailboxes/${encodeURIComponent(command.mailboxId)}/messages`, 'DELETE');
    case 'deleteMessage': return api(`/v1/mailboxes/${encodeURIComponent(command.mailboxId)}/messages/${encodeURIComponent(command.messageId)}`, 'DELETE');
    case 'delete': return api(`/v1/mailboxes/${encodeURIComponent(command.mailboxId)}`, 'DELETE');
    default: throw new Error('Unknown mailbox operation.');
  }
}
export async function mailboxCommand<T>(command: MailCommand): Promise<T> {
  if (!globalThis.chrome?.runtime?.id) throw new Error('Install the extension in Chrome to connect a mailbox service.');
  // The panel is a trusted extension context with host access and local storage.
  // Polling is panel-scoped, so a service-worker messaging round trip is unnecessary.
  try { return await handleMailCommand(command) as T; }
  catch (error) {
    if (error instanceof Error && /Extension context invalidated|receiving end does not exist/i.test(error.message)) throw new MailApiError('Reload EA RapidMock in chrome://extensions, then close and reopen its side panel.');
    throw error;
  }
}
export function verificationCodes(text: string): string[] {
  const contextual = [...text.matchAll(/(?:code|otp|verification)[^\d]{0,40}(\d{4,8})\b/gi)].map(m => m[1]);
  return [...new Set(contextual.length ? contextual : [...text.matchAll(/\b\d{6}\b/g)].map(m => m[0]))].slice(0, 5);
}
