import { it, expect } from "vitest";
import {
  updateContribution,
  previewReview,
  draftChanges,
} from "../web/reviewDraft";
import { fundedLedger } from "./paycheck-fixtures";
it("updates funding without mutating saved state or hiding unassigned spending", () => {
  const l = fundedLedger(),
    edited = updateContribution(l, {
      ...l.contributions[2],
      amountMinor: 30000,
    });
  expect(l.contributions[2].amountMinor).toBe(40000);
  expect(
    previewReview(edited, "macu-pay", "2026-11-08").safeToSpendMinor,
  ).toBeNull();
  expect(draftChanges(l, edited)).toHaveLength(1);
});
