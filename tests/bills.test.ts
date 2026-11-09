import { it, expect } from "vitest";
import { candidates } from "../server/bills";
const rows = (dates: string[], amounts = [50, 95, 62]) =>
  dates.map((date, i) => ({
    id: String(i),
    connection: "c",
    account: "a",
    name: "Electric Co",
    currency: "USD",
    amount: String(amounts[i % amounts.length]),
    date,
    pending: 0,
  }));
it("finds monthly variable bills despite posting drift", () => {
  const c = candidates(rows(["2026-01-30", "2026-03-02", "2026-03-31"]));
  expect(c).toHaveLength(1);
  expect(c[0].frequency).toBe("Monthly");
  expect(c[0].min).toBe(50);
  expect(c[0].max).toBe(95);
});
it("rejects irregular shopping and pending charges", () => {
  expect(
    candidates(
      rows([
        "2026-01-01",
        "2026-01-03",
        "2026-01-28",
        "2026-02-02",
        "2026-02-07",
      ]),
    ),
  ).toHaveLength(0);
  expect(
    candidates(
      rows(["2026-01-01", "2026-02-01", "2026-03-01"]).map((t) => ({
        ...t,
        pending: 1,
      })),
    ),
  ).toHaveLength(0);
});
it("never combines accounts or currencies", () => {
  expect(
    candidates(
      rows(["2026-01-01", "2026-02-01", "2026-03-01"]).map((t, i) => ({
        ...t,
        account: String(i),
      })),
    ),
  ).toHaveLength(0);
});
import { Store } from "../server/store";
import { installBills, billState, groupKey } from "../server/bills";
it("persists decisions, exclusions, and isolates environments", () => {
  const s = new Store(":memory:", Buffer.alloc(32), "sandbox");
  installBills(s);
  const ts = rows(["2026-08-01", "2026-09-01", "2026-10-01"]);
  for (const t of ts)
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
  const now = new Date("2026-11-07");
  const key = groupKey(ts[0]);
  s.db
    .prepare("INSERT INTO bills VALUES(?,?,?,?,?)")
    .run(s.env, key, "Power", "dismissed", "[]");
  expect(billState(s, 6, now).suggestions).toHaveLength(0);
  s.db.prepare("UPDATE bills SET status=?,excluded=?").run("saved", '["0"]');
  expect(billState(s, 6, now).saved[0].transactions).toHaveLength(2);
  expect(
    billState(new Store(s.db, Buffer.alloc(32), "production"), 6, now).saved,
  ).toHaveLength(0);
  s.db.close();
});

it("allows recurring credit-card payments to be suggested as bills", () => {
  const payments = rows(["2026-08-01", "2026-09-01", "2026-10-01"]).map(
    (t) => ({ ...t, name: "Credit card payment" }),
  );
  expect(candidates(payments)).toHaveLength(1);
});
