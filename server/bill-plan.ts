import { readFileSync } from "node:fs";
import type { Express } from "express";
import type { Store } from "./store";
import { billState, payee } from "./bills";
export type Plan = {
  id: string;
  name: string;
  accountName: string;
  amount: string;
  currency: string;
  frequency: string;
  day: number | null;
  notes: string;
  kind: string;
  status: string;
  source?: { cell: string; value: string; formula: string };
  acknowledgeDuplicate?: boolean;
};
const factors: Record<string, number> = {
  Monthly: 1,
  Quarterly: 1 / 3,
  "Every six months": 1 / 6,
  Yearly: 1 / 12,
  Weekly: 52 / 12,
  "Every two weeks": 26 / 12,
};
export function installBillPlan(store: Store) {
  store.db.exec(
    "CREATE TABLE IF NOT EXISTS bill_plan(env TEXT NOT NULL,id TEXT NOT NULL,record TEXT NOT NULL,PRIMARY KEY(env,id))",
  );
}
function stored(store: Store): Plan[] {
  return (
    store.db
      .prepare("SELECT record FROM bill_plan WHERE env=? ORDER BY id")
      .all(store.env) as { record: string }[]
  ).map((r) => JSON.parse(r.record));
}
export function fundingTotals(records: Plan[]) {
  const groups = new Map<
    string,
    {
      accountName: string;
      currency: string;
      monthly: number;
      setAside: number;
      total: number;
    }
  >();
  for (const r of records) {
    if (
      r.status !== "confirmed" ||
      r.kind !== "bill" ||
      !Object.hasOwn(factors, r.frequency)
    )
      continue;
    const key = JSON.stringify([r.accountName, r.currency]);
    const group = groups.get(key) ?? {
      accountName: r.accountName,
      currency: r.currency,
      monthly: 0,
      setAside: 0,
      total: 0,
    };
    const amount = Number(r.amount) * factors[r.frequency];
    if (["Quarterly", "Every six months", "Yearly"].includes(r.frequency))
      group.setAside += amount;
    else group.monthly += amount;
    group.total += amount;
    groups.set(key, group);
  }
  return [...groups.values()];
}
export function planState(
  store: Store,
  drafts: Plan[],
  observed: { name: string }[] = [],
) {
  const saved = stored(store),
    byId = new Map(drafts.map((r) => [r.id, r]));
  for (const r of saved) byId.set(r.id, r);
  const records = [...byId.values()].map((r) => ({
    ...r,
    possibleDuplicate: [
      ...observed,
      ...saved.filter((s) => s.id !== r.id && s.status === "confirmed"),
    ].some((s) => payee(s.name) === payee(r.name)),
  }));
  return { records, totals: fundingTotals(records) };
}
export function savePlan(
  store: Store,
  input: any,
  observed: { name: string }[],
) {
  if (!input || typeof input !== "object") throw Error("Invalid bill details.");
  const r: Plan = { ...input };
  if (
    typeof r.id !== "string" ||
    !r.id ||
    r.id.length > 150 ||
    typeof r.name !== "string" ||
    !r.name.trim() ||
    r.name.length > 120 ||
    typeof r.accountName !== "string" ||
    r.accountName.length > 150 ||
    typeof r.amount !== "string" ||
    !/^\d{1,9}\.\d{2}$/.test(r.amount) ||
    typeof r.currency !== "string" ||
    !/^[A-Z]{3}$/.test(r.currency) ||
    typeof r.notes !== "string" ||
    r.notes.length > 2000 ||
    !["confirmed", "excluded", "review"].includes(r.status) ||
    !["bill", "transfer"].includes(r.kind) ||
    !(
      typeof r.frequency === "string" &&
      (Object.hasOwn(factors, r.frequency) || r.frequency === "Unknown")
    ) ||
    !(r.day === null || (Number.isInteger(r.day) && r.day >= 1 && r.day <= 31))
  )
    throw Error(
      "Check the bill name, amount, currency, frequency and payment day.",
    );
  r.name = r.name.trim();
  r.accountName = r.accountName.trim();
  if (r.status === "confirmed") {
    if (
      Number(r.amount) <= 0 ||
      !r.accountName ||
      r.kind === "transfer" ||
      !Object.hasOwn(factors, r.frequency)
    )
      throw Error(
        "Resolve the amount, payment account and frequency before confirming. Transfers cannot be confirmed as bills.",
      );
    const others = [
      ...observed,
      ...stored(store).filter((s) => s.id !== r.id && s.status === "confirmed"),
    ];
    if (
      others.some((s) => payee(s.name) === payee(r.name)) &&
      r.acknowledgeDuplicate !== true
    )
      throw Error(
        "Possible duplicate: acknowledge that this is a separate commitment before confirming.",
      );
  }
  // Store only the supported fields. Source provenance is supplied by the server route.
  const record: Plan = {
    id: r.id,
    name: r.name,
    accountName: r.accountName,
    amount: r.amount,
    currency: r.currency,
    frequency: r.frequency,
    day: r.day,
    notes: r.notes,
    kind: r.kind,
    status: r.status,
    ...(r.source ? { source: r.source } : {}),
    acknowledgeDuplicate: r.acknowledgeDuplicate === true,
  };
  store.db
    .prepare(
      "INSERT INTO bill_plan VALUES(?,?,?) ON CONFLICT(env,id) DO UPDATE SET record=excluded.record",
    )
    .run(store.env, r.id, JSON.stringify(record));
}
export function loadBillDrafts(path = "data/bills-import.json"): Plan[] {
  try {
    const records = JSON.parse(readFileSync(path, "utf8"));
    if (!Array.isArray(records)) throw Error("Invalid staging file");
    return records;
  } catch (e: any) {
    if (e.code === "ENOENT") return [];
    throw e;
  }
}
export function installBillPlanApi(app: Express, store: Store, drafts: Plan[]) {
  installBillPlan(store);
  const observed = () => billState(store, 12).saved;
  app.get("/api/bill-plan", (_req, res) =>
    res.json(planState(store, drafts, observed())),
  );
  app.post("/api/bill-plan", (req, res) => {
    try {
      const original = planState(store, drafts).records.find(
        (r) => r.id === req.body?.id,
      );
      if (!original)
        return res.status(400).json({
          error:
            "This import row is no longer available. Reload and try again.",
        });
      savePlan(store, { ...req.body, source: original.source }, observed());
      res.json({ ok: true });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });
}
