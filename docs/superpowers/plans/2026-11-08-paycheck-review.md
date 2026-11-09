# Paycheck Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Inline execution is the default recommendation; do not delegate without owner selection or an applicable instruction authorizing it. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Review each arrived paycheck, coordinate shared card funding, and explain what remains safe to spend.

**Architecture:** Add an environment-scoped funding ledger and a pure projection over canonical bank evidence. Build one resumable review page using manual confirmation first, then add optional Liabilities snapshots as suggestions through the same reconciliation path. Bank records remain authoritative evidence; review edits never mutate them or initiate payments.

**Tech Stack:** Existing React 19, TypeScript strict mode, Express 5, better-sqlite3, Vitest and Supertest; Node >=22.12. No new runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-11-08-paycheck-review-design.md`, approved 2026-11-08; read alongside `docs/superpowers/specs/2026-11-08-paycheck-review-use-case.md` and `PLAID_PLAN.md`.

## Global Constraints

- Future paychecks never increase safe to spend.
- Earlier paychecks' leftovers remain separate.
- Use currency-specific integer minor units and validated decimal inputs; never combine currencies or use binary floating-point for this calculation.
- No writes to provider transaction records or real payment initiation.
- Preserve the sparse mobile-first web UI.
- Preserve browser zoom, safe areas, relative typography, visible focus, and at least 44px controls. No accessibility conformance claim without actual checks.
- Validate all references within `store.env`. Never read local financial databases or credentials for tests; use in-memory Stores and synthetic fixtures.
- Consult current Plaid guidance before provider-facing changes; run exact-code acceptance before claiming they work. No production product initialization during this plan's automated tests.
- Commit completed verified tasks separately; inspect staged file list and diff. Commit first lines <=72 characters, immediately followed by the exact owner request `yes that looks good` on the next line. Do not push.

## Execution preparation

- [ ] Read the executing-plans and using-git-worktrees skills. Detect managed worktree/branch state before choosing isolation; preserve the owner's checkout and existing work. No worktree is created by this planning commit.
- [ ] Run `PATH=/opt/homebrew/bin:$PATH npm test` and `PATH=/opt/homebrew/bin:$PATH npm run typecheck` to establish the existing baseline. Record failures before changing code.
- [ ] Read current HIG accessibility, typography, layout, buttons, color, and writing content. Earlier web research returned JavaScript shells; use official Markdown content through a supported browser/fetch path. Record actual sections read and any remaining access limitation.

## File structure and shared contracts

New files:

- `shared/paycheckReview.ts`: serializable record, projection, and command types.
- `shared/reviewMoney.ts`: validated decimal/minor-unit conversion.
- `server/paycheck-projection.ts`: pure accounting and coverage rules.
- `server/paycheck-repository.ts`: ledger schema, atomic writes and revision control.
- `server/paycheck-evidence.ts`: canonical history/plan reconciliation.
- `server/paycheck-api.ts`: secured review endpoints.
- `server/card-liabilities.ts`: consent-aware refresh, persisted snapshots, and sanitized field mapping.
- `web/PaycheckReview.tsx`: load/save/start/resume controller.
- `web/ReviewCommitments.tsx`, `web/ReviewCards.tsx`, `web/ReviewSummary.tsx`: focused section controls, no duplicated financial calculations.
- `tests/paycheck-fixtures.ts`: synthetic records reused by the tests below.

Modify `server/app.ts` only to install the new API; `web/App.tsx` for routing
and navigation; `web/style.css` for wrapping review layout; `README.md` and
`PLAID_PLAN.md` for observed behavior and verification. Provider consent
changes use existing `server/accounts-api.ts`, `server/account-linking.ts`
or `server/source-replacements.ts` only after tracing the actual Link owner;
do not introduce a second OAuth-session mechanism.

Define these exact public exports before dependent tasks:

```ts
// shared/paycheckReview.ts
export type FundingSource = {
  id: string; name: string; accountId: string; incomeKey: string | null;
};
export type Paycheck = {
  id: string; sourceId: string; transactionId: string | null;
  state: "received" | "expected"; amountMinor: number; currency: string;
  date: string; nextPayday: string; commitmentsConfirmed: boolean;
};
export type Obligation = {
  id: string; kind: "commitment" | "statement" | "unbilled";
  name: string; accountId: string; fundingSourceId: string | null;
  planId: string | null; statementKey: string | null;
  amountMinor: number | null; currency: string;
  dueDate: string | null; neededBy: string | null;
  basis: "manual" | "plan" | "provider"; confirmed: boolean;
};
export type Contribution = {
  id: string; paycheckId: string; obligationId: string; amountMinor: number;
  paymentAccountId: string; neededBy: string;
};
export type Settlement = {
  id: string; obligationId: string | null; paycheckId: string;
  contributionId: string | null; amountMinor: number;
  transactionIds: string[]; confirmed: boolean;
};
export type Review = {
  paycheckId: string; completedAt: string | null; evidenceDigest: string;
};
export type ReviewLedger = {
  revision: number; sources: FundingSource[]; paychecks: Paycheck[];
  obligations: Obligation[]; contributions: Contribution[];
  settlements: Settlement[]; reviews: Review[];
};
export type ReviewProjection = {
  paycheckId: string; safeToSpendMinor: number | null;
  paymentShortfallMinor: number; futureRelianceMinor: number;
  unassignedCardMinor: number; leftoverMinor: number | null;
  issues: { code: string; recordId: string; message: string }[];
  obligationCoverage: {
    obligationId: string; cashMinor: number; futureMinor: number;
    paidMinor: number; uncoveredMinor: number | null;
  }[];
};
```

All numeric money fields must be nonnegative safe integers. Null means
unknown, never zero. Validate ISO calendar dates, positive horizons, supported
currency minor units, ID uniqueness and foreign keys. Initially support USD
as the review currency; preserve other-currency evidence and show an explicit
unsupported-currency issue rather than guessing conversion or decimal scale.

`ReviewProjection` reports current cash coverage separately from future
coverage. The visible review is for one paycheck; card coverage is global
across the ledger. `futureRelianceMinor` and `unassignedCardMinor` refer to
the shared card obligations relevant to the review, with per-card details.

### Task 1: Pure funding model and financial regression fixtures

**Files:** Create the shared types, money parser, projection, fixtures, and
`tests/paycheck-projection.test.ts`, `tests/reviewMoney.test.ts`.

**Interfaces:** `parseReviewMoney(value: string): number`,
`formatReviewMoney(minor: number): string`,
`projectReview(ledger: ReviewLedger, paycheckId: string, asOf: string): ReviewProjection`.
Projection must not mutate its input. Validation failures throw an Error
with a stable code; data uncertainty is returned as an issue.

- [ ] Add a fixture export `fundedLedger(): ReviewLedger` with a received
  MACU paycheck `macu-pay`, amount 200000, date `2026-11-06`, next payday
  `2026-11-20`; commitments 80000 due `2026-11-15`, statement 50000 due
  `2026-11-18`, unbilled 40000 due `2026-12-10`; matching contributions
  for all three; no settlements; all inputs confirmed; currency USD.
  Use synthetic canonical IDs, not any local account IDs.
- [ ] Add failing tests, including this baseline:

```ts
import { expect, it } from "vitest";
import { projectReview } from "../server/paycheck-projection";
import { fundedLedger } from "./paycheck-fixtures";
it("reserves current and later obligations without future income", () => {
  const result = projectReview(fundedLedger(), "macu-pay", "2026-11-08");
  expect(result.safeToSpendMinor).toBe(30000);
  expect(result.paymentShortfallMinor).toBe(0);
  expect(result.futureRelianceMinor).toBe(0);
});
```

  Add parser tests rejecting `1e3`, `NaN`, negative values, unsafe integers,
  and fractions of a cent; `parseReviewMoney("0.10")` must equal 10.
  Run `PATH=/opt/homebrew/bin:$PATH npx vitest run tests/paycheck-projection.test.ts tests/reviewMoney.test.ts` and observe failure before implementation.
- [ ] Implement parsing from digit strings and integer arithmetic; export
  the types and projection. Allocate direct commitments first, then due
  card obligations, then later obligations ordered by needed-by date/ID.
  The pure function checks the supplied choices rather than silently saving
  allocations. Return gaps and excess-capacity issues explicitly.

```ts
// Parsing algorithm; reject unsupported/unsafe inputs before returning.
const match = /^(0|[1-9]\d*)(?:\.(\d{1,2}))?$/.exec(value);
if (!match) throw Error("Enter a nonnegative amount with at most two decimals.");
const minor = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
if (!Number.isSafeInteger(minor)) throw Error("Amount is too large.");
```

- [ ] Add scenario assertions: 90000 later purchases with 70000 cash and
  20000 eligible Etrade future funding gives safe 0, shortfall 0, reliance
  20000; 140000 due statement and 80000 commitments with only 200000 cash
  gives shortfall 20000. An arrived second-source contribution funds the
  same card once. Reject future dates after needed-by, over-promised future
  capacity, mismatched currencies, or future cash labeled as received.
- [ ] Verify settlement accounting: remaining reservation equals original
  contribution less linked confirmed settlements; direct spent equals
  unique settled outflows. Paying a 50000 reservation preserves the original
  30000 safe remainder, not -20000 or 80000. Card credits and bank debits
  settle once. Unknown material input or unassigned card spending yields
  `safeToSpendMinor: null`; a known fully allocated deficit yields 0.
- [ ] Verify next-payday closure exposes only unreserved current leftovers,
  while old reservations still cover their card. Re-run focused tests and
  typecheck, inspect the staged diff, and commit with result line
  `Model paycheck reservations and card coverage` plus the exact owner request.

### Task 2: Durable ledger, canonical evidence, and atomic revisions

**Files:** Create `server/paycheck-repository.ts`,
`server/paycheck-evidence.ts`, `tests/paycheck-repository.test.ts`, and
`tests/paycheck-evidence.test.ts`.

**Interfaces:** `installPaycheckReview(store: Store): void`,
`readReviewLedger(store: Store): ReviewLedger`,
`saveReviewLedger(store: Store, expectedRevision: number, next: ReviewLedger): ReviewLedger`,
`reviewEvidence(store: Store, drafts: Plan[]): { accounts: AccountIdentity[]; transactions: TransactionIdentity[]; plans: Plan[]; digest: string; issues: { code: string; recordId: string; message: string }[] }`.
Import AccountIdentity/TransactionIdentity from `server/account-repository.ts`
and Plan from `server/bill-plan.ts`; do not recreate provider identities.

- [ ] Add failing in-memory SQLite tests for first read, round-trip, restart,
  environment isolation, stale revisions and rollback. Use the Task 1 fixture:

```ts
const store = new Store(":memory:", Buffer.alloc(32), "sandbox");
installPaycheckReview(store);
const empty = readReviewLedger(store);
expect(empty.revision).toBe(0);
const saved = saveReviewLedger(store, 0, fundedLedger());
expect(saved.revision).toBe(1);
expect(() => saveReviewLedger(store, 0, fundedLedger())).toThrow(/reload/i);
expect(readReviewLedger(store).revision).toBe(1);
```

  Pure-fixture IDs require seeding equivalent synthetic accounts/evidence
  before repository validation, or test the rejection first; do not disable
  foreign-reference validation to make the fixture pass. Run the two focused
  test files and observe failures.
- [ ] Install an environment-keyed ledger table holding revision and JSON
  records, plus a schema version. Keep it separate from provider tables.
  Within a SQLite transaction read the current revision, validate the entire
  candidate against canonical evidence and projection, then update using
  compare-and-swap. Reject missing records, duplicate deposit reviews,
  duplicate payment evidence, invalid amounts/dates, or excess allocations.

```sql
CREATE TABLE IF NOT EXISTS paycheck_review_ledgers (
  env TEXT PRIMARY KEY, schema_version INTEGER NOT NULL,
  revision INTEGER NOT NULL, record TEXT NOT NULL
);
```

- [ ] Implement evidence from `repository.analyticalHistory("all")`, canonical
  accounts, and `activePlanRecords` with the supplied draft plans. Expose
  eligible choices without the transactions UI's 2,000-row cap; exclude
  staged replacement imports and disputed duplicates using repository rules.
  Label included/hidden accounts and require explicit confirmation to use
  hidden-account evidence. Do not infer canonical links from bill labels.
- [ ] Hash sorted semantic evidence fields to produce a digest. On changed
  deposit/payment evidence, invalidate completion and return a specific
  issue rather than silently rewriting a contribution. Treat deleted,
  pending-to-posted, linked/unlinked account, or source-replacement evidence
  as requiring re-resolution; use canonical aliases only when unambiguous.
  Map plan payments as settlement candidates, not automatically as a second
  expense. Card-paid commitments must appear through their card obligation,
  not also as a direct cash obligation.
- [ ] Add tests for each evidence transition, transaction reuse, plan-paid
  duplication, stale evidence digests, and institution rename stability.
  Re-run focused files plus Task 1 tests and typecheck; inspect staging and
  commit `Persist paycheck reviews with shared funding revisions`.

### Task 3: Secured review API and complete manual-confirmation flow

**Files:** Create `server/paycheck-api.ts`, `tests/paycheck-api.test.ts`,
the four review React files, `web/reviewDraft.ts`, `tests/reviewDraft.test.ts`,
and `tests/paycheckReview.test.tsx`; modify `server/app.ts`, `web/App.tsx`,
`web/style.css`, and `README.md`.

**Interfaces:** `installPaycheckApi(app: Express, store: Store, drafts: Plan[]): void`.
Proposed concrete surface following the approved design:

- `GET /api/paycheck-review` returns `{ ledger, evidence, projections }`;
  compute projections for received paychecks using server current date.
- `POST /api/paycheck-review` accepts `ReviewDraftCommand` (defined below)
  and returns the same refreshed shape. IDs are generated with server
  `randomUUID` for new records; client temporary IDs are resolved atomically.
  Return 400 for invalid inputs, 409 for stale revision/evidence with reload
  instructions, and no provider calls or writes on GET.
- `web/reviewDraft.ts` exports `updateContribution(ledger: ReviewLedger, contribution: Contribution): ReviewLedger`
  and `previewReview(ledger: ReviewLedger, paycheckId: string, asOf: string): ReviewProjection`.
  Move the Task 1 pure projection to `shared/paycheckProjection.ts` and retain
  a server re-export so existing tests/imports remain valid. The browser and
  server must use identical rules, never duplicate calculation code.

- [ ] Write API tests using Supertest and the session pattern from
  `tests/authorization.test.ts`. Assert wrong Host, missing CSRF and foreign
  Origin fail; two edits with revision 0 cannot both succeed. Ensure response
  bodies omit encrypted tokens, credentials and raw provider snapshots.
  Run `npx vitest run tests/paycheck-api.test.ts` with the required Node PATH
  and observe failure.
- [ ] Install handlers after existing security middleware; validate limits
  and return actionable errors. Preserve the current 16KB JSON body limit:
  submit bounded changes to review records, not evidence/history, and enforce
  atomic cross-review validation.
- [ ] Add `ReviewDraftCommand` in shared types as the bounded wire format:

```ts
export type ReviewDraftCommand = {
  expectedRevision: number; evidenceDigest: string;
  changes: { collection: "sources" | "paychecks" | "obligations" |
    "contributions" | "settlements" | "reviews";
    action: "upsert" | "remove"; id: string; record?: unknown }[];
};
```

  Validate each record by its named collection, cap 50 commands
  per request and preserve the 16KB limit. Accept only unique IDs owned by
  this environment; validate records before persisting. New client temporary
  IDs map to server UUIDs in the response. `saveReviewLedger` remains the
  internal whole-ledger transaction contract.
- [ ] Add start/resume source selector, actual paycheck selection, account
  mapping, confirmed next payday, direct-spending evidence review, and
  amount/date confirmation for commitment occurrences. Keep plan editing
  in existing screens with return links; missing review data can be supplied
  inline. Uncertain recurring suggestions must not become authoritative.
- [ ] Build card statement and later-purchase confirmation, partial payments,
  refunds/fees adjustments, manual due/needed-by dates and payment routes.
  Show per-source current reservations and eligible future assignments with
  capacity previews. Editable amounts are state-controlled; changing one
  must recompute shared coverage without a save or browser reload.
- [ ] Add a small pure draft test:

```ts
const ledger = fundedLedger();
const changed = updateContribution(ledger, {
  ...ledger.contributions[2], amountMinor: 30000,
});
expect(previewReview(changed, "macu-pay", "2026-11-08").safeToSpendMinor)
  .toBeNull(); // The freed $100 is still owed to the card, not safe cash.
expect(ledger.contributions[2].amountMinor).toBe(40000);
```

- [ ] Render summary sections with text states and details. Offer Save review
  even when incomplete; mark complete only when evidence is confirmed and
  every gap is visible/resolved or explicitly acknowledged as a shortfall.
  Completing a review does not mean financially covered. Explain forecast
  reliance separately. Show prior unreserved leftovers apart from current
  safe to spend. Conflicting saves preserve local input and offer reload;
  navigating with unsaved edits prompts before discarding.
- [ ] Add `#paycheck-review` and make empty hash load it; preserve explicit
  `#budget` and other existing destinations, titles and heading focus.
  Use current semantic `<details>`, native labeled controls and styles.
  Verify loading, empty state, error, resumed incomplete review and 409 copy
  with rendered tests using existing React static-render patterns. Run draft,
  API and projection tests, typecheck, and isolated build; inspect staging
  and commit `Add a saved paycheck review with shared card funding`.

### Task 4: Optional Liabilities suggestions and consent integration

**Files:** Create `server/card-liabilities.ts`,
`tests/card-liabilities.test.ts`; modify `server/paycheck-api.ts`, review
card UI and existing Link controller modules identified during tracing;
update `PLAID_PLAN.md` and `README.md`.

**Interfaces:**
`refreshCardLiabilities(store: Store, provider: Provider, sourceId: string): Promise<void>`;
`readCardLiabilities(store: Store): { accountId: string; fetchedAt: string; statementDate: string | null; statementBalanceMinor: number | null; paymentDueDate: string | null; minimumPaymentMinor: number | null; issue: string | null }[]`.
`POST /api/paycheck-review/card-data/:sourceId/refresh` uses existing
session/CSRF protection and returns sanitized suggestions, never raw tokens.
Pass Provider to `installPaycheckApi` as a fourth argument for this task.

- [ ] Consult current Plaid implementation guidance for Transactions and
  Liabilities. Trace every new-Link, repair, account-selection and replacement
  path before updating consent. Existing repairs must retain their current
  purpose; add explicit card-data consent rather than repurposing repair.
  Record chosen API/controller details in `PLAID_PLAN.md`.
- [ ] Add stub-provider tests before implementation. Provider receives
  `/liabilities/get` only for an active consented Item with credit accounts;
  depository-only MACU/Etrade sources cause no liability request. Null fields,
  unsupported products, revoked consent and failure retain prior snapshots
  labeled stale. An original $500 statement with a confirmed $200 payment
  must suggest $300 unpaid only after explicit reconciliation, not assume
  the original balance is today's unpaid amount.

```ts
const calls: string[] = [];
const provider: Provider = {
  configured: true,
  call: async (path) => { calls.push(path); return { liabilities: { credit: [] } }; },
};
// Seed only a synthetic depository source first.
await refreshCardLiabilities(store, provider, "depository-source");
expect(calls).toEqual([]);
```

- [ ] Implement environment/source/account-keyed cached normalized snapshots.
  New Link requests Transactions as required and Liabilities as additionally
  consented. Fetch only after explicit consent/refresh, not automatically
  on app open or a timer. Persist timestamps and sanitized errors; mark
  unsupported cards as manual confirmation paths. Do not request Investments,
  paid real-time Balance, Statements PDFs or Recurring Transactions.
- [ ] Offer imported fields as review suggestions, maintaining manual edits
  until owner reconciliation. Reject overlapping statement ownership of the
  same purchase; preserve existing reservations when a statement closes by
  moving their obligation references atomically, not releasing the money.
  Test statement rollover, dates unknown, multiple cards on one Item, stale
  snapshots, refund ambiguity and permissions needed. Card balance data
  must not silently override confirmed manual entries.
- [ ] Run focused provider-stub, review, authorization, replacement and
  link-session regressions plus typecheck/build. Run Plaid acceptance on
  exact changed code; record every failure/remaining human task, including
  absent public webhook and untested live OAuth. Do not claim overall
  acceptance from synthetic tests. Inspect staging and commit
  `Suggest card statement data in paycheck reviews`.

### Task 5: End-to-end review verification and owner-facing guidance

**Files:** Extend `tests/paycheck-api.test.ts`,
`tests/paycheck-projection.test.ts`, `tests/paycheckReview.test.tsx`;
update `README.md`, `PLAID_PLAN.md`, and the checkboxes in this plan.

**Interfaces:** No new production surface. Verify the contracts above.

- [ ] Add a two-review integration test: MACU paycheck reserves commitments
  and contributes to a card; an expected Etrade paycheck supplies an explicit
  remaining contribution; it later arrives and is linked to a real synthetic
  deposit, preserving its ID/assignments and checking actual amount/date.
  Reopen affected reviews if the actual paycheck is smaller or late. Settle
  the card with split debits, then start the next MACU review. Assert the
  statement settles once, old reservations persist where unpaid, and prior
  unreserved leftovers do not increase the new paycheck's safe amount.
- [ ] Add integration failures for concurrent allocations, removed deposit,
  unavailable payment evidence, future funds arriving after processing
  deadline, statement rollover, and a commitment paid directly versus by
  card. Verify a shortfall can be acknowledged without becoming covered.
- [ ] Run full `PATH=/opt/homebrew/bin:$PATH npm test`, `npm run typecheck`,
  and `npx vite build --outDir /tmp/budget-paycheck-review-build` with the
  same PATH. Run Python tests because the repository includes staged-bill
  import regression coverage: `python3 -m unittest discover -s tests -p '*_test.py'`.
- [ ] Use a synthetic browser fixture/dev database separate from live data;
  never change real funding records for QA. Exercise both reviews at 320px,
  390px, and desktop; browser zoom/text enlargement; keyboard start-to-save;
  errors/status announcements; unsaved navigation; focus after disclosure,
  validation and navigation; horizontal overflow and touch targets. Exercise
  VoiceOver if available, otherwise record it as unverified.
- [ ] Perform Sandbox Link/consent/Liabilities tests only in explicitly
  isolated Sandbox configuration. Record observed field availability rather
  than promising connected production-card coverage. Run final-code Plaid
  acceptance again after any provider-facing fixes.
- [ ] Document the complete review steps, manual fallback, reservations vs
  actual transfers, future reliance, leftover boundary, and data-freshness
  limitations in README. Record HIG sections actually read, web adaptations,
  exact verification results and outstanding checks. Inspect staging; commit
  `Verify paycheck review journeys and document limitations`.

## Coverage and plan review

- Task 1 covers source-specific capacity, safe to spend, shortfalls, future
  reliance, shared cards, current-first priority and old leftovers.
- Task 2 covers durable state, canonical identity, plan evidence, reconciliation,
  duplicates, environment isolation and stale inputs.
- Task 3 covers the complete manual flow, all incomplete states, security,
  adjustable allocations, source setup, next payday and mobile navigation.
- Task 4 covers optional provider data, consent, freshness, nulls and rollover.
- Task 5 covers complete journeys, synthetic financial regressions, Sandbox
  checks, browser accessibility checks and explicit verification gaps.

No plan step authorizes real payments, public hosting, production data
modifications, goal management, expected discretionary spending, or an
aesthetic redesign. The owner's waiver permits the current model to perform
both Ninth House review voices for this round.

## Execution record — 2026-11-08

Owner selected inline work in this chat and a new branch in the existing
checkout. Implemented Tasks 1–4; Task 5 automated and scoped browser checks
are complete, with the live and accessibility checks below outstanding.

- `df346be`: shared integer-money projection and financial scenarios.
- `43622fe`: environment-scoped ledger, revisions and canonical evidence.
- `d198231`: resumable manual review, adjustable shared funding, and routing.
- `15a3445`: card-data integration, including explicit consent,
  cached suggestions, purchase assignment and bank-debit reconciliation.

Execution adaptations: the projection lives in `shared/paycheckProjection.ts`
from the start so browser/server share one implementation. Repository and
projection tests are consolidated into their named test files. The bounded
POST command format is used throughout. `web/ReviewObligationForm.tsx` isolates
obligation editing. Additional bank/card evidence checks were added after
synthetic-browser QA reproduced overstated remaining cash when evidence was
unassigned. Old reservations are not released on statement edits or payments;
statement rollover is owner-confirmed through obligation editing rather than
an automated guess at the next cycle. This remains a manual-review workflow.

Observed results: 208 JS tests pass in 35 files, one Python test passes,
typecheck passes, isolated Vite build passes. Browser used synthetic in-memory
data and verified start/save/resume/finish, card purchase assignment, 390px and
320px layouts, no narrow horizontal overflow, keyboard skip-link heading focus,
and date-control heights >=44px after correction. Later evidence safeguards
also have API regression coverage. No production data, settings, or served
build was modified.

Outstanding: real Sandbox consent/product flow, actual connected-card field
coverage, VoiceOver, effective enlarged text/zoom, every keyboard/error route,
and actual devices. Browser zoom shortcuts did not establish a measurable
zoom change, so that check is not marked passed. The broader Plaid acceptance
has seven failures recorded in root PLAID_PLAN.md. Native web controls,
disclosures, wrapping content and CSS-pixel targets are intentional web HIG
adaptations; no native appearance imitation or conformance claim.

Final review was inline as the owner selected. Both Ninth House voices ran
with the current model under the owner's waiver. They called out the bank/card
reconciliation guards and required the remaining verification gaps to stay
explicit. No PR, push or merge is authorized by execution alone.
