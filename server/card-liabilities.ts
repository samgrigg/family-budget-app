import type { Store } from "./store";
import type { Provider } from "./plaid";
import { parseReviewMoney } from "../shared/reviewMoney";
export type CardSnapshot = {
  accountId: string;
  sourceId: string;
  fetchedAt: string | null;
  statementDate: string | null;
  statementBalanceMinor: number | null;
  paymentDueDate: string | null;
  minimumPaymentMinor: number | null;
  issue: string | null;
};
export function installCardLiabilities(s: Store) {
  s.db.exec(
    "CREATE TABLE IF NOT EXISTS card_liability_snapshots(env TEXT NOT NULL,source_id TEXT NOT NULL,account_id TEXT NOT NULL,record TEXT NOT NULL,PRIMARY KEY(env,source_id,account_id))",
  );
}
export function readCardLiabilities(s: Store): CardSnapshot[] {
  return (
    s.db
      .prepare("SELECT record FROM card_liability_snapshots WHERE env=?")
      .all(s.env) as any[]
  )
    .map((r) => JSON.parse(r.record))
    .map((r) => ({
      ...r,
      issue: s
        .list()
        .some((v) => v.id === r.sourceId && v.status !== "historical")
        ? r.issue
        : "Source is disconnected; cached data may be stale.",
    }));
}
export async function refreshCardLiabilities(
  s: Store,
  provider: Provider,
  sourceId: string,
): Promise<void> {
  const connection = s.connection(sourceId);
  if (
    connection.status === "historical" ||
    connection.status === "revoke_required"
  )
    throw Error("Reconnect this source before refreshing card data.");
  const cards = s.repository
    .accounts()
    .filter(
      (a) =>
        a.connection === sourceId && a.type === "credit" && a.shared !== false,
    );
  if (!cards.length) return;
  if (
    s.repository
      .dataIssues()
      .some(
        (i) =>
          i.kind === "replacement_pending" &&
          cards.some((a) => a.canonicalAccountId === i.accountId),
      )
  )
    throw Error("Finish the replacement account review first.");
  const save = (r: CardSnapshot) =>
    s.db
      .prepare(
        "INSERT INTO card_liability_snapshots VALUES(?,?,?,?) ON CONFLICT(env,source_id,account_id) DO UPDATE SET record=excluded.record",
      )
      .run(s.env, sourceId, r.accountId, JSON.stringify(r));
  try {
    const token = s.token(sourceId),
      item = await provider.call("/item/get", { access_token: token });
    if (!item.item?.consented_products?.includes("liabilities"))
      throw Object.assign(Error("Additional card-data consent is needed."), {
        code: "CONSENT_REQUIRED",
      });
    const response = await provider.call("/liabilities/get", {
      access_token: token,
    });
    const credit = response.liabilities?.credit;
    if (!Array.isArray(credit))
      throw Error("Card statement data is unavailable.");
    const amount = (n: unknown) =>
      typeof n === "number" && Number.isFinite(n) && n >= 0
        ? parseReviewMoney(String(n))
        : null;
    const date = (v: unknown) =>
      typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
    s.db.transaction(() => {
      for (const a of cards) {
        const c = credit.find((c: any) => c.account_id === a.id);
        save({
          sourceId,
          accountId: a.canonicalAccountId,
          fetchedAt: new Date().toISOString(),
          statementDate: date(c?.last_statement_issue_date),
          statementBalanceMinor: amount(c?.last_statement_balance),
          paymentDueDate: date(c?.next_payment_due_date),
          minimumPaymentMinor: amount(c?.minimum_payment_amount),
          issue: c
            ? null
            : "This card does not provide statement data. Confirm it manually.",
        });
      }
    })();
  } catch (e: any) {
    const old = readCardLiabilities(s);
    for (const a of cards) {
      const prior = old.find(
        (r) => r.accountId === a.canonicalAccountId && r.sourceId === sourceId,
      );
      save({
        ...prior,
        sourceId,
        accountId: a.canonicalAccountId,
        fetchedAt: prior?.fetchedAt ?? null,
        statementDate: prior?.statementDate ?? null,
        statementBalanceMinor: prior?.statementBalanceMinor ?? null,
        paymentDueDate: prior?.paymentDueDate ?? null,
        minimumPaymentMinor: prior?.minimumPaymentMinor ?? null,
        issue:
          e.code === "CONSENT_REQUIRED"
            ? "Additional card-data consent is needed."
            : "Card data could not be refreshed. Cached information may be stale; confirm manually.",
      });
    }
  }
}
