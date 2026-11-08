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
  const summary = (b: any) => (
    <>
      <h3>{b.name}</h3>
      <p>
        {money(b.typical, b.currency)}
        {b.min !== b.max && (
          <>
            {" "}
            · Range {money(b.min, b.currency)}–{money(b.max, b.currency)}
          </>
        )}
      </p>
      <p>From {b.transactions[0]?.fromAccount || b.accountName}</p>
      <p>Description: {b.transactions.at(-1)?.toPayee || b.name}</p>
    </>
  );
  return (
    <>
      <h1>Bills Overview</h1>
      <p>
        Your confirmed bills across a typical month. Days estimate when payments
        posted, not when bills are due. Hidden accounts are excluded.
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
                  <strong>{money(t.amount, t.currency)}</strong>
                </p>
              ))
            )}
            <p>
              Uses typical amounts. Weekly and biweekly bills are averaged at 52
              and 26 payments per year; illustrated occurrences below can
              differ. Less frequent and unscheduled bills are excluded from this
              total.
            </p>
          </section>
          <section className="panel" aria-label="Typical month">
            <h2>Typical month</h2>
            <p>
              Weekly and biweekly positions are illustrations based on the
              latest payment; their dates shift each calendar month. Day 31
              represents the final day in shorter months.
            </p>
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
                    {e.approximate && <span>Illustrative</span>}
                  </div>
                  <article>
                    {summary(e.bill)}
                    <p>{e.bill.frequency}</p>
                    <details>
                      <summary>
                        Payment history · {e.bill.transactions.length}{" "}
                        transactions
                      </summary>
                      <ul>
                        {e.bill.transactions.map((t: any) => (
                          <li key={t.id}>
                            {t.date} · {money(Number(t.amount), t.currency)} ·{" "}
                            {t.name}
                          </li>
                        ))}
                      </ul>
                    </details>
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
                  <h2>{title}</h2>
                  {bills.map((b: any) => (
                    <article className="bill" key={b.key}>
                      {summary(b)}
                      <p>{b.frequency}</p>
                    </article>
                  ))}
                </section>
              ),
          )}
        </>
      )}
    </>
  );
}
