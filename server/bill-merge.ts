import { payee } from "./bills";
import { createHash } from "node:crypto";
import type { Express } from "express";
import type { Store } from "./store";
import {
  activePlanRecords,
  storedPlans,
  savePlan,
  type Plan,
} from "./bill-plan";
import type { BillPayment } from "../shared/billAmounts";
const editable = [
  "name",
  "accountName",
  "amount",
  "currency",
  "frequency",
  "day",
  "notes",
  "kind",
  "amountMode",
  "planningEstimate",
  "payments",
  "expenseType",
  "creditAccountId",
];
function compatiblePayment(a: BillPayment, b: BillPayment) {
  return (
    a.date === b.date &&
    a.amount === b.amount &&
    (!a.actualTransactionKey ||
      !b.actualTransactionKey ||
      a.actualTransactionKey === b.actualTransactionKey)
  );
}
function paymentMap(plan: Plan) {
  if (plan.payments !== undefined && !Array.isArray(plan.payments))
    throw Error("Invalid payment cycles.");
  const result = new Map<string, BillPayment>();
  for (const p of plan.payments ?? []) {
    if (
      !p ||
      typeof p.date !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(p.date) ||
      typeof p.amount !== "string"
    )
      throw Error("Review the payment dates and amounts before merging.");
    const month = p.date.slice(0, 7);
    if (result.has(month))
      throw Error("Resolve duplicate payment months before merging.");
    result.set(month, p);
  }
  return result;
}
export function previewBillMerge(store: Store, drafts: Plan[], input: any) {
  if (
    !input ||
    typeof input.sourceId !== "string" ||
    typeof input.targetId !== "string" ||
    input.sourceId === input.targetId
  )
    throw Error("Choose two different bills to merge.");
  const records = activePlanRecords(store, drafts),
    original = records.find((r) => r.id === input.sourceId),
    target = records.find((r) => r.id === input.targetId);
  if (
    !original ||
    !target ||
    target.status !== "confirmed" ||
    target.kind !== "bill"
  )
    throw Error(
      "These bills changed or were already merged. Refresh and review again.",
    );
  if (
    input.sourceEdits !== undefined &&
    (!input.sourceEdits ||
      typeof input.sourceEdits !== "object" ||
      Array.isArray(input.sourceEdits))
  )
    throw Error("Invalid bill edits.");
  const source = {
    ...original,
    ...Object.fromEntries(
      editable
        .filter((k) => input.sourceEdits && Object.hasOwn(input.sourceEdits, k))
        .map((k) => [k, input.sourceEdits[k]]),
    ),
  } as Plan;
  if (!["bill", "transfer"].includes(source.kind))
    throw Error(
      "Choose a bill or auto-transfer entry to merge into the existing bill.",
    );
  if (source.currency !== target.currency)
    throw Error("Bills with different currencies cannot be merged.");
  if (typeof source.notes !== "string" || source.notes.length > 2000)
    throw Error("Review the notes before merging.");
  const a =
      source.kind === "transfer"
        ? new Map<string, BillPayment>()
        : paymentMap(source),
    b = paymentMap(target);
  const conflictingMonths = [...a.keys()]
    .filter((m) => b.has(m) && !compatiblePayment(a.get(m)!, b.get(m)!))
    .sort();
  const version = createHash("sha256")
    .update(JSON.stringify({ original, target, source }))
    .digest("hex");
  const cardName = (plan: Plan) =>
    !plan.creditAccountId
      ? "Not linked"
      : (store
          .accountList()
          .find((a) => a.canonicalAccountId === plan.creditAccountId)?.name ??
        "Previously linked card (unavailable)");
  return {
    source,
    target,
    conflictingMonths,
    version,
    sourceCardName: cardName(source),
    targetCardName: cardName(target),
  };
}
export function mergeBills(store: Store, drafts: Plan[], input: any) {
  return store.db.transaction(() => {
    const preview = previewBillMerge(store, drafts, input),
      { source, target } = preview;
    if (input.version !== preview.version)
      throw Error(
        "A bill changed since the merge preview. Review the merge again.",
      );
    if (!["source", "target"].includes(input.prefer))
      throw Error("Choose which bill details to keep.");
    if (source.kind === "transfer" && input.prefer !== "target")
      throw Error(
        "Keep the existing bill's details when merging an auto-transfer.",
      );
    const choices = input.cycleChoices;
    if (!choices || typeof choices !== "object" || Array.isArray(choices))
      throw Error("Review payment conflicts before merging.");
    for (const month of preview.conflictingMonths)
      if (
        !Object.hasOwn(choices, month) ||
        !["source", "target"].includes(choices[month])
      )
        throw Error(`Choose the payment to keep for ${month}.`);
    const a =
        source.kind === "transfer"
          ? new Map<string, BillPayment>()
          : paymentMap(source),
      b = paymentMap(target),
      payments: BillPayment[] = [];
    for (const month of [...new Set([...a.keys(), ...b.keys()])].sort()) {
      const incoming = a.get(month),
        existing = b.get(month);
      if (incoming && existing) {
        if (compatiblePayment(incoming, existing))
          payments.push({
            ...existing,
            ...(incoming.actualTransactionKey
              ? { actualTransactionKey: incoming.actualTransactionKey }
              : {}),
          });
        else payments.push(choices[month] === "source" ? incoming : existing);
      } else payments.push((incoming ?? existing)!);
    }
    const notes = [
      ...new Set(
        [target.notes, source.notes].map((n) => n.trim()).filter(Boolean),
      ),
    ].join("\n\n");
    const sources = [
      ...new Map(
        [
          target.source,
          ...(target.sources ?? []),
          source.source,
          ...(source.sources ?? []),
        ]
          .filter(Boolean)
          .map((p) => [JSON.stringify(p), p!]),
      ).values(),
    ];
    const merged: Plan = {
      ...(input.prefer === "source" ? source : target),
      id: target.id,
      status: "confirmed",
      kind: target.kind,
      source: target.source ?? source.source,
      sources,
      notes,
      payments,
      acknowledgeDuplicate: true,
    };
    const originalSource = activePlanRecords(store, drafts).find(
      (p) => p.id === source.id,
    )!;
    const retainedSource = storedPlans(store).find((p) => p.id === source.id);
    store.db
      .prepare("DELETE FROM bill_plan WHERE env=? AND id=?")
      .run(store.env, source.id);
    merged.acknowledgeDuplicate = storedPlans(store).some(
      (p) =>
        p.id !== target.id &&
        p.status === "confirmed" &&
        payee(p.name) === payee(merged.name),
    );
    savePlan(store, merged, [], retainedSource ? [retainedSource] : []);
    store.db
      .prepare(
        "UPDATE bill_plan_merges SET target_id=? WHERE env=? AND target_id=?",
      )
      .run(target.id, store.env, source.id);
    store.db
      .prepare("INSERT INTO bill_plan_merges VALUES(?,?,?,?,?)")
      .run(
        store.env,
        source.id,
        target.id,
        JSON.stringify({ original: originalSource, edited: source }),
        JSON.stringify(target),
      );
    return { ok: true, targetId: target.id };
  })();
}
export function installBillMergeApi(
  app: Express,
  store: Store,
  drafts: Plan[],
) {
  app.post("/api/bill-plan/merge/preview", (req, res) => {
    try {
      res.json(previewBillMerge(store, drafts, req.body));
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });
  app.post("/api/bill-plan/merge", (req, res) => {
    try {
      res.json(mergeBills(store, drafts, req.body));
    } catch (e: any) {
      res.status(409).json({ error: e.message });
    }
  });
}
