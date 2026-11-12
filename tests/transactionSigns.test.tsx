import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import IncomeReview from "../web/IncomeReview";
it("shows positive incoming money in income deposit evidence", () => {
  const html = renderToStaticMarkup(
    <IncomeReview
      data={{
        suggestions: [
          {
            key: "pay",
            name: "Pay",
            employer: "Employer",
            transactions: [
              {
                id: "t",
                date: "2026-11-11",
                currency: "USD",
                amount: "-2500.5",
                name: "Payroll",
              },
            ],
          },
        ],
        saved: [],
        dismissed: [],
      }}
    />,
  );
  expect(html).toContain("+$2,500.50");
  expect(html).not.toContain("$-2500");
});
