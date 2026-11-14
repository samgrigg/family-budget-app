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
it("withholds safe-to-spend when an imported card purchase is unassigned", async () => {
  const s = new Store(":memory:", Buffer.alloc(32), "sandbox");
  s.connect("bank", "synthetic", [
    { account_id: "checking", name: "Checking", type: "depository" },
    { account_id: "card", name: "Card", type: "credit" },
  ]);
  s.commit(
    "bank",
    [
      {
        added: [
          {
            transaction_id: "dep",
            account_id: "checking",
            name: "Payroll",
            amount: -2000,
            date: "2026-11-06",
            pending: false,
            iso_currency_code: "USD",
          },
          {
            transaction_id: "buy",
            account_id: "card",
            name: "Groceries",
            amount: 80,
            date: "2026-11-07",
            pending: false,
            iso_currency_code: "USD",
          },
        ],
        modified: [],
        removed: [],
      },
    ],
    "cursor",
    [],
  );
  const app = createApp(
    s,
    { configured: false, call: async () => ({}) },
    "http://localhost:3000",
  );
  const a = s.repository.listAccounts().find((a) => a.name === "Checking")!,
    dep = s.repository
      .analyticalHistory("all")
      .find((t) => t.name === "Payroll")!;
  saveReviewLedger(s, 0, {
    revision: 0,
    sources: [{ id: "src", name: "Canyons", accountId: a.id, incomeKey: null }],
    paychecks: [
      {
        id: "pay",
        sourceId: "src",
        transactionId: dep.id,
        state: "received",
        amountMinor: 200000,
        currency: "USD",
        date: "2026-11-06",
        nextPayday: "2026-11-20",
        commitmentsConfirmed: true,
      },
    ],
    obligations: [],
    contributions: [],
    settlements: [],
    reviews: [],
  });
  const response = await request(app)
    .get("/api/paycheck-review")
    .set("Host", "localhost:3000");
  expect(response.body.projections[0].safeToSpendMinor).toBeNull();
  expect(response.body.unassignedPurchases).toHaveLength(1);
  s.db.close();
});
import { saveReviewLedger } from "../server/paycheck-repository";
it("withholds remaining cash until posted bank debits are accounted for", async () => {
  const s = new Store(":memory:", Buffer.alloc(32), "sandbox");
  s.connect("bank", "synthetic", [
    { account_id: "checking", name: "Checking", type: "depository" },
  ]);
  s.commit(
    "bank",
    [
      {
        added: [
          {
            transaction_id: "dep",
            account_id: "checking",
            name: "Payroll",
            amount: -2000,
            date: "2026-11-06",
            pending: false,
            iso_currency_code: "USD",
          },
          {
            transaction_id: "cash",
            account_id: "checking",
            name: "Cash used",
            amount: 50,
            date: "2026-11-07",
            pending: false,
            iso_currency_code: "USD",
          },
        ],
        modified: [],
        removed: [],
      },
    ],
    "c",
    [],
  );
  const app = createApp(
      s,
      { configured: false, call: async () => ({}) },
      "http://localhost:3000",
    ),
    a = s.repository.listAccounts()[0],
    t = s.repository
      .analyticalHistory("all")
      .find((t) => t.amount.startsWith("-"))!;
  saveReviewLedger(s, 0, {
    revision: 0,
    sources: [
      { id: "source", name: "Canyons", accountId: a.id, incomeKey: null },
    ],
    paychecks: [
      {
        id: "pay",
        sourceId: "source",
        transactionId: t.id,
        state: "received",
        amountMinor: 200000,
        currency: "USD",
        date: t.date,
        nextPayday: "2026-11-20",
        commitmentsConfirmed: true,
      },
    ],
    obligations: [],
    contributions: [],
    settlements: [],
    reviews: [],
  });
  const r = await request(app)
    .get("/api/paycheck-review")
    .set("Host", "localhost:3000");
  expect(r.body.projections[0].safeToSpendMinor).toBeNull();
  expect(r.body.unassignedCash).toHaveLength(1);
  s.db.close();
});
it("serves the explicit card refresh route without leaking cached credentials", async () => {
  const s = new Store(":memory:", Buffer.alloc(32), "sandbox");
  s.connect("cards", "synthetic-access", [
    { account_id: "card", name: "Card", type: "credit" },
  ]);
  const app = createApp(
    s,
    {
      configured: true,
      call: async (path) =>
        path === "/item/get" ? { item: { consented_products: [] } } : {},
    },
    "http://localhost:3000",
  );
  const session = await request(app)
    .get("/api/state")
    .set("Host", "localhost:3000");
  const r = await request(app)
    .post("/api/paycheck-review/card-data/cards/refresh")
    .set("Host", "localhost:3000")
    .set("Origin", "http://localhost:3000")
    .set("Cookie", session.headers["set-cookie"])
    .set("X-CSRF-Token", session.body.csrf)
    .send({});
  expect(r.status).toBe(200);
  expect(r.body.cardData[0].issue).toMatch(/consent/);
  expect(JSON.stringify(r.body)).not.toContain("synthetic-access");
  s.db.close();
});
