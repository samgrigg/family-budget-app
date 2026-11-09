import { it, expect } from "vitest";
import { Store } from "../server/store";
import {
  refreshCardLiabilities,
  readCardLiabilities,
  installCardLiabilities,
} from "../server/card-liabilities";
it("skips deposit-only sources and preserves null statement fields", async () => {
  const s = new Store(":memory:", Buffer.alloc(32), "sandbox");
  installCardLiabilities(s);
  s.connect("bank", "synthetic", [
    { account_id: "checking", name: "Checking", type: "depository" },
  ]);
  await refreshCardLiabilities(
    s,
    {
      configured: true,
      call: async () => {
        throw Error("Deposit source must not call provider");
      },
    },
    "bank",
  );
  s.connect("cards", "synthetic", [
    { account_id: "card", name: "Card", type: "credit" },
  ]);
  const provider = {
    configured: true,
    call: async (path: string) =>
      path === "/item/get"
        ? { item: { consented_products: ["liabilities"] } }
        : {
            liabilities: {
              credit: [
                {
                  account_id: "card",
                  last_statement_balance: null,
                  last_statement_issue_date: null,
                  next_payment_due_date: null,
                  minimum_payment_amount: null,
                },
              ],
            },
          },
  };
  await refreshCardLiabilities(s, provider, "cards");
  expect(readCardLiabilities(s)[0]).toMatchObject({
    statementBalanceMinor: null,
    paymentDueDate: null,
    issue: null,
  });
  s.db.close();
});
it("requires product consent and retains old snapshot with a stale error", async () => {
  const s = new Store(":memory:", Buffer.alloc(32), "sandbox");
  installCardLiabilities(s);
  s.connect("cards", "synthetic", [
    { account_id: "card", name: "Card", type: "credit" },
  ]);
  const provider = {
    configured: true,
    call: async (path: string) =>
      path === "/item/get"
        ? { item: { consented_products: ["liabilities"] } }
        : {
            liabilities: {
              credit: [
                {
                  account_id: "card",
                  last_statement_balance: 500,
                  last_statement_issue_date: "2026-10-28",
                  next_payment_due_date: "2026-11-22",
                  minimum_payment_amount: 25,
                },
              ],
            },
          },
  };
  await refreshCardLiabilities(s, provider, "cards");
  await refreshCardLiabilities(
    s,
    {
      configured: true,
      call: async () => ({ item: { consented_products: [] } }),
    },
    "cards",
  );
  expect(readCardLiabilities(s)[0]).toMatchObject({
    statementBalanceMinor: 50000,
    issue: "Additional card-data consent is needed.",
  });
  s.db.close();
});
