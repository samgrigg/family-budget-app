import { useEffect, useRef, useState } from "react";
const fields = [
  ["name", "Name"],
  ["kind", "Entry type"],
  ["accountName", "Payment account"],
  ["amountMode", "Amount certainty"],
  ["amount", "Fixed amount"],
  ["currency", "Currency"],
  ["frequency", "Frequency"],
  ["day", "Payment day"],
  ["expectedChargeCount", "Expected charges per month"],
  ["planningEstimate", "Planning estimate"],
  ["expenseType", "Counts as"],
  ["creditAccountId", "Card account"],
] as const;
const label = (value: any) =>
  value === "bill"
    ? "Bill commitment"
    : value === "transfer"
      ? "Auto-transfer"
      : value === "creditDebtPayoff"
        ? "Credit card debt payoff"
        : value === "creditPayment"
          ? "Credit card purchases"
          : value === "Quarterly"
            ? "Every 3 months"
            : value === undefined || value === null || value === ""
              ? "Not specified"
              : String(value);
export default function BillMerge({
  row,
  api,
  readEdits,
  onMerged,
  disabled,
}: {
  row: any;
  api: (path: string, body?: any) => Promise<any>;
  readEdits: (form: HTMLFormElement) => any;
  onMerged: (targetId: string) => Promise<void>;
  disabled: boolean;
}) {
  const [targetId, setTargetId] = useState(row.duplicatePlans[0]?.id ?? ""),
    [preview, setPreview] = useState<any>(null),
    [request, setRequest] = useState<any>(null),
    [prefer, setPrefer] = useState("target"),
    [cycles, setCycles] = useState<Record<string, string>>({}),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!row.duplicatePlans.some((p: any) => p.id === targetId)) {
      setTargetId(row.duplicatePlans[0]?.id ?? "");
      setPreview(null);
    }
  }, [row.duplicatePlans, targetId]);
  const heading = useRef<HTMLHeadingElement>(null),
    message = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (preview) heading.current?.focus();
  }, [preview]);
  useEffect(() => {
    if (error) message.current?.focus();
  }, [error]);
  async function review(form: HTMLFormElement) {
    setBusy(true);
    setError("");
    setPreview(null);
    try {
      const body = { sourceId: row.id, targetId, sourceEdits: readEdits(form) };
      const result = await api("/bill-plan/merge/preview", body);
      setRequest(body);
      setPreview(result);
      setPrefer("target");
      setCycles({});
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function merge(form: HTMLFormElement) {
    setBusy(true);
    setError("");
    try {
      if (
        JSON.stringify(readEdits(form)) !== JSON.stringify(request.sourceEdits)
      ) {
        setPreview(null);
        throw Error("Bill details changed. Review the merge again.");
      }
      const result = await api("/bill-plan/merge", {
        ...request,
        version: preview.version,
        prefer,
        cycleChoices: cycles,
      });
      await onMerged(result.targetId);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="merge-review" aria-label="Merge duplicate bill">
      <p>Same bill? Merge it into the confirmed entry so it counts once.</p>
      <label>
        Existing bill to keep
        <select
          value={targetId}
          onChange={(e) => {
            setTargetId(e.target.value);
            setPreview(null);
          }}
        >
          {row.duplicatePlans.map((p: any) => (
            <option key={p.id} value={p.id}>
              {p.name} · {p.accountName}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        className="secondary"
        disabled={disabled || busy || !targetId}
        onClick={(e) => void review(e.currentTarget.form!)}
      >
        Yes, this is a duplicate — review merge
      </button>
      {error && (
        <p role="alert" tabIndex={-1} ref={message} className="error">
          {error}
        </p>
      )}
      {preview && (
        <>
          <h3 tabIndex={-1} ref={heading}>
            Merge into {preview.target.name}
          </h3>
          <p>
            One confirmed bill will remain. Notes and worksheet references from
            both entries will be retained.{" "}
            {preview.source.kind === "transfer"
              ? "The bill's payment history stays unchanged; transfer payment records are retained in merge history."
              : "Compatible payment cycles will be combined."}{" "}
            The duplicate will disappear and will not return on worksheet
            re-import.
          </p>
          <details>
            <summary>Compare bill details</summary>
            <dl>
              {fields
                .filter(
                  ([key]) =>
                    String(preview.source[key] ?? "") !==
                    String(preview.target[key] ?? ""),
                )
                .map(([key, title]) => (
                  <div key={key}>
                    <dt>
                      <strong>{title}</strong>
                    </dt>
                    <dd>
                      Existing bill:{" "}
                      {key === "creditAccountId"
                        ? preview.targetCardName
                        : label(preview.target[key])}
                    </dd>
                    <dd>
                      This entry:{" "}
                      {key === "creditAccountId"
                        ? preview.sourceCardName
                        : label(preview.source[key])}
                    </dd>
                  </div>
                ))}
            </dl>
          </details>
          {preview.source.kind === "transfer" && (
            <p>
              This entry is an auto-transfer instruction. The existing bill's
              amount, payment account, schedule and payment history will be
              kept. Transfer notes and worksheet references will be retained;
              transfer payment records stay in merge history. Bank transactions
              are unchanged.
            </p>
          )}
          <label>
            Bill details to keep
            <select value={prefer} onChange={(e) => setPrefer(e.target.value)}>
              <option value="target">Keep existing bill's details</option>
              <option
                value="source"
                disabled={preview.source.kind === "transfer"}
              >
                Use this entry's details
              </option>
            </select>
          </label>
          {preview.conflictingMonths.map((month: string) => {
            const source = preview.source.payments.find((p: any) =>
                p.date.startsWith(month),
              ),
              target = preview.target.payments.find((p: any) =>
                p.date.startsWith(month),
              );
            return (
              <label key={month}>
                Payment to keep for {month}
                <select
                  value={cycles[month] ?? ""}
                  onChange={(e) =>
                    setCycles({ ...cycles, [month]: e.target.value })
                  }
                >
                  <option value="">Choose a payment</option>
                  <option value="target">
                    Existing: {target.date} · {preview.target.currency}{" "}
                    {target.amount}
                    {target.charges
                      ? ` · ${target.charges.length} linked charges / ${target.expectedChargeCount ?? 1} expected`
                      : ""}
                    {target.actualTransactionKey
                      ? " · posted evidence linked"
                      : ""}
                  </option>
                  <option value="source">
                    This entry: {source.date} · {preview.source.currency}{" "}
                    {source.amount}
                    {source.charges
                      ? ` · ${source.charges.length} linked charges / ${source.expectedChargeCount ?? 1} expected`
                      : ""}
                    {source.actualTransactionKey
                      ? " · posted evidence linked"
                      : ""}
                  </option>
                </select>
              </label>
            );
          })}
          <p>
            Different monthly payment records need a choice, including their
            linked charges. The chosen record keeps all its charge evidence. A
            record of the original entries is retained for recovery.
          </p>
          <div className="actions">
            <button
              type="button"
              disabled={disabled || busy}
              onClick={(e) => void merge(e.currentTarget.form!)}
            >
              Merge bills
            </button>
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() => setPreview(null)}
            >
              Cancel merge
            </button>
          </div>
        </>
      )}
    </section>
  );
}
