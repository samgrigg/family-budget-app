import type { ReviewLedger } from "../shared/paycheckReview";
import type { ReviewTransaction } from "../shared/reviewPurchases";
import { parseReviewMoney } from "../shared/reviewMoney";
export type PaycheckSuggestion = {
  amountMinor: number;
  sampleSize: number;
  minMinor: number;
  maxMinor: number;
  varies: boolean;
};
export function expectedPaycheck(
  l: ReviewLedger,
  transactions: ReviewTransaction[],
  sourceId: string,
  asOf: string,
): PaycheckSuggestion | null {
  const source = l.sources.find((s) => s.id === sourceId);
  if (!source) return null;
  const seen = new Set<string>();
  const amounts = l.paychecks
    .filter(
      (p) =>
        p.sourceId === sourceId &&
        p.state === "received" &&
        p.currency === "USD" &&
        p.date <= asOf,
    )
    .sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id))
    .filter((p) => {
      const t = transactions.find((t) => t.id === p.transactionId);
      if (
        !t ||
        seen.has(t.id) ||
        t.pending ||
        t.accountId !== source.accountId ||
        t.currency !== "USD" ||
        !t.amount.startsWith("-") ||
        t.date !== p.date
      )
        return false;
      try {
        if (
          parseReviewMoney(t.amount.slice(1)) !== p.amountMinor ||
          p.amountMinor === 0
        )
          return false;
      } catch {
        return false;
      }
      seen.add(t.id);
      return true;
    })
    .slice(0, 5)
    .map((p) => p.amountMinor)
    .sort((a, b) => a - b);
  if (!amounts.length) return null;
  const mid = Math.floor(amounts.length / 2),
    amountMinor =
      amounts.length % 2
        ? amounts[mid]
        : amounts[mid - 1] + Math.round((amounts[mid] - amounts[mid - 1]) / 2);
  return {
    amountMinor,
    sampleSize: amounts.length,
    minMinor: amounts[0],
    maxMinor: amounts.at(-1)!,
    varies: amounts.at(-1)! - amounts[0] > Math.floor(amountMinor / 10),
  };
}
