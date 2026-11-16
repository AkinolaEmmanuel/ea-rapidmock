# Reliability and mailbox validation — 0.6.0

Automated validation covers seeded generation, blueprint errors, native form constraints, changes after preview, undo, per-site access, saved mappings, accessible labels, same-origin iframe controls, and custom dropdowns.

React tests use real controlled components under jsdom. They confirm state updates, blur handlers, undo state, reporting of value normalization, and a dropdown whose options render through a React portal. These tests do not replace live Chrome extension validation.

## Live checks still required

The connected browser host was unavailable during implementation. No live extension installation, permissions prompt, or registration submission was automated.

1. Reload version 0.6.0 from `dist` in `chrome://extensions`; reopen the side panel.
2. Open `http://localhost:3000/register`. Click **Generate for this page** and allow localhost access.
3. Confirm company name, synthetic RC number, email, national phone, and available industry choices are detected. Existing organisation-type and representative choices must stay unchanged.
4. Select an industry in the preview, optionally check the test-password field, then fill. Confirm the page retains the values and displays expected validation feedback. Default test addresses cannot receive verification messages; explicitly enable a mailbox through a configured backend for that workflow.
5. Edit one filled value manually, then undo. Untouched native values should restore. The manually edited value should remain. The report should explain why an initially empty custom dropdown needs manual reset.
6. Change an unusual field's **Remember this field as** selection. Rescan and generate a new identity: the same mapping should produce a fresh corresponding value. Auto-detect removes the mapping.
7. Repeat on a second site and in a same-origin embedded form. A new site must request its own access. Cross-origin frames should produce a report instead of a silent omission.
8. Check plain HTML, Vue, and additional React controls. Custom widgets without supported semantics should be reviewed manually.
9. Preview a form, then navigate or change its SPA route. Fill must require a new preview. Invalid edited values must show the field's useful validation message. Failed custom controls must not hide changes already made to native fields.

Forms are never submitted automatically. Submitting a registration, testing email delivery, and server-side validation are outside these completed checks.

## Mailbox validation

Automated tests cover signed multipart delivery, invitation checks, isolation between installations, duplicate delivery, expiry, deletion, provisioning limits, verification-code extraction, endpoint validation, and credential handling. An additional integration test starts the actual HTTP server with a temporary SQLite database, enrolls an installation, provisions an address, posts signed form-encoded mail, and retrieves it through the authenticated inbox API. No real provider account or mailbox is used in these tests.

After [backend setup](backend/README.md), manually validate: connect from Chrome; enable a mailbox; confirm the identity email changes; submit a signup on a test app; receive its real verification email; copy a code; reload the panel; switch to a saved mailbox identity; expire/delete an inbox. Confirm default test identities still work with the service disconnected.

## Cloudflare validation

The Worker deployment dry-run passed. Tests cover the existing extension API contract, D1 SQL, multipart MIME parsing, installation isolation, duplicate delivery, unknown/oversized recipient rejection, expiry cleanup, deletion, and concurrent allocation limits. A separate smoke check passed against Wrangler's actual local runtime and D1, including simulated inbound email. Live Cloudflare deployment and real SMTP delivery still require the account/DNS steps in [the Cloudflare guide](cloudflare/README.md).

Update: Cloudflare deployment is complete at `https://mail-api.polowo.store`. Live health, invitation enrollment, allocation, inbox access, and temporary mailbox deletion passed. The receiving route and plus-addressing setting were verified through Cloudflare. Real SMTP delivery and the installed Chrome inbox are the remaining end-to-end checks.

The user subsequently confirmed receiving real mail in the extension. Version 0.5.0 adds short aliases, collision retries, ownership-checked message deletion and inbox clearing. React tests confirm clear/replace/delete actions wait for confirmation, and that clearing preserves the current identity/address. Live check also covers clearing an isolated empty test inbox and retaining its address. Existing user messages are never deleted by automated checks.

Version 0.6.0 reorganizes the interface into four screens with consistent inline SVG icons, compact typography, responsive spacing, visible focus states, and reduced-motion support. App-level tests verify navigation preserves the profile, inbox connection and JSON blueprint; the hidden inbox does not start polling; preferences persist; and copy uses a full address while display uses only a mail ID. The browser automation host remained unavailable for a visual screenshot review. Manually check the four screens at typical Chrome side-panel widths, including 320 px, before store submission.
