import { Faker, en, en_NG, en_US, base } from '@faker-js/faker';

export type Locale = 'en_NG' | 'en_US';
export interface Identity {
  id: string; firstName: string; lastName: string; email: string; username: string;
  phone: string; company: string; street: string; city: string; state: string;
  postalCode: string; country: string; countryCode: string; locale: Locale;
  mailbox: { status: 'test' } | { status: 'active' | 'expired'; id: string; expiresAt: string };
}
export function generator(locale: Locale, seed: number) {
  const faker = new Faker({ locale: [locale === 'en_NG' ? en_NG : en_US, en, base] });
  faker.seed(seed);
  faker.setDefaultRefDate('2026-01-01T00:00:00.000Z');
  return faker;
}
export function createIdentity(locale: Locale, seed = crypto.getRandomValues(new Uint32Array(1))[0]): Identity {
  const f = generator(locale, seed);
  const firstName = f.person.firstName(), lastName = f.person.lastName();
  const username = `${firstName}.${lastName}.${f.string.alphanumeric(4)}`.toLowerCase().replace(/[^a-z0-9.]/g, '');
  // Correlated address presets avoid mixing cities, states, and postal regions.
  const addresses = locale === 'en_NG'
    ? [{ city: 'Lagos', state: 'Lagos', postalCode: '101001' }, { city: 'Abuja', state: 'Federal Capital Territory', postalCode: '900001' }, { city: 'Ibadan', state: 'Oyo', postalCode: '200001' }]
    : [{ city: 'Austin', state: 'Texas', postalCode: '78701' }, { city: 'Seattle', state: 'Washington', postalCode: '98101' }, { city: 'New York', state: 'New York', postalCode: '10001' }];
  return { id: f.string.uuid(), firstName, lastName, username, email: `${username}@example.com`,
    phone: locale === 'en_NG' ? '+234 000 000 0000' : '+1 202 555 01' + f.string.numeric(2),
    company: f.company.name(), street: f.location.streetAddress(), ...f.helpers.arrayElement(addresses),
    country: locale === 'en_NG' ? 'Nigeria' : 'United States', countryCode: locale === 'en_NG' ? 'NG' : 'US', locale, mailbox: { status: 'test' } };
}

export const presets = {
  Users: { id: '{{string.uuid}}', firstName: '{{person.firstName}}', lastName: '{{person.lastName}}', email: '{{internet.email}}', status: { $pick: ['active', 'pending', 'suspended'] }, joinedAt: '{{date.past}}' },
  Products: { id: '{{string.uuid}}', name: '{{commerce.productName}}', price: '{{commerce.price}}', category: '{{commerce.department}}' },
  Orders: { id: '{{string.uuid}}', customerId: '{{string.uuid}}', total: '{{commerce.price}}', status: { $pick: ['paid', 'pending', 'shipped'] } },
};
export function generateData(blueprint: unknown, count: number, seed: number, locale: Locale): unknown[] {
  if (!Number.isInteger(count) || count < 1 || count > 5000) throw new Error('Item count must be between 1 and 5,000.');
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 4294967295) throw new Error('Seed must be an integer between 0 and 4,294,967,295.');
  const f = generator(locale, seed);
  const tokens: Record<string, () => unknown> = {
    'string.uuid': () => f.string.uuid(), 'person.firstName': () => f.person.firstName(), 'person.lastName': () => f.person.lastName(),
    'person.fullName': () => f.person.fullName(), 'internet.email': () => f.internet.email({ provider: 'example.com' }),
    'internet.username': () => f.internet.username(), 'company.name': () => f.company.name(),
    'commerce.productName': () => f.commerce.productName(), 'commerce.price': () => Number(f.commerce.price()),
    'commerce.department': () => f.commerce.department(), 'date.past': () => f.date.past().toISOString(),
    'number.int': () => f.number.int({ min: 0, max: 1000 }), 'datatype.boolean': () => f.datatype.boolean(),
  };
  let nodes = 0;
  function visit(value: unknown, path: string, depth: number): unknown {
    if (++nodes > 500000 || depth > 30) throw new Error('Blueprint is too large or too deeply nested.');
    if (typeof value === 'string') {
      const match = /^\{\{([^{}]+)\}\}$/.exec(value);
      if (!match) return value;
      if (!Object.hasOwn(tokens, match[1])) throw new Error(`Unknown token "${match[1]}" at ${path}.`);
      return tokens[match[1]]();
    }
    if (Array.isArray(value)) return value.map((v, i) => visit(v, `${path}[${i}]`, depth + 1));
    if (value && typeof value === 'object') {
      const record = value as Record<string, unknown>;
      if (Object.hasOwn(record, '$pick')) {
        if (Object.keys(record).length !== 1 || !Array.isArray(record.$pick) || record.$pick.length === 0) throw new Error(`Use { "$pick": [choices] } at ${path}.`);
        return visit(f.helpers.arrayElement(record.$pick), `${path}.$pick`, depth + 1);
      }
      return Object.fromEntries(Object.entries(record).map(([k, v]) => [k, visit(v, `${path}.${k}`, depth + 1)]));
    }
    return value;
  }
  return Array.from({ length: count }, (_, i) => visit(blueprint, `$[${i}]`, 0));
}
