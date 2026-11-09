import { confirmedTransactionKeys, transactionKey } from "./transfers";
import { createHash } from "node:crypto";
import type { Store } from "./store";
export type Entry = {
  id: string;
  connection: string;
  account: string;
  date: string;
  name: string;
  amount: string;
  currency: string;
  pending: number;
  canonicalAccountId?: string;
  canonicalTransactionId?: string;
};
export function payee(name: string) {
  return name
    .toLowerCase()
    .replace(/\b\d{4,}\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
export function groupKey(t: Entry) {
  return createHash("sha256")
    .update(
      JSON.stringify(
        t.canonicalAccountId
          ? [t.canonicalAccountId, t.currency, payee(t.name)]
          : [t.connection, t.account, t.currency, payee(t.name)],
      ),
    )
    .digest("hex");
}
export function summarize(rows: Entry[]) {
  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));
  const amounts = sorted.map((t) => Number(t.amount)).sort((a, b) => a - b);
  const gaps = sorted
    .slice(1)
    .map(
      (t, i) => (Date.parse(t.date) - Date.parse(sorted[i].date)) / 86400000,
    );
  const periods: [[string, number], ...Array<[string, number]>] = [
    ["Weekly", 7],
    ["Every two weeks", 14],
    ["Monthly", 30.44],
    ["Quarterly", 91.31],
    ["Every six months", 182.62],
    ["Yearly", 365.25],
  ];
  const fit = periods
    .map(([label, days]) => ({
      label,
      score:
        gaps.filter((g) => Math.abs(g - days) <= Math.max(3, days * 0.15))
          .length / Math.max(1, gaps.length),
    }))
    .sort((a, b) => b.score - a.score)[0];
  return {
    frequency: fit.score >= 0.6 ? fit.label : "Irregular",
    confidence:
      fit.score >= 0.8 && rows.length >= 3 ? "Stronger pattern" : "Tentative",
    typical: amounts[Math.floor(amounts.length / 2)] ?? null,
    min: amounts[0] ?? null,
    max: amounts.at(-1) ?? null,
    regular: fit.score >= 0.6,
    transactions: sorted,
  };
}
export function candidates(rows: Entry[]) {
  const groups = new Map<string, Entry[]>();
  for (const t of rows) {
    if (
      t.pending ||
      !Number.isFinite(Number(t.amount)) ||
      Number(t.amount) <= 0 ||
      /\b(transfer)\b/i.test(t.name)
    )
      continue;
    const k = groupKey(t);
    groups.set(k, [...(groups.get(k) ?? []), t]);
  }
  return [...groups].flatMap(([key, ts]) => {
    if (ts.length < 3) return [];
    const summary = summarize(ts);
    const span =
      (Date.parse(summary.transactions.at(-1)!.date) -
        Date.parse(summary.transactions[0].date)) /
      86400000;
    if (span < 35 || !summary.regular) return [];
    return [
      {
        key,
        name: ts[0].name,
        currency: ts[0].currency,
        ...summary,
        reason: `${ts.length} posted payments to a similar payee with ${summary.frequency.toLowerCase()} timing. Amounts may vary; confirm this is a bill.`,
      },
    ];
  });
}
export function installBills(store: Store) {
  store.db.exec(
    "CREATE TABLE IF NOT EXISTS bills(env TEXT,key TEXT,name TEXT,status TEXT,excluded TEXT NOT NULL DEFAULT '[]',PRIMARY KEY(env,key))",
  );
}
export function billState(store: Store, months: number, now = new Date()) {
  const confirmed = confirmedTransactionKeys(store);
  const history = store.repository.history("included");
  const classification = classificationDecisions(
    store,
    "bills",
    store.repository.history("all"),
  );
  const rows = history.filter((t) => !confirmed.has(transactionKey(t)));
  const accounts = store.accountList();
  const institutions = store.list();
  const label = (t?: Entry) => {
    const a = accounts.find(
      (a) => a.connection === t?.connection && a.id === t?.account,
    );
    const institution = institutions.find(
      (c) => c.id === t?.connection,
    )?.display_name;
    return a
      ? `${institution ? `${institution} · ` : ""}${a.name}${a.mask ? ` ••${a.mask}` : ""}`
      : "Unknown account";
  };
  // Include hidden destination accounts, but never infer a destination from amount alone.
  const all = store.repository.history("all");
  const paymentRoute = (t: Entry) => {
    const matches = all.filter(
      (other) =>
        !other.pending &&
        ["loan", "credit"].includes(other.account_type) &&
        !(t.canonicalAccountId && other.canonicalAccountId
          ? t.canonicalAccountId === other.canonicalAccountId
          : other.connection === t.connection && other.account === t.account) &&
        t.currency &&
        other.currency === t.currency &&
        Number(other.amount) === -Number(t.amount) &&
        Math.abs(Date.parse(other.date) - Date.parse(t.date)) <= 3 * 86400000 &&
        /\b(payment|pmt|autopay)\b/i.test(t.name) &&
        /\b(payment|pmt|autopay)\b/i.test(other.name),
    );
    const destination = matches.length === 1 ? matches[0] : undefined;
    return {
      ...t,
      fromAccount: label(t),
      toPayee: t.name,
      possibleDestination: destination ? label(destination) : null,
    };
  };
  const withRoutes = (b: any) => ({
    ...b,
    transactions: b.transactions.map(paymentRoute),
  });
  const attribution = (t?: Entry) => {
    const a = accounts.find(
      (a) => a.connection === t?.connection && a.id === t?.account,
    );
    return {
      connection: t?.connection,
      accountId: t?.account,
      canonicalAccountId: t?.canonicalAccountId,
      accountName: a ? `${a.name}${a.mask ? ` ••${a.mask}` : ""}` : "Account",
    };
  };
  const visibleKeys = new Set(rows.map(groupKey));
  const cutoff = new Date(now);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - months);
  const recent = rows.filter(
    (t) =>
      t.date >= cutoff.toISOString().slice(0, 10) &&
      t.date <= now.toISOString().slice(0, 10),
  );
  const decisions = classification.resolved;
  const visibleDecisions = decisions.filter((d) => visibleKeys.has(d.key));
  const suggestions = candidates(recent).filter(
    (c) => !decisions.some((d) => d.key === c.key),
  );
  const saved = visibleDecisions
    .filter((d) => d.status === "saved")
    .map((d) => {
      const excluded = JSON.parse(d.excluded);
      const matching = rows.filter(
        (t) =>
          groupKey(t) === d.key &&
          !t.pending &&
          Number(t.amount) > 0 &&
          !excluded.includes(transactionKey(t)),
      );
      return {
        ...attribution(matching[0]),
        key: d.key,
        name: d.name,
        currency: matching[0]?.currency ?? "",
        ...summarize(matching),
      };
    });
  return {
    suggestions: suggestions.map((b) =>
      withRoutes({
        ...b,
        ...attribution(b.transactions[0]),
      }),
    ),
    saved: saved.map(withRoutes),
    dismissed: visibleDecisions
      .filter((d) => d.status === "dismissed")
      .map((d) => ({
        key: d.key,
        name: d.name,
        ...attribution(rows.find((t) => groupKey(t) === d.key)),
      })),
    history: { first: rows[0]?.date ?? null, last: rows.at(-1)?.date ?? null },
    months,
    dataIssues: store.repository.dataIssues(),
    unresolved: classification.unresolved,
    unresolvedExclusions: classification.resolved.flatMap((d) =>
      JSON.parse(d.excluded)
        .filter((id: any) => typeof id !== "string")
        .map((e: any) => ({ ...e, key: d.key })),
    ),
  };
}

export function classificationDecisions(
  store: Store,
  kind: "bills" | "income_decisions",
  rows: any[],
) {
  const evidence = rows.map((t) => ({
    ...t,
    legacyGroupKey: groupKey({ ...t, canonicalAccountId: undefined }),
  }));
  const aliases = new Map(evidence.map((t) => [t.legacyGroupKey, groupKey(t)]));
  return store.repository.decisions(kind, aliases, evidence);
}
