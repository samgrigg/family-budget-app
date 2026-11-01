import { mkdirSync, readFileSync, chmodSync } from "node:fs";
import { createServer as httpServer } from "node:http";
import { createServer as httpsServer } from "node:https";
import express from "express";
import { Store } from "./store";
import { Plaid } from "./plaid";
import { createApp } from "./app";
process.umask(0o077);
const env = process.env.PLAID_ENV ?? "sandbox";
const origin = process.env.APP_ORIGIN ?? "http://localhost:3000";
const url = new URL(origin);
if (
  !["localhost", "127.0.0.1"].includes(url.hostname) ||
  url.pathname !== "/" ||
  url.search ||
  url.hash ||
  url.username ||
  url.password
)
  throw Error("APP_ORIGIN must be a localhost origin");
const tls = url.protocol === "https:";
if (!["http:", "https:"].includes(url.protocol))
  throw Error("Unsupported APP_ORIGIN protocol");

const rawKey = process.env.TOKEN_ENCRYPTION_KEY;
if (!rawKey || !/^[a-f0-9]{64}$/i.test(rawKey))
  throw Error(
    "Set TOKEN_ENCRYPTION_KEY to 32 random bytes encoded as hex. See README.",
  );
mkdirSync("data", { recursive: true, mode: 0o700 });
const store = new Store("data/budget.sqlite", Buffer.from(rawKey, "hex"), env);
chmodSync("data/budget.sqlite", 0o600);
const provider = new Plaid(
  env,
  process.env.PLAID_CLIENT_ID ?? "",
  process.env.PLAID_SECRET ?? "",
);
// Desktop localhost production uses popup OAuth without a redirect URI.
const redirect =
  env === "production" && !tls ? undefined : process.env.PLAID_REDIRECT_URI;
if (redirect && redirect !== `${origin}/`)
  throw Error("PLAID_REDIRECT_URI must equal APP_ORIGIN followed by /");

const app = createApp(store, provider, origin, redirect);
if (process.env.NODE_ENV !== "production") {
  const { createServer } = await import("vite");
  const vite = await createServer({
    server: { middlewareMode: true, hmr: false },
    appType: "spa",
  } as any);
  app.use(vite.middlewares);
} else {
  app.use(express.static("dist"));
  app.get("/{*path}", (_req, res) =>
    res.sendFile("dist/index.html", { root: process.cwd() }),
  );
}
const server = tls
  ? httpsServer(
      {
        key: readFileSync(
          process.env.TLS_KEY_PATH ?? "certs/localhost-key.pem",
        ),
        cert: readFileSync(process.env.TLS_CERT_PATH ?? "certs/localhost.pem"),
      },
      app,
    )
  : httpServer(app);
server.listen(Number(url.port || (tls ? 443 : 80)), "127.0.0.1", () =>
  console.log(`Family Budget: ${origin} (${env})`),
);
