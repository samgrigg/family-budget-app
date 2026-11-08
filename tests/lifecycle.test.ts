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
