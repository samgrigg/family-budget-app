import type express from "express";
import type { Store } from "./store";
// Mounted only after createApp's same-origin/session/CSRF middleware.
export function installAccountApi(
  app: express.Express,
  store: Store,
  recoveryIds: () => string[] = () => [],
) {
  app.get("/api/accounts", (_req, res) => {
    const raw = store.repository.accounts();
    const recovery = recoveryIds();
    const sources = store.db
      .prepare(
        "SELECT d.id,d.provider,d.institution_id,d.label,d.status,d.requested_days,d.last_checked,CASE WHEN c.token IS NULL THEN 1 ELSE 0 END AS missingAccessCredential FROM data_sources d LEFT JOIN connections c ON c.env=d.env AND c.id=d.id WHERE d.env=?",
      )
      .all(store.env) as any[];
    for (const id of recovery) {
      const source = sources.find((s) => s.id === id);
      if (source) {
        source.missingAccessCredential = 0;
        source.status = "revoke_required";
      } else
        sources.push({
          id,
          provider: "plaid",
          label: "Access revocation required",
          status: "revoke_required",
          requested_days: null,
          last_checked: null,
          missingAccessCredential: 0,
          recoveryOnly: true,
        });
    }
    res.json({
      environment: store.env,
      aliases: store.repository.aliases(),
      accounts: [
        ...new Map(
          store.repository.listAccounts().map((a) => [
            a.id,
            {
              ...a,
              stale: raw
                .filter((r) => r.canonicalAccountId === a.id)
                .every(
                  (r) =>
                    sources.find((s) => s.id === r.connection)?.status ===
                    "historical",
                ),
              mask:
                raw.find((r) => r.canonicalAccountId === a.id)?.mask ?? null,
            },
          ]),
        ).values(),
      ],
      institutions: store.db
        .prepare("SELECT id,name,provisional FROM app_institutions WHERE env=?")
        .all(store.env),
      sources,
    });
  });
  app.post("/api/accounts/:id/preferences", (req, res) => {
    const { name, included } = req.body ?? {};
    if (
      typeof name !== "string" ||
      !name.trim() ||
      name.trim().length > 120 ||
      typeof included !== "boolean"
    )
      return res.status(400).json({
        error: "Enter a name (1–120 characters) and budgeting inclusion.",
      });
    const result = store.db
      .prepare("UPDATE app_accounts SET name=?,included=? WHERE env=? AND id=?")
      .run(name.trim(), Number(included), store.env, req.params.id);
    if (!result.changes)
      return res.status(404).json({ error: "Account not found." });
    res.json({ ok: true });
  });
  for (const [route, table, column] of [
    ["institutions", "app_institutions", "name"],
    ["data-sources", "data_sources", "label"],
  ]) {
    app.post(`/api/${route}/:id/name`, (req, res) => {
      const name = req.body?.name;
      if (typeof name !== "string" || !name.trim() || name.trim().length > 120)
        return res
          .status(400)
          .json({ error: "Enter a name between 1 and 120 characters." });
      const result = store.db
        .prepare(`UPDATE ${table} SET ${column}=? WHERE env=? AND id=?`)
        .run(name.trim(), store.env, req.params.id);
      if (!result.changes) return res.status(404).json({ error: "Not found." });
      res.json({ ok: true });
    });
  }
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
        "SELECT d.id,d.provider,d.label,d.status,d.requested_days,d.last_checked,s.provider_account_id,CASE WHEN c.token IS NULL THEN 1 ELSE 0 END AS missingAccessCredential FROM source_accounts s JOIN data_sources d ON d.env=s.env AND d.id=s.source_id LEFT JOIN connections c ON c.env=d.env AND c.id=d.id WHERE s.env=? AND s.account_id=?",
      )
      .all(store.env, account.id);
    res.json({
      account,
      sources: (sources as any[]).map((source) => ({
        ...source,
        missingAccessAction:
          source.missingAccessCredential && source.status !== "historical"
            ? "Revoke access externally, then confirm using resolve-missing-access."
            : null,
      })),
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
