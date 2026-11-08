import { expect, it } from "vitest";
import { summarizeFlow, spendingGroup } from "../web/flowSummary";
it("collapses routing and spending destinations while preserving external totals", () => {
  const data = {
    nodes: [
      { id: "income:job", name: "Employer", column: 0 },
      { id: "before:a", name: "A", column: 1 },
      { id: "after:b", name: "B", column: 2 },
      { id: "bill:rent", name: "Rent", column: 3 },
      { id: "bill:store", name: "Groceries", column: 3 },
      { id: "savings", name: "Savings", column: 3 },
    ],
    links: [
      {
        source: "income:job",
        target: "before:a",
        amount: 1000,
        kind: "Income",
      },
      {
        source: "before:a",
        target: "after:b",
        amount: 1000,
        kind: "Internal transfer",
      },
      { source: "after:b", target: "bill:rent", amount: 600, kind: "Bill" },
      {
        source: "after:b",
        target: "bill:store",
        amount: 100,
        kind: "Spending",
      },
      { source: "after:b", target: "savings", amount: 300, kind: "Savings" },
    ],
  };
  const result = summarizeFlow(data);
  expect(
    result.nodes.some(
      (n: any) => n.id.startsWith("before:") || n.id.startsWith("after:"),
    ),
  ).toBe(false);
  expect(result.nodes.some((n: any) => n.name === "Housing")).toBe(true);
  expect(
    result.links
      .filter((e: any) => e.source === "household")
      .reduce((s: number, e: any) => s + e.amount, 0),
  ).toBe(1000);
  expect(
    result.links
      .filter((e: any) => e.target === "household")
      .reduce((s: number, e: any) => s + e.amount, 0),
  ).toBe(1000);
  expect(data.links).toHaveLength(4 + 1);
});
it("keeps unmatched categories and empty graphs explicit", () => {
  expect(spendingGroup("Unrecognized", "Bill")).toBe("Other confirmed bills");
  expect(spendingGroup("Unrecognized", "Spending")).toBe("Other spending");
  expect(summarizeFlow({ nodes: [], links: [] }).nodes).toHaveLength(0);
});
