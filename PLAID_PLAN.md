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
- [ ] Confirm the plan's concrete integration surface through execution
  selection (GUIDE-020); proposed paths are recorded in the implementation plan.
- [ ] Implement optional Liabilities ingestion, cached provenance, manual
  fallbacks, and field-level errors without changing existing transactions.
- [ ] Run acceptance on the actual changed code and verify Sandbox journeys.

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

Execution approach and the proposed concrete integration surface;
connected-card field coverage. The owner approved the manual fallback and
explicit-refresh approach as part of the design.
