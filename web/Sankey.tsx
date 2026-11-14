import { useState } from "react";
export default function Sankey({ data, month, money }: any) {
  const [active, setActive] = useState<string | null>(null);
  const nodes = (data?.nodes ?? []).map((n: any) => ({
    ...n,
    value: Math.max(
      data.links
        .filter((e: any) => e.source === n.id)
        .reduce((a: number, e: any) => a + e.amount, 0),
      data.links
        .filter((e: any) => e.target === n.id)
        .reduce((a: number, e: any) => a + e.amount, 0),
    ),
  }));
  nodes.sort(
    (a: any, b: any) =>
      a.column - b.column ||
      (a.id === "remaining"
        ? 1
        : b.id === "remaining"
          ? -1
          : b.value - a.value),
  );
  const columns = data.summary ? [0, 1, 2] : [0, 1, 2, 3];
  const height = Math.max(
    640,
    ...columns.map(
      (col) => nodes.filter((n: any) => n.column === col).length * 78 + 120,
    ),
  );
  const scale = Math.min(
    ...columns.map((col) => {
      const ns = nodes.filter((n: any) => n.column === col);
      return ns.length
        ? (height - 150 - ns.length * 54) /
            ns.reduce((a: number, n: any) => a + n.value, 0)
        : Infinity;
    }),
  );
  for (const col of columns) {
    let y = 100;
    for (const n of nodes.filter((n: any) => n.column === col)) {
      n.x = 30 + col * (data.summary ? 520 : 360);
      n.y = y;
      n.h = n.value * scale;
      n.out = 0;
      n.into = 0;
      y += n.h + 54;
    }
  }
  const colors: any = {
    Income: "var(--flow-income)",
    Bill: "var(--flow-bill)",
    Spending: "var(--flow-spending)",
    "Boundary inflow": "var(--flow-boundary)",
    "Boundary outflow": "var(--flow-boundary)",
    "Other inflow": "var(--flow-other)",
    "Debt payment": "var(--flow-debt)",
    "Internal transfer": "var(--flow-transfer)",
    "Same account": "var(--flow-same)",
    "Untraced funding": "var(--flow-untraced)",
    Unallocated: "var(--flow-unallocated)",
    Savings: "var(--flow-savings)",
  };
  const paths = (data?.links ?? []).map((e: any) => {
    const a = nodes.find((n: any) => n.id === e.source),
      b = nodes.find((n: any) => n.id === e.target),
      w = e.amount * scale,
      sy = a.y + a.out + w / 2,
      ty = b.y + b.into + w / 2;
    a.out += w;
    b.into += w;
    return {
      ...e,
      path: `M${a.x + 12},${sy} C${a.x + 170},${sy} ${b.x - 160},${ty} ${b.x},${ty}`,
      w,
    };
  });

  if (!nodes.length) return null;
  const sumKind = (kind: string) =>
    data.links
      .filter((e: any) => e.kind === kind)
      .reduce((sum: number, e: any) => sum + e.amount, 0);
  return (
    <>
      <div className="flow-story">
        <h2>Where the money goes</h2>
        <p>
          {data.summary
            ? "A household view of money coming in and where it goes. Expand Account routing to follow transfers."
            : "Follow income through your accounts to spending and savings."}
        </p>
        <dl className="flow-story-totals">
          {[
            [
              "Income & other credits",
              sumKind("Income") + sumKind("Other inflow"),
            ],
            ["Bills & other spending", sumKind("Bill") + sumKind("Spending")],
            ["Savings · modeled", sumKind("Savings")],
            ["Other / unallocated", sumKind("Unallocated")],
          ].map(([label, amount]) => (
            <div key={String(label)}>
              <dt>{label}</dt>
              <dd>{money(Number(amount))}</dd>
            </div>
          ))}
        </dl>
        <p className="fine">
          All posted activity is included; interest and dividends are grouped as
          Other income. Debt payments are account movements, not additional
          spending on top of card purchases. Additional funding is shown
          separately; these figures are not a balanced household budget.{" "}
          {data.savingsBasis}
        </p>
        {data.summary && (
          <details>
            <summary>About the spending groups</summary>
            <p>
              Suggested categories use words in transaction descriptions.
              Unrecognized purchases go to Other spending; unrecognized
              confirmed bills go to Other confirmed bills. Categories can be
              wrong. Open Detailed flows for original destinations. Income is
              pooled here; this does not assign a particular paycheck to a
              particular expense.
            </p>
          </details>
        )}
        {active && (
          <button
            type="button"
            className="secondary"
            onClick={() => setActive(null)}
          >
            Clear highlight
          </button>
        )}
      </div>
      <svg
        viewBox={`0 0 1460 ${height}`}
        style={{ minWidth: 1000 }}
        role="group"
        aria-label={`Money flow for ${month}. See flow list below for all connections and values.`}
      >
        {(data.summary
          ? ["1 · Money in", "2 · Household", "3 · Spending & saving"]
          : [
              "1 · Income & other funding",
              "2 · Where it lands",
              "3 · How it moves",
              "4 · Spent, saved, or unallocated",
            ]
        ).map((s, i) => (
          <text
            x={30 + i * (data.summary ? 520 : 360)}
            y={32}
            key={s}
            fontSize="14"
            fontWeight="600"
          >
            {s}
          </text>
        ))}
        {paths.map((p: any, i: number) => (
          <path
            key={i}
            d={p.path}
            fill="none"
            stroke={colors[p.kind]}
            strokeOpacity={
              !active || p.source === active || p.target === active
                ? 0.55
                : 0.07
            }
            strokeWidth={p.w}
          >
            <title>
              {p.kind}: {money(p.amount)}
            </title>
          </path>
        ))}
        {nodes.map((n: any) => (
          <g
            key={n.id}
            role="button"
            tabIndex={0}
            aria-label={`${n.name}: ${money(n.value)}. Highlight flows`}
            aria-pressed={active === n.id}
            onClick={() => setActive(active === n.id ? null : n.id)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setActive(active === n.id ? null : n.id);
              }
            }}
            className="network-node"
          >
            <rect
              x={n.x}
              y={n.y}
              width={12}
              height={n.h}
              fill={
                n.id === "savings"
                  ? colors.Savings
                  : n.id.startsWith("bill:")
                    ? colors.Bill
                    : n.id.startsWith("income:")
                      ? colors.Income
                      : "var(--muted-foreground)"
              }
            />
            <text x={n.x + 17} y={n.y - 10} fontSize="14">
              <title>
                {n.name} · {money(n.value)}
              </title>
              {n.name.length > 36 ? n.name.slice(0, 35) + "…" : n.name}
            </text>
            <text x={n.x + 17} y={n.y + 12} fontSize="14" fontWeight="600">
              {money(n.value)}
            </text>
          </g>
        ))}
      </svg>
    </>
  );
}
