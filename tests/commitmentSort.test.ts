import { expect, it } from "vitest";
import { sortCommitments } from "../web/commitmentSort";
const rows = [
  {
    id: "ten",
    name: "Bill 10",
    day: 10,
    accountName: "Savings",
    frequency: "Yearly",
    currency: "USD",
    resolvedAmount: { amount: 10 },
  },
  {
    id: "two",
    name: "bill 2",
    day: 2,
    accountName: "Checking",
    frequency: "Monthly",
    currency: "USD",
    resolvedAmount: { amount: 2 },
  },
  {
    id: "unknown",
    name: "Other",
    day: null,
    accountName: "",
    frequency: "Unknown",
    currency: "USD",
    resolvedAmount: { amount: null },
  },
];
it("sorts days numerically and keeps unset days last in both directions", () => {
  expect(
    sortCommitments(rows, { key: "day", direction: "ascending" }).map(
      (r) => r.id,
    ),
  ).toEqual(["two", "ten", "unknown"]);
  expect(
    sortCommitments(rows, { key: "day", direction: "descending" }).map(
      (r) => r.id,
    ),
  ).toEqual(["ten", "two", "unknown"]);
});
it("sorts the displayed resolved amount, including zero, with unknown values last", () => {
  const data = [
    ...rows,
    { ...rows[0], id: "zero", amount: "9999", resolvedAmount: { amount: 0 } },
  ];
  expect(
    sortCommitments(data, { key: "amount", direction: "ascending" }).map(
      (r) => r.id,
    ),
  ).toEqual(["zero", "two", "ten", "unknown"]);
  expect(
    sortCommitments(data, { key: "amount", direction: "descending" }).map(
      (r) => r.id,
    ),
  ).toEqual(["ten", "two", "zero", "unknown"]);
});
it("sorts names naturally, payment accounts alphabetically and frequency by cadence", () => {
  expect(
    sortCommitments(rows, { key: "name", direction: "ascending" }).map(
      (r) => r.id,
    ),
  ).toEqual(["two", "ten", "unknown"]);
  expect(
    sortCommitments(rows, { key: "accountName", direction: "descending" }).map(
      (r) => r.id,
    ),
  ).toEqual(["ten", "two", "unknown"]);
  expect(
    sortCommitments(rows, { key: "frequency", direction: "ascending" }).map(
      (r) => r.id,
    ),
  ).toEqual(["two", "ten", "unknown"]);
});
it("keeps equal keys stable and never mutates the source array", () => {
  const data = [
    { ...rows[0], id: "a", day: 1 },
    { ...rows[1], id: "b", day: 1 },
  ];
  expect(
    sortCommitments(data, { key: "day", direction: "descending" }).map(
      (r) => r.id,
    ),
  ).toEqual(["a", "b"]);
  expect(sortCommitments(rows, null).map((r) => r.id)).toEqual([
    "ten",
    "two",
    "unknown",
  ]);
  sortCommitments(rows, { key: "day", direction: "ascending" });
  expect(rows.map((r) => r.id)).toEqual(["ten", "two", "unknown"]);
});
it("groups different currencies without assuming exchange rates when sorting amounts", () => {
  const data = [
    { ...rows[0], id: "usd", resolvedAmount: { amount: 1 } },
    { ...rows[0], id: "cad", currency: "CAD", resolvedAmount: { amount: 100 } },
  ];
  expect(
    sortCommitments(data, { key: "amount", direction: "ascending" }).map(
      (r) => r.id,
    ),
  ).toEqual(["cad", "usd"]);
});

it("keeps record identities so expanded forms can move with their commitments", () => {
  const sorted = sortCommitments(rows, { key: "day", direction: "ascending" });
  expect(sorted[0]).toBe(rows[1]);
  expect(sorted[1]).toBe(rows[0]);
});
