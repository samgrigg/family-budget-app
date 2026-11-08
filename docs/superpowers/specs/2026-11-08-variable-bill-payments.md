# Variable recurring bills and credit card payments

Owner approved combining unknown recurring commitments with known future payment amounts, without counting credit card purchases and repayments as duplicate expenses.

Extend the existing bill plan. Fixed bills retain existing behavior and data. Monthly variable bills may be confirmed with an unknown amount and an optional per-month planning estimate. A payment cycle is identified by its full date; at most one payment per bill per calendar month in this first version. Each cycle retains a known amount and optional explicitly linked posted transaction. Past cycles remain saved when another month's payment is edited. A calendar-month selector determines the cycle being edited and funding totals. Source worksheet zero values remain fixed zero until explicitly changed to variable. Unknown is never converted into a real zero.

Funding chooses actual linked payment, then known payment for that month, then optional estimate, then unknown. Known monthly cycles are never multiplied by annualization factors. Fixed quarterly/annual bills continue using monthly set-asides. Account/currency totals show known amounts, estimates and unknown counts. Planned expense totals exclude credit repayments; funding totals include them. Never sum funding across card purchases and their payment as household expenses.

Users explicitly classify credit card payment bills and can select a linked card account and posted payment transaction. No merchant-name inference establishes payment ownership. The API validates actual evidence (posted positive amount, matching currency, stable canonical key), prevents reuse across plans/cycles and derives actual amounts from transaction records. Missing evidence after history changes is surfaced and falls back to the saved upcoming amount or estimate; not a zero. Linked actual repayments are excluded from expense classification in Money Flow. When a card account is selected they route to that account; otherwise they appear in a distinct repayment movement with an explicit untracked destination. Existing uniquely matched debt repayments retain their routing. Raw bank history remains unchanged. An unlinked bank payment cannot be identified from a manual bill name alone.

Web UI uses native date/month inputs, details and selects with system typography and 44px minimum controls. Existing confirm/exclude progression is retained. User-defined account labels remain separate from optional canonical card identity. No new Plaid products, bank requests or automatic statement retrieval. No scenarios, minimum-payment calculation, balances, interest allocation or accounting certification.

Verification: targeted tests for precedence, cycle isolation, unknown/zero, legacy records, validation, currency/account separation, expense exclusion, evidence reuse and real flow routing. Existing full suite/typecheck/build. Browser, zoom/enlarged text and VoiceOver checks must be explicitly reported if not performed.

## Verified implementation notes

The observed Bills Overview identifies a repayment series only from an explicitly linked posted transaction's existing account/currency/payee group. It keeps repayment events visible but excludes them from the expense estimate. Existing unique debt matches are resolved before synthetic route fallback, so adding a plan cannot turn an already-matched card credit into apparent income. Changed actual currency or a changed repayment source type invalidates actual evidence during amount resolution and produces a saved-payment fallback warning.

Current HIG entering-data and writing pages were consulted; text fetch returned JavaScript shells. Browser-native inputs/selects/details and existing 44px targets are retained. Synthetic desktop browser validation verified form save, unknown amounts, actual transaction autofill, next-bill focus, exclusion removal and fallback heading focus, keyboard month changes, and estimate versus actual totals. A browser automation fill of the month field alone did not emit the committed native change; keyboard month selection did update totals. Mobile, enlarged text, zoom and VoiceOver were not verified. This is not a conformance claim.

Final verification: 150 automated tests, TypeScript and production build pass. No Plaid request/authentication behavior changed. Synthetic preview used an in-memory database; the owner's financial data remains untouched.

## Conditional card destination

The card destination selector appears only while Counts as is Credit card payment. Changing the classification updates visibility immediately and removes the hidden control from keyboard/accessibility navigation. Switching back within the form retains an unsaved card selection; saving an expense clears the inapplicable destination. Native label/select semantics and existing control dimensions are retained. Relevant HIG entering-data guidance was consulted during this feature; enlarged-text and VoiceOver verification remain outstanding.

Conditional-field validation: synthetic browser check confirmed the destination is absent for Expense, appears immediately for Credit card payment and is removed again when switching back, including from keyboard navigation. Typecheck and production build pass.

## Duplicate confirmation correction

The owner reported HTTP 400 with the duplicate acknowledgement error. Investigation confirmed the validator treated matching observed bill history as a second planned commitment, even though planned and observed totals are deliberately separate. Matching observed patterns are now informational context and do not block confirmation. Another confirmed plan with the same normalized name still requires explicit acknowledgement and is listed with its account label. Save errors appear next to that row's confirmation controls and receive keyboard focus; only the affected row exposes an acknowledgement after a duplicate rejection. Financial records are not modified during diagnosis or verification.

Duplicate-fix validation: 150 tests, typecheck and build pass. Synthetic browser reproduction verified that a genuine duplicate rejection stays inside the current form, moves focus to the inline message, displays the acknowledgement beside Confirm bill, and saves successfully after acknowledgement. No real bills were confirmed or changed during testing.
