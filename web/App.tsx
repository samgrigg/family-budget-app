import Accounts from "./Accounts";
import MoneyFlow from "./MoneyFlow";
import BillsOverview from "./BillsOverview";
import Transfers from "./Transfers";
import Bills from "./Bills";
import { useEffect, useRef, useState } from "react";
declare global {
  interface Window {
    Plaid: any;
  }
}
export default function App() {
  const [state, setState] = useState<any>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [accountFilter, setAccountFilter] = useState("");
  const [route, setRoute] = useState(location.hash);
  const page =
    route.startsWith("#accounts") ||
    route.startsWith("#data-access") ||
    route.startsWith("#institutions")
      ? "accounts"
      : route === "#money-flow"
        ? "money-flow"
        : route === "#income-overview"
          ? "income-overview"
          : route === "#bills-overview"
            ? "bills-overview"
            : "budget";
  useEffect(() => {
    const navigate = () => {
      setRoute(location.hash);
      requestAnimationFrame(() => {
        document.querySelector<HTMLElement>("h1")?.focus();
        window.scrollTo(0, 0);
      });
    };
    window.addEventListener("hashchange", navigate);
    return () => window.removeEventListener("hashchange", navigate);
  }, []);
  useEffect(() => {
    document.title = `${page === "accounts" ? "Accounts" : page === "money-flow" ? "Money Flow" : page === "income-overview" ? "Income Overview" : page === "bills-overview" ? "Bills Overview" : "Budget"} · Family Budget`;
  }, [page]);
  const csrf = useRef("");
  const handler = useRef<any>(null);
  const polling = useRef(false);
  async function api(path: string, body?: any) {
    const r = await fetch(`/api${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": csrf.current,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const data = await r.json();
    if (data.csrf) csrf.current = data.csrf;
    if (data.connections) setState(data);
    if (!r.ok) throw Error(data.error || "Request failed");
    return data;
  }
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function loadLink() {
    if (window.Plaid) return;
    await new Promise<void>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://cdn.plaid.com/link/v2/stable/link-initialize.js";
      script.onload = () => resolve();
      script.onerror = () =>
        reject(Error("Could not load Plaid Link. Check your connection."));
      document.head.append(script);
    });
  }
  async function openLink(token: string, resume = false) {
    await loadLink();
    handler.current?.destroy();
    handler.current = window.Plaid.create({
      token,
      ...(resume ? { receivedRedirectUri: window.location.href } : {}),
      onSuccess: (public_token: string) => {
        sessionStorage.removeItem("plaid_link_token");
        history.replaceState({}, "", "/");
        void run(async () => {
          await api("/connect", { public_token });
        });
      },
      onExit: (e: any) => {
        sessionStorage.removeItem("plaid_link_token");
        history.replaceState({}, "", "/");
        if (e) setError("Connection was not completed. Please try again.");
      },
    });
    handler.current.open();
  }
  useEffect(() => {
    void run(async () => {
      await api("/state");
      if (new URLSearchParams(location.search).has("oauth_state_id")) {
        const token = sessionStorage.getItem("plaid_link_token");
        if (!token)
          throw Error("Authorization session expired. Connect again.");
        await openLink(token, true);
      }
    });
    return () => handler.current?.destroy();
  }, []);
  useEffect(() => {
    if (!state || busy || polling.current) return;
    const waiting = state.connections.filter((c: any) =>
      ["waiting", "history_pending"].includes(c.status),
    );
    if (!waiting.length) return;
    polling.current = true;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    let attempts = 0;
    const tick = async () => {
      try {
        for (const c of waiting) {
          if (cancelled) return;
          await api(`/connections/${encodeURIComponent(c.id)}/sync`, {});
        }
      } catch (e: any) {
        if (!cancelled) setError(e.message);
        return;
      }
      if (!cancelled && ++attempts < 6) timer = setTimeout(tick, 5000);
    };
    timer = setTimeout(tick, 3000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      polling.current = false;
    };
  }, [
    state?.connections.map((c: any) => `${c.id}:${c.status}`).join(","),
    busy,
  ]);
  const accountKey = (a: any) => a.canonicalAccountId;
  const visibleAccounts = [
    ...new Map<string, any>(
      (state?.accounts ?? [])
        .filter((a: any) => !a.hidden)
        .map((a: any) => [a.canonicalAccountId, a]),
    ).values(),
  ];
  const selectedAccount = visibleAccounts.some(
    (a: any) => accountKey(a) === accountFilter,
  )
    ? accountFilter
    : "";
  const transactions = (state?.transactions ?? []).filter(
    (t: any) => !selectedAccount || t.canonicalAccountId === selectedAccount,
  );
  return (
    <main>
      <a
        className="skip-link"
        href="#main-content"
        onClick={(e) => {
          e.preventDefault();
          document.querySelector<HTMLElement>("h1")?.focus();
        }}
      >
        Skip to content
      </a>
      <header>
        <a className="brand" href="/">
          <span>Family Budget</span>
        </a>
      </header>
      <nav className="page-nav" aria-label="Main navigation">
        <a href="#budget" aria-current={page === "budget" ? "page" : undefined}>
          Budget
        </a>
        <a
          href="#accounts"
          aria-current={page === "accounts" ? "page" : undefined}
        >
          Accounts
        </a>
        <a
          href="#bills-overview"
          aria-current={page === "bills-overview" ? "page" : undefined}
        >
          Bills Overview
        </a>
        <a
          href="#income-overview"
          aria-current={page === "income-overview" ? "page" : undefined}
        >
          Income Overview
        </a>
        <a
          href="#money-flow"
          aria-current={page === "money-flow" ? "page" : undefined}
        >
          Money Flow
        </a>
      </nav>
      {page === "money-flow" && <MoneyFlow api={api} />}
      {page === "income-overview" && (
        <BillsOverview
          key="income"
          income
          api={api}
          revision={JSON.stringify([
            state?.connections,
            state?.accounts,
            state?.transfers,
          ])}
        />
      )}
      {page === "bills-overview" && (
        <BillsOverview
          key="bills"
          api={api}
          revision={JSON.stringify([state?.connections, state?.accounts])}
        />
      )}
      {page === "budget" && error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {page === "accounts" && (
        <Accounts
          key={route}
          revision={JSON.stringify([state?.connections, state?.accounts])}
          api={api}
          route={route}
          onRefresh={() => api("/state")}
          addSource={() =>
            run(async () => {
              const { link_token } = await api("/link-token", {});
              sessionStorage.setItem("plaid_link_token", link_token);
              await openLink(link_token);
            })
          }
          configured={state?.configured}
          busy={busy}
          externalError={error}
        />
      )}
      {page === "budget" && (
        <>
          <h1 tabIndex={-1} id="main-content">
            Budget
          </h1>
          <p className="page-intro">
            Review your activity and keep your bills in order.
          </p>
          <div className="quick-actions" aria-label="Budget shortcuts">
            <a href="#bills-overview">See monthly bills</a>
            {[
              ["Internal transfers", "Review transfers"],
              ["Bills", "Review bills"],
              ["Recent transactions", "See transactions"],
            ].map(([label, text]) => (
              <button
                type="button"
                className="secondary"
                key={label}
                onClick={() => {
                  const target = document.querySelector<HTMLElement>(
                    `[aria-label="${label}"]`,
                  );
                  target?.scrollIntoView({ block: "start" });
                  target?.focus();
                }}
              >
                {text}
              </button>
            ))}
          </div>
          {!state && <p role="status">Loading…</p>}
          {state && !state.connections.length && (
            <p>
              <a href="#accounts">Add an institution</a> to get started.
            </p>
          )}
          {state && (
            <section className="panel">
              <label>
                Filter bills and transactions by account
                <select
                  value={selectedAccount}
                  onChange={(e) => setAccountFilter(e.target.value)}
                >
                  <option value="">All visible accounts</option>
                  {visibleAccounts.map((a: any, i: number) => (
                    <option key={accountKey(a)} value={accountKey(a)}>
                      {a.name}
                      {a.mask ? ` ••${a.mask}` : ""} ·{" "}
                      {state.connections.find((c: any) => c.id === a.connection)
                        ?.display_name || "Institution"}
                    </option>
                  ))}
                </select>
              </label>
            </section>
          )}
          {state?.transfers && (
            <Transfers
              data={state.transfers}
              accounts={state.accounts}
              api={api}
              onError={setError}
            />
          )}
          {state && (
            <Bills
              api={api}
              accountFilter={selectedAccount}
              revision={JSON.stringify([
                state.connections,
                state.accounts,
                state.transfers,
              ])}
            />
          )}
          <section className="panel">
            <div className="panel-heading">
              <div>
                <h2>Transactions</h2>
              </div>
              <span className="count">{transactions.length} transactions</span>
            </div>
            {!transactions.length ? (
              <div className="empty">
                <h3>No transactions to show</h3>
                <p>
                  Add an institution, show a hidden account, or choose another
                  account. The first import may take a few minutes.
                </p>
              </div>
            ) : (
              <div className="table-wrap">
                <table
                  aria-label="Recent transactions"
                  tabIndex={-1}
                  role="table"
                >
                  <thead role="rowgroup">
                    <tr role="row">
                      <th scope="col" role="columnheader">
                        Date
                      </th>
                      <th scope="col" role="columnheader">
                        Activity
                      </th>
                      <th scope="col" role="columnheader">
                        Account
                      </th>
                      <th scope="col" role="columnheader" className="amount">
                        Amount
                      </th>
                    </tr>
                  </thead>
                  <tbody role="rowgroup">
                    {transactions.map((t: any) => (
                      <tr role="row" key={`${t.connection}:${t.id}`}>
                        <td role="cell" className="transaction-date">
                          {t.date}
                        </td>
                        <td role="cell" className="transaction-description">
                          <strong>{t.name}</strong>
                          {t.internal_transfer && (
                            <small>Internal transfer</small>
                          )}
                          {!!t.pending && <small>Pending</small>}
                        </td>
                        <td role="cell" className="transaction-account">
                          {t.account || "Account"}
                          {t.mask ? ` ••${t.mask}` : ""}
                        </td>
                        <td
                          role="cell"
                          className={
                            "amount " + (Number(t.amount) < 0 ? "credit" : "")
                          }
                        >
                          {t.currency === "USD"
                            ? "$"
                            : t.currency
                              ? `${t.currency} `
                              : ""}
                          {t.amount}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="fine">
              Amounts follow Plaid’s convention: positive = money out; negative
              = money in. Showing stored transactions.
            </p>
          </section>
        </>
      )}
      <footer>
        Stored locally.
        <span>v0.2</span>
      </footer>
    </main>
  );
}
