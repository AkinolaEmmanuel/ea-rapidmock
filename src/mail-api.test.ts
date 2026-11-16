import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleMailCommand, mailboxCommand, serviceUrl, verificationCodes } from './mail-api';
afterEach(() => vi.unstubAllGlobals());
describe('mailbox extension client', () => {
  it('works from the panel even when no background receiver is running', async () => {
    const sendMessage = vi.fn().mockRejectedValue(new Error('Could not establish connection. Receiving end does not exist.'));
    vi.stubGlobal('chrome', { runtime: { id: 'test-extension', sendMessage }, storage: { local: { get: vi.fn(async () => ({})) } } });
    expect(await mailboxCommand({ action: 'status' })).toEqual({ connected: false, baseUrl: '', domain: '' });
    expect(sendMessage).not.toHaveBeenCalled();
  });
  it('gives an actionable message for an invalidated extension panel', async () => {
    vi.stubGlobal('chrome', { runtime: { id: 'test-extension' }, storage: { local: { get: vi.fn().mockRejectedValue(new Error('Extension context invalidated.')) } } });
    await expect(mailboxCommand({ action: 'status' })).rejects.toThrow('close and reopen');
  });
  it('requires HTTPS except for loopback development services', () => {
    expect(serviceUrl('https://mail.example.com')).toBe('https://mail.example.com');
    expect(serviceUrl('http://localhost:8787')).toBe('http://localhost:8787');
    expect(() => serviceUrl('http://mail.example.com')).toThrow('HTTPS');
    expect(() => serviceUrl('https://user:secret@mail.example.com')).toThrow('origin only');
  });
  it('extracts contextual codes without executing email HTML', () => {
    expect(verificationCodes('Your verification code is 123456.')).toEqual(['123456']);
    expect(verificationCodes('<script>alert(1)</script> OTP: 9876')).toEqual(['9876']);
  });
  it('keeps the invitation out of stored credentials and does not expose the token in status', async () => {
    const storage: Record<string, unknown> = {};
    vi.stubGlobal('chrome', { storage: { local: { get: vi.fn(async () => storage), set: vi.fn(async (v: object) => Object.assign(storage, v)) } } });
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ token: 'a'.repeat(64), domain: 'inbox.example.com' })));
    await handleMailCommand({ action: 'connect', baseUrl: 'https://mail.example.com', enrollmentCode: 'private-invitation' });
    expect(JSON.stringify(storage)).not.toContain('private-invitation');
    expect(await handleMailCommand({ action: 'status' })).toEqual({ connected: true, baseUrl: 'https://mail.example.com', domain: 'inbox.example.com' });
  });
});
