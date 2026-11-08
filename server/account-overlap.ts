import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
export const description = (s: string) =>
  s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
export const baseSignature = (t: any) =>
  JSON.stringify([t.date, t.currency, String(Number(t.amount))]);
export const signature = (t: any) =>
  JSON.stringify([
    t.date,
    t.currency,
    String(Number(t.amount)),
    description(t.name),
  ]);
export function reconcile(db: Database.Database, env: string, raw: any[]) {
  const operations = db
    .prepare("SELECT * FROM account_links WHERE env=? AND status='linked'")
    .all(env) as any[];
  const rows: any[] = [],
    issues: any[] = [];
  const linked = new Map(operations.map((o) => [o.left_id, o]));
  const buckets = new Map<string, any[]>();
  for (const t of raw) {
    if (!linked.has(t.canonicalAccountId) || t.pending) {
      rows.push(t);
      continue;
    }
    const key = JSON.stringify([t.canonicalAccountId, baseSignature(t)]);
    buckets.set(key, [...(buckets.get(key) ?? []), t]);
  }
  db.transaction(() => {
    for (const bucket of buckets.values()) {
      const sources = [...new Set(bucket.map((t) => t.connection))];
      const groups = new Map<string, any[]>();
      for (const t of bucket)
        groups.set(signature(t), [...(groups.get(signature(t)) ?? []), t]);
      const ambiguous =
        sources.length > 1 &&
        [...groups.values()].some(
          (group) =>
            !description(group[0].name) ||
            new Set(
              sources.map(
                (source) => group.filter((t) => t.connection === source).length,
              ),
            ).size !== 1,
        );
      if (ambiguous) {
        issues.push({
          kind: "ambiguous_overlap",
          accountId: bucket[0].canonicalAccountId,
          reason:
            "Descriptions or repeated-purchase counts differ between sources. These records are retained and withheld from estimates.",
          count: bucket.length,
          date: bucket[0].date,
          currency: bucket[0].currency,
          amount: bucket[0].amount,
          transactionIds: bucket.map((t) => t.sourceTransactionId),
        });
        continue;
      }
      for (const [sig, ts] of groups) {
        const bySource = new Map<string, any[]>();
        for (const t of ts)
          bySource.set(t.connection, [
            ...(bySource.get(t.connection) ?? []),
            t,
          ]);
        for (const list of bySource.values())
          list.sort((a, b) => a.id.localeCompare(b.id));
        const events = db
          .prepare(
            "SELECT event_id,ordinal FROM transaction_events WHERE env=? AND account_id=? AND signature=? ORDER BY ordinal",
          )
          .all(env, ts[0].canonicalAccountId, sig) as any[];
        const assignments = new Map<string, any[]>();
        for (const [source, list] of bySource) {
          const used = new Set<string>();
          const known = new Map(
            list.map((t) => [
              t.id,
              (
                db
                  .prepare(
                    "SELECT event_id FROM transaction_event_aliases WHERE env=? AND source_id=? AND transaction_id=? AND signature=?",
                  )
                  .get(env, source, t.id, sig) as any
              )?.event_id,
            ]),
          );
          for (const event of known.values()) if (event) used.add(event);
          for (const t of list) {
            let eventId = known.get(t.id);
            if (!eventId) {
              // Never recycle an event previously occupied by a different record from this source.
              const available = events.find(
                (e) =>
                  !used.has(e.event_id) &&
                  !db
                    .prepare(
                      "SELECT 1 FROM transaction_event_aliases WHERE env=? AND source_id=? AND event_id=?",
                    )
                    .get(env, source, e.event_id),
              );
              if (available) eventId = available.event_id;
              else {
                eventId = `event:${randomUUID()}`;
                const ordinal = (events.at(-1)?.ordinal ?? -1) + 1;
                db.prepare(
                  "INSERT INTO transaction_events VALUES(?,?,?,?,?)",
                ).run(env, ts[0].canonicalAccountId, sig, ordinal, eventId);
                events.push({ event_id: eventId, ordinal });
              }
            }
            used.add(eventId);
            db.prepare(
              "INSERT INTO transaction_event_aliases VALUES(?,?,?,?,?) ON CONFLICT(env,source_id,transaction_id) DO UPDATE SET signature=excluded.signature,event_id=excluded.event_id",
            ).run(env, t.connection, t.id, sig, eventId);
            assignments.set(eventId, [...(assignments.get(eventId) ?? []), t]);
          }
        }
        if (
          sources.length > 1 &&
          [...assignments.values()].some((m) => m.length !== sources.length)
        ) {
          issues.push({
            kind: "ambiguous_overlap",
            accountId: ts[0].canonicalAccountId,
            reason:
              "Previously matched source records no longer align. Review source history before counting them.",
            count: ts.length,
            date: ts[0].date,
            currency: ts[0].currency,
            amount: ts[0].amount,
            transactionIds: ts.map((t) => t.sourceTransactionId),
          });
          continue;
        }
        for (const [eventId, members] of assignments) {
          const preferred = linked.get(
            ts[0].canonicalAccountId,
          ).preferred_source;
          const representative =
            members.find((t) => t.connection === preferred) ?? members[0];
          rows.push({
            ...representative,
            canonicalTransactionId: eventId,
            provenance: members.map((t) => ({
              id: t.sourceTransactionId,
              sourceId: t.connection,
              providerTransactionId: t.id,
            })),
          });
        }
      }
    }
  })();
  return {
    rows: rows.sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        a.canonicalTransactionId.localeCompare(b.canonicalTransactionId),
    ),
    issues,
  };
}
