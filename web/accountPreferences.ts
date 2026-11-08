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
  redirects: { env: string; from: string; to: string }[] = [],
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
  let applied: any[] = [];
  try {
    const parsed = JSON.parse(storage.getItem(`${key}:links`) || "[]");
    if (Array.isArray(parsed)) applied = parsed;
  } catch {}
  const active = redirects.filter((r) => r.env === environment);
  for (const old of applied)
    if (
      !active.some((r) => r.from === old.from && r.to === old.to) &&
      old.added &&
      !old.edited
    )
      hidden = hidden.filter((h) => h !== `account:${old.to}`);
  applied = applied.filter((old) =>
    active.some((r) => r.from === old.from && r.to === old.to),
  );
  for (const r of active)
    if (!applied.some((a) => a.from === r.from && a.to === r.to)) {
      const added =
        hidden.includes(`account:${r.from}`) &&
        !hidden.includes(`account:${r.to}`);
      if (added) hidden.push(`account:${r.to}`);
      applied.push({ ...r, added, edited: false });
    }
  storage.setItem(`${key}:links`, JSON.stringify(applied));
  storage.setItem(key, JSON.stringify(hidden));
  return hidden;
}

export function saveHiddenAccounts(
  storage: Pick<Storage, "getItem" | "setItem">,
  environment: string,
  hidden: string[],
) {
  const key = `flow-hidden-accounts:${environment}`;
  const old = JSON.parse(storage.getItem(key) || "[]");
  const links = JSON.parse(storage.getItem(`${key}:links`) || "[]");
  for (const link of links)
    if (
      old.includes(`account:${link.to}`) !==
      hidden.includes(`account:${link.to}`)
    )
      link.edited = true;
  storage.setItem(`${key}:links`, JSON.stringify(links));
  storage.setItem(key, JSON.stringify(hidden));
}
