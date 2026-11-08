import { useEffect, useState } from "react";
import { buildOverview } from "./monthProjection";
export default function BillsOverview({
  api,
  revision,
}: {
  api: (path: string) => Promise<any>;
  revision: string;
}) {
  const [data, setData] = useState<any>(null),
    [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    api("/bills?months=12")
      .then((d) => {
        if (!cancelled) {
          setData(d);
          setError("");
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [revision]);
  const overview = data ? buildOverview(data.saved) : null;
  const money = (amount: number | null, currency: string) =>
    amount === null
      ? "Amount unavailable"
      : `${currency || "Unknown currency"} ${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const billDetails = (b: any, timing?: string) => (
    <details className="overview-bill">
      <summary>
        <span className="overview-bill-name">
          {b.name}
          {timing && <span className="overview-timing">{timing}</span>}
        </span>
        <strong>{money(b.typical, b.currency)}</strong>
      </summary>
      <div className="overview-bill-body">
        <p>
          {b.frequency} · {b.confidence}
        </p>
        {b.min !== b.max && (
          <p>
            Historical range: {money(b.min, b.currency)}–
            {money(b.max, b.currency)}
          </p>
        )}
        <p>From {b.transactions[0]?.fromAccount || b.accountName}</p>
        <p>Description: {b.transactions.at(-1)?.toPayee || b.name}</p>
        <details>
          <summary>
            Payment history · {b.transactions.length} transactions
          </summary>
          <ul>
            {b.transactions.map((t: any) => (
              <li key={t.id}>
                {t.date} · {money(Number(t.amount), t.currency)} · {t.name}
              </li>
            ))}
          </ul>
        </details>
      </div>
    </details>
  );
  return (
    <>
      <h1>Bills Overview</h1>
      <p>
        Plan for your confirmed bills. Expand a bill for account details and
        payment history.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}{" "}
          <button className="secondary" onClick={() => location.reload()}>
            Retry
          </button>
        </p>
      )}
      {!overview ? (
        !error && <p role="status">Loading bills…</p>
      ) : (
        <>
          <section className="panel" aria-label="Monthly estimate">
            <h2>Monthly estimate</h2>
            {!overview.totals.length ? (
              <p>No scheduled monthly bills yet.</p>
            ) : (
              overview.totals.map((t) => (
                <p key={t.currency}>
                  <strong className="monthly-total">
                    {money(t.amount, t.currency)}
                  </strong>
                </p>
              ))
            )}
            <p>
              Estimated monthly cost · excludes less frequent bills and hidden
              accounts.
            </p>
            <details>
              <summary>How this estimate works</summary>
              <p>
                Uses typical historical payment amounts. Weekly and biweekly
                bills are averaged at 52 and 26 payments per year. Illustrated
                occurrences may differ from this average. Unscheduled bills are
                excluded; variable amounts may change.
              </p>
            </details>
          </section>
          <section className="panel" aria-label="Typical month">
            <h2>Typical month</h2>
            <p>Estimated payment days, not due dates.</p>
            <details>
              <summary>About payment timing</summary>
              <p>
                Weekly and biweekly dates illustrate the latest recorded payment
                pattern and shift each calendar month. Day 31 represents the
                final day in shorter months.
              </p>
            </details>
            {!overview.events.length && (
              <p>
                Confirm bills in <a href="#budget">Budget</a> to populate this
                month.
              </p>
            )}
            <ol className="month-bills">
              {overview.events.map((e) => (
                <li key={`${e.bill.key}:${e.day}`}>
                  <div className="bill-day">
                    {e.monthEnd ? "Month end" : `Day ${e.day}`}
                  </div>
                  <article>
                    {billDetails(
                      e.bill,
                      e.approximate ? "Illustrative date" : undefined,
                    )}
                  </article>
                </li>
              ))}
            </ol>
          </section>
          {[
            ["Less frequent bills", overview.occasional],
            ["Unscheduled bills", overview.unscheduled],
          ].map(
            ([title, bills]: any) =>
              bills.length > 0 && (
                <section className="panel" key={title}>
                  <details>
                    <summary>
                      {title} ({bills.length})
                    </summary>
                    <p>Not included in the monthly estimate.</p>
                    {bills.map((b: any) => (
                      <article className="bill" key={b.key}>
                        {billDetails(b)}
                      </article>
                    ))}
                  </details>
                </section>
              ),
          )}
        </>
      )}
    </>
  );
}
