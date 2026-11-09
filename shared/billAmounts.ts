export const isCreditCardPayment = (type: unknown) =>
  type === "creditPayment" || type === "creditDebtPayoff";
export type BillCharge = {
  key: string;
  label: string;
  amount: string;
  date: string;
};
export type BillPayment = {
  expectedChargeCount?: number;
  charges?: BillCharge[];
  date: string;
  amount: string;
  actualTransactionKey?: string;
};
export type AmountPlan = {
  expectedChargeCount?: number;
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
export function paymentTransactionKeys(payment: BillPayment): string[] {
  return [
    ...(payment.actualTransactionKey ? [payment.actualTransactionKey] : []),
    ...(payment.charges ?? []).map((c) => c.key),
  ];
}
export function resolveBillAmount(
  plan: AmountPlan,
  month: string,
  actuals = new Map<
    string,
    { amount: string; currency?: string; account_type?: string }
  >(),
) {
  const payment = plan.payments?.find((p) => p.date.slice(0, 7) === month);
  const expectedCharges =
    payment?.expectedChargeCount ?? plan.expectedChargeCount ?? 1;
  const charges = payment?.charges ?? [];
  const usable = (
    candidate:
      { amount: string; currency?: string; account_type?: string } | undefined,
  ) =>
    candidate &&
    (!plan.currency || candidate.currency === plan.currency) &&
    (!isCreditCardPayment(plan.expenseType) ||
      candidate.account_type === "depository")
      ? candidate
      : undefined;
  const matched = charges.map((c) => usable(actuals.get(c.key)));
  const progress =
    expectedCharges > 1 || charges.length
      ? {
          expectedCharges,
          linkedCharges: charges.length,
          matchedCharges: matched.filter(Boolean).length,
          chargeAmount: matched.reduce(
            (sum, t) => sum + (t ? Number(t.amount) : 0),
            0,
          ),
        }
      : {};
  const missingCharge = matched.some((t) => !t);
  if (charges.length >= expectedCharges && charges.length > 0) {
    const cents = charges.reduce(
      (sum, c, i) =>
        sum + Math.round(Number(matched[i]?.amount ?? c.amount) * 100),
      0,
    );
    return {
      amount: cents / 100,
      basis: missingCharge ? "known" : "actual",
      usingChargeSnapshots: missingCharge,
      missingActual: missingCharge,
      ...progress,
    };
  }
  const candidate = payment?.actualTransactionKey
    ? actuals.get(payment.actualTransactionKey)
    : undefined;
  const actual =
    candidate &&
    (!plan.currency || candidate.currency === plan.currency) &&
    (!isCreditCardPayment(plan.expenseType) ||
      candidate.account_type === "depository")
      ? candidate
      : undefined;
  const missingActual =
    missingCharge || (!!payment?.actualTransactionKey && !actual);
  if (actual)
    return {
      amount: Number(actual.amount),
      basis: "actual",
      missingActual,
      ...progress,
    };
  if (payment)
    return {
      amount: Number(payment.amount),
      basis: "known",
      missingActual,
      ...progress,
    };
  if (plan.amountMode === "variable")
    return plan.planningEstimate
      ? {
          amount: Number(plan.planningEstimate),
          basis: "estimate",
          missingActual,
          ...progress,
        }
      : { amount: null, basis: "unknown", missingActual, ...progress };
  const factor = Object.hasOwn(monthlyFactors, plan.frequency)
    ? monthlyFactors[plan.frequency]
    : null;
  return {
    amount: factor === null ? null : Number(plan.amount) * factor,
    basis: factor === null ? "unknown" : "fixed",
    missingActual,
    ...progress,
  };
}
