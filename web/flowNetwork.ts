export function flowNetwork(data: any, hidden: string[] = []) {
  const id = (key: string) =>
    key.startsWith("before:")
      ? `account:${key.slice(7)}`
      : key.startsWith("after:")
        ? `account:${key.slice(6)}`
        : key;
  const accounts = [
    ...new Map<string, any>(
      (data.nodes as any[])
        .filter((n) => n.id.startsWith("before:") || n.id.startsWith("after:"))
        .map((n) => [
          id(n.id),
          { id: id(n.id), name: n.name, kind: "Account" },
        ]),
    ).values(),
  ].sort((a, b) => a.name.localeCompare(b.name));
  const nodes = [
    ...accounts,
    ...data.nodes
      .filter(
        (n: any) => n.id.startsWith("income:") || n.id.startsWith("bill:"),
      )
      .map((n: any) => ({
        ...n,
        kind: n.id.startsWith("income:") ? "Income" : "Bill",
      })),
  ];
  const links = data.links
    .filter((e: any) =>
      [
        "Income",
        "Other inflow",
        "Bill",
        "Spending",
        "Debt payment",
        "Internal transfer",
      ].includes(e.kind),
    )
    .map((e: any) => ({ ...e, source: id(e.source), target: id(e.target) }))
    .filter(
      (e: any) => !hidden.includes(e.source) && !hidden.includes(e.target),
    );
  const used = new Set(links.flatMap((e: any) => [e.source, e.target]));
  return { accounts, nodes: nodes.filter((n) => used.has(n.id)), links };
}

export function filteredSankey(data: any, hidden: string[] = []) {
  const accountId = (id: string) =>
    id.startsWith("before:")
      ? `account:${id.slice(7)}`
      : id.startsWith("after:")
        ? `account:${id.slice(6)}`
        : id;
  const links = data.links.flatMap((e: any) => {
    const sourceHidden = hidden.includes(accountId(e.source)),
      targetHidden = hidden.includes(accountId(e.target));
    if (!sourceHidden && !targetHidden) return [e];
    if (sourceHidden && targetHidden) return [];
    if (!["Internal transfer", "Debt payment"].includes(e.kind)) return [];
    return [
      {
        ...e,
        source: sourceHidden ? "income:hidden" : e.source,
        target: targetHidden ? "bill:hidden" : e.target,
        kind: sourceHidden ? "Boundary inflow" : "Boundary outflow",
      },
    ];
  });
  const used = new Set(links.flatMap((e: any) => [e.source, e.target]));
  return {
    ...data,
    links,
    nodes: [
      ...data.nodes.filter((n: any) => used.has(n.id)),
      ...(used.has("income:hidden")
        ? [{ id: "income:hidden", name: "From hidden accounts", column: 0 }]
        : []),
      ...(used.has("bill:hidden")
        ? [{ id: "bill:hidden", name: "To hidden accounts", column: 3 }]
        : []),
    ],
  };
}
