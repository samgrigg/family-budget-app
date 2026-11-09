import { it, expect } from "vitest";
import request from "supertest";
import { Store } from "../server/store";
import { createApp } from "../server/app";
import { syncConnection } from "../server/sync";
const origin = "http://localhost:3000";
async function fixture(fail = false) {
  const store = new Store(":memory:", Buffer.alloc(32), "sandbox");
  store.connect("source", "test-secret", [
    { account_id: "a", name: "Checking" },
    { account_id: "b", name: "Savings" },
  ]);
  store.commit(
    "source",
    [
      {
        added: [
          {
            transaction_id: "tx",
            account_id: "a",
            date: "2025-01-01",
            name: "Original",
            amount: 3,
          },
        ],
        modified: [],
        removed: [],
      },
    ],
    "cursor",
    [],
  );
  let calls = 0;
  const app = createApp(
    store,
    {
      configured: true,
      call: async () => {
        calls++;
        if (fail) throw Error("upstream");
        return {};
      },
    },
    origin,
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
  return {
    store,
    app,
    post,
    calls: () => calls,
    allowRevoke: () => {
      fail = false;
    },
  };
}
it("disconnect preserves canonical history, removes token and prevents sync", async () => {
  const f = await fixture();
  const before = f.store.repository.analyticalHistory("all");
  expect((await f.post("/api/data-sources/source/disconnect")).status).toBe(
    200,
  );
  expect(f.store.connection("source").token).toBeNull();
  expect(f.store.repository.analyticalHistory("all")).toEqual(before);
  expect(f.store.list()[0].status).toBe("historical");
  expect((await f.post("/api/connections/source/sync")).status).toBe(409);
  await expect(
    syncConnection(f.store, "source", async () => {
      throw Error("must not fetch");
    }),
  ).rejects.toThrow("disconnected");
  expect((await f.post("/api/data-sources/source/sync")).status).toBe(409);
  expect((await f.post("/api/data-sources/source/disconnect")).status).toBe(
    200,
  );
  expect(f.calls()).toBe(1);
  f.store.db.close();
});
it("failed revocation retains encrypted token and supports retry", async () => {
  const f = await fixture(true);
  const encrypted = f.store.connection("source").token;
  expect((await f.post("/api/data-sources/source/disconnect")).status).toBe(
    502,
  );
  expect(f.store.connection("source").token).toBe(encrypted);
  expect(f.store.token("source")).toBe("test-secret");
  expect(f.store.list()[0].status).toBe("revoke_required");
  f.allowRevoke();
  expect((await f.post("/api/data-sources/source/disconnect")).status).toBe(
    200,
  );
  expect(f.store.connection("source").token).toBeNull();
  f.store.db.close();
});
it("account deletion is confirmed, guards all mappings and leaves another account", async () => {
  const f = await fixture();
  const [a, b] = f.store.repository.listAccounts();
  expect((await f.post(`/api/accounts/${a.id}/delete`)).status).toBe(400);
  expect(
    (await f.post(`/api/accounts/${a.id}/delete`, { confirm: true })).status,
  ).toBe(409);
  await f.post("/api/data-sources/source/disconnect");
  expect(
    (await f.post(`/api/accounts/${a.id}/delete`, { confirm: true })).status,
  ).toBe(200);
  expect(f.store.repository.listAccounts().map((a) => a.id)).toEqual([b.id]);
  expect(f.store.repository.analyticalHistory("all")).toEqual([]);
  f.store.db.close();
});
it("account detail uses canonical IDs and rejects invalid pagination", async () => {
  const f = await fixture();
  const a = f.store.repository.listAccounts()[0];
  const get = (path: string) =>
    request(f.app).get(path).set("Host", "localhost:3000");
  expect((await get(`/api/accounts/${a.id}`)).body.account.id).toBe(a.id);
  for (const query of [
    "limit=0",
    "limit=1.5",
    "limit=201",
    "cursor=bad",
    "cursor=",
  ])
    expect((await get(`/api/accounts/${a.id}?${query}`)).status).toBe(400);
  expect((await get("/api/accounts/a")).status).toBe(404);
  f.store.db.close();
});

it("deletion guards every linked source and preserves unrelated decisions", async () => {
  const f = await fixture();
  const account = f.store.repository.listAccounts()[0];
  f.store.connect("other", "stub", [
    { account_id: "linked", name: "Checking" },
  ]);
  f.store.db
    .prepare("UPDATE source_accounts SET account_id=? WHERE source_id='other'")
    .run(account.id);
  f.store.db
    .prepare("INSERT INTO bills VALUES(?,?,?,?,?)")
    .run("sandbox", "unrelated-key", "Other account bill", "saved", "[]");
  await f.post("/api/data-sources/source/disconnect");
  expect(
    (await f.post(`/api/accounts/${account.id}/delete`, { confirm: true }))
      .status,
  ).toBe(409);
  await f.post("/api/data-sources/other/disconnect");
  const result = await f.post(`/api/accounts/${account.id}/delete`, {
    confirm: true,
  });
  expect(result.status).toBe(200);
  expect(result.body.deletionEffects.reviewAndAuditRecordsRetained).toBe(true);
  expect(
    f.store.db
      .prepare("SELECT name FROM bills WHERE key='unrelated-key'")
      .get(),
  ).toEqual({ name: "Other account bill" });
  f.store.db.close();
});

it("requires explicit external revocation for migrated orphan sources", async () => {
  const f = await fixture();
  f.store.db.prepare("DELETE FROM connections WHERE id='source'").run();
  // Recreate the migration-origin shape: raw legacy account/transaction evidence only.
  for (const table of [
    "source_accounts",
    "account_id_aliases",
    "app_accounts",
    "data_sources",
  ])
    f.store.db.prepare(`DELETE FROM ${table}`).run();
  const [a, b] = f.store.repository.listAccounts();
  expect(
    (
      await request(f.app)
        .post("/api/data-sources/source/resolve-missing-access")
        .set("Host", "localhost:3000")
        .send({ confirmAccessRevoked: true })
    ).status,
  ).toBe(403);
  const detail = await request(f.app)
    .get(`/api/accounts/${a.id}`)
    .set("Host", "localhost:3000");
  expect(detail.body.sources[0].missingAccessAction).toContain(
    "Revoke access externally",
  );

  expect(
    (await f.post(`/api/accounts/${a.id}/delete`, { confirm: true })).status,
  ).toBe(409);
  expect(
    (await f.post("/api/data-sources/source/resolve-missing-access")).status,
  ).toBe(400);
  expect(
    (
      await f.post("/api/data-sources/missing/resolve-missing-access", {
        confirmAccessRevoked: true,
      })
    ).status,
  ).toBe(404);
  const resolved = await f.post(
    "/api/data-sources/source/resolve-missing-access",
    { confirmAccessRevoked: true },
  );
  expect(resolved.status).toBe(200);
  expect(resolved.body.authorizationBasis).toBe(
    "owner_confirmed_external_revocation",
  );
  expect(f.calls()).toBe(0);
  expect(f.store.connection("source").token).toBeNull();
  expect(f.store.repository.analyticalHistory("all")).toHaveLength(1);
  expect(
    (await f.post(`/api/accounts/${a.id}/delete`, { confirm: true })).status,
  ).toBe(200);
  expect(f.store.repository.listAccounts().map((a) => a.id)).toEqual([b.id]);
  f.store.db.close();
});
it("rejects missing-access resolution for a source with a credential", async () => {
  const f = await fixture();
  expect(
    (
      await f.post("/api/data-sources/source/resolve-missing-access", {
        confirmAccessRevoked: true,
      })
    ).status,
  ).toBe(409);
  expect(f.store.token("source")).toBe("test-secret");
  expect(f.calls()).toBe(0);
  f.store.db.close();
});
it("rolls back local finalization after remote removal and retries ITEM_NOT_FOUND", async () => {
  const f = await fixture();
  f.store.db.exec(
    "CREATE TRIGGER fail_historical BEFORE UPDATE ON data_sources WHEN NEW.status='historical' BEGIN SELECT RAISE(ABORT,'stub write failure'); END",
  );
  const encrypted = f.store.connection("source").token;
  expect((await f.post("/api/data-sources/source/disconnect")).status).toBe(
    502,
  );
  expect(f.store.connection("source").token).toBe(encrypted);
  expect(f.store.connection("source").status).not.toBe("historical");
  expect(
    (
      f.store.db
        .prepare("SELECT status FROM data_sources WHERE id='source'")
        .get() as any
    ).status,
  ).not.toBe("historical");
  f.store.db.exec("DROP TRIGGER fail_historical");
  // A provider that confirms the Item was already removed finalizes safely.
  const app = createApp(
    f.store,
    {
      configured: true,
      call: async () => {
        throw Object.assign(Error(), { code: "ITEM_NOT_FOUND" });
      },
    },
    origin,
  );
  const session = await request(app)
    .get("/api/state")
    .set("Host", "localhost:3000");
  const r = await request(app)
    .post("/api/data-sources/source/disconnect")
    .set("Host", "localhost:3000")
    .set("Origin", origin)
    .set("Cookie", session.headers["set-cookie"])
    .set("X-CSRF-Token", session.body.csrf)
    .send({});
  expect(r.status).toBe(200);
  expect(f.store.connection("source").token).toBeNull();
  expect(f.store.list()[0].status).toBe("historical");
  f.store.db.close();
});
