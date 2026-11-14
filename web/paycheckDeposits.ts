import type { ReviewLedger } from "../shared/paycheckReview";
import type { ReviewTransaction } from "../shared/reviewPurchases";
export function paycheckDeposits(
  l: ReviewLedger,
  transactions: ReviewTransaction[],
  sourceId: string,
  currentPaycheckId?: string,
) {
  const source = l.sources.find((s) => s.id === sourceId);
  if (!source) return [];
  return transactions.filter(
    (t) =>
      t.accountId === source.accountId &&
      !t.pending &&
      t.currency === "USD" &&
      t.amount.startsWith("-") &&
      Number(t.amount) < 0 &&
      !l.paychecks.some(
        (p) => p.id !== currentPaycheckId && p.transactionId === t.id,
      ),
  );
}
