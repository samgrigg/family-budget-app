import { useEffect, useRef, useState } from "react";
import {
  createRequestGate,
  loadAccountView,
  appendAccountPage,
  accountAmount,
} from "./accountRequests";
import AccountBalance from "./AccountBalance";
import DataIssues from "./DataIssues";
import AccountRefresh from "./AccountRefresh";
import { accountGroups } from "./accountGroups";
export default function Accounts({
  api,
  route,
  revision,
  busy,
  configured,
}: any) {
  const id = route.startsWith("#accounts/")
    ? decodeURIComponent(route.slice(10))
    : "";
  const [view, setView] = useState<any>(null);
  const [error, setError] = useState("");
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const gate = useRef(createRequestGate());
  const load = () => {
    setError("");
    return loadAccountView(api, id, gate.current, setView, (e) =>
      setError(e.message),
    );
  };
  useEffect(() => () => gate.current.dispose(), []);
  useEffect(() => {
    void load();
  }, [revision]);
  const index = view?.index,
    detail = view?.detail;
  const account = index?.accounts.find((a: any) => a.id === id);
  return (
    <section className="panel accounts-page">
      <h1 tabIndex={-1} id="main-content">
        {id ? account?.name || "Account details" : "Accounts"}
      </h1>
      <p className="page-intro">
        {id
          ? "Balance and transaction history for this account."
          : "Your cash, credit cards and loans at a glance."}
      </p>
      {index && (
        <div className="accounts-toolbar">
          <AccountRefresh
            api={api}
            sources={index.sources
              .filter(
                (s: any) =>
                  !id || detail?.sources.some((d: any) => d.id === s.id),
              )
              .map((s: any) => ({
                ...s,
                displayName: index.institutions.find(
                  (i: any) => i.id === s.institution_id,
                )?.name,
              }))}
            disabled={busy || refreshing}
            configured={configured}
            onComplete={load}
            onBusyChange={setRefreshing}
          />
          <p>
            Refresh checks your connections for balances and transactions.
            Institutions may still return cached balances.
          </p>
        </div>
      )}
      {id && (
        <a className="back-link" href="#accounts">
          All accounts
        </a>
      )}
      {error && (
        <div role="alert" className="error">
          <p>{error}</p>
          <button onClick={() => void load()}>Retry loading</button>
        </div>
      )}
      {!view && !error && <p role="status">Loading accounts…</p>}
      {index && !id && (
        <>
          {!index.accounts.length && (
            <p>
              No accounts yet.{" "}
              <a className="back-link" href="#admin/data-access">
                Add a data source in Admin
              </a>
            </p>
          )}
          {accountGroups(index.accounts).map((group) => (
            <section
              className="account-group"
              key={group.id}
              aria-labelledby={`group-${group.id}`}
            >
              <div className="account-group-heading">
                <h2 id={`group-${group.id}`}>{group.name}</h2>
                <span>
                  {group.accounts.length}{" "}
                  {group.accounts.length === 1 ? "account" : "accounts"}
                </span>
              </div>
              <p>{group.description}</p>
              <ul className="accounts-balance-list">
                {group.accounts.map((a: any) => (
                  <li key={a.id}>
                    <div className="account-identity">
                      <a
                        className="account-history-link"
                        href={`#accounts/${encodeURIComponent(a.id)}`}
                      >
                        <strong>
                          {a.name}
                          {a.mask ? ` · ••${a.mask}` : ""}
                        </strong>
                        <span>View transactions →</span>
                      </a>
                      <span>
                        {index.institutions.find(
                          (i: any) => i.id === a.institutionId,
                        )?.name || "Institution not identified"}{" "}
                        · {a.subtype || a.type || "Type unknown"}
                      </span>
                      {a.stale && (
                        <span>
                          Connection needs attention ·{" "}
                          <a href="#admin">Manage connection</a>
                        </span>
                      )}
                    </div>
                    <AccountBalance account={a} compact />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </>
      )}
      {detail && account && (
        <>
          <p>
            {account.subtype || account.type || "Type unknown"}
            {account.mask ? ` · ••${account.mask}` : ""}
          </p>
          <div className="account-balance-detail">
            <AccountBalance account={account} />
          </div>
          <DataIssues issues={detail.dataIssues} />
          <a
            className="back-link"
            href={`#admin/accounts/${encodeURIComponent(id)}`}
          >
            Manage this account in Admin
          </a>
          <h2>Transaction history</h2>
          <p>
            Money in is positive (+); money out is negative (−). Pending
            transactions may change. Matched source copies remain visible.
          </p>
          <ul className="account-list">
            {detail.transactions.map((t: any) => (
              <li key={t.id}>
                <div>
                  <strong>{t.name}</strong>
                  <p>
                    {t.date}
                    {t.pending ? " · Pending" : ""} ·{" "}
                    {detail.sources.find((s: any) => s.id === t.sourceId)
                      ?.label || "Data source"}
                    {detail.dataIssues?.some((issue: any) =>
                      issue.transactionIds.includes(t.sourceTransactionId),
                    ) && " · Unresolved overlap; withheld from estimates"}
                  </p>
                </div>
                <span>{accountAmount(t.currency, t.amount)}</span>
              </li>
            ))}
          </ul>
          {!detail.transactions.length && <p>No stored transactions.</p>}
          {detail.nextCursor && (
            <button
              disabled={loadingMore}
              onClick={async () => {
                setLoadingMore(true);
                setError("");
                try {
                  await appendAccountPage(
                    api,
                    detail,
                    gate.current,
                    (next: any) =>
                      setView((v: any) => ({ ...v, detail: next })),
                  );
                } catch (e: any) {
                  if (gate.current.active()) setError(e.message);
                } finally {
                  if (gate.current.active()) setLoadingMore(false);
                }
              }}
            >
              {loadingMore ? "Loading…" : "Load more transactions"}
            </button>
          )}
        </>
      )}
      {index && id && !account && (
        <p>
          Account not found. <a href="#accounts">Back to accounts</a>
        </p>
      )}
    </section>
  );
}
