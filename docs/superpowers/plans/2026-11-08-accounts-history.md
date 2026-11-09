# Accounts and Connection History Implementation Plan

> **For agentic workers:** Execute in order using superpowers:executing-plans (inline) or superpowers:subagent-driven-development (only if the owner chooses delegation). Do not start financial readers on a partially migrated schema.

**Goal:** Make app-owned accounts independent of data connections, preserve history through disconnect/replacement, and request twelve months for new Plaid connections.

**Architecture:** Keep provider records as provenance. Introduce stable account identities and an explicit source-to-account mapping, then centralize money-facing reads. Ship the migration/read boundary before duplicate linking or connection replacement. CSV remains out of scope.

**Tech Stack:** TypeScript, Express 5, better-sqlite3, React 19, Vitest/Supertest, current Plaid Link/Transactions APIs. Use `PATH=/opt/homebrew/bin:$PATH` for commands.

**Spec:** `docs/superpowers/specs/2026-11-08-accounts-history-design.md`

## Global constraints

- Local financial records, credentials, backup databases and certificates must remain ignored and never enter tool output or Git.
- Separate institutions, canonical accounts, data sources and provider accounts, scoped by environment.
- No automatic account merging; no automatic loss of classifications or ambiguous overlap records.
- Preserve financial history on disconnect; deletion is a distinct confirmed operation.
- Request 365 days for new sources; preserve 90-day attribution on known legacy sources.
- Do not promise complete history or that Sync/update mode extends an existing initial history request.
- Preserve browser links, accessible controls, text enlargement, 44px targets and sparse system typography.
- Each task ends with verified tests and a focused commit. Subject <=72 characters; next line contains the owner's request. Use the initiating accounts/history request plus relevant scope clarification verbatim in the message body.

## Delivery boundaries and file responsibilities

This is a coordinated migration with three delivery stages: account foundation (tasks 1–3), account management/matching (tasks 4–5), and provider repair/history replacement (tasks 6–8). Each stage can be tested and committed without enabling later unfinished actions. Complete all three to satisfy the approved design.

New files:
- `server/migrations.ts`: versioned additive migration and consistent pre-migration backup.
- `server/account-repository.ts`: canonical account/institution/source identities and read model.
- `server/account-matching.ts`: evidence, reversible links and overlap resolution.
- `server/accounts-api.ts`: account/source route handlers, mounted behind existing API protections.
- `web/Accounts.tsx`, `web/AccountDetail.tsx`, `web/DataAccess.tsx`: focused user-facing views.
- `web/accountPreferences.ts`: migrate locally saved chart visibility through server ID aliases.
- `tests/account-migration.test.ts`, `tests/account-read-model.test.ts`, `tests/account-matching.test.ts`, `tests/accounts-api.test.ts`, `tests/history-replacement.test.ts`: meaningful synthetic fixtures.

Existing files touched: `server/store.ts`, `server/app.ts`, `server/sync.ts`, `server/bills.ts`, `server/income.ts`, `server/transfers.ts`, `server/flow.ts`, `web/App.tsx`, `web/MoneyFlow.tsx`, `web/style.css`, `README.md`, `.env.example` only if a new non-secret setting is required. Keep real .env untouched.

## Task 1 — Versioned additive identity migration

- [ ] Write `tests/account-migration.test.ts` against an exact synthetic copy of the current tables from Store. Include two environments, two MACU source accounts sharing a mask, tokens/cursors, a hidden account, and bill/income/transfer decisions. Insert explicit values and assert row counts and byte-identical tokens/cursors/decision payloads before/after migration. Run this test and observe failure because migration entry point is absent.
- [ ] Add migration version table and these identity tables; retain legacy tables as provider records for the compatibility stage:

```sql
CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
CREATE TABLE app_institutions(env TEXT NOT NULL,id TEXT NOT NULL,name TEXT NOT NULL,provisional INTEGER NOT NULL DEFAULT 1,PRIMARY KEY(env,id));
CREATE TABLE institution_aliases(env TEXT NOT NULL,provider TEXT NOT NULL,provider_id TEXT NOT NULL,institution_id TEXT NOT NULL,PRIMARY KEY(env,provider,provider_id));
CREATE TABLE app_accounts(env TEXT NOT NULL,id TEXT NOT NULL,institution_id TEXT NOT NULL,name TEXT NOT NULL,type TEXT,subtype TEXT,ownership TEXT,included INTEGER NOT NULL DEFAULT 1,PRIMARY KEY(env,id));
CREATE TABLE data_sources(env TEXT NOT NULL,id TEXT NOT NULL,provider TEXT NOT NULL,institution_id TEXT NOT NULL,label TEXT,status TEXT NOT NULL,requested_days INTEGER NOT NULL,last_checked TEXT,PRIMARY KEY(env,id));
CREATE TABLE source_accounts(env TEXT NOT NULL,source_id TEXT NOT NULL,provider_account_id TEXT NOT NULL,account_id TEXT NOT NULL,PRIMARY KEY(env,source_id,provider_account_id));
CREATE TABLE account_id_aliases(env TEXT NOT NULL,source_id TEXT NOT NULL,provider_account_id TEXT NOT NULL,account_id TEXT NOT NULL,PRIMARY KEY(env,source_id,provider_account_id));
```

Use random UUIDs for app IDs, generated once inside a transactional migration. Legacy connection IDs can remain data source IDs; keep encrypted token/cursor in the existing connection table until all accesses move behind the repository. Create one provisional institution per legacy source unless a stored provider ID proves equivalence. Never equate institution display labels with identity. Copy hidden to `included=0`. Preserve source nicknames and legacy history request 90. Leave unknown subtype/ownership null.

- [ ] Use better-sqlite3 backup API to make an ignored, permission-restricted snapshot before production migration; do not copy only the main SQLite file when WAL is active. On backup failure, stop migration with a readable startup error. In-memory tests bypass disk backup. Migration runs once, in a transaction, with no network calls; record version only after success.
- [ ] Add idempotency and injected-failure rollback assertions. Verify all source/transaction/classification rows survive and shared masks produce distinct app IDs. Run migration suite, existing tests and typecheck; commit.

## Task 2 — Canonical account/transaction read boundary

- [ ] Define repository output contracts in `server/account-repository.ts`:

```ts
interface AccountIdentity { id:string; institutionId:string; name:string; type:string|null; subtype:string|null; ownership:string|null; included:boolean }
interface TransactionIdentity { id:string; accountId:string; sourceId:string; providerTransactionId:string; date:string; name:string; rawName:string|null; amount:string; currency:string; pending:boolean }
interface HistoryCoverage { requestedDays:number; oldestPosted:string|null; newestPosted:string|null; lastChecked:string|null; importState:string }
```

Account IDs are stable; source transaction identities remain source-qualified. Amount text and currency remain original. Preserve rawName separately on future import without inventing past raw text. Do not let UI display limits cap analytical reads.

- [ ] Write a fixture with archived and active sources, identical provider IDs in different environments, repeated equal purchases, pending-to-posted updates and transaction removals. Assert canonical rows preserve multiplicity/provenance and source changes cannot remove another source's evidence. Observe failure before implementing reads.
- [ ] Add repository reads for account listing, account transactions with explicit cursor pagination, complete analytical history, observed coverage per source/account and old-to-new ID aliases. Initially each source account maps one-to-one, so no deduplication is needed. Filtering by account occurs before pagination.
- [ ] Refactor Store and each analytical module to consume this boundary. Update transactionKey/groupKey to canonical identities with explicit legacy aliases. Migrate bill/income keys and transaction exclusions transactionally, preserving old keys for rollback/compatibility. Transfer decision fingerprints must have migration mapping rather than silently reclassifying confirmed/rejected pairs. Conflicting decisions are retained for review.
- [ ] Test unchanged bill/income amounts, saved/dismissed decisions, transfer confirmations and flow totals on a migrated fixture. Verify account preference alias migration does not hide an unrelated source. Run complete suite/typecheck/build; commit.

## Task 3 — Preserve history on source disconnect

- [ ] Extend API tests with: successful revocation keeps canonical/provider historical rows, erases usable credential, marks source historical; failed revocation retains encrypted token and offers retry; disconnected sources cannot sync. Assert another account on a shared source is never deleted by an account-only action.
- [ ] Separate lifecycle APIs from destructive deletion. Contract:

```text
POST /api/data-sources/:id/disconnect  -> source historical, history retained
POST /api/accounts/:id/delete         -> explicit confirmation, source reimport guarded
GET  /api/accounts/:id                -> account + sources + observed history
```

Retain same-origin/CSRF protections. For deletion require the account's source mappings to be inactive/restricted; return 409 with a concrete action if still authorized. Do not implicitly revoke a multi-account source. Remove the old combined Disconnect & delete action from normal data management. Keep any compatibility route explicit rather than silently changing destructive semantics.

- [ ] Implement operations transactionally around provider revocation, retaining retry state on failure. Add truthful stale/historical status. Complete tests/typecheck; commit.

## Task 4 — Accounts-first web management

- [ ] Add Accounts index grouped by canonical institution ID; institution detail is context/grouping, data-source management is secondary. Preserve `#institutions` compatibility by routing to Accounts/data-access explanation. Detail URLs use canonical account IDs.
- [ ] Implement name/type/masked ending, known/unknown ownership, budgeting inclusion, oldest/newest posted dates, requested days and last successful check. Do not call coverage complete from oldest/newest alone. Transaction detail uses paginated repository endpoint. Unknown institution remains provisional with an understandable label.
- [ ] Move source nickname, sync, authorization and disconnect controls into DataAccess. Keep institution display name separate. Source ownership and requested history cannot be edited into false facts. Ensure all error states have retry or navigation actions.
- [ ] Migrate chart localStorage IDs once via `account_id_aliases`. Keep chart visibility independent of budgeting inclusion. Test pure preference mapping with stale/unmatched IDs. Inspect narrow widths, keyboard navigation, route focus, zoom and native dialog behavior; document VoiceOver gaps. Run typecheck/build/API tests; commit.

## Task 5 — Suggested duplicate accounts and reversible linking

- [ ] Write matcher fixtures for: shared MACU membership mask but different accounts (no strong suggestion), institution mismatch, same account exposed twice with several matching posted transactions, same-day repeated purchases, pending entries, source names differing, and no overlap. Return evidence and uncertainty, not a single opaque score.
- [ ] Implement suggested matches requiring institution/type compatibility plus overlap evidence; mask/name are supporting signals. Unknown institution/type yields low-confidence review, never auto-link. Add a review screen with side-by-side metadata and sample evidence. Store only user-confirmed links.
- [ ] Add link operations log with previous mappings/preferences/decision references and explicit preferred source. Canonical account ID survives. One-to-one overlap reconciliation compares posted date/currency/amount/normalized description with multiplicity, retaining raw evidence. Ambiguous overlaps require review and flag affected financial estimates as unresolved rather than silently double-counting.
- [ ] Resolve bill/income/visibility/name conflicts explicitly in the confirmation UI. Never overwrite conflicting exclusions; provenance-qualified IDs avoid collision. Unlink restores recorded mappings; decisions created after linking require an explicit resolution, not blanket rollback. Test link, provider sync after link, unlink and conflict paths. Run full suite; commit.

## Task 6 — Plaid authorization repair and account selection

- [ ] Consult Plaid implement guidance before changing Link, tokens or API calls. Continue the existing guided workflow rather than restarting intake. Confirm current update-mode requirements against primary docs.
- [ ] Write provider-stub API tests for ITEM_LOGIN_REQUIRED, account-selection update, successful authorization return, cancellation and server failure. Test that update-mode success updates the existing source without exchanging a public token as a brand-new source.
- [ ] Implement Repair authorization and Review shared accounts using update-mode Link tokens; keep access tokens server-only, reconnect UI resumable, and preserve historical mappings for no-longer-shared accounts. Store provider institution ID/type/subtype when available; do not claim verified ownership from a display name. Update UI states/retry actions.
- [ ] Run provider-stub integration tests and Plaid acceptance checker with honest evidence; record remaining baseline gaps. Commit after appropriate sandbox validation; do not exercise user credentials or complete new permissions for the owner.

## Task 7 — Twelve-month new links and safe replacement

- [ ] Write failing `/link-token` provider-stub test asserting `transactions.days_requested=365`. Persist request value on source creation; do not retroactively relabel existing sources. Add tests that changing analysis windows does not invoke Link or fetch older history.
- [ ] Change new Link requests to 365, update setup copy, and persist resumable replacement state:

```sql
CREATE TABLE source_replacements(env TEXT NOT NULL,id TEXT NOT NULL,old_source_id TEXT NOT NULL,new_source_id TEXT,state TEXT NOT NULL,requested_days INTEGER NOT NULL,last_error TEXT,PRIMARY KEY(env,id));
```

States: prepared, old_access_revoked, awaiting_link, importing, awaiting_account_review, reconciling, complete, cancelled, failed. Errors retain the last resumable stage and truthful old-source authorization state.

- [ ] Replacement entry explains provider recreation constraint and preserves local data. Do not use destructive legacy disconnect. Require owner action for revocation/relink permissions. When old Item must be removed to recreate, persist operation and revoke while retaining all local history; only then launch new Link. On cancellation/failure retain historical account and a reachable retry. Never promise uninterrupted provider access.
- [ ] After new import, owner confirms source-account matches; new mapping attaches to existing canonical identities. Reconcile overlaps through task 5. Finalize source preference only when account review and financial conflicts are resolved. Keep original request metadata and records for audit/unlink.
- [ ] Test interruption at each state, failed revocation, cancelled Link, invalid token, partial history, unknown account matches, duplicate imports and successful completion. Verify bill/income/transfer/chart preferences survive. Run tests/typecheck/build and Plaid acceptance with actual evidence; commit.

## Task 8 — Coverage, documentation and end-to-end audit

- [ ] Add consistent coverage presentation to Accounts and data access: requested days, observed span, import readiness, last successful check and bank-limited/unknown completeness explanation. Sync is ingesting provider-available data, not refresh/backfill. Do not label zero activity as missing history without evidence.
- [ ] Run end-to-end synthetic scenarios with two source logins at one institution, one overlapping account, one unique account, partial 12-month history and repeated purchases. Reconcile duplicates, disconnect retaining history, replace source, and verify each downstream feature from the same read model.
- [ ] Run `npm test`, `npm run typecheck`, `npm run build`, staged diff/secret-file checks. Inspect Account index/detail/DataAccess at phone widths, enlarged text, keyboard and VoiceOver where available; record exact gaps. Update README and approved design status with outcomes and limitations.
- [ ] Commit verified final documentation. Report hashes, migration/backup status, actual history received versus requested, remaining provider/human tasks and clean working tree. Do not claim a year of data until bank results establish it. CSV remains deferred.

## Plan review

Scope maps to all approved spec sections: identity migration/read boundary (1–2), disconnect/delete (3), accounts-first/institutions/data sources/coverage (4,8), suggested/reversible matches and overlap (5), authorization repair (6), twelve-month request/replacement and recovery (7), complete verification (8). No production database has been migrated by creating this plan. No provider access has been altered.
