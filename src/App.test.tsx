// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createIdentity } from './engine';
import { App } from './App';

const { command } = vi.hoisted(() => ({ command: vi.fn() }));
vi.mock('./mail-api', async importOriginal => ({ ...await importOriginal<object>(), mailboxCommand: command }));
let root: Root;
const profile = { ...createIdentity('en_NG', 42), email: 'm+testid123456@inbox.polowo.store', mailbox: { status: 'active', id: 'box-1', expiresAt: new Date(Date.now() + 3600000).toISOString() } };
beforeEach(() => {
  vi.clearAllMocks(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  localStorage.clear(); localStorage.setItem('identity', JSON.stringify(profile));
  document.body.innerHTML = '<div id="test-app"></div>'; root = createRoot(document.getElementById('test-app')!);
  command.mockImplementation(async request => request.action === 'status' ? { connected: true, baseUrl: 'https://mail-api.polowo.store' } : { messages: [] });
});
afterEach(async () => { await act(async () => root.unmount()); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function navigate(label: string) {
  const button = Array.from(document.querySelectorAll<HTMLButtonElement>('nav button')).find(b => b.textContent === label)!;
  await act(async () => button.click());
  expect(button.getAttribute('aria-current')).toBe('page');
}
describe('workspace screens', () => {
  it('separates the four screens without discarding the identity, inbox session, or blueprint', async () => {
    await act(async () => root.render(<App/>));
    expect(Array.from(document.querySelectorAll('nav button')).map(b => b.textContent)).toEqual(['Identity', 'Inbox', 'JSON', 'Settings']);
    expect(command.mock.calls.filter(([c]) => c.action === 'messages')).toHaveLength(0);
    await navigate('Inbox');
    expect(document.querySelector('.mail-id-row')!.textContent).toContain('m+testid123456');
    expect(document.querySelector('.mail-id-row')!.textContent).not.toContain('@');
    expect(command.mock.calls.filter(([c]) => c.action === 'messages')).toHaveLength(1);
    await navigate('JSON');
    const products = Array.from(document.querySelectorAll('.presets button')).find(b => b.textContent === 'Products') as HTMLButtonElement;
    await act(async () => products.click());
    const blueprint = document.querySelector<HTMLTextAreaElement>('textarea')!.value;
    await navigate('Settings'); expect(document.body.textContent).toContain('Workspace preferences');
    await navigate('JSON'); expect(document.querySelector<HTMLTextAreaElement>('textarea')!.value).toBe(blueprint);
    await navigate('Identity'); expect(JSON.parse(localStorage.getItem('identity')!).email).toBe(profile.email);
    expect(command.mock.calls.filter(([c]) => c.action === 'status')).toHaveLength(1);
  });
  it('persists preferences and copies the full address while showing only the mail ID', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined); vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    await act(async () => root.render(<App/>));
    const copy = document.querySelector<HTMLButtonElement>('button[aria-label="Copy full email address"]')!;
    await act(async () => copy.click()); expect(writeText).toHaveBeenCalledWith(profile.email);
    await navigate('Settings');
    const select = document.querySelector<HTMLSelectElement>('select[aria-label="Data locale"]')!;
    await act(async () => { select.value = 'en_US'; select.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(JSON.parse(localStorage.getItem('preferences')!).locale).toBe('en_US');
    await navigate('Identity'); expect(document.body.textContent).toContain('Create a new identity to apply the selected locale.');
  });
});
