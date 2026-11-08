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
