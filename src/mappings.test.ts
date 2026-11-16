import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadMappings, mappingScope, saveMapping } from './mappings';
afterEach(() => vi.unstubAllGlobals());
describe('local field mappings', () => {
  it('ignores malformed stored mappings without breaking page scans', async () => {
    const storage = { fieldMappings: { 'http://localhost:3000/register': null } };
    vi.stubGlobal('chrome', { storage: { local: { get: vi.fn(async () => storage) } } });
    expect(await loadMappings('http://localhost:3000/register')).toEqual({});
  });
  it('scopes mappings to site and pathname, without retaining query strings', async () => {
    const storage: Record<string, unknown> = {};
    vi.stubGlobal('chrome', { storage: { local: { get: vi.fn(async () => storage), set: vi.fn(async (v: object) => Object.assign(storage, v)) } } });
    const url = 'http://localhost:3000/register?ref=private#step';
    expect(mappingScope(url)).toBe('http://localhost:3000/register');
    await saveMapping(url, 'INPUT:legalEntity:text', 'company');
    expect(await loadMappings('http://localhost:3000/register')).toEqual({ 'INPUT:legalEntity:text': 'company' });
    expect(await loadMappings('http://localhost:3000/profile')).toEqual({});
    expect(await loadMappings('http://localhost:3001/register')).toEqual({});
    expect(JSON.stringify(storage)).not.toContain('private');
    await saveMapping(url, 'INPUT:legalEntity:text', '');
    expect(await loadMappings(url)).toEqual({});
  });
});
