import type { Store } from "./store";
/** User-facing source context; provider IDs are used only for lookup, never display. */
export function replacementSourceIdentities(store: Store) {
  const accounts = store.repository.accounts();
  const sources = store.db
    .prepare(
      "SELECT d.id,d.label,i.name AS institution FROM data_sources d JOIN app_institutions i ON i.env=d.env AND i.id=d.institution_id WHERE d.env=?",
    )
    .all(store.env) as {
    id: string;
    label: string | null;
    institution: string;
  }[];
  const descriptions = sources.map((source) => {
    const accountNames = accounts
      .filter((a) => a.connection === source.id)
      .map((a) =>
        [
          a.name,
          a.subtype || a.type || "Type unknown",
          a.mask ? `••${a.mask}` : "Ending unknown",
        ].join(" · "),
      )
      .sort((a, b) => a.localeCompare(b));
    return {
      id: source.id,
      description: `${source.institution} · ${source.label || "Unnamed data source"} — ${accountNames.join("; ") || "No imported accounts"}`,
    };
  });
  const normalized = (value: string) =>
    value.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
  return descriptions.map((source) => ({
    ...source,
    needsNickname: descriptions.some(
      (other) =>
        other.id !== source.id &&
        normalized(other.description) === normalized(source.description),
    ),
  }));
}
