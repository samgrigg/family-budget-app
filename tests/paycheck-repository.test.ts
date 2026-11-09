import { it, expect } from "vitest";
import { Store } from "../server/store";
import {
  installPaycheckReview,
  readReviewLedger,
  saveReviewLedger,
} from "../server/paycheck-repository";
import { reviewEvidence } from "../server/paycheck-evidence";
it("persists environment-scoped revisions and rejects stale writes atomically", () => {
  const s = new Store(":memory:", Buffer.alloc(32), "sandbox");
  installPaycheckReview(s);
  const l = readReviewLedger(s);
  expect(l.revision).toBe(0);
  const next = saveReviewLedger(s, 0, l);
  expect(next.revision).toBe(1);
  expect(() => saveReviewLedger(s, 0, l)).toThrow(/reload/i);
  expect(readReviewLedger(s).revision).toBe(1);
  const p = new Store(s.db, Buffer.alloc(32), "production");
  installPaycheckReview(p);
  expect(readReviewLedger(p).revision).toBe(0);
  s.db.close();
});
it("rejects fabricated financial records without changing the ledger", () => {
  const s = new Store(":memory:", Buffer.alloc(32), "sandbox");
  installPaycheckReview(s);
  const l = readReviewLedger(s);
  l.sources.push({
    id: "x",
    name: "Fake",
    accountId: "missing",
    incomeKey: null,
  });
  expect(() => saveReviewLedger(s, 0, l)).toThrow(/account/i);
  expect(readReviewLedger(s).revision).toBe(0);
  s.db.close();
});
it("reads stable canonical evidence and flags missing review data", () => {
  const s = new Store(":memory:", Buffer.alloc(32), "sandbox");
  installPaycheckReview(s);
  expect(reviewEvidence(s, []).transactions).toEqual([]);
  expect(reviewEvidence(s, []).digest).toBe(reviewEvidence(s, []).digest);
  s.db.close();
});
import { fundedLedger } from "./paycheck-fixtures";
function seeded() {
  const s = new Store(":memory:", Buffer.alloc(32), "sandbox");
  installPaycheckReview(s);
  s.connect("bank", "synthetic", [
    { account_id: "macu", name: "MACU", type: "depository" },
    { account_id: "card", name: "Card", type: "credit" },
  ]);
  s.commit(
    "bank",
    [
      {
        added: [
          {
            transaction_id: "dep",
            account_id: "macu",
            name: "Canyons payroll",
            date: "2026-11-06",
            amount: -2000,
            iso_currency_code: "USD",
            pending: false,
          },
        ],
        modified: [],
        removed: [],
      },
    ],
    "cursor",
    [],
  );
  const a = s.repository.listAccounts(),
    t = s.repository.analyticalHistory("all")[0];
  const l = fundedLedger();
  l.sources[0].accountId = a.find((a) => a.name === "MACU")!.id;
  l.paychecks[0].transactionId = t.id;
  for (const o of l.obligations)
    o.accountId = a.find(
      (a) => a.name === (o.kind === "commitment" ? "MACU" : "Card"),
    )!.id;
  for (const c of l.contributions) c.paymentAccountId = l.sources[0].accountId;
  return { s, l };
}
it("saves a real canonical deposit and rejects duplicate paycheck attribution", () => {
  const { s, l } = seeded();
  saveReviewLedger(s, 0, l);
  const edited = readReviewLedger(s);
  edited.paychecks.push({ ...edited.paychecks[0], id: "duplicate" });
  expect(() => saveReviewLedger(s, 1, edited)).toThrow(/already/);
  expect(readReviewLedger(s).revision).toBe(1);
  s.db.close();
});
it("rejects oversubscribed shared cash and false deposit amounts", () => {
  const { s, l } = seeded();
  l.contributions[2].amountMinor = 80000;
  expect(() => saveReviewLedger(s, 0, l)).toThrow(/exceeds/);
  l.contributions[2].amountMinor = 40000;
  l.paychecks[0].amountMinor = 210000;
  expect(() => saveReviewLedger(s, 0, l)).toThrow(/deposit/);
  s.db.close();
});
it("changes evidence digest after a deposit modification", () => {
  const { s } = seeded();
  const before = reviewEvidence(s, []).digest;
  s.commit(
    "bank",
    [
      {
        added: [],
        modified: [
          {
            transaction_id: "dep",
            account_id: "macu",
            name: "Canyons payroll",
            date: "2026-11-06",
            amount: -1900,
            iso_currency_code: "USD",
            pending: false,
          },
        ],
        removed: [],
      },
    ],
    "next",
    [],
  );
  expect(reviewEvidence(s, []).digest).not.toBe(before);
  s.db.close();
});
