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
