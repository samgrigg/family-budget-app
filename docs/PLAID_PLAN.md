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

# Task 7 — twelve-month requests and resumable replacement

Controller approved the scoped API surface: prepare at POST /api/data-sources/:id/replacements; list at GET /api/source-replacements; operation actions under POST /api/source-replacements/:id/:action. Actions are revoke, link-token, exchange, sync, match-review, review, complete, cancel and resume. The existing workflow intake was not restarted.

New connections request Transactions only with transactions.days_requested=365. Store.connect records that value only for a new source; known legacy sources retain 90. Repair/update mode and analysis windows do not extend initial history. Official Link API and Plaid's three-month-history support article were reviewed before changing provider calls. No paid add-ons, CSV, live provider actions or additional products were introduced.

Replacement is durable and retains saved history through confirmed provider revocation, new Link, import, explicit account review and reconciliation. A distinct replacement OAuth context carries operation ID. Source locks are shared with repair/disconnect. Imported replacement records are quarantined from analytical history, including after failure or cancellation, until final completion. Confirmed account matches are sequential logged Task 5 links; classification choices apply on confirmation and cancellation retains them. Owner name/inclusion and canonical/chart identity are preserved. Final completion checks every imported account and active link plus readiness/overlaps, then releases quarantine and the new source preference atomically. Controller explicitly approved sequential logged linking after a failing multi-account transfer test exposed why batch review tokens cannot be replayed safely.

Guidance applied: GUIDE-001/002/003/004/006/010/013/014/015/020, DATA-001/002/003/004/007 and Transactions cursor/readiness rules. Provider REST shapes follow https://plaid.com/docs/api/link/ and the recreation constraint at https://support.plaid.com/hc/en-us/articles/24631662544919-Why-does-this-Item-include-only-three-months-of-transaction-history . There is no installed Plaid SDK. Twelve months requested does not guarantee twelve months supplied.

Observed verification: full synthetic suite 124/124 tests in 20 files passed; final focused replacement/session/account-request tests 21/21 passed after typed-interface/focus and operation-status refresh corrections; typecheck passed; isolated Vite build passed (45 modules, /tmp/budget-accounts-build). Temporary HTTP listeners exercised every new route. No real backend restart, served dist overwrite or real database migration occurred.

Final-code build_check_acceptance: FAIL, 7 failed and 0 unreported. CHECK-001/002/003/004/005/011/013/015 passed with scoped observed evidence. CHECK-006/007/008/009/010/012/014 remain failed: no verified/idempotent webhook receiver or accepted polling stopgap; exact Dashboard OAuth registration and live Sandbox flow unverified; browser Link/OAuth/cancellation/focus/phone-width/large-text/VoiceOver QA unverified. These are the existing human-task gaps, extended to the replacement UI; no overall Plaid or accessibility conformance is claimed. Detailed checks and state/API contracts are in task-7-acceptance.json and task-7-report.md.
