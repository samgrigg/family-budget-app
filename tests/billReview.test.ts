import { expect, it } from "vitest";
import { nextBillToReview } from "../web/billReview";
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
