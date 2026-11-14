import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import AccountBalance from "../web/AccountBalance";
it("shows zero as a balance and distinguishes debt from available credit", () => {
  const html = renderToStaticMarkup(
    <AccountBalance
      account={{
        type: "credit",
        balance: {
          current: "0",
          available: "500",
          currency: "USD",
          retrievedAt: "2026-11-11T12:00:00Z",
          stale: false,
        },
      }}
    />,
  );
  expect(html).toContain("$0.00");
  expect(html).toContain("Amount owed");
  expect(html).toContain("Available credit");
  expect(html).toContain("$500.00");
  expect(html).toContain("Retrieved");
  expect(html).not.toContain("Live");
});
it("does not treat unavailable current balance as zero or substitute available funds", () => {
  const html = renderToStaticMarkup(
    <AccountBalance
      account={{
        type: "depository",
        balance: {
          current: null,
          available: "25",
          currency: "CAD",
          retrievedAt: "2026-11-11T12:00:00Z",
          stale: true,
        },
      }}
    />,
  );
  expect(html).toContain("Balance unavailable");
  expect(html).toContain("Available funds");
  expect(html).toContain("CA$");
  expect(html).toContain("Stale");
  expect(html).not.toContain("$0.00");
});
it("labels unavailable currency rather than silently assuming dollars", () => {
  const html = renderToStaticMarkup(
    <AccountBalance
      account={{
        type: "investment",
        balance: {
          current: "125",
          available: "25",
          currency: "",
          retrievedAt: null,
        },
      }}
    />,
  );
  expect(html).toContain("Currency unknown");
  expect(html).not.toContain("Available funds");
});
