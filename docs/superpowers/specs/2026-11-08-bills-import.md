# Bills worksheet import

Approved by owner: import Bills worksheet as a reviewable starting point, preserving account labels, amounts, dates and notes. Flag zero values, uncertain frequencies, transfers and possible duplicates. No automatic confirmation.

Local Python extraction reads XLSX XML without editing the workbook. It writes only an ignored private staging file under data/. Source references are stable cell addresses; no financial records are committed. Preserve exact source formula and cached amount in provenance. Known quarterly Xbox payment uses its actual quarterly amount; ambiguous Gerber payment stays unresolved. Annual subscriptions have no assumed account. Transfers remain excluded from commitments.

A separate bill-plan table stores reviewed records by environment and source key. Review/save and exclude are idempotent. Records retain provenance, editable name, account label, currency, decimal payment amount, frequency, optional day and notes. Confirmation of uncertain entries requires resolving amount/frequency/account; possible duplicate names require explicit acknowledgement. Saved records can be edited or excluded. Imported plans remain separate from observed recurring patterns: show overlap warnings and never silently merge evidence.

Account funding totals include confirmed plans only and show monthly payments, less frequent monthly set-asides and combined totals separately per account/currency. This does not claim bank balances, payable dates or accounting reconciliation. Existing historical Bills Overview remains explicitly separate to avoid double counting plans and observations.

Web adaptation: semantic details/forms, direct labels, existing system typography and 44px controls. Current Apple entering-data/buttons pages consulted; Markdown fetch unsupported. Keyboard, enlarged text and VoiceOver require verification; no conformance claim.
