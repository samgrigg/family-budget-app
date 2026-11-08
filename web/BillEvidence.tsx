import { useEffect, useRef, useState } from "react";
export default function BillEvidence({
  row,
  api,
  month,
}: {
  row: any;
  month: string;
  api: (path: string, body?: any) => Promise<any>;
}) {
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState(row.name),
    [amount, setAmount] = useState(() => {
      const cycle = row.payments?.find(
        (p: any) => p.date.slice(0, 7) === month,
      );
      const value =
        row.frequency === "Monthly" && row.resolvedAmount?.basis === "actual"
          ? Number(row.resolvedAmount.amount).toFixed(2)
          : (cycle?.amount ??
            (row.amountMode === "variable"
              ? row.planningEstimate
              : row.amount));
      return value && Number(value) > 0 ? value : "";
    }),
    [account, setAccount] = useState(""),
    [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [requireAll, setRequireAll] = useState(false),
    [result, setResult] = useState<any>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const requestId = useRef(0),
    heading = useRef<HTMLHeadingElement>(null);
  useEffect(
    () => () => {
      requestId.current++;
    },
    [],
  );
  async function search(more = false) {
    const token = ++requestId.current;
    setBusy(true);
    setError("");
    const filters = more
      ? result.search
      : { query, amount, account, from, to, requireAll };
    const params = new URLSearchParams({
      billId: row.id,
      ...filters,
      requireAll: String(filters.requireAll),
      offset: String(more ? result.nextOffset : 0),
    });
    try {
      const response = await api(`/bill-plan/evidence?${params}`);
      if (token !== requestId.current) return;
      setResult((previous: any) =>
        more
          ? {
              ...response,
              matches: [
                ...new Map(
                  [...previous.matches, ...response.matches].map((m: any) => [
                    m.key,
                    m,
                  ]),
                ).values(),
              ],
            }
          : response,
      );
    } catch (e: any) {
      if (token === requestId.current) setError(e.message);
    } finally {
      if (token === requestId.current) setBusy(false);
    }
  }
  useEffect(() => {
    if (open) heading.current?.focus();
  }, [open]);
  return (
    <section
      className="bill-evidence"
      aria-label={`Transaction evidence for ${row.name}`}
    >
      <button
        type="button"
        className="secondary"
        aria-expanded={open}
        onClick={() => {
          if (!open) {
            setOpen(true);
            void search();
          } else setOpen(false);
        }}
      >
        {" "}
        {open
          ? "Hide supporting transaction search"
          : "Find supporting transactions"}
      </button>
      {open && (
        <>
          <h3 ref={heading} tabIndex={-1}>
            Supporting transaction search
          </h3>
          <p>
            Searches stored posted outflows in {row.currency}. Results are
            candidates, not confirmed evidence. Transfers between your accounts
            do not prove the bill was paid. Searching does not change your bill
            or fetch new bank history.
          </p>
          <form
            className="plan-form"
            onSubmit={(e) => {
              e.preventDefault();
              void search();
            }}
          >
            <label>
              Description contains
              <input
                type="search"
                value={query}
                maxLength={120}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <label>
              Payment amount (optional)
              <input
                value={amount}
                inputMode="decimal"
                onChange={(e) => setAmount(e.target.value)}
                pattern="[0-9]+(\.[0-9]{1,2})?"
              />
            </label>
            <label className="bill-payment">
              <input
                type="checkbox"
                checked={requireAll}
                onChange={(e) => setRequireAll(e.target.checked)}
              />
              <span>
                Require both description and amount when both are entered
              </span>
            </label>
            <details>
              <summary>Account and date filters</summary>
              <label>
                Search account
                <select
                  value={account}
                  onChange={(e) => setAccount(e.target.value)}
                >
                  <option value="">All included accounts</option>
                  {result?.accounts.map((a: any) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                From date
                <input
                  type="date"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                />
              </label>
              <label>
                Through date
                <input
                  type="date"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                />
              </label>
            </details>
            <button disabled={busy}>Search transactions</button>
          </form>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <p role="status">
            {busy
              ? "Searching stored transactions…"
              : result
                ? `${result.total} candidate transactions · showing ${result.matches.length}`
                : ""}
          </p>
          {result && (
            <>
              <p>
                Results for{" "}
                {result.search.query
                  ? `description “${result.search.query}”`
                  : ""}
                {result.search.query && result.search.amount
                  ? result.search.requireAll
                    ? " and "
                    : " or "
                  : ""}
                {result.search.amount
                  ? `${result.currency} ${result.search.amount}`
                  : ""}
                .{" "}
                {result.bankOnly
                  ? "Card repayment searches include bank-account debits only."
                  : ""}
              </p>
              <p>
                Account:{" "}
                {result.search.account
                  ? (result.accounts.find(
                      (a: any) => a.id === result.search.account,
                    )?.name ?? "Selected account")
                  : "All included accounts"}
                . Dates:{" "}
                {result.search.from || result.search.to
                  ? `${result.search.from || "earliest stored"} through ${result.search.to || "latest stored"}`
                  : "all stored history"}
                .
              </p>
              <p>
                {result.coverage.first
                  ? `Stored ${result.currency} outflow dates: ${result.coverage.first}–${result.coverage.last}. History may have gaps.`
                  : "No included posted outflow history is available in this currency."}
              </p>
              {!result.matches.length && (
                <p>
                  No candidates found. Try a different description, remove the
                  amount, or broaden the account/date filters.
                </p>
              )}
              <ul className="evidence-matches">
                {result.matches.map((t: any) => (
                  <li key={t.key}>
                    <strong>{t.name}</strong>
                    <p>
                      {t.date} · {t.currency}{" "}
                      {Number(t.amount).toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}{" "}
                      · {t.accountName} ({t.accountType || "account"})
                    </p>
                    <p>Matched: {t.reasons.join("; ")}.</p>
                    {t.internalTransfer && (
                      <p>
                        <strong>
                          Confirmed account transfer — funding movement, not a
                          bill payment.
                        </strong>
                      </p>
                    )}
                  </li>
                ))}
              </ul>
              {result.nextOffset !== null && (
                <button
                  type="button"
                  className="secondary"
                  disabled={busy}
                  onClick={() => void search(true)}
                >
                  Show more candidates
                </button>
              )}
              <p>
                Review the description and account before treating a candidate
                as supporting evidence. This search does not attach transactions
                or change your plan.
              </p>
            </>
          )}
        </>
      )}
    </section>
  );
}
