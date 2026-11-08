import { useEffect, useState } from "react";
export default function Accounts({
  api,
  route,
  onRefresh,
  addSource,
  configured,
  busy,
  externalError,
}: any) {
  const [index, setIndex] = useState<any>(null),
    [detail, setDetail] = useState<any>(null),
    [error, setError] = useState(""),
    [working, setWorking] = useState(false);
  const access =
    route.startsWith("#data-access") || route.startsWith("#institutions/");
  const id = route.startsWith("#accounts/")
    ? decodeURIComponent(route.slice(10))
    : "";
  async function load() {
    setError("");
    try {
      setIndex(await api("/accounts"));
      setDetail(id ? await api(`/accounts/${encodeURIComponent(id)}`) : null);
    } catch (e: any) {
      setError(e.message);
    }
  }
  useEffect(() => {
    setDetail(null);
    void load();
  }, [route]);
  async function run(fn: () => Promise<any>, refresh = true) {
    setWorking(true);
    setError("");
    try {
      await fn();
      if (refresh) {
        await onRefresh();
        await load();
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setWorking(false);
    }
  }
  const disabled = working || busy;
  function nameForm(label: string, value: string, path: string) {
    return (
      <form
        className="institution-name"
        onSubmit={(e) => {
          e.preventDefault();
          const name = new FormData(e.currentTarget).get("name");
          void run(() => api(path, { name }));
        }}
      >
        <label>
          {label}
          <input
            key={value}
            name="name"
            defaultValue={value}
            required
            maxLength={120}
          />
        </label>
        <button disabled={disabled}>Save name</button>
      </form>
    );
  }
  return (
    <section className="panel">
      <h1 tabIndex={-1} id="main-content">
        {access ? "Data access" : id ? "Account details" : "Accounts"}
      </h1>
      <p>
        <a href="#accounts">All accounts</a> ·{" "}
        <a href="#data-access">Manage data access</a>
      </p>
      {route.startsWith("#institutions") && (
        <p className="notice">
          Accounts are now grouped by institution. Connections are managed
          separately in Data access.
        </p>
      )}
      {(error || externalError) && (
        <div role="alert" className="error">
          <p>{error || externalError}</p>
          <button onClick={() => void load()}>Retry loading</button>{" "}
          <a href="#accounts">Back to accounts</a>
        </div>
      )}
      {!index && !error && <p role="status">Loading accounts…</p>}
      {working && <p role="status">Saving…</p>}
      {index && access && (
        <>
          <p>
            Data sources import account history through Plaid. Disconnecting
            stops imports and keeps saved history. Budgeting inclusion is set on
            each account; chart visibility is separate.
          </p>
          <button disabled={disabled || !configured} onClick={addSource}>
            Add data source
          </button>
          {!configured && (
            <p>
              Data access setup is unavailable. See the local setup
              instructions.
            </p>
          )}
          {index.sources.map((s: any) => (
            <article className="connection" key={s.id}>
              <h2>{s.label || "Data source"}</h2>
              <p>
                {s.provider} ·{" "}
                {s.status === "historical"
                  ? "Disconnected · saved history is stale"
                  : s.status === "revoke_required"
                    ? "Revocation needs retry"
                    : s.status}
              </p>
              <p>
                Requested history:{" "}
                {s.requested_days == null
                  ? "Unknown"
                  : `${s.requested_days} days`}{" "}
                · Last successful check: {s.last_checked || "Unknown"}
              </p>
              {!s.recoveryOnly &&
                nameForm(
                  "Source nickname",
                  s.label || "",
                  `/data-sources/${encodeURIComponent(s.id)}/name`,
                )}
              <div className="actions">
                <button
                  disabled={
                    disabled ||
                    ["historical", "revoke_required"].includes(s.status)
                  }
                  onClick={() =>
                    void run(() =>
                      api(`/data-sources/${encodeURIComponent(s.id)}/sync`, {}),
                    )
                  }
                >
                  Sync
                </button>
                {s.status !== "historical" &&
                  (s.missingAccessCredential ? (
                    <>
                      <p>
                        Access cannot be revoked here without a saved
                        credential. First revoke this source’s access at the
                        institution or Plaid Portal.
                      </p>
                      <button
                        disabled={disabled}
                        onClick={() => {
                          if (
                            confirm(
                              "Have you revoked this source’s access at your institution or Plaid Portal? This records your confirmation; the app cannot verify external revocation. Saved history stays available.",
                            )
                          )
                            void run(() =>
                              api(
                                `/data-sources/${encodeURIComponent(s.id)}/resolve-missing-access`,
                                { confirmAccessRevoked: true },
                              ),
                            );
                        }}
                      >
                        Confirm access revoked externally
                      </button>
                    </>
                  ) : (
                    <button
                      className="danger secondary"
                      disabled={disabled}
                      onClick={() => {
                        if (
                          confirm(
                            "Disconnect this data source? Saved accounts and transaction history remain available. New imports stop.",
                          )
                        )
                          void run(() =>
                            api(
                              `/data-sources/${encodeURIComponent(s.id)}/disconnect`,
                              {},
                            ),
                          );
                      }}
                    >
                      Disconnect
                    </button>
                  ))}
              </div>
            </article>
          ))}
        </>
      )}
      {index && !access && !id && (
        <>
          {!index.accounts.length && (
            <p>
              No accounts yet. <a href="#data-access">Add a data source</a> to
              get started.
            </p>
          )}
          {index.institutions.map((i: any) => (
            <article key={i.id}>
              <h2>
                {i.provisional
                  ? `Institution not yet identified (${i.name})`
                  : i.name}
              </h2>
              {nameForm(
                "Institution display name",
                i.name,
                `/institutions/${encodeURIComponent(i.id)}/name`,
              )}
              <ul className="institution-index">
                {index.accounts
                  .filter((a: any) => a.institutionId === i.id)
                  .map((a: any) => (
                    <li key={a.id}>
                      <a href={`#accounts/${encodeURIComponent(a.id)}`}>
                        <strong>
                          {a.name}
                          {a.mask ? ` · ••${a.mask}` : ""}
                        </strong>
                        <span>
                          {a.type || "Type unknown"} ·{" "}
                          {a.included
                            ? "Included in budgeting"
                            : "Excluded from budgeting"}
                          {a.stale
                            ? " · Disconnected; saved history is stale"
                            : ""}
                        </span>
                      </a>
                    </li>
                  ))}
              </ul>
            </article>
          ))}
        </>
      )}
      {detail && !access && id && (
        <>
          <h2>
            {detail.account.name}
            {index?.accounts.find((a: any) => a.id === id)?.mask
              ? ` · ••${index.accounts.find((a: any) => a.id === id).mask}`
              : ""}
          </h2>
          <p>
            Type: {detail.account.type || "Unknown"} · Subtype:{" "}
            {detail.account.subtype || "Unknown"} · Ownership:{" "}
            {detail.account.ownership || "Unknown"}
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void run(() =>
                api(`/accounts/${encodeURIComponent(id)}/preferences`, {
                  name: f.get("name"),
                  included: f.has("included"),
                }),
              );
            }}
          >
            <label>
              Account name
              <input
                key={detail.account.name}
                name="name"
                defaultValue={detail.account.name}
                required
                maxLength={120}
              />
            </label>
            <label className="account-inclusion">
              <input
                type="checkbox"
                name="included"
                defaultChecked={detail.account.included}
                key={String(detail.account.included)}
              />{" "}
              Include in budgeting
            </label>
            <p>
              Budgeting inclusion controls bills and income analysis. It does
              not change chart visibility or delete history.
            </p>
            <button disabled={disabled}>Save account preferences</button>
          </form>
          <h2>Observed history</h2>
          <p>
            These dates describe stored posted transactions, not proof that the
            requested history is complete.
          </p>
          {detail.coverage.map((c: any) => (
            <p key={c.sourceId}>
              Oldest: {c.oldestPosted || "Unknown"} · Newest:{" "}
              {c.newestPosted || "Unknown"}
              <br />
              Requested: {c.requestedDays} days · Status: {c.importState} · Last
              successful check: {c.lastChecked || "Unknown"}
            </p>
          ))}
          <p>
            <a href="#data-access">Manage sources, sync or disconnect</a>
          </p>
          <h2>Transactions</h2>
          <ul className="account-list">
            {detail.transactions.map((t: any) => (
              <li key={t.id}>
                <div>
                  <strong>{t.name}</strong>
                  <p>
                    {t.date}
                    {t.pending ? " · Pending" : ""}
                  </p>
                </div>
                <span>
                  {t.currency} {t.amount}
                </span>
              </li>
            ))}
          </ul>
          {!detail.transactions.length && <p>No stored transactions.</p>}
          {detail.nextCursor && (
            <button
              disabled={disabled}
              onClick={() =>
                void run(async () => {
                  const next = await api(
                    `/accounts/${encodeURIComponent(id)}?cursor=${encodeURIComponent(detail.nextCursor)}`,
                  );
                  setDetail({
                    ...next,
                    transactions: [
                      ...detail.transactions,
                      ...next.transactions,
                    ],
                  });
                }, false)
              }
            >
              Load more transactions
            </button>
          )}
          <hr />
          <p>
            Delete only after all sources are disconnected. Affected analyses
            recalculate. Review decisions and audit records are retained;
            decisions with deleted evidence may need review.
          </p>
          <button
            className="danger secondary"
            disabled={
              disabled ||
              detail.sources.some((s: any) => s.status !== "historical")
            }
            onClick={() => {
              if (
                confirm(
                  "Delete account and transaction history? This permanently removes this account and its stored transactions. Affected analyses recalculate. Review decisions and audit records are retained; decisions with deleted evidence may need review.",
                )
              )
                void run(async () => {
                  await api(`/accounts/${encodeURIComponent(id)}/delete`, {
                    confirm: true,
                  });
                  location.hash = "accounts";
                });
            }}
          >
            Delete account and transaction history
          </button>
        </>
      )}
    </section>
  );
}
