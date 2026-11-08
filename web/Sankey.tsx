export default function Sankey({ data, month, money }: any) {
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
  const height = Math.max(
    500,
    ...[0, 1, 2, 3].map(
      (col) => nodes.filter((n: any) => n.column === col).length * 64 + 80,
    ),
  );
  const scale = Math.min(
    ...[0, 1, 2, 3].map((col) => {
      const ns = nodes.filter((n: any) => n.column === col);
      return ns.length
        ? (height - 100 - ns.length * 40) /
            ns.reduce((a: number, n: any) => a + n.value, 0)
        : Infinity;
    }),
  );
  for (const col of [0, 1, 2, 3]) {
    let y = 60;
    for (const n of nodes.filter((n: any) => n.column === col)) {
      n.x = 15 + col * 330;
      n.y = y;
      n.h = n.value * scale;
      n.out = 0;
      n.into = 0;
      y += n.h + 40;
    }
  }
  const colors: any = {
    Income: "#25634b",
    Bill: "#62418a",
    "Internal transfer": "#3569a6",
    "Same account": "#7a8190",
    "Untraced funding": "#8a6b35",
    Unallocated: "#888888",
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
  return (
    <svg
      viewBox={`0 0 1160 ${height}`}
      style={{ minWidth: 1000 }}
      role="img"
      aria-label={`Money flow for ${month}. See flow list below for all connections and values.`}
    >
      {[
        "Income and funding",
        "Funding accounts",
        "Payment accounts",
        "Bills and unallocated",
      ].map((s, i) => (
        <text x={15 + i * 330} y={22} key={s} fontSize="14" fontWeight="600">
          {s}
        </text>
      ))}
      {paths.map((p: any, i: number) => (
        <path
          key={i}
          d={p.path}
          fill="none"
          stroke={colors[p.kind]}
          strokeOpacity={0.45}
          strokeWidth={p.w}
        >
          <title>
            {p.kind}: {money(p.amount)}
          </title>
        </path>
      ))}
      {nodes.map((n: any) => (
        <g key={n.id}>
          <rect x={n.x} y={n.y} width={12} height={n.h} fill="#34343c" />
          <text x={n.x + 17} y={n.y + 12} fontSize="12">
            <title>
              {n.name} · {money(n.value)}
            </title>
            {n.name.length > 25 ? n.name.slice(0, 24) + "…" : n.name}
          </text>
          <text x={n.x + 17} y={n.y + 28} fontSize="12">
            {money(n.value)}
          </text>
        </g>
      ))}
    </svg>
  );
}
