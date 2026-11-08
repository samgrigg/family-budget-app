import { it, expect } from "vitest";
import { Store } from "../server/store";
import { AccountLinking } from "../server/account-linking";
import { billState, installBills, groupKey } from "../server/bills";
import { incomeState } from "../server/income";
import { transferState, transferCandidates } from "../server/transfers";
import { flowState } from "../server/flow";
function fixture() {
  const s = new Store(":memory:", Buffer.alloc(32), "sandbox");
  installBills(s);
  incomeState(s);
  transferState(s);
  for (const source of ["left", "right"])
    s.connect(source, "token", [
      {
        account_id: "a",
        name: source,
        type: "depository",
        subtype: "checking",
        mask: "1234",
      },
    ]);
  const [a, b] = s.repository.listAccounts();
  s.db
    .prepare("UPDATE app_accounts SET institution_id=? WHERE env=?")
    .run(a.institutionId, s.env);
  s.db
    .prepare("UPDATE app_institutions SET provisional=0 WHERE env=?")
    .run(s.env);
  const add = (
    source: string,
    id: string,
    date = "2026-10-01",
    name = "Power",
    amount = "10",
    pending = 0,
  ) =>
    s.db
      .prepare("INSERT INTO transactions VALUES(?,?,?,?,?,?,?,?,?)")
      .run(s.env, source, id, "a", date, name, amount, "USD", pending);
  for (const source of ["left", "right"])
    for (const [i, date] of [
      "2026-08-01",
      "2026-09-01",
      "2026-10-01",
    ].entries())
      add(source, `p${i}`, date);
  const linking = new AccountLinking(s);
  const link = (extra: any = {}) => {
    const review = linking.review(a.id, b.id);
    return linking.link({
      leftId: a.id,
      rightId: b.id,
      confirm: true,
      name: "Household",
      included: true,
      preferredSourceId: "right",
      decisions: {},
      reviewToken: review.token,
      ...extra,
    });
  };
  return { s, a, b, add, linking, link };
}
it("requires multiple posted signatures and compatible institution/type, never shared masks alone", () => {
  const { s, a, b, linking } = fixture();
  expect(linking.suggestions()[0]).toMatchObject({
    confidence: "strong",
    linkable: true,
  });
  s.db.prepare("DELETE FROM transactions WHERE id<>?").run("p0");
  expect(linking.suggestions()).toHaveLength(0);
  s.db.prepare("UPDATE transactions SET pending=1").run();
  expect(linking.review(a.id, b.id).evidence.matchingSignatures).toBe(0);
  s.db
    .prepare("UPDATE app_accounts SET institution_id=? WHERE id=?")
    .run(b.institutionId, b.id);
  expect(linking.review(a.id, b.id).linkable).toBe(false);
  s.db.close();
});
it("allows low-confidence provisional review, rejects explicit subtype mismatch and no overlap", () => {
  const { s, a, b, linking } = fixture();
  s.db
    .prepare("UPDATE app_accounts SET institution_id=? WHERE id=?")
    .run(b.institutionId, b.id);
  s.db.prepare("UPDATE app_institutions SET provisional=1").run();
  expect(linking.review(a.id, b.id)).toMatchObject({
    confidence: "review",
    linkable: true,
  });
  s.db
    .prepare("UPDATE app_accounts SET subtype=? WHERE id=?")
    .run("savings", b.id);
  expect(linking.review(a.id, b.id).linkable).toBe(false);
  s.db.prepare("DELETE FROM transactions WHERE connection=?").run("right");
  expect(linking.suggestions()).toHaveLength(0);
  s.db.close();
});
it("links unique canonical accounts, preserves raw rows and stable events through preference and sync changes", () => {
  const { s, a, b, linking, link } = fixture();
  const op = link();
  expect(s.repository.listAccounts().map((a) => a.id)).toEqual([a.id]);
  const rows = s.repository.history("all");
  expect(rows).toHaveLength(3);
  expect(rows.every((t) => t.connection === "right")).toBe(true);
  expect(s.db.prepare("SELECT * FROM transactions").all()).toHaveLength(6);
  const ids = rows.map((t) => t.canonicalTransactionId);
  linking.prefer(op.id, "left");
  expect(
    s.repository.history("all").map((t) => t.canonicalTransactionId),
  ).toEqual(ids);
  s.commit(
    "left",
    [{ added: [], modified: [], removed: [{ transaction_id: "p0" }] }],
    "next",
    [],
  );
  expect(
    s.repository.history("all").map((t) => t.canonicalTransactionId),
  ).toEqual(ids);
  expect(s.repository.accountTransactions(a.id).rows).toHaveLength(6 - 1);
  expect(linking.redirects()).toEqual([{ env: s.env, from: b.id, to: a.id }]);
  expect(() => s.deleteAccount(a.id)).toThrow(/Disconnect every source/);
  linking.unlink(op.id, { confirm: true });
  expect(s.repository.listAccounts()).toHaveLength(2);
  expect(linking.redirects()).toEqual([]);
  s.db.close();
});
it("matches multiplicity one-to-one, retains same-source purchases and flags unequal/description ambiguity", () => {
  const { s, a, add, link } = fixture();
  add("left", "repeat");
  add("right", "repeat");
  link();
  expect(s.repository.history("all")).toHaveLength(4);
  add("left", "third");
  expect(s.repository.history("all")).toHaveLength(2);
  expect(s.repository.dataIssues()[0]).toMatchObject({
    kind: "ambiguous_overlap",
    accountId: a.id,
    count: 5,
  });
  expect(s.repository.accountTransactions(a.id).rows).toHaveLength(9);
  expect(flowState(s, "2026-10", "USD").dataIssues).toHaveLength(1);
  add("left", "uncertain", "2026-10-02", "Store one", "25");
  add("right", "uncertain", "2026-10-02", "Store two", "25");
  expect(s.repository.dataIssues()).toHaveLength(2);
  s.db.close();
});
it("requires reviewed classification choices and preserves exclusions across preferred source changes", () => {
  const { s, a, b, linking, link } = fixture();
  const raw = s.repository.history("all");
  for (const id of [a.id, b.id]) {
    const row = raw.find((t) => t.canonicalAccountId === id);
    s.repository.writeDecision("bills", {
      key: groupKey(row),
      name: id === a.id ? "Electric" : "Power",
      status: "saved",
      excluded: [row.canonicalTransactionId],
    });
  }
  const review = linking.review(a.id, b.id);
  expect(review.decisions).toHaveLength(1);
  expect(() => link()).toThrow(/classification/);
  const choices = Object.fromEntries(
    review.decisions.map((d: any) => [d.id, d.options[0].id]),
  );
  const op = link({ decisions: choices });
  expect(
    billState(s, 12, new Date("2026-11-07")).saved[0].transactions,
  ).toHaveLength(2);
  linking.prefer(op.id, "left");
  expect(
    billState(s, 12, new Date("2026-11-07")).saved[0].transactions,
  ).toHaveLength(2);
  linking.unlink(op.id, { confirm: true });
  expect(billState(s, 12, new Date("2026-11-07")).saved).toHaveLength(2);
  s.db.close();
});
it("provides reachable unlink conflict choices and leaves unrelated later edits untouched", () => {
  const { s, a, b, linking, link } = fixture();
  const op = link();
  s.db
    .prepare("UPDATE app_accounts SET name=? WHERE env=? AND id=?")
    .run("Later", s.env, a.id);
  const row = s.repository.history("all")[0];
  s.repository.writeDecision("bills", {
    key: groupKey(row),
    name: "New bill",
    status: "saved",
    excluded: [],
  });
  expect(linking.unlinkReview(op.id).conflicts.length).toBeGreaterThan(0);
  expect(() => linking.unlink(op.id, { confirm: true })).toThrow(/resolution/);
  linking.unlink(op.id, { confirm: true, resolution: "keep_survivor" });
  expect(s.repository.listAccounts().find((x) => x.id === a.id)?.name).toBe(
    "Later",
  );
  expect(s.repository.listAccounts().find((x) => x.id === b.id)?.name).toBe(
    "right",
  );
  expect(billState(s, 12, new Date("2026-11-07")).saved[0].name).toBe(
    "New bill",
  );
  s.db.close();
});
it("preserves an explicit rejected transfer across source preference switches and restores it on unlink", () => {
  const { s, a, add, linking, link } = fixture();
  s.accounts("left", [
    { account_id: "savings", name: "Savings", type: "depository" },
  ]);
  for (const src of ["left", "right"])
    add(src, "out", "2026-10-05", "Transfer to savings", "40");
  s.db
    .prepare("INSERT INTO transactions VALUES(?,?,?,?,?,?,?,?,?)")
    .run(
      s.env,
      "left",
      "in",
      "savings",
      "2026-10-05",
      "Transfer from checking",
      "-40",
      "USD",
      0,
    );
  const initial = transferState(s);
  const rejected = initial.review.find((p) => p.out.connection === "right")!;
  s.repository.writeDecision("transfer_decisions", {
    key: rejected.key,
    status: "rejected",
  });
  const b = s.repository.listAccounts().find((x) => x.name === "right")!;
  const review = linking.review(a.id, b.id);
  const decisions = Object.fromEntries(
    review.decisions.map((d: any) => [d.id, d.options[0].id]),
  );
  const op = link({ decisions });
  expect(transferState(s).rejected).toHaveLength(1);
  linking.prefer(op.id, "left");
  expect(transferState(s).rejected).toHaveLength(1);
  linking.unlink(op.id, { confirm: true });
  expect(transferState(s).rejected).toHaveLength(1);
  s.db.close();
});
it("does not apply linked events or redirects in another environment and blocks stacked operations", () => {
  const { s, a, b, linking, link } = fixture();
  const op = link();
  const p = new Store(s.db, Buffer.alloc(32), "production");
  p.connect("left", "token", [{ account_id: "a", name: "Production" }]);
  expect(new AccountLinking(p).redirects()).toEqual([]);
  expect(p.repository.listAccounts()).toHaveLength(1);
  s.connect("third", "token", [
    { account_id: "a", name: "Third", type: "depository", subtype: "checking" },
  ]);
  const third = s.repository.listAccounts().find((x) => x.name === "Third")!;
  expect(linking.review(a.id, third.id).blockingOperationId).toBe(op.id);
  expect(
    s.db
      .prepare("SELECT * FROM app_accounts WHERE env=? AND id=?")
      .get(s.env, b.id),
  ).toBeTruthy();
  s.db.close();
});
it("terminalizes link operations on permanent deletion so unlink cannot resurrect history", () => {
  const { s, a, linking, link } = fixture();
  const op = link();
  s.db.prepare("UPDATE data_sources SET status='historical'").run();
  s.db.prepare("UPDATE connections SET status='historical',token=NULL").run();
  s.deleteAccount(a.id);
  expect(linking.operations()[0].status).toBe("deleted");
  expect(() => linking.unlink(op.id, { confirm: true })).toThrow(/not found/);
  expect(s.repository.listAccounts()).toHaveLength(0);
  expect(s.repository.rawHistory()).toHaveLength(0);
  s.db.close();
});
it("does not move a surviving repeated purchase onto the removed purchase event identity", () => {
  const { s, add, link } = fixture();
  add("left", "zz");
  add("right", "zz");
  link();
  const before = s.repository
    .history("all")
    .find((t) => t.id === "zz")!.canonicalTransactionId;
  for (const source of ["left", "right"])
    s.commit(
      source,
      [{ added: [], modified: [], removed: [{ transaction_id: "p2" }] }],
      "next",
      [],
    );
  expect(
    s.repository.history("all").find((t) => t.id === "zz")!
      .canonicalTransactionId,
  ).toBe(before);
  s.db.close();
});
it("keeps a later rejected transfer explicit when unlinking with keep-survivor", () => {
  const { s, add, linking, link } = fixture();
  s.accounts("left", [
    { account_id: "savings", name: "Savings", type: "depository" },
  ]);
  for (const src of ["left", "right"])
    add(src, "out", "2026-10-05", "Transfer to savings", "40");
  s.db
    .prepare("INSERT INTO transactions VALUES(?,?,?,?,?,?,?,?,?)")
    .run(
      s.env,
      "left",
      "in",
      "savings",
      "2026-10-05",
      "Transfer from checking",
      "-40",
      "USD",
      0,
    );
  const op = link();
  const pair = transferState(s).confirmed[0];
  s.repository.writeDecision("transfer_decisions", {
    key: pair.key,
    status: "rejected",
  });
  linking.unlink(op.id, { confirm: true, resolution: "keep_survivor" });
  expect(transferState(s).rejected).toHaveLength(1);
  expect(transferState(s).unresolved).toHaveLength(0);
  s.db.close();
});
it("coalesces contradictory source transfer decisions into one explicit choice", () => {
  const { s, a, b, add, linking, link } = fixture();
  s.accounts("left", [
    { account_id: "savings", name: "Savings", type: "depository" },
  ]);
  for (const src of ["left", "right"])
    add(src, "out", "2026-10-05", "Transfer to savings", "40");
  s.db
    .prepare("INSERT INTO transactions VALUES(?,?,?,?,?,?,?,?,?)")
    .run(
      s.env,
      "left",
      "in",
      "savings",
      "2026-10-05",
      "Transfer from checking",
      "-40",
      "USD",
      0,
    );
  const pairs = transferState(s).review;
  for (const p of pairs)
    s.repository.writeDecision("transfer_decisions", {
      key: p.key,
      status: p.out.connection === "left" ? "rejected" : "confirmed",
    });
  const review = linking.review(a.id, b.id);
  const group = review.decisions.find(
    (g: any) => g.kind === "transfer_decisions",
  );
  expect(group.options).toHaveLength(2);
  expect(
    review.decisions.filter((g: any) => g.kind === "transfer_decisions"),
  ).toHaveLength(1);
  link({
    decisions: {
      [group.id]: group.options.find((o: any) => o.status === "rejected").id,
    },
  });
  expect(transferState(s).rejected).toHaveLength(1);
  expect(transferState(s).confirmed).toHaveLength(0);
  s.db.close();
});
it("keeps linked transfer decisions stable across normalized provider description and amount formatting", () => {
  const { s, a, b, add, linking, link } = fixture();
  s.accounts("left", [
    { account_id: "savings", name: "Savings", type: "depository" },
  ]);
  add("left", "out", "2026-10-05", "TRANSFER TO SAVINGS", "40.00");
  add("right", "out", "2026-10-05", "Transfer to savings", "40");
  s.db
    .prepare("INSERT INTO transactions VALUES(?,?,?,?,?,?,?,?,?)")
    .run(
      s.env,
      "left",
      "in",
      "savings",
      "2026-10-05",
      "Transfer from checking",
      "-40",
      "USD",
      0,
    );
  const op = link();
  const pair = transferState(s).confirmed[0];
  s.repository.writeDecision("transfer_decisions", {
    key: pair.key,
    status: "rejected",
  });
  linking.prefer(op.id, "left");
  expect(transferState(s).rejected).toHaveLength(1);
  expect(transferState(s).confirmed).toHaveLength(0);
  s.db.close();
});
it("does not leave link-time decision aliases that can erase another account after unlink", () => {
  const { s, a, b, linking, link } = fixture();
  for (const t of s.repository.rawHistory().filter((t) => t.id === "p0"))
    s.repository.writeDecision("bills", {
      key: groupKey({ ...t, canonicalAccountId: undefined }),
      name: t.connection,
      status: "saved",
      excluded: [],
    });
  const review = linking.review(a.id, b.id);
  const op = link({
    decisions: Object.fromEntries(
      review.decisions.map((g: any) => [g.id, g.options[0].id]),
    ),
  });
  billState(s, 12, new Date("2026-11-07"));
  linking.unlink(op.id, { confirm: true });
  const winner = s.repository
    .rawHistory()
    .find((t) => t.canonicalAccountId === a.id)!;
  s.repository.writeDecision("bills", {
    key: groupKey(winner),
    status: "review",
  });
  expect(billState(s, 12, new Date("2026-11-07")).saved).toHaveLength(1);
  s.db.close();
});
it("reconciles several exact descriptions at the same date and amount independently", () => {
  const { s, add, link } = fixture();
  for (const src of ["left", "right"])
    add(src, "another", "2026-10-01", "Other store", "10");
  link();
  expect(s.repository.history("all")).toHaveLength(4);
  expect(s.repository.dataIssues()).toHaveLength(0);
  s.db.close();
});
it("handles three mapped sources without double-counting and retains all source provenance", () => {
  const { s, a, link } = fixture();
  link();
  s.connect("third", "token", [
    { account_id: "a", name: "Third", type: "depository" },
  ]);
  for (const [i, date] of ["2026-08-01", "2026-09-01", "2026-10-01"].entries())
    s.db
      .prepare("INSERT INTO transactions VALUES(?,?,?,?,?,?,?,?,?)")
      .run(s.env, "third", `p${i}`, "a", date, "Power", "10", "USD", 0);
  // Synthetic future replacement mapping: repository must not assume exactly two sources.
  for (const table of ["source_accounts", "account_id_aliases"])
    s.db
      .prepare(`UPDATE ${table} SET account_id=? WHERE env=? AND source_id=?`)
      .run(a.id, s.env, "third");
  const rows = s.repository.history("all");
  expect(rows).toHaveLength(3);
  expect(rows[0].provenance).toHaveLength(3);
  expect(s.repository.dataIssues()).toHaveLength(0);
  s.db.close();
});
it("shows source attribution and exact exclusion evidence for conflicting bill choices", () => {
  const { s, a, b, linking } = fixture();
  const t = s.repository.rawHistory()[0];
  s.repository.writeDecision("bills", {
    key: groupKey(t),
    name: "Electric",
    status: "saved",
    excluded: [t.canonicalTransactionId],
  });
  const detail = linking.review(a.id, b.id).decisions[0].details[0];
  expect(detail.accountName).toBe("left");
  expect(detail.exclusions[0]).toMatchObject({
    date: "2026-08-01",
    name: "Power",
    amount: "10",
    currency: "USD",
  });
  s.db.close();
});
it("finds legacy transfer decisions directly from evidence before any transfer reader has registered aliases", () => {
  const { s, a, b, add, linking } = fixture();
  s.accounts("left", [
    { account_id: "savings", name: "Savings", type: "depository" },
  ]);
  for (const src of ["left", "right"])
    add(src, "out", "2026-10-05", "Transfer to savings", "40");
  s.db
    .prepare("INSERT INTO transactions VALUES(?,?,?,?,?,?,?,?,?)")
    .run(
      s.env,
      "left",
      "in",
      "savings",
      "2026-10-05",
      "Transfer from checking",
      "-40",
      "USD",
      0,
    );
  const raw = s.db
    .prepare(
      "SELECT t.id,t.connection,t.account,t.date,t.name,t.amount,t.currency,t.pending,at.type AS account_type FROM transactions t LEFT JOIN account_types at ON at.env=t.env AND at.connection=t.connection AND at.account=t.account WHERE t.env=?",
    )
    .all(s.env);
  const pair = transferCandidates(raw)[0];
  s.db
    .prepare("INSERT INTO transfer_decisions VALUES(?,?,?)")
    .run(s.env, pair.key, "rejected");
  expect(
    linking
      .review(a.id, b.id)
      .decisions.some(
        (g: any) =>
          g.kind === "transfer_decisions" &&
          g.options.some((o: any) => o.status === "rejected"),
      ),
  ).toBe(true);
  s.db.close();
});
it("never reuses a corrected purchase event for a new transaction with the old signature", () => {
  const { s, add, linking, link } = fixture();
  const op = link();
  const original = s.repository.history("all").find((t) => t.id === "p2")!;
  s.repository.writeDecision("bills", {
    key: groupKey(original),
    name: "Electric",
    status: "saved",
    excluded: [original.canonicalTransactionId],
  });
  const update = (source: string) =>
    s.commit(
      source,
      [
        {
          added: [],
          modified: [
            {
              transaction_id: "p2",
              account_id: "a",
              date: "2026-10-01",
              name: "Power",
              amount: 15,
              iso_currency_code: "USD",
              pending: false,
            },
          ],
          removed: [],
        },
      ],
      "corrected",
      [],
    );
  update("left");
  update("right");
  const corrected = s.repository.history("all").find((t) => t.id === "p2")!;
  expect(corrected.canonicalTransactionId).not.toBe(
    original.canonicalTransactionId,
  );
  for (const source of ["left", "right"]) add(source, "replacement");
  const replacement = s.repository
    .history("all")
    .find((t) => t.id === "replacement")!;
  expect(replacement.canonicalTransactionId).not.toBe(
    original.canonicalTransactionId,
  );
  expect(replacement.canonicalTransactionId).not.toBe(
    corrected.canonicalTransactionId,
  );
  expect(
    billState(s, 12, new Date("2026-11-07")).saved[0].transactions.some(
      (t: any) => t.id === "replacement",
    ),
  ).toBe(true);
  linking.prefer(op.id, "left");
  expect(
    s.repository.history("all").find((t) => t.id === "replacement")!
      .canonicalTransactionId,
  ).toBe(replacement.canonicalTransactionId);
  s.commit(
    "left",
    [
      {
        added: [],
        modified: [],
        removed: [{ transaction_id: "replacement" }, { transaction_id: "p2" }],
      },
    ],
    "removed",
    [],
  );
  const after = s.repository.history("all");
  expect(
    after.find((t) => t.id === "replacement")!.canonicalTransactionId,
  ).toBe(replacement.canonicalTransactionId);
  expect(after.find((t) => t.id === "p2")!.canonicalTransactionId).toBe(
    corrected.canonicalTransactionId,
  );
  expect(after.find((t) => t.id === "replacement")!.connection).toBe("right");
  expect(
    billState(s, 12, new Date("2026-11-07")).saved[0].transactions.some(
      (t: any) => t.id === "replacement",
    ),
  ).toBe(true);
  s.db.close();
});
for (const snapshotVersion of ["current", "v3"])
  for (const foldedStatus of ["rejected", "confirmed"])
    it(`restores the folded account's original ${foldedStatus} transfer from ${snapshotVersion} snapshot while keeping survivor preference edits`, () => {
      const { s, a, b, add, linking, link } = fixture();
      s.accounts("left", [
        { account_id: "savings", name: "Savings", type: "depository" },
      ]);
      for (const src of ["left", "right"])
        add(src, "out", "2026-10-05", "Transfer to savings", "40");
      s.db
        .prepare("INSERT INTO transactions VALUES(?,?,?,?,?,?,?,?,?)")
        .run(
          s.env,
          "left",
          "in",
          "savings",
          "2026-10-05",
          "Transfer from checking",
          "-40",
          "USD",
          0,
        );
      const pairs = transferState(s).review;
      const right = pairs.find((p) => p.out.connection === "right")!,
        left = pairs.find((p) => p.out.connection === "left")!;
      s.repository.writeDecision("transfer_decisions", {
        key: right.key,
        status: foldedStatus,
      });
      s.repository.writeDecision("transfer_decisions", {
        key: left.key,
        status: foldedStatus === "confirmed" ? "rejected" : "confirmed",
      });
      const review = linking.review(a.id, b.id),
        group = review.decisions.find(
          (g: any) => g.kind === "transfer_decisions",
        );
      const op = link({ decisions: { [group.id]: left.key } });
      if (snapshotVersion === "v3") {
        const row = s.db
          .prepare("SELECT snapshot FROM account_links WHERE env=? AND id=?")
          .get(s.env, op.id) as any;
        const snapshot = JSON.parse(row.snapshot);
        for (const g of snapshot.decisions) delete g.optionPairs;
        s.db
          .prepare("UPDATE account_links SET snapshot=? WHERE env=? AND id=?")
          .run(JSON.stringify(snapshot), s.env, op.id);
      }
      s.db
        .prepare("UPDATE app_accounts SET name=? WHERE env=? AND id=?")
        .run("Later owner name", s.env, a.id);
      linking.unlink(op.id, { confirm: true, resolution: "keep_survivor" });
      expect(
        s.db
          .prepare(
            "SELECT status FROM transfer_decisions WHERE env=? AND key=?",
          )
          .get(s.env, right.key),
      ).toEqual({ status: foldedStatus });
      expect(
        s.db
          .prepare(
            "SELECT status FROM transfer_decisions WHERE env=? AND key=?",
          )
          .get(s.env, left.key),
      ).toEqual({
        status: foldedStatus === "confirmed" ? "rejected" : "confirmed",
      });
      expect(s.repository.listAccounts().find((x) => x.id === a.id)?.name).toBe(
        "Later owner name",
      );
      expect(s.repository.listAccounts().find((x) => x.id === b.id)?.name).toBe(
        "right",
      );
      s.db.close();
    });
