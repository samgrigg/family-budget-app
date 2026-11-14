export type AccountOrder = Partial<
  Record<"cash" | "cards" | "loans" | "other", string[]>
>;
const groupIds = ["cash", "cards", "loans", "other"] as const;
export function loadAccountOrder(
  storage: Pick<Storage, "getItem">,
  environment: string,
): AccountOrder {
  const raw = storage.getItem(`account-order:${environment}`);
  let parsed: any;
  try {
    parsed = JSON.parse(raw || "{}");
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  const result: AccountOrder = {};
  for (const group of groupIds)
    if (Array.isArray(parsed[group]))
      result[group] = [
        ...new Set<string>(
          parsed[group].filter((id: unknown) => typeof id === "string"),
        ),
      ];
  return result;
}
export function saveAccountOrder(
  storage: Pick<Storage, "setItem">,
  environment: string,
  order: AccountOrder,
) {
  storage.setItem(`account-order:${environment}`, JSON.stringify(order));
}
export function orderedAccounts<T extends { id: string }>(
  accounts: T[],
  saved: string[] = [],
  redirects: { from: string; to: string }[] = [],
): T[] {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const ids: string[] = [];
  for (const old of saved) {
    let id = old;
    const seen = new Set<string>();
    while (!seen.has(id)) {
      seen.add(id);
      const redirect = redirects.find((r) => r.from === id);
      if (!redirect) break;
      id = redirect.to;
    }
    if (byId.has(id) && !ids.includes(id)) ids.push(id);
  }
  for (const a of accounts) if (!ids.includes(a.id)) ids.push(a.id);
  return ids.map((id) => byId.get(id)!);
}
export function moveAccount(
  ids: string[],
  source: string,
  target: string,
  edge: "before" | "after",
) {
  if (source === target || !ids.includes(source) || !ids.includes(target))
    return ids;
  const next = ids.filter((id) => id !== source);
  next.splice(next.indexOf(target) + (edge === "after" ? 1 : 0), 0, source);
  return next;
}
