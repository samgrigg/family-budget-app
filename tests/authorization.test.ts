import { it, expect } from "vitest";
import request from "supertest";
import { Store } from "../server/store";
import { createApp } from "../server/app";
const origin = "http://localhost:3000";
async function fixture() {
  const store = new Store(":memory:", Buffer.alloc(32), "sandbox");
  store.connect("source", "synthetic-access", [
    { account_id: "a", name: "Checking", type: "depository", mask: "1234" },
    { account_id: "b", name: "Savings" },
  ]);
  store.commit(
    "source",
    [
      {
        added: [
          {
            transaction_id: "old",
            account_id: "b",
            name: "Saved purchase",
            date: "2025-01-01",
            amount: 4,
          },
        ],
        modified: [],
        removed: [],
      },
    ],
    "saved-cursor",
    [],
  );
  const calls: { path: string; body: any }[] = [];
  let failure = "";
  let institutionId = "ins_verified";
  let providerName = "Verified Bank";
  let wait: (() => Promise<void>) | undefined;
  let available = [
    {
      account_id: "a",
      name: "Provider Checking",
      type: "depository",
      subtype: "checking",
    },
  ];
  const app = createApp(
    store,
    {
      configured: true,
      call: async (path, body) => {
        calls.push({ path, body });
        if (failure)
          throw Object.assign(Error("synthetic failure"), { code: failure });
        if (path === "/link/token/create")
          return { link_token: "synthetic-link" };
        if (path === "/accounts/get" && wait) await wait();
        if (path === "/accounts/get")
          return {
            accounts: available,
            item: {
              item_id:
                body.access_token === "synthetic-other" ? "second" : "source",
              institution_id: institutionId,
            },
          };
        if (path === "/institutions/get_by_id")
          return {
            institution: {
              institution_id: institutionId,
              name: providerName,
            },
          };
        if (path === "/transactions/sync")
          return {
            added: [],
            modified: [],
            removed: [],
            next_cursor: "next",
            has_more: false,
            transactions_update_status: "HISTORICAL_UPDATE_COMPLETE",
          };
        if (path === "/item/remove") return {};
        throw Error(`unexpected ${path}`);
      },
    },
    origin,
    `${origin}/`,
  );
  const session = await request(app)
    .get("/api/state")
    .set("Host", "localhost:3000");
  const post = (path: string, body: any = {}) =>
    request(app)
      .post(path)
      .set("Host", "localhost:3000")
      .set("Origin", origin)
      .set("Cookie", session.headers["set-cookie"])
      .set("X-CSRF-Token", session.body.csrf)
      .send(body);
  const get = (path: string) =>
    request(app).get(path).set("Host", "localhost:3000");
  return {
    store,
    post,
    get,
    calls,
    fail: (code: string) => {
      failure = code;
    },
    available: (a: any) => {
      available = a;
    },
    institution: (id: string) => {
      institutionId = id;
    },
    providerName: (name: string) => {
      providerName = name;
    },
    pause: (fn: () => Promise<void>) => {
      wait = fn;
    },
  };
}
it("ITEM_LOGIN_REQUIRED records actionable authorization status and keeps history", async () => {
  const f = await fixture();
  f.fail("ITEM_LOGIN_REQUIRED");
  const r = await f.post("/api/data-sources/source/sync");
  expect(r.status).toBe(502);
  expect(r.body.error).toContain("Repair authorization");
  expect(f.store.list()[0].status).toBe("needs_authorization");
  expect(f.store.repository.rawHistory()).toHaveLength(1);
  f.store.db.close();
});
it("repair and account selection create update-mode tokens without products or new Item", async () => {
  const f = await fixture();
  for (const action of ["repair", "select_accounts"]) {
    const r = await f.post("/api/data-sources/source/link-token", { action });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ link_token: "synthetic-link" });
    const body = f.calls.at(-1)!.body;
    expect(body.access_token).toBe("synthetic-access");
    expect(body.products).toBeUndefined();
    expect(body.transactions).toBeUndefined();
    expect(body.redirect_uri).toBe(`${origin}/`);
    expect(body.update).toEqual(
      action === "select_accounts"
        ? { account_selection_enabled: true }
        : undefined,
    );
  }
  expect(
    (await f.post("/api/data-sources/source/link-token", { action: "replace" }))
      .status,
  ).toBe(400);
  f.store.db.close();
});
it("completion verifies same Item, syncs existing cursor and retains deselected account mappings and decisions", async () => {
  const f = await fixture();
  const before = f.store.repository.aliases();
  const account = before.find((a) => a.provider_account_id === "a")!.account_id;
  f.store.db
    .prepare(
      "UPDATE app_accounts SET name='Owner checking' WHERE env=? AND id=?",
    )
    .run("sandbox", account);
  f.store.repository.writeDecision("bills", {
    key: "synthetic-preserved-key",
    name: "Owner bill",
    status: "confirmed",
    excluded: ["saved-event"],
  });
  const decisions = f.store.db.prepare("SELECT * FROM bills").all();
  const r = await f.post("/api/data-sources/source/authorization-complete");
  expect(r.status).toBe(200);
  expect(f.calls.map((c) => c.path)).not.toContain(
    "/item/public_token/exchange",
  );
  expect(
    f.calls.find((c) => c.path === "/transactions/sync")!.body.cursor,
  ).toBe("saved-cursor");
  expect(f.store.db.prepare("SELECT * FROM bills").all()).toEqual(decisions);
  expect(f.store.repository.aliases()).toEqual(before);
  expect(f.store.repository.rawHistory()).toHaveLength(1);
  expect(
    f.store.repository.listAccounts().find((a) => a.id === account)!.name,
  ).toBe("Owner checking");
  const index = (await f.get("/api/accounts")).body;
  expect(
    index.accounts.find(
      (a: any) =>
        a.id === before.find((x) => x.provider_account_id === "b")!.account_id,
    ).stale,
  ).toBe(true);
  expect(f.store.repository.accounts().find((a) => a.id === "b").shared).toBe(
    false,
  );
  expect(JSON.stringify(r.body)).not.toContain("synthetic-access");
  expect(
    (await f.post("/api/data-sources/source/authorization-complete")).status,
  ).toBe(200);
  expect(f.store.list()).toHaveLength(1);
  f.store.db.close();
});
it("server failure is retryable and late completion cannot resurrect a disconnected source", async () => {
  const f = await fixture();
  f.fail("INSTITUTION_DOWN");
  expect(
    (await f.post("/api/data-sources/source/authorization-complete")).status,
  ).toBe(502);
  expect(f.store.connection("source").cursor).toBe("saved-cursor");
  f.fail("");
  expect(
    (await f.post("/api/data-sources/source/authorization-complete")).status,
  ).toBe(200);
  await f.post("/api/data-sources/source/disconnect");
  const n = f.calls.length;
  expect(
    (await f.post("/api/data-sources/source/authorization-complete")).status,
  ).toBe(409);
  expect(
    (await f.post("/api/data-sources/source/link-token", { action: "repair" }))
      .status,
  ).toBe(409);
  expect(f.calls).toHaveLength(n);
  expect(f.store.connection("source").token).toBeNull();
  f.store.db.close();
});
it("verified institution IDs consolidate aliases without name matching or overwriting owner names", async () => {
  const f = await fixture();
  const original = f.store.repository.listAccounts()[0].institutionId;
  f.store.db
    .prepare(
      "UPDATE app_institutions SET name='Owner bank' WHERE env=? AND id=?",
    )
    .run("sandbox", original);
  f.store.nameInstitution("source", "Household membership", true);
  await f.post("/api/data-sources/source/sync");
  expect(
    f.store.db
      .prepare(
        "SELECT * FROM institution_aliases WHERE env=? AND provider_id=?",
      )
      .get("sandbox", "ins_verified"),
  ).toMatchObject({ institution_id: original });
  expect(
    f.store.db
      .prepare("SELECT * FROM app_institutions WHERE env=? AND id=?")
      .get("sandbox", original),
  ).toMatchObject({ name: "Owner bank", provisional: 0 });
  f.store.connect("second", "synthetic-other", [
    { account_id: "c", name: "Other" },
  ]);
  const secondInstitution = f.store.repository
    .accounts()
    .find((a) => a.id === "c").institutionId;
  f.store.db
    .prepare(
      "UPDATE app_institutions SET name='Other owner name' WHERE env=? AND id=?",
    )
    .run("sandbox", secondInstitution);
  // Both source accounts are verified by the provider as belonging to one bank.
  await f.post("/api/data-sources/second/sync");
  const index = (await f.get("/api/accounts")).body;
  expect(index.institutions).toHaveLength(1);
  expect(index.institutions[0].name).toBe("Owner bank");
  expect(
    f.store.db
      .prepare("SELECT name FROM app_institutions WHERE env=? AND id=?")
      .get("sandbox", secondInstitution),
  ).toEqual({ name: "Other owner name" });
  expect(index.sources.every((s: any) => s.institution_id === original)).toBe(
    true,
  );
  expect(index.sources.find((s: any) => s.id === "source").label).toBe(
    "Household membership",
  );
  expect(f.store.repository.accounts().find((a) => a.id === "a")).toMatchObject(
    { type: "depository", subtype: "checking", ownership: null },
  );
  f.store.db.close();
});
it("does not erase deselected account history when provider sends removed records", async () => {
  const f = await fixture();
  await f.post("/api/data-sources/source/authorization-complete");
  f.store.commit(
    "source",
    [{ added: [], modified: [], removed: [{ transaction_id: "old" }] }],
    "removed",
    [{ account_id: "a", name: "Checking" }],
    true,
  );
  expect(f.store.repository.rawHistory()).toHaveLength(1);
  expect(
    f.store.repository.coverage(
      f.store.repository.aliases().find((a) => a.provider_account_id === "b")!
        .account_id,
    )[0].importState,
  ).toBe("no_longer_shared");
  f.store.db.close();
});

it("same display name with different verified institution IDs never merges institutions", async () => {
  const f = await fixture();
  await f.post("/api/data-sources/source/sync");
  f.store.connect("second", "synthetic-other", [
    { account_id: "credit", name: "Card", type: "credit" },
  ]);
  f.institution("ins_different");
  f.available([
    {
      account_id: "credit",
      name: "Card",
      type: "credit",
      subtype: "credit card",
    },
  ]);
  expect((await f.post("/api/data-sources/second/sync")).status).toBe(200);
  const index = (await f.get("/api/accounts")).body;
  expect(index.institutions).toHaveLength(2);
  expect(new Set(index.sources.map((s: any) => s.institution_id)).size).toBe(2);
  expect(
    f.store.repository.accounts().find((a) => a.id === "credit"),
  ).toMatchObject({ type: "credit", subtype: "credit card", ownership: null });
  f.store.db.close();
});
it("concurrent authorization completion and disconnect serialize without resurrecting access", async () => {
  const f = await fixture();
  let release!: () => void;
  let entered!: () => void;
  const waiting = new Promise<void>((r) => {
    release = r;
  });
  const started = new Promise<void>((r) => {
    entered = r;
  });
  f.pause(async () => {
    entered();
    await waiting;
  });
  const completing = f
    .post("/api/data-sources/source/authorization-complete")
    .then((r) => r);
  await started;
  expect((await f.post("/api/data-sources/source/disconnect")).body.code).toBe(
    "BUSY",
  );
  release();
  expect((await completing).status).toBe(200);
  expect((await f.post("/api/data-sources/source/disconnect")).status).toBe(
    200,
  );
  expect(
    (await f.post("/api/data-sources/source/authorization-complete")).status,
  ).toBe(409);
  expect(f.store.connection("source").token).toBeNull();
  f.store.db.close();
});

it("keeps an existing verified institution display name when provider branding changes", async () => {
  const f = await fixture();
  await f.post("/api/data-sources/source/sync");
  f.providerName("New provider branding");
  await f.post("/api/data-sources/source/sync");
  expect((await f.get("/api/accounts")).body.institutions[0].name).toBe(
    "Verified Bank",
  );
  f.store.db.close();
});
it("requests only additional card consent in update mode while preserving repair behavior", async () => {
  const f = await fixture();
  const response = await f.post("/api/data-sources/source/link-token", {
    action: "card_data",
  });
  expect(response.status).toBe(200);
  const body = f.calls.find((c) => c.path === "/link/token/create")!.body;
  expect(body.additional_consented_products).toEqual(["liabilities"]);
  expect(body.products).toBeUndefined();
  expect(body.update).toBeUndefined();
  f.store.db.close();
});

it("refreshes cached balances through the existing protected sync action", async () => {
  const f = await fixture();
  f.available([
    {
      account_id: "a",
      name: "Checking",
      type: "depository",
      balances: { current: 2500.5, available: 2400, iso_currency_code: "USD" },
    },
  ]);
  const before = (await f.get("/api/accounts")).body.accounts.find(
    (a: any) => a.name === "Checking",
  );
  expect(before.balance).toBeNull();
  expect((await f.post("/api/data-sources/source/sync")).status).toBe(200);
  const after = (await f.get("/api/accounts")).body.accounts.find(
    (a: any) => a.id === before.id,
  );
  expect(after.balance).toMatchObject({
    current: "2500.5",
    available: "2400",
    currency: "USD",
  });
  expect(f.calls.filter((c) => c.path === "/accounts/get")).toHaveLength(1);
  expect(f.calls.some((c) => c.path === "/accounts/balance/get")).toBe(false);
  f.fail("ITEM_LOGIN_REQUIRED");
  expect((await f.post("/api/data-sources/source/sync")).status).not.toBe(200);
  expect(
    (await f.get("/api/accounts")).body.accounts.find(
      (a: any) => a.id === before.id,
    ).balance,
  ).toMatchObject({ current: "2500.5", stale: true });
  f.store.db.close();
});
