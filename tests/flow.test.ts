import { expect, it } from "vitest";
import { buildFlow } from "../server/flow";
const t = (account: string, amount: number) => ({
  connection: "c",
  account,
  amount: String(amount),
});
it("routes income through transfers to bills and conserves each account stage", () => {
  const g = buildFlow(
    [{ key: "pay", name: "Salary", transactions: [t("a", 1000)] }],
    [{ key: "rent", name: "Rent", transactions: [t("b", 600)] }],
    [{ out: t("a", 800), into: t("b", -800) }],
    new Map(),
  );
  expect(g.links.find((e) => e.kind === "Internal transfer")?.amount).toBe(800);
  expect(
    g.links
      .filter((e) => e.target === "remaining")
      .reduce((s, e) => s + e.amount, 0),
  ).toBe(400);
  for (const n of g.nodes.filter((n) => n.column === 1 || n.column === 2))
    expect(
      g.links
        .filter((e) => e.target === n.id)
        .reduce((s, e) => s + e.amount, 0),
    ).toBe(
      g.links
        .filter((e) => e.source === n.id)
        .reduce((s, e) => s + e.amount, 0),
    );
});
it("marks missing funding explicitly and supports transfers in both directions without graph cycles", () => {
  const g = buildFlow(
    [],
    [{ key: "bill", name: "Bill", transactions: [t("a", 50)] }],
    [
      { out: t("a", 100), into: t("b", -100) },
      { out: t("b", 20), into: t("a", -20) },
    ],
    new Map(),
  );
  expect(
    g.links
      .filter((e) => e.source === "funding")
      .reduce((s, e) => s + e.amount, 0),
  ).toBe(150);
  for (const e of g.links)
    expect(g.nodes.find((n) => n.id === e.source)!.column).toBeLessThan(
      g.nodes.find((n) => n.id === e.target)!.column,
    );
});
