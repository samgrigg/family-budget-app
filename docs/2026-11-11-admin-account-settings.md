# Admin account settings

Owner request: “The Account Settings page in the Admin section needs some information hierarchy work now. There should also be a "include in budgeting" checkbox for each account that can be toggled from that screen”.

The page now introduces the budgeting setting and an included-account count, then groups account rows by institution. Institution headings include a per-institution count. Institution renaming is a collapsed secondary action. Each account row prioritizes name and last four digits, then subtype, with an Edit name & details link and a directly toggleable Include in budgeting checkbox. Empty institutions are omitted.

Checkbox changes save immediately to the existing protected preferences API. An inclusion-only request updates only inclusion; it never sends or rewrites a stale account name. Existing name-plus-inclusion forms retain their behavior. Saving disables only that row's checkbox and shows progress; rejected saves restore the prior value and display a local error. A confirmed save followed by refresh failure remains selected with an appropriate message. Successful saves update inclusion counts and refresh budget state. No bank connection or Plaid behavior changes.

Reviewed current Apple HIG [layout](https://developer.apple.com/design/human-interface-guidelines/layout), [toggles](https://developer.apple.com/design/human-interface-guidelines/toggles) and [writing](https://developer.apple.com/design/human-interface-guidelines/writing). Native HTML checkboxes with explicit account-specific accessible names, semantic headings and lists, standard disclosure controls, and labeled 44px hit areas are intentional web adaptations. Account rows stack on phones and align setting controls on wider screens.

Verification: 231 tests across 43 files, TypeScript and production build passed. The added API regression confirms inclusion can toggle in either direction without changing a concurrently renamed account, invalid bodies are rejected and unauthenticated requests remain blocked. Read-only code review found no important issues.

Synthetic browser checks verified immediate save, persistence after reload, updated inclusion counts, keyboard Space toggling, and checkbox rollback with local error after a controlled save failure. At 390px, label targets measured 44px; at 320px and 390px there was no horizontal document overflow. No real budgeting preferences were changed for testing. VoiceOver and actual text enlargement remain unverified; no accessibility-conformance claim is made.
