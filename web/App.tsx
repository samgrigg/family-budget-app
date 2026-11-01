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
  return (
    <main>
      <header>
        <a className="brand" href="/">
          <span>Family Budget</span>
        </a>
        <span className="tag">POC</span>
      </header>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h1>Accounts</h1>
          </div>
          <span
            className={
              "badge " + (state?.environment === "production" ? "live" : "")
            }
          >
            {state?.environment === "production" ? "Live" : "Sandbox"}
          </span>
        </div>
        <p>Connect an institution to import account activity.</p>
        {!state ? (
          <p role="status">Loading connection status…</p>
        ) : !state.configured ? (
          <div className="notice">
            Add your Plaid credentials to the local .env file and restart the
            server. Setup instructions are in README.md.
          </div>
        ) : null}
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
          Connect account
        </button>
        <p className="fine">
          Connected through Plaid. Bank passwords aren’t stored here.
        </p>
        {error && (
          <div className="error" role="alert">
            {error}
          </div>
        )}
        {busy && <p role="status">Working on your connection…</p>}
        {state?.connections.map((c: any) => (
          <div className="connection" key={c.id}>
            <div>
              <strong>Connected account group</strong>
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
                      "Revoke this Plaid connection and delete its local accounts and transactions?",
                    )
                  )
                    void run(async () => {
                      await api(
                        `/connections/${encodeURIComponent(c.id)}/disconnect`,
                        {},
                      );
                    });
                }}
              >
                Disconnect & delete
              </button>
            </div>
          </div>
        ))}
      </section>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Transactions</h2>
          </div>
          <span className="count">
            {state?.transactions.length ?? 0} transactions
          </span>
        </div>
        {!state?.transactions.length ? (
          <div className="empty">
            <h3>No transactions yet</h3>
            <p>
              Connect an account to get started. The first import may take a few
              minutes.
            </p>
          </div>
        ) : (
          <div className="table-wrap">
            <table aria-label="Recent transactions" role="table">
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
                {state.transactions.map((t: any) => (
                  <tr role="row" key={`${t.connection}:${t.id}`}>
                    <td role="cell" className="transaction-date">
                      {t.date}
                    </td>
                    <td role="cell" className="transaction-description">
                      <strong>{t.name}</strong>
                      {!!t.pending && <small>Pending</small>}
                    </td>
                    <td role="cell" className="transaction-account">
                      {t.account || "Account"}
                    </td>
                    <td
                      role="cell"
                      className={
                        "amount " + (Number(t.amount) < 0 ? "credit" : "")
                      }
                    >
                      {t.currency ? `${t.currency} ` : ""}
                      {t.amount}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="fine">
          Amounts follow Plaid’s convention: positive = money out; negative =
          money in. Showing up to 2,000 stored transactions.
        </p>
      </section>
      <footer>
        Stored locally.
        <span>v0.1</span>
      </footer>
    </main>
  );
}
