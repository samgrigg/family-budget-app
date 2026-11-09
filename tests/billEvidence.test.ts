import { expect, it } from "vitest";
import { Store } from "../server/store";
import { searchBillEvidence } from "../server/bill-evidence";
const bill = {
  name: "US Bank",
  currency: "USD",
  amount: "100.00",
  frequency: "Monthly",
  kind: "bill",
  expenseType: "expense",
};
function setup() {
  const s = new Store(":memory:", Buffer.alloc(32), "sandbox");
  s.connect("c", "token", [
    { account_id: "checking", name: "Checking", type: "depository" },
    { account_id: "card", name: "Card", type: "credit" },
  ]);
  return s;
}
function add(
  s: Store,
  id: string,
  name: string,
  amount = "100.00",
  currency = "USD",
  account = "checking",
  pending = 0,
  date = "2026-11-01",
) {
  s.db
    .prepare("INSERT INTO transactions VALUES(?,?,?,?,?,?,?,?,?)")
    .run(s.env, "c", id, account, date, name, amount, currency, pending);
}
it("finds description and amount candidates and states which criteria matched", () => {
  const s = setup();
  add(s, "both", "USBANK ONLINE PAYMENT");
  add(s, "amount", "Other merchant");
  add(s, "description", "US Bank Loan", "125.00");
  add(s, "pending", "US Bank", "100.00", "USD", "checking", 1);
  add(s, "credit", "US Bank refund", "-100.00");
  add(s, "othercurrency", "US Bank", "100.00", "EUR");
  const result = searchBillEvidence(s, bill, {
    query: "US Bank",
    amount: "100.00",
  });
  expect(result.total).toBe(3);
  expect(result.matches[0].name).toBe("USBANK ONLINE PAYMENT");
  expect(result.matches[0].reasons).toHaveLength(2);
  expect(
    searchBillEvidence(s, bill, {
      query: "US Bank",
      amount: "100.00",
      requireAll: true,
    }).total,
  ).toBe(1);
  s.db.close();
});
it("searches beyond the latest 2000 display rows and paginates without changing records", () => {
  const s = setup();
  s.db.transaction(() => {
    for (let i = 0; i < 2005; i++)
      add(
        s,
        String(i),
        "Utility payment",
        "50.00",
        "USD",
        "checking",
        0,
        i === 0 ? "2020-01-01" : "2026-11-01",
      );
  })();
  expect(
    searchBillEvidence(s, bill, {
      query: "Utility",
      from: "2020-01-01",
      to: "2020-01-31",
    }).matches,
  ).toHaveLength(1);
  const first = searchBillEvidence(s, bill, { query: "Utility" }),
    next = searchBillEvidence(s, bill, {
      query: "Utility",
      offset: first.nextOffset,
    });
  expect(first.total).toBe(2005);
  expect(first.matches).toHaveLength(50);
  expect(
    new Set([...first.matches, ...next.matches].map((t) => t.key)).size,
  ).toBe(100);
  expect(s.repository.history("all")).toHaveLength(2005);
  s.db.close();
});
it("honors account visibility and bank-only repayment searches and rejects invalid filters", () => {
  const s = setup();
  add(s, "checking", "US Bank");
  add(s, "card", "US Bank", "100.00", "USD", "card");
  expect(
    searchBillEvidence(
      s,
      { ...bill, expenseType: "creditDebtPayoff" },
      { query: "US Bank" },
    ).total,
  ).toBe(1);
  s.setAccountHidden("c", "checking", true);
  expect(searchBillEvidence(s, bill, { query: "US Bank" }).total).toBe(1);
  for (const options of [
    { query: "" },
    { query: "Bank", from: "2026-02-30" },
    { query: "Bank", amount: "oops" },
    { query: "Bank", offset: -1 },
    { query: "Bank", from: "2026-12-01", to: "2026-11-01" },
  ])
    expect(() => searchBillEvidence(s, bill, options)).toThrow();
  s.db.close();
});

it("marks confirmed transfers so equal amounts are not mistaken for bill payments", () => {
  const s = setup();
  s.accounts("c", [
    { account_id: "checking", name: "Checking", type: "depository" },
    { account_id: "savings", name: "Savings", type: "depository" },
  ]);
  add(s, "out", "Online transfer", "100.00", "USD", "savings");
  add(s, "in", "Online transfer", "-100.00", "USD", "checking");
  const result = searchBillEvidence(s, bill, {
    query: "US Bank",
    amount: "100.00",
  });
  expect(result.matches).toHaveLength(1);
  expect(result.matches[0].internalTransfer).toBe(true);
  s.db.close();
});

import request from "supertest";
import { createApp } from "../server/app";
it("serves only an active bill in the current environment and rejects invalid searches", async () => {
  const s = setup();
  add(s, "payment", "US Bank");
  const draft = {
    ...bill,
    id: "test-bill",
    accountName: "Checking",
    day: 1,
    notes: "",
    status: "review",
  };
  const app = createApp(
    s,
    { configured: false, call: async () => ({}) },
    "http://localhost:3000",
    undefined,
    [draft as any],
  );
  const get = (query: any) =>
    request(app)
      .get("/api/bill-plan/evidence")
      .query(query)
      .set("Host", "localhost:3000");
  expect((await get({ billId: "unknown", query: "Bank" })).status).toBe(404);
  expect(
    (await get({ billId: draft.id, query: "Bank", from: "2026-02-30" })).status,
  ).toBe(400);
  const response = await get({ billId: draft.id, query: "Bank" });
  expect(response.status).toBe(200);
  expect(response.body.matches).toHaveLength(1);
  expect(
    (
      await request(app)
        .get("/api/bill-plan/evidence")
        .query({ billId: draft.id, query: "Bank" })
        .set("Host", "evil.test")
    ).status,
  ).toBe(403);
  const other = new Store(s.db, Buffer.alloc(32), "production");
  expect(searchBillEvidence(other, bill, { query: "Bank" }).total).toBe(0);
  s.db.close();
});
