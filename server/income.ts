import {
  classificationDecisions,
  candidates,
  groupKey,
  summarize,
  type Entry,
} from "./bills";
import { confirmedTransactionKeys, transactionKey } from "./transfers";
import type { Store } from "./store";
// Owner-confirmed employer aliases; applied only to deposit inflows in flowState.
export function householdEmployer(description: string): string | null {
  const sender = (
    description.match(/\bCOMPANY:\s*(.+?)\s+ENTRY:/i)?.[1] ?? description
  ).trim();
  if (
    /^adobe(?:,?\s+inc\.?)?(?:\s+(?:payroll|salary|paycheck))?$/i.test(sender)
  )
    return "Adobe";
  if (
    /^canyons(?:\s+school(?:\s+(?:d|dist|district))?\.?)?(?:\s+(?:payroll|salary|paycheck))?$/i.test(
      sender,
    )
  )
    return "Canyons";
  return null;
}
// Statement text identifies a payroll sender, not verified employment.
export function identifyEmployer(description: string): string | null {
  if (!/\b(payroll\w*|salary|salaries|paycheck)\b/i.test(description))
    return null;
  const ach = description.match(/\bCOMPANY:\s*(.+?)\s+ENTRY:/i)?.[1];
  const plain = description.match(
    /^(.+?)\s+[-–:]?\s*\b(?:payroll|salary|paycheck)\b/i,
  )?.[1];
  const name = (ach ?? plain ?? "").replace(/\s+/g, " ").trim();
  if (
    !name ||
    /^(employer|company|ach|deposit|direct deposit|adp|paychex|gusto|paylocity|workday|paycom|paycor)(?:\s|$)/i.test(
      name,
    )
  )
    return null;
  return name;
}
export function employerForHistory(transactions: Entry[]): string | null {
  const names = [
    ...new Set(
      transactions
        .map((t) => identifyEmployer(t.name))
        .filter((name): name is string => !!name)
        .map((name) => name.toUpperCase()),
    ),
  ];
  return names.length === 1 ? names[0] : null;
}
export function incomeState(store: Store, now = new Date()) {
  store.db.exec(
    "CREATE TABLE IF NOT EXISTS income_decisions(env TEXT,key TEXT,name TEXT,status TEXT,PRIMARY KEY(env,key))",
  );
  const transfers = confirmedTransactionKeys(store);
  const accounts = store.accountList(),
    institutions = store.list();
  const label = (t: Entry) => {
    const a = accounts.find(
      (a) => a.connection === t.connection && a.id === t.account,
    );
    const bank = institutions.find((c) => c.id === t.connection)?.display_name;
    return `${bank ? `${bank} · ` : ""}${a?.name ?? "Account"}${a?.mask ? ` ••${a.mask}` : ""}`;
  };
  const rows = store.repository
    .history("included")
    .filter(
      (t) =>
        t.account_type === "depository" && !t.pending && Number(t.amount) < 0,
    )
    .filter((t) => !transfers.has(transactionKey(t)))
    .map((t) => ({ ...t, amount: String(-Number(t.amount)) }));
  const cutoff = new Date(now);
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - 1);
  const eligible = rows.filter(
    (t) =>
      t.date >= cutoff.toISOString().slice(0, 10) &&
      t.date <= now.toISOString().slice(0, 10) &&
      !/\b(refund|reversal|transfer|xfer|loan|advance|payment thank|payment received)\b/i.test(
        t.name,
      ),
  );
  const classification = classificationDecisions(
    store,
    "income_decisions",
    store.repository.history("all"),
  );
  const decisions = classification.resolved;
  const enrich = (b: any) => ({
    ...b,
    employer: employerForHistory(b.transactions),
    transactions: b.transactions.map((t: Entry) => ({
      ...t,
      fromAccount: label(t),
      toPayee: t.name,
    })),
    accountName: b.transactions[0] ? label(b.transactions[0]) : "Account",
  });
  const suggestions = candidates(eligible)
    .filter((b) => !decisions.some((d) => d.key === b.key))
    .map(enrich);
  const saved = decisions
    .filter((d) => d.status === "saved")
    .flatMap((d) => {
      const matching = rows.filter((t) => groupKey(t) === d.key);
      return matching.length
        ? [
            enrich({
              key: d.key,
              name: d.name,
              currency: matching[0].currency,
              ...summarize(matching),
            }),
          ]
        : [];
    });
  const dismissed = decisions.filter(
    (d) => d.status === "dismissed" && rows.some((t) => groupKey(t) === d.key),
  );
  return {
    suggestions,
    saved,
    dismissed,
    dataIssues: store.repository.dataIssues(),
    unresolved: classification.unresolved,
  };
}
