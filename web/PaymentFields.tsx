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
  return (
    <details>
      <summary>Payment for {month} (monthly bills)</summary>
      <p>
        Enter the payment once you know it. Past months stay saved. An empty
        payment uses the planning estimate, or remains unknown.
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
        Known payment amount
        <input
          name="paymentAmount"
          inputMode="decimal"
          pattern="[0-9]+\.[0-9]{2}"
          defaultValue={payment?.amount ?? ""}
        />
      </label>
      <label>
        Actual posted payment (optional)
        <select
          name="actualTransactionKey"
          onChange={(e) => {
            const chosen = choices.find((t: any) => t.key === e.target.value);
            const form = e.currentTarget.form;
            if (!chosen || !form) return;
            const amount = form.elements.namedItem(
              "paymentAmount",
            ) as HTMLInputElement;
            const date = form.elements.namedItem(
              "paymentDate",
            ) as HTMLInputElement;
            if (!amount.value) amount.value = chosen.amount;
            if (!date.value && chosen.date.slice(0, 7) === month)
              date.value = chosen.date;
          }}
          defaultValue={payment?.actualTransactionKey ?? ""}
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
      <p>
        Shows the latest 2,000 posted outflows. For a card repayment, select the
        bank-account debit. The linked transaction supplies the actual amount;
        it does not alter the bank record. A payment date and known amount are
        required to save this cycle.
      </p>
      {row.payments?.length > 0 && (
        <details>
          <summary>Saved payment cycles ({row.payments.length})</summary>
          <ul>
            {row.payments.map((p: BillPayment) => (
              <li key={p.date}>
                {p.date} · {row.currency} {p.amount}
                {p.actualTransactionKey ? " · linked to posted payment" : ""}
              </li>
            ))}
          </ul>
        </details>
      )}
    </details>
  );
}
