# Bills Import Implementation Plan

**Goal:** Stage the owner's Bills worksheet for review and save confirmed commitments with account funding totals.
**Architecture:** Private XLSX extraction produces source-keyed drafts. A separate environment-scoped SQLite plan stores reviewed records; React review UI keeps imported commitments distinct from transaction observations.
**Tech Stack:** Python standard library, TypeScript, Express, SQLite, React, Vitest.
**Spec:** docs/superpowers/specs/2026-11-08-bills-import.md

## Constraints
No financial data in git. No workbook edits. No Plaid changes. Never assume an account for annual subscriptions. Flag uncertain and zero records. No silent duplicate merging.

## Tasks
- [x] Create synthetic XLSX extraction tests for monthly, quarterly, annual, zero, ambiguous, transfer rows and source IDs. Run failing tests; implement scripts/stage-bills.py; rerun. Stage actual workbook into ignored data/bills-import.json.
- [x] Add tests/bill-plan.test.ts: confirmation validation, environment isolation, idempotent saves, exclusion, duplicate acknowledgement and currency/account-separated monthly funding. Run failing tests. Implement server/bill-plan.ts and install its secured routes in server/app.ts.
- [x] Add web/BillPlan.tsx to Bills and Bills Overview. Editable per-record review with source provenance, flags, save/exclude controls and status/error feedback. Display funding totals separately from observed bills.
- [x] Run Python tests, npm test, npm run typecheck and npm run build. Inspect source diff and staged paths for private data. Document verification gaps, commit with owner's wording on line two and report hash.

## Validation
Python extraction test passes; full Vitest suite, typecheck and production build pass. API tests need localhost sockets outside sandbox. Real worksheet staged locally with 46 rows, none confirmed. Browser, enlarged-text and VoiceOver verification outstanding.
