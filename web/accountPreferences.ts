export interface AccountAlias {
  env: string;
  source_id: string;
  provider_account_id: string;
  account_id: string;
}
export function migrateHiddenAccounts(
  old: string[],
  aliases: AccountAlias[],
  environment: string,
) {
  const lookup = new Map(
    aliases
      .filter((a) => a.env === environment)
      .map((a) => [
        `account:${JSON.stringify([a.source_id, a.provider_account_id])}`,
        `account:${a.account_id}`,
      ]),
  );
  for (const a of aliases.filter((a) => a.env === environment))
    lookup.set(`account:${a.account_id}`, `account:${a.account_id}`);
  return {
    mapped: [
      ...new Set(
        old.flatMap((id) => (lookup.has(id) ? [lookup.get(id)!] : [])),
      ),
    ],
    unmatched: old.filter((id) => !lookup.has(id)),
  };
}
export function loadHiddenAccounts(
  storage: Pick<Storage, "getItem" | "setItem">,
  environment: string,
  aliases: AccountAlias[],
) {
  const key = `flow-hidden-accounts:${environment}`;
  const read = (k: string): string[] => {
    try {
      const v = JSON.parse(storage.getItem(k) || "[]");
      return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
    } catch {
      return [];
    }
  };
  let hidden = read(key);
  if (storage.getItem(`${key}:migrated`) !== "1") {
    const { mapped } = migrateHiddenAccounts(
      read("flow-hidden-accounts"),
      aliases,
      environment,
    );
    hidden = [...new Set([...hidden, ...mapped])];
    storage.setItem(key, JSON.stringify(hidden));
    // Keep the legacy source intact: unmatched IDs may belong to another environment.
    storage.setItem(`${key}:migrated`, "1");
  }
  return hidden;
}
