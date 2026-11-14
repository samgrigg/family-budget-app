import type { ReviewLedger } from "./paycheckReview";
export interface ReviewTransaction {
  id: string;
  name: string;
  accountId: string;
  amount: string;
  date: string;
  pending: boolean;
  currency: string;
}
export function unassignedPurchases(
  l: ReviewLedger,
  transactions: ReviewTransaction[],
  accounts: { id: string; type: string | null }[],
) {
  const start = l.paychecks
    .filter((p) => p.state === "received")
    .map((p) => p.date)
    .sort()[0];
  if (!start) return [];
  const assigned = new Set(
    l.obligations.flatMap((o) => o.transactionIds ?? []),
  );
  return transactions.filter(
    (t) =>
      t.date >= start &&
      !t.amount.startsWith("-") &&
      Number(t.amount) > 0 &&
      accounts.some((a) => a.id === t.accountId && a.type === "credit") &&
      !assigned.has(t.id),
  );
}
export function unassignedCashDebits(
  l: ReviewLedger,
  transactions: ReviewTransaction[],
) {
  const assigned = new Set(
    l.settlements.filter((s) => s.confirmed).flatMap((s) => s.transactionIds),
  );
  return transactions
    .filter(
      (t) =>
        !t.pending &&
        !t.amount.startsWith("-") &&
        Number(t.amount) > 0 &&
        !assigned.has(t.id),
    )
    .flatMap((t) => {
      const p = l.paychecks
        .filter(
          (p) =>
            p.state === "received" &&
            p.date <= t.date &&
            l.sources.some(
              (s) => s.id === p.sourceId && s.accountId === t.accountId,
            ),
        )
        .sort((a, b) => b.date.localeCompare(a.date))[0];
      return p ? [{ ...t, paycheckId: p.id }] : [];
    });
}
