import type { Field, PageIssue } from './fill';

// Operates dropdowns through their public DOM, so their own change handlers run.
// Only recognised select triggers are clicked; never arbitrary form buttons.
export async function customPageAction(action: 'scan' | 'fill' | 'undo', emptyOnly: boolean, selected: number[] = [], overrides: Record<number, string> = {}) {
  type Entry = { trigger: HTMLElement; container: HTMLElement; label: string; before: string; value: string; options: { label: string; value: string }[] };
  const scope = window as unknown as { __eaRapidMockCustom?: { plan: Entry[]; undo: Entry[] } };
  const state = scope.__eaRapidMockCustom ??= { plan: [], undo: [] };
  const issues: PageIssue[] = [];
  const text = (el: Element) => (el.textContent || '').replace(/\s+/g, ' ').trim();
  const empty = (value: string) => !value || /^(select|choose|please select)\b/i.test(value);
  const settle = () => new Promise<void>(resolve => setTimeout(resolve, 40));
  const visible = (el: HTMLElement) => !!el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden';
  const options = (entry: Entry) => {
    const root = entry.trigger.getRootNode() as Document | ShadowRoot;
    const controlled = (entry.trigger.getAttribute('aria-controls') || entry.trigger.getAttribute('aria-owns') || '').split(/\s+/).map(id => root.getElementById(id)).filter((el): el is HTMLElement => !!el);
    const roots = controlled.length ? controlled : [entry.container];
    return roots.flatMap(container => Array.from(container.querySelectorAll<HTMLElement>('[role=option], .overflow-y-auto > .cursor-pointer'))).filter(el => visible(el) && !el.matches(':disabled') && el.getAttribute('aria-disabled') !== 'true');
  };
  async function open(entry: Entry) {
    const existing = options(entry); if (existing.length) return existing;
    entry.trigger.click();
    for (let attempt = 0; attempt < 15; attempt++) { await settle(); const found = options(entry); if (found.length) return found; }
    return [];
  }
  async function choose(entry: Entry, value: string) {
    const opts = await open(entry);
    const match = opts.find(o => text(o) === value);
    if (!match) { entry.trigger.click(); await settle(); return false; }
    match.click();
    for (let attempt = 0; attempt < 15; attempt++) { await settle(); if (text(entry.trigger) === value || entry.trigger.getAttribute('aria-valuetext') === value) return true; }
    return false;
  }
  if (action === 'scan') {
    state.plan = [];
    const triggers: HTMLElement[] = [];
    function collect(root: Document | ShadowRoot) {
      triggers.push(...root.querySelectorAll<HTMLElement>('[role=combobox]:not(input):not(select), button[aria-haspopup=listbox], form .group > div.cursor-pointer'));
      for (const el of root.querySelectorAll('*')) if (el.shadowRoot) collect(el.shadowRoot);
      for (const frame of root.querySelectorAll<HTMLIFrameElement>('iframe')) { try { if (frame.getClientRects().length && frame.contentDocument) collect(frame.contentDocument); } catch { /* Native scan reports inaccessible frames. */ } }
    }
    collect(document);
    for (const trigger of triggers) {
      if (!visible(trigger) || trigger.matches(':disabled') || trigger.getAttribute('aria-disabled') === 'true' || trigger.classList.contains('cursor-not-allowed')) continue;
      if (trigger.tagName === 'BUTTON' && trigger.closest('form') && trigger.getAttribute('type') !== 'button') { issues.push({ label: text(trigger), reason: 'Dropdown trigger may submit the form; choose it manually.' }); continue; }
      const before = text(trigger);
      if (emptyOnly && !empty(before)) continue;
      let container = trigger.parentElement;
      const root = trigger.getRootNode() as Document | ShadowRoot;
      let label = trigger.getAttribute('aria-label') || (trigger.getAttribute('aria-labelledby') || '').split(/\s+/).map(id => root.getElementById(id)?.textContent || '').join(' ').trim();
      for (let depth = 0; container && depth < 3; depth++, container = container.parentElement) {
        label ||= Array.from(container.children).find(c => c.tagName === 'LABEL')?.textContent?.trim() || '';
        if (label) break;
      }
      if (!container || !label || /password|verification|payment|consent/i.test(label)) continue;
      const entry: Entry = { trigger, container, label, before, value: '', options: [] };
      const alreadyOpen = options(entry).length > 0;
      const opts = alreadyOpen ? options(entry) : await open(entry);
      entry.options = opts.map(o => ({ label: text(o), value: text(o) })).filter(o => o.value);
      if (!alreadyOpen) { trigger.click(); await settle(); }
      if (!entry.options.length) { issues.push({ label, reason: 'Custom dropdown options could not be read; choose a value manually.' }); continue; }
      entry.value = entry.options[0].value;
      state.plan.push(entry);
    }
    const fields: Field[] = state.plan.map((e, i) => ({ id: 100000 + i, label: e.label, value: e.value, kind: 'custom select', suggested: true, options: e.options, warning: empty(e.before) ? 'Choose an available option. An initially empty custom dropdown must be reset manually to undo.' : undefined }));
    return { count: fields.length, fields, skipped: issues.length, issues };
  }
  if (action === 'undo') {
    let count = 0, skipped = 0;
    for (const entry of state.undo) {
      if (!entry.trigger.isConnected || text(entry.trigger) !== entry.value || empty(entry.before)) { skipped++; issues.push({ label: entry.label, reason: empty(entry.before) ? 'Reset this initially empty custom dropdown manually.' : 'Selection changed after filling; preserved your edit.' }); continue; }
      if (await choose(entry, entry.before)) count++; else { skipped++; issues.push({ label: entry.label, reason: 'Could not restore this custom dropdown automatically.' }); }
    }
    state.undo = [];
    return { count, fields: [] as Field[], skipped, issues };
  }
  let count = 0, skipped = 0;
  const undo: Entry[] = [];
  for (const id of selected.filter(id => id >= 100000)) {
    const entry = state.plan[id - 100000];
    if (!entry || !entry.trigger.isConnected || text(entry.trigger) !== entry.before || (emptyOnly && !empty(text(entry.trigger)))) { skipped++; issues.push({ label: entry?.label || 'Custom dropdown', reason: 'Dropdown changed since preview; preserved the current choice.' }); continue; }
    const value = overrides[id] ?? entry.value;
    if (!entry.options.some(o => o.value === value)) { skipped++; issues.push({ label: entry.label, reason: 'This option is no longer available.' }); continue; }
    if (await choose(entry, value)) { undo.push({ ...entry, value }); count++; } else { skipped++; issues.push({ label: entry.label, reason: 'The dropdown did not accept this choice. Rescan and try again.' }); }
  }
  state.undo = undo;
  state.plan = [];
  return { count, fields: [] as Field[], skipped, issues };
}
