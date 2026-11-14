export type CommitmentSortKey =
  "name" | "amount" | "accountName" | "day" | "frequency";
export type CommitmentSort = {
  key: CommitmentSortKey;
  direction: "ascending" | "descending";
};
export const commitmentColumns: { key: CommitmentSortKey; label: string }[] = [
  { key: "name", label: "Commitment" },
  { key: "amount", label: "Amount" },
  { key: "accountName", label: "Payment account" },
  { key: "day", label: "Day of month" },
  { key: "frequency", label: "Frequency" },
];
const frequencies = [
  "Weekly",
  "Every two weeks",
  "Monthly",
  "Quarterly",
  "Every six months",
  "Yearly",
];
const text = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
type SortableCommitment = {
  name?: string;
  currency?: string;
  accountName?: string;
  day?: number | null;
  frequency?: string;
  resolvedAmount?: { amount: number | null };
};
export function sortCommitments<T extends SortableCommitment>(
  records: T[],
  sort: CommitmentSort | null,
): T[] {
  if (!sort) return [...records];
  const value = (record: T): string | number | null => {
    switch (sort.key) {
      case "day":
        return Number.isInteger(record.day) &&
          record.day! >= 1 &&
          record.day! <= 31
          ? record.day!
          : null;
      case "amount":
        return typeof record.resolvedAmount?.amount === "number" &&
          Number.isFinite(record.resolvedAmount.amount)
          ? record.resolvedAmount.amount
          : null;
      case "frequency": {
        const index = frequencies.indexOf(record.frequency || "");
        return index < 0 ? null : index;
      }
      default:
        return record[sort.key]?.trim() || null;
    }
  };
  const direction = sort.direction === "ascending" ? 1 : -1;
  return [...records].sort((a, b) => {
    const left = value(a),
      right = value(b);
    if (left === null || right === null)
      return left === right ? 0 : left === null ? 1 : -1;
    // Different currencies are grouped, never treated as equivalent money.
    if (sort.key === "amount") {
      const currency = text.compare(a.currency || "", b.currency || "");
      if (currency) return currency;
    }
    return (
      (typeof left === "number" && typeof right === "number"
        ? left - right
        : text.compare(String(left), String(right))) * direction
    );
  });
}
