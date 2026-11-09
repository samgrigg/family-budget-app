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

Expand an entry, review its actual payment amount, account, frequency, optional day and notes, then confirm or exclude it. Zero amounts and unknown frequencies cannot be confirmed. Annual subscription accounts are blank until supplied; currency initially assumes USD. Auto-transfers cannot count as bills unless explicitly reclassified. Possible duplicate plans use normalized name matching against other confirmed plans; different merchant names can still describe the same obligation, so review both lists. Matching confirmed transaction patterns are shown as historical context and do not block plan confirmation, because history estimates are separate from planned totals. Acknowledgement is required only for another confirmed plan and permits a separate commitment, not an automatic merge.

Bills Overview shows confirmed plan funding by account and currency, including monthly set-asides for quarterly, semiannual and annual payments. The observed history estimate remains separate: do not add it to planned totals. Plans retain worksheet account labels without linking them to bank identities. Payment days are retained as entered, not used to assert contractual due dates.

Reviewed decisions persist in SQLite per environment and source cell. Re-staging refreshes unreviewed drafts; saved decisions take precedence. Excluded entries retain their edited details locally, disappear from the Budget list and do not contribute to funding totals. A restore interface is not yet provided. Import only the original layout: moving rows in the workbook changes cell-based identities. Do not commit staging files or the local database.

Checks: `python3 -m unittest discover -s tests -p '*_test.py'` plus the usual npm checks. VoiceOver, enlarged text and live-browser review of the new forms remain outstanding.

## Variable monthly bills and credit card payments

In a bill's review form, choose **Variable monthly amount** to confirm a recurring obligation whose amount is unknown. Leave the planning estimate blank for unknown, or enter an optional estimate. A fixed zero retains its old meaning and still needs correction before confirmation; choosing variable explicitly makes it an unknown commitment.

Use **Planning month** to select the payment cycle. Under **Payment for YYYY-MM**, enter its date and known payment amount once available. Optionally select the actual posted outgoing transaction: its amount takes precedence. Payment cycles from earlier months remain saved. One payment per bill per calendar month is currently supported, for monthly bills only. Blank cycle fields remove that month's saved payment on save; they do not erase other months. Estimates remain labeled estimates. Missing or invalidated transaction evidence falls back to the saved payment amount and is flagged.

For card repayments, choose **Counts as → Credit card payment (funding only)**. These amounts contribute to account funding and are excluded from planned expenses. Optionally select the linked card account and, after payment, link the bank-account debit. Money Flow preserves existing uniquely matched debt routes and treats explicitly linked repayments as movements rather than additional purchase expenses. With no matching card credit, a selected destination is a modeled route; without a linked card it is shown separately as a repayment with purchase history unavailable. No balance or statement retrieval is added.

A transaction link also identifies that transaction's existing recurring bill series as a repayment in the observed Bills Overview: it remains on the timeline but is excluded from expense estimates. Unlinked, unmatched repayments cannot be classified from a manually entered bill name alone. Review/link those payments before relying on expense totals. Planned expenses cover confirmed bill plans, not all household purchases; plans and observed history are never summed together.

For unused cards with balance-transfer debt, choose **Credit card payment (debt payoff)**. Existing **Credit card payment (purchases)** entries keep their previous meaning. Both types count in account funding; Planned Expenses lists debt payoff separately from expenses, with estimates and unknown amounts labeled. The whole debt payment is tracked without splitting principal, interest and fees. Link the posted bank debit to distinguish actual debt payoff in Money Flow and the observed bill timeline. No saved bills are automatically reclassified.

## Merge duplicate planned bills

When another confirmed plan is flagged, choose **Yes, this is a duplicate — review merge**. Select the existing bill to keep, compare details, and choose whose bill details should win. Choose explicitly between conflicting payments in the same month, then click **Merge bills**. Notes, compatible payment cycles, posted evidence and worksheet references are retained. The existing bill remains confirmed and counts once; the duplicate disappears and cannot return on worksheet re-import. The separate-commitment checkbox remains available for bills that happen to share a name but are genuinely different.

Merges require the same currency and validate the resulting plan. A stale preview must be reviewed again. Original snapshots and source aliases remain in the local database for recovery; there is no undo interface yet. Restart the app after updating to load the merge routes and metadata table.

An imported auto-transfer flagged as a duplicate can also merge into its confirmed bill. That merge always keeps the bill’s details and payment history. Transfer notes/references are retained; transfer payment records remain in merge history and do not replace bill payments.

## Find supporting transactions

Expand a bill under **Budget → Planned Commitments**, then click **Find supporting transactions**. It immediately searches included local posted outflows by the bill description or full payment amount. Refine the description, amount, account/date filters, or require both description and amount. Results show why they matched and flag confirmed account transfers as funding movements. Credit card repayment searches use bank debits only.

Search covers all eligible stored history, with 50 candidates per page, and does not fetch more bank data. Results are candidates, not automatically attached evidence; searching never changes the bill or bank transactions. Saved changes to the bill or planning month reset the search scope. Restart the app after updating to load the new search endpoint.

For a planned auto-transfer, choose **Entry type → Auto-transfer (not a bill)**
and **Confirm transfer**. Expense and card classification controls are hidden;
the transfer stays recorded but contributes nothing to bill or funding totals.
Switching back to a bill restores its classification controls. The existing
semantic web select and button remain in use, with direct action labels guided
by Apple HIG writing guidance. This change was checked with server-rendered
component tests, persistence/totals regression tests, typecheck and build;
interactive browser, enlarged-text, keyboard and VoiceOver checks are unverified.

For a monthly bill paid through several charges (for example, family gym
memberships), enter the **Fixed amount (full commitment)** as the combined
monthly amount and set **Expected charges per month** to 3 or 4. Expand that
month's payment, check the full monthly amount, then add each separate posted
transaction under **Separate posted charges**. Labels can identify family
members. Save or confirm the commitment to retain its evidence.

The bill shows how many expected charges are linked. Partial evidence retains
the full monthly amount; once all expected charges are linked, their combined
actual amount is used. Identical-looking transactions remain separate and a
transaction cannot support two active commitments or two cycles. An unlinked
charge does not end a membership. Each saved cycle retains its expected count
so adjusting a future month's count does not rewrite past cycles. Grouped
charge selection uses the latest 2,000 stored posted outflows, filtered to the
selected month and currency. Restart the app after updating.

Grouped charge UI verification: synthetic in-memory browser checks at 390px,
three-of-four and four-of-four save/confirmation, optional labels, live
single-to-grouped switching, edited totals, keyboard activation and 44px row
controls. Native HTML fields, fieldsets and disclosure controls provide the web
adaptation of HIG [layout](https://developer.apple.com/design/human-interface-guidelines/layout),
[writing](https://developer.apple.com/design/human-interface-guidelines/writing)
and [accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility)
guidance. Full keyboard traversal, enlarged text/browser zoom and VoiceOver
remain unverified; these checks do not establish accessibility conformance.

## Paycheck review

Paycheck Review is the default page. Set up Canyons/MACU and Adobe/Etrade with
their actual deposit accounts, then select an arrived deposit and confirm that
source’s next payday. Add predictable obligations due before replenishment,
then last-statement and later-purchase card obligations as separate amounts.
Use existing planned commitments and transaction history to confirm inputs.
Reserve current cash first; assign future paycheck funding explicitly only
when needed. Future income never increases safe to spend.

Save incomplete reviews and return later. Each card’s funding is shared
between reviews. Record a posted debit against its reservation when paid;
record other cash spending separately. Do not record a card purchase again
as a direct-cash commitment. Confirm card totals include fees/refunds and
exclude overlap with other entries. Earlier unreserved paycheck leftovers
stay separate; old unpaid reservations remain attached to their obligations.
Reservations do not move money. Changed bank evidence or conflicting saves
require another review. Unknown or unassigned spending prevents a definitive
safe-to-spend result. The first release supports USD.

In **Card statement data**, use **Refresh card data** for cached statement
suggestions. If additional consent is needed, save your review and choose
**Authorize card data**. This reuses the existing resumable bank authorization
flow. Null or unsupported fields stay unknown; manual confirmation remains
available. Imported statement balances are original balances, not proof of
what is still unpaid. Existing account repairs do not request new card access.

Assign imported card purchases to a single obligation using **Assign imported
card purchases and credits**. Each purchase can be linked once. Cash movements
must also be accounted for as an obligation payment or other cash use before
safe to spend is shown. Money moved aside reduces this paycheck's available
cash; these review records do not reclassify the underlying transactions.
A future paycheck can be confirmed against its actual deposit without losing
its funding promises. Correct contributions if its amount or timing changed.

Verification for this increment: 208 synthetic JavaScript tests and the Python
import test pass; TypeScript and an isolated Vite build pass. Browser testing
used an in-memory synthetic database at 390px and 320px, including start,
obligation creation, purchase assignment, reservations, save/resume, and finish.
Keyboard skip-link focus worked; date inputs were corrected to at least 44px.
VoiceOver, effective enlarged text/zoom, every error path, actual-device use,
and real Sandbox consent/statement retrieval remain unverified. No real bank
data or credentials were used for this verification.

Income-source setup now saves immediately, independently of paycheck creation.
The saved employer/account mapping is listed beside the form; successful saves
and errors appear there too. Editing an existing source prefills its name and
account. Saving a source preserves unrelated unsaved review changes.

When adding a paycheck, the deposit list follows the selected income source's
mapped account. It shows unused, posted USD deposits only, and switching the
source clears the previous deposit selection. Reconfirming an existing paycheck
also allows its currently linked deposit. Employer-description heuristics are
not applied yet; deposits within the mapped account remain available for review.
