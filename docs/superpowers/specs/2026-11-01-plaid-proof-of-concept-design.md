# Plaid transaction import proof of concept

## Objective

Connect one of the owner's real financial accounts through Plaid and import usable transaction data. Target the Amazon Chase card first, subject to Plaid account eligibility and institution availability. Sandbox success alone does not satisfy the real-account objective.

## Scope and architecture

Build a local TypeScript web application with a React frontend, a Node backend, and SQLite persistence. Bind the backend to loopback. Serve the frontend and API from the same origin. Keep the institution integration behind a small provider interface so budgeting features need not depend on Plaid response objects.

The interface offers connection status, Connect account, Sync transactions, a transaction table, and Disconnect and delete local data. Show sandbox versus production prominently, along with import status and last successful sync time.

Installability, offline support, budgets, categorization rules, household sharing, hosting, and scheduled imports belong to later milestones. Do not cache financial API responses in a service worker.

## Authentication and secrets

The backend creates a Plaid Link token for the Transactions product. The frontend opens Plaid Link; the owner completes authentication and consent there. Exchange the resulting public token on the backend. Never store bank passwords or return Plaid access tokens to the frontend.

Read Plaid client credentials and a local encryption key from ignored environment configuration. Encrypt stored access tokens with authenticated encryption; keep the key outside SQLite. Exclude environment files, databases, exports, and sensitive logs from version control. Protect local mutation routes with origin validation and CSRF protection; disable cross-origin access. Redact provider errors before returning them to the browser or logging them.

Production OAuth needs a redirect URI registered in the Plaid dashboard and permitted by Plaid. Confirm the applicable local-development redirect requirements before implementing the callback. Preserve and resume the Link flow after an OAuth redirect. Do not assume sandbox configuration works unchanged in production.

## Import and storage

Store connections, accounts, transactions, sync cursors, and import status. Namespace persisted data by Plaid environment. Use provider account and transaction IDs as stable keys, with connection ownership enforced.

Use /accounts/get for account metadata and /transactions/sync for incremental transactions. Request approximately 90 days of history, accepting that actual history depends on the institution. Handle added, modified, and removed transactions, pending-to-posted transitions, pagination, and cursor reset errors. Commit a completed sync batch and its cursor atomically; retry safely without duplicates. Prevent concurrent syncs for a connection.

Initial transaction availability is asynchronous. Treat an empty initial response as waiting for data, not proof of an empty account. Provide manual retry with bounded polling and clear status. No public webhook endpoint is required for this local proof of concept.

Display transaction date, description or merchant, amount, currency, pending status, and account. Document Plaid's outflow-positive sign convention and avoid binary floating-point arithmetic in normalized money values. Preserve enough source identifiers to reconcile updates without retaining unnecessary personal information.

Disconnect calls /item/remove before deleting local connection data. If provider revocation fails, retain the encrypted token for retry and explain that local deletion alone does not revoke provider access.

## Validation and completion

Automated checks cover idempotent repeated sync, modifications and removals, multi-page atomicity, cursor mutation recovery, environment isolation, token confidentiality, and rejected unauthorized local mutations. Sandbox checks exercise Link, token exchange, account retrieval, import, and disconnection.

The owner creates a Plaid developer account, accepts any applicable agreements, configures permitted redirect URLs, and supplies credentials locally. Real-account completion requires owner authentication, at least one account retrieved, transaction history imported when available, and a second successful sync without duplicates. Report any account eligibility or provider approval blocker explicitly.

## Review status

Approved by owner on 2026-11-01. Local implementation created; real-account acceptance remains pending owner-managed Plaid setup and authentication.
