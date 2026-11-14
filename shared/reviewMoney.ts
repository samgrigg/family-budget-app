export function parseReviewMoney(value: string): number {
  const m = /^(0|[1-9]\d*)(?:\.(\d{1,2}))?$/.exec(value);
  if (!m) throw Error("Enter a nonnegative amount with at most two decimals.");
  const n = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
  if (!Number.isSafeInteger(n)) throw Error("Amount is too large.");
  return n;
}
export function formatReviewMoney(n: number): string {
  if (!Number.isSafeInteger(n) || n < 0) throw Error("Invalid money amount.");
  return `${Math.floor(n / 100)}.${String(n % 100).padStart(2, "0")}`;
}
