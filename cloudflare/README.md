# Cloudflare deployment for inbox.polowo.store

The Worker receives email directly through Cloudflare Email Routing, stores messages in D1, and serves the API already used by the Chrome extension. It does not need Mailgun or a separate VPS.

## Current deployment

The Worker and D1 database are deployed in the authorized Cloudflare account. **Service URL: https://mail-api.polowo.store**. The literal rules `m@inbox.polowo.store` and legacy `receive@inbox.polowo.store` route to `ea-rapidmock-mail`, and zone subaddressing is enabled. New inbox addresses use a 12-character random base32 suffix: `m+abcdefghijkl@inbox.polowo.store` (33 characters total). The database checks uniqueness and retries collisions; inbox authentication still uses a separate 256-bit installation token. Existing addresses are not renamed. The invitation secret is configured on the Worker; its private local copy is in git-ignored `.mailbox-invitation.txt` at the repository root. Never commit or publish that file.

Live API validation passed for health, enrollment, address allocation, authenticated inbox access, and deletion of the temporary test mailbox. Real SMTP delivery and the installed extension inbox still need an end-to-end check. The setup below is a reference; this workspace already has its D1 ID and custom API hostname configured. Do not create a duplicate database for the existing deployment.

## 1. Move DNS management to Cloudflare

The read-only DNS check during implementation returned `launch1.spaceship.net` and `launch2.spaceship.net` for `polowo.store`. `inbox.polowo.store` did not yet resolve. Check the current state before changing anything.

1. Add **polowo.store** (the root domain) to your Cloudflare account and choose the Free plan.
2. Review Cloudflare's imported DNS records against the records at Spaceship. Preserve every record needed by the website, existing mail, and verification services. Cloudflare's automatic scan may not discover all records.
3. At Spaceship, replace the domain's nameservers with the exact two nameservers Cloudflare assigns to your zone.
4. Wait until Cloudflare reports the zone as Active. Domain registration can stay at Spaceship.

Do not replace the root domain's existing mail MX records to set up RapidMock. Email receiving will be configured specifically for **inbox.polowo.store**.

## 2. Create the D1 database

From this repository, run:

```sh
npx wrangler login
npm run cf:db:create
```

Copy the returned database UUID into `database_id` in [wrangler.toml](../wrangler.toml), replacing `REPLACE_WITH_D1_DATABASE_ID`. Confirm Wrangler is using the intended Cloudflare account. The config already sets `MAIL_DOMAIN = "inbox.polowo.store"`.

Apply the schema to the cloud database:

```sh
npm run cf:db:remote
```

## 3. Set the invitation secret and deploy

```sh
npx wrangler secret put ENROLLMENT_CODE
npm run cf:deploy
```

Enter a new random secret of at least 24 characters at Wrangler's prompt. Keep it private and provide it only to invited users. Do not use the local smoke-test invitation or commit secrets to configuration files.

Save the HTTPS `workers.dev` URL printed by deployment. It is the extension's **Service URL**. A custom API hostname is optional; it can be added later. This API hostname is separate from the receiving domain.

## 4. Enable subdomain receiving and send email to the Worker

In the Cloudflare dashboard for **polowo.store**, open Email Service → Email Routing. Under Settings → Subdomains, add **inbox.polowo.store**. Apply the exact DNS records Cloudflare provides for this subdomain.

The Wrangler config manages a literal Email Routing rule for **m@inbox.polowo.store**, with action **Send to a Worker**, choosing **ea-rapidmock-mail**. It retains **receive@inbox.polowo.store** for older inboxes. Enable **Subaddressing** in Email Routing → Settings. The Worker allocates unique aliases such as `m+k7p4n9x2q8az@inbox.polowo.store`. Cloudflare matches them to the base rule and preserves the full recipient in `message.to`, which the Worker uses to identify the mailbox.

Cloudflare's catch-all is supported on apex domains only, not on Email Routing subdomains. Do not configure a nonexistent subdomain catch-all. If a test application rejects plus-addressing, use the alternative Mailgun backend for plain random addresses, or separately evaluate an owned root domain dedicated to the inbox service.

Cloudflare may request verification of a destination address during Email Routing onboarding. Complete its account setup prompts if needed; the Worker itself stores incoming messages in D1 and does not forward them to that destination.

Do not route messages into a personal inbox as the storage mechanism. No forwarding destination is used by this application's email handler.

Official guides: [Add a subdomain](https://developers.cloudflare.com/email-service/configuration/subdomains/), [Routing rules and subaddressing](https://developers.cloudflare.com/email-service/configuration/email-routing-addresses/), [Email Worker handler](https://developers.cloudflare.com/email-service/api/route-emails/email-handler/).

## 5. Connect and verify

1. Reload the extension from `dist` in Chrome.
2. Enter the deployed Worker HTTPS URL and your invitation code in the mailbox settings. Allow access to that API host when Chrome asks.
3. Click **Enable mailbox & replace email**. The identity receives an address such as `m+k7p4n9x2q8az@inbox.polowo.store`.
4. Send a real message to that exact allocated address. The panel polls every 15 seconds while visible. Verify the message, its body, and a verification-code candidate.
5. Test expiry and deletion. Test-only identities should continue to work with the service disconnected.

This deployment is now complete. The domain's receiving MX records were verified, and the Worker, D1 schema, invitation secret, custom API hostname, receiving rule, and subaddressing setting were configured. Keep existing root-domain DNS and unrelated routing rules intact during future changes.

## Local checks

```sh
npm run cf:db:local
npm run cf:dev -- --port 8791 --var ENROLLMENT_CODE:local-test-invitation-only-not-for-deployment
```

In another terminal:

```sh
node cloudflare/smoke.mjs
```

Alternatively copy root `.dev.vars.example` to root `.dev.vars`, set a local invitation, and run `npm run cf:dev`. Local secret values belong beside `wrangler.toml`, not inside the `cloudflare` directory.

`npm run cf:check` bundles the Worker without publishing. Unit tests exercise the D1 SQL through a SQLite-backed test adapter. A smoke check also passed against Wrangler's actual local runtime, covering installation enrollment, D1 allocation, simulated MIME delivery, inbox retrieval, and deletion. The simulated email endpoint exists only in local development.

## Operational boundaries

- API compatibility is preserved; the extension does not require provider-specific changes.
- D1 stores installation token hashes, random identity IDs, allocated addresses, rate-limit counters, and plain-text messages. HTML email is converted to text; attachments are not stored. Raw messages over 500 KB are rejected.
- Default retention is 60 minutes, configurable from 15 minutes to 24 hours. API reads and receiving check expiry immediately; scheduled cleanup runs every 15 minutes. D1 backups/Time Travel have separate retention from logical deletion.
- `DELETE /v1/mailboxes/:id/messages` clears messages while preserving the address; `DELETE /v1/mailboxes/:id/messages/:messageId` removes one owned message. The UI confirms deletion. New address explicitly retires the old inbox before allocating a replacement; if allocation fails, the old mailbox remains deleted and the identity is marked expired for retry.
- Quotas: 20 active mailboxes per installation; 20 allocation attempts/hour; 120 authenticated API calls/minute; 10 enrollment attempts/hour per Cloudflare-provided client IP. Limits live in D1 and apply across Worker instances. These are application limits, additional to Cloudflare's platform quotas.
- Use the primary D1 binding; read-replication/session routing has not been added. SQL indexes keep mailbox queries narrow.
- This is invite-only installation access. Public user accounts, installation recovery, account administration, and billing remain separate milestones.
- Free-tier CPU, request, storage, and database-operation allowances still apply. Review current Cloudflare pricing and usage; free hosting is not an unlimited-volume promise.
- No email contents or credentials are logged by this code; Worker observability is disabled in the config. Cloudflare's own security, routing, and platform retention remain governed by its settings and terms.
