# EA RapidMock

A local-first Chrome side-panel extension for test identities, controlled form filling, and reproducible JSON datasets.

## Develop and install

Requires Node.js 24+ (including the owned-domain mailbox backend and its tests).

```sh
npm install
npm run check
npm test
npm run build
```

1. Open `chrome://extensions` and enable **Developer mode**.
2. Choose **Load unpacked** and select this project's `dist` directory.
3. Open a regular website, then click EA RapidMock's toolbar icon to open the side panel.
4. Click **Generate for this page** (new identity) or **Preview fields** (keep the current identity). Allow Chrome's access request for that site. Review and edit the detected values, then fill selected fields.
5. Undo restores native fields that have not subsequently been edited. Custom dropdowns can restore an existing choice; initially empty custom dropdowns must be reset manually.

When upgrading, reload EA RapidMock in `chrome://extensions`, accept any permission update Chrome presents, close and reopen its side panel, and refresh the target page. The generated build is version **0.6.0**.

The workspace has four screens: **Identity**, **Inbox**, **JSON**, and **Settings**. Identity leads with the current profile and a page preview that keeps that profile intact; fresh-profile generation is a separate action. Inbox shows mail IDs without domains and retains its connection across navigation. Settings holds persistent locale/fill preferences and mailbox access. Inbox polling and countdown updates pause outside the Inbox screen. JSON blueprints and output stay in place when switching screens.

`npm run dev` opens a browser-preview server. Form filling requires the installed extension. Chrome internal pages and the Web Store do not permit injection. File pages also require **Allow access to file URLs** in extension details. This version scans the top document, same-origin iframes, open shadow roots, native text/number/date controls, and supported custom dropdowns. Cross-origin frames are reported with instructions to open their page directly. Closed shadow roots and arbitrary custom widgets are not supported. Framework integration still needs live Chrome verification.

Field suggestions use labels, accessible labels, autocomplete attributes, names, placeholders, input constraints, and available dropdown options. Uncertain matches are editable and unchecked. Test password suggestions are masked and unchecked until explicitly selected. Existing organisation-type buttons, radio choices, and consent controls are left unchanged. Registration identifiers and phone values are synthetic, not real registrations or reachable numbers.

Use **Remember this field as** in the preview to associate an unusual field with a generator (for example, Legal entity → company). Mappings are local, scoped to the site's origin and pathname, and store generator types rather than literal values. New identities produce fresh values through saved mappings. Choose **Auto-detect** to remove a mapping. Query strings and fragments are excluded from mapping scope.

The attention report explains protected controls, existing values, disabled fields, unavailable dropdowns, inaccessible frames, and changes made since preview. After filling, a short readback checks whether controlled inputs retained their values and whether native browser validation reports an error. Application-specific errors and asynchronous server validation still require review on the page.

Fill and undo target the document and URL that produced their preview, including route changes in single-page apps. Validation errors are returned explicitly across Chrome's script boundary. If custom controls fail after native fields were written, the report preserves partial results and undo; failed readback is reported as unverified rather than accepted.

The extension requests optional access per site when previewing, including `http://localhost` on any port. The `tabs` permission lets the side panel identify the active site's URL before requesting access. Host grants can be removed in Chrome's extension site-access settings. No page contents are sent to a server.

## Optional mailboxes

Identities start with non-receiving `example.com` test addresses. Mailboxes are optional and use your own receiving domain and backend. The recommended deployment is now **Cloudflare Email Workers + D1**, configured for **inbox.polowo.store**. Follow the [Cloudflare setup guide](cloudflare/README.md). The alternative Node/SQLite + Mailgun implementation remains available in [backend setup](backend/README.md).

The default service is preconfigured. Enter the one-time access code and choose **Activate & create mailbox** for the first identity. Later identities need only **Enable mailbox & replace email**. A custom service URL is available under Advanced service settings. The action replaces the identity's test email with a receiving address. Inbox messages are polled while the panel is visible, rendered as plain text, and include copyable verification-code candidates. Mailboxes expire automatically and can be deleted earlier. Saved mailbox identities let you return to previous inboxes. Identity exports never include the service bearer token or invitation code.

Mailbox requests run directly in the trusted side panel, so they do not depend on a background message receiver. After an extension update, close the old side panel and reopen it to replace its invalidated context.

The compact inbox offers Copy email, Refresh, New address, an expiry countdown, and verification-code candidates in the message list. More contains Clear messages, Delete mailbox, and connection settings. Clearing preserves the address; replacing an address retires the old inbox and deletes its messages. Destructive actions require confirmation. New Cloudflare addresses are 33 characters long (for example `m+k7p4n9x2q8az@inbox.polowo.store`); older inboxes keep their existing address until expiry or explicit replacement.

Both backend implementations and local integration tests are complete. The Cloudflare Worker, D1 database, invitation secret, and Email Routing rule are deployed. Connect the extension to **https://mail-api.polowo.store** using the invitation from private, git-ignored `.mailbox-invitation.txt`. Live API checks passed; a real incoming email and installed Chrome inbox remain to be verified. This release supports invited browser installations, with public account/login and administration still to follow.

## Data generation

Blueprint strings such as `"{{string.uuid}}"` invoke an allowlisted generator. Other strings stay literal. Arrays remain arrays; `{"$pick":["active","pending"]}` selects a choice. Relative dates use a fixed reference of January 1, 2026. Reproducibility assumes the same locked dependency version, locale, seed, and blueprint.

Identities use correlated city/state/postal presets. Street addresses are synthetic. Nigerian phone values are deliberately non-routable placeholders, not validated subscriber numbers. Independently generated blueprint name/email fields do not share identity context.

Identity, mailbox identity history, service credentials, named blueprints, and field mappings are stored in Chrome local storage, restricted to trusted extension contexts (identity and blueprints use browser localStorage in preview). Form plans and undo history stay in the page's isolated extension context until navigation. Datasets are generated on demand and are not persisted. There are no analytics, remote scripts, or automatic form submissions. The optional backend handles mailbox allocation and inbox traffic; page contents stay local.

## Next milestones

- Manual Chrome validation across plain HTML, React, and Vue forms.
- Deploy and validate real owned-domain email delivery.
- Public account authentication, service administration, and installation recovery.
- Individual profile-field regeneration and expanded identity management.
- Worker-based large dataset generation, richer blueprint constraints, and accessible release assets.
