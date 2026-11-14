import { expect, it } from "vitest";
import request from "supertest";
import { Store } from "../server/store";
import { createApp } from "../server/app";

it("retains cached balances through sync and exposes zero, missing and currency safely", async () => {
  const s = new Store(":memory:", Buffer.alloc(32), "sandbox");
  s.connect("source", "private-secret", [
    {
      account_id: "a",
      name: "Checking",
      type: "depository",
      balances: { current: 0, available: null, iso_currency_code: "USD" },
    },
    {
      account_id: "b",
      name: "Card",
      type: "credit",
      balances: {
        current: 125.25,
        available: 874.75,
        iso_currency_code: "CAD",
      },
    },
    { account_id: "c", name: "Unknown" },
  ]);
  const app = createApp(
    s,
    {
      configured: true,
      call: async () => {
        throw Error("No provider call expected");
      },
    },
    "http://localhost:3000",
  );
  const get = async () =>
    (await request(app).get("/api/accounts").set("Host", "localhost:3000"))
      .body;
  let body = await get();
  const checking = body.accounts.find((a: any) => a.name === "Checking");
  expect(checking.balance).toMatchObject({
    current: "0",
    available: null,
    currency: "USD",
    sourceId: "source",
    stale: false,
  });
  expect(checking.balance.retrievedAt).toMatch(/^\d{4}-/);
  expect(
    body.accounts.find((a: any) => a.name === "Card").balance,
  ).toMatchObject({ current: "125.25", currency: "CAD" });
  expect(
    body.accounts.find((a: any) => a.name === "Unknown").balance,
  ).toBeNull();
  s.accounts("source", [{ account_id: "a", name: "Checking" }]);
  expect(
    (await get()).accounts.find((a: any) => a.name === "Checking").balance
      .current,
  ).toBe("0");
  s.commit("source", [{ added: [], modified: [], removed: [] }], "cursor", [
    {
      account_id: "a",
      name: "Checking",
      balances: {
        current: 42,
        available: 40,
        unofficial_currency_code: "TEST",
      },
    },
  ]);
  expect(
    (await get()).accounts.find((a: any) => a.name === "Checking").balance,
  ).toMatchObject({ current: "42", available: "40", currency: "TEST" });
  s.accounts("source", [
    {
      account_id: "a",
      name: "Checking",
      balances: { current: null, available: null, iso_currency_code: "USD" },
    },
  ]);
  expect(
    (await get()).accounts.find((a: any) => a.name === "Checking").balance
      .current,
  ).toBeNull();
  s.sourceStatus("source", "historical", true);
  body = await get();
  expect(body.accounts.find((a: any) => a.name === "Card").balance.stale).toBe(
    true,
  );
  expect(JSON.stringify(body)).not.toContain("private-secret");
  s.deleteAccount(checking.id);
  expect(
    s.db
      .prepare(
        "SELECT count(*) AS n FROM account_balances WHERE env=? AND source_id=? AND provider_account_id=?",
      )
      .get("sandbox", "source", "a"),
  ).toEqual({ n: 0 });
  s.db.close();
});

it("selects one preferred active snapshot and withholds staged replacement balances", () => {
  const s = new Store(":memory:", Buffer.alloc(32), "sandbox");
  for (const [source, current] of [
    ["left", 20],
    ["right", 30],
  ] as const)
    s.connect(source, "secret", [
      {
        account_id: "a",
        name: source,
        balances: { current, iso_currency_code: "USD" },
      },
    ]);
  const left = s.repository
    .accounts()
    .find((a) => a.connection === "left").canonicalAccountId;
  s.db
    .prepare(
      "UPDATE source_accounts SET account_id=? WHERE env=? AND source_id=?",
    )
    .run(left, s.env, "right");
  s.db
    .prepare("INSERT INTO account_links VALUES(?,?,?,?,?,?,?,?)")
    .run(s.env, "link", left, "retired", "right", "linked", "{}", "2026-11-11");
  expect(s.repository.balance(left)).toMatchObject({
    current: "30",
    sourceId: "right",
  });
  s.sourceStatus("right", "historical", true);
  expect(s.repository.balance(left)).toMatchObject({
    current: "20",
    sourceId: "left",
    stale: false,
  });
  s.db
    .prepare("INSERT INTO source_replacements VALUES(?,?,?,?,?,?,?)")
    .run(s.env, "replacement", "right", "left", "review", 90, null);
  expect(s.repository.balance(left)).toMatchObject({
    current: "30",
    stale: true,
  });
  s.db
    .prepare("INSERT OR REPLACE INTO source_account_access VALUES(?,?,?,0)")
    .run(s.env, "left", "a");
  s.db.prepare("DELETE FROM source_replacements").run();
  expect(s.repository.balance(left)?.stale).toBe(true);
  s.db.close();
});
