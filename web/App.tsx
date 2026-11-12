import PaycheckReview from "./PaycheckReview";
import BudgetTabs, { type BudgetTab } from "./BudgetTabs";
import BillPlan from "./BillPlan";
import {
  saveLinkAction,
  readLinkAction,
  cancelLinkAction,
  completeLinkAction,
  type LinkAction,
} from "./linkSession";
import DataIssues from "./DataIssues";
import Accounts from "./Accounts";
import Admin from "./Admin";
import { accountAmount } from "./accountRequests";
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
  const [linkAction, setLinkAction] = useState<LinkAction | null>(null);
  const [linkNotice, setLinkNotice] = useState("");
  const [accountRevision, setAccountRevision] = useState(0);
  const [budgetTab, setBudgetTab] = useState<BudgetTab>("commitments");
  const [accountFilter, setAccountFilter] = useState("");
  const [route, setRoute] = useState(location.hash);
  const page =
    route === "" || route === "#paycheck-review"
      ? "paycheck-review"
      : route.startsWith("#admin") ||
          route.startsWith("#data-access") ||
          route.startsWith("#institutions")
        ? "admin"
        : route.startsWith("#accounts")
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
    document.title = `${page === "paycheck-review" ? "Paycheck Review" : page === "admin" ? "Admin" : page === "accounts" ? "Accounts" : page === "money-flow" ? "Money Flow" : page === "income-overview" ? "Income Overview" : page === "bills-overview" ? "Bills Overview" : "Budget"} · Family Budget`;
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
    if (data.connections) {
      setState(data);
      setAccountRevision((revision) => revision + 1);
    }
    if (!r.ok)
      throw Object.assign(Error(data.error || "Request failed"), {
        duplicatePlans: data.duplicatePlans,
      });
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
  function returnToDataAccess() {
    history.replaceState({}, "", "/#data-access");
    setRoute("#data-access");
  }
  async function finishAuthorization(action: LinkAction, publicToken = "") {
    try {
      await completeLinkAction(sessionStorage, action, publicToken, api);
      setLinkAction(null);
      setLinkNotice(
        action.mode === "new"
          ? "Data source added. History import may still be in progress."
          : action.mode === "replacement"
            ? "Replacement connected. Continue import and account review in Data access."
            : "Authorization checked. Saved history was retained; available updates were imported.",
      );
    } finally {
      setLinkAction(readLinkAction(sessionStorage, action.environment));
      // Refresh even on failure so a renewed-authorization status is actionable.
      await api("/state");
    }
  }
  async function openLink(action: LinkAction, resume = false) {
    await loadLink();
    handler.current?.destroy();
    let completed = false;
    handler.current = window.Plaid.create({
      token: action.linkToken,
      ...(resume ? { receivedRedirectUri: window.location.href } : {}),
      onSuccess: (public_token: string) => {
        completed = true;
        returnToDataAccess();
        void run(() => finishAuthorization(action, public_token));
      },
      onExit: (e: any) => {
        if (completed) return;
        cancelLinkAction(sessionStorage);
        setLinkAction(null);
        returnToDataAccess();
        setLinkNotice(
          "Authorization was not completed. Saved history remains available. You can start the action again; any changes made at your bank may still apply.",
        );
        if (action.mode === "replacement")
          void run(async () => {
            await api(
              `/source-replacements/${encodeURIComponent(action.operationId!)}/cancel`,
              {},
            );
            await api("/state");
          });
        if (e)
          setError(
            "Authorization was not completed. Resume the action in Manage data access.",
          );
      },
    });
    handler.current.open();
  }
  async function continueAuthorization() {
    if (!linkAction) return;
    if (linkAction.phase === "verify") return finishAuthorization(linkAction);
    let current: LinkAction | null;
    try {
      current = readLinkAction(sessionStorage, linkAction.environment);
    } finally {
      if (!sessionStorage.getItem("budget_plaid_action")) setLinkAction(null);
    }
    if (current) await openLink(current);
  }
  async function startLink(
    mode: LinkAction["mode"],
    sourceId?: string,
    operationId?: string,
  ) {
    if (linkAction)
      throw Error("Finish or cancel the current authorization action first.");
    setLinkNotice("");
    const { link_token } = await api(
      mode === "new"
        ? "/link-token"
        : mode === "replacement"
          ? `/source-replacements/${encodeURIComponent(operationId!)}/link-token`
          : `/data-sources/${encodeURIComponent(sourceId!)}/link-token`,
      mode === "new" ? {} : { action: mode },
    );
    const context = {
      environment: state.environment,
      phase: "link" as const,
      linkToken: link_token,
      expiresAt:
        Date.now() +
        (["new", "replacement"].includes(mode) ? 4 * 60 : 30) * 60 * 1000,
    };
    const action: LinkAction =
      mode === "new"
        ? { ...context, mode }
        : mode === "replacement"
          ? { ...context, mode, sourceId: sourceId!, operationId: operationId! }
          : { ...context, mode, sourceId: sourceId! };
    saveLinkAction(sessionStorage, action);
    setLinkAction(action);
    await openLink(action);
  }
  useEffect(() => {
    void run(async () => {
      const current = await api("/state");
      let action: LinkAction | null;
      try {
        action = readLinkAction(sessionStorage, current.environment);
      } catch (error) {
        returnToDataAccess();
        throw error;
      }
      setLinkAction(action);
      if (new URLSearchParams(location.search).has("oauth_state_id")) {
        if (!action || action.phase !== "link") {
          returnToDataAccess();
          throw Error(
            "Authorization session expired. Start the action again in Manage data access.",
          );
        }
        await openLink(action, true);
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
          <span className="brand-mark" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span>Family Budget</span>
        </a>
        <div className="header-utilities">
          <span className="app-caption">Household finances</span>
          <a
            className="admin-link"
            href="#admin"
            aria-current={page === "admin" ? "page" : undefined}
          >
            Admin
          </a>
        </div>
      </header>
      <nav className="page-nav" aria-label="Main navigation">
        <a
          href="#paycheck-review"
          aria-current={page === "paycheck-review" ? "page" : undefined}
        >
          Paycheck Review
        </a>
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
      {page === "paycheck-review" && (
        <PaycheckReview
          api={api}
          onCardConsent={(id) => startLink("card_data", id)}
        />
      )}
      {page === "budget" && <DataIssues issues={state?.dataIssues} />}
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
      {page !== "accounts" && error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {linkNotice && <p role="status">{linkNotice}</p>}
      {linkAction && (
        <section className="connection" aria-label="Authorization in progress">
          <p>
            {linkAction.phase === "verify"
              ? "Authorization returned. Verify and import available updates to finish."
              : "An authorization action is in progress. Continue it or cancel this local session."}
          </p>
          <div className="actions">
            <button
              disabled={busy}
              onClick={() => void run(continueAuthorization)}
            >
              {linkAction.phase === "verify"
                ? "Retry authorization check"
                : "Continue authorization"}
            </button>
            <button
              disabled={busy}
              onClick={() => {
                handler.current?.destroy();
                if (linkAction.mode === "replacement")
                  void run(async () => {
                    await api(
                      `/source-replacements/${encodeURIComponent(linkAction.operationId!)}/cancel`,
                      {},
                    );
                    await api("/state");
                  });
                cancelLinkAction(sessionStorage);
                setLinkAction(null);
                setLinkNotice(
                  "Local authorization session canceled. Saved history remains. Changes already made at your bank may still apply.",
                );
              }}
            >
              Cancel authorization session
            </button>
          </div>
        </section>
      )}
      {page === "accounts" && (
        <Accounts
          key={route}
          route={route}
          api={api}
          revision={accountRevision}
          busy={busy || !!linkAction}
          configured={state?.configured ?? false}
        />
      )}
      {page === "admin" && (
        <Admin
          key={route}
          revision={JSON.stringify([
            state?.connections,
            state?.accounts,
            accountRevision,
          ])}
          api={api}
          route={route}
          onRefresh={() => api("/state")}
          addSource={() => run(() => startLink("new"))}
          replaceSource={(sourceId: string, operationId: string) =>
            run(() => startLink("replacement", sourceId, operationId))
          }
          updateSource={(
            sourceId: string,
            action: "repair" | "select_accounts",
          ) => run(() => startLink(action, sourceId))}
          configured={state?.configured}
          busy={busy || !!linkAction}
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
          <BudgetTabs selected={budgetTab} onSelect={setBudgetTab} />
          <p>
            <a href="#bills-overview">See monthly bills</a>
          </p>
          {!state && <p role="status">Loading…</p>}
          {state && !state.connections.length && (
            <p>
              <a href="#admin/data-access">Add an institution</a> to get
              started.
            </p>
          )}
          {state && (
            <section
              className="panel"
              hidden={budgetTab !== "bills" && budgetTab !== "transactions"}
            >
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
          {state && (
            <BillPlan
              api={api}
              revision={JSON.stringify([state.connections, state.accounts])}
              activeTab={budgetTab}
            />
          )}
          <div
            id="budget-panel-transfers"
            role="tabpanel"
            aria-labelledby="budget-tab-transfers"
            tabIndex={0}
            hidden={budgetTab !== "transfers"}
          >
            {state?.transfers && (
              <Transfers
                data={state.transfers}
                accounts={state.accounts}
                api={api}
                onError={setError}
              />
            )}
          </div>
          <div
            id="budget-panel-bills"
            role="tabpanel"
            aria-labelledby="budget-tab-bills"
            tabIndex={0}
            hidden={budgetTab !== "bills"}
          >
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
          </div>
          <section
            className="panel"
            id="budget-panel-transactions"
            role="tabpanel"
            aria-labelledby="budget-tab-transactions"
            tabIndex={0}
            hidden={budgetTab !== "transactions"}
          >
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
                          {accountAmount(t.currency, t.amount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="fine">
              Positive = money in; negative = money out. Showing stored
              transactions.
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
