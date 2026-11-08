import { billState } from "./bills";
import { incomeState } from "./income";
import { transferState } from "./transfers";
import type { Store } from "./store";
export function buildFlow(
  incomes: any[],
  bills: any[],
  transfers: any[],
  labels: Map<string, string>,
) {
  const links = new Map<string, any>();
  const accounts = new Set<string>();
  const id = (t: any) => JSON.stringify([t.connection, t.account]);
  const add = (
    source: string,
    target: string,
    amount: number,
    kind: string,
  ) => {
    if (!Number.isFinite(amount) || amount <= 0) return;
    const key = JSON.stringify([source, target]);
    const old = links.get(key);
    links.set(key, {
      source,
      target,
      amount: (old?.amount ?? 0) + amount,
      kind,
    });
  };
  const totals = new Map<
    string,
    { income: number; bills: number; incoming: number; outgoing: number }
  >();
  const get = (key: string) => {
    accounts.add(key);
    if (!totals.has(key))
      totals.set(key, { income: 0, bills: 0, incoming: 0, outgoing: 0 });
    return totals.get(key)!;
  };
  for (const b of incomes)
    for (const t of b.transactions) {
      const a = id(t),
        n = Math.abs(Number(t.amount));
      get(a).income += n;
      add(`income:${b.key}`, `before:${a}`, n, "Income");
    }
  for (const b of bills)
    for (const t of b.transactions) {
      const a = id(t),
        n = Number(t.amount);
      get(a).bills += n;
      add(`after:${a}`, `bill:${b.key}`, n, "Bill");
    }
  for (const p of transfers) {
    const a = id(p.out),
      b = id(p.into),
      n = Number(p.out.amount);
    get(a).outgoing += n;
    get(b).incoming += n;
    add(`before:${a}`, `after:${b}`, n, "Internal transfer");
  }
  for (const a of accounts) {
    const t = get(a);
    const direct = Math.max(t.income - t.outgoing, t.bills - t.incoming, 0);
    add(`before:${a}`, `after:${a}`, direct, "Same account");
    add(
      "funding",
      `before:${a}`,
      t.outgoing + direct - t.income,
      "Untraced funding",
    );
    add(
      `after:${a}`,
      "remaining",
      t.incoming + direct - t.bills,
      "Unallocated",
    );
  }
  const names = new Map<string, string>([
    ["funding", "Other funding / starting funds"],
    ["remaining", "Other spending / retained funds"],
  ]);
  for (const a of accounts)
    for (const stage of ["before", "after"])
      names.set(`${stage}:${a}`, labels.get(a) ?? "Account");
  for (const b of incomes) names.set(`income:${b.key}`, b.name);
  for (const b of bills) names.set(`bill:${b.key}`, b.name);
  const edges = [...links.values()];
  const ids = new Set(edges.flatMap((e) => [e.source, e.target]));
  return {
    nodes: [...ids].map((id) => ({
      id,
      name: names.get(id) ?? id,
      column:
        id === "funding" || id.startsWith("income:")
          ? 0
          : id.startsWith("before:")
            ? 1
            : id.startsWith("after:")
              ? 2
              : 3,
    })),
    links: edges,
  };
}
export function flowState(store: Store, month: string, currency: string) {
  const institutions = store.list();
  const labels = new Map(
    store
      .accountList()
      .map((a) => [
        JSON.stringify([a.connection, a.id]),
        `${institutions.find((c) => c.id === a.connection)?.display_name ?? "Institution"} · ${a.name}${a.mask ? ` ••${a.mask}` : ""}${a.hidden ? " (hidden)" : ""}`,
      ]),
  );
  const inMonth = (t: any) =>
    t.date.startsWith(month) && t.currency === currency;
  const prune = (sources: any[]) =>
    sources
      .map((b) => ({ ...b, transactions: b.transactions.filter(inMonth) }))
      .filter((b) => b.transactions.length);
  // Transfer legs can settle in different months; show the movement on its outgoing date.
  const transfers = transferState(store).confirmed.filter((p) =>
    inMonth(p.out),
  );
  const graph = buildFlow(
    prune(incomeState(store).saved),
    prune(billState(store, 12).saved),
    transfers,
    labels,
  );
  const dimensions = store.db
    .prepare(
      "SELECT DISTINCT substr(date,1,7) AS month,currency FROM transactions WHERE env=? ORDER BY month DESC",
    )
    .all(store.env) as any[];
  return {
    ...graph,
    month,
    currency,
    months: [...new Set(dimensions.map((d) => d.month))],
    currencies: [...new Set(dimensions.map((d) => d.currency).filter(Boolean))],
  };
}
