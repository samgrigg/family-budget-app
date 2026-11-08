import { installBills } from "../server/bills";
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

it("separates modeled savings from other residuals without counting transfers out as savings", () => {
  const key = JSON.stringify(["c", "savings"]);
  const g = buildFlow(
    [{ key: "salary", name: "Employer", transactions: [t("checking", 1000)] }],
    [],
    [
      { out: t("checking", 400), into: t("savings", -400) },
      { out: t("savings", 100), into: t("checking", -100) },
    ],
    new Map(),
    new Set([key]),
  );
  expect(
    g.links
      .filter((e) => e.kind === "Savings")
      .reduce((s, e) => s + e.amount, 0),
  ).toBe(300);
  expect(
    g.links
      .filter((e) => e.kind === "Unallocated")
      .reduce((s, e) => s + e.amount, 0),
  ).toBe(800);
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

import { Store } from "../server/store";
import { flowState } from "../server/flow";
it("includes unconfirmed spending and deposits, global-hidden accounts, and inactive account choices", () => {
  const s = new Store(":memory:", Buffer.alloc(32), "sandbox");
  s.connect("c", "token", [
    { account_id: "a", name: "Checking", type: "depository" },
    { account_id: "b", name: "Savings", type: "depository" },
    { account_id: "inactive", name: "Unused" },
  ]);
  s.setAccountHidden("c", "a", true);
  for (const [id, account, name, amount, pending] of [
    ["pay", "a", "ACH Deposit COMPANY: EXAMPLE INC ENTRY: PAYROLL", -1000, 0],
    ["shop", "a", "Groceries", 100, 0],
    ["refund", "a", "Refund", -10, 0],
    ["interest", "b", "Interest", -5, 0],
    ["pending", "a", "Pending purchase", 50, 1],
  ] as const)
    s.db
      .prepare("INSERT INTO transactions VALUES(?,?,?,?,?,?,?,?,?)")
      .run(
        s.env,
        "c",
        id,
        account,
        "2026-11-01",
        name,
        String(amount),
        "USD",
        pending,
      );
  installBills(s);
  const g = flowState(s, "2026-11", "USD");
  expect(
    g.links
      .filter((e) => e.kind === "Spending")
      .reduce((sum, e) => sum + e.amount, 0),
  ).toBe(100);
  expect(
    g.links
      .filter((e) => e.kind === "Income")
      .reduce((sum, e) => sum + e.amount, 0),
  ).toBe(1005);
  expect(
    g.links
      .filter((e) => e.kind === "Other inflow")
      .reduce((sum, e) => sum + e.amount, 0),
  ).toBe(10);
  expect(g.nodes.some((n) => n.name === "EXAMPLE INC")).toBe(true);
  expect(g.nodes.some((n) => n.name === "Other income")).toBe(true);
  expect(
    g.nodes.some((n) =>
      n.id.includes(
        s.accountList().find((a) => a.id === "inactive")!.canonicalAccountId,
      ),
    ),
  ).toBe(true);
  s.db.close();
});
