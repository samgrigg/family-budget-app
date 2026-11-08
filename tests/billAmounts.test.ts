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
