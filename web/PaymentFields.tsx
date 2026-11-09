import { useEffect, useRef, useState } from "react";
import GroupedChargeFields from "./GroupedChargeFields";
import { isCreditCardPayment } from "../shared/billAmounts";
import type { BillPayment } from "../shared/billAmounts";
export default function PaymentFields({
  row,
  month,
  data,
}: {
  row: any;
  month: string;
  data: any;
}) {
  const payment: BillPayment | undefined = row.payments?.find(
    (p: BillPayment) => p.date.slice(0, 7) === month,
  );
  const choices = data.paymentOptions.filter(
    (t: any) => t.currency === row.currency,
  );
  const [expectedCount, setExpectedCount] = useState(
    String(payment?.expectedChargeCount ?? row.expectedChargeCount ?? 1),
  );
  const [multiMode, setMultiMode] = useState(
    payment?.charges !== undefined || Number(expectedCount) > 1,
  );
  const [singleKey, setSingleKey] = useState(
    payment?.actualTransactionKey ?? "",
  );
  const [chargeRows, setChargeRows] = useState(() =>
    (
      payment?.charges ?? [
        { key: payment?.actualTransactionKey ?? "", label: "" },
      ]
    ).map((c, i) => ({ id: i + 1, key: c.key, label: c.label })),
  );
  const fullPlanAmount =
    row.amountMode === "variable" ? row.planningEstimate : row.amount;
  const [monthlyAmount, setMonthlyAmount] = useState(
    payment?.amount ?? (multiMode ? (fullPlanAmount ?? "") : ""),
  );
  const amountEdited = useRef(!!payment && !payment.actualTransactionKey);
  const expectedInput = useRef<HTMLInputElement>(null);
  const currentPlanAmount = (form: HTMLFormElement | null) => {
    if (!form) return fullPlanAmount ?? "";
    const value = (name: string) =>
      (form.elements.namedItem(name) as HTMLInputElement | null)?.value;
    return (
      (value("amountMode") === "variable"
        ? value("planningEstimate")
        : value("amount")) ?? ""
    );
  };
  const grouped = multiMode || Number(expectedCount) > 1;
  useEffect(() => {
    const form = expectedInput.current?.form;
    if (!form || !grouped) return;
    const update = (event: Event) => {
      if (
        !amountEdited.current &&
        ["amount", "amountMode", "planningEstimate"].includes(
          (event.target as HTMLInputElement).name,
        )
      )
        setMonthlyAmount(currentPlanAmount(form));
    };
    form.addEventListener("input", update);
    form.addEventListener("change", update);
    return () => {
      form.removeEventListener("input", update);
      form.removeEventListener("change", update);
    };
  }, [grouped]);
  const groupedChoices = choices.filter(
    (t: any) =>
      t.date.slice(0, 7) === month &&
      (!isCreditCardPayment(row.expenseType) || t.accountType === "depository"),
  );
  return (
    <>
      <label>
        Expected charges per month
        <input
          ref={expectedInput}
          name="expectedChargeCount"
          type="number"
          min="1"
          max="24"
          step="1"
          required
          value={expectedCount}
          onChange={(e) => {
            const value = e.target.value;
            setExpectedCount(value);
            if (Number(value) > 1 && !multiMode) {
              setMultiMode(true);
              if (singleKey)
                setChargeRows([{ id: 1, key: singleKey, label: "" }]);
              if (!amountEdited.current)
                setMonthlyAmount(currentPlanAmount(e.currentTarget.form));
            }
          }}
        />
      </label>
      <p>
        Use one commitment for several memberships. The planned amount covers
        all charges together. Multiple charges currently require monthly
        frequency.
      </p>
      <details>
        <summary>Payment for {month} (monthly bills)</summary>
        <p>
          {grouped
            ? "Enter the full monthly amount for this commitment, then link its separate charges. Partial evidence keeps that full amount; once all expected charges are linked, their combined actual amount is used."
            : "Enter the payment once you know it. Past months stay saved. An empty payment uses the planning estimate, or remains unknown."}
        </p>
        <label>
          Payment date
          <input
            type="date"
            name="paymentDate"
            min={`${month}-01`}
            max={`${month}-${new Date(Number(month.slice(0, 4)), Number(month.slice(5)), 0).getDate()}`}
            defaultValue={payment?.date ?? ""}
          />
        </label>
        <label>
          {grouped
            ? "Full monthly amount (all charges)"
            : "Known payment amount"}
          <input
            name="paymentAmount"
            inputMode="decimal"
            pattern="[0-9]+\.[0-9]{2}"
            value={monthlyAmount}
            onChange={(e) => {
              amountEdited.current = true;
              setMonthlyAmount(e.target.value);
            }}
          />
        </label>
        <GroupedChargeFields
          rows={chargeRows}
          setRows={setChargeRows}
          choices={groupedChoices}
          enabled={grouped}
        />
        <label hidden={grouped}>
          Actual posted payment (optional)
          <select
            name="actualTransactionKey"
            disabled={grouped}
            value={singleKey}
            onChange={(e) => {
              setSingleKey(e.target.value);
              const chosen = choices.find((t: any) => t.key === e.target.value);
              const form = e.currentTarget.form;
              if (!chosen || !form) return;
              const amount = form.elements.namedItem(
                "paymentAmount",
              ) as HTMLInputElement;
              const date = form.elements.namedItem(
                "paymentDate",
              ) as HTMLInputElement;
              if (!amount.value) setMonthlyAmount(chosen.amount);
              if (!date.value && chosen.date.slice(0, 7) === month)
                date.value = chosen.date;
            }}
          >
            <option value="">Not linked to a transaction</option>
            {payment?.actualTransactionKey &&
              !choices.some(
                (t: any) => t.key === payment.actualTransactionKey,
              ) && (
                <option value={payment.actualTransactionKey}>
                  Previously linked payment · evidence unavailable
                </option>
              )}
            {choices.map((t: any) => (
              <option key={t.key} value={t.key}>
                {t.date} · {t.accountName} · {t.name} · {t.currency} {t.amount}
              </option>
            ))}
          </select>
        </label>
        <p hidden={grouped}>
          Shows the latest 2,000 posted outflows. For a card repayment, select
          the bank-account debit. The linked transaction supplies the actual
          amount; it does not alter the bank record. A payment date and known
          amount are required to save this cycle.
        </p>
        {row.payments?.length > 0 && (
          <details>
            <summary>Saved payment cycles ({row.payments.length})</summary>
            <ul>
              {row.payments.map((p: BillPayment) => (
                <li key={p.date}>
                  {p.date} · {row.currency} {p.amount}
                  {p.actualTransactionKey ? " · linked to posted payment" : ""}
                  {p.charges
                    ? ` · ${p.charges.length} linked charges / ${p.expectedChargeCount ?? row.expectedChargeCount ?? 1} expected`
                    : ""}
                  {p.charges?.some((c) => c.label) && (
                    <ul>
                      {p.charges.map((c) => (
                        <li key={c.key}>
                          {c.label || "Unlabeled charge"} · {c.date} ·{" "}
                          {row.currency} {c.amount}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          </details>
        )}
      </details>
    </>
  );
}
