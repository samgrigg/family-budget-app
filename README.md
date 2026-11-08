# Family Budget — Plaid connection proof of concept

A local React/TypeScript app with a Node backend and SQLite. Connect through Plaid Link, import transactions, sync updates, and revoke access. The first target is your Amazon Chase card. This milestone is not yet an installable PWA.

## Requirements

Node 22.12+ (Node 24 LTS recommended), npm, and a Plaid developer account. The system shell on this computer defaults to Node 16; use `PATH=/opt/homebrew/bin:$PATH` before the commands below to select the installed newer Node.

## Start with sandbox

1. Run `npm install`.
2. Run `npm run setup` to create a private `.env` with a random encryption key. Existing configuration is never overwritten.
3. In your Plaid dashboard, obtain the client ID and **sandbox** secret. Enter them in `.env`; never paste them into chat or commit them.
4. Keep the generated encryption key: changing it makes existing saved tokens unreadable.
5. Register `http://localhost:3000/` as an allowed redirect URI in the Plaid dashboard.
6. Run `npm run dev` and open http://localhost:3000. Use that hostname, not 127.0.0.1, with this configuration.
7. Click **Connect an account** and choose a sandbox institution. Where Plaid offers sandbox test credentials, use `user_good` / `pass_good`; follow the simulated OAuth screen for OAuth institutions.
8. Initial import polls at five-second intervals for up to six attempts. If history is still pending, use **Sync** later. Sync fetches data Plaid already has; it does not force a bank refresh.

Sandbox uses simulated data. It does not prove that the real Chase card connects.

## Connect the real Chase card

Create/apply for a Plaid Trial account and enable Transactions as applicable. Eligibility, supported accounts and agreements are controlled by Plaid. The trial is a development access option; check its current terms before relying on ongoing free usage.

For the desktop POC, set `PLAID_ENV=production` and use the matching production secret with `APP_ORIGIN=http://localhost:3000`. The server omits `redirect_uri` in this mode, even if a Sandbox HTTP redirect remains in `.env`. Use a full desktop browser with popups allowed. Mobile and embedded-browser OAuth are not covered by this temporary mode.

For mobile-compatible redirect OAuth later, production redirect URIs must use HTTPS:

1. Install a trusted local certificate tool such as mkcert, then follow its instructions to install its local CA.
2. Create `certs/` and generate a certificate for localhost, for example: `mkcert -key-file certs/localhost-key.pem -cert-file certs/localhost.pem localhost 127.0.0.1 ::1`.
3. Set `PLAID_ENV=production`, enter your production Plaid secret, set `APP_ORIGIN=https://localhost:3000`, and `PLAID_REDIRECT_URI=https://localhost:3000/`.
4. Register that exact HTTPS redirect URI in the Plaid dashboard and set the TLS paths shown in `.env.example`.
5. Restart the app; open https://localhost:3000. Confirm the **REAL ACCOUNTS** badge before connecting Chase and selecting the Amazon card.
6. Authenticate and consent in the Plaid/institution flow. Confirm accounts/activity appear and a second sync does not duplicate transactions.

Production and sandbox data share the local database but are isolated by environment. Switch back to an environment to manage its connections. Do not remove `.env` or change its encryption key until you have disconnected its saved accounts.

## Data and access

The server binds to 127.0.0.1 and is intended for use by one person on this computer. Do not expose it through a public tunnel or deploy it as a shared service; it has no multi-user authentication. Requests validate the Host, Origin, and a per-session CSRF token. Plaid access tokens are AES-256-GCM encrypted. The encryption key lives separately in `.env`; anyone able to read both can decrypt the tokens. Transactions themselves are stored unencrypted in `data/budget.sqlite`; use operating-system disk encryption and account protection.

**Disconnect & delete** calls Plaid's `/item/remove` before deleting local connection/account/transaction rows. A failed revocation leaves the connection available for retry. SQLite deletion is logical deletion, not guaranteed forensic erasure from disk or backups. Plaid/institution retention policies also apply.

The table shows up to 2,000 stored transactions, newest first. Amounts are stored as decimal text with currency; positive is money out, negative is money in. No totals or floating-point financial arithmetic are performed. Available history depends on the institution. New connections request 12 months (365 days); existing sources retain their original 90-day request. Analysis windows and Sync do not request older history. In Data access, Replace for longer history prepares a resumable flow: explicitly revoke old access, authorize a new source, import, confirm account matches or distinct accounts, and reconcile. Saved history stays available during reconnection. Confirmed account links and classifications survive cancellation and can be reviewed/unlinked in Accounts. Replacement imports stay excluded from estimates until final review completes.

## Checks and production build

- `npm test` — storage, sync failure recovery, token protection, API security.
- `npm run typecheck`
- `npm run build`
- `NODE_ENV=production npm start` — serve the compiled frontend with the same local API. This deployment mode is separate from `PLAID_ENV`.

No live API checks run without credentials and owner consent. Passing automated checks is not evidence of a successful bank import.

## References

- [Plaid OAuth and redirect requirements](https://plaid.com/docs/link/oauth/)
- [Transactions Sync reference](https://plaid.com/docs/api/products/transactions/)
- [Plaid Trial eligibility](https://support.plaid.com/hc/en-us/articles/39994173227159-What-is-the-Plaid-Trial-plan)

## Bills worksheet import

Stage the existing worksheet locally (Python 3, standard library only):

```sh
python3 scripts/stage-bills.py "/absolute/path/to/your/workbook.xlsx"
```

Restart the app, then open **Budget → Planned commitments**. The staging command reads only the Bills tab and writes `data/bills-import.json`, which is private and ignored by Git. It never edits the workbook or confirms entries. The importer targets this workbook's existing layout: account groups in A/B and E/F, annual subscriptions in N/O, and auto-transfers in Q/R/S. It is not a general Excel importer.

Expand an entry, review its actual payment amount, account, frequency, optional day and notes, then confirm or exclude it. Zero amounts and unknown frequencies cannot be confirmed. Annual subscription accounts are blank until supplied; currency initially assumes USD. Auto-transfers cannot count as bills unless explicitly reclassified. Possible duplicates use normalized name matching against other confirmed plans and confirmed transaction patterns; different merchant names can still describe the same obligation, so review both lists. Acknowledgement permits a separate commitment, not an automatic merge.

Bills Overview shows confirmed plan funding by account and currency, including monthly set-asides for quarterly, semiannual and annual payments. The observed history estimate remains separate: do not add it to planned totals. Plans retain worksheet account labels without linking them to bank identities. Payment days are retained as entered, not used to assert contractual due dates.

Reviewed decisions persist in SQLite per environment and source cell. Re-staging refreshes unreviewed drafts; saved decisions take precedence. Excluded entries retain their edited details locally, disappear from the Budget list and do not contribute to funding totals. A restore interface is not yet provided. Import only the original layout: moving rows in the workbook changes cell-based identities. Do not commit staging files or the local database.

Checks: `python3 -m unittest discover -s tests -p '*_test.py'` plus the usual npm checks. VoiceOver, enlarged text and live-browser review of the new forms remain outstanding.
