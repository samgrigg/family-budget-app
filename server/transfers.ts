import { createHash } from "node:crypto";
import type { Store } from "./store";
export const transactionKey = (t: any) => JSON.stringify([t.connection, t.id]);
const signal = (name: string) =>
  /\b(transfer|xfer|payment|pmt|autopay)\b/i.test(name);
export function transferCandidates(rows: any[]) {
  const valid = rows.filter(
    (t) =>
      !t.pending &&
      t.account_type === "depository" &&
      t.currency &&
      Number.isFinite(Number(t.amount)) &&
      Number(t.amount) !== 0,
  );
  const incoming = new Map<string, any[]>();
  const bucket = (t: any) =>
    JSON.stringify([t.currency, String(Math.abs(Number(t.amount)))]);
  for (const t of valid.filter((t) => Number(t.amount) < 0))
    incoming.set(bucket(t), [...(incoming.get(bucket(t)) ?? []), t]);
  const pairs: any[] = [];
  for (const out of valid.filter((t) => Number(t.amount) > 0))
    for (const into of incoming.get(bucket(out)) ?? []) {
      if (out.connection === into.connection && out.account === into.account)
        continue;
      const days =
        Math.abs(Date.parse(out.date) - Date.parse(into.date)) / 86400000;
      if (!Number.isFinite(days) || days > 5) continue;
      // Include the evidence in the key so changed provider data invalidates old decisions.
      const key = createHash("sha256")
        .update(JSON.stringify([out, into]))
        .digest("hex");
      pairs.push({
        key,
        out,
        into,
        days,
        supported: signal(out.name) && signal(into.name),
      });
    }
  const counts = new Map<string, number>();
  for (const p of pairs)
    for (const t of [p.out, p.into])
      counts.set(transactionKey(t), (counts.get(transactionKey(t)) ?? 0) + 1);
  return pairs.map((p) => ({
    ...p,
    strong:
      p.supported &&
      p.days <= 3 &&
      [p.out, p.into].every((t) => counts.get(transactionKey(t)) === 1),
  }));
}
export function transferState(store: Store) {
  store.db.exec(
    "CREATE TABLE IF NOT EXISTS transfer_decisions(env TEXT,key TEXT,status TEXT,PRIMARY KEY(env,key))",
  );
  const rows = store.db
    .prepare(
      "SELECT t.id,t.connection,t.account,t.date,t.name,t.amount,t.currency,t.pending,at.type AS account_type FROM transactions t JOIN accounts a ON a.env=t.env AND a.connection=t.connection AND a.id=t.account LEFT JOIN account_types at ON at.env=t.env AND at.connection=t.connection AND at.account=t.account WHERE t.env=? ORDER BY t.connection,t.id",
    )
    .all(store.env);
  const decisions = new Map(
    (
      store.db
        .prepare("SELECT key,status FROM transfer_decisions WHERE env=?")
        .all(store.env) as any[]
    ).map((d) => [d.key, d.status]),
  );
  const pairs = transferCandidates(rows);
  const used = new Set<string>();
  const confirmed: any[] = [];
  const review: any[] = [];
  const rejected: any[] = [];
  // Explicit confirmations have priority over automatic classifications.
  for (const p of [...pairs].sort(
    (a, b) =>
      Number(decisions.get(b.key) === "confirmed") -
      Number(decisions.get(a.key) === "confirmed"),
  )) {
    const status = decisions.get(p.key);
    const occupied = [p.out, p.into].some((t) => used.has(transactionKey(t)));
    if (!occupied && (status === "confirmed" || (!status && p.strong))) {
      confirmed.push({ ...p, automatic: status !== "confirmed" });
      for (const t of [p.out, p.into]) used.add(transactionKey(t));
    } else if (status === "rejected") rejected.push(p);
    else review.push(p);
  }
  return {
    confirmed,
    review: review.filter(
      (p) => ![p.out, p.into].some((t) => used.has(transactionKey(t))),
    ),
    rejected,
  };
}
export function confirmedTransactionKeys(store: Store) {
  return new Set(
    transferState(store).confirmed.flatMap((p) => [
      transactionKey(p.out),
      transactionKey(p.into),
    ]),
  );
}
