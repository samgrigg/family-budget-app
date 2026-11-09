import { expect, it } from "vitest";
import { Store } from "../server/store";
import { incomeState } from "../server/income";
function fixture() {
  const s = new Store(":memory:", Buffer.alloc(32), "sandbox");
  s.connect("c", "token", [
    { account_id: "a", name: "Checking", type: "depository" },
    { account_id: "b", name: "Savings", type: "depository" },
    { account_id: "card", name: "Card", type: "credit" },
  ]);
  const add = (id: string, account: string, name: string, amount: number) => {
    for (const month of ["08", "09", "10"])
      s.db
        .prepare("INSERT INTO transactions VALUES(?,?,?,?,?,?,?,?,?)")
        .run(
          s.env,
          "c",
          id + month,
          account,
          `2026-${month}-01`,
          name,
          String(amount),
          "USD",
          0,
        );
  };
  return { s, add };
}
it("discovers variable recurring deposits and persists confirmations independently of bills", () => {
  const { s, add } = fixture();
  add("pay", "a", "Employer payroll", -2000);
  const now = new Date("2026-11-07");
  const initial = incomeState(s, now);
  expect(initial.suggestions).toHaveLength(1);
  expect(initial.suggestions[0].typical).toBe(2000);
  const b = initial.suggestions[0];
  s.db
    .prepare("INSERT INTO income_decisions VALUES(?,?,?,?)")
    .run(s.env, b.key, "Salary", "saved");
  expect(incomeState(s, now).suggestions).toHaveLength(0);
  expect(incomeState(s, now).saved[0].name).toBe("Salary");
  s.setAccountHidden("c", "a", true);
  expect(incomeState(s, now).saved).toHaveLength(0);
  s.setAccountHidden("c", "a", false);
  expect(incomeState(s, now).saved).toHaveLength(1);
  expect(
    incomeState(new Store(s.db, Buffer.alloc(32), "production"), now).saved,
  ).toHaveLength(0);
  s.db.close();
});
it("excludes refunds, loan proceeds, card credits, pending entries and paired transfers", () => {
  const { s, add } = fixture();
  add("refund", "a", "Store refund", -20);
  add("loan", "a", "Loan advance", -1000);
  add("card", "card", "Recurring merchant", -100);
  add("in", "a", "Online transfer", -500);
  add("out", "b", "Online transfer", 500);
  add("pending", "a", "Employer payroll", -2000);
  s.db
    .prepare("UPDATE transactions SET pending=1 WHERE id LIKE 'pending%'")
    .run();
  expect(incomeState(s, new Date("2026-11-07")).suggestions).toHaveLength(0);
  s.db.close();
});

import { identifyEmployer, employerForHistory } from "../server/income";
it("identifies payroll senders without treating arbitrary merchants or processors as employers", () => {
  expect(
    identifyEmployer(
      "ACH Deposit COMPANY: EXAMPLE SCHOOL DIST ENTRY: PAYROLL PAYROLL Jane Doe",
    ),
  ).toBe("EXAMPLE SCHOOL DIST");
  expect(identifyEmployer("Example Inc Payroll")).toBe("Example Inc");
  expect(identifyEmployer("Adobe")).toBeNull();
  expect(
    identifyEmployer("ACH Deposit COMPANY: ADP ENTRY: PAYROLL"),
  ).toBeNull();
  expect(
    identifyEmployer("ACH Deposit COMPANY: Example LLC ENTRY: EARNINGS"),
  ).toBeNull();
  expect(
    employerForHistory([
      { name: "Alpha Inc Payroll" },
      { name: "Beta Inc Payroll" },
    ] as any),
  ).toBeNull();
  expect(
    employerForHistory([
      { name: "Example Inc Payroll" },
      { name: "EXAMPLE INC Payroll" },
    ] as any),
  ).toBe("EXAMPLE INC");
});

import { householdEmployer } from "../server/income";
it("normalizes owner-confirmed Adobe and Canyons employer aliases without matching unrelated names", () => {
  expect(householdEmployer("Adobe")).toBe("Adobe");
  expect(
    householdEmployer("ACH Deposit COMPANY: ADOBE INC ENTRY: PAYROLL Jane Doe"),
  ).toBe("Adobe");
  expect(
    householdEmployer(
      "ACH Deposit COMPANY: CANYONS SCHOOL D ENTRY: PAYROLL PAYROLL Jane Doe",
    ),
  ).toBe("Canyons");
  expect(householdEmployer("Canyons School District")).toBe("Canyons");
  expect(householdEmployer("Canyons Credit Union transfer")).toBeNull();
  expect(householdEmployer("Adobe refund")).toBeNull();
});
