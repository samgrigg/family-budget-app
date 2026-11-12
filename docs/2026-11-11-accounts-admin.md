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
