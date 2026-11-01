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
  const state = () => ({
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
    transactions: store.transactions(),
  });
  app.get("/api/state", (_req, res) =>
    res.json({ ...state(), csrf: res.locals.csrf }),
  );
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
  app.post("/api/connections/:id/sync", async (req, res, next) => {
    try {
      await exclusive(req.params.id, async () => {
        const token = store.token(req.params.id);
        const { accounts } = await provider.call("/accounts/get", {
          access_token: token,
        });
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
