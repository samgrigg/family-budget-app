import { useEffect, useState } from "react";
export default function Bills({
  api,
  revision,
  accountFilter,
}: {
  api: (path: string, body?: any) => Promise<any>;
  revision: string;
  accountFilter: string;
}) {
  const [notice, setNotice] = useState("");
  const [months, setMonths] = useState(6),
    [data, setData] = useState<any>(null),
    [view, setView] = useState("suggestions"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function load() {
    setData(await api(`/bills?months=${months}`));
  }
  useEffect(() => {
    let cancelled = false;
    setData(null);
    api(`/bills?months=${months}`)
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [months, revision]);
  async function save(body: any) {
    setBusy(true);
    setError("");
    try {
      await api("/bills", { ...body, months });
      await load();
      setNotice(
        body.status === "saved"
          ? "Bill confirmed."
          : body.status === "dismissed"
            ? "Bill rejected."
            : "Bill returned to review.",
      );
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const money = (value: number | null, currency: string) =>
    value === null
      ? "No current history"
      : `${currency === "USD" ? "$" : `${currency} `}${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const filtered =
    data &&
    Object.fromEntries(
      ["suggestions", "saved", "dismissed"].map((v) => [
        v,
        data[v].filter(
          (b: any) =>
            !accountFilter ||
            JSON.stringify([b.connection, b.accountId]) === accountFilter,
        ),
      ]),
    );
  return (
    <section className="panel" aria-label="Bills" tabIndex={-1}>
      <p role="status" className="action-status">
        {notice}
      </p>
      <div className="panel-heading">
        <h2>Bills</h2>
        <label>
          History{" "}
          <select
            value={months}
            onChange={(e) => setMonths(Number(e.target.value))}
          >
            {[3, 6, 12].map((n) => (
              <option key={n} value={n}>
                {n} months
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="actions" aria-label="Bill views">
        {[
          ["suggestions", "Review"],
          ["saved", "Confirmed"],
          ["dismissed", "Rejected"],
        ].map(([v, label]) => (
          <button
            key={v}
            className={view === v ? "" : "secondary"}
            aria-pressed={view === v}
            onClick={() => setView(v)}
          >
            {label} {data ? `(${filtered[v].length})` : ""}
          </button>
        ))}
      </div>
      <p className="fine">
        {data?.history.first
          ? `Stored transaction dates: ${data.history.first} – ${data.history.last}. This range may contain gaps; selecting more months does not fetch older history.`
          : "No transaction history available yet."}
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {!data ? (
        <p role="status">Loading bills…</p>
      ) : filtered[view].length === 0 ? (
        <p className="empty">
          {view === "saved"
            ? "Confirm a suggestion to save your first bill."
            : view === "dismissed"
              ? "No rejected bills."
              : "No patterns found in this window. Try a longer window when more history is available."}
        </p>
      ) : (
        filtered[view].map((b: any) =>
          view === "dismissed" ? (
            <article className="bill" key={b.key}>
              <strong>{b.name}</strong>
              <button
                className="secondary"
                disabled={busy}
                onClick={() =>
                  void save({ key: b.key, name: b.name, status: "review" })
                }
              >
                Reconsider bill
              </button>
            </article>
          ) : (
            <article className="bill" key={b.key}>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const form = new FormData(e.currentTarget);
                  const selected = form.getAll("selected");
                  if (selected.length < 2) {
                    setError("Select at least two payments to save a bill.");
                    return;
                  }
                  void save({
                    key: b.key,
                    name: form.get("name"),
                    status: "saved",
                    excluded: b.transactions
                      .filter((t: any) => !selected.includes(t.id))
                      .map((t: any) => t.id),
                  });
                }}
              >
                <h3>{b.name}</h3>
                <p>From {b.transactions[0]?.fromAccount || b.accountName}</p>
                <p>Description: {b.transactions[0]?.toPayee || b.name}</p>
                <p>
                  {b.frequency} · {b.confidence}
                </p>
                <p>
                  Typical {money(b.typical, b.currency)} · Range{" "}
                  {money(b.min, b.currency)} – {money(b.max, b.currency)}
                </p>
                {b.reason && <p>{b.reason}</p>}
                <details>
                  <summary>
                    Payment history · {b.transactions.length} transactions
                  </summary>
                  {view === "suggestions" ? (
                    <div>
                      <label className="bill-name">
                        Bill name
                        <input
                          name="name"
                          defaultValue={b.name}
                          maxLength={120}
                          required
                        />
                      </label>
                      {b.transactions.map((t: any) => (
                        <label className="bill-payment" key={t.id}>
                          <input
                            type="checkbox"
                            name="selected"
                            value={t.id}
                            defaultChecked
                          />
                          <span>
                            {t.date} · {t.name}
                            <br />
                            From {t.fromAccount}
                            <br />
                            Description: {t.toPayee}
                            <br />
                            {t.possibleDestination
                              ? `Possible destination account: ${t.possibleDestination} (matched amount and date; unverified)`
                              : "Destination account not identified"}
                          </span>
                          <span>{money(Number(t.amount), b.currency)}</span>
                        </label>
                      ))}
                    </div>
                  ) : (
                    <ul>
                      {b.transactions.map((t: any) => (
                        <li key={t.id}>
                          {t.date} · {t.name} ·{" "}
                          {money(Number(t.amount), b.currency)}
                          <br />
                          From {t.fromAccount}
                          <br />
                          Description: {t.toPayee}
                          <br />
                          {t.possibleDestination
                            ? `Possible destination account: ${t.possibleDestination} (matched amount and date; unverified)`
                            : "Destination account not identified"}
                        </li>
                      ))}
                    </ul>
                  )}
                </details>
                <p>
                  {view === "saved"
                    ? "Confirmed by you"
                    : "Possible bill — needs review"}
                </p>
                {view === "suggestions" && (
                  <div className="actions">
                    <button type="submit" disabled={busy}>
                      Confirm bill
                    </button>
                    <button
                      type="button"
                      className="secondary"
                      disabled={busy}
                      onClick={() =>
                        void save({
                          key: b.key,
                          name: b.name,
                          status: "dismissed",
                        })
                      }
                    >
                      Reject bill
                    </button>
                  </div>
                )}
                {view === "saved" && (
                  <button
                    type="button"
                    className="secondary"
                    disabled={busy}
                    onClick={() =>
                      void save({ key: b.key, name: b.name, status: "review" })
                    }
                  >
                    Undo confirmation
                  </button>
                )}
              </form>
            </article>
          ),
        )
      )}
    </section>
  );
}
