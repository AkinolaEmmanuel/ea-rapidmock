// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createIdentity } from './engine';
import { hostPattern, pageAction, runOnPage } from './fill';
const identity = createIdentity('en_US', 42);
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
beforeEach(() => {
  document.body.innerHTML = '<label>First name<input name="first_name"></label><input type="email" value="keep@example.com"><input name="password"><input name="credit_card"><input name="city">';
  delete (window as unknown as Record<string, unknown>).__eaRapidMock;
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([{ width: 100 }] as unknown as DOMRectList);
});
describe('form filling', () => {
  it('skips existing and sensitive fields, dispatches events and restores values', () => {
    const plan = pageAction('scan', identity, true);
    expect(plan.fields).toHaveLength(2);
    const first = document.querySelector('input')!;
    const inputEvent = vi.fn(); first.addEventListener('input', inputEvent);
    expect(pageAction('fill', identity, true, plan.fields.map(f => f.id)).count).toBe(2);
    expect(first.value).toBe(identity.firstName);
    expect(inputEvent).toHaveBeenCalledOnce();
    expect(pageAction('undo', identity, true).count).toBe(2);
    expect(first.value).toBe('');
    expect(document.querySelector<HTMLInputElement>('input[type=email]')!.value).toBe('keep@example.com');
  });
  it('does not overwrite edits made after preview', () => {
    pageAction('scan', identity, true);
    document.querySelector('input')!.value = 'My edit';
    expect(pageAction('fill', identity, true, [0]).count).toBe(0);
  });
  it('keeps edits made after filling when undoing', () => {
    pageAction('scan', identity, true); pageAction('fill', identity, true, [0]);
    document.querySelector('input')!.value = 'Changed';
    expect(pageAction('undo', identity, true).count).toBe(0);
  });
  it('matches country options and skips protected autocomplete fields', () => {
    document.body.innerHTML = '<select autocomplete="country"><option value="">Choose</option><option value="US">United States</option></select><input name="name" autocomplete="cc-name"><fieldset disabled><input name="city"></fieldset>';
    const result = pageAction('scan', identity, true);
    expect(result.fields).toHaveLength(1);
    expect(result.fields[0].value).toBe('US');
    pageAction('fill', identity, true, [0]);
    expect(document.querySelector('select')!.value).toBe('US');
  });
  it('generates product fields from accessible labels, constrained numbers, dates, and available options', () => {
    document.body.innerHTML = '<span id="product-label">Product name</span><input aria-labelledby="product-label"><label>Product description<textarea></textarea></label><label>Quantity<input type="number" min="4" max="12" step="2"></label><label>Delivery date<input type="date" min="2030-01-01" max="2030-12-31"></label><label>Status<select><option value="">Choose...</option><option disabled value="bad">Unavailable</option><option value="draft">Draft</option></select></label>';
    const result = pageAction('scan', identity, true);
    expect(result.fields.map(f => f.kind)).toEqual(['product', 'description', 'number', 'date', 'select']);
    expect(result.fields[0].value).not.toBe(`${identity.firstName} ${identity.lastName}`);
    expect(result.fields[1].value).not.toBe(result.fields[0].value);
    expect(Number(result.fields[2].value) % 2).toBe(0);
    expect(result.fields[3].value).toBe('2030-01-01');
    expect(result.fields[4].value).toBe('draft');
    expect(result.fields.every(f => f.suggested)).toBe(true);
    expect(pageAction('fill', identity, true, result.fields.map(f => f.id)).count).toBe(5);
  });
  it('exposes uncertain fields for editing without selecting them by default', () => {
    document.body.innerHTML = '<label>Referral reference<input pattern="[A-Z]{3}" maxlength="3"></label>';
    const result = pageAction('scan', identity, true);
    expect(result.fields[0].suggested).toBe(false);
    expect(result.fields[0].warning).toBeTruthy();
    expect(pageAction('fill', identity, true, [0]).error).toContain('constraints');
    expect(pageAction('fill', identity, true, [0], { 0: 'ABC' }).count).toBe(1);
    expect(document.querySelector('input')!.value).toBe('ABC');
  });
  it('scans controls inside open shadow roots and ignores search inputs', () => {
    document.body.innerHTML = '<input type="search" placeholder="Search products"><div id="host"></div>';
    document.querySelector('#host')!.attachShadow({ mode: 'open' }).innerHTML = '<label>Company name<input></label>';
    const result = pageAction('scan', identity, true);
    expect(result.fields).toHaveLength(1);
    expect(result.fields[0].value).toBe(identity.company);
  });
  it('matches the localhost registration form fields and national phone format', () => {
    document.body.innerHTML = '<form><div><label>Organization Name *</label><div><input name="organizationName" placeholder="e.g. Alpha Cybernetics Nigeria Ltd"></div></div><div><label>RC / CAC Registration Number*</label><div><input name="rcNumber" placeholder="RC 1284730"></div></div><label>Organization Email<input type="email" name="email"></label><select aria-label="Country code" name="phoneCode"><option selected value="+234">Nigeria</option></select><label>Organization Phone Number<input type="tel" name="phone" autocomplete="tel-national"></label><label>Password<input type="password" name="password" autocomplete="current-password"></label></form>';
    const ng = createIdentity('en_NG', 42);
    const result = pageAction('scan', ng, true);
    const company = result.fields.find(f => f.kind === 'company')!;
    expect(company.label).toBe('Organization Name *');
    expect(company.value).toBe(ng.company);
    expect(result.fields.find(f => f.kind === 'registration number')!.value).toMatch(/^RC \d+$/);
    expect(result.fields.find(f => f.kind === 'phone')!.value).toMatch(/^\d{7,15}$/);
    const password = result.fields.find(f => f.kind === 'test password')!;
    expect(password.suggested).toBe(false);
    expect(password.value.length).toBeGreaterThanOrEqual(8);
    const selected = result.fields.filter(f => f.suggested).map(f => f.id);
    pageAction('fill', ng, true, selected);
    expect(document.querySelector<HTMLInputElement>('input[type=password]')!.value).toBe('');
    expect(document.querySelector<HTMLSelectElement>('select')!.value).toBe('+234');
  });
  it('remembers a semantic mapping while keeping new identities fresh', () => {
    document.body.innerHTML = '<label>Legal entity<input name="legalEntity"></label>';
    const first = pageAction('scan', identity, true).fields[0];
    expect(first.suggested).toBe(false);
    const mappings = { [first.key!]: 'company' };
    const mapped = pageAction('scan', identity, true, [], {}, {}, mappings).fields[0];
    expect(mapped.mapping).toBe('company'); expect(mapped.value).toBe(identity.company);
    const next = createIdentity('en_US', 999);
    expect(pageAction('scan', next, true, [], {}, {}, mappings).fields[0].value).toBe(next.company);
  });
  it('fills and undoes same-origin iframe fields using their own DOM realm', () => {
    document.body.innerHTML = '<iframe title="Embedded signup"></iframe>';
    const frame = document.querySelector('iframe')!;
    frame.contentDocument!.body.innerHTML = '<label>Email<input type="email"></label><input name="city">';
    vi.spyOn((frame.contentWindow as unknown as typeof window).HTMLElement.prototype, 'getClientRects').mockReturnValue([{ width: 100 }] as unknown as DOMRectList);
    const preview = pageAction('scan', identity, true);
    expect(preview.fields).toHaveLength(2);
    expect(pageAction('fill', identity, true, preview.fields.map(f => f.id)).count).toBe(2);
    expect(frame.contentDocument!.querySelector('input')!.value).toBe(identity.email);
    expect(pageAction('undo', identity, true).count).toBe(2);
    expect(frame.contentDocument!.querySelector('input')!.value).toBe('');
  });
  it('explains protected, prefilled, disabled, and inaccessible embedded fields', () => {
    document.body.innerHTML = '<label>Email<input type="email" value="keep@example.com"></label><label>City<input name="city" disabled></label><label>OTP<input name="otp"></label><iframe title="Other-origin signup"></iframe>';
    Object.defineProperty(document.querySelector('iframe'), 'contentDocument', { value: null });
    const result = pageAction('scan', identity, true);
    expect(result.issues.map(i => i.reason).join(' ')).toContain('Cross-origin');
    expect(result.issues.map(i => i.reason).join(' ')).toContain('Already has a value');
    expect(result.issues.map(i => i.reason).join(' ')).toContain('Disabled');
    expect(result.issues.map(i => i.reason).join(' ')).toContain('Protected');
  });
});

describe('site access', () => {
  function mockChrome(granted = true) {
    const api = {
      tabs: { query: vi.fn().mockResolvedValue([{ id: 7, url: 'http://localhost:5173/form' }]) },
      permissions: { contains: vi.fn().mockResolvedValue(false), request: vi.fn().mockResolvedValue(granted) },
      scripting: { executeScript: vi.fn().mockResolvedValue([{ result: { count: 0, fields: [], skipped: 0 } }]) },
    };
    vi.stubGlobal('chrome', api); return api;
  }
  it('requests the current site before injection, including localhost', async () => {
    const api = mockChrome();
    await runOnPage('scan', identity, true);
    expect(api.permissions.request).toHaveBeenCalledWith({ origins: ['http://localhost/*'] });
    expect(api.scripting.executeScript).toHaveBeenCalledTimes(2);
    expect(api.permissions.request.mock.invocationCallOrder[0]).toBeLessThan(api.scripting.executeScript.mock.invocationCallOrder[0]);
  });
  it('does not inject when access is declined', async () => {
    const api = mockChrome(false);
    await expect(runOnPage('scan', identity, true)).rejects.toThrow('declined');
    expect(api.scripting.executeScript).not.toHaveBeenCalled();
  });
  it('does not request again when permission already exists', async () => {
    const api = mockChrome(); api.permissions.contains.mockResolvedValue(true);
    await runOnPage('scan', identity, true);
    expect(api.permissions.request).not.toHaveBeenCalled();
  });
  it('blocks restricted pages before injection and rejects changed tabs', async () => {
    const api = mockChrome();
    await expect(runOnPage('fill', identity, true, [0], 8)).rejects.toThrow('tab changed');
    api.tabs.query.mockResolvedValue([{ id: 7, url: 'chrome://extensions' }]);
    await expect(runOnPage('scan', identity, true)).rejects.toThrow('Chrome blocks');
    expect(api.scripting.executeScript).not.toHaveBeenCalled();
    expect(() => hostPattern('https://chromewebstore.google.com/detail/test')).toThrow('Chrome blocks');
    expect(hostPattern('file:///C:/form.html')).toBe('file:///*');
  });
  it('pins subsequent injections to the scanned document', async () => {
    const api = mockChrome();
    api.scripting.executeScript.mockResolvedValue([{ documentId: 'doc-1', result: { count: 0, fields: [], skipped: 0, issues: [] } }] as never);
    const result = await runOnPage('scan', identity, true);
    expect(result.documentId).toBe('doc-1');
    expect(api.scripting.executeScript.mock.calls[1][0].target.documentIds).toEqual(['doc-1']);
    api.scripting.executeScript.mockClear();
    await runOnPage('undo', identity, true, [], 7, {}, 'doc-1');
    expect(api.scripting.executeScript.mock.calls[0][0].target.documentIds).toEqual(['doc-1']);
  });
  it('preserves actionable validation errors and stops before changing custom controls', async () => {
    const api = mockChrome();
    api.scripting.executeScript.mockResolvedValue([{ result: { count: 0, fields: [], skipped: 1, error: 'Check the value for Email: constraints.' } }] as never);
    await expect(runOnPage('fill', identity, true, [0], 7)).rejects.toThrow('Email: constraints');
    expect(api.scripting.executeScript).toHaveBeenCalledTimes(1);
  });
  it('reports partial success when custom controls fail, and keeps native undo available', async () => {
    const api = mockChrome();
    api.scripting.executeScript.mockResolvedValueOnce([{ result: { count: 1, fields: [], skipped: 0, issues: [] } }] as never).mockRejectedValueOnce(new Error('Dropdown detached')).mockResolvedValueOnce([{ result: { issues: [] } }] as never);
    const result = await runOnPage('fill', identity, true, [0, 100000], 7);
    expect(result.count).toBe(1); expect(result.changedCount).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.issues[0].label).toBe('Custom controls');
  });
  it('does not claim verified success when readback fails after writing', async () => {
    const api = mockChrome();
    api.scripting.executeScript.mockResolvedValueOnce([{ result: { count: 1, fields: [], skipped: 0, issues: [] } }] as never).mockResolvedValueOnce([{ result: { count: 0, fields: [], skipped: 0, issues: [] } }] as never).mockRejectedValueOnce(new Error('Frame removed'));
    const result = await runOnPage('fill', identity, true, [0], 7);
    expect(result.count).toBe(0); expect(result.changedCount).toBe(1);
    expect(result.issues[0].reason).toContain('verified');
  });
  it('explains navigation without injecting into the replacement document', async () => {
    const api = mockChrome(); api.scripting.executeScript.mockRejectedValue(new Error('No document with id doc-old'));
    await expect(runOnPage('fill', identity, true, [0], 7, {}, 'doc-old')).rejects.toThrow('navigated after preview');
    expect(api.scripting.executeScript).toHaveBeenCalledTimes(1);
  });
  it('rejects single-page-app route changes even when the document stays the same', async () => {
    const api = mockChrome();
    await expect(runOnPage('fill', identity, true, [0], 7, {}, 'doc-1', 'http://localhost:5173/previous')).rejects.toThrow('navigated after preview');
    expect(api.scripting.executeScript).not.toHaveBeenCalled();
  });
  it('discards a preview when the page changes while scanning', async () => {
    const api = mockChrome();
    api.tabs.query.mockResolvedValueOnce([{ id: 7, url: 'http://localhost:5173/form' }]).mockResolvedValueOnce([{ id: 7, url: 'http://localhost:5173/next' }]);
    await expect(runOnPage('scan', identity, true)).rejects.toThrow('page changed while scanning');
  });
});
