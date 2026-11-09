import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import PaymentFields from "../web/PaymentFields";
import { billPlanSubmission } from "../web/billPlanSubmission";
const row = {
  amount: "200.00",
  currency: "USD",
  expectedChargeCount: 4,
  payments: [{ date: "2026-10-01", amount: "200.00" }],
};
it("submits several labeled charges as one cycle and preserves older months", () => {
  const values = new FormData();
  values.set("expectedChargeCount", "4");
  values.set("paymentAmount", "200.00");
  values.append("chargeKey", "one");
  values.append("chargeLabel", "Sam");
  values.append("chargeKey", "two");
  values.append("chargeLabel", "");
  values.append("chargeKey", "");
  values.append("chargeLabel", "Unused");
  const result = billPlanSubmission(row, values, "2026-11", "confirmed");
  expect(result.expectedChargeCount).toBe(4);
  expect(result.payments).toHaveLength(2);
  expect(result.payments[1]).toMatchObject({
    date: "2026-11-01",
    amount: "200.00",
    expectedChargeCount: 4,
    charges: [
      { key: "one", label: "Sam" },
      { key: "two", label: "" },
    ],
  });
});
it("does not create a monthly cycle just from a default combined amount", () => {
  const values = new FormData();
  values.set("expectedChargeCount", "4");
  values.set("paymentAmount", "200.00");
  expect(billPlanSubmission(row, values, "2026-11", "review").payments).toEqual(
    row.payments,
  );
});
it("renders optional charge labels and separate selectors for a grouped commitment", () => {
  const html = renderToStaticMarkup(
    <PaymentFields row={row} month="2026-11" data={{ paymentOptions: [] }} />,
  );
  expect(html).toContain("Expected charges per month");
  expect(html).toContain("Charge label (optional)");
  expect(html).toContain("Add another charge");
  expect(html).toMatch(/select[^>]*name="actualTransactionKey"[^>]*disabled/);
});

it("preserves grouped charge evidence when the expected count is reduced back to one", () => {
  const values = new FormData();
  values.set("expectedChargeCount", "1");
  values.set("groupedCharges", "on");
  values.set("paymentAmount", "200.00");
  values.append("chargeKey", "one");
  values.append("chargeLabel", "Member");
  expect(
    billPlanSubmission(row, values, "2026-11", "review").payments[1],
  ).toMatchObject({
    expectedChargeCount: 1,
    charges: [{ key: "one", label: "Member" }],
  });
});
