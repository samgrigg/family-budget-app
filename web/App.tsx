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
  const page = route.startsWith("#institutions")
    ? "institutions"
    : route === "#money-flow"
      ? "money-flow"
      : route === "#income-overview"
        ? "income-overview"
        : route === "#bills-overview"
          ? "bills-overview"
          : "budget";
  const institutionId = route.startsWith("#institutions/")
    ? route.slice("#institutions/".length)
    : "";
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
    document.title = `${page === "institutions" ? "Institutions" : page === "money-flow" ? "Money Flow" : page === "income-overview" ? "Income Overview" : page === "bills-overview" ? "Bills Overview" : "Budget"} · Family Budget`;
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
    const waiting = state.connections.filter(
      (c: any) => c.status !== "ready" && c.status !== "revoke_required",
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
  const accountKey = (a: any) => JSON.stringify([a.connection, a.id]);
  const visibleAccounts = (state?.accounts ?? []).filter((a: any) => !a.hidden);
  const selectedAccount = visibleAccounts.some(
    (a: any) => accountKey(a) === accountFilter,
  )
    ? accountFilter
    : "";
  const transactions = (state?.transactions ?? []).filter(
    (t: any) =>
      !selectedAccount ||
      JSON.stringify([t.connection, t.account_id]) === selectedAccount,
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
        <span className="tag">POC</span>
      </header>
      <nav className="page-nav" aria-label="Main navigation">
        <a href="#budget" aria-current={page === "budget" ? "page" : undefined}>
          Budget
        </a>
        <a
          href="#institutions"
          aria-current={page === "institutions" ? "page" : undefined}
        >
          Institutions
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
      {page === "institutions" && (
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h1 tabIndex={-1} id="main-content">
                {institutionId ? "Institution details" : "Institutions"}
              </h1>
            </div>
            <span
              className={
                "badge " + (state?.environment === "production" ? "live" : "")
              }
            >
              {state?.environment === "production" ? "Live" : "Sandbox"}
            </span>
          </div>
          {institutionId && (
            <a className="back-link" href="#institutions">
              ← All institutions
            </a>
          )}
          {!institutionId && (
            <p>Choose an institution to manage its connection and accounts.</p>
          )}
          {!state ? (
            <p role="status">Loading connection status…</p>
          ) : !state.configured ? (
            <div className="notice">
              Add your Plaid credentials to the local .env file and restart the
              server. Setup instructions are in README.md.
            </div>
          ) : null}
          {!institutionId && (
            <button
              disabled={busy || !state?.configured}
              onClick={() =>
                void run(async () => {
                  const { link_token } = await api("/link-token", {});
                  sessionStorage.setItem("plaid_link_token", link_token);
                  await openLink(link_token);
                })
              }
            >
              Add institution
            </button>
          )}
          <p className="fine">
            Connected through Plaid. Bank passwords aren’t stored here.
          </p>
          {error && (
            <div className="error" role="alert">
              {error}
            </div>
          )}
          {busy && <p role="status">Working on your connection…</p>}
          {!institutionId && state && (
            <ul className="institution-index">
              {state.connections.map((c: any, index: number) => (
                <li key={c.id}>
                  <a href={`#institutions/${encodeURIComponent(c.id)}`}>
                    <strong>
                      {c.display_name || `Institution ${index + 1}`}
                    </strong>
                    <span>
                      {
                        state.accounts.filter((a: any) => a.connection === c.id)
                          .length
                      }{" "}
                      accounts ·{" "}
                      {c.status === "ready"
                        ? "History imported"
                        : c.status === "revoke_required"
                          ? "Action required"
                          : "Import pending"}
                    </span>
                    {c.last_sync && (
                      <span>
                        Last checked {new Date(c.last_sync).toLocaleString()}
                      </span>
                    )}
                  </a>
                </li>
              ))}
            </ul>
          )}
          {!institutionId && state && !state.connections.length && (
            <p>No institutions yet. Add one to get started.</p>
          )}
          {institutionId &&
            state &&
            !state.connections.some(
              (c: any) => encodeURIComponent(c.id) === institutionId,
            ) && (
              <p>
                This institution is no longer available. Return to the
                institution list.
              </p>
            )}
          {institutionId && (
            <p className="fine">
              Hidden accounts keep syncing but are excluded from transactions
              and Bills. Show them again at any time.
            </p>
          )}
          {state?.connections.map((c: any, index: number) =>
            encodeURIComponent(c.id) === institutionId ? (
              <div className="connection" key={c.id}>
                <div>
                  <h2>{c.display_name || `Institution ${index + 1}`}</h2>
                  {c.label && c.institution_name && <p>{c.institution_name}</p>}
                  <p>
                    {c.status === "revoke_required"
                      ? "Not saved · retry Disconnect & delete before restarting"
                      : c.status === "ready"
                        ? "History imported"
                        : c.status === "history_pending"
                          ? "Recent activity imported · older history pending"
                          : "Waiting for institution data"}
                    {c.last_sync &&
                      ` · Last checked ${new Date(c.last_sync).toLocaleString()}`}
                  </p>
                </div>
                {c.status !== "revoke_required" && (
                  <form
                    className="institution-name"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const name = new FormData(e.currentTarget).get("name");
                      void run(async () => {
                        await api(
                          `/connections/${encodeURIComponent(c.id)}/name`,
                          { name },
                        );
                      });
                    }}
                  >
                    <label>
                      Display name
                      <input
                        key={c.display_name}
                        name="name"
                        defaultValue={c.display_name || ""}
                        required
                        maxLength={120}
                      />
                    </label>
                    <button className="secondary" disabled={busy}>
                      Save name
                    </button>
                  </form>
                )}
                <ul
                  className="account-list"
                  aria-label={`Accounts in connection ${index + 1}`}
                >
                  {(state.accounts ?? [])
                    .filter((a: any) => a.connection === c.id)
                    .map((a: any) => (
                      <li key={a.id}>
                        <div>
                          <strong>{a.name}</strong>
                          {a.mask && <span> · ••{a.mask}</span>}
                          {!!a.hidden && <p>Hidden</p>}
                        </div>
                        <button
                          className="secondary"
                          disabled={busy}
                          aria-label={`${a.hidden ? "Show" : "Hide"} ${a.name}${a.mask ? ` ending in ${a.mask}` : ""}`}
                          onClick={() =>
                            void run(async () => {
                              await api("/accounts/visibility", {
                                connection: c.id,
                                account: a.id,
                                hidden: !a.hidden,
                              });
                            })
                          }
                        >
                          {a.hidden ? "Show" : "Hide"}
                        </button>
                      </li>
                    ))}
                </ul>
                <div className="actions">
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await api(
                          `/connections/${encodeURIComponent(c.id)}/sync`,
                          {},
                        );
                      })
                    }
                  >
                    Sync
                  </button>
                  <button
                    className="secondary danger"
                    disabled={busy}
                    onClick={() => {
                      if (
                        confirm(
                          `Disconnect ${c.display_name || "this institution"} and delete its local accounts and transactions? This cannot be undone.`,
                        )
                      )
                        void run(async () => {
                          await api(
                            `/connections/${encodeURIComponent(c.id)}/disconnect`,
                            {},
                          );
                          location.hash = "institutions";
                        });
                    }}
                  >
                    Disconnect & delete
                  </button>
                </div>
              </div>
            ) : null,
          )}
        </section>
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
              <a href="#institutions">Add an institution</a> to get started.
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
              = money in. Showing up to 2,000 stored transactions.
            </p>
          </section>
        </>
      )}
      <footer>
        Stored locally.
        <span>v0.1</span>
      </footer>
    </main>
  );
}
