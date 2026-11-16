import { describe, expect, it } from 'vitest';
import { createIdentity, generateData, presets } from './engine';

describe('identity generation', () => {
  it('repeats a seeded identity and never claims a receiving mailbox', () => {
    const p = createIdentity('en_NG', 12);
    expect(p).toEqual(createIdentity('en_NG', 12));
    expect(p.email).toBe(`${p.username}@example.com`);
    expect(p.mailbox.status).toBe('test');
    expect(p.countryCode).toBe('NG');
  });
  it('changes identity for a different seed', () => expect(createIdentity('en_US', 1).id).not.toBe(createIdentity('en_US', 2).id));
});
describe('blueprint evaluation', () => {
  it('is reproducible including relative dates', () => expect(generateData(presets.Users, 3, 42, 'en_NG')).toEqual(generateData(presets.Users, 3, 42, 'en_NG')));
  it('preserves literals, arrays, and nested values', () => {
    expect(generateData({ value: 'uuid', a: [1, null, false], nested: { pick: { $pick: ['only'] } } }, 1, 1, 'en_US')).toEqual([{ value: 'uuid', a: [1, null, false], nested: { pick: 'only' } }]);
  });
  it('rejects unknown and inherited tokens with useful paths', () => {
    expect(() => generateData({ x: '{{constructor}}' }, 1, 1, 'en_US')).toThrow('$[0].x');
    expect(() => generateData({ $pick: [] }, 1, 1, 'en_US')).toThrow('choices');
  });
  it('rejects excessive generation and invalid seeds', () => {
    expect(() => generateData({}, 5001, 1, 'en_US')).toThrow('count');
    expect(() => generateData({}, 1, NaN, 'en_US')).toThrow('Seed');
  });
});
