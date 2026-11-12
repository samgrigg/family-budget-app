# Accounts and Admin

Owner request: “Lets look at the Accounts tab. Right now it's more like a Settings tab and less informational, so we need to create an admin section in order to allow this page to be more informational.” Approved direction: “The design sounds good. Accounts should primarily show balances.”

Accounts now presents one cached balance per canonical account, grouped by institution, with transaction history on selection. Admin in the header owns names, inclusion, source matching, connections, authorization, sync, replacements and deletion. Existing data-access and institution links still resolve to Admin. Admin is an organizational section within the existing local application, not a new authorization role.

The existing server-side account retrieval already supplies balances; the app now persists the current and available values, currency, source and retrieval time. Existing accounts show unavailable until their next successful sync. No live balance endpoint, new Plaid product, consent, credential change or new bank request was added. Cached data is explicitly described as cached; “Retrieved” is the app retrieval time, not an institution update time. Values older than 48 hours or associated with disconnected, authorization-required or unshared sources are labeled stale. Null stays unavailable; zero stays zero. Credit and loan current balances are labeled amount owed. Unknown currency is never assumed to be USD. Linked source copies are selected, never added; active sources precede historical ones, with the owner's preference within that priority. Pending replacement sources are excluded.

Schema version 7 adds source-qualified balance snapshots through the existing startup backup/migration mechanism. Deleting accounts or removing sources deletes their snapshots. Metadata-only updates preserve prior snapshots, while explicit null balance responses clear the corresponding value.

## HIG review and web adaptations

Reviewed Apple's current [layout](https://developer.apple.com/design/human-interface-guidelines/layout), [navigation](https://developer.apple.com/design/human-interface-guidelines/navigation-and-search), [accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility), [typography](https://developer.apple.com/design/human-interface-guidelines/typography), [buttons](https://developer.apple.com/design/human-interface-guidelines/buttons), [color](https://developer.apple.com/design/human-interface-guidelines/color), and [writing](https://developer.apple.com/design/human-interface-guidelines/writing) guidance.

Use existing system typography and Zinc colors, semantic headings and links, visible keyboard focus, textual stale labels, and 44 CSS-pixel minimum navigation targets. Browser hash navigation and standard form controls are intentional web adaptations. Two aligned columns prioritize balances; narrow screens stack identity and balance. Browser zoom restrictions were not introduced.

## Verification

- Synthetic in-memory API tests exercise cached balances through connect/sync, zero/null/currencies, metadata-only preservation, disconnection, deletion, preferred source selection and staged replacement exclusion.
- Rendering checks distinguish current from available balances and debt from spendable funds.
- Migration coverage verifies version-six startup requires a backup, preserves legacy financial rows and runs only once.
- Browser preview used synthetic accounts only, without bank credentials or personal financial data. Verified account list, history, Admin landing, account preferences and data-access navigation. At 390 and 320 CSS pixels, no horizontal document overflow; at 320 the rows stack. Keyboard Enter navigation, Tab progression and visible focus were observed.
- Actual 200% text enlargement and VoiceOver were not verified. Keyboard zoom shortcuts did not establish a measurable enlargement, so they are not counted as a passing large-text test. No claim of accessibility conformance.
- No live Plaid Sandbox Link/exchange or production sync was performed. Integration coverage uses synthetic provider inputs; cached balance semantics follow the [official Accounts API reference](https://plaid.com/docs/api/accounts/).

## Follow-up: hierarchy, refresh discovery and transaction direction

Owner reported three problems: unclear Accounts information architecture, inability to find balance refresh in Admin, and inverted positive/negative transaction display.

This follow-up supersedes the initial institution-grouped Accounts layout and initial Admin landing page described above:

- Accounts is grouped into Cash & savings, Credit cards, Loans, and Other accounts. Institution and account subtype are secondary row metadata; View transactions explicitly identifies the drill-down. Credit-card and loan sections describe amounts owed, preserving balance semantics.
- Refresh balances & transactions is at the top of both Accounts and Admin, with an additional per-connection action in Admin. Admin opens on Connections & refresh, with separate Account settings and Account matching navigation. Connection authorization/settings and longer-history replacement are disclosed on demand, below refresh actions.
- Refresh uses the existing protected source sync endpoint. It re-reads account data after requests, reports completion and partial failure, skips sources requiring repair/revocation or pending replacement review, deduplicates source IDs, and stops launching further requests after navigation. Institutions can return cached balances; the label does not promise a live bank balance or add a paid endpoint.
- Raw provider amounts are retained in storage and analysis. Only transaction presentation reverses direction: incoming money is positive, outgoing money negative, zero unsigned. The common formatter is used by Accounts/Admin history, Budget transactions, matching evidence and income deposit evidence. Debt balances are not sign-reversed. See [Plaid's transaction amount convention](https://plaid.com/docs/api/products/transactions/).

Reviewed current HIG layout and buttons guidance for content hierarchy, grouping, progressive disclosure, explicit action labels and progress feedback. Standard web links, details/summary, browser hash navigation, existing theme contrast and 44px targets remain intentional web adaptations.

Browser verification used synthetic in-memory data and a fake provider: clicking refresh changed checking from $4,280.45 to $4,380.45 and displayed completion feedback; history showed payroll +$2,500.50 and groceries −$42.50. Admin exposed refresh on entry, with advanced controls collapsed. Accounts had no horizontal overflow at 390px and 320px, and Tab navigation showed visible focus. Actual large-text enlargement, VoiceOver and live bank/Sandbox connectivity remain unverified.

Final local checks: 226 tests across 42 files passed; TypeScript and production build passed. Read-only code review found no important issues. The fresh Plaid acceptance review still records the live Sandbox journey as unverified (CHECK-008), rather than treating synthetic coverage as live acceptance.
