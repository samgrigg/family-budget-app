import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import BillClassificationFields from "../web/BillClassificationFields";
it("hides expense and card controls for transfers, including stale card classification", () => {
  const html = renderToStaticMarkup(
    <BillClassificationFields
      kind="transfer"
      expenseType="creditPayment"
      creditAccountId="card"
      accounts={[]}
    />,
  );
  expect(html).not.toContain("<select");
  expect(html).not.toContain("Counts as");
  expect(html).toContain(
    "Moves money between accounts; excluded from bill totals.",
  );
});
it("keeps expense and card controls for bills", () => {
  const html = renderToStaticMarkup(
    <BillClassificationFields expenseType="creditPayment" accounts={[]} />,
  );
  expect(html).toContain("Counts as");
  expect(html).toContain("Credit card being paid");
});
