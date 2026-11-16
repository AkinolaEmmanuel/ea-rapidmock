# Owned-domain email service

Mailgun is the first inbound adapter. RapidMock owns address allocation, installation authentication, message retention, and the inbox API. SQLite persists data on a single server; no Mailgun API key is needed in the extension or backend. The HTTP webhook signing key stays on the server.

## Local setup

Requires Node.js **24+** for the built-in `node:sqlite` module. SQLite may emit an experimental-feature warning on supported Node releases.

1. Copy `.env.example` to `.env` in the repository root.
2. Set `MAIL_DOMAIN` to a dedicated receiving subdomain, such as `inbox.yourdomain.com`.
3. Set `ENROLLMENT_CODE` to a long random invitation secret. This is for invited installations, not a public signup endpoint.
4. Set `MAILGUN_WEBHOOK_SIGNING_KEY` to Mailgun's HTTP Webhook Signing Key. Example placeholder secrets are rejected.
5. Run `npm run server`. Default listen address: `http://127.0.0.1:8787`.
6. In the installed extension, connect the service URL and invitation code. Enabling a mailbox allocates a receiving address and updates the active identity. Test-only identities do not contact this service.

Domain configuration and public HTTPS hosting are required for real inbound delivery. A local server alone cannot receive Mailgun webhook requests.

## Mailgun setup

Use a **dedicated subdomain** so receiving settings do not replace existing business-email MX records. Add and verify the receiving domain in Mailgun. Apply the MX records shown for your Mailgun region and domain.

Configure an inbound route matching recipients at that exact subdomain, for example:

```text
match_recipient(".*@inbox.yourdomain.com")
forward("https://mail-api.yourdomain.com/webhooks/mailgun")
stop()
```

Use the normal `forward()` form delivery (`multipart/form-data` or `application/x-www-form-urlencoded`), not JSON event webhooks or MIME-only delivery. RapidMock verifies top-level `timestamp`, `token`, and `signature` fields using HMAC-SHA256 over timestamp + token, rejects stale signatures, and deduplicates deliveries. Only allocated, unexpired recipients are stored. This endpoint does not provision mailboxes from incoming email.

Provider references: [Route delivery fields](https://documentation.mailgun.com/docs/mailgun/user-manual/receive-forward-store/receive-http), [Webhook verification](https://documentation.mailgun.com/docs/mailgun/user-manual/webhooks/securing-webhooks), [Receiving-domain DNS](https://documentation.mailgun.com/docs/mailgun/user-manual/domains/domains-verify).

## Deployment

An optional [Dockerfile](Dockerfile) and [Compose configuration](../compose.yaml) are included. Configure the root `.env`, then run `docker compose up --build -d`. The container runs as a non-root user and publishes only to host loopback; put your HTTPS reverse proxy in front of port 8787. The named volume persists SQLite data. Docker artifacts have not been built or deployed in this session.

- Run one service process behind an HTTPS reverse proxy. Keep its Node listener on loopback. Bind to another interface only inside an intentionally configured private/container network.
- Mount `DATABASE_PATH` on persistent storage. Protect and back up the volume; it contains plain-text inbox messages and hashed installation tokens. Restrict access to `.env`. Do not ship either in extension builds.
- Keep the proxy request-body cap at 1 MB or lower. Node also bounds bodies and request time. Attachments are not stored; oversized deliveries return 413.
- Cleanup runs every minute and before API requests. Default mailbox/message lifetime is 60 minutes, configurable from 15 minutes to 24 hours. Provider-side retention is separate and must be configured in Mailgun.
- Each installation gets its own random bearer token; only its hash is stored server-side. Mailbox and message queries enforce ownership. Extension credentials are local to trusted extension contexts and omitted from identity exports.
- Invitation attempts and API calls are limited. Provisioning is capped at 20 active mailboxes and 20 allocations/hour per installation. In-memory request limits assume one service process. Add shared rate limiting and your own account/login system before a public rollout.
- Keep the service private to invited users for this release. This implementation is not a complete public SaaS authentication, billing, or administration system.
- Disconnect removes local access; reconnect creates a new installation. Operator-managed token recovery/revocation and multi-device account login are future additions.

## API

| Endpoint | Authentication | Purpose |
| --- | --- | --- |
| `GET /health` | None | Service health and receiving domain |
| `POST /v1/installations` | Invitation code in JSON body | Enroll a browser installation |
| `POST /v1/mailboxes` | Installation bearer token | Allocate/retrieve identity mailbox |
| `GET /v1/mailboxes` | Installation bearer token | List active owned mailboxes |
| `GET /v1/mailboxes/:id/messages` | Installation bearer token | Inbox summaries |
| `GET /v1/mailboxes/:id/messages/:messageId` | Installation bearer token | Plain-text message |
| `DELETE /v1/mailboxes/:id` | Installation bearer token | Delete mailbox and its messages |
| `POST /webhooks/mailgun` | Mailgun signature | Receive a routed message |

Bodies use JSON except Mailgun deliveries. Responses and inbox data are not cacheable. The extension polls only while its inbox panel is visible, every 15 seconds. It renders plain text and never loads email HTML, remote images, or scripts.

## Validation status

Automated tests simulate signed multipart delivery through the real service handler, ownership isolation, duplicate delivery, expiry, deletion, and allocation limits. Real DNS routing, provider delivery, public hosting, and the installed Chrome inbox still need validation once the domain and credentials are configured. No external account, DNS record, hosting service, or mailbox has been created by this implementation.
