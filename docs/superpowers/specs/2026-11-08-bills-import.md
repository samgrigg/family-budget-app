# Bills worksheet import

Approved by owner: import Bills worksheet as a reviewable starting point, preserving account labels, amounts, dates and notes. Flag zero values, uncertain frequencies, transfers and possible duplicates. No automatic confirmation.

Local Python extraction reads XLSX XML without editing the workbook. It writes only an ignored private staging file under data/. Source references are stable cell addresses; no financial records are committed. Preserve exact source formula and cached amount in provenance. Known quarterly Xbox payment uses its actual quarterly amount; ambiguous Gerber payment stays unresolved. Annual subscriptions have no assumed account. Transfers remain excluded from commitments.

A separate bill-plan table stores reviewed records by environment and source key. Review/save and exclude are idempotent. Records retain provenance, editable name, account label, currency, decimal payment amount, frequency, optional day and notes. Confirmation of uncertain entries requires resolving amount/frequency/account; possible duplicate names require explicit acknowledgement. Saved records can be edited or excluded. Imported plans remain separate from observed recurring patterns: show overlap warnings and never silently merge evidence.

Account funding totals include confirmed plans only and show monthly payments, less frequent monthly set-asides and combined totals separately per account/currency. This does not claim bank balances, payable dates or accounting reconciliation. Existing historical Bills Overview remains explicitly separate to avoid double counting plans and observations.

Web adaptation: semantic details/forms, direct labels, existing system typography and 44px controls. Current Apple entering-data/buttons pages consulted; Markdown fetch unsupported. Keyboard, enlarged text and VoiceOver require verification; no conformance claim.

## Confirm-and-continue interaction

Owner requested that Confirm Bill close the entry and take them to the next confirmation. After a successful save and reload, collapse the current native details, open the next unreviewed bill (skip confirmed, excluded and transfer entries; wrap to earlier outstanding bills), focus its summary and scroll it into view after React commits the refreshed layout. When no bill remains, close the current entry and focus its summary. Failed saves leave the entry open. Save for review also advances after saving, while keeping the entry in review.

Current HIG focus-and-selection and disclosure-controls references were consulted; text fetch returned JavaScript shells. Uses native web details/summary focus rather than a custom accordion, with immediate scrolling and no added animation. Three queue-selection tests, typecheck and production build pass. Actual browser focus/scroll, enlarged text and VoiceOver checks remain outstanding.

## Exclusion visibility update

Owner clarified: Exclude from plan saves the current edited details and excludes the bill from Budget. Excluded records remain stored and counted as excluded, but are not rendered in the Budget list or included in funding totals. Successful exclusion advances to the next pending bill using the complete record order. If no next bill remains, focus the Planned commitments heading because the excluded row is removed. Failed saves preserve the open entry. Save for review also advances after a successful save, while retaining review status. No restore interface is provided yet.

Web adaptation retains native details/summary and uses a programmatically focusable heading as the fallback after removal. Current HIG disclosure-controls reference consulted; text fetch returned the JavaScript shell. Live browser focus/scroll and assistive technology checks remain unverified.
