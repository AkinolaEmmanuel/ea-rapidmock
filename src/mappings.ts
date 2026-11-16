export function mappingScope(url: string): string {
  const parsed = new URL(url);
  return `${parsed.origin}${parsed.pathname}`;
}
export async function loadMappings(url: string): Promise<Record<string, string>> {
  if (!globalThis.chrome?.storage?.local) return {};
  const { fieldMappings = {} } = await chrome.storage.local.get('fieldMappings');
  const scope = mappingScope(url);
  const entry = fieldMappings && typeof fieldMappings === 'object' && Object.hasOwn(fieldMappings, scope) ? (fieldMappings as Record<string, unknown>)[scope] : undefined;
  return entry && typeof entry === 'object' && !Array.isArray(entry) ? Object.fromEntries(Object.entries(entry).filter(([, value]) => typeof value === 'string')) : {};
}
export async function saveMapping(url: string, key: string, type: string) {
  const { fieldMappings = {} } = await chrome.storage.local.get('fieldMappings');
  const scope = mappingScope(url);
  const all = fieldMappings && typeof fieldMappings === 'object' && !Array.isArray(fieldMappings) ? fieldMappings : {};
  const next = { ...await loadMappings(url) };
  if (type) next[key] = type; else delete next[key];
  await chrome.storage.local.set({ fieldMappings: { ...all, [scope]: next } });
}
