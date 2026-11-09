# Accounts, institutions, data connections, and history

Status: proposed design for owner review; implementation has not begun.

## Decisions agreed with the owner

- Accounts are the primary user-facing financial objects, grouped by institution.
- Institutions and data connections are distinct. Multiple MACU membership logins are multiple data connections to one institution, not multiple institutions.
- Suggest likely duplicate accounts and show evidence; require owner confirmation before linking them to one account.
- Disconnect preserves imported history by default. Delete account and history is a separate destructive action with explicit confirmation.
- Request 12 months of history for new connections. Show requested versus received history honestly.
- Scope this iteration to connection-based history; reserve CSV import as a future data source.

## Current state and why a navigation-only change is insufficient

Current SQLite identities are environment + connection + provider account ID. Transactions, bill grouping, income grouping, transfer decisions and chart preferences depend directly or indirectly on those identities. The Institutions UI actually lists connections. Account type is stored, subtype/ownership are not; institution names are cached but stable provider institution IDs are not. Different logins can expose the same real account. Current disconnect deletes transactions/accounts. Link requests 90 days; 3/6/12-month analysis filters do not fetch history. Raw transaction descriptions are currently replaced with merchant names where available.

A persistent account identity must sit above provider account IDs before connection replacement can safely preserve financial decisions. Simply changing navigation labels or requesting 365 days would leave duplication and history loss unresolved.

## Proposed experience

Accounts becomes the management destination, grouped by institution. Each row shows name, type/masked ending, budgeting inclusion, data status, and earliest/latest stored posted transaction dates. A short date span is labeled less than requested history, never complete coverage.

Account detail shows transactions (paginated rather than capped before filtering), coverage, name/type/ownership metadata when available, budgeting inclusion and a progressively disclosed Data sources section. Unknown ownership remains unknown; names do not establish legal ownership. Account identifiers must distinguish MACU subaccounts with shared masked endings.

Institution detail groups its accounts and provides Manage data access. Data access lists source labels (e.g. MACU household membership), status, associated accounts, last successful check, originally requested history, and actions: Sync, Repair authorization, Replace for longer history, Disconnect. Institution display name and source nickname are separate fields. Provider/Item identifiers remain implementation details, available in diagnostics only.

Budgeting inclusion and Money Flow chart visibility retain their distinct semantics. Inclusion preferences belong to the persistent account; chart preferences use that identity too. Import/authorization choices belong to the source. A hidden chart account can still have a labeled transfer across the visibility boundary.

## Data model and read boundary

Introduce environment-scoped app-owned institutions and accounts with stable internal IDs. Institution records retain provider institution IDs and explicit aliases where known; do not automatically merge institutions on display name alone. Unknown existing institutions remain provisional until metadata is resolved, with no blocking network call during database migration.

Introduce data_sources (provider kind, encrypted token, source label, institution reference, lifecycle status, sync cursor, timestamps, requested history days) and source_accounts (source ID, provider account ID, canonical account reference, provider metadata). Retain source transaction records with original identity and provenance. Imported provider name and merchant name must be separate fields on future sync; do not invent missing historical raw descriptions.

All money-facing features consume a common canonical account/transaction read model rather than independently querying provider rows. This boundary resolves active source precedence, historical overlap, pending/posted transitions and environment isolation. CSV later implements another source kind against this boundary; no CSV UI/parser in this scope.

## Matching and overlap

Suggest matches using institution identity, type/subtype, masks, account names and multiple overlapping posted transaction signatures. Display evidence and uncertainty. A shared membership number/mask is weak evidence, especially at MACU. Missing or conflicting institution/type information lowers confidence. Never auto-link accounts or infer ownership.

Confirmation links source accounts to one canonical account without deleting originals. Choose a preferred active source for fresh data and explain it. Within an overlap window, equal amounts alone are insufficient to suppress records. Use multiplicity-aware one-to-one matches with date/currency/amount and normalized description evidence; retain ambiguous conflicts for review. Preserve unmatched older transactions. Repeated same-day same-value legitimate purchases must survive. Do not sum an ambiguous overlap into financial totals as if both were verified unique events; explicitly show unresolved data issues and affected estimates until reviewed.

Linking must be reversible by restoring source-account mappings and the previous preference/decision state from a recorded link operation. Unlinking may require resolving decisions created after linking; never discard those silently. Existing unrelated app edits are not rolled back. Source-level provider updates/removals affect their records, not another source's evidence of the transaction.

## Disconnect, deletion and replacement

Disconnect first revokes provider access. On success, remove the usable credential and mark the source disconnected, retaining its provenance, source account mappings and history. If revocation fails, retain credentials encrypted and show retry/repair; do not claim success. A disconnected account stays visible as historical data with stale-data labeling. Disconnect is separate from permanent deletion in UI and API.

Delete account/history explains which source records, classifications and downstream analyses are affected, confirms explicitly, and prevents a still-authorized source from silently reimporting deleted data. Require disconnecting/restricting the applicable source account first. It must not revoke an entire multi-account source or delete another account implicitly.

New links request 365 days. Available history remains controlled by the institution and Plaid. Record the actual request at creation; legacy requests are recorded as 90 days for this known application, not represented as 365 retroactively.

Plaid documentation says days_requested cannot be extended after Transactions initialization; an older-history replacement requires recreating the provider Item. This UI must not equate update mode, resetting a cursor or Sync with older-history acquisition. Repair authorization/update account selection are distinct from replacement.

Replacement is a persisted, resumable operation: explain provider reconnection and possible availability limits; revoke the old Item only when required by the supported recreation flow, preserving all local history and decisions. Owner completes Link with 365-day request, then reviews source-account matches and overlap. Keep the same app account IDs. Show incomplete/failed operation with reachable retry/cancel actions; cancellation retains the old historical source and reports its authorization state accurately. Do not promise atomic continuity of provider access. Never use the old destructive disconnect route as the migration mechanism.

Reference: https://support.plaid.com/hc/en-us/articles/24631662544919-Why-does-this-Item-include-only-three-months-of-transaction-history
Reference: https://plaid.com/docs/api/link/
Reference: https://plaid.com/docs/transactions/

## Coverage and feedback

Store requested history per source, import readiness and last successful check independently. Account history shows observed oldest/newest posted dates and source attribution, not a completeness percentage or a promise that missing months have no activity. Request date span, returned span and possible bank limits must be distinguishable. Pending import is resumable; last successful import remains visible after failure. Connected, needs authorization, historical/disconnected, importing and failed are text states, not color alone. Sync means ingest provider-available updates, not force bank refresh or extend historical scope.

## Existing data migration and rollout

1. Back up SQLite using a consistent database snapshot (including committed WAL state); protect backup like production data. Add versioned transactional migrations; no remote API calls inside a migration.
2. Create one app account/source mapping per existing account initially. Preserve tokens, cursors, visibility, labels, types and transaction records; do not guess duplicates during migration.
3. Adapt shared reads and migrate bill/income/transfer references. Retain old group keys in an explicit mapping. When account linking coalesces classifications with different names, exclusions or decisions, ask which to keep rather than silently overriding. Preserve transaction provenance so exclusion IDs cannot collide across sources. Chart hidden-account preferences migrate in the browser through an explicit old-to-new ID map.
4. Ship Accounts navigation and historical-preserving disconnect against those stable identities. Leave compatibility redirects for existing Institutions links.
5. Ship match review and canonical overlap handling, then connection replacement for 12-month requests with readiness/coverage feedback. Each stage gets its own tested commit; avoid a partially migrated production read path.

## Acceptance and design checks

Test migration of the actual schema with synthetic financial fixtures: environment isolation, no lost transactions/classifications, rollback on migration failure, MACU shared masks without false linking, duplicate/repeated transactions with multiplicity, reversible source linking, active/historical source precedence, provider modified/removed/pending updates, hidden preference migration, disconnect success/failure and retained history, safe separate deletion, replacement interruption/retry, partial bank coverage and new 365-day Link requests. Verify transfer/income/bill/flow analyses use the same canonical read model.

Use current Apple HIG accessibility, layout, navigation, writing and destructive action guidance adapted to the web. Keep system text, relative sizing, 44px targets, native browser links/forms/dialogs and zoom. Validate phone-width layouts, keyboard journeys, large text and VoiceOver before making conformance claims. No award/compliance claims from source inspection alone.

## Explicitly deferred

CSV import, arbitrary provider adapters, public deployment/authentication, guaranteed complete one-year bank coverage, verified ownership, automatic account merging, and broad redesign of the budget/overview visualizations. No destructive account/provider action is authorized merely by approving this design; individual UI operations retain their appropriate confirmation flows.
