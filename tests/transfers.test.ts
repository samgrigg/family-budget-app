import { it, expect } from "vitest";
import { transferCandidates, transferState } from "../server/transfers";
import { Store } from "../server/store";
const row = (
  id: string,
  amount: string,
  account: string,
  name = "Online transfer",
  date = "2026-10-01",
) => ({
  id,
  connection: "c",
  account,
  name,
  date,
  amount,
  currency: "USD",
  pending: 0,
  account_type: "depository",
});
it("automatically confirms unique supported pairs across accounts, but not shopping coincidences", () => {
  expect(
    transferCandidates([row("1", "50", "a"), row("2", "-50", "b")])[0].strong,
  ).toBe(true);
  expect(
    transferCandidates([
      row("1", "50", "a", "Shop"),
      row("2", "-50", "b", "Refund"),
    ])[0].strong,
  ).toBe(false);
  expect(
    transferCandidates([row("1", "50", "a"), row("2", "-50", "a")]),
  ).toHaveLength(0);
});
it("requires review for ambiguity and rejects pending, cross-currency, and distant pairs", () => {
  const rows = [
    row("1", "50", "a"),
    row("2", "-50", "b"),
    row("3", "-50", "d"),
  ];
  expect(transferCandidates(rows).every((p) => !p.strong)).toBe(true);
  expect(
    transferCandidates([rows[0], { ...rows[1], pending: 1 }]),
  ).toHaveLength(0);
  expect(
    transferCandidates([rows[0], { ...rows[1], currency: "CAD" }]),
  ).toHaveLength(0);
  expect(
    transferCandidates([rows[0], { ...rows[1], date: "2026-10-08" }]),
  ).toHaveLength(0);
});
it("persists undo decisions, includes hidden accounts, and invalidates matches on data changes", () => {
  const s = new Store(":memory:", Buffer.alloc(32), "sandbox");
  s.connect("c", "token", [
    { account_id: "a", name: "Checking", type: "depository" },
    { account_id: "b", name: "Savings", type: "depository" },
  ]);
  for (const t of [row("1", "50", "a"), row("2", "-50", "b")])
    s.db
      .prepare("INSERT INTO transactions VALUES(?,?,?,?,?,?,?,?,?)")
      .run(
        s.env,
        t.connection,
        t.id,
        t.account,
        t.date,
        t.name,
        t.amount,
        t.currency,
        t.pending,
      );
  s.setAccountHidden("c", "b", true);
  const initial = transferState(s);
  expect(initial.confirmed).toHaveLength(1);
  s.db
    .prepare("INSERT INTO transfer_decisions VALUES(?,?,?)")
    .run(s.env, initial.confirmed[0].key, "rejected");
  expect(transferState(s).confirmed).toHaveLength(0);
  expect(transferState(s).rejected).toHaveLength(1);
  s.db.prepare("UPDATE transactions SET amount='-51' WHERE id='2'").run();
  expect(transferState(s).rejected).toHaveLength(0);
  expect(
    transferState(new Store(s.db, Buffer.alloc(32), "production")).confirmed,
  ).toHaveLength(0);
  s.db.close();
});

import { billState, installBills } from "../server/bills";
it("excludes confirmed recurring transfers from bill discovery and restores them after undo", () => {
  const s = new Store(":memory:", Buffer.alloc(32), "sandbox");
  installBills(s);
  s.connect("c", "token", [
    { account_id: "a", name: "Checking", type: "depository" },
    { account_id: "b", name: "Savings", type: "depository" },
  ]);
  for (const month of ["08", "09", "10"])
    for (const t of [
      row(`out${month}`, "50", "a"),
      row(`in${month}`, "-50", "b"),
    ])
      s.db
        .prepare("INSERT INTO transactions VALUES(?,?,?,?,?,?,?,?,?)")
        .run(
          s.env,
          t.connection,
          t.id,
          t.account,
          `2026-${month}-01`,
          t.name,
          t.amount,
          t.currency,
          t.pending,
        );
  expect(billState(s, 6, new Date("2026-11-07")).suggestions).toHaveLength(0);
  for (const p of transferState(s).confirmed)
    s.db
      .prepare("INSERT INTO transfer_decisions VALUES(?,?,?)")
      .run(s.env, p.key, "rejected");
  // transfer-named transactions are independently excluded by the bill payee filter;
  // use payment wording to verify transfer classification is the deciding exclusion.
  s.db.prepare("UPDATE transactions SET name='Scheduled payment'").run();
  expect(billState(s, 6, new Date("2026-11-07")).suggestions).toHaveLength(0);
  for (const p of transferState(s).confirmed)
    s.db
      .prepare("INSERT INTO transfer_decisions VALUES(?,?,?)")
      .run(s.env, p.key, "rejected");
  expect(billState(s, 6, new Date("2026-11-07")).suggestions).toHaveLength(1);
  s.db.close();
});

it("never treats loan, credit-card, or untyped accounts as internal transfers", () => {
  for (const account_type of ["credit", "loan", null, undefined]) {
    expect(
      transferCandidates([
        row("out", "50", "a"),
        { ...row("in", "-50", "b"), account_type },
      ]),
    ).toHaveLength(0);
    expect(
      transferCandidates([
        { ...row("out", "50", "a"), account_type },
        row("in", "-50", "b"),
      ]),
    ).toHaveLength(0);
  }
});
