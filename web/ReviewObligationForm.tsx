import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import React from "react";
import type {
  ReviewLedger,
  Obligation,
  Paycheck,
} from "../shared/paycheckReview";
import { parseReviewMoney, formatReviewMoney } from "../shared/reviewMoney";
const field = (f: FormData, k: string) => String(f.get(k) ?? "");
const newId = () => `tmp:${crypto.randomUUID()}`;
export default function ReviewObligationForm({
  editing,
  ledger,
  selectedPaycheck,
  data,
  submit,
  patch,
  onDone,
}: {
  editing: Obligation | null;
  ledger: ReviewLedger;
  selectedPaycheck: Paycheck;
  data: any;
  submit: (
    e: React.FormEvent<HTMLFormElement>,
    fn: (f: FormData) => void,
  ) => void;
  patch: (
    collection: keyof Omit<ReviewLedger, "revision">,
    record: any,
  ) => void;
  onDone: () => void;
}) {
  return (
    <form
      id="review-obligation-form"
      key={editing?.id ?? "new"}
      onSubmit={(e) =>
        submit(e, (f) => {
          const amount = field(f, "amount");
          patch("obligations", {
            id: editing?.id ?? newId(),
            kind: field(f, "kind"),
            name: field(f, "name"),
            accountId: field(f, "account"),
            fundingSourceId:
              field(f, "kind") === "commitment"
                ? selectedPaycheck.sourceId
                : null,
            planId: field(f, "plan") || null,
            statementKey: field(f, "cycle") || null,
            amountMinor: amount ? parseReviewMoney(amount) : null,
            currency: "USD",
            dueDate: field(f, "due") || null,
            neededBy: field(f, "needed") || null,
            transactionIds: f.getAll("purchase").map(String),
            basis: "manual",
            confirmed: f.get("confirmed") === "on",
          });
          onDone();
        })
      }
    >
      <Label>
        Kind
        <select name="kind" defaultValue={editing?.kind ?? "commitment"}>
          <option value="commitment">
            Predictable commitment paid from cash
          </option>
          <option value="statement">Last credit card statement</option>
          <option value="unbilled">
            Purchases for next credit card statement
          </option>
        </select>
      </Label>
      <Label>
        Name
        <Input
          name="name"
          required
          maxLength={150}
          defaultValue={editing?.name}
        />
      </Label>
      <Label>
        Payment account or card
        <select
          name="account"
          defaultValue={
            editing?.accountId ??
            ledger.sources.find((s) => s.id === selectedPaycheck.sourceId)
              ?.accountId
          }
        >
          {data.evidence.accounts.map((a: any) => (
            <option key={a.id} value={a.id}>
              {a.name} · {a.type ?? "unknown"}
              {a.included ? "" : " · hidden"}
            </option>
          ))}
        </select>
      </Label>
      <Label>
        Existing commitment (optional)
        <select name="plan" defaultValue={editing?.planId ?? ""}>
          <option value="">Manual obligation</option>
          {data.evidence.plans.map((p: any) => (
            <option key={p.id} value={p.id}>
              {p.name} · {p.accountName} · {p.frequency} · day{" "}
              {p.day ?? "unknown"}
            </option>
          ))}
        </select>
      </Label>
      <p>
        Use planned commitments as a reference. Confirm the actual due amount
        and date; monthly estimates are not payment deadlines. Purchases paid by
        card belong in the card total, not here again.
      </p>
      <details>
        <summary>Assign imported card purchases and credits</summary>
        <p>
          Select only activity included in this obligation. Each transaction
          belongs to one card obligation. Include refunds only after confirming
          their meaning. Pending activity must be checked again when it posts.
        </p>
        {data.evidence.transactions
          .filter((t: any) =>
            data.evidence.accounts.some(
              (a: any) => a.id === t.accountId && a.type === "credit",
            ),
          )
          .map((t: any) => (
            <Label className="review-check" key={t.id}>
              <input
                type="checkbox"
                name="purchase"
                value={t.id}
                defaultChecked={editing?.transactionIds?.includes(t.id)}
                disabled={ledger.obligations.some(
                  (o) =>
                    o.id !== editing?.id && o.transactionIds?.includes(t.id),
                )}
              />
              {t.date} ·{" "}
              {
                data.evidence.accounts.find((a: any) => a.id === t.accountId)
                  ?.name
              }{" "}
              · {t.name} · ${t.amount}
              {t.pending ? " · pending" : ""}
            </Label>
          ))}
      </details>
      <Label>
        Card cycle label (unique per card)
        <Input
          name="cycle"
          placeholder="2026-11 statement"
          defaultValue={editing?.statementKey ?? ""}
        />
      </Label>
      <Label>
        Total amount before payments recorded in this review
        <Input
          name="amount"
          inputMode="decimal"
          defaultValue={
            editing?.amountMinor == null
              ? ""
              : formatReviewMoney(editing.amountMinor)
          }
        />
      </Label>
      <Label>
        Due date
        <Input name="due" type="date" defaultValue={editing?.dueDate ?? ""} />
      </Label>
      <Label>
        Funding needed by
        <Input
          name="needed"
          type="date"
          defaultValue={editing?.neededBy ?? ""}
        />
      </Label>
      <p>
        Allow time for your payment route. A later paycheck must arrive by this
        date to help.
      </p>
      <Label className="review-check">
        <input
          type="checkbox"
          name="confirmed"
          defaultChecked={editing?.confirmed}
        />
        I confirmed this amount, dates, and that it does not overlap another
        obligation.
      </Label>
      <Button>Apply obligation</Button>
      <Button type="button" variant="outline" onClick={onDone}>
        Cancel
      </Button>
    </form>
  );
}
