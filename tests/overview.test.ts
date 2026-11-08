import { expect, it } from "vitest";
import { buildOverview } from "../web/monthProjection";
const bill = (
  key: string,
  frequency = "Monthly",
  currency = "USD",
  typical: number | null = 100,
) => ({
  key,
  name: key,
  frequency,
  currency,
  typical,
  transactions: [
    { date: "2026-08-30" },
    { date: "2026-09-30" },
    { date: "2026-10-31" },
  ],
});
it("groups confirmed bill inputs by approximate day and keeps month end at the end", () => {
  const first = { ...bill("early"), transactions: [{ date: "2026-10-02" }] };
  const result = buildOverview([bill("late"), first]);
  expect(result.events.map((e) => e.day)).toEqual([2, 31]);
  expect(result.events[1].monthEnd).toBe(true);
  expect(result.totals).toEqual([{ currency: "USD", amount: 200 }]);
});
it("separates currencies and less frequent/unknown schedules from monthly totals", () => {
  const result = buildOverview([
    bill("usd"),
    bill("cad", "Monthly", "CAD", 50),
    bill("annual", "Yearly"),
    bill("irregular", "Irregular"),
    { ...bill("empty"), transactions: [] },
  ]);
  expect(result.totals).toEqual([
    { currency: "USD", amount: 100 },
    { currency: "CAD", amount: 50 },
  ]);
  expect(result.occasional).toHaveLength(1);
  expect(result.unscheduled).toHaveLength(2);
});
it("illustrates weekly and biweekly occurrences while averaging monthly cost", () => {
  const result = buildOverview([
    bill("weekly", "Weekly", "USD", 12),
    bill("biweekly", "Every two weeks", "USD", 12),
  ]);
  expect(result.totals[0].amount).toBe(78);
  expect(
    result.events.every((e) => e.approximate && e.day >= 1 && e.day <= 31),
  ).toBe(true);
  expect(
    result.events.filter((e) => e.bill.key === "weekly").length,
  ).toBeGreaterThanOrEqual(4);
});

it("shows credit repayments on the timeline without adding them to expense estimates", () => {
  const result = buildOverview([
    {
      key: "purchase",
      name: "Service",
      currency: "USD",
      typical: 50,
      frequency: "Monthly",
      transactions: [{ date: "2026-11-01" }],
    },
    {
      key: "payment",
      name: "Card payment",
      currency: "USD",
      typical: 100,
      frequency: "Monthly",
      expenseType: "creditPayment",
      transactions: [{ date: "2026-11-23" }],
    },
  ]);
  expect(result.events).toHaveLength(2);
  expect(result.totals).toEqual([{ currency: "USD", amount: 50 }]);
});
