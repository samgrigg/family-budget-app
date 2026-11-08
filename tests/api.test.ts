import { it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../server/app";
import { Store } from "../server/store";
it("requires same origin and CSRF and never returns access tokens", async () => {
  const s = new Store(":memory:", Buffer.alloc(32), "sandbox");
  const provider: any = {
    configured: true,
    call: async (path: string) =>
      path === "/item/public_token/exchange"
        ? { item_id: "i1", access_token: "private-token" }
        : { accounts: [] },
  };
  const app = createApp(s, provider, "http://localhost:3000");
  expect(
    (await request(app).post("/api/connect").send({ public_token: "x" }))
      .status,
  ).toBe(403);
  const session = await request(app)
    .get("/api/state")
    .set("Host", "localhost:3000");
  const cookie = session.headers["set-cookie"];
  const r = await request(app)
    .post("/api/connect")
    .set("Host", "localhost:3000")
    .set("Origin", "http://localhost:3000")
    .set("Cookie", cookie)
    .set("X-CSRF-Token", session.body.csrf)
    .send({ public_token: "x" });
  expect(r.status).toBe(200);
  expect(JSON.stringify(r.body)).not.toContain("private-token");
  expect(
    (await request(app).get("/api/state").set("Host", "evil.test")).status,
  ).toBe(403);
  s.db.close();
});
it("keeps the connection when provider revocation fails", async () => {
  const s = new Store(":memory:", Buffer.alloc(32), "sandbox");
  s.connect("i1", "private-token", []);
  const app = createApp(
    s,
    {
      configured: true,
      call: async () => {
        throw Error("sensitive upstream details");
      },
    },
    "http://localhost:3000",
  );
  const session = await request(app)
    .get("/api/state")
    .set("Host", "localhost:3000");
  const r = await request(app)
    .post("/api/connections/i1/disconnect")
    .set("Host", "localhost:3000")
    .set("Origin", "http://localhost:3000")
    .set("Cookie", session.headers["set-cookie"])
    .set("X-CSRF-Token", session.body.csrf)
    .send({});
  expect(r.status).toBe(502);
  expect(s.list()).toHaveLength(1);
  expect(JSON.stringify(r.body)).not.toContain("sensitive upstream details");
  s.db.close();
});
it("revokes the exchanged token if local persistence fails", async () => {
  const s = new Store(":memory:", Buffer.alloc(32), "sandbox");
  const calls: string[] = [];
  const app = createApp(
    s,
    {
      configured: true,
      call: async (path) => {
        calls.push(path);
        return { item_id: "i1", access_token: "private-token" };
      },
    },
    "http://localhost:3000",
  );
  s.connect = () => {
    throw Error("disk full");
  };
  const session = await request(app)
    .get("/api/state")
    .set("Host", "localhost:3000");
  await request(app)
    .post("/api/connect")
    .set("Host", "localhost:3000")
    .set("Origin", "http://localhost:3000")
    .set("Cookie", session.headers["set-cookie"])
    .set("X-CSRF-Token", session.body.csrf)
    .send({ public_token: "x" });
  expect(calls).toEqual(["/item/public_token/exchange", "/item/remove"]);
  s.db.close();
});
it("retains an in-memory revocation handle if both saving and cleanup fail", async () => {
  const s = new Store(":memory:", Buffer.alloc(32), "sandbox");
  let removals = 0;
  const app = createApp(
    s,
    {
      configured: true,
      call: async (path) => {
        if (path === "/item/remove" && removals++ === 0) throw Error("offline");
        return { item_id: "i1", access_token: "private-token" };
      },
    },
    "http://localhost:3000",
  );
  s.connect = () => {
    throw Error("disk full");
  };
  const session = await request(app)
    .get("/api/state")
    .set("Host", "localhost:3000");
  const post = (path: string) =>
    request(app)
      .post(path)
      .set("Host", "localhost:3000")
      .set("Origin", "http://localhost:3000")
      .set("Cookie", session.headers["set-cookie"])
      .set("X-CSRF-Token", session.body.csrf);
  const failed = await post("/api/connect").send({ public_token: "x" });
  expect(failed.body.connections[0].status).toBe("revoke_required");
  expect(JSON.stringify(failed.body)).not.toContain("private-token");
  const retried = await post("/api/connections/i1/disconnect").send({});
  expect(retried.status).toBe(200);
  expect(retried.body.connections).toEqual([]);
  s.db.close();
});

it("validates institution renaming and returns the saved label", async () => {
  const s = new Store(":memory:", Buffer.alloc(32), "sandbox");
  s.connect("i1", "private-token", []);
  const app = createApp(
    s,
    { configured: true, call: async () => ({}) },
    "http://localhost:3000",
  );
  const session = await request(app)
    .get("/api/state")
    .set("Host", "localhost:3000");
  const rename = (id: string, name: string) =>
    request(app)
      .post(`/api/connections/${id}/name`)
      .set("Host", "localhost:3000")
      .set("Origin", "http://localhost:3000")
      .set("Cookie", session.headers["set-cookie"])
      .set("X-CSRF-Token", session.body.csrf)
      .send({ name });
  expect((await rename("i1", "  ")).status).toBe(400);
  expect((await rename("missing", "Bank")).status).toBe(404);
  const result = await rename("i1", " Household bank ");
  expect(result.status).toBe(200);
  expect(result.body.connections[0].display_name).toBe("Household bank");
  expect(JSON.stringify(result.body)).not.toContain("private-token");
  s.db.close();
});
