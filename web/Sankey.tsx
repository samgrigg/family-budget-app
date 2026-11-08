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
  const height = Math.max(
    640,
    ...[0, 1, 2, 3].map(
      (col) => nodes.filter((n: any) => n.column === col).length * 78 + 120,
    ),
  );
  const scale = Math.min(
    ...[0, 1, 2, 3].map((col) => {
      const ns = nodes.filter((n: any) => n.column === col);
      return ns.length
        ? (height - 150 - ns.length * 54) /
            ns.reduce((a: number, n: any) => a + n.value, 0)
        : Infinity;
    }),
  );
  for (const col of [0, 1, 2, 3]) {
    let y = 100;
    for (const n of nodes.filter((n: any) => n.column === col)) {
      n.x = 30 + col * 360;
      n.y = y;
      n.h = n.value * scale;
      n.out = 0;
      n.into = 0;
      y += n.h + 54;
    }
  }
  const colors: any = {
    Income: "#25634b",
    Bill: "#62418a",
    "Internal transfer": "#3569a6",
    "Same account": "#7a8190",
    "Untraced funding": "#8a6b35",
    Unallocated: "#a1a1aa",
    Savings: "#087f8c",
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
          Follow income from its source, through your accounts, to bills and
          savings.
        </p>
        <dl className="flow-story-totals">
          {[
            ["Income", sumKind("Income")],
            ["Bills", sumKind("Bill")],
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
          Interest and dividends are grouped as Other income. Additional funding
          is shown separately; these figures are not a balanced household
          budget. {data.savingsBasis}
        </p>
        {active && (
          <button
            type="button"
            className="secondary"
            onClick={() => setActive(null)}
          >
            Clear highlighted account
          </button>
        )}
      </div>
      <svg
        viewBox={`0 0 1460 ${height}`}
        style={{ minWidth: 1000 }}
        role="group"
        aria-label={`Money flow for ${month}. See flow list below for all connections and values.`}
      >
        {[
          "1 · Income & other funding",
          "2 · Where it lands",
          "3 · How it moves",
          "4 · Spent, saved, or unallocated",
        ].map((s, i) => (
          <text x={30 + i * 360} y={32} key={s} fontSize="14" fontWeight="600">
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
                      : "#52525b"
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
