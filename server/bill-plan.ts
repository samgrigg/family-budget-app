import { readFileSync } from "node:fs";
import type { Express } from "express";
import type { Store } from "./store";
import { billState, groupKey, payee } from "./bills";
import { transactionKey } from "./transfers";
import {
  monthlyFactors as factors,
  isCreditCardPayment,
  resolveBillAmount,
  validMonth,
  type BillPayment,
} from "../shared/billAmounts";
export type Plan = {
  id: string;
  name: string;
  accountName: string;
  amount: string;
  currency: string;
  frequency: string;
  day: number | null;
  notes: string;
  kind: string;
  status: string;
  source?: { cell: string; value: string; formula: string };
  sources?: { cell: string; value: string; formula: string }[];
  acknowledgeDuplicate?: boolean;
  amountMode?: "fixed" | "variable";
  planningEstimate?: string;
  payments?: BillPayment[];
  expenseType?: "expense" | "creditPayment" | "creditDebtPayoff";
  creditAccountId?: string;
};
export function installBillPlan(store: Store) {
  store.db.exec(
    "CREATE TABLE IF NOT EXISTS bill_plan(env TEXT NOT NULL,id TEXT NOT NULL,record TEXT NOT NULL,PRIMARY KEY(env,id)); CREATE TABLE IF NOT EXISTS bill_plan_merges(env TEXT NOT NULL,source_id TEXT NOT NULL,target_id TEXT NOT NULL,source_record TEXT NOT NULL,target_record TEXT NOT NULL,PRIMARY KEY(env,source_id))",
  );
}
export function storedPlans(store: Store): Plan[] {
  if (
    !store.db
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='bill_plan'",
      )
      .get()
  )
    return [];
  return (
    store.db
      .prepare("SELECT record FROM bill_plan WHERE env=? ORDER BY id")
      .all(store.env) as { record: string }[]
  ).map((r) => JSON.parse(r.record));
}
export function activePlanRecords(store: Store, drafts: Plan[]): Plan[] {
  const records = new Map(drafts.map((r) => [r.id, r]));
  for (const r of storedPlans(store)) records.set(r.id, r);
  const merged = store.db
    .prepare("SELECT source_id FROM bill_plan_merges WHERE env=?")
    .all(store.env) as { source_id: string }[];
  for (const r of merged) records.delete(r.source_id);
  return [...records.values()];
}
export function paymentEvidence(store: Store) {
  return new Map(
    store.repository
      .history("all")
      .filter(
        (t) =>
          !t.pending &&
          Number.isFinite(Number(t.amount)) &&
          Number(t.amount) > 0,
      )
      .map((t) => [transactionKey(t), t]),
  );
}
export function fundingTotals(
  records: Plan[],
  month = new Date().toISOString().slice(0, 7),
  actuals = new Map<string, { amount: string }>(),
) {
  const groups = new Map<
    string,
    {
      accountName: string;
      currency: string;
      monthly: number;
      setAside: number;
      total: number;
      known: number;
      estimated: number;
      unknown: number;
      repayments: number;
      debtPayoff: number;
    }
  >();
  for (const r of records) {
    if (
      r.status !== "confirmed" ||
      r.kind !== "bill" ||
      !Object.hasOwn(factors, r.frequency)
    )
      continue;
    const key = JSON.stringify([r.accountName, r.currency]);
    const g = groups.get(key) ?? {
      accountName: r.accountName,
      currency: r.currency,
      monthly: 0,
      setAside: 0,
      total: 0,
      known: 0,
      estimated: 0,
      unknown: 0,
      repayments: 0,
      debtPayoff: 0,
    };
    const result = resolveBillAmount(r, month, actuals);
    if (result.amount === null) g.unknown++;
    else {
      if (result.basis === "estimate") g.estimated += result.amount;
      else g.known += result.amount;
      if (["Quarterly", "Every six months", "Yearly"].includes(r.frequency))
        g.setAside += result.amount;
      else g.monthly += result.amount;
      g.total += result.amount;
      if (r.expenseType === "creditPayment") g.repayments += result.amount;
      if (r.expenseType === "creditDebtPayoff") g.debtPayoff += result.amount;
    }
    groups.set(key, g);
  }
  return [...groups.values()];
}
export function categoryTotals(
  records: Plan[],
  month: string,
  actuals: Map<string, { amount: string }>,
  category: "expenses" | "debtPayoff",
) {
  const currencies = [
    ...new Set(
      records
        .filter((r) => r.status === "confirmed" && r.kind === "bill")
        .map((r) => r.currency),
    ),
  ];
  const totals = fundingTotals(
    records.filter((r) =>
      category === "debtPayoff"
        ? r.expenseType === "creditDebtPayoff"
        : !isCreditCardPayment(r.expenseType),
    ),
    month,
    actuals,
  );
  return currencies.map((currency) => ({
    currency,
    total: totals
      .filter((t) => t.currency === currency)
      .reduce((sum, t) => sum + t.total, 0),
    estimated: totals
      .filter((t) => t.currency === currency)
      .reduce((sum, t) => sum + t.estimated, 0),
    unknown: totals
      .filter((t) => t.currency === currency)
      .reduce((sum, t) => sum + t.unknown, 0),
  }));
}
export function planState(
  store: Store,
  drafts: Plan[],
  observed: { name: string }[] = [],
  month = new Date().toISOString().slice(0, 7),
) {
  const actuals = paymentEvidence(store);
  const saved = storedPlans(store);
  const records = activePlanRecords(store, drafts).map((r) => {
    const duplicatePlans = saved
      .filter(
        (s) =>
          s.id !== r.id &&
          s.status === "confirmed" &&
          s.kind === "bill" &&
          r.kind === "bill" &&
          payee(s.name) === payee(r.name),
      )
      .map((s) => ({ id: s.id, name: s.name, accountName: s.accountName }));
    return {
      ...r,
      resolvedAmount: resolveBillAmount(r, month, actuals),
      possibleDuplicate: duplicatePlans.length > 0,
      duplicatePlans,
      observedMatches: observed
        .filter((s) => payee(s.name) === payee(r.name))
        .map((s) => ({ name: s.name })),
    };
  });
  const accounts = store.accountList();
  return {
    records,
    month,
    totals: fundingTotals(records, month, actuals),
    expenses: categoryTotals(records, month, actuals, "expenses"),
    debtPayoff: categoryTotals(records, month, actuals, "debtPayoff"),
    creditAccounts: accounts
      .filter((a) => a.type === "credit")
      .map((a) => ({
        id: a.canonicalAccountId,
        name: `${a.name}${a.mask ? ` ••${a.mask}` : ""}`,
      })),
    paymentOptions: [...actuals.entries()]
      .sort((a, b) => b[1].date.localeCompare(a[1].date))
      .slice(0, 2000)
      .map(([key, t]) => ({
        key,
        date: t.date,
        amount: t.amount,
        currency: t.currency,
        name: t.name,
        accountType: t.account_type,
        accountName:
          accounts.find((a) => a.canonicalAccountId === t.canonicalAccountId)
            ?.name ?? "Account",
      })),
  };
}
export function savePlan(
  store: Store,
  input: any,
  observed: { name: string }[],
  retainedPlans: Plan[] = [],
) {
  if (!input || typeof input !== "object") throw Error("Invalid bill details.");
  const r: Plan = { ...input };
  if (
    store.db
      .prepare("SELECT 1 FROM bill_plan_merges WHERE env=? AND source_id=?")
      .get(store.env, typeof r.id === "string" ? r.id : "")
  )
    throw Error("This bill has been merged. Reload to see the remaining bill.");
  if (
    typeof r.id !== "string" ||
    !r.id ||
    r.id.length > 150 ||
    typeof r.name !== "string" ||
    !r.name.trim() ||
    r.name.length > 120 ||
    typeof r.accountName !== "string" ||
    r.accountName.length > 150 ||
    typeof r.amount !== "string" ||
    !(
      (r.amountMode === "variable" && r.amount === "") ||
      /^\d{1,9}\.\d{2}$/.test(r.amount)
    ) ||
    typeof r.currency !== "string" ||
    !/^[A-Z]{3}$/.test(r.currency) ||
    typeof r.notes !== "string" ||
    r.notes.length > 2000 ||
    !["confirmed", "excluded", "review"].includes(r.status) ||
    !["bill", "transfer"].includes(r.kind) ||
    !(
      typeof r.frequency === "string" &&
      (Object.hasOwn(factors, r.frequency) || r.frequency === "Unknown")
    ) ||
    !(r.day === null || (Number.isInteger(r.day) && r.day >= 1 && r.day <= 31))
  )
    throw Error(
      "Check the bill name, amount, currency, frequency and payment day.",
    );
  const decimal = (v: unknown) =>
    typeof v === "string" && /^\d{1,9}\.\d{2}$/.test(v);
  if (
    r.amountMode !== undefined &&
    !["fixed", "variable"].includes(r.amountMode)
  )
    throw Error("Choose a fixed or variable amount.");
  if (
    r.expenseType !== undefined &&
    !["expense", "creditPayment", "creditDebtPayoff"].includes(r.expenseType)
  )
    throw Error("Choose an expense or credit card payment.");
  if (
    r.planningEstimate !== undefined &&
    r.planningEstimate !== "" &&
    !decimal(r.planningEstimate)
  )
    throw Error(
      "Enter the estimate with two decimal places, or leave it blank.",
    );
  if (
    (r.amountMode === "variable" || r.payments?.length) &&
    r.frequency !== "Monthly"
  )
    throw Error(
      "Variable amounts and payment cycles currently require monthly frequency.",
    );
  if (
    r.payments !== undefined &&
    (!Array.isArray(r.payments) || r.payments.length > 240)
  )
    throw Error("Invalid payment cycles.");
  const previous = storedPlans(store).find((p) => p.id === r.id);
  const retained = [previous, ...retainedPlans].filter(
    (p): p is Plan => !!p && p.currency === r.currency,
  );
  if (
    r.creditAccountId !== undefined &&
    (typeof r.creditAccountId !== "string" ||
      (r.creditAccountId &&
        !retained.some((p) => p.creditAccountId === r.creditAccountId) &&
        !store
          .accountList()
          .some(
            (a) =>
              a.canonicalAccountId === r.creditAccountId && a.type === "credit",
          )))
  )
    throw Error("Choose an available credit card account.");
  const months = new Set<string>(),
    keys = new Set<string>(),
    actuals = paymentEvidence(store);

  for (const p of r.payments ?? []) {
    if (
      !p ||
      typeof p.date !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(p.date) ||
      !validMonth(p.date.slice(0, 7)) ||
      !Number.isFinite(Date.parse(p.date)) ||
      new Date(p.date).toISOString().slice(0, 10) !== p.date ||
      !decimal(p.amount)
    )
      throw Error(
        "Each payment needs a valid date and amount with two decimal places.",
      );
    const month = p.date.slice(0, 7);
    if (months.has(month))
      throw Error("Only one payment per bill per calendar month is supported.");
    months.add(month);
    if (p.actualTransactionKey) {
      if (
        typeof p.actualTransactionKey !== "string" ||
        keys.has(p.actualTransactionKey)
      )
        throw Error("A posted payment can only be linked once.");
      keys.add(p.actualTransactionKey);
      const t = actuals.get(p.actualTransactionKey);
      const unchangedMissing =
        !t &&
        retained.some((plan) =>
          plan.payments?.some(
            (old) =>
              old.actualTransactionKey === p.actualTransactionKey &&
              old.date === p.date,
          ),
        );
      if (
        !unchangedMissing &&
        (!t ||
          t.currency !== r.currency ||
          (isCreditCardPayment(r.expenseType) &&
            t.account_type !== "depository"))
      )
        throw Error(
          "Choose a posted outgoing payment in the same currency. Credit card payments must come from a bank account.",
        );
      if (t && r.creditAccountId && t.canonicalAccountId === r.creditAccountId)
        throw Error(
          "The payment source and credit card destination must differ.",
        );
      if (
        storedPlans(store).some(
          (other) =>
            other.id !== r.id &&
            other.status !== "excluded" &&
            other.payments?.some(
              (payment) =>
                payment.actualTransactionKey === p.actualTransactionKey,
            ),
        )
      )
        throw Error("That posted payment is already linked to another bill.");
    }
  }
  r.name = r.name.trim();
  r.accountName = r.accountName.trim();
  if (r.status === "confirmed") {
    if (
      (r.amountMode !== "variable" && Number(r.amount) <= 0) ||
      !r.accountName ||
      !Object.hasOwn(factors, r.frequency)
    )
      throw Error(
        "Resolve the amount, payment account and frequency before confirming.",
      );
    const others = storedPlans(store).filter(
      (s) =>
        s.id !== r.id &&
        s.status === "confirmed" &&
        s.kind === "bill" &&
        r.kind === "bill",
    );
    const duplicates = others.filter((s) => payee(s.name) === payee(r.name));
    if (duplicates.length && r.acknowledgeDuplicate !== true)
      throw Object.assign(
        Error(
          "Possible duplicate: merge with the existing bill, or acknowledge a separate commitment.",
        ),
        {
          duplicatePlans: duplicates.map((s) => ({
            id: s.id,
            name: s.name,
            accountName: s.accountName,
          })),
        },
      );
  }
  // Store only the supported fields. Source provenance is supplied by the server route.
  const record: Plan = {
    id: r.id,
    name: r.name,
    accountName: r.accountName,
    amount: r.amount,
    currency: r.currency,
    frequency: r.frequency,
    day: r.day,
    notes: r.notes,
    kind: r.kind,
    status: r.status,
    amountMode: r.amountMode ?? "fixed",
    planningEstimate: r.planningEstimate ?? "",
    expenseType: r.expenseType ?? "expense",
    creditAccountId: r.creditAccountId ?? "",
    payments: (r.payments ?? []).map((p) => ({
      date: p.date,
      amount: p.amount,
      ...(p.actualTransactionKey
        ? { actualTransactionKey: p.actualTransactionKey }
        : {}),
    })),
    ...(r.source ? { source: r.source } : {}),
    ...(r.sources ? { sources: r.sources } : {}),
    acknowledgeDuplicate: r.acknowledgeDuplicate === true,
  };
  store.db
    .prepare(
      "INSERT INTO bill_plan VALUES(?,?,?) ON CONFLICT(env,id) DO UPDATE SET record=excluded.record",
    )
    .run(store.env, r.id, JSON.stringify(record));
}
export function loadBillDrafts(path = "data/bills-import.json"): Plan[] {
  try {
    const records = JSON.parse(readFileSync(path, "utf8"));
    if (!Array.isArray(records)) throw Error("Invalid staging file");
    return records;
  } catch (e: any) {
    if (e.code === "ENOENT") return [];
    throw e;
  }
}
export function installBillPlanApi(app: Express, store: Store, drafts: Plan[]) {
  installBillPlan(store);
  const observed = () => billState(store, 12).saved;
  app.get("/api/bill-plan", (req, res) => {
    const month = req.query.month ?? new Date().toISOString().slice(0, 7);
    if (!validMonth(month))
      return res.status(400).json({ error: "Choose a valid calendar month." });
    res.json(planState(store, drafts, observed(), month));
  });
  app.post("/api/bill-plan", (req, res) => {
    try {
      const original = planState(store, drafts).records.find(
        (r) => r.id === req.body?.id,
      );
      if (!original)
        return res.status(400).json({
          error:
            "This import row is no longer available. Reload and try again.",
        });
      savePlan(
        store,
        { ...req.body, source: original.source, sources: original.sources },
        observed(),
      );
      res.json({ ok: true });
    } catch (e: any) {
      res.status(400).json({
        error: e.message,
        ...(e.duplicatePlans ? { duplicatePlans: e.duplicatePlans } : {}),
      });
    }
  });
}

export function annotateRepayments(store: Store, state: any) {
  const evidence = paymentEvidence(store),
    groups = new Map<string, string>();
  for (const plan of storedPlans(store).filter(
    (p) =>
      p.status === "confirmed" &&
      p.kind === "bill" &&
      isCreditCardPayment(p.expenseType),
  ))
    for (const p of plan.payments ?? []) {
      const t = p.actualTransactionKey
        ? evidence.get(p.actualTransactionKey)
        : undefined;
      if (t && t.currency === plan.currency && t.account_type === "depository")
        groups.set(groupKey(t), plan.expenseType!);
    }
  return {
    ...state,
    saved: state.saved.map((b: any) =>
      groups.has(b.key) ? { ...b, expenseType: groups.get(b.key) } : b,
    ),
  };
}
