import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { it, expect } from "vitest";
import ReviewSummary from "../web/ReviewSummary";
import { projectReview } from "../shared/paycheckProjection";
import { fundedLedger } from "./paycheck-fixtures";
it("distinguishes safe cash from shortages and forecasts in accessible text", () => {
  const html = renderToStaticMarkup(
    <ReviewSummary
      projection={projectReview(fundedLedger(), "macu-pay", "2026-11-08")}
    />,
  );
  expect(html).toContain("Safe to spend");
  expect(html).toContain("$300.00");
  expect(html).toContain("Future paycheck reliance");
  const l = fundedLedger();
  l.obligations[0].amountMinor = null;
  expect(
    renderToStaticMarkup(
      <ReviewSummary projection={projectReview(l, "macu-pay", "2026-11-08")} />,
    ),
  ).toContain("Needs information");
});
