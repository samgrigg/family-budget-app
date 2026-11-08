# Task 6 — ongoing Transactions integration

This is a scoped continuation of the existing guided workflow, not a new product or questionnaire. The owner request is: “Yeah, lets do connections now. But I do like the CSV idea for later”. The approved accounts/history design and task-6-brief.md define this increment. CSV and older-history replacement remain separate future work (Task 7 owns replacement). The app's derived Income Overview is local transaction analysis, not the paid Plaid Income product.

## Decisions made

- Transactions only; no new products or separately billed refresh/recurring APIs.
- Controller approved POST /api/data-sources/:id/link-token with action repair or select_accounts, and POST /api/data-sources/:id/authorization-complete. Both use existing app session/same-origin/CSRF protection.
- The existing access token stays server-only. Repair/update mode omits products and transaction initialization parameters. Shared-account review alone sets update.account_selection_enabled=true. Success verifies /accounts/get for the same Item and syncs the existing source/cursor; it never exchanges a public token.
- Discriminated local OAuth session context retains action, source, environment, expiry and Link token for OAuth; after success, only the verification context remains. Public tokens are never persisted. Cancellation clears local context and does not claim to undo bank-side consent changes.
- Schema 5 adds source_account_access, preserving all historical mappings, canonical IDs, events and decisions. No live data migration was performed.
- Only verified provider institution IDs bind aliases. Owner institution names and source nicknames are retained; existing verified group names win consolidation and old rows remain provenance.

## Guidance reviewed

Consulted build_guidance implement and accept for Transactions/web before changing provider code. Applied GUIDE-001/002/003/004/006/014/017/020, DATA-001/002/003/004/007, ITEM-002/003/004/006 and TXN cursor/pagination rules to this increment. Existing REST provider uses documented Plaid endpoints; no installed Plaid SDK or invented SDK shape. No keys, live credentials, bank permissions or paid add-ons were accessed.

Primary references reviewed:

- https://plaid.com/docs/link/update-mode/
- https://plaid.com/docs/link/oauth/
- https://developer.apple.com/design/human-interface-guidelines/feedback
- https://developer.apple.com/design/human-interface-guidelines/accessibility
- https://developer.apple.com/design/human-interface-guidelines/buttons

## Acceptance evidence and outstanding human tasks

Observed: 110/110 synthetic tests in 19 files pass; typecheck passes; isolated Vite build passes at /tmp/budget-accounts-build. New endpoints answered real HTTP requests through temporary Supertest listeners with stub providers and in-memory databases. No served dist or running backend was changed.

build_check_acceptance returned FAIL: 7 checklist item(s) failed, 0 unreported. CHECK-001/002/003/004/005/011/013/015 passed with scoped observed code/stub evidence. CHECK-006/007/008/009/010/012/014 failed, explicitly:

- TASK-6-WEBHOOK (unverified/unimplemented baseline): verified webhook receiver, idempotence, out-of-order handling and webhook-driven freshness are absent. Bounded polling/manual sync remains; this worker did not fabricate owner acceptance of polling as a stopgap.
- TASK-6-DASHBOARD (unverified): exact live OAuth redirect registration/product settings were not inspected. Redirect forwarding is stub-tested only.
- TASK-6-SANDBOX (unverified): no live Sandbox Link/OAuth/exchange/product journey was performed; user credentials/permissions were out of scope.
- TASK-6-UI (unverified): controller must exercise browser Link stubs, cancellation, OAuth return, failed verification/retry, phone widths, text enlargement and keyboard. VoiceOver was not exercised. No accessibility conformance claim.

No overall Plaid acceptance or live integration completion is claimed. See task-6-report.md for RED/GREEN commands, APIs and Task 7 contracts.
