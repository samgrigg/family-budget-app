# Variable Bill Payments Implementation Plan

**Goal:** Save monthly unknown commitments, known payment cycles and actual evidence without treating repayments as new expenses.
**Architecture:** Extend JSON plan records compatibly; pure shared amount-resolution functions drive account funding and expense summaries. Server validates and resolves explicitly linked canonical transactions. Existing Money Flow separates linked repayments from purchase expenses.
**Spec:** docs/superpowers/specs/2026-11-08-variable-bill-payments.md

- [x] Write failing tests for monthly amount precedence, legacy fixed amounts, unknown counts, date isolation and expense versus funding totals. Implement shared/billAmounts.ts and extend server/bill-plan.ts.
- [x] Test and implement schedule/evidence validation, persistent cycle history, canonical card choices and linked posted-payment options in secured existing API. No bank calls.
- [x] Test and implement explicit actual repayment handling in server/flow.ts, preserving existing matched debt routing. Keep repayment amounts separate from new spending when destination is untracked.
- [x] Add selected calendar month, variable amount controls, payment-cycle editing, actual evidence selection and expense/funding summaries to web/BillPlan.tsx. Preserve confirm/exclude progression.
- [x] Run tests, typecheck and build; request code review, fix findings, inspect staged diff for private data and commit with the owner's exact request on line two.

Validation: 150 Vitest tests pass, typecheck and production build pass. Isolated browser check with synthetic in-memory data verified unknown confirmation, confirmation advancement, exclusion removal/focus fallback, posted payment autofill, actual versus estimate month selection, and repayment exclusion from expense totals. No real financial data modified. Mobile widths, enlarged text and VoiceOver remain unverified.
