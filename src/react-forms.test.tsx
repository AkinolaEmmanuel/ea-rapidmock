// @vitest-environment jsdom
import React, { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createPortal } from 'react-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createIdentity } from './engine';
import { pageAction, verifyPageFill } from './fill';
import { customPageAction } from './custom-fill';

const identity = createIdentity('en_NG', 42);
let root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  delete (window as unknown as Record<string, unknown>).__eaRapidMock;
  delete (window as unknown as Record<string, unknown>).__eaRapidMockCustom;
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById('root')!);
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([{ width: 100 }] as unknown as DOMRectList);
});
afterEach(async () => { await act(async () => root.unmount()); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('React-controlled forms', () => {
  it('updates component state, triggers blur validation, and restores state on undo', async () => {
    function Registration() {
      const [form, setForm] = useState({ organizationName: '', email: '', phone: '' });
      const [touched, setTouched] = useState(false);
      return <form><label>Organization Name<input name="organizationName" value={form.organizationName} onChange={e => setForm(f => ({ ...f, organizationName: e.target.value }))} onBlur={() => setTouched(true)}/></label><label>Email<input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))}/></label><label>Phone<input type="tel" autoComplete="tel-national" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value.replace(/\D/g, '') }))}/></label><output>{JSON.stringify(form)}</output><span data-touched>{String(touched)}</span></form>;
    }
    await act(async () => root.render(<Registration/>));
    const preview = pageAction('scan', identity, true);
    await act(async () => { pageAction('fill', identity, true, preview.fields.map(f => f.id)); });
    const state = JSON.parse(document.querySelector('output')!.textContent!);
    expect(state.organizationName).toBe(identity.company);
    expect(state.email).toBe(identity.email);
    expect(state.phone).toMatch(/^\d{7,15}$/);
    expect(document.querySelector('[data-touched]')!.textContent).toBe('true');
    expect((await verifyPageFill()).issues).toEqual([]);
    await act(async () => { pageAction('undo', identity, true); });
    expect(JSON.parse(document.querySelector('output')!.textContent!)).toEqual({ organizationName: '', email: '', phone: '' });
  });
  it('reports when a component normalizes a generated value instead of claiming success', async () => {
    function Normalized() {
      const [value, setValue] = useState('');
      return <label>Company name<input value={value} onChange={e => setValue(e.target.value.toUpperCase())}/></label>;
    }
    await act(async () => root.render(<Normalized/>));
    pageAction('scan', identity, true);
    await act(async () => { pageAction('fill', identity, true, [0]); });
    const result = await verifyPageFill();
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].reason).toContain('rejected');
  });
  it('opens a React dropdown in a portal and selects through its own handler', async () => {
    function Dropdown() {
      const [open, setOpen] = useState(false), [value, setValue] = useState('');
      return <><button type="button" role="combobox" aria-label="Industry" aria-controls="industry-options" onClick={() => setOpen(v => !v)}>{value || 'Select...'}</button>{open && createPortal(<div id="industry-options" role="listbox"><div role="option" onClick={() => { setValue('Manufacturing'); setOpen(false); }}>Manufacturing</div></div>, document.body)}<output>{value}</output></>;
    }
    // A real React root drives updates while the injected async code waits.
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', false);
    root.render(<Dropdown/>);
    await new Promise(resolve => setTimeout(resolve, 50));
    const preview = await customPageAction('scan', true);
    expect(preview.fields).toHaveLength(1);
    expect((await customPageAction('fill', true, [100000])).count).toBe(1);
    expect(document.querySelector('output')!.textContent).toBe('Manufacturing');
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  });
});
