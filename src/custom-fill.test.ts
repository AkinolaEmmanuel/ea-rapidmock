// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { customPageAction } from './custom-fill';

function fixture() {
  document.body.innerHTML = '<form><div id="field"><label>Industry / Sector*</label><div class="group"><div class="cursor-pointer"><span>Select...</span></div></div></div><button type="submit">Create account</button></form>';
  const trigger = document.querySelector<HTMLElement>('.cursor-pointer')!;
  trigger.addEventListener('click', () => {
    const existing = document.querySelector('.overflow-y-auto');
    if (existing) { existing.remove(); return; }
    const list = document.createElement('div'); list.className = 'overflow-y-auto';
    for (const label of ['Manufacturing', 'Information and Communication Technology']) {
      const option = document.createElement('div'); option.className = 'cursor-pointer'; option.textContent = label;
      option.addEventListener('click', () => { trigger.firstElementChild!.textContent = label; list.remove(); });
      list.append(option);
    }
    trigger.parentElement!.append(list);
  });
  return trigger;
}
beforeEach(() => {
  delete (window as unknown as Record<string, unknown>).__eaRapidMockCustom;
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([{ width: 100 }] as unknown as DOMRectList);
});
afterEach(() => vi.restoreAllMocks());
describe('custom industry dropdowns', () => {
  it('discovers actual options, closes the preview popup, and clicks the chosen option', async () => {
    const trigger = fixture();
    const submit = vi.fn(); document.querySelector('form')!.addEventListener('submit', submit);
    const result = await customPageAction('scan', true);
    expect(result.fields).toHaveLength(1);
    expect(result.fields[0].label).toBe('Industry / Sector*');
    expect(result.fields[0].options).toHaveLength(2);
    expect(document.querySelector('.overflow-y-auto')).toBeNull();
    expect(trigger.textContent).toBe('Select...');
    const filled = await customPageAction('fill', true, [100000], { 100000: 'Information and Communication Technology' });
    expect(filled.count).toBe(1);
    expect(trigger.textContent).toBe('Information and Communication Technology');
    expect(submit).not.toHaveBeenCalled();
    const undo = await customPageAction('undo', true);
    expect(undo.skipped).toBe(1);
  });
  it('preserves a changed selection after preview', async () => {
    const trigger = fixture(); await customPageAction('scan', true);
    trigger.firstElementChild!.textContent = 'Manually changed';
    expect((await customPageAction('fill', true, [100000])).count).toBe(0);
  });
});
