import { it, expect } from "vitest";
import { Store } from "../server/store";
import { billState, installBills } from "../server/bills";

it("hides one account without losing synced data or saved bills, survives sync, and restores views", () => {
  const s = new Store(":memory:", Buffer.alloc(32), "sandbox");
  installBills(s);
  const accounts = [{ account_id: "a", name: "Checking", mask: "1234" }];
  for (const connection of ["one", "two"]) {
    s.connect(connection, "token", accounts);
    s.commit(
      connection,
      [
        {
          added: ["08", "09", "10"].map((month) => ({
            transaction_id: month,
            account_id: "a",
            date: `2026-${month}-01`,
            name: "Power",
            amount: 50,
            iso_currency_code: "USD",
            pending: false,
          })),
          modified: [],
          removed: [],
        },
      ],
      "cursor",
      accounts,
    );
  }
  const now = new Date("2026-11-07");
  const initial = billState(s, 6, now);
  expect(initial.suggestions).toHaveLength(2);
  const bill = initial.suggestions.find((b) => b.connection === "one")!;
  s.db
    .prepare("INSERT INTO bills VALUES(?,?,?,?,?)")
    .run(s.env, bill.key, "Power", "saved", "[]");
  expect(s.setAccountHidden("one", "a", true)).toBe(true);
  s.commit("one", [{ added: [], modified: [], removed: [] }], "next", accounts);
  expect(s.accountList().find((a) => a.connection === "one").hidden).toBe(1);
  expect(s.transactions()).toHaveLength(3);
  expect(s.transactions().every((t) => t.connection === "two")).toBe(true);
  expect(billState(s, 6, now).saved).toHaveLength(0);
  expect(billState(s, 6, now).suggestions).toHaveLength(1);
  expect(s.list()).toHaveLength(2);
  s.setAccountHidden("one", "a", false);
  expect(s.transactions()).toHaveLength(6);
  expect(billState(s, 6, now).saved).toHaveLength(1);
  const prod = new Store(s.db, Buffer.alloc(32), "production");
  expect(prod.setAccountHidden("one", "a", true)).toBe(false);
  expect(prod.accountList()).toHaveLength(0);
  s.setAccountHidden("one", "a", true);
  s.remove("one");
  expect(s.db.prepare("SELECT * FROM account_preferences").all()).toHaveLength(
    0,
  );
  s.db.close();
});

it("preserves institution labels through metadata updates and isolates environments", () => {
  const s = new Store(":memory:", Buffer.alloc(32), "sandbox");
  s.connect("one", "token", []);
  s.nameInstitution("one", "Example Bank");
  s.nameInstitution("one", "Household", true);
  s.nameInstitution("one", "Example Bank updated");
  expect(s.list()[0].display_name).toBe("Household");
  expect(s.list()[0].institution_name).toBe("Example Bank updated");
  const prod = new Store(s.db, Buffer.alloc(32), "production");
  prod.connect("one", "token", []);
  expect(prod.list()[0].display_name).toBeNull();
  s.remove("one");
  expect(s.db.prepare("SELECT * FROM institution_details").all()).toHaveLength(
    0,
  );
  s.db.close();
});
