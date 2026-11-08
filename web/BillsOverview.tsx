import DataIssues from "./DataIssues";
import IncomeReview from "./IncomeReview";
import { useEffect, useState } from "react";
import { buildOverview } from "./monthProjection";
export default function BillsOverview({
  api,
  revision,
  income = false,
}: {
  api: (path: string, body?: any) => Promise<any>;
  income?: boolean;
  revision: string;
}) {
  const [data, setData] = useState<any>(null),
    [error, setError] = useState("");
  const endpoint = income ? "/income" : "/bills?months=12";
  const reload = async () => setData(await api(endpoint));
  useEffect(() => {
    let cancelled = false;
    api(endpoint)
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
  }, [revision, income]);
  const overview = data ? buildOverview(data.saved) : null;
  const money = (amount: number | null, currency: string) =>
    amount === null
      ? "Amount unavailable"
      : `${currency === "USD" ? "$" : `${currency || "Unknown currency"} `}${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const billDetails = (b: any, timing?: string) => (
    <details className="overview-bill">
      <summary>
        <span className="overview-bill-name">
          {income && b.employer ? b.employer : b.name}
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
        <p>
          {income ? "Deposited into" : "From"}{" "}
          {b.transactions[0]?.fromAccount || b.accountName}
        </p>
        {income && (
          <p>
            {b.employer
              ? `Employer / payroll sender: ${b.employer} (inferred from deposit descriptions)`
              : "Employer not identified from deposit descriptions."}
          </p>
        )}
        <p>Description: {b.transactions.at(-1)?.toPayee || b.name}</p>
        <details>
          <summary>
            {income ? "Deposit history" : "Payment history"} ·{" "}
            {b.transactions.length} transactions
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
      <h1 tabIndex={-1} id="main-content">
        {income ? "Income Overview" : "Bills Overview"}
      </h1>
      <p>
        {income
          ? "Plan around confirmed recurring income. Expand a source for account details and deposit history."
          : "Plan for your confirmed bills. Expand a bill for account details and payment history."}
      </p>
      {error && (
        <p className="error" role="alert">
          {error}{" "}
          <button className="secondary" onClick={() => location.reload()}>
            Retry
          </button>
        </p>
      )}
      <DataIssues issues={data?.dataIssues} />
      {!overview ? (
        !error && (
          <p role="status">{income ? "Loading income…" : "Loading bills…"}</p>
        )
      ) : (
        <>
          <section className="panel" aria-label="Monthly estimate">
            <h2>{income ? "Estimated monthly income" : "Monthly estimate"}</h2>
            {!overview.totals.length ? (
              <p>
                {income
                  ? "No confirmed recurring income yet."
                  : "No scheduled monthly bills yet."}
              </p>
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
              {income
                ? "Estimated recurring deposits · excludes unconfirmed sources and hidden accounts."
                : "Estimated monthly cost · excludes less frequent bills and hidden accounts."}
            </p>
            <details>
              <summary>How this estimate works</summary>
              <p>
                Uses typical historical amounts. Weekly and biweekly sources are
                averaged at 52 and 26 occurrences per year. Illustrated
                occurrences may differ from this average. Less frequent and
                unscheduled items are excluded; variable amounts may change.
              </p>
            </details>
          </section>
          {income && <IncomeReview data={data} api={api} reload={reload} />}
          <section className="panel" aria-label="Typical month">
            <h2>Typical month</h2>
            <p>
              {income
                ? "Estimated deposit days, not guaranteed pay dates."
                : "Estimated payment days, not due dates."}
            </p>
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
                {income ? (
                  "Confirm an income source below to populate this month."
                ) : (
                  <>
                    Confirm bills in <a href="#budget">Budget</a> to populate
                    this month.
                  </>
                )}
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
            [
              income ? "Less frequent income" : "Less frequent bills",
              overview.occasional,
            ],
            [
              income ? "Unscheduled income" : "Unscheduled bills",
              overview.unscheduled,
            ],
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
