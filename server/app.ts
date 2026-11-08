import { installBillPlanApi, annotateRepayments, type Plan } from "./bill-plan";
import { installReplacementApi } from "./source-replacements";
import { flowState } from "./flow";
import { incomeState } from "./income";
import { transferState, transactionKey } from "./transfers";
import { installBills, billState } from "./bills";
import express from "express";
import { installAccountApi } from "./accounts-api";
import { randomBytes, timingSafeEqual } from "node:crypto";
import type { Store } from "./store";
import type { Provider } from "./plaid";
import { syncConnection } from "./sync";
export function createApp(
  store: Store,
  provider: Provider,
  origin: string,
  redirectUri?: string,
  billDrafts: Plan[] = [],
) {
  const app = express();
  installBills(store);
  app.disable("x-powered-by");
  const sessions = new Map<string, { csrf: string; expires: number }>();
  const active = new Set<string>();
  const recovery = new Map<string, string>();
  app.use((req, res, next) => {
    res.set({
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Content-Security-Policy":
        "default-src 'self'; script-src 'self' https://cdn.plaid.com; connect-src 'self' https://*.plaid.com; frame-src https://*.plaid.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://*.plaid.com; frame-ancestors 'none'; base-uri 'self'",
    });
    if (req.headers.host !== new URL(origin).host)
      return res.status(403).json({ error: "Unrecognized host" });
    next();
  });
  app.use("/api", express.json({ limit: "16kb" }));
  app.use("/api", (req, res, next) => {
    const sid = req.headers.cookie
      ?.split("; ")
      .find((v) => v.startsWith("budget_session="))
      ?.split("=")[1];
    let session = sid ? sessions.get(sid) : undefined;
    if (session && session.expires < Date.now()) {
      sessions.delete(sid!);
      session = undefined;
    }
    if (req.method === "GET" && req.path === "/state" && !session) {
      for (const [id, s] of sessions)
        if (s.expires < Date.now()) sessions.delete(id);
      const id = randomBytes(32).toString("hex");
      session = {
        csrf: randomBytes(32).toString("hex"),
        expires: Date.now() + 86400000,
      };
      sessions.set(id, session);
      res.cookie("budget_session", id, {
        httpOnly: true,
        sameSite: "strict",
        secure: origin.startsWith("https:"),
        maxAge: 86400000,
      });
    }
    if (req.method !== "GET") {
      const token = req.get("X-CSRF-Token") ?? "";
      if (
        req.get("Origin") !== origin ||
        !session ||
        token.length !== session.csrf.length ||
        !timingSafeEqual(Buffer.from(token), Buffer.from(session.csrf))
      )
        return res
          .status(403)
          .json({ error: "Reload the app to renew your secure session." });
    }
    res.locals.csrf = session?.csrf;
    next();
  });
  const state = () => {
    const transfers = transferState(store);
    const confirmed = new Set(
      transfers.confirmed.flatMap((p) => [
        transactionKey(p.out),
        transactionKey(p.into),
      ]),
    );
    return {
      environment: store.env,
      configured: provider.configured,
      connections: [
        ...store.list(),
        ...Array.from(recovery.keys(), (id) => ({
          id,
          status: "revoke_required",
          last_sync: null,
        })),
      ],
      dataIssues: store.repository.dataIssues(),
      accounts: store.accountList(),
      transfers,
      transactions: store.transactions().map((t) => ({
        ...t,
        internal_transfer: confirmed.has(transactionKey(t)),
      })),
    };
  };
  app.post("/api/transfers", (req, res) => {
    const { key, status } = req.body ?? {};
    if (
      typeof key !== "string" ||
      !["confirmed", "rejected", "review"].includes(status)
    )
      return res.status(400).json({ error: "Invalid transfer decision." });
    const current = transferState(store);
    if (
      ![...current.confirmed, ...current.review, ...current.rejected].some(
        (p) => p.key === key,
      )
    )
      return res
        .status(409)
        .json({ error: "This match changed. Reload and review it again." });
    const pair = [
      ...current.confirmed,
      ...current.review,
      ...current.rejected,
    ].find((p) => p.key === key)!;
    if (
      status === "confirmed" &&
      current.confirmed.some(
        (p) =>
          p.key !== key &&
          [p.out, p.into].some((t) =>
            [pair.out, pair.into].some(
              (other) => transactionKey(t) === transactionKey(other),
            ),
          ),
      )
    )
      return res.status(409).json({
        error:
          "A transaction already belongs to another transfer. Undo that match first.",
      });
    store.repository.writeDecision("transfer_decisions", { key, status });
    res.json(state());
  });
  app.get("/api/state", (_req, res) =>
    res.json({ ...state(), csrf: res.locals.csrf }),
  );
  app.post("/api/accounts/visibility", (req, res) => {
    const { connection, account, hidden } = req.body ?? {};
    if (
      typeof connection !== "string" ||
      typeof account !== "string" ||
      typeof hidden !== "boolean"
    )
      return res.status(400).json({ error: "Invalid account details." });
    if (!store.setAccountHidden(connection, account, hidden))
      return res.status(404).json({ error: "Account not found." });
    res.json(state());
  });
  app.get("/api/flow", (req, res) => {
    const month = String(
        req.query.month ?? new Date().toISOString().slice(0, 7),
      ),
      currency = String(req.query.currency ?? "USD");
    if (
      !/^\d{4}-(0[1-9]|1[0-2])$/.test(month) ||
      !/^[A-Za-z0-9]{1,12}$/.test(currency)
    )
      return res
        .status(400)
        .json({ error: "Choose a valid month and currency." });
    res.json(flowState(store, month, currency));
  });
  app.get("/api/income", (_req, res) => res.json(incomeState(store)));
  app.post("/api/income", (req, res) => {
    const { key, name, status } = req.body ?? {};
    if (
      typeof key !== "string" ||
      typeof name !== "string" ||
      !name.trim() ||
      name.length > 120 ||
      !["saved", "dismissed", "review"].includes(status)
    )
      return res.status(400).json({ error: "Invalid income details." });
    const current = incomeState(store);
    if (
      ![...current.suggestions, ...current.saved, ...current.dismissed].some(
        (b) => b.key === key,
      )
    )
      return res.status(409).json({
        error: "This income source changed. Refresh and review it again.",
      });
    store.repository.writeDecision("income_decisions", {
      key,
      name: name.trim(),
      status,
    });
    res.json({ ok: true });
  });
  installBillPlanApi(app, store, billDrafts);
  app.get("/api/bills", (req, res) => {
    const months = Number(req.query.months ?? 6);
    if (![3, 6, 12].includes(months))
      return res.status(400).json({ error: "Choose 3, 6, or 12 months." });
    res.json(annotateRepayments(store, billState(store, months)));
  });
  app.post("/api/bills", (req, res) => {
    const { key, name, status, excluded = [] } = req.body ?? {};
    if (
      typeof key !== "string" ||
      typeof name !== "string" ||
      !name.trim() ||
      name.length > 120 ||
      !["saved", "dismissed", "review"].includes(status) ||
      !Array.isArray(excluded) ||
      excluded.some((v: any) => typeof v !== "string")
    )
      return res.status(400).json({ error: "Invalid bill details." });
    const months = Number(req.body.months ?? 6);
    if (![3, 6, 12].includes(months))
      return res.status(400).json({ error: "Choose 3, 6, or 12 months." });
    const current = billState(store, months);
    const known = [
      ...current.suggestions,
      ...current.saved,
      ...current.dismissed,
    ].some((b) => b.key === key);
    if (!known)
      return res.status(400).json({
        error: "This suggestion is no longer available. Refresh and try again.",
      });
    store.repository.writeDecision("bills", {
      key,
      name: name.trim(),
      status,
      excluded,
    });
    res.json({ ok: true });
  });
  app.post("/api/link-token", async (_req, res, next) => {
    try {
      const r = await provider.call("/link/token/create", {
        user: { client_user_id: `family-budget-${store.env}` },
        client_name: "Family Budget",
        products: ["transactions"],
        country_codes: ["US"],
        language: "en",
        transactions: { days_requested: 365 },
        ...(redirectUri ? { redirect_uri: redirectUri } : {}),
      });
      res.json({ link_token: r.link_token });
    } catch (e) {
      next(e);
    }
  });
  app.post("/api/connect", async (req, res, next) => {
    let token: string | undefined;
    let itemId: string | undefined;
    let saved = false;
    try {
      if (
        typeof req.body?.public_token !== "string" ||
        req.body.public_token.length > 1000
      )
        return res.status(400).json({ error: "Missing public token" });
      const r = await provider.call("/item/public_token/exchange", {
        public_token: req.body.public_token,
      });
      token = r.access_token;
      itemId = r.item_id;
      store.connect(r.item_id, token!, [], 365);
      saved = true;
      res.json(state());
    } catch (e) {
      if (token && itemId && !saved) {
        try {
          await provider.call("/item/remove", { access_token: token });
        } catch {
          recovery.set(itemId, token);
          return res.status(502).json({
            ...state(),
            error:
              "Connection could not be saved or revoked. Keep this app running and use Disconnect to retry. If restarting is necessary, revoke access through your institution or Plaid Portal first.",
          });
        }
      }
      next(e);
    }
  });
  async function exclusive(id: string, fn: () => Promise<void>) {
    if (active.has(id)) throw Object.assign(Error(), { code: "BUSY" });
    active.add(id);
    try {
      await fn();
    } finally {
      active.delete(id);
    }
  }
  app.post("/api/connections/:id/name", (req, res) => {
    const name = req.body?.name;
    if (typeof name !== "string" || !name.trim() || name.trim().length > 120)
      return res
        .status(400)
        .json({ error: "Enter a name between 1 and 120 characters." });
    if (!store.list().some((c) => c.id === req.params.id))
      return res.status(404).json({ error: "Institution not found." });
    store.nameInstitution(req.params.id, name.trim(), true);
    res.json(state());
  });
  async function syncSource(id: string) {
    const token = store.token(id);
    try {
      const { accounts, item } = await provider.call("/accounts/get", {
        access_token: token,
      });
      if (!Array.isArray(accounts))
        throw Error("Invalid provider accounts response");
      if (item?.item_id !== id) throw Error("Provider Item mismatch");
      let name: string | undefined;
      if (typeof item?.institution_id === "string") {
        try {
          const { institution } = await provider.call(
            "/institutions/get_by_id",
            {
              institution_id: item.institution_id,
              country_codes: ["US"],
              options: { include_optional_metadata: true },
            },
          );
          if (
            institution?.institution_id === item.institution_id &&
            typeof institution.name === "string"
          )
            name = institution.name;
        } catch {
          /* Display metadata must not block imports. */
        }
      }
      await syncConnection(
        store,
        id,
        (cursor) =>
          provider.call("/transactions/sync", {
            access_token: token,
            cursor,
            count: 500,
          }),
        accounts,
        true,
      );
      if (typeof item?.institution_id === "string")
        store.verifiedInstitution(id, item.institution_id, name);
    } catch (error: any) {
      if (error.code === "ITEM_LOGIN_REQUIRED")
        store.sourceStatus(id, "needs_authorization");
      throw error;
    }
  }
  app.post("/api/data-sources/:id/link-token", async (req, res, next) => {
    const id = String(req.params.id);
    if (!["repair", "select_accounts"].includes(req.body?.action))
      return res.status(400).json({
        error: "Choose Repair authorization or Review shared accounts.",
      });
    if (!store.list().some((s) => s.id === id))
      return res.status(404).json({ error: "Source not found." });
    try {
      let result: any;
      await exclusive(id, async () => {
        if (store.connection(id).status === "revoke_required")
          throw Object.assign(Error(), { code: "DISCONNECTED" });
        result = await provider.call("/link/token/create", {
          user: { client_user_id: `family-budget-${store.env}` },
          client_name: "Family Budget",
          country_codes: ["US"],
          language: "en",
          access_token: store.token(id),
          ...(req.body.action === "select_accounts"
            ? { update: { account_selection_enabled: true } }
            : {}),
          ...(redirectUri ? { redirect_uri: redirectUri } : {}),
        });
      });
      res.json({ link_token: result.link_token });
    } catch (error) {
      next(error);
    }
  });
  app.post(
    [
      "/api/connections/:id/sync",
      "/api/data-sources/:id/sync",
      "/api/data-sources/:id/authorization-complete",
    ],
    async (req, res, next) => {
      const id = String(req.params.id);
      if (!store.list().some((s) => s.id === id))
        return res.status(404).json({ error: "Source not found." });
      try {
        await exclusive(id, async () => {
          if (store.connection(id).status === "revoke_required")
            throw Object.assign(Error(), { code: "DISCONNECTED" });
          await syncSource(id);
        });
        res.json(state());
      } catch (error) {
        next(error);
      }
    },
  );
  app.post(
    "/api/data-sources/:id/resolve-missing-access",
    async (req, res, next) => {
      if (req.body?.confirmAccessRevoked !== true)
        return res.status(400).json({
          error:
            "First revoke this source's access through your institution or Plaid Portal. Then explicitly confirm external revocation with confirmAccessRevoked: true. Missing credentials alone do not establish revocation.",
        });
      const id = String(req.params.id);
      try {
        let result: string | undefined;
        await exclusive(id, async () => {
          result = recovery.has(id)
            ? "credential_present"
            : store.resolveMissingAccess(id);
        });
        if (result === "missing")
          return res.status(404).json({ error: "Source not found." });
        if (result === "credential_present")
          return res.status(409).json({
            error:
              "This source still has an access credential. Use Disconnect to revoke access.",
            code: "CREDENTIAL_PRESENT",
          });
        res.json({
          sourceId: id,
          status: "historical",
          authorizationBasis: "owner_confirmed_external_revocation",
          providerRevocationVerified: false,
          notice:
            "Historical status records your confirmation that access was revoked externally. This app did not verify provider revocation. Saved history remains available.",
        });
      } catch (error) {
        next(error);
      }
    },
  );
  installAccountApi(app, store, () => [...recovery.keys()]);
  installReplacementApi(
    app,
    store,
    provider,
    exclusive,
    syncSource,
    redirectUri,
    recovery,
  );
  // Compatibility alias: disconnect now preserves all local history.
  app.post(
    ["/api/connections/:id/disconnect", "/api/data-sources/:id/disconnect"],
    async (req, res, next) => {
      const id = String(req.params.id);
      if (!recovery.has(id) && !store.list().some((c) => c.id === id))
        return res.status(404).json({ error: "Source not found." });
      try {
        await exclusive(id, async () => {
          const saved = store.list().some((c) => c.id === id);
          if (
            saved &&
            store.connection(id).status === "historical" &&
            !recovery.has(id)
          )
            return;
          try {
            await provider.call("/item/remove", {
              access_token: recovery.get(id) ?? store.token(id),
            });
          } catch (error: any) {
            // A previous successful removal followed by a local write failure is retryable.
            if (error.code !== "ITEM_NOT_FOUND") {
              if (saved) store.sourceStatus(id, "revoke_required");
              throw error;
            }
          }
          if (saved) store.sourceStatus(id, "historical", true);
          recovery.delete(id);
        });
        res.json(state());
      } catch (e) {
        next(e);
      }
    },
  );
  app.use("/api", (_req, res) =>
    res.status(404).json({ error: "Unknown API route" }),
  );
  app.use(
    (
      err: any,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      const code = String(err.code ?? "REQUEST_FAILED");
      const messages: Record<string, string> = {
        NOT_CONFIGURED: "Add your Plaid credentials to .env and restart.",
        ITEM_LOGIN_REQUIRED:
          "Your institution needs renewed authorization. Use Repair authorization in Manage data access.",
        DISCONNECTED:
          "This source is disconnected. Its saved history remains available.",
        BUSY: "An operation is already running. Please wait.",
        INVALID_CREDENTIALS:
          "Check the Plaid credentials and environment in .env.",
      };
      res.status(["BUSY", "DISCONNECTED"].includes(code) ? 409 : 502).json({
        error:
          messages[code] ??
          "The request could not finish. Retry; if disconnect failed, the connection remains saved so you can revoke access.",
        code: /^[A-Z_]+$/.test(code) ? code : "REQUEST_FAILED",
      });
    },
  );
  return app;
}
