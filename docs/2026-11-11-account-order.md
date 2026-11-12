# Manual account order

Owner request: “NICE! The order is off though. And the order is going to be arbitrary - just some order that I prefer.” Scope confirmed: “Current sections for now”.

Accounts offers Edit order within the existing Cash & savings, Credit cards, Loans and Other accounts sections. Pointer handles move accounts before or after another row; Move up/down provides the same operation through standard buttons for keyboard and touch users. Accounts cannot move between sections. Editing hides transaction links to prevent accidental navigation while arranging rows. Save order persists the preference; Cancel discards the draft. Save/Cancel remain reachable if a data refresh reduces the number of accounts.

Preferences store only canonical account IDs in browser localStorage, scoped by environment. They survive page reloads and balance refreshes in the same browser. New accounts append at the end of their section; removed IDs and duplicates cannot remove or duplicate visible rows. Active account-link redirects inherit the old saved position without rewriting the stored preference, allowing unlink to recover it. Storage failures leave the draft visible with a retry message. This is a browser display preference, not a server setting shared across browsers.

Reviewed current Apple HIG [drag and drop](https://developer.apple.com/design/human-interface-guidelines/drag-and-drop) and [accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility), particularly alternative controls, reversible edits, drop feedback, target sizes and textual state feedback. Standard web buttons, pointer capture and explicit Save/Cancel are intentional adaptations. Pointer capture is restricted to the handle so ordinary touch scrolling remains available elsewhere. Insertion edges use a border plus text. Moves announce position through a status region; boundary controls use aria-disabled with guarded actions to retain keyboard focus. Existing typography, colors and browser zoom behavior remain unchanged.

Verification:

- Unit tests cover persistence/reload, environment isolation, newly discovered accounts, stale/duplicate IDs, before/after moves, unknown targets, linked/unlinked positions, malformed storage and write failures.
- Synthetic browser preview verified keyboard moves, Save, reload persistence, balance-refresh persistence, Cancel, pointer drag and rejection of cross-section drops. No real financial data or owner account-order preferences were changed during verification.
- At 320px, the editor had no document horizontal overflow and measured Move button targets were at least 44px in each dimension.
- Read-only code review found the account-count toolbar issue; it was fixed. Follow-up review found no additional important issues.
- VoiceOver, actual enlarged text and physical touch dragging were not tested. Dragging offscreen does not auto-scroll; Move up/down remains available. No claim of accessibility conformance.

Final checks: 230 tests across 43 files, TypeScript and production build passed.

## Compact reorder mode

Owner request: “The account rows should collapse to a minimum when reordering so I can see more of them at a time”. Reordering now hides balances, institution/type metadata, connection notices and section descriptions. Each compact row keeps the name, last four digits, drag handle and arrow move buttons. Arrow buttons retain full account-specific accessible names and title labels. Position remains available to assistive technology; moves still announce the new position. On narrow screens, name and last four digits use two compact lines; long names truncate visually while their full text remains in the DOM, accessible button names and title.

Current HIG layout guidance was reviewed for task-focused hierarchy and progressive disclosure. Measured rows were 53 CSS pixels high on desktop and at 320px, with 44x44px move buttons and drag handles. At 320px there was no horizontal document overflow. Synthetic browser verification exercised keyboard moves, pointer dragging and Cancel restoring the full balance rows. Existing order persistence tests (4), TypeScript and production build passed. Large-text and VoiceOver checks remain unverified.
