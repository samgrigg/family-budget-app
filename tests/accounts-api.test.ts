import { it, expect } from "vitest";
import request from "supertest";
import { Store } from "../server/store";
import { createApp } from "../server/app";
it("exposes safe canonical account management with distinct institution/source names", async () => {
  const s = new Store(":memory:", Buffer.alloc(32), "sandbox");
  s.connect("source", "private-secret", [
    { account_id: "a", name: "Checking", mask: "1234" },
  ]);
  const app = createApp(
    s,
    {
      configured: true,
      call: async () => {
        throw Error("No provider call expected");
      },
    },
    "http://localhost:3000",
  );
  const session = await request(app)
    .get("/api/state")
    .set("Host", "localhost:3000");
  const get = () =>
    request(app).get("/api/accounts").set("Host", "localhost:3000");
  const post = (path: string, body: any) =>
    request(app)
      .post(path)
      .set("Host", "localhost:3000")
      .set("Origin", "http://localhost:3000")
      .set("Cookie", session.headers["set-cookie"])
      .set("X-CSRF-Token", session.body.csrf)
      .send(body);
  const index = (await get()).body;
  expect(index.environment).toBe("sandbox");
  expect(index.accounts).toHaveLength(1);
  expect(index.accounts[0].mask).toBe("1234");
  expect(index.aliases[0].account_id).toBe(index.accounts[0].id);
  expect(JSON.stringify(index)).not.toMatch(/private-secret|"token"|"cursor"/);
  const a = index.accounts[0];
  expect(
    (
      await post(`/api/accounts/${a.id}/preferences`, {
        name: "Household",
        included: false,
      })
    ).status,
  ).toBe(200);
  expect(
    (
      await post(`/api/institutions/${a.institutionId}/name`, {
        name: "My Bank",
      })
    ).status,
  ).toBe(200);
  expect(
    (await post("/api/data-sources/source/name", { name: "Import source" }))
      .status,
  ).toBe(200);
  const updated = (await get()).body;
  expect(updated.accounts[0].name).toBe("Household");
  expect(updated.accounts[0].included).toBe(false);
  expect(updated.institutions[0].name).toBe("My Bank");
  expect(updated.sources[0].label).toBe("Import source");
  expect(
    (
      await post(`/api/accounts/${a.id}/preferences`, {
        name: "",
        included: true,
      })
    ).status,
  ).toBe(400);
  expect(
    (
      await post("/api/accounts/missing/preferences", {
        name: "Name",
        included: true,
      })
    ).status,
  ).toBe(404);
  expect(
    (
      await request(app)
        .post(`/api/accounts/${a.id}/preferences`)
        .send({ name: "Unauthorized", included: true })
    ).status,
  ).toBe(403);
  s.db.close();
});
it("protects match review/link/unlink endpoints and exposes source-qualified history and issues", async () => {
  const s = new Store(":memory:", Buffer.alloc(32), "sandbox");
  for (const source of ["left", "right"])
    s.connect(source, "private-secret", [
      {
        account_id: "a",
        name: source,
        type: "depository",
        subtype: "checking",
      },
    ]);
  const [a, b] = s.repository.listAccounts();
  for (const source of ["left", "right"])
    for (const [i, date] of [
      "2026-08-01",
      "2026-09-01",
      "2026-10-01",
    ].entries())
      s.db
        .prepare("INSERT INTO transactions VALUES(?,?,?,?,?,?,?,?,?)")
        .run(s.env, source, String(i), "a", date, "Power", "10", "USD", 0);
  const app = createApp(
    s,
    {
      configured: true,
      call: async () => {
        throw Error("No provider call");
      },
    },
    "http://localhost:3000",
  );
  const session = await request(app)
    .get("/api/state")
    .set("Host", "localhost:3000");
  const get = (path: string) =>
    request(app)
      .get("/api" + path)
      .set("Host", "localhost:3000");
  const post = (path: string, body: any) =>
    request(app)
      .post("/api" + path)
      .set("Host", "localhost:3000")
      .set("Origin", "http://localhost:3000")
      .set("Cookie", session.headers["set-cookie"])
      .set("X-CSRF-Token", session.body.csrf)
      .send(body);
  expect((await get("/account-matches")).body.suggestions).toHaveLength(1);
  const review = (
    await get(`/account-matches/review?left=${a.id}&right=${b.id}`)
  ).body;
  const input = {
    leftId: a.id,
    rightId: b.id,
    confirm: true,
    name: "Linked",
    included: true,
    preferredSourceId: "right",
    decisions: {},
    reviewToken: review.token,
  };
  expect(
    (await request(app).post("/api/account-links").send(input)).status,
  ).toBe(403);
  expect(
    (await post("/account-links", { ...input, confirm: false })).status,
  ).toBe(409);
  const linked = await post("/account-links", input);
  expect(linked.status).toBe(200);
  const index = (await get("/accounts")).body;
  expect(index.account_redirects).toEqual([
    { env: s.env, from: b.id, to: a.id },
  ]);
  expect(index.accounts).toHaveLength(1);
  expect(JSON.stringify((await get("/account-links")).body)).not.toContain(
    "private-secret",
  );
  expect((await get(`/accounts/${a.id}`)).body.transactions).toHaveLength(6);
  expect(
    (
      await post(`/account-links/${linked.body.id}/preferred-source`, {
        sourceId: "left",
      })
    ).status,
  ).toBe(200);
  expect(
    (await get(`/account-links/${linked.body.id}/unlink-review`)).status,
  ).toBe(200);
  expect(
    (await post(`/account-links/${linked.body.id}/unlink`, { confirm: true }))
      .status,
  ).toBe(200);
  s.db.close();
});
