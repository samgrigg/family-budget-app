import { it, expect } from "vitest";
import { Store } from "../server/store";
import { AccountRepository } from "../server/account-repository";
it("retains complete source-qualified history and filters an account before pagination", () => {
  const s = new Store(":memory:", Buffer.alloc(32), "sandbox");
  for (const c of ["old", "active"])
    s.connect(c, "token", [
      { account_id: "a", name: "Checking", type: "depository" },
    ]);
  const put = s.db.prepare(
    "INSERT INTO transactions VALUES(?,?,?,?,?,?,?,?,?)",
  );
  s.db.transaction(() => {
    for (let i = 0; i < 2105; i++)
      put.run(
        s.env,
        "old",
        String(i),
        "a",
        "2025-01-01",
        "Purchase",
        "1.00",
        "USD",
        0,
      );
    put.run(
      s.env,
      "active",
      "0",
      "a",
      "2026-01-01",
      "Purchase",
      "1.00",
      "USD",
      0,
    );
  })();
  const r = new AccountRepository(s.db, s.env);
  expect(r.history("all")).toHaveLength(2106);
  s.db
    .prepare("UPDATE data_sources SET status=? WHERE id=?")
    .run("disconnected", "old");
  expect(
    flowState(s, "2025-01", "USD")
      .links.filter((l) => l.kind === "Spending")
      .reduce((sum, l) => sum + l.amount, 0),
  ).toBe(2105);
  const accounts = r.accounts();
  expect(accounts).toHaveLength(2);
  expect(r.history("all")[0].canonicalTransactionId).not.toBe(
    r.history("all").at(-1)!.canonicalTransactionId,
  );
  const a = accounts.find((a) => a.connection === "old")!;
  const p = r.transactions(a.canonicalAccountId, { limit: 2 });
  expect(p.rows).toHaveLength(2);
  expect(p.nextCursor).toBeTruthy();
  expect(
    r.transactions(a.canonicalAccountId, { limit: 2, cursor: p.nextCursor! })
      .rows[0].id,
  ).not.toBe(p.rows[0].id);
  s.setAccountHidden("old", "a", true);
  expect(r.history("included")).toHaveLength(1);
  expect(r.history("all")).toHaveLength(2106);
  expect(r.coverage(a.canonicalAccountId)[0].oldestPosted).toBe("2025-01-01");
  s.db.close();
});
import { billState, installBills, groupKey } from "../server/bills";
import { incomeState } from "../server/income";
import { flowState } from "../server/flow";
import { transferCandidates, transferState } from "../server/transfers";
it("maps legacy decisions and exclusions exactly, retains stale evidence and provenance", () => {
  const s = new Store(":memory:", Buffer.alloc(32), "sandbox");
  installBills(s);
  s.connect("c", "token", [
    { account_id: "a", name: "Checking", type: "depository" },
    { account_id: "b", name: "Savings", type: "depository" },
  ]);
  s.connect("other", "token", [
    { account_id: "a", name: "Checking", type: "depository" },
  ]);
  const put = s.db.prepare(
    "INSERT INTO transactions VALUES(?,?,?,?,?,?,?,?,?)",
  );
  for (const source of ["c", "other"])
    for (const [i, date] of [
      "2026-08-01",
      "2026-09-01",
      "2026-10-01",
    ].entries())
      for (const [name, amount] of [
        ["Power", "30"],
        ["Employer payroll", "-100"],
      ])
        put.run(s.env, source, name + i, "a", date, name, amount, "USD", 0);
  const raw = s.db
    .prepare("SELECT * FROM transactions WHERE connection=?")
    .all("c") as any[];
  const power = raw.find((t) => t.name === "Power")!,
    pay = raw.find((t) => t.name === "Employer payroll")!;
  s.db
    .prepare("INSERT INTO bills VALUES(?,?,?,?,?)")
    .run(s.env, groupKey(power), "Electric", "saved", '["Power0","vanished"]');
  s.db
    .prepare("INSERT INTO bills VALUES(?,?,?,?,?)")
    .run(
      s.env,
      groupKey({ ...power, name: "gone" }),
      "Old bill",
      "dismissed",
      "[]",
    );
  incomeState(s);
  s.db
    .prepare("INSERT INTO income_decisions VALUES(?,?,?,?)")
    .run(s.env, groupKey(pay), "Salary", "dismissed");
  for (const [id, account, amount] of [
    ["out", "a", "50"],
    ["in", "b", "-50"],
  ])
    put.run(
      s.env,
      "c",
      id,
      account,
      "2026-10-05",
      "Transfer",
      amount,
      "USD",
      0,
    );
  const legacy = s.db
    .prepare(
      "SELECT t.id,t.connection,t.account,t.date,t.name,t.amount,t.currency,t.pending,at.type AS account_type FROM transactions t JOIN accounts a ON a.env=t.env AND a.connection=t.connection AND a.id=t.account LEFT JOIN account_types at ON at.env=t.env AND at.connection=t.connection AND at.account=t.account WHERE t.env=? ORDER BY t.connection,t.id",
    )
    .all(s.env);
  transferState(s);
  const key = transferCandidates(legacy)[0].key;
  s.db
    .prepare("INSERT INTO transfer_decisions VALUES(?,?,?)")
    .run(s.env, key, "rejected");
  s.db
    .prepare("INSERT INTO transfer_decisions VALUES(?,?,?)")
    .run(s.env, "stale", "confirmed");
  const bills = billState(s, 12, new Date("2026-11-07"));
  expect(bills.saved[0].transactions).toHaveLength(2);
  expect(bills.suggestions).toHaveLength(1);
  expect(bills.unresolved).toHaveLength(1);
  expect(bills.unresolvedExclusions[0].legacyId).toBe("vanished");
  expect(bills.saved[0].typical).toBe(30);
  expect(incomeState(s, new Date("2026-11-07")).dismissed).toHaveLength(1);
  s.db.prepare("UPDATE income_decisions SET status=?").run("saved");
  expect(incomeState(s, new Date("2026-11-07")).saved[0].typical).toBe(100);
  expect(transferState(s).rejected).toHaveLength(1);
  expect(transferState(s).unresolved).toHaveLength(1);
  s.db
    .prepare("UPDATE transfer_decisions SET status=? WHERE key=?")
    .run("confirmed", key);
  expect(transferState(s).confirmed).toHaveLength(1);
  expect(
    s.db
      .prepare("SELECT * FROM decision_id_aliases WHERE kind=?")
      .all("transfer_decisions"),
  ).toHaveLength(1);
  s.db.close();
});
it("isolates environments, preserves owner choices and raw text during source updates", () => {
  const s = new Store(":memory:", Buffer.alloc(32), "sandbox");
  s.connect("same", "token", [
    { account_id: "a", name: "Provider", type: "depository" },
  ]);
  const p = new Store(s.db, Buffer.alloc(32), "production");
  p.connect("same", "token", [
    { account_id: "a", name: "Provider", type: "depository" },
  ]);
  const tx = (id: string) => ({
    transaction_id: id,
    account_id: "a",
    date: "2026-01-01",
    name: "Original statement",
    merchant_name: "Merchant",
    amount: 1.2,
    iso_currency_code: "USD",
    pending: false,
  });
  s.commit(
    "same",
    [{ added: [tx("equal1"), tx("equal2")], modified: [], removed: [] }],
    "1",
    [],
  );
  p.commit(
    "same",
    [{ added: [tx("equal1")], modified: [], removed: [] }],
    "1",
    [],
  );
  expect(s.repository.history("all")).toHaveLength(2);
  expect(p.repository.history("all")).toHaveLength(1);
  expect(s.repository.history("all")[0].rawName).toBe("Original statement");
  const account = s.accountList()[0];
  s.db
    .prepare("UPDATE app_accounts SET name=?,included=0 WHERE id=?")
    .run("Owner", account.canonicalAccountId);
  s.accounts("same", [
    { account_id: "a", name: "Changed provider", type: "credit" },
  ]);
  expect(s.accountList()[0].name).toBe("Owner");
  expect(s.repository.history("included")).toHaveLength(0);
  s.commit(
    "same",
    [{ added: [], modified: [], removed: [{ transaction_id: "equal1" }] }],
    "2",
    [],
  );
  expect(p.repository.history("all")).toHaveLength(1);
  expect(s.repository.history("all")).toHaveLength(1);
  s.db.close();
});
it("keeps canonical decisions stable across unrelated provider metadata and accepts current exclusions", () => {
  const s = new Store(":memory:", Buffer.alloc(32), "sandbox");
  installBills(s);
  s.connect("c", "token", [
    { account_id: "a", name: "A", mask: "1234", type: "depository" },
    { account_id: "b", name: "B", type: "depository" },
  ]);
  const put = s.db.prepare(
    "INSERT INTO transactions VALUES(?,?,?,?,?,?,?,?,?)",
  );
  for (const [i, date] of ["2026-08-01", "2026-09-01", "2026-10-01"].entries())
    put.run(s.env, "c", "bill" + i, "a", date, "Power", "10", "USD", 0);
  const b = billState(s, 12, new Date("2026-11-07")).suggestions[0];
  s.db
    .prepare("INSERT INTO bills VALUES(?,?,?,?,?)")
    .run(s.env, b.key, "Power", "saved", '["bill0"]');
  expect(
    billState(s, 12, new Date("2026-11-07")).saved[0].transactions,
  ).toHaveLength(2);
  for (const [id, account, amount] of [
    ["out", "a", "50"],
    ["in", "b", "-50"],
  ])
    put.run(
      s.env,
      "c",
      id,
      account,
      "2026-10-01",
      "Transfer",
      amount,
      "USD",
      0,
    );
  const p = transferState(s).confirmed[0];
  s.db
    .prepare("INSERT INTO transfer_decisions VALUES(?,?,?)")
    .run(s.env, p.key, "rejected");
  s.accounts("c", [
    { account_id: "a", name: "New name", mask: "5678", type: "depository" },
  ]);
  expect(transferState(s).rejected).toHaveLength(1);
  s.db.close();
});
it("edits and clears migrated decisions without reviving original keys", () => {
  const s = new Store(":memory:", Buffer.alloc(32), "sandbox");
  installBills(s);
  s.connect("c", "token", [{ account_id: "a", name: "A", type: "depository" }]);
  for (const [i, date] of ["2026-08-01", "2026-09-01", "2026-10-01"].entries())
    s.db
      .prepare("INSERT INTO transactions VALUES(?,?,?,?,?,?,?,?,?)")
      .run(s.env, "c", String(i), "a", date, "Power", "10", "USD", 0);
  const legacy = s.db
    .prepare("SELECT * FROM transactions LIMIT 1")
    .get() as any;
  const old = groupKey(legacy);
  s.db
    .prepare("INSERT INTO bills VALUES(?,?,?,?,?)")
    .run(s.env, old, "Old", "saved", "[]");
  const key = billState(s, 12, new Date("2026-11-07")).saved[0].key;
  s.repository.writeDecision("bills", {
    key,
    name: "New",
    status: "saved",
    excluded: [],
  });
  expect(
    billState(s, 12, new Date("2026-11-07")).saved.map((b) => b.name),
  ).toEqual(["New"]);
  s.repository.writeDecision("bills", { key, status: "review" });
  expect(billState(s, 12, new Date("2026-11-07")).saved).toHaveLength(0);
  expect(billState(s, 12, new Date("2026-11-07")).suggestions).toHaveLength(1);
  expect(
    (
      s.db
        .prepare("SELECT payload FROM decision_history WHERE legacy_key=?")
        .get(old) as any
    ).payload,
  ).toContain("Old");
  s.db.close();
});
it("retains contradictory transfer decisions for review instead of choosing one", () => {
  const s = new Store(":memory:", Buffer.alloc(32), "sandbox");
  s.connect("c", "token", [
    { account_id: "a", name: "A", type: "depository" },
    { account_id: "b", name: "B", type: "depository" },
  ]);
  for (const [id, account, amount] of [
    ["out", "a", "50"],
    ["in", "b", "-50"],
  ])
    s.db
      .prepare("INSERT INTO transactions VALUES(?,?,?,?,?,?,?,?,?)")
      .run(s.env, "c", id, account, "2026-10-01", "Transfer", amount, "USD", 0);
  const canonical = transferState(s).confirmed[0].key;
  const raw = s.db
    .prepare(
      "SELECT t.id,t.connection,t.account,t.date,t.name,t.amount,t.currency,t.pending,at.type AS account_type FROM transactions t JOIN accounts a ON a.env=t.env AND a.connection=t.connection AND a.id=t.account LEFT JOIN account_types at ON at.env=t.env AND at.connection=t.connection AND at.account=t.account WHERE t.env=? ORDER BY t.connection,t.id",
    )
    .all(s.env);
  const old = transferCandidates(raw)[0].key;
  s.db
    .prepare("INSERT INTO transfer_decisions VALUES(?,?,?)")
    .run(s.env, old, "confirmed");
  s.db
    .prepare("INSERT INTO transfer_decisions VALUES(?,?,?)")
    .run(s.env, canonical, "rejected");
  const state = transferState(s);
  expect(state.confirmed).toHaveLength(0);
  expect(state.rejected).toHaveLength(0);
  expect(state.review).toHaveLength(1);
  expect(state.unresolved).toHaveLength(2);
  s.db.close();
});
it("does not count equivalent legacy and canonical bill decisions twice", () => {
  const s = new Store(":memory:", Buffer.alloc(32), "sandbox");
  installBills(s);
  s.connect("c", "token", [{ account_id: "a", name: "A" }]);
  for (const [i, date] of ["2026-08-01", "2026-09-01", "2026-10-01"].entries())
    s.db
      .prepare("INSERT INTO transactions VALUES(?,?,?,?,?,?,?,?,?)")
      .run(s.env, "c", String(i), "a", date, "Power", "10", "USD", 0);
  const row = s.repository.history("all")[0];
  for (const key of [
    groupKey(row),
    groupKey({ ...row, canonicalAccountId: undefined }),
  ])
    s.db
      .prepare("INSERT INTO bills VALUES(?,?,?,?,?)")
      .run(s.env, key, "Power", "saved", "[]");
  expect(billState(s, 12, new Date("2026-11-07")).saved).toHaveLength(1);
  s.db.close();
});
