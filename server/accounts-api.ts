import type express from "express";
import type { Store } from "./store";
// Mounted only after createApp's same-origin/session/CSRF middleware.
export function installAccountApi(app: express.Express, store: Store) {
  app.get("/api/accounts/:id", (req, res) => {
    const account = store.repository
      .listAccounts()
      .find((a) => a.id === req.params.id);
    if (!account) return res.status(404).json({ error: "Account not found." });
    const { limit, cursor } = req.query;
    if (
      (limit !== undefined &&
        (typeof limit !== "string" ||
          !/^\d+$/.test(limit) ||
          Number(limit) < 1 ||
          Number(limit) > 200)) ||
      (cursor !== undefined && (typeof cursor !== "string" || !cursor))
    )
      return res.status(400).json({
        error:
          "Use an integer limit from 1 to 200 and a valid transaction cursor.",
      });
    let page;
    try {
      page = store.repository.accountTransactions(account.id, {
        limit: limit === undefined ? undefined : Number(limit),
        cursor: cursor as string | undefined,
      });
    } catch {
      return res.status(400).json({ error: "Invalid transaction cursor." });
    }
    const sources = store.db
      .prepare(
        "SELECT d.id,d.provider,d.label,d.status,d.requested_days,d.last_checked,s.provider_account_id FROM source_accounts s JOIN data_sources d ON d.env=s.env AND d.id=s.source_id WHERE s.env=? AND s.account_id=?",
      )
      .all(store.env, account.id);
    res.json({
      account,
      sources,
      coverage: store.repository.coverage(account.id),
      transactions: page.rows,
      nextCursor: page.nextCursor,
    });
  });
  app.post("/api/accounts/:id/delete", (req, res) => {
    if (req.body?.confirm !== true)
      return res.status(400).json({
        error:
          "Confirm permanent deletion of this account and its local transaction history with confirm: true.",
      });
    if (!store.repository.listAccounts().some((a) => a.id === req.params.id))
      return res.status(404).json({ error: "Account not found." });
    try {
      store.deleteAccount(req.params.id);
    } catch (error: any) {
      if (error.code === "SOURCE_AUTHORIZED")
        return res.status(409).json({ error: error.message, code: error.code });
      throw error;
    }
    res.json({
      deletedAccountId: req.params.id,
      deletionEffects: {
        accountAndTransactionsDeleted: true,
        analysesRecalculate: true,
        reviewAndAuditRecordsRetained: true,
      },
      notice:
        "Account and transaction history deleted. Affected analyses recalculate. Review decisions and audit records are retained; decisions whose evidence was deleted may require unresolved review.",
    });
  });
}
