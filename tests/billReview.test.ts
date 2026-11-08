import { expect, it } from "vitest";
import { budgetPlanEntries, nextBillToReview } from "../web/billReview";
const records = [
  { id: "first", status: "review", kind: "bill" },
  { id: "current", status: "confirmed", kind: "bill" },
  { id: "saved", status: "confirmed", kind: "bill" },
  { id: "transfer", status: "review", kind: "transfer" },
  { id: "excluded", status: "excluded", kind: "bill" },
  { id: "next", status: "review", kind: "bill" },
];
it("advances to the next unreviewed bill, skipping confirmed, excluded and transfer entries", () => {
  expect(nextBillToReview(records, "current")).toBe("next");
});
it("wraps to an earlier bill still awaiting review", () => {
  expect(nextBillToReview(records, "next")).toBe("first");
});
it("finishes without reopening the current bill when nothing else needs review", () => {
  expect(
    nextBillToReview(
      records.filter((r) => r.id !== "first" && r.id !== "next"),
      "current",
    ),
  ).toBeNull();
  expect(
    nextBillToReview(
      [{ id: "current", status: "review", kind: "bill" }],
      "current",
    ),
  ).toBeNull();
});

it("hides excluded bills from Budget while preserving confirmed and unreviewed entries", () => {
  expect(budgetPlanEntries(records).map((r) => r.id)).toEqual([
    "first",
    "current",
    "saved",
    "transfer",
    "next",
  ]);
  expect(records.find((r) => r.id === "excluded")?.status).toBe("excluded");
});
it("advances from an excluded bill using its original list position", () => {
  expect(nextBillToReview(records, "excluded")).toBe("next");
});
