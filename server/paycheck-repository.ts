import type { Store } from "./store";
import type { ReviewLedger } from "../shared/paycheckReview";
import { projectReview } from "../shared/paycheckProjection";
import { parseReviewMoney } from "../shared/reviewMoney";
export const emptyLedger = (): ReviewLedger => ({
  revision: 0,
  sources: [],
  paychecks: [],
  obligations: [],
  contributions: [],
  settlements: [],
  reviews: [],
});
export function installPaycheckReview(s: Store) {
  s.db.exec(
    "CREATE TABLE IF NOT EXISTS paycheck_review_ledgers(env TEXT PRIMARY KEY,schema_version INTEGER NOT NULL,revision INTEGER NOT NULL,record TEXT NOT NULL)",
  );
}
export function readReviewLedger(s: Store): ReviewLedger {
  const row = s.db
    .prepare("SELECT record,revision FROM paycheck_review_ledgers WHERE env=?")
    .get(s.env) as any;
  return row
    ? { ...JSON.parse(row.record), revision: row.revision }
    : emptyLedger();
}
const fail = (message: string, code = "INVALID_REVIEW"): never => {
  throw Object.assign(Error(message), { code });
};
const money = (n: unknown) => {
  if (typeof n !== "number" || !Number.isSafeInteger(n) || n < 0)
    fail("Enter a valid nonnegative amount.");
};
const date = (v: unknown) =>
  typeof v === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(v) &&
  !isNaN(Date.parse(v)) &&
  new Date(v).toISOString().slice(0, 10) === v;
export function validateReviewLedger(s: Store, l: ReviewLedger) {
  if (!l || typeof l !== "object") fail("Invalid review.");
  for (const key of [
    "sources",
    "paychecks",
    "obligations",
    "contributions",
    "settlements",
    "reviews",
  ] as const) {
    if (!Array.isArray(l[key]) || l[key].length > 10000)
      fail("Invalid review records.");
    const ids = new Set<string>();
    for (const r of l[key] as any[]) {
      const id = key === "reviews" ? r?.paycheckId : r?.id;
      if (typeof id !== "string" || !id || id.length > 150 || ids.has(id))
        fail("Review record IDs must be unique.");
      ids.add(id);
    }
  }
  const accounts = s.repository.listAccounts();
  const account = (id: string) =>
    accounts.find((a) => a.id === id) ?? fail("Select an existing account.");
  const tx = s.repository.analyticalHistory("all");
  const transaction = (id: string) =>
    tx.find((t) => t.id === id && !t.pending) ??
    fail("Transaction evidence changed. Reload and review.");
  const source = (id: string) =>
    l.sources.find((r) => r.id === id) ?? fail("Select a funding source.");
  const paycheck = (id: string) =>
    l.paychecks.find((r) => r.id === id) ?? fail("Select a paycheck.");
  const obligation = (id: string) =>
    l.obligations.find((r) => r.id === id) ?? fail("Select an obligation.");
  const deposits = new Set<string>(),
    paymentIds = new Set<string>();
  for (const r of l.sources) {
    account(r.accountId);
    if (typeof r.name !== "string" || !r.name.trim() || r.name.length > 150)
      fail("Name the income source.");
  }
  for (const p of l.paychecks) {
    const src = source(p.sourceId);
    money(p.amountMinor);
    if (
      p.currency !== "USD" ||
      !date(p.date) ||
      !date(p.nextPayday) ||
      p.nextPayday <= p.date ||
      typeof p.commitmentsConfirmed !== "boolean"
    )
      fail("Check currency, payday and next payday.");
    if (p.state === "received") {
      const t = transaction(p.transactionId ?? "");
      if (
        t.accountId !== src.accountId ||
        !t.amount.startsWith("-") ||
        parseReviewMoney(t.amount.slice(1)) !== p.amountMinor ||
        t.currency !== p.currency ||
        t.date !== p.date
      )
        fail("Paycheck must match its posted deposit.");
      if (deposits.has(t.id)) fail("This deposit already has a review.");
      deposits.add(t.id);
    } else if (p.state !== "expected" || p.transactionId !== null)
      fail("Expected paychecks cannot be counted as received cash.");
  }
  const statementKeys = new Set<string>();
  const purchaseIds = new Set<string>();
  for (const o of l.obligations) {
    account(o.accountId);
    if (o.fundingSourceId) source(o.fundingSourceId);
    if (o.amountMinor !== null) money(o.amountMinor);
    if (
      !["commitment", "statement", "unbilled"].includes(o.kind) ||
      !["manual", "plan", "provider"].includes(o.basis) ||
      typeof o.confirmed !== "boolean" ||
      typeof o.name !== "string" ||
      !o.name.trim() ||
      o.name.length > 150 ||
      o.currency !== "USD"
    )
      fail("Check obligation details.");
    if (o.kind === "commitment" && !o.fundingSourceId)
      fail("Choose the source funding this commitment.");
    if (o.kind !== "commitment" && account(o.accountId).type !== "credit")
      fail("Choose a credit card account.");
    if (
      (o.dueDate !== null && !date(o.dueDate)) ||
      (o.neededBy !== null && !date(o.neededBy)) ||
      (o.dueDate && o.neededBy && o.neededBy > o.dueDate)
    )
      fail("Funding must arrive by the due date.");
    if (o.transactionIds !== undefined) {
      if (!Array.isArray(o.transactionIds))
        fail("Choose valid purchase evidence.");
      let linked = 0;
      for (const id of o.transactionIds) {
        if (purchaseIds.has(id))
          fail("A card purchase cannot belong to two obligations.");
        const t = tx.find((t) => t.id === id);
        if (
          !t ||
          t.accountId !== o.accountId ||
          t.currency !== o.currency ||
          o.kind === "commitment"
        )
          fail("Card purchase evidence changed. Reassign it before saving.");
        linked += Number(
          t!.amount.startsWith("-")
            ? -parseReviewMoney(t!.amount.slice(1))
            : parseReviewMoney(t!.amount),
        );
        purchaseIds.add(id);
      }
      if (o.amountMinor !== null && linked > o.amountMinor)
        fail(
          "The obligation amount is smaller than its linked purchases and credits.",
        );
    }
    if (o.statementKey) {
      const key = JSON.stringify([o.accountId, o.statementKey]);
      if (statementKeys.has(key))
        fail("This card cycle already has an obligation.");
      statementKeys.add(key);
    }
  }
  for (const c of l.contributions) {
    const p = paycheck(c.paycheckId),
      o = obligation(c.obligationId);
    money(c.amountMinor);
    account(c.paymentAccountId);
    if (c.paymentAccountId !== source(p.sourceId).accountId)
      fail("Confirm the payment route from this paycheck account.");
    if (
      !date(c.neededBy) ||
      !o.neededBy ||
      c.neededBy > o.neededBy ||
      p.date > c.neededBy ||
      p.currency !== o.currency
    )
      fail("Contribution arrives after its payment deadline.");
  }
  for (const st of l.settlements) {
    const p = paycheck(st.paycheckId);
    if (p.state !== "received")
      fail("Record payments only against a received paycheck.");
    money(st.amountMinor);
    if (
      typeof st.confirmed !== "boolean" ||
      !Array.isArray(st.transactionIds) ||
      !st.transactionIds.length
    )
      fail("Link the posted payment evidence.");
    if (st.obligationId) obligation(st.obligationId);
    if (st.contributionId) {
      const c = l.contributions.find((c) => c.id === st.contributionId);
      if (!c || c.paycheckId !== p.id || c.obligationId !== st.obligationId)
        fail("Payment does not match its reservation.");
    }
    const evidence = st.transactionIds.map((id) => {
      if (paymentIds.has(id)) fail("Payment evidence is already assigned.");
      paymentIds.add(id);
      return transaction(id);
    });
    const debits = evidence.filter(
      (t) =>
        !t.amount.startsWith("-") &&
        t.accountId === source(p.sourceId).accountId &&
        t.currency === p.currency,
    );
    if (
      debits.length !== 1 ||
      debits[0].date < p.date ||
      parseReviewMoney(debits[0].amount) !== st.amountMinor
    )
      fail("Link one matching debit from the paycheck account.");
  }
  for (const r of l.reviews) {
    paycheck(r.paycheckId);
    if (
      r.completedAt !== null &&
      (!date(r.completedAt) || typeof r.evidenceDigest !== "string")
    )
      fail("Invalid completion record.");
  }
  for (const p of l.paychecks) {
    const projection = projectReview(
      l,
      p.id,
      new Date().toISOString().slice(0, 10),
    );
    if (
      projection.issues.some((i) =>
        [
          "OVERALLOCATED",
          "EXCESS_FUNDING",
          "SETTLEMENT_EXCESS",
          "DUPLICATE_PAYMENT",
        ].includes(i.code),
      )
    )
      fail("Funding exceeds paycheck capacity or obligation amount.");
  }
}
export function saveReviewLedger(
  s: Store,
  expectedRevision: number,
  next: ReviewLedger,
): ReviewLedger {
  return s.db.transaction(() => {
    const current = readReviewLedger(s);
    if (current.revision !== expectedRevision)
      fail("This review changed. Reload before saving.", "STALE_REVIEW");
    validateReviewLedger(s, next);
    const saved = { ...next, revision: current.revision + 1 };
    s.db
      .prepare(
        "INSERT INTO paycheck_review_ledgers VALUES(?,1,?,?) ON CONFLICT(env) DO UPDATE SET revision=excluded.revision,record=excluded.record",
      )
      .run(s.env, saved.revision, JSON.stringify(saved));
    return saved;
  })();
}
