import { it, expect } from "vitest";
import { expectedPaycheck } from "../web/expectedPaycheck";
import { fundedLedger } from "./paycheck-fixtures";
it("suggests the median of the five most recent confirmed deposits for this source only", () => {
  const l = fundedLedger();
  l.paychecks = [];
  const tx: any[] = [];
  for (const [i, amount] of [
    10000, 200000, 210000, 205000, 199000, 201000,
  ].entries()) {
    const date = `2026-10-${String(i + 10).padStart(2, "0")}`,
      id = `deposit-${i}`;
    l.paychecks.push({
      ...fundedLedger().paychecks[0],
      id: `pay-${i}`,
      transactionId: id,
      date,
      amountMinor: amount,
    });
    tx.push({
      id,
      accountId: "macu",
      name: "Payroll",
      amount: String(-amount / 100),
      currency: "USD",
      date,
      pending: false,
    });
  }
  l.paychecks.push({
    ...l.paychecks[0],
    id: "other",
    sourceId: "other",
    amountMinor: 900000,
  });
  l.paychecks.push({
    ...l.paychecks[0],
    id: "future",
    state: "expected",
    amountMinor: 900000,
  });
  expect(expectedPaycheck(l, tx, "canyons", "2026-11-08")).toEqual({
    amountMinor: 201000,
    sampleSize: 5,
    minMinor: 199000,
    maxMinor: 210000,
    varies: false,
  });
});
it("does not guess from unconfirmed inflows, pending deposits or stale evidence", () => {
  const l = fundedLedger();
  const t = {
    id: "deposit",
    accountId: "macu",
    name: "Payroll",
    amount: "-2000",
    currency: "USD",
    date: "2026-11-06",
    pending: false,
  };
  expect(expectedPaycheck(l, [t], "canyons", "2026-11-08")?.amountMinor).toBe(
    200000,
  );
  for (const change of [
    { pending: true },
    { amount: "-100" },
    { accountId: "other" },
    { currency: "EUR" },
  ])
    expect(
      expectedPaycheck(l, [{ ...t, ...change }], "canyons", "2026-11-08"),
    ).toBeNull();
  expect(expectedPaycheck(l, [t], "canyons", "2026-11-01")).toBeNull();
  expect(expectedPaycheck(l, [t], "unknown", "2026-11-08")).toBeNull();
});
it("flags material variation and rounds a two-deposit median to a whole cent", () => {
  const l = fundedLedger();
  l.paychecks.push({
    ...l.paychecks[0],
    id: "pay2",
    transactionId: "deposit2",
    amountMinor: 100001,
    date: "2026-11-07",
  });
  const tx = l.paychecks.map((p) => ({
    id: p.transactionId!,
    accountId: "macu",
    name: "Payroll",
    amount: String(-p.amountMinor / 100),
    currency: "USD",
    date: p.date,
    pending: false,
  }));
  expect(expectedPaycheck(l, tx, "canyons", "2026-11-08")).toMatchObject({
    amountMinor: 150001,
    varies: true,
    sampleSize: 2,
  });
});
