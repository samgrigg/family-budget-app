import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import React from "react";
import type { Obligation, ReviewLedger } from "../shared/paycheckReview";
import { reviewMoney } from "./ReviewSummary";
export type ReviewSectionsProps = {
  ledger: ReviewLedger;
  paycheckId: string;
  accounts: any[];
  onEdit: (o: Obligation) => void;
  onRemove: (id: string) => void;
  onReserve: (id: string, paycheckId: string, amount: string) => void;
  onSettle: (id: string, txId: string) => void;
  transactions: any[];
};
export function ObligationRow({
  o,
  props,
}: {
  o: Obligation;
  props: ReviewSectionsProps;
}) {
  const {
    ledger,
    paycheckId,
    accounts,
    transactions,
    onEdit,
    onRemove,
    onReserve,
    onSettle,
  } = props;
  const paid = ledger.settlements
    .filter((s) => s.obligationId === o.id && s.confirmed)
    .reduce((n, s) => n + s.amountMinor, 0);
  const p = ledger.paychecks.find((p) => p.id === paycheckId)!;
  const a = ledger.sources.find((s) => s.id === p.sourceId)?.accountId;
  const choices = transactions.filter(
    (t) =>
      !t.pending &&
      t.accountId === a &&
      !t.amount.startsWith("-") &&
      t.currency === "USD" &&
      !ledger.settlements.some((s) => s.transactionIds.includes(t.id)),
  );
  return (
    <article className="bill">
      <h3>{o.name}</h3>
      <p>
        {o.kind === "statement"
          ? "Last statement"
          : o.kind === "unbilled"
            ? "Purchases for a later statement"
            : "Predictable commitment"}{" "}
        · {reviewMoney(o.amountMinor)} · Paid {reviewMoney(paid)}
      </p>
      <p>
        Due {o.dueDate ?? "unknown"} · Funding needed by{" "}
        {o.neededBy ?? "unknown"} ·{" "}
        {accounts.find((a) => a.id === o.accountId)?.name ??
          "Account unavailable"}
      </p>
      {!o.confirmed && <p>Needs confirmation</p>}
      <ul>
        {ledger.contributions
          .filter((c) => c.obligationId === o.id)
          .map((c) => {
            const pay = ledger.paychecks.find((p) => p.id === c.paycheckId);
            return (
              <li key={c.id}>
                {ledger.sources.find((s) => s.id === pay?.sourceId)?.name} ·{" "}
                {pay?.date} ·{" "}
                {pay?.state === "expected"
                  ? "Future paycheck"
                  : "Received paycheck"}
                : {reviewMoney(c.amountMinor)}
              </li>
            );
          })}
      </ul>
      <form
        className="review-form"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          onReserve(o.id, String(f.get("paycheck")), String(f.get("amount")));
        }}
      >
        <Label>
          Fund from
          <select name="paycheck" defaultValue={paycheckId}>
            {ledger.paychecks.map((p) => (
              <option key={p.id} value={p.id}>
                {ledger.sources.find((s) => s.id === p.sourceId)?.name} ·{" "}
                {p.date} · {p.state === "expected" ? "future" : "received"}
              </option>
            ))}
          </select>
        </Label>
        <Label>
          Reservation amount
          <Input
            name="amount"
            inputMode="decimal"
            placeholder="0.00"
            required
          />
        </Label>
        <Button type="submit" variant="outline">
          Set reservation
        </Button>
      </form>
      <p>
        Sets this paycheck’s total reservation for this obligation. Enter zero
        to release it. Future funding is a forecast, never safe cash.
      </p>
      <details>
        <summary>Payment and corrections</summary>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSettle(
              o.id,
              String(new FormData(e.currentTarget).get("transaction")),
            );
          }}
        >
          <Label>
            Posted payment from this paycheck account
            <select name="transaction" required>
              <option value="">Choose a debit</option>
              {choices.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.date} · {t.name} · ${t.amount}
                </option>
              ))}
            </select>
          </Label>
          <Button type="submit">Record payment</Button>
        </form>
        <div className="actions">
          <Button type="button" variant="outline" onClick={() => onEdit(o)}>
            Edit obligation
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => onRemove(o.id)}
          >
            Remove obligation
          </Button>
        </div>
      </details>
    </article>
  );
}
export default function ReviewCommitments(props: ReviewSectionsProps) {
  const p = props.ledger.paychecks.find((p) => p.id === props.paycheckId)!;
  const rows = props.ledger.obligations.filter(
    (o) =>
      o.kind === "commitment" &&
      o.fundingSourceId === p.sourceId &&
      (!o.dueDate || o.dueDate <= p.nextPayday),
  );
  return (
    <section className="panel">
      <h2>Before your next paycheck</h2>
      <p>
        Fund these commitments first. Include unpaid overdue items and payments
        due on payday unless deposit timing is certain.
      </p>
      {rows.length ? (
        rows.map((o) => <ObligationRow key={o.id} o={o} props={props} />)
      ) : (
        <p>No commitments entered for this review.</p>
      )}
    </section>
  );
}
