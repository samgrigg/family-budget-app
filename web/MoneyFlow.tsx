import { useEffect, useState } from "react";
export default function MoneyFlow({ api }: any) {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7)),
    [currency, setCurrency] = useState("USD"),
    [data, setData] = useState<any>(null),
    [error, setError] = useState(""),
    [selected, setSelected] = useState<any>(null);
  useEffect(() => {
    let cancelled = false;
    setData(null);
    setSelected(null);
    api(
      `/flow?month=${encodeURIComponent(month)}&currency=${encodeURIComponent(currency)}`,
    )
      .then((d: any) => {
        if (!cancelled) {
          setData(d);
          setError("");
        }
      })
      .catch((e: any) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [month, currency]);
  const money = (n: number) =>
    `${currency === "USD" ? "$" : `${currency} `}${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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
  return (
    <>
      <h1 tabIndex={-1} id="main-content">
        Money Flow
      </h1>
      <p>
        Recorded income → accounts → transfers → bill payments. Band widths
        represent amounts.
      </p>
      <div className="flow-filters">
        <label>
          Calendar month
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
          />
        </label>
        <label>
          Currency
          <select
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
          >
            {[...new Set([currency, ...(data?.currencies ?? [])])].map(
              (c: any) => (
                <option key={c}>{c}</option>
              ),
            )}
          </select>
        </label>
      </div>
      <p>
        Accounts appear in two stages to show routing, including transfers in either direction. This is aggregate monthly flow, not a trace of individual dollars. Uses confirmed income, bills, and internal transfers. Untraced funding
        and unallocated money balance the diagram; they are not measured
        balances or verified transactions. Transfers use their outgoing posting
        month, even if the deposit posts later. Hidden accounts can appear along
        transfer paths.
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {!data && !error && <p role="status">Loading money flow…</p>}
      {data && !nodes.length && (
        <p>
          No confirmed flows in this month. Review income and bills, or choose
          another month.
        </p>
      )}
      {data && nodes.length > 0 && (
        <>
          <div
            className="flow-scroll"
            tabIndex={0}
            role="region"
            aria-label="Sankey money flow, horizontally scrollable. Full values available in the flow list below."
          >
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
                <text
                  x={15 + i * 330}
                  y={22}
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
                  <rect
                    x={n.x}
                    y={n.y}
                    width={12}
                    height={n.h}
                    fill="#34343c"
                  />
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
          </div>
          <section className="panel">
            <h2>Flow details</h2>
            <p>Select a connection for its full account names and amount.</p>
            {selected && (
              <p role="status">
                {selected.kind}:{" "}
                {nodes.find((n: any) => n.id === selected.source)?.name} →{" "}
                {nodes.find((n: any) => n.id === selected.target)?.name} ·{" "}
                {money(selected.amount)}
              </p>
            )}
            <ul className="flow-list">
              {data.links.map((e: any, i: number) => (
                <li key={i}>
                  <button className="secondary" onClick={() => setSelected(e)}>
                    {e.kind}: {nodes.find((n: any) => n.id === e.source)?.name}{" "}
                    → {nodes.find((n: any) => n.id === e.target)?.name} ·{" "}
                    {money(e.amount)}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </>
  );
}
