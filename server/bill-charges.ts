import {
  isCreditCardPayment,
  paymentTransactionKeys,
  type BillPayment,
} from "../shared/billAmounts";
import type { Plan } from "./bill-plan";
export const validChargeCount = (value: unknown): value is number =>
  Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 24;

// Normalize untrusted charge references to server-verified, recoverable snapshots.
export function normalizeChargeEvidence(
  payment: BillPayment,
  plan: Plan,
  retained: Plan[],
  actuals: Map<
    string,
    {
      amount: string;
      date: string;
      currency: string;
      account_type?: string;
      canonicalAccountId?: string;
    }
  >,
  used: Set<string>,
  claimed: Set<string>,
  transfers: Set<string>,
) {
  if (
    payment.expectedChargeCount !== undefined &&
    !validChargeCount(payment.expectedChargeCount)
  )
    throw Error("Choose 1–24 expected charges for each monthly payment.");
  if (payment.charges === undefined) return;
  if (
    !Array.isArray(payment.charges) ||
    payment.charges.length > 24 ||
    payment.actualTransactionKey
  )
    throw Error(
      "Use either a single posted payment or separate charges for a month.",
    );
  if (plan.kind !== "bill" || plan.frequency !== "Monthly")
    throw Error("Separate charges currently require a monthly bill.");
  payment.expectedChargeCount ??= plan.expectedChargeCount ?? 1;
  payment.charges = payment.charges.map((charge) => {
    if (
      !charge ||
      typeof charge.key !== "string" ||
      !charge.key ||
      typeof charge.label !== "string" ||
      charge.label.length > 120
    )
      throw Error(
        "Each charge needs a transaction and an optional label of at most 120 characters.",
      );
    if (used.has(charge.key))
      throw Error("A posted payment can only be linked once.");
    if (claimed.has(charge.key))
      throw Error("That posted payment is already linked to another bill.");
    used.add(charge.key);
    const t = actuals.get(charge.key);
    if (
      t &&
      (t.currency !== plan.currency ||
        t.date.slice(0, 7) !== payment.date.slice(0, 7) ||
        (isCreditCardPayment(plan.expenseType) &&
          t.account_type !== "depository") ||
        (plan.creditAccountId && t.canonicalAccountId === plan.creditAccountId))
    )
      throw Error(
        "Choose a posted outgoing charge in this month and currency. Card repayments must come from a bank account.",
      );
    if (
      t &&
      transfers.has(charge.key) &&
      !isCreditCardPayment(plan.expenseType)
    )
      throw Error(
        "That transaction is a confirmed account transfer, not a bill charge.",
      );
    const previous = retained
      .flatMap((r) => r.payments ?? [])
      .find(
        (p) =>
          p.date.slice(0, 7) === payment.date.slice(0, 7) &&
          p.charges?.some(
            (c) =>
              c.key === charge.key &&
              c.amount === charge.amount &&
              c.date === charge.date,
          ),
      );
    const old = previous?.charges?.find((c) => c.key === charge.key);
    if (!t && !old)
      throw Error(
        "That charge is unavailable. Choose a posted transaction from your stored history.",
      );
    return {
      key: charge.key,
      label: charge.label.trim(),
      amount: t?.amount ?? old!.amount,
      date: t?.date ?? old!.date,
    };
  });
}
export const claimedPaymentKeys = (plans: Plan[], id: string) =>
  new Set(
    plans
      .filter((p) => p.id !== id && p.status !== "excluded")
      .flatMap((p) => (p.payments ?? []).flatMap(paymentTransactionKeys)),
  );
