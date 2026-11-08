import { useState } from "react";
export default function IncomeReview({ data, api, reload }: any) {
  const [view, setView] = useState("suggestions"),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  async function decide(b: any, status: string, name = b.name) {
    setBusy(true);
    setError("");
    try {
      await api("/income", { key: b.key, name, status });
      await reload();
      setMessage(
        status === "saved"
          ? "Income source confirmed."
          : status === "dismissed"
            ? "Income source rejected."
            : "Income source returned to review.",
      );
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel" aria-label="Income review">
      <h2>Income sources</h2>
      <p>
        Review recurring deposits before counting them as income. Check for
        refunds, borrowed funds, and transfers that were not matched. Only
        confirmed sources contribute to the estimate.
      </p>
      <p role="status">{message}</p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <div className="actions">
        {[
          ["suggestions", "Review"],
          ["saved", "Confirmed"],
          ["dismissed", "Rejected"],
        ].map(([v, label]) => (
          <button
            key={v}
            aria-pressed={view === v}
            className={view === v ? "" : "secondary"}
            onClick={() => setView(v)}
          >
            {label} ({data[v].length})
          </button>
        ))}
      </div>
      {!data[view].length && <p>No sources in this view.</p>}
      {data[view].map((b: any) => (
        <article className="bill" key={b.key}>
          <h3>{b.name}</h3>
          {b.typical != null && (
            <>
              <p>
                {b.frequency} · Typical{" "}
                {b.currency === "USD" ? "$" : `${b.currency} `}
                {b.typical.toFixed(2)}
              </p>
              <p>Deposited into {b.accountName}</p>
            </>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void decide(
                b,
                "saved",
                new FormData(e.currentTarget).get("name"),
              );
            }}
          >
            {b.transactions && (
              <details>
                <summary>
                  Deposit history · {b.transactions.length} transactions
                </summary>
                <ul>
                  {b.transactions.map((t: any) => (
                    <li key={t.id}>
                      {t.date} · {t.currency === "USD" ? "$" : `${t.currency} `}
                      {Number(t.amount).toFixed(2)} · {t.name}
                    </li>
                  ))}
                </ul>
              </details>
            )}
            {view === "suggestions" && (
              <label className="bill-name">
                Source name
                <input
                  name="name"
                  defaultValue={b.name}
                  required
                  maxLength={120}
                />
              </label>
            )}
            <div className="actions">
              {view === "suggestions" ? (
                <>
                  <button disabled={busy}>Confirm income</button>
                  <button
                    type="button"
                    className="secondary"
                    disabled={busy}
                    onClick={() => void decide(b, "dismissed")}
                  >
                    Reject source
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="secondary"
                  disabled={busy}
                  onClick={() => void decide(b, "review")}
                >
                  {view === "saved" ? "Undo confirmation" : "Reconsider source"}
                </button>
              )}
            </div>
          </form>
        </article>
      ))}
    </section>
  );
}
