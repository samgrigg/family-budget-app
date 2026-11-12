import { useEffect, useRef, useState } from "react";
import {
  createRequestGate,
  loadAccountView,
  appendAccountPage,
  accountAmount,
} from "./accountRequests";
import AccountBalance from "./AccountBalance";
import DataIssues from "./DataIssues";
export default function Accounts({ api, route, revision }: any) {
  const id = route.startsWith("#accounts/")
    ? decodeURIComponent(route.slice(10))
    : "";
  const [view, setView] = useState<any>(null);
  const [error, setError] = useState("");
  const [loadingMore, setLoadingMore] = useState(false);
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
        Saved balances from your institutions. These are cached values, not live
        balances.
      </p>
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
          {index.institutions.map((institution: any) => {
            const accounts = index.accounts.filter(
              (a: any) => a.institutionId === institution.id,
            );
            if (!accounts.length) return null;
            return (
              <section
                className="account-institution"
                key={institution.id}
                aria-labelledby={`institution-${institution.id}`}
              >
                <h2 id={`institution-${institution.id}`}>
                  {institution.provisional
                    ? `Institution not yet identified (${institution.name})`
                    : institution.name}
                </h2>
                <ul className="institution-index balance-index">
                  {accounts.map((a: any) => (
                    <li key={a.id}>
                      <a href={`#accounts/${encodeURIComponent(a.id)}`}>
                        <div className="account-identity">
                          <strong>
                            {a.name}
                            {a.mask ? ` · ••${a.mask}` : ""}
                          </strong>
                          <span>{a.subtype || a.type || "Type unknown"}</span>
                          {!a.included && <span>Excluded from budgeting</span>}
                          {a.stale && (
                            <span>
                              Access unavailable or account no longer shared
                            </span>
                          )}
                        </div>
                        <AccountBalance account={a} />
                      </a>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
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
          <h2>Transaction history</h2>
          <p>
            Stored source records, including matched copies. Pending
            transactions may change.
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
          <a
            className="back-link"
            href={`#admin/accounts/${encodeURIComponent(id)}`}
          >
            Manage this account in Admin
          </a>
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
