import { expect, it } from "vitest";
import { resolveBillAmount } from "../shared/billAmounts";
const bill = {
  amount: "0.00",
  amountMode: "variable" as const,
  frequency: "Monthly",
  planningEstimate: "200.00",
  payments: [{ date: "2026-12-23", amount: "250.00" }],
};
it("uses a known cycle over estimates without leaking into other months", () => {
  expect(resolveBillAmount(bill, "2026-12")).toMatchObject({
    amount: 250,
    basis: "known",
  });
  expect(resolveBillAmount(bill, "2027-01")).toMatchObject({
    amount: 200,
    basis: "estimate",
  });
});
it("uses actual evidence first and retains unknown rather than pretending it is zero", () => {
  expect(
    resolveBillAmount(
      {
        ...bill,
        payments: [
          {
            date: "2026-12-23",
            amount: "250.00",
            actualTransactionKey: "actual",
          },
        ],
      },
      "2026-12",
      new Map([["actual", { amount: "260.00" }]]),
    ),
  ).toMatchObject({ amount: 260, basis: "actual" });
  expect(
    resolveBillAmount(
      { ...bill, planningEstimate: "", payments: [] },
      "2026-12",
    ),
  ).toMatchObject({ amount: null, basis: "unknown" });
  expect(
    resolveBillAmount(
      { ...bill, payments: [{ date: "2026-12-23", amount: "0.00" }] },
      "2026-12",
    ),
  ).toMatchObject({ amount: 0, basis: "known" });
});
it("preserves fixed bills and labels missing actual evidence while using the scheduled amount", () => {
  expect(
    resolveBillAmount({ amount: "120.00", frequency: "Yearly" }, "2026-12"),
  ).toMatchObject({ amount: 10, basis: "fixed" });
  expect(
    resolveBillAmount(
      {
        ...bill,
        payments: [
          {
            date: "2026-12-23",
            amount: "250.00",
            actualTransactionKey: "missing",
          },
        ],
      },
      "2026-12",
    ),
  ).toMatchObject({ amount: 250, basis: "known", missingActual: true });
});

it("falls back when corrected evidence has a different currency or a non-bank repayment source", () => {
  const plan = {
    ...bill,
    currency: "USD",
    expenseType: "creditPayment",
    payments: [
      { date: "2026-12-23", amount: "250.00", actualTransactionKey: "actual" },
    ],
  };
  expect(
    resolveBillAmount(
      plan,
      "2026-12",
      new Map([
        [
          "actual",
          { amount: "999.00", currency: "EUR", account_type: "depository" },
        ],
      ]),
    ),
  ).toMatchObject({ amount: 250, basis: "known", missingActual: true });
  expect(
    resolveBillAmount(
      plan,
      "2026-12",
      new Map([
        [
          "actual",
          { amount: "999.00", currency: "USD", account_type: "credit" },
        ],
      ]),
    ),
  ).toMatchObject({ amount: 250, basis: "known", missingActual: true });
});

it("requires bank-account actual evidence for debt payoff too", () => {
  const plan = {
    ...bill,
    currency: "USD",
    expenseType: "creditDebtPayoff",
    payments: [
      { date: "2026-12-23", amount: "150.00", actualTransactionKey: "actual" },
    ],
  };
  expect(
    resolveBillAmount(
      plan,
      "2026-12",
      new Map([
        [
          "actual",
          { amount: "999.00", currency: "USD", account_type: "credit" },
        ],
      ]),
    ),
  ).toMatchObject({ amount: 150, basis: "known", missingActual: true });
});

const grouped = {
  amount: "200.00",
  frequency: "Monthly",
  currency: "USD",
  expectedChargeCount: 4,
  payments: [
    {
      date: "2026-12-01",
      amount: "200.00",
      expectedChargeCount: 4,
      charges: [1, 2, 3].map((i) => ({
        key: `gym${i}`,
        amount: "50.00",
        date: "2026-12-02",
        label: `Member ${i}`,
      })),
    },
  ],
};
const gymActuals = new Map(
  [1, 2, 3, 4].map((i) => [`gym${i}`, { amount: "55.00", currency: "USD" }]),
);
it("retains the full commitment when only three of four separate charges are linked", () => {
  expect(resolveBillAmount(grouped, "2026-12", gymActuals)).toMatchObject({
    amount: 200,
    matchedCharges: 3,
    expectedCharges: 4,
    chargeAmount: 165,
  });
});
it("sums distinct same-amount transactions once all expected charges are linked", () => {
  const complete = {
    ...grouped,
    payments: [
      {
        ...grouped.payments[0],
        charges: [
          ...grouped.payments[0].charges,
          { key: "gym4", amount: "50.00", date: "2026-12-02", label: "" },
        ],
      },
    ],
  };
  expect(resolveBillAmount(complete, "2026-12", gymActuals)).toMatchObject({
    amount: 220,
    basis: "actual",
    matchedCharges: 4,
    expectedCharges: 4,
  });
  expect(resolveBillAmount(complete, "2027-01", gymActuals)).toMatchObject({
    amount: 200,
    matchedCharges: 0,
    expectedCharges: 4,
  });
  expect(resolveBillAmount(complete, "2026-12")).toMatchObject({
    amount: 200,
    basis: "known",
    missingActual: true,
    usingChargeSnapshots: true,
    linkedCharges: 4,
    matchedCharges: 0,
  });
});
it("preserves the expected charge count saved with each month", () => {
  expect(
    resolveBillAmount(
      { ...grouped, expectedChargeCount: 3 },
      "2026-12",
      gymActuals,
    ),
  ).toMatchObject({ amount: 200, expectedCharges: 4 });
});
