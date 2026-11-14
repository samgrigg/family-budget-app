# Planned commitments layout

Approved request: make Planned Commitments scannable like table rows, with
monthly commitments primary and funding subtotal, monthly set-aside, and debt
payoff secondary.

Account summaries now align those figures across wide screens. Phones show the
account and primary amount above the secondary figures; below 23rem, secondary
figures use labeled lines to avoid splitting ordinary currency amounts. Known
and estimated breakdowns, card-payment explanations, and calculation notes use
native details/summary disclosure. Unknown-amount warnings remain visible.
Financial calculations and bill review forms are unchanged.

Reviewed Apple's HIG layout and typography guidance on hierarchy, alignment,
progressive disclosure, relative type size and readable weights. Web adaptations
use CSS grid and semantic definition lists rather than a fixed-width table, and
native browser disclosure rather than native-platform widgets. Existing system
colors, safe areas and browser zoom support are retained.

Verification: 16 bill-plan/bill-review tests pass, TypeScript passes, production
build passes. Browser checks used a synthetic in-memory store at 1100px and
320px. At 320px the document width equals the viewport width, all six secondary
amounts fit on one line, and disclosure targets measure at least 44px high.
Enter expands/collapses funding details, Tab advances to the next disclosure,
and keyboard focus has a visible solid outline. Synthetic screenshots are in
/tmp/budget-commitments-desktop.png and /tmp/budget-commitments-mobile.png.

VoiceOver, enlarged text/zoom, physical devices, and a dedicated light-mode
visual pass remain unverified. No accessibility conformance claim is made.

## Expandable commitment entries

The individual entries now use a semantic table with Commitment, Amount,
Payment account and Frequency columns. Status appears beneath the name. Amount
basis stays visible, including monthly equivalents for less frequent bills and
explicit unknown amounts. Clicking anywhere in the summary row toggles a
full-width detail row containing the existing evidence and edit form. A native
button exposes aria-expanded/aria-controls and supports Enter/Space. Collapsed
forms remain mounted to retain unsaved edits but are hidden from interaction.
Save advancement now controls the detail rows and focuses the next row button.

HIG alignment, readable type and progressive disclosure guide this extension.
The web adaptation uses table headers and native buttons; below 42rem rows
reflow into two columns with visible field labels. The table remains present
in the browser accessibility tree. VoiceOver verification remains outstanding.

Synthetic browser verification at 1100px and 320px confirmed aligned desktop
columns, one-line amounts and no horizontal overflow at 320px, >=44px row
buttons, keyboard expansion/collapse, retained edits, successful save with
updated row text, and focus/expansion advancement to an unreviewed bill.
Desktop and expanded-phone screenshots are /tmp/budget-entry-table-desktop.png
and /tmp/budget-entry-table-mobile.png. The same 16 budget/review tests pass;
TypeScript and production build pass. Enlarged text, VoiceOver, physical
devices and a dedicated light-mode pass remain unverified.

## Column sorting and day of month

Owner request: “Great stuff! Now in the Budget tab, the Commitments rows, how hard would it be to make those sortable? And add the day of month as a column”. Clarification: “Column sorting”.

Commitment, Amount, Payment account, Day of month and Frequency headers now toggle ascending/descending order. Existing source order is retained until the first sort. The new column reads the existing optional payment-day field; missing values show Not set. Day and amount sorts are numeric. Amount uses the displayed resolved payment/monthly equivalent, with separate currency groups rather than implicit currency conversion. Names use case-insensitive natural ordering, account names alphabetical ordering and frequencies shortest-to-longest cadence. Unset values remain last in both directions; ties retain source order. No data or scheduling fields are modified by sorting.

Sort direction is shown with arrows, aria-sort and a status message. On phones the headers remain visible as wrapping sort controls; row cells retain labels. Expanded forms are keyed to commitment IDs, remain mounted during sorting, and span all five columns. Review advancement uses the selected sort order, including excluded records solely to preserve advancement position.

Current HIG layout guidance on alignment, hierarchy and adaptability informed the change. Native header buttons and responsive wrapped headers are deliberate web adaptations. VoiceOver and actual text enlargement remain unverified; no accessibility-conformance claim.

Verification: 237 tests across 44 files passed, including six new sorting tests for numeric values, null-last ordering, stable ties, immutable inputs, record identity, cadence/text sorting and currency separation. TypeScript and production build passed. Read-only code review found no blocking issues. Synthetic browser tests verified day order 2/10/20/unset and its reversal, amount order 50/65/1200/unknown, keyboard sorting, retained unsaved edits in an expanded row, and save advancement to the next unreviewed item in sorted order. At 320px all sort buttons measured at least 44px high and the document had no horizontal overflow. No real budget data was changed during verification.
