import { it, expect } from "vitest";
import request from "supertest";
import { Store } from "../server/store";
import { createApp } from "../server/app";
it("serves saved review data and rejects insecure or stale writes", async () => {
  const s = new Store(":memory:", Buffer.alloc(32), "sandbox");
  const app = createApp(
    s,
    { configured: false, call: async () => ({}) },
    "http://localhost:3000",
  );
  const session = await request(app)
    .get("/api/state")
    .set("Host", "localhost:3000");
  const data = await request(app)
    .get("/api/paycheck-review")
    .set("Host", "localhost:3000");
  expect(data.status).toBe(200);
  expect(data.body.ledger.revision).toBe(0);
  expect(
    (
      await request(app)
        .post("/api/paycheck-review")
        .set("Host", "localhost:3000")
        .send({})
    ).status,
  ).toBe(403);
  const post = (body: any) =>
    request(app)
      .post("/api/paycheck-review")
      .set("Host", "localhost:3000")
      .set("Origin", "http://localhost:3000")
      .set("Cookie", session.headers["set-cookie"])
      .set("X-CSRF-Token", session.body.csrf)
      .send(body);
  const body = {
    expectedRevision: 0,
    evidenceDigest: data.body.evidence.digest,
    changes: [],
  };
  expect((await post(body)).status).toBe(200);
  expect((await post(body)).status).toBe(409);
  expect(
    (await post({ ...body, expectedRevision: 1, evidenceDigest: "stale" }))
      .status,
  ).toBe(409);
  s.db.close();
});
