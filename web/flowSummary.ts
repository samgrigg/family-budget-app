// Suggested categories use descriptions, not a verified merchant classification.
export function spendingGroup(name: string, kind: string) {
  if (/\b(mortgage|rent|housing|property tax)\b/i.test(name)) return "Housing";
  if (
    /\b(electric|power|water|utility|utilities|enbridge|internet|wireless|telecom)\b/i.test(
      name,
    )
  )
    return "Utilities & communications";
  if (
    /\b(grocery|groceries|smith.?s|costco|whole foods|trader joe|harmons)\b/i.test(
      name,
    )
  )
    return "Groceries & household";
  if (
    /\b(restaurant|cafe|coffee|mcdonald|chick.fil|dining|pizza|chicken|bakery)\b/i.test(
      name,
    )
  )
    return "Food & dining";
  if (
    /\b(fuel|chevron|shell|maverik|transport|parking|transit|auto)\b/i.test(
      name,
    )
  )
    return "Transport";
  if (/\b(insurance|medical|dental|pharmacy|hospital)\b/i.test(name))
    return "Health & insurance";
  if (
    /\b(netflix|spotify|apple|disney|subscription|cinemark|hulu|gym|fitness)\b/i.test(
      name,
    )
  )
    return "Subscriptions & leisure";
  return kind === "Bill" ? "Other confirmed bills" : "Other spending";
}
export function summarizeFlow(data: any) {
  const byId = new Map<string, any>(data.nodes.map((n: any) => [n.id, n]));
  const amounts = new Map<string, any>();
  const add = (
    source: string,
    target: string,
    amount: number,
    kind: string,
  ) => {
    if (amount <= 0) return;
    const key = JSON.stringify([source, target]);
    const old = amounts.get(key);
    amounts.set(key, {
      source,
      target,
      amount: (old?.amount ?? 0) + amount,
      kind,
    });
  };
  const nodes = new Map<string, any>([
    ["household", { id: "household", name: "Household cash flow", column: 1 }],
  ]);
  for (const e of data.links) {
    const a = byId.get(e.source),
      b = byId.get(e.target);
    if (a?.column === 0) {
      nodes.set(a.id, { ...a, column: 0 });
      add(a.id, "household", e.amount, e.kind);
    }
    if (b?.column === 3) {
      const group =
        e.kind === "Debt payoff"
          ? "Debt payoff"
          : e.kind === "Debt repayment without purchase history"
            ? "Credit card repayments · purchase history unavailable"
            : b.id === "savings"
              ? "Savings · modeled"
              : b.id === "remaining"
                ? "Other spending / retained funds"
                : e.kind === "Boundary outflow"
                  ? "To hidden accounts"
                  : spendingGroup(b.name, e.kind);
      const key = `group:${group}`;
      nodes.set(key, { id: key, name: group, column: 2 });
      add(
        "household",
        key,
        e.amount,
        e.kind === "Bill" || e.kind === "Spending" ? "Spending" : e.kind,
      );
    }
  }
  const incoming = [...amounts.values()]
      .filter((e) => e.target === "household")
      .reduce((s, e) => s + e.amount, 0),
    outgoing = [...amounts.values()]
      .filter((e) => e.source === "household")
      .reduce((s, e) => s + e.amount, 0);
  if (outgoing - incoming > 0.005) {
    nodes.set("gap", {
      id: "gap",
      name: "Unresolved routing / funding gap",
      column: 0,
    });
    add("gap", "household", outgoing - incoming, "Untraced funding");
  }
  if (incoming - outgoing > 0.005) {
    nodes.set("unresolved", {
      id: "unresolved",
      name: "Unresolved routing remainder",
      column: 2,
    });
    add("household", "unresolved", incoming - outgoing, "Unallocated");
  }
  const links = [...amounts.values()];
  const used = new Set(links.flatMap((e) => [e.source, e.target]));
  return {
    ...data,
    summary: true,
    nodes: [...nodes.values()].filter((n) => used.has(n.id)),
    links,
  };
}
