# Paycheck review: proposed UX and data design

Status: draft for owner review; no app implementation yet.
Basis: [agreed use case](2026-11-08-paycheck-review-use-case.md).

## Current UX gaps

| Review task | Existing support | Missing behavior |
| --- | --- | --- |
| Identify the arrived paycheck | Income sources and deposit history in `web/IncomeReview.tsx`, `server/income.ts` | Select one actual deposit and retain its review |
| Cover commitments before replenishment | Plans, payment records, and estimates in `server/bill-plan.ts` | Confirm funding account and actual due occurrences within the review horizon |
| Cover last card statement | Card repayment classification and payment evidence | Statement obligation, unpaid amount, due date, and funding coverage |
| Reserve for later card purchases | Imported card transactions | Confirmed statement boundaries and reservations shared between reviews |
| Coordinate two paychecks | Canonical accounts and institution identities | Explicit current/future contributions with globally enforced capacity |
| Explain safe to spend | Separate income and bill overviews | Paycheck-specific calculation, uncertainty, and persisted review |

Evidence is source inspection, not a live-data or browser audit. Existing
monthly estimates are not actual due dates; account labels in bill plans
do not establish canonical bank-account links.

## Recommended interaction

Make Paycheck Review the default destination, retaining explicit links to
Budget, Accounts, and existing analysis screens. Use one page with sections
and expandable details. A multi-screen wizard would hide the interaction
between commitments and card funding; a summary-only dashboard would leave
the owner assembling allocations elsewhere.

### Start or resume

Show the two income sources with their most recent deposit and saved review
state. Select an actual posted paycheck, not an average monthly income.
The owner confirms the source's next payday. History may suggest it, but
does not silently establish it. Select canonical funding accounts once;
institution/employer names alone do not identify accounts.

### Review this paycheck

Keep the selected employer, account, deposited amount, and next payday at
the top. Display safe to spend and a plain-language review status. Initially
show "Needs information" when material inputs are absent.

1. **Before your next paycheck:** list predictable obligations with amount,
   due date, payment account, paid status, and this paycheck's reservation.
   Reuse confirmed plans as suggestions. Unknown amount, date, or funding
   account requires confirmation, rather than silently excluding the bill.
   Include overdue unpaid obligations; propose reserving for obligations
   due on payday too unless deposit-before-payment timing is confirmed.
2. **Credit cards:** each card shows last statement unpaid and due date,
   later purchases already made, cash reserved from each source, and the
   remaining gap. Allocate this paycheck's cash explicitly, showing its
   effect on safe to spend immediately. Prioritize payments due sooner.
3. **Future funding, when needed:** expand to assign a named future paycheck
   and amount only if current cash cannot cover existing purchases. Show
   "Relies on a future paycheck" and its effect on that paycheck's capacity.
   A future contribution cannot produce a "cash covered" status.
4. **Finish review:** summarize current reservations, payment shortfalls,
   future reliance, and unassigned card spending. Save without pretending
   a reservation is a bank transfer or completed payment. Incomplete reviews
   remain resumable with specific missing-information links.

At the next payday, retain previous reservations against their obligations.
Only the unreserved remainder of the old paycheck becomes a separately
identified leftover; reserved cash must not be swept into the goal amount.
No actual transfer or goal-management feature is included.

## Calculation and accounting boundaries

Use currency-specific integer minor units and validated decimal inputs;
never combine currencies or use binary floating-point for this calculation.

For a received paycheck, budget capacity is the actual deposit less direct
cash spending assigned to it and reservations still outstanding. Consumed
reservations become recorded payments, not another deduction in addition
to that same reservation. Safe to spend is the nonnegative remainder after
required reservations. Present a separate deficit when capacity is exceeded.

Unallocated incurred card obligations cannot be hidden by choosing a smaller
contribution. The review remains incomplete until each is cash-backed or
explicitly assigned to eligible future funding. Suppress a definitive safe
to spend claim while material incurred spending is unassigned or unknown.

Card purchases create obligations; repayments settle them. A bank debit and
its card credit are one repayment. Transfers between household accounts
move funding, not income or spending. Require explicit evidence or an owner
confirmation for ambiguous matches. Refunds, fees, and interest require
reconciliation; negative transactions are not automatically repayments.

Future capacity equals its owner-confirmed expected paycheck amount less
its predictable commitments and existing assignments. It is a forecast,
never current cash. Reject over-allocation across cards and reviews.
Unknown future commitments/amounts prevent a definitive coverage claim.

Payment shortfall means insufficient eligible funding by the required
payment date. Later purchases with insufficient current reservations instead
show future reliance or uncovered future spending. Date eligibility must
include the owner-confirmed payment route and funding-needed-by date;
do not invent a universal bank-transfer delay.

## Proposed data and responsibility boundaries

- Funding source: owner-confirmed employer and canonical account mapping.
- Paycheck: actual canonical deposit reference or explicitly planned future
  amount/date, source, currency, and confirmed review horizon.
- Commitment occurrence: plan reference, confirmed due date, amount basis,
  payment account, and linked settlement; distinct from a monthly estimate.
- Card obligation: canonical card, statement identifier/boundary, due date,
  original amount, payments/adjustments, provenance, and freshness.
- Funding contribution: paycheck, obligation, amount, cash/future state,
  payment route, and funding-needed-by date.
- Review: selected paycheck, saved input revisions, completion state, and
  links to the shared allocations. A saved summary is not authoritative
  after underlying evidence changes; reopen affected reviews for checking.

Use focused new modules for these records, projection logic, API, and review
UI rather than adding financial calculations to `web/App.tsx`. Reuse the
existing canonical account/transaction repository, environment isolation,
CSRF protection, plan evidence, and system styles. Save allocations in one
SQLite transaction with revision checks so stale edits cannot over-promise
cash. Refresh projections on new transactions, statement changes, and saves.
No writes to provider transaction records or real payment initiation.

## Bank-data proposal

Owner confirmed ongoing transactions and credit card liabilities, with no
identity/income verification or investment holdings. Keep Transactions as
the core product; add consent for Liabilities without making it a required
product for every linked institution. Existing connections may require
additional consent; do not assume Dashboard entitlement grants Item consent.

Use liability statement fields where supported, preserving provenance and
retrieval time. Null fields remain unknown. Provide owner-confirmed manual
statement amount, closing boundary, due date, and adjustments when absent.
An imported original statement balance is not necessarily its unpaid balance.
Do not derive the next statement by subtracting unrelated cached snapshots.
Reconcile transactions and statements before declaring coverage.

Dashboard inspection found configured Transactions/Liabilities access in
Sandbox and production for US and CA; no live Item support was tested.
Only an HTTP localhost redirect and no webhook receiver were configured.
Existing local-only architecture needs explicit refresh and age indicators;
mobile OAuth and webhook hosting are separate deployment decisions.

## UI baseline and verification

Preserve the sparse mobile-first web UI. Use native semantic controls,
visible focus, labeled amounts/dates, 44px targets, wrapping sections, safe
areas, relative system typography, and browser zoom. Explain statuses with
words, not color alone. Prefer disclosure over dense tables on phones.
Browser controls are an intentional web adaptation of HIG guidance.

Current HIG layout, writing, and accessibility URLs were consulted, but the
research tool exposed JavaScript shells and could not fetch their Markdown
content. Complete the current-content HIG review before implementing UI.
No browser, keyboard, enlarged-text, or VoiceOver conformance is claimed.

Acceptance must cover both paycheck sources, split payments, unknown inputs,
future arrival after due date, payment processing deadlines, stale concurrent
edits, pending-to-posted changes, and refund/payment reconciliation.

Example fixtures (synthetic): $2,000 paycheck, $800 direct commitments,
$500 due card reservation, and $400 later-purchase reservation leaves $300
safe to spend. If the later-purchase amount is $900 instead, reserve $700
now, show $0 safe to spend and $200 future reliance if eligible funding is
explicitly assigned; do not call that $200 a payment shortfall. If the due
card amount is $1,400 and no other funding arrives in time, show a $200
payment shortfall after the $800 direct commitments. A later posted payment
consumes its reservation without reducing safe to spend twice.

## Delivery order after design approval

1. Add the shared funding model and calculation tests using synthetic data.
2. Add saved review APIs, validation, environment isolation, and revisions.
3. Build the complete manual-confirmation review using existing transactions
   and plans, including shared funding and resumable incomplete states.
4. Add Liabilities as an input source, retaining the same confirmation flow.
5. Verify the complete review on narrow screens, keyboard, large text, and
   VoiceOver; document unverified checks and commit logical changes.

The implementation plan follows owner review of this draft. In particular,
the proposed manual statement fallback, default destination, payday boundary,
and incomplete-result behavior have not yet been approved as UI decisions.
