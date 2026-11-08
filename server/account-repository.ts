import { reconcile } from "./account-overlap";
import type Database from "better-sqlite3";
import { ensureAccountIdentities } from "./accountMigration";
export interface AccountIdentity {
  id: string;
  institutionId: string;
  name: string;
  type: string | null;
  subtype: string | null;
  ownership: string | null;
  included: boolean;
}
export interface TransactionIdentity {
  id: string;
  sourceTransactionId?: string;
  provenance?: any[];
  accountId: string;
  sourceId: string;
  providerTransactionId: string;
  date: string;
  name: string;
  rawName: string | null;
  amount: string;
  currency: string;
  pending: boolean;
}
export interface HistoryCoverage {
  requestedDays: number;
  oldestPosted: string | null;
  newestPosted: string | null;
  lastChecked: string | null;
  importState: string;
}
export const sourceTransactionId = (env: string, source: string, id: string) =>
  JSON.stringify([env, source, id]);
export class AccountRepository {
  constructor(
    public db: Database.Database,
    public env: string,
  ) {}
  accounts(): any[] {
    ensureAccountIdentities(this.db);
    return this.db
      .prepare(
        `SELECT a.*,s.env AS env,s.source_id AS connection,s.provider_account_id AS id,s.account_id AS canonicalAccountId,c.institution_id AS institutionId,c.name,c.type,c.subtype,c.ownership,c.included,1-c.included AS hidden,x.shared FROM source_accounts s JOIN app_accounts c ON c.env=s.env AND c.id=s.account_id LEFT JOIN accounts a ON a.env=s.env AND a.connection=s.source_id AND a.id=s.provider_account_id LEFT JOIN source_account_access x ON x.env=s.env AND x.source_id=s.source_id AND x.provider_account_id=s.provider_account_id WHERE s.env=? ORDER BY a.connection,c.name,a.id`,
      )
      .all(this.env)
      .map((a: any) => ({
        ...a,
        shared: a.shared === null ? null : !!a.shared,
      }));
  }
  listAccounts(): AccountIdentity[] {
    return [
      ...new Map(
        this.accounts().map((a) => [a.canonicalAccountId, a]),
      ).values(),
    ].map((a) => ({
      id: a.canonicalAccountId,
      institutionId: a.institutionId,
      name: a.name,
      type: a.type,
      subtype: a.subtype,
      ownership: a.ownership,
      included: !!a.included,
    }));
  }
  transactionIdentity(t: any): TransactionIdentity {
    return {
      id: t.canonicalTransactionId,
      sourceTransactionId: t.sourceTransactionId,
      provenance: t.provenance,
      accountId: t.canonicalAccountId,
      sourceId: t.connection,
      providerTransactionId: t.id,
      date: t.date,
      name: t.name,
      rawName: t.rawName,
      amount: t.amount,
      currency: t.currency,
      pending: !!t.pending,
    };
  }
  analyticalHistory(policy: "all" | "included"): TransactionIdentity[] {
    return this.history(policy).map((t) => this.transactionIdentity(t));
  }
  accountTransactions(
    accountId: string,
    options: { limit?: number; cursor?: string } = {},
  ) {
    const page = this.transactions(accountId, options);
    return { ...page, rows: page.rows.map((t) => this.transactionIdentity(t)) };
  }
  aliases(): any[] {
    ensureAccountIdentities(this.db);
    return this.db
      .prepare("SELECT * FROM account_id_aliases WHERE env=?")
      .all(this.env);
  }
  history(policy: "all" | "included"): any[] {
    return reconcile(this.db, this.env, this.eligibleHistory(policy)).rows;
  }
  dataIssues() {
    const staged = this.stagedSources();
    return [
      ...reconcile(this.db, this.env, this.eligibleHistory("all")).issues,
      ...this.rawHistory()
        .filter((t) => staged.has(t.connection))
        .map((t) => ({
          kind: "replacement_pending",
          accountId: t.canonicalAccountId,
          reason:
            "Replacement import awaits explicit account review. Resume in Data access.",
          count: 1,
          date: t.date,
          currency: t.currency,
          amount: t.amount,
          transactionIds: [t.sourceTransactionId],
        })),
    ];
  }
  private stagedSources() {
    return new Set(
      (
        this.db
          .prepare(
            "SELECT new_source_id FROM source_replacements WHERE env=? AND state!='complete' AND new_source_id IS NOT NULL",
          )
          .all(this.env) as { new_source_id: string }[]
      ).map((o) => o.new_source_id),
    );
  }
  private eligibleHistory(policy: "all" | "included") {
    const staged = this.stagedSources();
    return this.rawHistory(policy).filter((t) => !staged.has(t.connection));
  }
  rawHistory(policy: "all" | "included" = "all"): any[] {
    ensureAccountIdentities(this.db);
    return (
      this.db
        .prepare(
          `SELECT t.*,s.account_id AS canonicalAccountId,c.type AS account_type,at.type AS providerAccountType,m.raw_name AS rawName,m.merchant_name AS merchantName,a.mask FROM transactions t JOIN source_accounts s ON s.env=t.env AND s.source_id=t.connection AND s.provider_account_id=t.account JOIN app_accounts c ON c.env=s.env AND c.id=s.account_id LEFT JOIN accounts a ON a.env=t.env AND a.connection=t.connection AND a.id=t.account LEFT JOIN account_types at ON at.env=t.env AND at.connection=t.connection AND at.account=t.account LEFT JOIN transaction_metadata m ON m.env=t.env AND m.source_id=t.connection AND m.transaction_id=t.id WHERE t.env=? ${policy === "included" ? "AND c.included=1" : ""} ORDER BY t.date,t.connection,t.id`,
        )
        .all(this.env) as any[]
    ).map((t) => ({
      ...t,
      canonicalTransactionId: sourceTransactionId(this.env, t.connection, t.id),
      sourceTransactionId: sourceTransactionId(this.env, t.connection, t.id),
    }));
  }
  transactions(
    accountId: string,
    options: { limit?: number; cursor?: string } = {},
  ): { rows: any[]; nextCursor: string | null } {
    const limit = Math.min(200, Math.max(1, options.limit ?? 50));
    const rows = this.rawHistory("all")
      .filter((t) => t.canonicalAccountId === accountId)
      .sort(
        (a, b) =>
          b.date.localeCompare(a.date) ||
          a.canonicalTransactionId.localeCompare(b.canonicalTransactionId),
      );
    let start = 0;
    if (options.cursor) {
      const index = rows.findIndex(
        (t) =>
          JSON.stringify([t.date, t.canonicalTransactionId]) === options.cursor,
      );
      if (index < 0) throw Error("Invalid transaction cursor");
      start = index + 1;
    }
    const page = rows.slice(start, start + limit);
    const last = page.at(-1);
    return {
      rows: page,
      nextCursor:
        start + limit < rows.length && last
          ? JSON.stringify([last.date, last.canonicalTransactionId])
          : null,
    };
  }
  coverage(accountId: string): Array<HistoryCoverage & { sourceId: string }> {
    const rows = this.rawHistory("all").filter(
      (t) => t.canonicalAccountId === accountId && !t.pending,
    );
    return (
      this.db
        .prepare(
          "SELECT d.*,x.shared FROM data_sources d JOIN source_accounts s ON s.env=d.env AND s.source_id=d.id LEFT JOIN source_account_access x ON x.env=s.env AND x.source_id=s.source_id AND x.provider_account_id=s.provider_account_id WHERE d.env=? AND s.account_id=?",
        )
        .all(this.env, accountId) as any[]
    ).map((s) => {
      const dates = rows
        .filter((t) => t.connection === s.id)
        .map((t) => t.date)
        .sort();
      return {
        sourceId: s.id,
        requestedDays: s.requested_days,
        oldestPosted: dates[0] ?? null,
        newestPosted: dates.at(-1) ?? null,
        lastChecked: s.last_checked,
        importState: s.shared === 0 ? "no_longer_shared" : s.status,
      };
    });
  }
  /** An owner action retires all applicable alias rows and preserves their exact payloads. */
  writeDecision(
    kind: "bills" | "income_decisions" | "transfer_decisions",
    decision: {
      key: string;
      status: string;
      name?: string;
      excluded?: string[];
    },
  ): void {
    this.db.transaction(() => {
      const keys = [
        decision.key,
        ...(
          this.db
            .prepare(
              "SELECT legacy_key FROM decision_id_aliases WHERE env=? AND kind=? AND canonical_key=?",
            )
            .all(this.env, kind, decision.key) as any[]
        ).map((a) => a.legacy_key),
      ];
      for (const key of new Set(keys)) {
        const original = this.db
          .prepare(`SELECT * FROM ${kind} WHERE env=? AND key=?`)
          .get(this.env, key);
        if (original) {
          this.db
            .prepare(
              "INSERT INTO decision_history(env,kind,legacy_key,payload,archived_at) VALUES(?,?,?,?,?)",
            )
            .run(
              this.env,
              kind,
              key,
              JSON.stringify(original),
              new Date().toISOString(),
            );
          this.db
            .prepare(`DELETE FROM ${kind} WHERE env=? AND key=?`)
            .run(this.env, key);
        }
      }
      if (decision.status === "review") return;
      if (kind === "bills")
        this.db
          .prepare("INSERT INTO bills VALUES(?,?,?,?,?)")
          .run(
            this.env,
            decision.key,
            decision.name,
            decision.status,
            JSON.stringify(decision.excluded ?? []),
          );
      else if (kind === "income_decisions")
        this.db
          .prepare("INSERT INTO income_decisions VALUES(?,?,?,?)")
          .run(this.env, decision.key, decision.name, decision.status);
      else
        this.db
          .prepare("INSERT INTO transfer_decisions VALUES(?,?,?)")
          .run(this.env, decision.key, decision.status);
    })();
  }
  /** Preserve originals; only evidence-backed aliases apply. Conflicts stay unresolved. */
  decisions(
    kind: "bills" | "income_decisions" | "transfer_decisions",
    aliases: Map<string, string>,
    groups?: any[],
  ): { resolved: any[]; unresolved: any[] } {
    return this.db.transaction(() => {
      const exists = this.db
        .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?")
        .get(kind);
      if (!exists) return { resolved: [], unresolved: [] };
      const originals = this.db
        .prepare(`SELECT * FROM ${kind} WHERE env=?`)
        .all(this.env) as any[];
      const resolved: any[] = [],
        unresolved: any[] = [];
      for (const d of originals) {
        const mapped = aliases.get(d.key);
        const current = [...aliases.values()].includes(d.key);
        if (!mapped && !current) {
          unresolved.push(d);
          continue;
        }
        const key = mapped ?? d.key;
        if (mapped)
          this.db
            .prepare(
              "INSERT OR IGNORE INTO decision_id_aliases VALUES(?,?,?,?)",
            )
            .run(this.env, kind, d.key, key);
        if (
          originals.some(
            (o) =>
              (aliases.get(o.key) ?? o.key) === key &&
              o.key !== d.key &&
              JSON.stringify({ ...o, key: "" }) !==
                JSON.stringify({ ...d, key: "" }),
          )
        ) {
          unresolved.push({
            ...d,
            canonicalKey: key,
            reason: "conflicting decisions",
          });
          continue;
        }
        const next = { ...d, key, legacyKey: mapped ? d.key : null };
        if (kind === "bills") {
          const excluded = JSON.parse(d.excluded);
          next.excluded = JSON.stringify(
            excluded.map((id: string) => {
              if (typeof id !== "string") return id;
              if (
                groups?.some(
                  (t) =>
                    t.canonicalTransactionId === id &&
                    (aliases.get(t.legacyGroupKey) === key ||
                      t.legacyGroupKey === d.key ||
                      aliases.get(t.legacyGroupKey) === d.key),
                )
              )
                return id;
              const t = groups?.find(
                (t) =>
                  (t.legacyGroupKey === d.key ||
                    aliases.get(t.legacyGroupKey) === d.key) &&
                  t.id === id,
              );
              return t
                ? t.canonicalTransactionId
                : { legacyId: id, legacyGroupKey: d.key };
            }),
          );
        }
        if (!resolved.some((r) => r.key === next.key)) resolved.push(next);
      }
      return { resolved, unresolved };
    })();
  }
}
