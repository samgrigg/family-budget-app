import DataIssues from "./DataIssues";
import { loadHiddenAccounts, saveHiddenAccounts } from "./accountPreferences";
import { summarizeFlow } from "./flowSummary";
import Sankey from "./Sankey";
import { filteredSankey, flowNetwork } from "./flowNetwork";
import { useEffect, useRef, useState } from "react";
export default function MoneyFlow({ api }: any) {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7)),
    [currency, setCurrency] = useState("USD"),
    [data, setData] = useState<any>(null),
    [error, setError] = useState(""),
    [selected, setSelected] = useState<any>(null);
  const [view, setView] = useState("sankey");
  const chart = useRef<HTMLDivElement>(null);
  const [fullscreen, setFullscreen] = useState(false),
    [expanded, setExpanded] = useState(false);
  const settings = useRef<HTMLDialogElement>(null);
  const [hidden, setHidden] = useState<string[]>([]);
  const [preferenceEnvironment, setPreferenceEnvironment] = useState<
    string | null
  >(null);
  useEffect(() => {
    let cancelled = false;
    api("/accounts")
      .then((d: any) => {
        if (cancelled) return;
        try {
          setHidden(
            loadHiddenAccounts(
              localStorage,
              d.environment,
              d.aliases,
              d.account_redirects,
            ),
          );
          setPreferenceEnvironment(d.environment);
        } catch {
          setError("Chart preferences could not be loaded.");
        }
      })
      .catch((e: any) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  const [focusNode, setFocusNode] = useState<string | null>(null);
  const changeHidden = (next: string[]) => {
    setHidden(next);
    setSelected(null);
    setFocusNode(null);
    try {
      if (preferenceEnvironment)
        saveHiddenAccounts(localStorage, preferenceEnvironment, next);
    } catch {}
  };
  useEffect(() => {
    const changed = () =>
      setFullscreen(document.fullscreenElement === chart.current);
    document.addEventListener("fullscreenchange", changed);
    return () => document.removeEventListener("fullscreenchange", changed);
  }, []);
  async function toggleFullscreen() {
    if (document.fullscreenElement === chart.current) {
      await document.exitFullscreen();
      return;
    }
    if (expanded) {
      setExpanded(false);
      return;
    }
    try {
      if (!chart.current?.requestFullscreen) {
        setExpanded(true);
        return;
      }
      await chart.current.requestFullscreen();
    } catch {
      setExpanded(true);
    }
  }
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
  const network = data
    ? flowNetwork(data, hidden)
    : { accounts: [], nodes: [], links: [] };
  const [detailLevel, setDetailLevel] = useState("summary");
  const sankey = data ? filteredSankey(data, hidden) : { nodes: [], links: [] };
  const detailGraph = view === "sankey" ? sankey : network;
  const nodes = network.nodes.map((n: any) => ({ ...n }));
  const height = Math.max(
    600,
    ...["Income", "Account", "Bill"].map(
      (kind) => nodes.filter((n: any) => n.kind === kind).length * 100 + 100,
    ),
  );
  for (const kind of ["Income", "Account", "Bill"]) {
    const group = nodes.filter((n: any) => n.kind === kind);
    group.forEach((n: any, i: number) => {
      n.x =
        kind === "Income" ? 130 : kind === "Bill" ? 1070 : 550 + (i % 2) * 90;
      n.y = 80 + (i * (height - 140)) / Math.max(group.length - 1, 1);
    });
  }
  const maxAmount = Math.max(1, ...network.links.map((e: any) => e.amount));
  const colors: any = {
    Income: "var(--flow-income)",
    Bill: "var(--flow-bill)",
    Spending: "var(--flow-spending)",
    "Other inflow": "var(--flow-other)",
    "Debt payment": "var(--flow-debt)",
    "Debt payoff": "var(--flow-debt)",
    "Internal transfer": "var(--flow-transfer)",
  };
  const paths = network.links.map((e: any) => {
    const a = nodes.find((n: any) => n.id === e.source),
      b = nodes.find((n: any) => n.id === e.target);
    const dx = b.x - a.x,
      dy = b.y - a.y,
      len = Math.hypot(dx, dy) || 1;
    const sx = a.x + (dx / len) * 23,
      sy = a.y + (dy / len) * 23,
      tx = b.x - (dx / len) * 29,
      ty = b.y - (dy / len) * 29;
    const path =
      e.kind === "Internal transfer"
        ? `M${sx},${sy} Q${Math.max(a.x, b.x) + (dy > 0 ? 170 : -170)},${(sy + ty) / 2} ${tx},${ty}`
        : `M${sx},${sy} C${sx + 140},${sy} ${tx - 140},${ty} ${tx},${ty}`;
    return { ...e, path, w: 1 + (e.amount / maxAmount) * 18 };
  });
  return (
    <>
      <h1 tabIndex={-1} id="main-content">
        Money Flow
      </h1>
      <p>
        Switch between Sankey and Network views. In Network, each account
        appears once. Arrows show direction; thicker edges represent larger
        amounts. Select an account to highlight its connections.
      </p>
      <DataIssues issues={data?.dataIssues} />
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
        All posted transactions across onboarded accounts for the selected
        month. This shows aggregate movement, not a trace of individual dollars
        or account balances. Matched movements appear when either leg posts in
        the selected month; the other leg may post in an adjacent month. Pending
        entries are excluded. Settings hide accounts in this chart only.
        Explicitly linked credit card repayments are movements rather than new
        spending. If only the bank debit is available, the selected card route
        is modeled; an unlinked card destination is labeled separately with
        purchase history unavailable. Debt payoff is shown separately as a whole
        payment toward an existing balance.
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {!data && !error && <p role="status">Loading money flow…</p>}
      {data && !nodes.length && (
        <p>
          No posted flows in this month. Show accounts in Settings, or choose
          another month.
        </p>
      )}
      {data && (
        <>
          <div
            ref={chart}
            className={`flow-chart${expanded ? " flow-expanded" : ""}`}
          >
            <div className="flow-toolbar">
              <strong>Money Flow · {month}</strong>
              <div className="actions" aria-label="Diagram view">
                {[
                  ["sankey", "Sankey"],
                  ["network", "Network"],
                ].map(([v, label]) => (
                  <button
                    key={v}
                    type="button"
                    className={view === v ? "" : "secondary"}
                    aria-pressed={view === v}
                    onClick={() => {
                      setView(v);
                      setSelected(null);
                      setFocusNode(null);
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="secondary"
                onClick={() => settings.current?.showModal()}
              >
                Settings
              </button>
              <button
                type="button"
                className="secondary"
                aria-pressed={fullscreen || expanded}
                onClick={() => void toggleFullscreen()}
              >
                {fullscreen
                  ? "Exit full screen"
                  : expanded
                    ? "Exit expanded view"
                    : "Full screen"}
              </button>
            </div>
            {view === "sankey" && (
              <div className="flow-toolbar">
                <div className="actions" aria-label="Sankey detail level">
                  {[
                    ["summary", "Household summary"],
                    ["accounts", "Account routing"],
                  ].map(([value, label]) => (
                    <button
                      type="button"
                      key={value}
                      className={detailLevel === value ? "" : "secondary"}
                      aria-pressed={detailLevel === value}
                      onClick={() => setDetailLevel(value)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {expanded && (
              <p role="status">
                Browser fullscreen is unavailable. The diagram is expanded
                below.
              </p>
            )}
            <dialog
              ref={settings}
              className="flow-settings"
              aria-labelledby="flow-settings-title"
            >
              <h2 id="flow-settings-title">Visible accounts</h2>
              <p>
                Choose accounts to show. Sankey keeps movements across
                hidden-account boundaries labeled. Budgeting visibility is
                unchanged.
              </p>
              <div className="actions">
                <button
                  type="button"
                  className="secondary"
                  disabled={!preferenceEnvironment}
                  onClick={() => changeHidden([])}
                >
                  Show all
                </button>
                <button
                  type="button"
                  className="secondary"
                  disabled={!preferenceEnvironment}
                  onClick={() =>
                    changeHidden(network.accounts.map((a) => a.id))
                  }
                >
                  Hide all
                </button>
              </div>
              {network.accounts.length === 0 && <p>No onboarded accounts.</p>}
              {network.accounts.map((a) => (
                <label className="flow-setting-account" key={a.id}>
                  <input
                    type="checkbox"
                    disabled={!preferenceEnvironment}
                    checked={!hidden.includes(a.id)}
                    onChange={(e) =>
                      changeHidden(
                        e.target.checked
                          ? hidden.filter((id) => id !== a.id)
                          : [...hidden, a.id],
                      )
                    }
                  />
                  <span>{a.name}</span>
                </label>
              ))}
              <form method="dialog">
                <button autoFocus>Done</button>
              </form>
            </dialog>
            {focusNode && (
              <div className="flow-toolbar">
                <span>{nodes.find((n: any) => n.id === focusNode)?.name}</span>
                <button
                  className="secondary"
                  onClick={() => setFocusNode(null)}
                >
                  Clear highlight
                </button>
              </div>
            )}
            {!nodes.length && (
              <p>
                No visible flows. Use Settings to show accounts, or choose
                another month.
              </p>
            )}
            <div
              className="flow-scroll"
              tabIndex={0}
              role="region"
              aria-label={`${view === "sankey" ? "Sankey diagram" : "Directed network"}, horizontally scrollable. Full values in the list below.`}
            >
              {view === "sankey" ? (
                <Sankey
                  key={detailLevel}
                  data={
                    detailLevel === "summary" ? summarizeFlow(sankey) : sankey
                  }
                  month={month}
                  money={money}
                />
              ) : (
                <svg
                  viewBox={`0 0 1200 ${height}`}
                  style={{ minWidth: 1000 }}
                  role="group"
                  aria-label={`Money flow network for ${month}`}
                >
                  <defs>
                    {Object.entries(colors).map(([kind, color]) => (
                      <marker
                        id={`arrow-${kind.replaceAll(" ", "-")}`}
                        key={kind}
                        viewBox="0 0 10 10"
                        refX="9"
                        refY="5"
                        markerWidth="8"
                        markerHeight="8"
                        orient="auto"
                        markerUnits="userSpaceOnUse"
                      >
                        <path
                          d="M 0 0 L 10 5 L 0 10 z"
                          fill={color as string}
                        />
                      </marker>
                    ))}
                  </defs>
                  {paths.map((p: any, i: number) => (
                    <g
                      key={i}
                      opacity={
                        !focusNode ||
                        p.source === focusNode ||
                        p.target === focusNode
                          ? 1
                          : 0.12
                      }
                    >
                      <path
                        d={p.path}
                        fill="none"
                        stroke={colors[p.kind]}
                        strokeWidth={p.w}
                        strokeOpacity={0.65}
                        markerEnd={`url(#arrow-${p.kind.replaceAll(" ", "-")})`}
                      >
                        <title>
                          {p.kind}: {money(p.amount)}
                        </title>
                      </path>
                    </g>
                  ))}
                  {nodes.map((n: any) => (
                    <g
                      key={n.id}
                      role="button"
                      tabIndex={0}
                      aria-label={`${n.kind}: ${n.name}. Highlight connections`}
                      aria-pressed={focusNode === n.id}
                      onClick={() =>
                        setFocusNode(focusNode === n.id ? null : n.id)
                      }
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setFocusNode(focusNode === n.id ? null : n.id);
                        }
                      }}
                      className="network-node"
                    >
                      <circle
                        cx={n.x}
                        cy={n.y}
                        r={24}
                        fill={
                          focusNode === n.id ? "var(--primary)" : "var(--card)"
                        }
                        stroke="var(--input)"
                        strokeWidth={2}
                      />
                      <text
                        x={n.x}
                        y={n.y + 5}
                        textAnchor="middle"
                        fontSize="13"
                        fill={
                          focusNode === n.id
                            ? "var(--primary-foreground)"
                            : "var(--foreground)"
                        }
                      >
                        {n.kind === "Account"
                          ? "A"
                          : n.kind === "Income"
                            ? "I"
                            : "B"}
                      </text>
                      <text
                        x={n.x}
                        y={n.y + 44}
                        textAnchor="middle"
                        fontSize="13"
                      >
                        <title>{n.name}</title>
                        {n.name.length > 30
                          ? n.name.slice(0, 29) + "…"
                          : n.name}
                      </text>
                    </g>
                  ))}
                </svg>
              )}
            </div>
          </div>
          <section className="panel">
            <details>
              <summary>
                Detailed flows · {detailGraph.links.length} connections
              </summary>
              <h2>Flow details</h2>
              <p>Select a connection for its full account names and amount.</p>
              {selected && (
                <p role="status">
                  {selected.kind}:{" "}
                  {
                    detailGraph.nodes.find((n: any) => n.id === selected.source)
                      ?.name
                  }{" "}
                  →{" "}
                  {
                    detailGraph.nodes.find((n: any) => n.id === selected.target)
                      ?.name
                  }{" "}
                  · {money(selected.amount)}
                </p>
              )}
              {view === "sankey" && (
                <p>
                  Accounts appear in two stages in Sankey view. Other funding
                  and unallocated bands are inferred balancing amounts, not
                  verified transactions or account balances. Hiding accounts
                  removes their connected flows; the filtered diagram may not
                  balance.
                </p>
              )}
              <ul className="flow-list">
                {detailGraph.links.map((e: any, i: number) => (
                  <li key={i}>
                    <button
                      className="secondary"
                      onClick={() => setSelected(e)}
                    >
                      {e.kind}:{" "}
                      {
                        detailGraph.nodes.find((n: any) => n.id === e.source)
                          ?.name
                      }{" "}
                      →{" "}
                      {
                        detailGraph.nodes.find((n: any) => n.id === e.target)
                          ?.name
                      }{" "}
                      · {money(e.amount)}
                    </button>
                  </li>
                ))}
              </ul>
            </details>
          </section>
        </>
      )}
    </>
  );
}
