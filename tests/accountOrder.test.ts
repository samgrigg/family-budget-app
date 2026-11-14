import { expect, it } from "vitest";
import {
  loadAccountOrder,
  saveAccountOrder,
  orderedAccounts,
  moveAccount,
} from "../web/accountOrder";
const accounts = [{ id: "a" }, { id: "b" }, { id: "c" }];
it("keeps a custom order across reloads, isolates environments and appends new accounts", () => {
  const data = new Map<string, string>();
  const storage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  };
  saveAccountOrder(storage, "production", { cash: ["b", "a"] });
  const reloaded = loadAccountOrder(storage, "production");
  expect(orderedAccounts(accounts, reloaded.cash).map((a) => a.id)).toEqual([
    "b",
    "a",
    "c",
  ]);
  expect(loadAccountOrder(storage, "sandbox")).toEqual({});
  expect(
    orderedAccounts(accounts, ["missing", "b", "b"]).map((a) => a.id),
  ).toEqual(["b", "a", "c"]);
});
it("moves before or after the target without losing or duplicating accounts", () => {
  expect(moveAccount(["a", "b", "c"], "a", "b", "after")).toEqual([
    "b",
    "a",
    "c",
  ]);
  expect(moveAccount(["a", "b", "c"], "c", "a", "before")).toEqual([
    "c",
    "a",
    "b",
  ]);
  expect(moveAccount(["a", "b", "c"], "a", "outside", "before")).toEqual([
    "a",
    "b",
    "c",
  ]);
  expect(moveAccount(["a", "b", "c"], "b", "b", "after")).toEqual([
    "a",
    "b",
    "c",
  ]);
});
it("uses the linked account's saved position and restores the old preference on unlink", () => {
  const saved = ["old", "b"];
  expect(
    orderedAccounts([{ id: "winner" }, { id: "b" }], saved, [
      { from: "old", to: "winner" },
    ]).map((a) => a.id),
  ).toEqual(["winner", "b"]);
  expect(
    orderedAccounts([{ id: "b" }, { id: "old" }], saved).map((a) => a.id),
  ).toEqual(["old", "b"]);
});
it("recovers malformed saved preferences and surfaces storage failures", () => {
  expect(loadAccountOrder({ getItem: () => "{broken" }, "production")).toEqual(
    {},
  );
  expect(loadAccountOrder({ getItem: () => "[]" }, "production")).toEqual({});
  expect(
    loadAccountOrder(
      { getItem: () => '{"cash":["a",7,"a"],"cards":"bad"}' },
      "production",
    ),
  ).toEqual({ cash: ["a"] });
  expect(() =>
    saveAccountOrder(
      {
        setItem: () => {
          throw Error("Storage blocked");
        },
      },
      "production",
      { cash: ["b", "a"] },
    ),
  ).toThrow("Storage blocked");
});
