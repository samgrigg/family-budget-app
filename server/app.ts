import { flowState } from "./flow";
import { incomeState } from "./income";
import { transferState, transactionKey } from "./transfers";
import { installBills, billState } from "./bills";
import express from "express";
import { randomBytes, timingSafeEqual } from "node:crypto";
import type { Store } from "./store";
import type { Provider } from "./plaid";
import { syncConnection } from "./sync";
export function createApp(
  store: Store,
  provider: Provider,
  origin: string,
  redirectUri?: string,
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
    if (status === "review")
      store.db
        .prepare("DELETE FROM transfer_decisions WHERE env=? AND key=?")
        .run(store.env, key);
    else
      store.db
        .prepare(
          "INSERT INTO transfer_decisions VALUES(?,?,?) ON CONFLICT(env,key) DO UPDATE SET status=excluded.status",
        )
        .run(store.env, key, status);
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
    if (status === "review")
      store.db
        .prepare("DELETE FROM income_decisions WHERE env=? AND key=?")
        .run(store.env, key);
    else
      store.db
        .prepare(
          "INSERT INTO income_decisions VALUES(?,?,?,?) ON CONFLICT(env,key) DO UPDATE SET name=excluded.name,status=excluded.status",
        )
        .run(store.env, key, name.trim(), status);
    res.json({ ok: true });
  });
  app.get("/api/bills", (req, res) => {
    const months = Number(req.query.months ?? 6);
    if (![3, 6, 12].includes(months))
      return res.status(400).json({ error: "Choose 3, 6, or 12 months." });
    res.json(billState(store, months));
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
    if (status === "review")
      store.db
        .prepare("DELETE FROM bills WHERE env=? AND key=?")
        .run(store.env, key);
    else
      store.db
        .prepare(
          "INSERT INTO bills(env,key,name,status,excluded) VALUES(?,?,?,?,?) ON CONFLICT(env,key) DO UPDATE SET name=excluded.name,status=excluded.status,excluded=excluded.excluded",
        )
        .run(store.env, key, name.trim(), status, JSON.stringify(excluded));
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
        transactions: { days_requested: 90 },
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
      store.connect(r.item_id, token!, []);
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
              "Connection could not be saved or revoked. Keep this app running and use Disconnect & delete to retry. If restarting is necessary, revoke access through your institution or Plaid Portal first.",
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
  app.post("/api/connections/:id/sync", async (req, res, next) => {
    try {
      await exclusive(req.params.id, async () => {
        const token = store.token(req.params.id);
        const { accounts, item } = await provider.call("/accounts/get", {
          access_token: token,
        });
        if (
          item?.institution_id &&
          !store.list().find((c) => c.id === req.params.id)?.institution_name
        ) {
          try {
            const { institution } = await provider.call(
              "/institutions/get_by_id",
              { institution_id: item.institution_id, country_codes: ["US"] },
            );
            if (institution?.name)
              store.nameInstitution(req.params.id, institution.name);
          } catch {
            /* Institution naming must not block transaction imports. */
          }
        }
        await syncConnection(
          store,
          req.params.id,
          (cursor) =>
            provider.call("/transactions/sync", {
              access_token: token,
              cursor,
              count: 500,
            }),
          accounts,
        );
      });
      res.json(state());
    } catch (e) {
      next(e);
    }
  });
  app.post("/api/connections/:id/disconnect", async (req, res, next) => {
    try {
      await exclusive(req.params.id, async () => {
        await provider.call("/item/remove", {
          access_token:
            recovery.get(req.params.id) ?? store.token(req.params.id),
        });
        store.remove(req.params.id);
        recovery.delete(req.params.id);
      });
      res.json(state());
    } catch (e) {
      next(e);
    }
  });
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
          "Your institution needs renewed authorization. Disconnect and connect again.",
        BUSY: "An operation is already running. Please wait.",
        INVALID_CREDENTIALS:
          "Check the Plaid credentials and environment in .env.",
      };
      res.status(code === "BUSY" ? 409 : 502).json({
        error:
          messages[code] ??
          "The request could not finish. Retry; if disconnect failed, the connection remains saved so you can revoke access.",
        code: /^[A-Z_]+$/.test(code) ? code : "REQUEST_FAILED",
      });
    },
  );
  return app;
}
