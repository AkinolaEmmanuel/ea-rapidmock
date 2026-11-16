import { generator, type Identity } from './engine';
import { customPageAction } from './custom-fill';
import { loadMappings } from './mappings';
export interface Field { id: number; label: string; value: string; kind: string; suggested: boolean; warning?: string; key?: string; mapping?: string; options?: { label: string; value: string }[] }
export interface PageIssue { label: string; reason: string }
export const mappingTypes = ['first name', 'last name', 'full name', 'email', 'username', 'phone', 'company', 'address', 'city', 'state', 'postal code', 'country', 'URL', 'product', 'description', 'SKU', 'registration number', 'job title', 'title'] as const;
type Samples = Record<string, string>;

// Chrome serializes this function: all DOM helpers must stay inside its body.
export function pageAction(action: 'scan' | 'fill' | 'undo', identity: Identity, emptyOnly: boolean, selected: number[] = [], overrides: Record<number, string> = {}, samples: Samples = {}, mappings: Record<string, string> = {}) {
  type Control = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
  type Entry = { element: Control; value: string; before: string; label: string; kind: string; suggested: boolean; warning?: string; key: string; mapping?: string };
  const scope = window as unknown as { __eaRapidMock?: { plan: Entry[]; undo: { element: Control; before: string; after: string; label?: string }[] } };
  const state = scope.__eaRapidMock ??= { plan: [], undo: [] };
  const issues: PageIssue[] = [];
  const isInput = (el: Control): el is HTMLInputElement => el.tagName === 'INPUT';
  const isSelect = (el: Control): el is HTMLSelectElement => el.tagName === 'SELECT';
  const set = (el: Control, value: string) => {
    const realm = el.ownerDocument.defaultView!;
    const constructors = realm as unknown as typeof window;
    const proto = isSelect(el) ? constructors.HTMLSelectElement.prototype : el.tagName === 'TEXTAREA' ? constructors.HTMLTextAreaElement.prototype : constructors.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
    el.dispatchEvent(new constructors.Event('input', { bubbles: true, composed: true }));
    el.dispatchEvent(new constructors.Event('change', { bubbles: true, composed: true }));
    el.dispatchEvent(new constructors.FocusEvent('focusout', { bubbles: true, composed: true }));
  };
  const validate = (element: Control, value: string) => {
    const clone = element.cloneNode(true) as Control;
    clone.value = value;
    if (!isSelect(element) && ((element.minLength > 0 && value.length < element.minLength) || (element.maxLength >= 0 && value.length > element.maxLength))) return false;
    return clone.value === value && clone.checkValidity();
  };
  if (action === 'undo') {
    let count = 0;
    for (const e of state.undo) if (e.element.isConnected && e.element.value === e.after) { set(e.element, e.before); count++; } else issues.push({ label: e.label || 'Field', reason: 'Changed or removed after filling; preserved your edit.' });
    state.undo = [];
    return { count, fields: [] as Field[], skipped: issues.length, issues };
  }
  if (action === 'fill') {
    for (const id of selected) {
      const e = state.plan[id];
      if (e?.element.isConnected && e.element.value === e.before && !validate(e.element, overrides[id] ?? e.value)) {
        const error = `Check the value for "${e.label}". It does not meet this field's constraints.`;
        return { count: 0, fields: [] as Field[], skipped: selected.length, issues: [{ label: e.label, reason: error }], error };
      }
    }
    const undo: typeof state.undo = [];
    let count = 0;
    for (const id of selected) {
      const e = state.plan[id];
      if (!e || !e.element.isConnected || e.element.matches(':disabled') || ('readOnly' in e.element && e.element.readOnly) || e.element.value !== e.before || (emptyOnly && e.element.value.trim())) { issues.push({ label: e?.label || 'Field', reason: 'Changed, removed, or disabled since preview. Scan the page again.' }); continue; }
      const value = overrides[id] ?? e.value;
      set(e.element, value);
      undo.push({ element: e.element, before: e.before, after: value, label: e.label }); count++;
    }
    state.undo = undo;
    state.plan = [];
    return { count, fields: [] as Field[], skipped: selected.length - count, issues };
  }
  const p = identity;
  const auto: Record<string, string> = { 'given-name': p.firstName, 'family-name': p.lastName, name: `${p.firstName} ${p.lastName}`, email: p.email, username: p.username, tel: p.phone, organization: p.company, 'street-address': p.street, 'address-line1': p.street, 'address-level2': p.city, 'address-level1': p.state, 'postal-code': p.postalCode, 'country-name': p.country, country: p.countryCode, url: 'https://example.com' };
  const controls: Control[] = [];
  function collect(root: Document | ShadowRoot) {
    controls.push(...root.querySelectorAll<Control>('input, textarea, select'));
    for (const element of root.querySelectorAll('*')) if (element.shadowRoot) collect(element.shadowRoot);
    for (const frame of root.querySelectorAll<HTMLIFrameElement>('iframe')) {
      if (!frame.getClientRects().length) continue;
      try { if (frame.contentDocument) collect(frame.contentDocument); else issues.push({ label: frame.title || 'Embedded form', reason: 'Cross-origin embedded frame: open its page directly to generate fields.' }); }
      catch { issues.push({ label: frame.title || 'Embedded form', reason: 'This embedded frame is not accessible from the current page.' }); }
    }
  }
  collect(document);
  state.plan = [];
  for (const element of controls) {
    const style = element.ownerDocument.defaultView!.getComputedStyle(element);
    if (!element.getClientRects().length || style.visibility === 'hidden' || style.visibility === 'collapse' || element.type === 'hidden') continue;
    const root = element.getRootNode() as Document | ShadowRoot;
    const ariaLabel = (element.getAttribute('aria-labelledby') || '').split(/\s+/).map(id => root.getElementById(id)?.textContent || '').join(' ').trim();
    const labels = Array.from(element.labels || []).map(l => l.textContent?.trim() || '').filter(Boolean);
    let nearbyLabel = '';
    for (let parent = element.parentElement, depth = 0; parent && depth < 3; parent = parent.parentElement, depth++) {
      if (parent.querySelectorAll('input:not([type=hidden]),textarea,select').length > 2) break;
      nearbyLabel = Array.from(parent.children).find(c => c.tagName === 'LABEL')?.textContent?.trim() || '';
      if (nearbyLabel) break;
    }
    const visibleLabel = labels.join(' ') || element.getAttribute('aria-label') || ariaLabel || nearbyLabel || element.getAttribute('placeholder') || '';
    const label = (visibleLabel || element.name || element.id || element.type).replace(/\s+/g, ' ').trim();
    const hint = [visibleLabel, element.name, element.id, element.getAttribute('placeholder')].join(' ').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().replace(/[_-]/g, ' ');
    if (element.matches(':disabled') || ('readOnly' in element && element.readOnly)) { issues.push({ label, reason: 'Disabled or read-only field.' }); continue; }
    if (isInput(element) && !['text', 'email', 'tel', 'url', 'number', 'date', 'datetime-local', 'time', 'month', 'week', 'password'].includes(element.type)) { if (!['submit', 'button', 'reset', 'search'].includes(element.type)) issues.push({ label, reason: 'This control is left for manual selection.' }); continue; }
    if (emptyOnly && element.value.trim()) { issues.push({ label, reason: 'Already has a value; fill-empty-only is enabled.' }); continue; }
    const isPassword = isInput(element) && element.type === 'password';
    if ((!isPassword && /password/.test(hint)) || /credit.?card|card.?number|cvv|security|token|otp|verification|ssn|social security/.test(hint)) { issues.push({ label, reason: 'Protected field: fill manually.' }); continue; }
    const autocomplete = (element.getAttribute('autocomplete') || '').trim().split(/\s+/).at(-1) ?? '';
    if (/^(cc-|one-time-code)/.test(autocomplete) || (!isPassword && /password/.test(autocomplete))) { issues.push({ label, reason: 'Protected field: fill manually.' }); continue; }
    let value = Object.hasOwn(auto, autocomplete) ? auto[autocomplete] : '';
    let kind = autocomplete && value ? autocomplete : 'text';
    if (isPassword) { value = samples.password || 'Ea9!RapidMockTesting'; kind = 'test password'; }
    if (!value) {
      const assign = (v: string, k: string) => { value = v; kind = k; };
      if (element.type === 'email' || /\be ?mail\b/.test(hint)) assign(p.email, 'email');
      else if (/first ?name|given ?name|\bfname\b/.test(hint)) assign(p.firstName, 'first name');
      else if (/last ?name|family ?name|surname|\blname\b/.test(hint)) assign(p.lastName, 'last name');
      else if (/user ?name|\bhandle\b/.test(hint)) assign(p.username, 'username');
      else if (element.type === 'tel' || /phone|mobile|telephone/.test(hint)) {
        const national = p.phone.replace(/\D/g, '').replace(p.countryCode === 'NG' ? /^234/ : /^1/, '');
        assign(autocomplete === 'tel-national' ? national : p.phone, 'phone');
      }
      else if (/company|organi[sz]ation|business ?name/.test(hint)) assign(p.company, 'company');
      else if (/(product|item) ?name/.test(hint) || element.name === 'product') assign(samples.product || 'Ergonomic Desk Lamp', 'product');
      else if (/postal|zip/.test(hint)) assign(p.postalCode, 'postal code');
      else if (/country/.test(hint)) assign(p.country, 'country');
      else if (/\bcity\b|\btown\b/.test(hint)) assign(p.city, 'city');
      else if (/\bstate\b|province/.test(hint)) assign(p.state, 'state');
      else if (/street|address/.test(hint)) assign(p.street, 'address');
      else if (/\burl\b|website|\blink\b/.test(hint) || element.type === 'url') assign('https://example.com', 'URL');
      else if (/description|biography|\bbio\b|\bnotes?\b|message|summary|comment/.test(hint)) assign(samples.description || 'A practical sample created for testing this form.', 'description');
      else if (/\bsku\b|product.?code/.test(hint)) assign(samples.sku || 'MOCK-1001', 'SKU');
      else if (/\brc\b|cac|registration ?number/.test(hint)) assign(samples.registration || 'RC 1284730', 'registration number');
      else if (/job.?title|occupation|profession/.test(hint)) assign(samples.job || 'Software Engineer', 'job title');
      else if (/\btitle\b|subject/.test(hint)) assign(samples.title || 'Sample project update', 'title');
      else if (/full ?name|\bname\b/.test(hint)) assign(`${p.firstName} ${p.lastName}`, 'full name');
    }
    const key = `${element.ownerDocument.location.pathname}:${element.tagName}:${element.name || element.id || label.toLowerCase()}:${element.type}`;
    const mapped = Object.hasOwn(mappings, key) ? mappings[key] : '';
    const values: Record<string, string> = { 'first name': p.firstName, 'last name': p.lastName, 'full name': `${p.firstName} ${p.lastName}`, email: p.email, username: p.username, phone: p.phone, company: p.company, address: p.street, city: p.city, state: p.state, 'postal code': p.postalCode, country: p.country, URL: 'https://example.com', product: samples.product || 'Test product', description: samples.description || 'Sample description for testing.', SKU: samples.sku || 'MOCK-1001', 'registration number': samples.registration || 'RC 1284730', 'job title': samples.job || 'Software Engineer', title: samples.title || 'Sample project update' };
    if (!isPassword && Object.hasOwn(values, mapped)) { value = values[mapped]; kind = mapped; }
    if (isInput(element) && element.type === 'number') {
      const low = element.min !== '' ? Number(element.min) : /age/.test(hint) ? 18 : 1;
      const high = element.max !== '' ? Number(element.max) : Math.max(low, /price|amount|salary|budget|cost/.test(hint) ? 1000 : /age/.test(hint) ? 65 : 20);
      const step = element.step === 'any' ? 0.01 : Number(element.step || 1);
      const base = element.min !== '' ? Number(element.min) : Number(element.getAttribute('value') || 0);
      const first = base + Math.ceil((low - base) / step) * step;
      value = String(Number(Math.min(first + Math.floor(Math.max(0, high - first) / step / 2) * step, high).toFixed(8)));
      kind = 'number';
    } else if (isInput(element) && ['date', 'datetime-local', 'time', 'month', 'week'].includes(element.type)) {
      const now = new Date().toISOString();
      const defaults: Record<string, string> = { date: now.slice(0, 10), 'datetime-local': now.slice(0, 16), time: '12:00', month: now.slice(0, 7), week: `${now.slice(0, 4)}-W20` };
      value = /birth|\bdob\b/.test(hint) && element.type === 'date' ? '1995-06-15' : defaults[element.type];
      if (element.min && value < element.min) value = element.min;
      if (element.max && value > element.max) value = element.max;
      kind = element.type;
    } else if (!value && /quantity|\bqty\b|\bage\b|price|amount|salary|budget|\bcost\b/.test(hint)) {
      value = /age/.test(hint) ? '30' : /quantity|qty/.test(hint) ? '3' : samples.price || '49.99'; kind = 'number';
    }
    let suggested = !!value;
    if (isSelect(element)) {
      if (element.multiple) { issues.push({ label, reason: 'Multi-select control: choose values manually.' }); continue; }
      const options = Array.from(element.options).filter(o => !o.disabled && !o.closest('optgroup')?.disabled && o.value && !/^\s*(select|choose|please select)\b/i.test(o.text));
      const candidates = [value, ...(kind === 'country' || autocomplete === 'country' || autocomplete === 'country-name' ? [p.country, p.countryCode] : [])].filter(Boolean).map(v => v.toLowerCase());
      const option = options.find(o => candidates.includes(o.value.toLowerCase()) || candidates.includes(o.text.trim().toLowerCase()));
      if (option) value = option.value;
      else { value = options[0]?.value || ''; suggested = !['country', 'state', 'country-name', 'address-level1'].includes(kind); }
      kind = 'select';
    }
    if (!value) { value = `Test ${label.replace(/[*:]/g, '').trim()}`; suggested = false; }
    if (!isSelect(element)) {
      if (element.maxLength >= 0 && value.length > element.maxLength) value = value.slice(0, element.maxLength);
      if (element.minLength > value.length && ['text', 'description', 'title', 'product'].includes(kind)) value = value.padEnd(element.minLength, 'x');
    }
    let warning: string | undefined;
    if (!validate(element, value)) { suggested = false; warning = 'Edit this value to match the field’s format or constraints.'; }
    else if (!suggested) warning = 'No confident match. Review or edit this suggestion before selecting it.';
    if (isPassword) { suggested = false; warning = 'Generated test password. Select this field explicitly to fill it.'; }
    state.plan.push({ element, value, before: element.value, label, kind, suggested, warning, key, mapping: mapped || undefined });
  }
  return { count: state.plan.length, skipped: issues.length, issues, fields: state.plan.map(({ element, label, value, kind, suggested, warning, key, mapping }, id) => ({ id, label, value, kind, suggested, warning, key, mapping, ...(isSelect(element) ? { options: Array.from(element.options).filter(o => !o.disabled && !o.closest('optgroup')?.disabled).map(o => ({ label: o.text, value: o.value })) } : {}) })) };
}

export function hostPattern(url: string): string {
  const parsed = new URL(url);
  if (parsed.protocol === 'file:') return 'file:///*';
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.hostname === 'chromewebstore.google.com' || (parsed.hostname === 'chrome.google.com' && parsed.pathname.startsWith('/webstore'))) throw new Error('Chrome blocks extensions on this page. Open a regular website or localhost form.');
  return `${parsed.protocol}//${parsed.hostname}/*`;
}

// Read back after the page's own reactive handlers have had time to render.
export async function verifyPageFill() {
  await new Promise(resolve => setTimeout(resolve, 100));
  const state = (window as unknown as { __eaRapidMock?: { undo: { element: HTMLInputElement; after: string; label?: string }[] } }).__eaRapidMock;
  const issues: PageIssue[] = [];
  for (const e of state?.undo || []) {
    if (!e.element.isConnected || e.element.value !== e.after) issues.push({ label: e.label || 'Field', reason: 'The page replaced or rejected this value. Rescan and review its format.' });
    else if (!e.element.validity.valid) issues.push({ label: e.label || 'Field', reason: e.element.validationMessage || 'The page reports a validation error.' });
  }
  return { issues };
}

export async function runOnPage(action: 'scan' | 'fill' | 'undo', identity: Identity, emptyOnly: boolean, selected: number[] = [], expectedTab?: number, overrides: Record<number, string> = {}, expectedDocument?: string, expectedPageUrl?: string) {
  if (!globalThis.chrome?.scripting) throw new Error('Load the built extension in Chrome to fill a webpage.');
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || (expectedTab !== undefined && expectedTab !== tab.id)) throw new Error('The active tab changed. Preview its fields again.');
  if (!tab.url) throw new Error('Reload EA RapidMock in chrome://extensions to apply its updated permissions, then reopen the side panel.');
  if (expectedPageUrl && tab.url !== expectedPageUrl) throw new Error('This page navigated after preview. Scan it again before filling.');
  const pattern = hostPattern(tab.url);
  if (action === 'scan' && !await chrome.permissions.contains({ origins: [pattern] })) {
    const granted = await chrome.permissions.request({ origins: [pattern] });
    if (!granted) throw new Error('Page access was declined. Click Preview fields again and allow access to this site.');
  }
  if (pattern === 'file:///*' && !await chrome.extension.isAllowedFileSchemeAccess()) throw new Error('Enable “Allow access to file URLs” in EA RapidMock’s extension details, then try again.');
  const seed = [...identity.id].reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 0);
  const f = generator(identity.locale, seed);
  const mappings = action === 'scan' ? await loadMappings(tab.url) : {};
  const samples = { product: f.commerce.productName(), description: f.commerce.productDescription(), sku: f.string.alphanumeric(10).toUpperCase(), registration: `RC ${f.string.numeric(7)}`, job: f.person.jobTitle(), title: `${f.commerce.productAdjective()} project`, price: f.commerce.price(), password: `Ea9!${f.string.alphanumeric(16)}` };
  try {
    const target = expectedDocument ? { tabId: tab.id, documentIds: [expectedDocument] } : { tabId: tab.id };
    const [result] = await chrome.scripting.executeScript({ target, func: pageAction, args: [action, identity, emptyOnly, selected.filter(id => id < 100000), overrides, samples, mappings] });
    if (!result?.result) throw new Error('Could not read fields from this page.');
    if (result.result.error) throw new Error(result.result.error);
    const documentId = result.documentId || expectedDocument;
    const pinnedTarget = documentId ? { tabId: tab.id, documentIds: [documentId] } : target;
    let customResult: Awaited<ReturnType<typeof customPageAction>> = { count: 0, fields: [], skipped: 0, issues: [] };
    try {
      const [custom] = await chrome.scripting.executeScript({ target: pinnedTarget, func: customPageAction, args: [action, emptyOnly, selected, overrides] });
      if (custom?.result) customResult = custom.result;
    } catch {
      customResult.issues.push({ label: 'Custom controls', reason: 'Could not finish custom controls. Native fields may have changed; review the page and rescan.' });
      customResult.skipped = action === 'fill' ? selected.filter(id => id >= 100000).length : 0;
    }
    let rejected: PageIssue[] = [];
    let verifiedNativeCount = result.result.count;
    if (action === 'fill' && result.result.count) {
      try {
        const [verified] = await chrome.scripting.executeScript({ target: pinnedTarget, func: verifyPageFill });
        rejected = verified?.result?.issues || [];
      } catch { verifiedNativeCount = 0; customResult.issues.push({ label: 'Value verification', reason: 'The page changed before values could be verified. Review the page and rescan.' }); }
    }
    if (action === 'scan') {
      const [current] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (current?.id !== tab.id || current.url !== tab.url) throw new Error('The page changed while scanning. Preview its fields again.');
    }
    return { count: Math.max(0, verifiedNativeCount - rejected.length) + customResult.count, changedCount: result.result.count + customResult.count, fields: [...result.result.fields, ...customResult.fields], skipped: result.result.skipped + customResult.skipped + rejected.length + result.result.count - verifiedNativeCount, issues: [...(result.result.issues || []), ...(customResult.issues || []), ...rejected], tabId: tab.id, pageUrl: tab.url, documentId };
  } catch (error) {
    if (/No document|document.*not found|No frame|Frame.*removed/i.test(error instanceof Error ? error.message : String(error))) throw new Error('This page navigated after preview. Scan it again before filling.');
    if (/Cannot access|permission|extensions gallery/i.test(error instanceof Error ? error.message : String(error))) throw new Error('Chrome denied page access. Reload the extension, allow access to this site, then preview again.');
    throw error;
  }
}
