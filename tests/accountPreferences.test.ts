import { describe, it, expect } from "vitest";
import {
  migrateHiddenAccounts,
  loadHiddenAccounts,
  saveHiddenAccounts,
} from "../web/accountPreferences";
describe("environment chart preferences", () => {
  const aliases = [
    {
      env: "sandbox",
      source_id: "s",
      provider_account_id: "a",
      account_id: "canonical",
    },
    {
      env: "production",
      source_id: "s",
      provider_account_id: "a",
      account_id: "other",
    },
  ];
  it("maps exact aliases only and retains unmatched values", () => {
    expect(
      migrateHiddenAccounts(
        ['account:["s","a"]', 'account:["s","stale"]'],
        aliases,
        "sandbox",
      ),
    ).toEqual({
      mapped: ["account:canonical"],
      unmatched: ['account:["s","stale"]'],
    });
  });
  it("keeps already canonical IDs only in their known environment", () => {
    expect(
      migrateHiddenAccounts(
        ["account:canonical", "account:other"],
        aliases,
        "sandbox",
      ),
    ).toEqual({ mapped: ["account:canonical"], unmatched: ["account:other"] });
  });
  it("migrates once per environment without destroying legacy preferences", () => {
    const values = new Map([
      ["flow-hidden-accounts", JSON.stringify(['account:["s","a"]'])],
    ]);
    const storage = {
      getItem: (k: string) => values.get(k) || null,
      setItem: (k: string, v: string) => {
        values.set(k, v);
      },
    };
    expect(loadHiddenAccounts(storage, "sandbox", aliases)).toEqual([
      "account:canonical",
    ]);
    storage.setItem("flow-hidden-accounts:sandbox", "[]");
    expect(loadHiddenAccounts(storage, "sandbox", aliases)).toEqual([]);
    expect(loadHiddenAccounts(storage, "production", aliases)).toEqual([
      "account:other",
    ]);
    expect(storage.getItem("flow-hidden-accounts")).toContain("s");
  });
});
it("projects linked hidden accounts once, preserves explicit choices, restores unedited chart preferences on unlink", () => {
  const values = new Map([
    ["flow-hidden-accounts:sandbox", JSON.stringify(["account:loser"])],
    ["flow-hidden-accounts:sandbox:migrated", "1"],
  ]);
  const storage = {
    getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => {
      values.set(k, v);
    },
  };
  const redirects = [{ env: "sandbox", from: "loser", to: "winner" }];
  expect(loadHiddenAccounts(storage, "sandbox", [], redirects)).toEqual([
    "account:loser",
    "account:winner",
  ]);
  expect(loadHiddenAccounts(storage, "sandbox", [], [])).toEqual([
    "account:loser",
  ]);
  expect(loadHiddenAccounts(storage, "production", [], redirects)).toEqual([]);
  loadHiddenAccounts(storage, "sandbox", [], redirects);
  saveHiddenAccounts(storage, "sandbox", ["account:loser"]);
  expect(loadHiddenAccounts(storage, "sandbox", [], redirects)).toEqual([
    "account:loser",
  ]);
  saveHiddenAccounts(storage, "sandbox", ["account:loser", "account:winner"]);
  expect(loadHiddenAccounts(storage, "sandbox", [], [])).toEqual([
    "account:loser",
    "account:winner",
  ]);
});
