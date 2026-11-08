import type { Express } from "express";
import type { Store } from "./store";
import { activePlanRecords, type Plan } from "./bill-plan";
import { confirmedTransactionKeys, transactionKey } from "./transfers";
import { isCreditCardPayment } from "../shared/billAmounts";
const normalized = (value: string) =>
  value.toLowerCase().replace(/[^a-z0-9]/g, "");
export function searchBillEvidence(
  store: Store,
  bill: { currency: string; expenseType?: string },
  options: any,
) {
  const text = (key: string, max = 150) => {
    const value = options[key] ?? "";
    if (typeof value !== "string" || value.length > max)
      throw Error("Invalid search filter.");
    return value.trim();
  };
  const query = text("query", 120),
    amount = text("amount", 20),
    account = text("account"),
    from = text("from", 10),
    to = text("to", 10);
  const validDate = (v: string) =>
    !v ||
    (/^\d{4}-\d{2}-\d{2}$/.test(v) &&
      Number.isFinite(Date.parse(v)) &&
      new Date(v).toISOString().slice(0, 10) === v);
  if (!validDate(from) || !validDate(to) || (from && to && from > to))
    throw Error("Choose a valid date range.");
  if (amount && !/^\d{1,9}(?:\.\d{1,2})?$/.test(amount))
    throw Error(
      "Enter an amount with at most two decimal places, or leave it blank.",
    );
  const needle = normalized(query);
  if (!needle && !amount)
    throw Error("Enter a description or amount to search.");
  const offset = Number(options.offset ?? 0);
  if (!Number.isSafeInteger(offset) || offset < 0)
    throw Error("Invalid search page.");
  const requireAll =
    options.requireAll === true || options.requireAll === "true";
  const bankOnly = isCreditCardPayment(bill.expenseType);
  const accounts = [
    ...new Map(
      store
        .accountList()
        .filter((a) => !a.hidden && (!bankOnly || a.type === "depository"))
        .map((a) => [
          a.canonicalAccountId,
          {
            id: a.canonicalAccountId,
            name: `${a.name}${a.mask ? ` ••${a.mask}` : ""}`,
          },
        ]),
    ).values(),
  ];
  if (account && !accounts.some((a) => a.id === account))
    throw Error("Choose an included account.");
  const names = new Map(accounts.map((a) => [a.id, a.name]));
  const rows = store.repository
    .history("included")
    .filter(
      (t) =>
        !t.pending &&
        t.currency === bill.currency &&
        Number.isFinite(Number(t.amount)) &&
        Number(t.amount) > 0 &&
        (!bankOnly || t.account_type === "depository"),
    );
  const transferKeys = confirmedTransactionKeys(store);
  const matches = rows
    .filter(
      (t) =>
        (!account || t.canonicalAccountId === account) &&
        (!from || t.date >= from) &&
        (!to || t.date <= to),
    )
    .flatMap((t) => {
      const nameMatch = !!needle && normalized(t.name).includes(needle),
        amountMatch = !!amount && Number(t.amount) === Number(amount);
      const match = requireAll
        ? (!needle || nameMatch) && (!amount || amountMatch)
        : nameMatch || amountMatch;
      if (!match) return [];
      return [
        {
          key: transactionKey(t),
          date: t.date,
          name: t.name,
          amount: t.amount,
          currency: t.currency,
          accountName: names.get(t.canonicalAccountId) ?? "Account",
          accountType: t.account_type,
          reasons: [
            ...(nameMatch ? ["Description contains search text"] : []),
            ...(amountMatch ? ["Same payment amount"] : []),
          ],
          internalTransfer: transferKeys.has(transactionKey(t)),
        },
      ];
    })
    .sort(
      (a, b) =>
        b.reasons.length - a.reasons.length ||
        b.date.localeCompare(a.date) ||
        a.key.localeCompare(b.key),
    );
  const dates = rows.map((t) => t.date).sort();
  return {
    matches: matches.slice(offset, offset + 50),
    total: matches.length,
    nextOffset: offset + 50 < matches.length ? offset + 50 : null,
    accounts,
    bankOnly,
    currency: bill.currency,
    search: { query, amount, account, from, to, requireAll },
    coverage: { first: dates[0] ?? null, last: dates.at(-1) ?? null },
  };
}
export function installBillEvidenceApi(
  app: Express,
  store: Store,
  drafts: Plan[],
) {
  app.get("/api/bill-plan/evidence", (req, res) => {
    const bill = activePlanRecords(store, drafts).find(
      (r) => r.id === req.query.billId,
    );
    if (!bill)
      return res
        .status(404)
        .json({
          error: "This bill changed or was merged. Reload and try again.",
        });
    try {
      res.json(searchBillEvidence(store, bill, req.query));
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });
}
