import { storedPlans, paymentEvidence } from "./bill-plan";
import { billState } from "./bills";
import { householdEmployer, identifyEmployer, incomeState } from "./income";
import { transactionKey } from "./transfers";
import { transferState } from "./transfers";
import type { Store } from "./store";
export function buildFlow(
  incomes: any[],
  bills: any[],
  transfers: any[],
  labels: Map<string, string>,
  savingsAccounts = new Set<string>(),
) {
  const links = new Map<string, any>();
  const accounts = new Set<string>();
  const id = (t: any) =>
    t.canonicalAccountId ?? JSON.stringify([t.connection, t.account]);
  const add = (
    source: string,
    target: string,
    amount: number,
    kind: string,
  ) => {
    if (!Number.isFinite(amount) || amount <= 0) return;
    const key = JSON.stringify([source, target]);
    const old = links.get(key);
    links.set(key, {
      source,
      target,
      amount: (old?.amount ?? 0) + amount,
      kind,
    });
  };
  const totals = new Map<
    string,
    { income: number; bills: number; incoming: number; outgoing: number }
  >();
  const get = (key: string) => {
    accounts.add(key);
    if (!totals.has(key))
      totals.set(key, { income: 0, bills: 0, incoming: 0, outgoing: 0 });
    return totals.get(key)!;
  };
  for (const b of incomes)
    for (const t of b.transactions) {
      const a = id(t),
        n = Math.abs(Number(t.amount));
      get(a).income += n;
      add(`income:${b.key}`, `before:${a}`, n, b.kind || "Income");
    }
  for (const b of bills)
    for (const t of b.transactions) {
      const a = id(t),
        n = Number(t.amount);
      get(a).bills += n;
      add(`after:${a}`, `bill:${b.key}`, n, b.kind || "Bill");
    }
  for (const p of transfers) {
    const a = id(p.out),
      b = id(p.into),
      n = Number(p.out.amount);
    get(a).outgoing += n;
    get(b).incoming += n;
    add(`before:${a}`, `after:${b}`, n, p.kind || "Internal transfer");
  }
  for (const a of accounts) {
    const t = get(a);
    const direct = Math.max(t.income - t.outgoing, t.bills - t.incoming, 0);
    add(`before:${a}`, `after:${a}`, direct, "Same account");
    add(
      "funding",
      `before:${a}`,
      t.outgoing + direct - t.income,
      "Untraced funding",
    );
    const residual = t.incoming + direct - t.bills;
    const savings = savingsAccounts.has(a)
      ? Math.min(
          residual,
          Math.max(0, t.income + t.incoming - t.outgoing - t.bills),
        )
      : 0;
    add(`after:${a}`, "savings", savings, "Savings");
    if (a.startsWith("untracked-credit:"))
      add(
        `after:${a}`,
        `bill:repayment:${a}`,
        residual,
        "Debt repayment without purchase history",
      );
    else add(`after:${a}`, "remaining", residual - savings, "Unallocated");
  }
  const names = new Map<string, string>([
    ["funding", "Other funding / starting funds"],
    ["remaining", "Other spending / retained funds"],
    ["savings", "Retained in savings accounts"],
  ]);
  for (const a of accounts)
    for (const stage of ["before", "after"])
      names.set(`${stage}:${a}`, labels.get(a) ?? "Account");
  for (const a of accounts)
    if (a.startsWith("untracked-credit:"))
      names.set(
        `bill:repayment:${a}`,
        "Credit card repayment · purchase history unavailable",
      );
  for (const b of incomes) names.set(`income:${b.key}`, b.name);
  for (const b of bills) names.set(`bill:${b.key}`, b.name);
  const edges = [...links.values()];
  const ids = new Set(edges.flatMap((e) => [e.source, e.target]));
  return {
    nodes: [...ids].map((id) => ({
      id,
      name: names.get(id) ?? id,
      column:
        id === "funding" || id.startsWith("income:")
          ? 0
          : id.startsWith("before:")
            ? 1
            : id.startsWith("after:")
              ? 2
              : 3,
    })),
    links: edges,
  };
}
export function flowState(store: Store, month: string, currency: string) {
  const institutions = store.list();
  const labels = new Map(
    store
      .accountList()
      .map((a) => [
        a.canonicalAccountId ?? JSON.stringify([a.connection, a.id]),
        `${institutions.find((c) => c.id === a.connection)?.display_name ?? "Institution"} · ${a.name}${a.mask ? ` ••${a.mask}` : ""}${a.hidden ? " (hidden)" : ""}`,
      ]),
  );
  const inMonth = (t: any) =>
    t.date.startsWith(month) && t.currency === currency;
  const rows = store.repository.history("all").filter((t) => !t.pending);
  const type = (t: any) => t.account_type;
  const pairList = transferState(store).confirmed.map((p) => ({
    ...p,
    kind: "Internal transfer",
  }));
  const used = new Set(
    pairList.flatMap((p) => [transactionKey(p.out), transactionKey(p.into)]),
  );
  // Debt repayments connect two accounts, but remain distinct from internal transfers.
  const debtCandidates = rows
    .filter(
      (t) =>
        !used.has(transactionKey(t)) &&
        Number(t.amount) > 0 &&
        /\b(payment|pmt|epay|autopay)\b/i.test(t.name),
    )
    .flatMap((out) =>
      rows
        .filter(
          (into) =>
            !used.has(transactionKey(into)) &&
            ["loan", "credit"].includes(type(into)) &&
            !(out.canonicalAccountId === into.canonicalAccountId) &&
            into.currency === out.currency &&
            Number(into.amount) === -Number(out.amount) &&
            Math.abs(Date.parse(into.date) - Date.parse(out.date)) <=
              5 * 86400000 &&
            /\b(payment|pmt|autopay)\b/i.test(into.name),
        )
        .map((into) => ({ out, into, kind: "Debt payment" })),
    );
  for (const p of debtCandidates)
    if (
      debtCandidates.filter(
        (q) =>
          transactionKey(q.out) === transactionKey(p.out) ||
          transactionKey(q.into) === transactionKey(p.into),
      ).length === 1
    ) {
      pairList.push(p as any);
      used.add(transactionKey(p.out));
      used.add(transactionKey(p.into));
    }
  // Explicitly linked posted repayments are movements, never a second purchase.
  const evidence = paymentEvidence(store);
  for (const plan of storedPlans(store).filter(
    (p) =>
      p.status === "confirmed" &&
      p.kind === "bill" &&
      p.expenseType === "creditPayment",
  )) {
    for (const payment of plan.payments ?? []) {
      const out = payment.actualTransactionKey
        ? evidence.get(payment.actualTransactionKey)
        : undefined;
      if (
        !out ||
        out.currency !== plan.currency ||
        out.account_type !== "depository" ||
        used.has(transactionKey(out))
      )
        continue;
      const availableCard =
        plan.creditAccountId &&
        store
          .accountList()
          .some(
            (a) =>
              a.canonicalAccountId === plan.creditAccountId &&
              a.type === "credit",
          );
      const destination = availableCard
        ? plan.creditAccountId!
        : `untracked-credit:${plan.id}`;
      const matching = rows.filter(
        (t) =>
          t.canonicalAccountId === destination &&
          t.currency === out.currency &&
          Number(t.amount) === -Number(out.amount) &&
          Math.abs(Date.parse(t.date) - Date.parse(out.date)) <= 5 * 86400000 &&
          !used.has(transactionKey(t)),
      );
      const into =
        matching.length === 1
          ? matching[0]
          : {
              ...out,
              id: `planned-card:${plan.id}:${payment.date}`,
              canonicalTransactionId: `planned-card:${plan.id}:${payment.date}`,
              canonicalAccountId: destination,
              amount: String(-Number(out.amount)),
              account_type: "credit",
            };
      if (!availableCard)
        labels.set(destination, `Untracked credit card · ${plan.name}`);
      pairList.push({ out, into, kind: "Debt payment" } as any);
      used.add(transactionKey(out));
      used.add(transactionKey(into));
    }
  }
  const incoming = new Map<string, any>(),
    spending = new Map<string, any>();
  const knownIncome = new Map<string, any>(
    incomeState(store).saved.flatMap((b) =>
      b.transactions.map((t: any) => [transactionKey(t), b] as const),
    ),
  );
  const knownBills = new Map<string, any>(
    billState(store, 12).saved.flatMap((b) =>
      b.transactions.map((t: any) => [transactionKey(t), b] as const),
    ),
  );
  const add = (
    groups: Map<string, any>,
    name: string,
    kind: string,
    t: any,
  ) => {
    const key = encodeURIComponent(JSON.stringify([kind, name.toLowerCase()]));
    const old = groups.get(key);
    groups.set(key, {
      key,
      name,
      kind,
      transactions: [...(old?.transactions ?? []), t],
    });
  };
  for (const t of rows.filter(inMonth)) {
    if (
      used.has(transactionKey(t)) ||
      !Number.isFinite(Number(t.amount)) ||
      Number(t.amount) === 0
    )
      continue;
    if (Number(t.amount) < 0) {
      const known = knownIncome.get(transactionKey(t));
      const employer =
        (type(t) === "depository" ? householdEmployer(t.name) : null) ||
        householdEmployer(known?.employer ?? "") ||
        identifyEmployer(t.name) ||
        known?.employer;
      const passive = /\b(interest|dividends?)\b/i.test(t.name);
      const name = passive
        ? "Other income"
        : employer || known?.name || "Other deposits / credits";
      add(
        incoming,
        name,
        passive || employer || known ? "Income" : "Other inflow",
        t,
      );
    } else {
      const b = knownBills.get(transactionKey(t));
      add(spending, b?.name || t.name, b ? "Bill" : "Spending", t);
    }
  }
  // Include a matched pair if either leg posts this month; its cross-month leg is disclosed.
  const transfers = pairList.filter((p) => inMonth(p.out) || inMonth(p.into));
  const savingsAccounts = new Set(
    store
      .accountList()
      .filter(
        (a) =>
          /\b(savings|money market)\b/i.test(a.name) &&
          !/\b(loan|credit|visa|checking)\b/i.test(a.name),
      )
      .map((a) => a.canonicalAccountId ?? JSON.stringify([a.connection, a.id])),
  );
  const graph = buildFlow(
    [...incoming.values()],
    [...spending.values()],
    transfers,
    labels,
    savingsAccounts,
  );
  // Make every onboarded account selectable, even without monthly activity.
  for (const [key, name] of labels)
    if (!graph.nodes.some((n) => n.id === `before:${key}`))
      graph.nodes.push({ id: `before:${key}`, name, column: 1 });
  const dimensions = store.repository
    .history("all")
    .map((t) => ({ month: t.date.slice(0, 7), currency: t.currency }))
    .sort((a, b) => b.month.localeCompare(a.month));
  return {
    ...graph,
    dataIssues: store.repository
      .dataIssues()
      .filter((i) => i.date.startsWith(month) && i.currency === currency),
    month,
    currency,
    savingsBasis:
      "Savings accounts are inferred from account names. Savings represents positive net modeled inflow retained there, not a verified balance change.",
    months: [...new Set(dimensions.map((d) => d.month))],
    currencies: [...new Set(dimensions.map((d) => d.currency).filter(Boolean))],
  };
}
