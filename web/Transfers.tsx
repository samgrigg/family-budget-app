import { useState } from "react";
export default function Transfers({ data, accounts, api, onError }: any) {
  const [view, setView] = useState("review");
  const [busy, setBusy] = useState(false);
  async function decide(key: string, status: string) {
    setBusy(true);
    try {
      await api("/transfers", { key, status });
    } catch (e: any) {
      onError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const account = (t: any) => {
    const a = accounts.find(
      (a: any) => a.connection === t.connection && a.id === t.account,
    );
    return `${a?.name ?? "Account"}${a?.mask ? ` ••${a.mask}` : ""}${a?.hidden ? " (hidden)" : ""}`;
  };
  return (
    <section className="panel" aria-label="Internal transfers">
      <h2>Internal transfers</h2>
      <p>
        Matched movements between onboarded deposit accounts, including hidden
        accounts. Loan and credit-card payments remain payments or bills.
        Confirmed pairs are excluded from bill discovery.
      </p>
      <div className="actions">
        {[
          ["review", "Review"],
          ["confirmed", "Confirmed"],
          ["rejected", "Rejected"],
        ].map(([value, label]) => (
          <button
            key={value}
            className={view === value ? "" : "secondary"}
            aria-pressed={view === value}
            onClick={() => setView(value)}
          >
            {label} ({data[value].length})
          </button>
        ))}
      </div>
      {!data[view].length && <p>No transfers in this view.</p>}
      {data[view].map((p: any) => (
        <article className="bill" key={p.key}>
          <h3>
            {p.out.currency === "USD" ? "$" : `${p.out.currency} `}
            {Number(p.out.amount).toLocaleString(undefined, {
              minimumFractionDigits: 2,
            })}
          </h3>
          <p>
            From {account(p.out)} → {account(p.into)}
          </p>
          <p>
            {p.out.date} · {p.out.name}
            <br />
            {p.into.date} · {p.into.name}
          </p>
          <p>
            {view === "confirmed"
              ? p.automatic
                ? "Automatically confirmed"
                : "Confirmed by you"
              : view === "rejected"
                ? "Rejected by you"
                : "Possible transfer — needs review"}
          </p>
          <div className="actions">
            {view === "review" && (
              <button
                disabled={busy}
                onClick={() => void decide(p.key, "confirmed")}
              >
                Confirm transfer
              </button>
            )}
            {view !== "rejected" && (
              <button
                className="secondary"
                disabled={busy}
                onClick={() => void decide(p.key, "rejected")}
              >
                {view === "confirmed" ? "Undo match" : "Reject match"}
              </button>
            )}
            {view === "rejected" && (
              <button
                className="secondary"
                disabled={busy}
                onClick={() => void decide(p.key, "review")}
              >
                Reconsider match
              </button>
            )}
          </div>
        </article>
      ))}
      <p className="fine">
        Matching uses equal amounts and nearby posting dates. Fees, split
        transfers, and currency conversions need separate handling. Both
        original transactions remain stored.
      </p>
    </section>
  );
}
