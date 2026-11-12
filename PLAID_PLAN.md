# Paycheck review bank-data workflow

## Goal

"ok go ahead with the next steps" following the agreed paycheck-review
use case. Workflow: `wf_a59f9223dd514eca`, round 0, design preparation.
Existing integration notes remain in `docs/PLAID_PLAN.md`.

## Scope

- Transactions: ongoing deposit, purchase, and payment activity.
- Liabilities: credit card statement information and payment due dates.
- Owner confirmed both data needs and no verification requirements.
- Investment holdings excluded by explicit owner choice. No new Auth,
  Transfer, Identity, Income, Balance-refresh, or Statements PDF product.
- Recurring Transactions is an add-later candidate; use current owner-reviewed
  commitments rather than introducing another discovery service now.
- Platform: Local React/TypeScript web app with Node and SQLite.
- New integration behavior will be verified in Sandbox before production;
  the existing local production configuration has not been changed.

## Proposed integration choices

Keep Transactions required; place Liabilities in
`additional_consented_products` and retrieve it only for eligible credit
Items after consent (LIAB-007/008, CONV-001/002). Preserve nullability and
freshness; Liabilities does not supply card transaction history
(LIAB-002/004/005). Existing Items may need update-mode consent.
Product selection follows owner-confirmed scope rather than adding
investment holdings (SELECT-011). No provider code has changed.

## Dashboard evidence and human tasks

Read-only inspection on 2026-11-08: all six Dashboard sections succeeded.
Production and Sandbox authorized; Transactions and Liabilities configured
in production for US and CA. No trials. Default Link customization exists;
no Layer template, Android package, or webhook receiver. Only redirect:
`http://localhost:3000/`. Entitlement does not prove institution coverage.

| Task | Why it matters | Where | State |
| --- | --- | --- | --- |
| Review additional card-data consent if requested | Existing Item consent may lack Liabilities | App Link update flow once implemented | deferred |
| Register HTTPS redirect before mobile OAuth work | Current HTTP registration does not establish mobile production OAuth readiness | https://dashboard.plaid.com | deferred |

Local-only deployment has no public webhook receiver; do not add a public
tunnel to solve this implicitly. Confirm refresh expectations in the design.

## Implementation checklist

- [x] Confirm data needs and inspect Dashboard configuration.
- [x] Consult scope and implementation guidance.
- [x] Obtain owner approval of the review design ("yes that looks good").
- [x] Write the detailed implementation plan after design approval.
- [x] Confirm the plan's concrete integration surface through execution
  selection (GUIDE-020); proposed paths are recorded in the implementation plan.
- [x] Implement optional Liabilities ingestion, cached provenance, manual
  fallbacks, and field-level errors without changing existing transactions.
- [x] Run acceptance on the actual changed code; record failed checks.
- [ ] Verify the live Sandbox journeys listed below.

## Acceptance

Round 0: design only. No implementation acceptance or live Item check run.

## Maintenance

Consult Plaid MCP `build_guidance` before changing Plaid-facing code and
`build_check_acceptance` before reporting such changes as working. Acceptance
applies only to the exact code checked.

## How to test

No new behavior exists yet. Planned tests will use synthetic statement and
transaction fixtures, then Sandbox to verify missing fields, consent, eligible
Items, and unsupported cards. No live bank call or paid product initialization
was performed during this design work.

## Decisions made

The owner chose the guided workflow, confirmed no verification requirements,
and selected "Ongoing transactions and credit card liabilities". The separate
review-model requirement was waived for this round. No payment initiation.

## Open questions

Connected-card field coverage and the live/accessibility verification listed
below. Execution is inline and the implemented surface is recorded below. The owner approved the manual fallback and
explicit-refresh approach as part of the design.

## Implementation and scoped acceptance — 2026-11-08

Implemented on `codex/paycheck-review` in the existing checkout, selected by
owner: "New branch in this checkout". Owner selected inline execution:
"Lets stay in this chat, yeah". Concrete surfaces are now:

- GET/POST `/api/paycheck-review`: local ledger/evidence and bounded change
  commands with shared revision validation.
- POST `/api/paycheck-review/card-data/:sourceId/refresh`: explicit cached
  card refresh, guarded by the app's existing session/origin/CSRF checks.
- Existing `/api/data-sources/:id/link-token` accepts action `card_data`;
  existing authorization-complete verifies the same source. No separate
  OAuth context or public-token exchange was added for update mode.

Applied LIAB-002/004/005/007/008 and the minimal-product consent rules:
Transactions required, Liabilities additionally consented for new/replacement
Link; repair and account-selection behavior remain separate. Null fields and
failed refreshes keep manual fallback available. `/item/get` checks consent
before `/liabilities/get`. Deposit-only Items are skipped. Provider credentials
remain server-only. No live product was initialized during this work.

Observed: 208 synthetic JS tests, one Python test, typecheck, isolated build
pass. Synthetic in-memory browser review booted and completed; API tests
exercised read/save and explicit card-refresh HTTP routes. No .env or real
financial database was read. Official HIG Markdown for accessibility,
typography, layout, buttons, color and writing was fetched and relevant
sections reviewed after overcoming the initial JavaScript-shell limitation.

Exact-code Plaid acceptance returned **FAIL: 7 failed, 0 unreported**.
CHECK-001/002/003/004/005/013/014/015 have scoped evidence.
CHECK-006/007/008/009/010/011/012 remain failed: no verified public webhook
receiver/idempotent webhook handling; live mobile/production redirect journey
and Sandbox consent/product journey untested; full human-task completion and
all-journey acceptance unavailable. The approved local explicit-refresh
approach is a stopgap, not a webhook implementation. No overall integration
acceptance is claimed.

| Task | Why it matters | Where | State |
| --- | --- | --- | --- |
| Exercise isolated Sandbox card consent and statement retrieval | Stubs do not prove institution coverage or real consent behavior | Local Sandbox app and Plaid Sandbox | needs_human |
| Verify mobile HTTPS OAuth before mobile deployment | Current desktop HTTP/popup configuration does not prove mobile flow | Plaid Dashboard redirect URIs | needs_human |
| Add a verified idempotent webhook receiver before hosted freshness claims | Local explicit refresh does not provide webhook-driven freshness | Future hosted backend and Plaid Dashboard | deferred |
| Verify VoiceOver and enlarged text | Browser and rendered tests do not establish accessibility conformance | Local browser/device | needs_human |

Primary references consulted: https://plaid.com/docs/link/update-mode/ ,
https://plaid.com/docs/api/products/liabilities/ , and
https://developer.apple.com/design/human-interface-guidelines/ .

## 2026-11-11 Accounts/Admin balance display

Owner approved a balance-first Accounts page and moving configuration into Admin.
Retain cached `/accounts/get` values already fetched by the existing sync; no new
product or paid live refresh call (BAL-001/002/004/006/008, CONV-001).
GUIDE-001/002/003: secrets stay in the existing server integration; only safe
balance snapshots are returned to the browser. GUIDE-014: consulted current
implementation guidance and requested a fresh acceptance check. Existing Link,
OAuth and sync call sequencing remain unchanged. Schema v7 uses the existing
private backup workflow before upgrading stored databases.

Verification uses synthetic in-memory accounts, API tests and a local browser
preview. Live Sandbox Link/exchange and bank calls were not exercised in this
session (CHECK-008 is a verification gap). Large-text and VoiceOver checks are
also outstanding; see `docs/2026-11-11-accounts-admin.md`. Existing Dashboard and
public-webhook tasks above remain unchanged. No new polling or webhook behavior
was introduced; displayed balances are explicitly cached, retrieved on the
existing owner-triggered sync/import paths (not promised as live bank data).

Fresh acceptance review reported one failed check: CHECK-008, because a live
Sandbox Link/exchange/product run was not performed. All reported applicable
local checks passed; this is not a claim of end-to-end Plaid acceptance.
Final local verification: 221 tests across 40 files, TypeScript, production
build, and synthetic browser navigation at 320/390 CSS pixels passed.
