import { useEffect, useState } from "react";
const money = (value: number, currency: string) =>
  new Intl.NumberFormat(undefined, { style: "currency", currency }).format(
    value,
  );
export default function BillPlan({
  api,
  revision,
  summaryOnly = false,
}: {
  api: (path: string, body?: any) => Promise<any>;
  revision: string;
  summaryOnly?: boolean;
}) {
  const [data, setData] = useState<any>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const reload = async () => setData(await api("/bill-plan"));
  useEffect(() => {
    let cancelled = false;
    api("/bill-plan")
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
  async function save(row: any, form: HTMLFormElement, status: string) {
    const values = new FormData(form);
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api("/bill-plan", {
        ...row,
        name: values.get("name"),
        accountName: values.get("accountName"),
        amount: values.get("amount"),
        currency: values.get("currency"),
        frequency: values.get("frequency"),
        day: values.get("day") ? Number(values.get("day")) : null,
        notes: values.get("notes"),
        kind: values.get("kind"),
        acknowledgeDuplicate: values.get("duplicate") === "on",
        status,
      });
      await reload();
      setNotice(
        status === "confirmed"
          ? "Bill confirmed. Funding totals updated."
          : status === "excluded"
            ? "Entry excluded from funding totals."
            : "Changes saved for review.",
      );
    } catch (e: any) {
      void reload().catch(() => {});
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const remaining =
    data?.records.filter((r: any) => r.status === "review").length ?? 0;
  return (
    <section className="panel" aria-label="Planned bill commitments">
      <h2>Planned commitments</h2>
      <p>
        From your Bills worksheet. These are your plans; transaction patterns
        are shown separately and are not added to these totals.
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <p role="status" className="action-status">
        {notice}
      </p>
      {!data ? (
        <p role="status">Loading bill plan…</p>
      ) : (
        <>
          <p>
            {remaining} entries awaiting review ·{" "}
            {data.records.filter((r: any) => r.status === "confirmed").length}{" "}
            confirmed ·{" "}
            {data.records.filter((r: any) => r.status === "excluded").length}{" "}
            excluded
          </p>
          <p>
            Funding totals include only confirmed commitments.{" "}
            {remaining > 0
              ? "The plan is incomplete until you review the remaining entries."
              : ""}
          </p>
          {data.totals.map((t: any) => (
            <article className="bill" key={`${t.accountName}:${t.currency}`}>
              <h3>
                {t.accountName} · {t.currency}
              </h3>
              <p>Regular monthly commitments: {money(t.monthly, t.currency)}</p>
              <p>
                Monthly set-aside for less frequent bills:{" "}
                {money(t.setAside, t.currency)}
              </p>
              <p>
                <strong>
                  Total to fund per month: {money(t.total, t.currency)}
                </strong>
              </p>
            </article>
          ))}
          {!data.totals.length && <p>No commitments confirmed yet.</p>}
          <p>
            Account labels are from the worksheet and are not linked to bank
            accounts. Currency starts as USD; verify it during review. Weekly
            amounts use 52/12 payments per month and biweekly amounts use 26/12.
            Set-asides do not indicate when a bill is due.
          </p>
          {summaryOnly ? (
            <p>
              <a href="#budget">Review imported bills in Budget</a>
            </p>
          ) : (
            <>
              {!data.records.length && (
                <p>
                  No worksheet staged. Use the local worksheet staging command
                  described in the README.
                </p>
              )}
              {data.records.map((r: any) => (
                <details className="bill plan-entry" key={r.id}>
                  <summary>
                    {r.name} ·{" "}
                    {r.status === "confirmed"
                      ? "Confirmed"
                      : r.status === "excluded"
                        ? "Excluded"
                        : "Needs review"}
                  </summary>
                  <p>
                    Source: {r.source?.cell ?? r.id} · Original value:{" "}
                    {r.source?.value}
                    {r.source?.formula
                      ? ` · Formula: =${r.source.formula}`
                      : ""}
                  </p>
                  {r.kind === "transfer" && (
                    <p>
                      Auto-transfer: excluded from bill totals. Keep this as a
                      transfer to avoid counting the funded bill twice.
                    </p>
                  )}
                  {Number(r.amount) === 0 && (
                    <p>
                      Zero amount: verify whether this commitment is still
                      active.
                    </p>
                  )}
                  {r.frequency === "Unknown" && (
                    <p>
                      Uncertain frequency: verify the actual payment amount and
                      interval together.
                    </p>
                  )}
                  {!r.accountName && (
                    <p>No payment account supplied in the worksheet.</p>
                  )}
                  {r.possibleDuplicate && (
                    <p>
                      Possible duplicate: another confirmed bill has the same
                      normalized name. Compare both before confirming.
                    </p>
                  )}
                  <form
                    className="plan-form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void save(r, e.currentTarget, "confirmed");
                    }}
                  >
                    <label>
                      Bill name
                      <input
                        name="name"
                        defaultValue={r.name}
                        required
                        maxLength={120}
                      />
                    </label>
                    <label>
                      Payment account
                      <input
                        name="accountName"
                        defaultValue={r.accountName}
                        maxLength={150}
                      />
                    </label>
                    <label>
                      Amount per payment
                      <input
                        name="amount"
                        defaultValue={r.amount}
                        inputMode="decimal"
                        pattern="[0-9]+\.[0-9]{2}"
                        required
                        aria-describedby={`amount-${r.id}`}
                      />
                    </label>
                    <p id={`amount-${r.id}`}>
                      Use two decimal places. Enter the full payment amount, not
                      its monthly set-aside.
                    </p>
                    <label>
                      Currency
                      <input
                        name="currency"
                        defaultValue={r.currency}
                        pattern="[A-Z]{3}"
                        maxLength={3}
                        required
                      />
                    </label>
                    <label>
                      Frequency
                      <select name="frequency" defaultValue={r.frequency}>
                        {[
                          "Unknown",
                          "Weekly",
                          "Every two weeks",
                          "Monthly",
                          "Quarterly",
                          "Every six months",
                          "Yearly",
                        ].map((f) => (
                          <option key={f}>{f}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Payment day (optional)
                      <input
                        name="day"
                        type="number"
                        min={1}
                        max={31}
                        defaultValue={r.day ?? ""}
                      />
                    </label>
                    <label>
                      Entry type
                      <select name="kind" defaultValue={r.kind}>
                        <option value="bill">Bill commitment</option>
                        <option value="transfer">
                          Auto-transfer (not a bill)
                        </option>
                      </select>
                    </label>
                    <label>
                      Notes
                      <textarea
                        name="notes"
                        defaultValue={r.notes}
                        maxLength={2000}
                      />
                    </label>
                    {(r.possibleDuplicate ||
                      r.acknowledgeDuplicate ||
                      error.toLowerCase().includes("duplicate")) && (
                      <label className="bill-payment">
                        <input
                          type="checkbox"
                          name="duplicate"
                          defaultChecked={r.acknowledgeDuplicate}
                        />
                        <span>
                          I reviewed the possible duplicate and this is a
                          separate commitment.
                        </span>
                      </label>
                    )}
                    <div className="actions">
                      <button disabled={busy}>Confirm bill</button>
                      <button
                        type="button"
                        className="secondary"
                        disabled={busy}
                        onClick={(e) =>
                          void save(r, e.currentTarget.form!, "review")
                        }
                      >
                        Save for review
                      </button>
                      <button
                        type="button"
                        className="secondary"
                        disabled={busy}
                        onClick={(e) =>
                          void save(r, e.currentTarget.form!, "excluded")
                        }
                      >
                        Exclude from plan
                      </button>
                    </div>
                  </form>
                </details>
              ))}
            </>
          )}
        </>
      )}
    </section>
  );
}
