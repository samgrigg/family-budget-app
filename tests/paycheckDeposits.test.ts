import { it, expect } from "vitest";
import { paycheckDeposits } from "../web/paycheckDeposits";
import { fundedLedger } from "./paycheck-fixtures";
const transactions = [
  {
    id: "deposit",
    accountId: "macu",
    name: "Canyons",
    date: "2026-11-06",
    amount: "-2000",
    currency: "USD",
    pending: false,
  },
  {
    id: "macu-next",
    accountId: "macu",
    name: "Canyons",
    date: "2026-11-20",
    amount: "-2000",
    currency: "USD",
    pending: false,
  },
  {
    id: "adobe-deposit",
    accountId: "etrade",
    name: "Adobe",
    date: "2026-11-06",
    amount: "-3000",
    currency: "USD",
    pending: false,
  },
  {
    id: "pending",
    accountId: "macu",
    name: "Pending",
    date: "2026-11-20",
    amount: "-2000",
    currency: "USD",
    pending: true,
  },
  {
    id: "debit",
    accountId: "macu",
    name: "Purchase",
    date: "2026-11-07",
    amount: "50",
    currency: "USD",
    pending: false,
  },
  {
    id: "eur",
    accountId: "macu",
    name: "Other currency",
    date: "2026-11-07",
    amount: "-50",
    currency: "EUR",
    pending: false,
  },
];
it("limits unused posted USD deposits to the selected source account", () => {
  const l = fundedLedger();
  l.sources.push({
    id: "adobe",
    name: "Adobe",
    accountId: "etrade",
    incomeKey: null,
  });
  expect(paycheckDeposits(l, transactions, "canyons").map((t) => t.id)).toEqual(
    ["macu-next"],
  );
  expect(paycheckDeposits(l, transactions, "adobe").map((t) => t.id)).toEqual([
    "adobe-deposit",
  ]);
  expect(paycheckDeposits(l, transactions, "missing")).toEqual([]);
});
it("allows the current deposit when reconfirming an existing paycheck", () => {
  expect(
    paycheckDeposits(fundedLedger(), transactions, "canyons", "macu-pay").map(
      (t) => t.id,
    ),
  ).toEqual(["deposit", "macu-next"]);
});
