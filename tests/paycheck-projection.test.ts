import { expect, it } from "vitest";
import { projectReview } from "../shared/paycheckProjection";
import { parseReviewMoney, formatReviewMoney } from "../shared/reviewMoney";
import { fundedLedger } from "./paycheck-fixtures";
it("reserves due and later purchases from current cash", () => {
  expect(projectReview(fundedLedger(), "macu-pay", "2026-11-08")).toMatchObject(
    {
      safeToSpendMinor: 30000,
      paymentShortfallMinor: 0,
      futureRelianceMinor: 0,
    },
  );
});
it("does not turn unassigned card spending into safe cash", () => {
  const l = fundedLedger();
  l.contributions[2].amountMinor = 30000;
  expect(projectReview(l, "macu-pay", "2026-11-08")).toMatchObject({
    safeToSpendMinor: null,
    unassignedCardMinor: 10000,
  });
});
it("uses eligible future funds only as a forecast and exhausts current cash first", () => {
  const l = fundedLedger();
  l.obligations[2].amountMinor = 90000;
  l.contributions[2].amountMinor = 70000;
  l.paychecks.push({
    ...l.paychecks[0],
    id: "future",
    sourceId: "adobe",
    state: "expected",
    transactionId: null,
    date: "2026-11-19",
    nextPayday: "2026-12-03",
    amountMinor: 20000,
  });
  l.sources.push({
    id: "adobe",
    name: "Adobe",
    accountId: "etrade",
    incomeKey: null,
  });
  l.contributions.push({
    id: "future-reserve",
    paycheckId: "future",
    obligationId: "later",
    amountMinor: 20000,
    paymentAccountId: "etrade",
    neededBy: "2026-12-09",
  });
  expect(projectReview(l, "macu-pay", "2026-11-08")).toMatchObject({
    safeToSpendMinor: 0,
    paymentShortfallMinor: 0,
    futureRelianceMinor: 20000,
  });
  l.paychecks[1].date = "2026-12-11";
  expect(projectReview(l, "macu-pay", "2026-11-08").unassignedCardMinor).toBe(
    20000,
  );
});
it("shows due shortfall separately from later spending", () => {
  const l = fundedLedger();
  l.obligations.pop();
  l.contributions.pop();
  l.obligations[1].amountMinor = 140000;
  l.contributions[1].amountMinor = 120000;
  expect(projectReview(l, "macu-pay", "2026-11-08")).toMatchObject({
    safeToSpendMinor: 0,
    paymentShortfallMinor: 20000,
  });
});
it("consumes a reservation exactly once when payment settles", () => {
  const l = fundedLedger();
  l.settlements.push({
    id: "paid",
    paycheckId: "macu-pay",
    obligationId: "statement",
    contributionId: "reserve-statement",
    amountMinor: 50000,
    transactionIds: ["debit", "credit"],
    confirmed: true,
  });
  const p = projectReview(l, "macu-pay", "2026-11-08");
  expect(p.safeToSpendMinor).toBe(30000);
  expect(
    p.obligationCoverage.find((c) => c.obligationId === "statement"),
  ).toMatchObject({ paidMinor: 50000, cashMinor: 0, uncoveredMinor: 0 });
  expect(projectReview(l, "macu-pay", "2026-11-20").leftoverMinor).toBe(30000);
});
it("blocks certainty for unknown inputs and excess promised capacity", () => {
  const l = fundedLedger();
  l.obligations[0].amountMinor = null;
  expect(
    projectReview(l, "macu-pay", "2026-11-08").safeToSpendMinor,
  ).toBeNull();
  l.obligations[0].amountMinor = 80000;
  l.contributions[2].amountMinor = 80000;
  expect(
    projectReview(l, "macu-pay", "2026-11-08").issues.some(
      (i) => i.code === "OVERALLOCATED",
    ),
  ).toBe(true);
});
it("parses exact cents and rejects invalid financial input", () => {
  expect(parseReviewMoney("0.10")).toBe(10);
  expect(formatReviewMoney(12345)).toBe("123.45");
  for (const value of ["1e3", "NaN", "-1", "1.001", "9007199254740992"])
    expect(() => parseReviewMoney(value)).toThrow();
});
