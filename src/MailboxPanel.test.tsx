// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createIdentity, type Identity } from './engine';
import { MailboxPanel } from './MailboxPanel';

const { command } = vi.hoisted(() => ({ command: vi.fn() }));
vi.mock('./mail-api', async importOriginal => ({ ...await importOriginal<object>(), mailboxCommand: command }));
let root: Root, profile: Identity;
const update = vi.fn(async (_identity: Identity) => {}), notify = vi.fn();
const message = { id: 'message-1', subject: 'Verify your email', from: 'App <app@example.com>', receivedAt: new Date().toISOString(), preview: 'Your code is 123456', text: 'Your code is 123456' };
beforeEach(() => {
  vi.clearAllMocks(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  profile = { ...createIdentity('en_NG', 42), email: 'm+abcdefgh1234@inbox.polowo.store', mailbox: { status: 'active', id: 'mailbox-1', expiresAt: new Date(Date.now() + 3600000).toISOString() } };
  document.body.innerHTML = '<div id="root"></div>'; root = createRoot(document.getElementById('root')!);
  command.mockImplementation(async request => {
    if (request.action === 'status') return { connected: true, baseUrl: 'https://mail-api.polowo.store' };
    if (request.action === 'messages') return { messages: [message] };
    if (request.action === 'message') return message;
    if (request.action === 'create') return { id: 'mailbox-2', address: 'm+newaddress12@inbox.polowo.store', expiresAt: new Date(Date.now() + 3600000).toISOString() };
    return { deleted: true };
  });
});
afterEach(async () => { await act(async () => root.unmount()); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function render() { await act(async () => root.render(<MailboxPanel identity={profile} onChange={update} onBusy={() => {}} notify={notify}/>)); }
async function click(text: string) { const button = Array.from(document.querySelectorAll('button')).find(b => b.textContent === text); expect(button, text).toBeTruthy(); await act(async () => button!.click()); }
describe('compact inbox controls', () => {
  it('requires confirmation to clear messages and preserves the mailbox', async () => {
    await render(); expect(document.body.textContent).toContain('Copy code 123456');
    await click('Clear messages'); expect(command.mock.calls.some(([request]) => request.action === 'clear')).toBe(false);
    expect(document.body.textContent).toContain('Your current address will keep receiving');
    await click('Delete permanently');
    expect(command).toHaveBeenCalledWith({ action: 'clear', mailboxId: 'mailbox-1' });
    expect(command.mock.calls.some(([request]) => request.action === 'delete')).toBe(false);
    expect(document.body.textContent).toContain('Waiting for your first email');
    expect(update).not.toHaveBeenCalled();
  });
  it('opens a message and deletes only that message after confirmation', async () => {
    await render(); const row = document.querySelector<HTMLButtonElement>('.mail-row')!;
    await act(async () => row.click()); await click('Delete message');
    expect(command.mock.calls.some(([request]) => request.action === 'deleteMessage')).toBe(false);
    await click('Delete permanently');
    expect(command).toHaveBeenCalledWith({ action: 'deleteMessage', mailboxId: 'mailbox-1', messageId: 'message-1' });
    expect(document.body.textContent).toContain('Waiting for your first email');
  });
  it('keeps an existing address until replacement is explicitly confirmed', async () => {
    await render(); await click('New address');
    expect(command.mock.calls.some(([request]) => request.action === 'delete')).toBe(false);
    await click('Replace address');
    expect(command).toHaveBeenCalledWith({ action: 'delete', mailboxId: 'mailbox-1' });
    expect(command).toHaveBeenCalledWith({ action: 'create', identityId: profile.id });
    expect(update.mock.calls.at(-1)?.[0]).toMatchObject({ id: profile.id, email: 'm+newaddress12@inbox.polowo.store', mailbox: { id: 'mailbox-2', status: 'active' } });
  });
});
