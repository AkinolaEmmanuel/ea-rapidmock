// Uses Wrangler's existing OAuth login in memory; never prints the credential.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const authPath = join(process.env.APPDATA, 'xdg.config', '.wrangler', 'config', 'default.toml');
const token = /oauth_token\s*=\s*"([^"]+)"/.exec(readFileSync(authPath, 'utf8'))?.[1];
if (!token) throw new Error('Run wrangler login first.');
const zoneId = 'e0f05e345c954a8921586729d95f7832';
async function api(path, method = 'GET', body) {
  const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const result = await response.json();
  if (!result.success) throw new Error(`Cloudflare request failed (${response.status}): ${(result.errors || []).map(e => `${e.code}: ${e.message}`).join('; ')}`);
  return result.result;
}
const zone = await api(`/zones/${zoneId}`);
if (zone.name !== 'polowo.store' || zone.account.id !== '59edd4f406cbce66ac8ceae727e1c783') throw new Error('Unexpected account or zone; stopped.');
let settings = await api(`/zones/${zoneId}/email/routing`);
if (!settings.support_subaddress) settings = await api(`/zones/${zoneId}/email/routing`, 'PATCH', { support_subaddress: true });
if (!settings.support_subaddress) throw new Error('Subaddressing could not be enabled.');
console.log('Verified polowo.store: email subaddressing enabled.');
const rules = await api(`/zones/${zoneId}/email/routing/rules`);
const expected = rules.find(rule => rule.enabled && rule.matchers?.some(m => m.value === 'receive@inbox.polowo.store') && rule.actions?.some(a => a.type === 'worker' && a.value?.includes('ea-rapidmock-mail')));
if (!expected) throw new Error('Receiving rule is not active yet.');
console.log('Verified receive@inbox.polowo.store routes to ea-rapidmock-mail.');
