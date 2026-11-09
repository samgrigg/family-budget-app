import { expect, it } from "vitest";
import { Store } from "../server/store";
import {
  installBillPlan,
  savePlan,
  planState,
  storedPlans,
} from "../server/bill-plan";
import { previewBillMerge, mergeBills } from "../server/bill-merge";
const target = {
  id: "kept",
  name: "Rent",
  accountName: "Checking",
  amount: "100.00",
  currency: "USD",
  frequency: "Monthly",
  day: 1,
  notes: "Existing note",
  kind: "bill",
  status: "confirmed",
  payments: [{ date: "2026-10-01", amount: "100.00" }],
  source: { cell: "Bills!A3", value: "100", formula: "" },
};
const duplicate = {
  ...target,
  id: "duplicate",
  status: "review",
  notes: "Another note",
  payments: [{ date: "2026-11-01", amount: "110.00" }],
  source: { cell: "Bills!E4", value: "100", formula: "" },
};
function setup() {
  const s = new Store(":memory:", Buffer.alloc(32), "sandbox");
  installBillPlan(s);
  savePlan(s, target, []);
  return s;
}
it("merges into one confirmed bill, preserves notes/cycles/provenance and prevents draft resurrection", () => {
  const s = setup();
  const preview = previewBillMerge(s, [duplicate], {
    sourceId: "duplicate",
    targetId: "kept",
  });
  mergeBills(s, [duplicate], {
    sourceId: "duplicate",
    targetId: "kept",
    version: preview.version,
    prefer: "target",
    cycleChoices: {},
  });
  const state = planState(s, [duplicate], [], "2026-11");
  expect(state.records).toHaveLength(1);
  expect(storedPlans(s)).toHaveLength(1);
  expect(state.records[0].payments).toHaveLength(2);
  expect(state.records[0].notes).toContain("Another note");
  expect(state.records[0].sources).toHaveLength(2);
  expect(state.records[0].acknowledgeDuplicate).toBe(false);
  expect(state.totals[0].total).toBe(110);
  expect(() =>
    mergeBills(s, [duplicate], {
      sourceId: "duplicate",
      targetId: "kept",
      version: preview.version,
      prefer: "target",
      cycleChoices: {},
    }),
  ).toThrow();
  expect(
    planState(new Store(s.db, Buffer.alloc(32), "production"), [duplicate])
      .records,
  ).toHaveLength(1);
  s.db.close();
});
it("requires a payment conflict choice and rolls back failures", () => {
  const s = setup();
  const source = {
    ...duplicate,
    payments: [{ date: "2026-10-05", amount: "200.00" }],
  };
  const preview = previewBillMerge(s, [source], {
    sourceId: source.id,
    targetId: target.id,
  });
  expect(preview.conflictingMonths).toEqual(["2026-10"]);
  expect(() =>
    mergeBills(s, [source], {
      sourceId: source.id,
      targetId: target.id,
      version: preview.version,
      prefer: "target",
      cycleChoices: {},
    }),
  ).toThrow(/payment/i);
  expect(planState(s, [source]).records).toHaveLength(2);
  mergeBills(s, [source], {
    sourceId: source.id,
    targetId: target.id,
    version: preview.version,
    prefer: "target",
    cycleChoices: { "2026-10": "source" },
  });
  expect(storedPlans(s)[0].payments?.[0].amount).toBe("200.00");
  s.db.close();
});
it("rejects stale previews and incompatible currencies without changing either bill", () => {
  const s = setup();
  const preview = previewBillMerge(s, [duplicate], {
    sourceId: duplicate.id,
    targetId: target.id,
  });
  savePlan(s, { ...target, amount: "120.00" }, []);
  expect(() =>
    mergeBills(s, [duplicate], {
      sourceId: duplicate.id,
      targetId: target.id,
      version: preview.version,
      prefer: "target",
      cycleChoices: {},
    }),
  ).toThrow(/changed/i);
  expect(() =>
    previewBillMerge(s, [{ ...duplicate, currency: "EUR" }], {
      sourceId: duplicate.id,
      targetId: target.id,
    }),
  ).toThrow(/currenc/i);
  expect(planState(s, [duplicate]).records).toHaveLength(2);
  s.db.close();
});

import request from "supertest";
import { createApp } from "../server/app";
it("protects merge routes, rejects saves to merged IDs and does not merge financial data on preview", async () => {
  const s = setup();
  const app = createApp(
    s,
    { configured: false, call: async () => ({}) },
    "http://localhost:3000",
    undefined,
    [duplicate],
  );
  const body = { sourceId: duplicate.id, targetId: target.id };
  expect(
    (
      await request(app)
        .post("/api/bill-plan/merge")
        .set("Host", "localhost:3000")
        .send(body)
    ).status,
  ).toBe(403);
  const session = await request(app)
    .get("/api/state")
    .set("Host", "localhost:3000");
  const post = (path: string, data: any) =>
    request(app)
      .post("/api/bill-plan" + path)
      .set("Host", "localhost:3000")
      .set("Origin", "http://localhost:3000")
      .set("Cookie", session.headers["set-cookie"])
      .set("X-CSRF-Token", session.body.csrf)
      .send(data);
  const duplicateResponse = await post("", {
    ...duplicate,
    status: "confirmed",
  });
  expect(duplicateResponse.status).toBe(400);
  expect(duplicateResponse.body.duplicatePlans[0].id).toBe(target.id);
  const preview = await post("/merge/preview", body);
  expect(preview.status).toBe(200);
  expect(planState(s, [duplicate]).records).toHaveLength(2);
  expect(
    (
      await post("/merge", {
        ...body,
        version: preview.body.version,
        prefer: "target",
        cycleChoices: {},
      })
    ).status,
  ).toBe(200);
  expect((await post("", { ...duplicate, status: "confirmed" })).status).toBe(
    400,
  );
  expect(() => savePlan(s, duplicate, [])).toThrow(/merged/i);
  expect(planState(s, [duplicate]).records).toHaveLength(1);
  s.db.close();
});
it("merges edited source details when explicitly selected and resolves chained aliases", () => {
  const s = setup();
  const sourceEdits = {
    ...duplicate,
    amount: "120.00",
    accountName: "Other checking",
  };
  const preview = previewBillMerge(s, [duplicate], {
    sourceId: duplicate.id,
    targetId: target.id,
    sourceEdits,
  });
  mergeBills(s, [duplicate], {
    sourceId: duplicate.id,
    targetId: target.id,
    sourceEdits,
    version: preview.version,
    prefer: "source",
    cycleChoices: {},
  });
  expect(storedPlans(s)[0]).toMatchObject({
    id: target.id,
    amount: "120.00",
    accountName: "Other checking",
    status: "confirmed",
  });
  savePlan(
    s,
    { ...target, id: "third", name: "Another confirmed bill", payments: [] },
    [],
  );
  const next = previewBillMerge(s, [duplicate], {
    sourceId: target.id,
    targetId: "third",
  });
  mergeBills(s, [duplicate], {
    sourceId: target.id,
    targetId: "third",
    version: next.version,
    prefer: "target",
    cycleChoices: {},
  });
  expect(planState(s, [duplicate, target]).records).toHaveLength(1);
  expect(
    (
      s.db
        .prepare(
          "SELECT target_id FROM bill_plan_merges WHERE env=? AND source_id=?",
        )
        .get(s.env, duplicate.id) as any
    ).target_id,
  ).toBe("third");
  s.db.close();
});

import { transactionKey } from "../server/transfers";
it("preserves unavailable historical source links without allowing fabricated references", () => {
  const s = setup();
  s.connect("c", "token", [
    { account_id: "a", name: "Checking", type: "depository" },
  ]);
  s.db
    .prepare("INSERT INTO transactions VALUES(?,?,?,?,?,?,?,?,?)")
    .run(s.env, "c", "paid", "a", "2026-11-01", "Payment", "110.00", "USD", 0);
  const key = transactionKey(s.repository.history("all")[0]);
  savePlan(
    s,
    {
      ...duplicate,
      payments: [
        { date: "2026-11-01", amount: "110.00", actualTransactionKey: key },
      ],
    },
    [],
  );
  s.db
    .prepare("DELETE FROM transactions WHERE env=? AND id=?")
    .run(s.env, "paid");
  const original = storedPlans(s).find((r) => r.id === duplicate.id)!;
  // Simulate an account identity that was available when this record was saved.
  s.db
    .prepare("UPDATE bill_plan SET record=? WHERE env=? AND id=?")
    .run(
      JSON.stringify({ ...original, creditAccountId: "historical-card" }),
      s.env,
      duplicate.id,
    );
  const preview = previewBillMerge(s, [], {
    sourceId: duplicate.id,
    targetId: target.id,
  });
  mergeBills(s, [], {
    sourceId: duplicate.id,
    targetId: target.id,
    version: preview.version,
    prefer: "source",
    cycleChoices: {},
  });
  const kept = planState(s, [], [], "2026-11").records[0];
  expect(kept.creditAccountId).toBe("historical-card");
  expect(kept.resolvedAmount.missingActual).toBe(true);
  expect(
    kept.payments?.find((p) => p.actualTransactionKey === key),
  ).toBeDefined();
  expect(() =>
    savePlan(s, { ...kept, creditAccountId: "fabricated-card" }, []),
  ).toThrow();
  s.db.close();
});

it("merges an imported auto-transfer duplicate into its bill while retaining bill details", () => {
  const s = setup();
  const transfer = {
    ...duplicate,
    id: "Bills!Q2",
    kind: "transfer",
    accountName: "",
    amount: "200.00",
    day: 28,
    notes: "Funding instruction",
    payments: [{ date: "2026-11-28", amount: "999.00" }],
  };
  const preview = previewBillMerge(s, [transfer], {
    sourceId: transfer.id,
    targetId: target.id,
  });
  expect(preview.source.kind).toBe("transfer");
  mergeBills(s, [transfer], {
    sourceId: transfer.id,
    targetId: target.id,
    version: preview.version,
    prefer: "target",
    cycleChoices: {},
  });
  const state = planState(s, [transfer]);
  expect(state.records).toHaveLength(1);
  expect(state.records[0]).toMatchObject({
    id: target.id,
    kind: "bill",
    accountName: "Checking",
    amount: "100.00",
    day: 1,
    status: "confirmed",
  });
  expect(state.records[0].notes).toContain("Funding instruction");
  expect(state.records[0].payments).toEqual(target.payments);
  expect(planState(s, [transfer], [], "2026-11").totals[0].total).toBe(100);
  s.db.close();
});
it("does not replace bill details with a funding-only transfer record", () => {
  const s = setup();
  const transfer = { ...duplicate, kind: "transfer" };
  const preview = previewBillMerge(s, [transfer], {
    sourceId: transfer.id,
    targetId: target.id,
  });
  expect(() =>
    mergeBills(s, [transfer], {
      sourceId: transfer.id,
      targetId: target.id,
      version: preview.version,
      prefer: "source",
      cycleChoices: {},
    }),
  ).toThrow(/existing bill/i);
  expect(planState(s, [transfer]).records).toHaveLength(2);
  s.db.close();
});

it("requires an explicit choice for different grouped charge evidence in the same month", () => {
  const s = setup();
  const groupedTarget = {
    ...target,
    expectedChargeCount: 4,
    payments: [{ ...target.payments[0], expectedChargeCount: 4, charges: [] }],
  };
  savePlan(s, groupedTarget, []);
  const source = { ...duplicate, payments: target.payments };
  const preview = previewBillMerge(s, [source], {
    sourceId: source.id,
    targetId: target.id,
  });
  expect(preview.conflictingMonths).toEqual(["2026-10"]);
  mergeBills(s, [source], {
    sourceId: source.id,
    targetId: target.id,
    version: preview.version,
    prefer: "target",
    cycleChoices: { "2026-10": "target" },
  });
  expect(storedPlans(s)[0]).toMatchObject({
    expectedChargeCount: 4,
    payments: [{ expectedChargeCount: 4, charges: [] }],
  });
  s.db.close();
});
