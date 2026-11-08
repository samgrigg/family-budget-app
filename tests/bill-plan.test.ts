import { it, expect } from "vitest";
import { Store } from "../server/store";
import {
  installBillPlan,
  savePlan,
  planState,
  fundingTotals,
} from "../server/bill-plan";
const draft = {
  id: "Bills!A3",
  name: "Rent",
  amount: "100.00",
  currency: "USD",
  accountName: "Checking",
  frequency: "Monthly",
  day: 1,
  notes: "",
  kind: "bill",
  status: "confirmed",
  source: { cell: "Bills!A3", value: "100", formula: "" },
};
it("saves idempotently and isolates environments; excluded rows do not fund accounts", () => {
  const s = new Store(":memory:", Buffer.alloc(32), "sandbox");
  installBillPlan(s);
  savePlan(s, draft, []);
  savePlan(s, draft, []);
  expect(planState(s, []).records).toHaveLength(1);
  expect(planState(s, []).totals[0].monthly).toBe(100);
  expect(
    planState(new Store(s.db, Buffer.alloc(32), "production"), []).records,
  ).toHaveLength(0);
  savePlan(
    s,
    {
      ...draft,
      amount: "125.00",
      notes: "Keep this detail",
      status: "excluded",
    },
    [],
  );
  expect(planState(s, []).records[0]).toMatchObject({
    amount: "125.00",
    notes: "Keep this detail",
    status: "excluded",
  });
  expect(planState(s, []).totals).toHaveLength(0);
  s.db.close();
});
it("requires resolving zero, unknown frequency, unassigned account and transfers", () => {
  const s = new Store(":memory:", Buffer.alloc(32), "sandbox");
  installBillPlan(s);
  for (const change of [
    { amount: "0.00" },
    { frequency: "Unknown" },
    { accountName: "" },
    { kind: "transfer" },
    { day: 32 },
    { amount: "NaN" },
    { currency: "not-currency" },
  ])
    expect(() => savePlan(s, { ...draft, ...change }, [])).toThrow();
  s.db.close();
});
it("requires acknowledgement only for another confirmed plan, not matching history", () => {
  const s = new Store(":memory:", Buffer.alloc(32), "sandbox");
  installBillPlan(s);
  savePlan(s, draft, [{ name: "Rent" }]);
  expect(planState(s, [], [{ name: "Rent" }]).records[0]).toMatchObject({
    possibleDuplicate: false,
    observedMatches: [{ name: "Rent" }],
  });
  const duplicate = { ...draft, id: "another-rent" };
  expect(() => savePlan(s, duplicate, [])).toThrow(/duplicate/i);
  savePlan(s, { ...duplicate, acknowledgeDuplicate: true }, []);
  expect(planState(s, []).records).toHaveLength(2);
  expect(planState(s, []).records[0].duplicatePlans).toHaveLength(1);
  s.db.close();
});
it("separates currencies and includes annual and quarterly monthly set-asides", () => {
  const totals = fundingTotals([
    draft,
    { ...draft, id: "b", amount: "120.00", frequency: "Yearly" },
    { ...draft, id: "c", amount: "30.00", frequency: "Quarterly" },
    { ...draft, id: "d", currency: "EUR" },
    { ...draft, id: "e", status: "review" },
    { ...draft, id: "f", kind: "transfer" },
  ]);
  expect(totals.find((t) => t.currency === "USD")).toMatchObject({
    monthly: 100,
    setAside: 20,
    total: 120,
  });
  expect(totals.find((t) => t.currency === "EUR")?.total).toBe(100);
});

import request from "supertest";
import { createApp } from "../server/app";
it("serves drafts without saving; secured confirmation preserves source and rejects unknown rows", async () => {
  const s = new Store(":memory:", Buffer.alloc(32), "sandbox");
  const app = createApp(
    s,
    { configured: false, call: async () => ({}) },
    "http://localhost:3000",
    undefined,
    [{ ...draft, status: "review" }],
  );
  const initial = await request(app)
    .get("/api/bill-plan")
    .set("Host", "localhost:3000");
  expect(initial.body.records[0].status).toBe("review");
  expect(initial.body.totals).toEqual([]);
  expect(
    (
      await request(app)
        .post("/api/bill-plan")
        .set("Host", "localhost:3000")
        .send(draft)
    ).status,
  ).toBe(403);
  const session = await request(app)
    .get("/api/state")
    .set("Host", "localhost:3000");
  const post = (body: any) =>
    request(app)
      .post("/api/bill-plan")
      .set("Host", "localhost:3000")
      .set("Origin", "http://localhost:3000")
      .set("Cookie", session.headers["set-cookie"])
      .set("X-CSRF-Token", session.body.csrf)
      .send(body);
  expect((await post({ ...draft, id: "forged" })).status).toBe(400);
  expect((await post({ ...draft, source: { cell: "forged" } })).status).toBe(
    200,
  );
  const saved = await request(app)
    .get("/api/bill-plan")
    .set("Host", "localhost:3000");
  expect(saved.body.records[0].source.cell).toBe("Bills!A3");
  expect(saved.body.totals[0].total).toBe(100);
  expect((await post({ ...draft, amount: "-3.00" })).status).toBe(400);
  s.db.close();
});

it("rejects inherited object names as frequencies", () => {
  const s = new Store(":memory:", Buffer.alloc(32), "sandbox");
  installBillPlan(s);
  expect(() =>
    savePlan(s, { ...draft, frequency: "constructor" }, []),
  ).toThrow();
  s.db.close();
});

it("confirms unknown monthly commitments and separates repayment funding from expenses", () => {
  const s = new Store(":memory:", Buffer.alloc(32), "sandbox");
  installBillPlan(s);
  savePlan(
    s,
    {
      ...draft,
      amount: "",
      amountMode: "variable",
      expenseType: "creditPayment",
    },
    [],
  );
  const state = planState(s, [], [], "2026-12");
  expect(state.totals[0]).toMatchObject({ total: 0, unknown: 1 });
  expect(state.expenses[0]).toMatchObject({ total: 0, unknown: 0 });
  savePlan(
    s,
    {
      ...draft,
      amount: "",
      amountMode: "variable",
      expenseType: "creditPayment",
      planningEstimate: "200.00",
      payments: [{ date: "2026-12-23", amount: "250.00" }],
    },
    [],
  );
  expect(planState(s, [], [], "2026-12").totals[0]).toMatchObject({
    known: 250,
    estimated: 0,
    total: 250,
  });
  expect(planState(s, [], [], "2027-01").totals[0]).toMatchObject({
    known: 0,
    estimated: 200,
    total: 200,
  });
  expect(planState(s, [], [], "2026-12").expenses[0].total).toBe(0);
  s.db.close();
});
it("rejects impossible dates, duplicate cycles and fabricated actual payment evidence", () => {
  const s = new Store(":memory:", Buffer.alloc(32), "sandbox");
  installBillPlan(s);
  for (const payments of [
    [{ date: "2026-02-30", amount: "200.00" }],
    [
      { date: "2026-12-01", amount: "200.00" },
      { date: "2026-12-23", amount: "210.00" },
    ],
    [{ date: "2026-12-23", amount: "200.00", actualTransactionKey: "fake" }],
  ])
    expect(() => savePlan(s, { ...draft, payments }, [])).toThrow();
  s.db.close();
});

import { annotateRepayments } from "../server/bill-plan";
import { transactionKey } from "../server/transfers";
import { groupKey } from "../server/bills";
it("persists payment cycles, rejects evidence reuse and annotates observed repayments from explicit evidence", () => {
  const s = new Store(":memory:", Buffer.alloc(32), "sandbox");
  installBillPlan(s);
  s.connect("c", "token", [
    { account_id: "a", name: "Checking", type: "depository" },
  ]);
  s.db
    .prepare("INSERT INTO transactions VALUES(?,?,?,?,?,?,?,?,?)")
    .run(
      s.env,
      "c",
      "payment",
      "a",
      "2026-12-23",
      "Card payment",
      "260.00",
      "USD",
      0,
    );
  const actual = s.repository.history("all")[0];
  const key = transactionKey(actual);
  const payment = {
    date: "2026-12-23",
    amount: "250.00",
    actualTransactionKey: key,
  };
  const plan = {
    ...draft,
    amount: "",
    amountMode: "variable",
    expenseType: "creditPayment",
    payments: [payment, { date: "2027-01-23", amount: "300.00" }],
  };
  savePlan(s, plan, []);
  expect(planState(s, [], [], "2026-12").totals[0].total).toBe(260);
  expect(planState(s, [], [], "2027-01").totals[0].total).toBe(300);
  expect(planState(s, [], [], "2026-12").records[0].payments).toHaveLength(2);
  expect(() =>
    savePlan(s, { ...plan, id: "other", name: "Other card" }, []),
  ).toThrow(/already linked/);
  expect(
    annotateRepayments(s, { saved: [{ key: groupKey(actual) }] }).saved[0]
      .expenseType,
  ).toBe("creditPayment");
  s.db.close();
});
