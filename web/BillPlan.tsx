import BillEvidence from "./BillEvidence";
import BillMerge from "./BillMerge";
import { billPlanSubmission } from "./billPlanSubmission";
import BillClassificationFields from "./BillClassificationFields";
import PaymentFields from "./PaymentFields";
import { validMonth } from "../shared/billAmounts";
import { useEffect, useRef, useState } from "react";
import { budgetPlanEntries, nextBillToReview } from "./billReview";
const money = (value: number, currency: string) =>
  new Intl.NumberFormat(undefined, { style: "currency", currency }).format(
    value,
  );
export default function BillPlan({
  api,
  revision,
  summaryOnly = false,
  activeTab,
}: {
  api: (path: string, body?: any) => Promise<any>;
  revision: string;
  summaryOnly?: boolean;
  activeTab?: string;
}) {
  const [data, setData] = useState<any>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<{
    id: string;
    message: string;
    duplicatePlans?: any[];
  } | null>(null);
  const [entryKinds, setEntryKinds] = useState<Record<string, string>>({});
  const [formVersions, setFormVersions] = useState<Record<string, number>>({});
  const [month, setMonth] = useState(() => {
    const today = new Date();
    return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
  });
  const entryKindKey = (r: any) =>
    `${r.id}:${month}:${formVersions[r.id] ?? 0}`;
  const entryKind = (r: any) => entryKinds[entryKindKey(r)] ?? r.kind;
  const endpoint = `/bill-plan?month=${month}`;
  const heading = useRef<HTMLHeadingElement>(null);
  const entries = useRef(new Map<string, HTMLDetailsElement>());
  const [advanceFrom, setAdvanceFrom] = useState<string | null>(null);
  useEffect(() => {
    if (saveError && (!activeTab || activeTab === "commitments"))
      entries.current
        .get(saveError.id)
        ?.querySelector<HTMLElement>("[data-save-error]")
        ?.focus();
  }, [saveError, activeTab]);
  useEffect(() => {
    if (!advanceFrom || !data || (activeTab && activeTab !== "commitments"))
      return;
    const current = entries.current.get(advanceFrom);
    if (current) current.open = false;
    const nextId = nextBillToReview(data.records, advanceFrom);
    const next = nextId ? entries.current.get(nextId) : undefined;
    if (next) next.open = true;
    const target = next ?? current;
    const focusTarget = target?.querySelector("summary") ?? heading.current;
    focusTarget?.focus({ preventScroll: true });
    (target ?? heading.current)?.scrollIntoView({
      block: "start",
      inline: "nearest",
    });
    setAdvanceFrom(null);
  }, [advanceFrom, data, activeTab]);
  const reload = async () => {
    const fresh = await api(endpoint);
    setData(fresh);
    return fresh;
  };
  useEffect(() => {
    let cancelled = false;
    setData(null);
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
  }, [revision, month]);
  async function save(row: any, form: HTMLFormElement, status: string) {
    const values = new FormData(form);
    const transfer = values.get("kind") === "transfer";
    setBusy(true);
    setError("");
    setNotice("");
    setSaveError(null);
    try {
      await api("/bill-plan", billPlanSubmission(row, values, month, status));
      await reload();
      setAdvanceFrom(row.id);
      setNotice(
        status === "confirmed"
          ? transfer
            ? "Transfer confirmed. Excluded from bill and funding totals."
            : "Bill confirmed. Funding totals updated."
          : status === "excluded"
            ? "Bill details saved. Excluded from Budget and funding totals."
            : "Changes saved for review.",
      );
    } catch (e: any) {
      void reload().catch(() => {});
      setSaveError({
        id: row.id,
        message: e.message,
        duplicatePlans: e.duplicatePlans,
      });
    } finally {
      setBusy(false);
    }
  }
  const duplicatePlansFor = (row: any) =>
    saveError && saveError.id === row.id && saveError.duplicatePlans
      ? saveError.duplicatePlans
      : (row.duplicatePlans ?? []);
  const remaining =
    data?.records.filter((r: any) => r.status === "review").length ?? 0;
  return (
    <section
      className="panel"
      aria-label={
        activeTab === "expenses"
          ? "Planned expenses"
          : "Planned bill commitments"
      }
      id={activeTab ? "budget-panel-plan" : undefined}
      role={activeTab ? "tabpanel" : undefined}
      aria-labelledby={
        activeTab
          ? `budget-tab-${activeTab === "expenses" ? "expenses" : "commitments"}`
          : undefined
      }
      tabIndex={activeTab ? 0 : undefined}
      hidden={
        !!activeTab && activeTab !== "commitments" && activeTab !== "expenses"
      }
    >
      <h2 ref={heading} tabIndex={-1}>
        {activeTab === "expenses" ? "Planned expenses" : "Planned commitments"}
      </h2>
      <p>
        From your Bills worksheet. These are your plans; transaction patterns
        are shown separately and are not added to these totals.
      </p>
      <label>
        Planning month
        <input
          type="month"
          value={month}
          onChange={(e) => {
            if (validMonth(e.target.value)) setMonth(e.target.value);
          }}
        />
      </label>
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
          <section
            aria-label="Planned expenses"
            hidden={activeTab === "commitments"}
          >
            <h3>Planned expenses · {month}</h3>
            {data.expenses.map((t: any) => (
              <p key={t.currency}>
                <strong>{money(t.total, t.currency)}</strong> · includes{" "}
                {money(t.estimated, t.currency)} in estimates · {t.unknown}{" "}
                unknown amounts
              </p>
            ))}
            <p>
              Payments for card purchases are account funding; debt payoff is a
              separate commitment. Neither is a new expense. Purchases count as
              expenses. This covers confirmed bill plans, not all household
              spending.
            </p>
            <h3>Debt payoff · {month}</h3>
            {(data.debtPayoff ?? []).map((t: any) => (
              <p key={t.currency}>
                <strong>{money(t.total, t.currency)}</strong> · includes{" "}
                {money(t.estimated, t.currency)} in estimates · {t.unknown}{" "}
                unknown amounts
              </p>
            ))}
            <p>
              Whole payments toward existing credit card balances, including
              balance transfers. Principal, interest and fees are not split.
              Expenses, debt payoff and funding are separate views; do not add
              funding to the other totals.
            </p>
          </section>
          <div hidden={activeTab === "expenses"}>
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
                <p>
                  Known amounts: {money(t.known, t.currency)} · Estimates:{" "}
                  {money(t.estimated, t.currency)}
                </p>
                <p>
                  {t.unknown} bills with unknown amounts
                  {t.unknown > 0 ? " · funding total is incomplete" : ""}
                </p>
                <p>Monthly commitments: {money(t.monthly, t.currency)}</p>
                <p>
                  Includes {money(t.repayments, t.currency)} in credit card
                  payments for purchases (not new expenses).
                </p>
                <p>
                  Includes {money(t.debtPayoff ?? 0, t.currency)} in debt payoff
                  commitments.
                </p>
                <p>
                  Monthly set-aside for less frequent bills:{" "}
                  {money(t.setAside, t.currency)}
                </p>
                <p>
                  <strong>
                    Funding subtotal for {month}: {money(t.total, t.currency)}
                  </strong>
                </p>
              </article>
            ))}
            {!data.totals.length && <p>No commitments confirmed yet.</p>}
            <p>
              Account labels are from the worksheet and are not linked to bank
              accounts. Currency starts as USD; verify it during review. Weekly
              amounts use 52/12 payments per month and biweekly amounts use
              26/12. Set-asides do not indicate when a bill is due.
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
                {budgetPlanEntries(data.records).map((r: any) => (
                  <details
                    className="bill plan-entry"
                    key={r.id}
                    ref={(element) => {
                      if (element) entries.current.set(r.id, element);
                      else entries.current.delete(r.id);
                    }}
                  >
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
                    {r.sources?.length > 1 && (
                      <details>
                        <summary>
                          Worksheet sources ({r.sources.length})
                        </summary>
                        <ul>
                          {r.sources.map((source: any, i: number) => (
                            <li key={i}>
                              {source.cell} · Original value: {source.value}
                              {source.formula
                                ? ` · Formula: =${source.formula}`
                                : ""}
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                    <p>
                      {r.resolvedAmount.amount === null
                        ? "Amount unknown"
                        : `${money(r.resolvedAmount.amount, r.currency)} · ${r.resolvedAmount.basis === "actual" ? "Actual paid" : r.resolvedAmount.basis === "known" ? "Known payment" : r.resolvedAmount.basis === "estimate" ? "Planning estimate" : "Monthly equivalent"}`}{" "}
                      · {month}
                    </p>
                    {r.resolvedAmount.missingActual && (
                      <p>
                        Linked transaction is unavailable. The total uses the
                        saved payment amount; verify the evidence.
                      </p>
                    )}
                    {Number(r.amount) === 0 && r.amountMode !== "variable" && (
                      <p>
                        Zero amount: verify whether this commitment is still
                        active.
                      </p>
                    )}
                    {r.frequency === "Unknown" && (
                      <p>
                        Uncertain frequency: verify the actual payment amount
                        and interval together.
                      </p>
                    )}
                    {!r.accountName && (
                      <p>No payment account supplied in the worksheet.</p>
                    )}
                    {duplicatePlansFor(r).length > 0 && (
                      <div>
                        <p>
                          Possible duplicate: another planned bill is already
                          confirmed.
                        </p>
                        <ul>
                          {duplicatePlansFor(r).map((p: any) => (
                            <li key={p.id}>
                              {p.name} · {p.accountName}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {r.observedMatches?.length > 0 && (
                      <p>
                        Matching confirmed transaction history:{" "}
                        {r.observedMatches.map((m: any) => m.name).join(", ")}.
                        History estimates are shown separately from your plan.
                      </p>
                    )}
                    <BillEvidence
                      key={JSON.stringify([
                        r.id,
                        r.name,
                        r.amount,
                        r.amountMode,
                        r.planningEstimate,
                        r.currency,
                        r.expenseType,
                        month,
                        r.payments,
                        r.resolvedAmount?.basis === "actual"
                          ? r.resolvedAmount.amount
                          : null,
                      ])}
                      row={r}
                      month={month}
                      api={api}
                    />
                    <form
                      key={`${r.id}:${month}:${formVersions[r.id] ?? 0}`}
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
                        Amount certainty
                        <select
                          name="amountMode"
                          defaultValue={r.amountMode ?? "fixed"}
                        >
                          <option value="fixed">Fixed amount</option>
                          <option value="variable">
                            Variable monthly amount (may be unknown)
                          </option>
                        </select>
                      </label>
                      <label>
                        Fixed amount per payment
                        <input
                          name="amount"
                          defaultValue={r.amount}
                          inputMode="decimal"
                          pattern="[0-9]+\.[0-9]{2}"
                          aria-describedby={`amount-${r.id}`}
                        />
                      </label>
                      <p id={`amount-${r.id}`}>
                        Use two decimal places. For variable monthly bills, this
                        fixed amount is ignored and may be blank. Zero means a
                        known zero, not an unknown payment.
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
                            <option key={f} value={f}>
                              {f === "Quarterly" ? "Every 3 months" : f}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Planning estimate (optional, variable bills)
                        <input
                          name="planningEstimate"
                          defaultValue={r.planningEstimate ?? ""}
                          inputMode="decimal"
                          pattern="[0-9]+\.[0-9]{2}"
                        />
                      </label>
                      <BillClassificationFields
                        kind={entryKind(r)}
                        expenseType={r.expenseType}
                        creditAccountId={r.creditAccountId}
                        accounts={data.creditAccounts}
                      />
                      <PaymentFields row={r} month={month} data={data} />
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
                        <select
                          name="kind"
                          value={entryKind(r)}
                          onChange={(e) =>
                            setEntryKinds((k) => ({
                              ...k,
                              [entryKindKey(r)]: e.target.value,
                            }))
                          }
                        >
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
                      {saveError && saveError.id === r.id && (
                        <p
                          role="alert"
                          tabIndex={-1}
                          data-save-error
                          className="error"
                        >
                          {saveError.message}
                        </p>
                      )}
                      {(duplicatePlansFor(r).length > 0 ||
                        r.acknowledgeDuplicate ||
                        (saveError &&
                          saveError.id === r.id &&
                          saveError.message
                            .toLowerCase()
                            .includes("duplicate"))) && (
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
                      {duplicatePlansFor(r).length > 0 && (
                        <BillMerge
                          row={{ ...r, duplicatePlans: duplicatePlansFor(r) }}
                          api={api}
                          disabled={busy}
                          readEdits={(form) =>
                            billPlanSubmission(
                              r,
                              new FormData(form),
                              month,
                              "review",
                            )
                          }
                          onMerged={async (targetId) => {
                            await reload();
                            setFormVersions((v) => ({
                              ...v,
                              [targetId]: (v[targetId] ?? 0) + 1,
                            }));
                            setAdvanceFrom(r.id);
                            setNotice(
                              "Duplicate merged. One confirmed bill remains.",
                            );
                          }}
                        />
                      )}
                      <div className="actions">
                        <button disabled={busy}>
                          {entryKind(r) === "transfer"
                            ? "Confirm transfer"
                            : "Confirm bill"}
                        </button>
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
          </div>
        </>
      )}
    </section>
  );
}
