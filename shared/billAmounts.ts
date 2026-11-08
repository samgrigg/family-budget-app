export type BillPayment = {
  date: string;
  amount: string;
  actualTransactionKey?: string;
};
export type AmountPlan = {
  amount: string;
  frequency: string;
  amountMode?: "fixed" | "variable";
  currency?: string;
  expenseType?: string;
  planningEstimate?: string;
  payments?: BillPayment[];
};
export const monthlyFactors: Record<string, number> = {
  Monthly: 1,
  Quarterly: 1 / 3,
  "Every six months": 1 / 6,
  Yearly: 1 / 12,
  Weekly: 52 / 12,
  "Every two weeks": 26 / 12,
};
export const validMonth = (value: unknown): value is string =>
  typeof value === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
export function resolveBillAmount(
  plan: AmountPlan,
  month: string,
  actuals = new Map<
    string,
    { amount: string; currency?: string; account_type?: string }
  >(),
) {
  const payment = plan.payments?.find((p) => p.date.slice(0, 7) === month);
  const candidate = payment?.actualTransactionKey
    ? actuals.get(payment.actualTransactionKey)
    : undefined;
  const actual =
    candidate &&
    (!plan.currency || candidate.currency === plan.currency) &&
    (plan.expenseType !== "creditPayment" ||
      candidate.account_type === "depository")
      ? candidate
      : undefined;
  const missingActual = !!payment?.actualTransactionKey && !actual;
  if (actual)
    return { amount: Number(actual.amount), basis: "actual", missingActual };
  if (payment)
    return { amount: Number(payment.amount), basis: "known", missingActual };
  if (plan.amountMode === "variable")
    return plan.planningEstimate
      ? {
          amount: Number(plan.planningEstimate),
          basis: "estimate",
          missingActual,
        }
      : { amount: null, basis: "unknown", missingActual };
  const factor = Object.hasOwn(monthlyFactors, plan.frequency)
    ? monthlyFactors[plan.frequency]
    : null;
  return {
    amount: factor === null ? null : Number(plan.amount) * factor,
    basis: factor === null ? "unknown" : "fixed",
    missingActual,
  };
}
