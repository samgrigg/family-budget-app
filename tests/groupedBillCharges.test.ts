import { expect, it } from "vitest";
import { Store } from "../server/store";
import {
  installBillPlan,
  planState,
  savePlan,
  storedPlans,
} from "../server/bill-plan";
import { transactionKey } from "../server/transfers";
const plan = {
  id: "gym",
  name: "Family gym",
  amount: "200.00",
  currency: "USD",
  accountName: "Checking",
  frequency: "Monthly",
  day: 2,
  notes: "",
  kind: "bill",
  status: "confirmed",
  expectedChargeCount: 4,
};
function setup() {
  const s = new Store(":memory:", Buffer.alloc(32), "sandbox");
  installBillPlan(s);
  s.connect("c", "token", [
    { account_id: "checking", name: "Checking", type: "depository" },
  ]);
  for (let i = 1; i <= 4; i++)
    s.db
      .prepare("INSERT INTO transactions VALUES(?,?,?,?,?,?,?,?,?)")
      .run(
        s.env,
        "c",
        `t${i}`,
        "checking",
        "2026-12-02",
        "Gym membership",
        "50.00",
        "USD",
        0,
      );
  const transactions = [...s.repository.history("all")].map((t) => ({
    key: transactionKey(t),
    label: "Member",
  }));
  return { s, transactions };
}
it("saves several separate gym charges as one commitment, verifies snapshots and keeps full funding for partial evidence", () => {
  const { s, transactions } = setup();
  const cycle = {
    date: "2026-12-01",
    amount: "200.00",
    expectedChargeCount: 4,
    charges: transactions.slice(0, 3),
  };
  savePlan(s, { ...plan, payments: [cycle] }, []);
  expect(storedPlans(s)[0]).toMatchObject({
    expectedChargeCount: 4,
    payments: [
      {
        charges: transactions
          .slice(0, 3)
          .map((t) => ({ ...t, amount: "50.00", date: "2026-12-02" })),
      },
    ],
  });
  expect(
    planState(s, [], [], "2026-12").records[0].resolvedAmount,
  ).toMatchObject({ amount: 200, matchedCharges: 3, expectedCharges: 4 });
  expect(planState(s, [], [], "2026-12").totals[0].total).toBe(200);
  savePlan(s, { ...plan, payments: [{ ...cycle, charges: transactions }] }, []);
  expect(
    planState(s, [], [], "2026-12").records[0].resolvedAmount,
  ).toMatchObject({ amount: 200, basis: "actual", matchedCharges: 4 });
  expect(
    planState(s, [], [], "2027-01").records[0].resolvedAmount,
  ).toMatchObject({ matchedCharges: 0 });
  s.db.close();
});
it("rejects reused, fabricated, cross-month evidence and invalid expected counts", () => {
  const { s, transactions } = setup();
  const cycle = {
    date: "2026-12-01",
    amount: "200.00",
    expectedChargeCount: 4,
    charges: transactions.slice(0, 2),
  };
  for (const changes of [
    { expectedChargeCount: 0 },
    { expectedChargeCount: 2.5 },
    { expectedChargeCount: 25 },
    { frequency: "Quarterly" },
    { kind: "transfer" },
    { payments: [{ ...cycle, charges: [transactions[0], transactions[0]] }] },
    { payments: [{ ...cycle, charges: [{ key: "fake", label: "" }] }] },
    { payments: [{ ...cycle, date: "2027-01-01" }] },
    { payments: [{ ...cycle, actualTransactionKey: transactions[3].key }] },
  ])
    expect(() =>
      savePlan(s, { ...plan, payments: [cycle], ...changes }, []),
    ).toThrow();
  savePlan(s, { ...plan, payments: [cycle] }, []);
  expect(() =>
    savePlan(
      s,
      { ...plan, id: "other", name: "Different bill", payments: [cycle] },
      [],
    ),
  ).toThrow(/already linked/);
  const saved = storedPlans(s)[0];
  s.db.prepare("DELETE FROM transactions").run();
  savePlan(s, saved, []);
  expect(() =>
    savePlan(
      s,
      {
        ...saved,
        payments: [
          {
            ...saved.payments![0],
            charges: saved.payments![0].charges!.map((c) => ({
              ...c,
              amount: "999.00",
            })),
          },
        ],
      },
      [],
    ),
  ).toThrow();
  s.db.close();
});

it("rejects pending, incoming, other-currency charges and reuse by a single-payment bill", () => {
  const { s, transactions } = setup();
  for (const [id, amount, currency, pending] of [
    ["pending", "50.00", "USD", 1],
    ["refund", "-50.00", "USD", 0],
    ["euro", "50.00", "EUR", 0],
  ] as const) {
    s.db
      .prepare("INSERT INTO transactions VALUES(?,?,?,?,?,?,?,?,?)")
      .run(
        s.env,
        "c",
        id,
        "checking",
        "2026-12-02",
        "Gym",
        amount,
        currency,
        pending,
      );
    const key = transactionKey({ env: s.env, connection: "c", id } as any);
    expect(() =>
      savePlan(
        s,
        {
          ...plan,
          payments: [
            {
              date: "2026-12-01",
              amount: "200.00",
              expectedChargeCount: 4,
              charges: [{ key, label: "" }],
            },
          ],
        },
        [],
      ),
    ).toThrow();
  }
  savePlan(
    s,
    {
      ...plan,
      payments: [
        {
          date: "2026-12-01",
          amount: "200.00",
          expectedChargeCount: 4,
          charges: transactions.slice(0, 1),
        },
      ],
    },
    [],
  );
  expect(() =>
    savePlan(
      s,
      {
        ...plan,
        id: "other",
        name: "Other",
        expectedChargeCount: 1,
        payments: [
          {
            date: "2026-12-02",
            amount: "50.00",
            actualTransactionKey: transactions[0].key,
          },
        ],
      },
      [],
    ),
  ).toThrow(/already linked/);
  s.db.close();
});
