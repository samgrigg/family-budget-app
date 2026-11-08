import Database from "better-sqlite3";
import {
  accountSchemaVersion,
  applyAccountMigration,
  ensureAccountIdentities,
} from "./accountMigration";
import { AccountRepository } from "./account-repository";
import { seal, unseal } from "./crypto";
export class Store {
  db: Database.Database;
  constructor(
    path: string | Database.Database,
    private key: Buffer,
    public env: string,
  ) {
    this.db = typeof path === "string" ? new Database(path) : path;
    const disk = (this.db.pragma("database_list") as any[]).find(
      (d) => d.name === "main",
    )?.file;
    const existing = this.db
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='connections'",
      )
      .get();
    const versions = this.db
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='schema_migrations'",
      )
      .get();
    if (
      disk &&
      existing &&
      (!versions ||
        !this.db
          .prepare("SELECT 1 FROM schema_migrations WHERE version=?")
          .get(accountSchemaVersion))
    )
      throw Error(
        "Await migrateDatabase before constructing Store for an existing disk database",
      );
    this.db.pragma("journal_mode = WAL");
    bootstrapLegacy(this.db);
    applyAccountMigration(this.db);
    this.repository = new AccountRepository(this.db, this.env);
  }
  repository: AccountRepository;
  connect(id: string, token: string, accounts: any[]) {
    this.db.transaction(() => {
      this.db
        .prepare(
          "INSERT INTO connections VALUES(?,?,?,NULL,?,NULL) ON CONFLICT(env,id) DO UPDATE SET token=excluded.token",
        )
        .run(this.env, id, seal(token, this.key), "waiting");
      this.accounts(id, accounts);
      ensureAccountIdentities(this.db);
    })();
  }
  accounts(id: string, accounts: any[]) {
    this.db.transaction(() => {
      const q = this.db.prepare(
        "INSERT OR REPLACE INTO accounts VALUES(?,?,?,?,?)",
      );
      for (const a of accounts) {
        q.run(this.env, id, a.account_id, a.name, a.mask ?? "");
        this.db
          .prepare(
            "INSERT OR REPLACE INTO source_account_metadata VALUES(?,?,?,?,?)",
          )
          .run(
            this.env,
            id,
            a.account_id,
            a.subtype ?? null,
            a.ownership_type ?? null,
          );
        if (typeof a.type === "string")
          this.db
            .prepare(
              "INSERT INTO account_types VALUES(?,?,?,?) ON CONFLICT(env,connection,account) DO UPDATE SET type=excluded.type",
            )
            .run(this.env, id, a.account_id, a.type);
      }
      ensureAccountIdentities(this.db);
      for (const a of accounts)
        this.db
          .prepare(
            "UPDATE app_accounts SET type=COALESCE(?,type),subtype=COALESCE(subtype,?),ownership=COALESCE(ownership,?) WHERE env=? AND id=(SELECT account_id FROM source_accounts WHERE env=? AND source_id=? AND provider_account_id=?)",
          )
          .run(
            typeof a.type === "string" ? a.type : null,
            a.subtype ?? null,
            a.ownership_type ?? null,
            this.env,
            this.env,
            id,
            a.account_id,
          );
    })();
  }
  connection(id: string): any {
    const row = this.db
      .prepare("SELECT * FROM connections WHERE env=? AND id=?")
      .get(this.env, id);
    if (!row) throw Error("Connection not found");
    return row;
  }
  token(id: string) {
    const row = this.connection(id);
    if (!row.token || row.status === "historical")
      throw Object.assign(Error("Source is disconnected"), {
        code: "DISCONNECTED",
      });
    return unseal(row.token, this.key);
  }
  list(): any[] {
    return this.db
      .prepare(
        "SELECT c.id,c.status,c.last_sync,d.name AS institution_name,d.label,COALESCE(NULLIF(d.label,''),d.name) AS display_name FROM connections c LEFT JOIN institution_details d ON d.env=c.env AND d.connection=c.id WHERE c.env=?",
      )
      .all(this.env);
  }
  nameInstitution(id: string, name: string, custom = false) {
    this.connection(id);
    const column = custom ? "label" : "name";
    this.db
      .prepare(
        `INSERT INTO institution_details(env,connection,${column}) VALUES(?,?,?) ON CONFLICT(env,connection) DO UPDATE SET ${column}=excluded.${column}`,
      )
      .run(this.env, id, name);
  }
  accountList(): any[] {
    return this.repository.accounts();
  }
  setAccountHidden(connection: string, account: string, hidden: boolean) {
    if (
      !this.db
        .prepare("SELECT 1 FROM accounts WHERE env=? AND connection=? AND id=?")
        .get(this.env, connection, account)
    )
      return false;
    this.db.transaction(() => {
      ensureAccountIdentities(this.db);
      this.db
        .prepare(
          `INSERT INTO account_preferences VALUES(?,?,?,?)
      ON CONFLICT(env,connection,account) DO UPDATE SET hidden=excluded.hidden`,
        )
        .run(this.env, connection, account, hidden ? 1 : 0);
      this.db
        .prepare(
          "UPDATE app_accounts SET included=? WHERE env=? AND id=(SELECT account_id FROM source_accounts WHERE env=? AND source_id=? AND provider_account_id=?)",
        )
        .run(hidden ? 0 : 1, this.env, this.env, connection, account);
    })();
    return true;
  }
  transactions(): any[] {
    const accounts = new Map(
      this.repository.accounts().map((a) => [a.canonicalAccountId, a]),
    );
    return this.repository
      .history("included")
      .sort((a, b) => b.date.localeCompare(a.date))
      .map((t) => ({
        ...t,
        account_id: t.account,
        account: accounts.get(t.canonicalAccountId)?.name,
      }));
  }
  commit(id: string, pages: any[], cursor: string, accounts: any[]) {
    this.db.transaction(() => {
      if (this.connection(id).status === "historical")
        throw Object.assign(Error("Source is disconnected"), {
          code: "DISCONNECTED",
        });
      this.accounts(id, accounts);
      const put = this.db.prepare(
        "INSERT OR REPLACE INTO transactions VALUES(?,?,?,?,?,?,?,?,?)",
      );
      const del = this.db.prepare(
        "DELETE FROM transactions WHERE env=? AND connection=? AND id=?",
      );
      for (const p of pages) {
        for (const t of [...p.added, ...p.modified]) {
          if (t.pending_transaction_id)
            del.run(this.env, id, t.pending_transaction_id);
          this.db
            .prepare(
              "INSERT OR REPLACE INTO transaction_metadata VALUES(?,?,?,?,?)",
            )
            .run(
              this.env,
              id,
              t.transaction_id,
              t.name ?? null,
              t.merchant_name ?? null,
            );
          put.run(
            this.env,
            id,
            t.transaction_id,
            t.account_id,
            t.date,
            t.merchant_name || t.name,
            String(t.amount),
            t.iso_currency_code || t.unofficial_currency_code || "",
            t.pending ? 1 : 0,
          );
        }
        for (const t of p.removed) del.run(this.env, id, t.transaction_id);
      }
      const status = pages.at(-1)?.transactions_update_status;
      this.db
        .prepare(
          "UPDATE connections SET cursor=?,status=?,last_sync=? WHERE env=? AND id=?",
        )
        .run(
          cursor,
          status === "HISTORICAL_UPDATE_COMPLETE"
            ? "ready"
            : status === "INITIAL_UPDATE_COMPLETE"
              ? "history_pending"
              : "waiting",
          new Date().toISOString(),
          this.env,
          id,
        );
      ensureAccountIdentities(this.db);
      this.db
        .prepare(
          "UPDATE data_sources SET status=(SELECT status FROM connections WHERE env=? AND id=?),last_checked=(SELECT last_sync FROM connections WHERE env=? AND id=?) WHERE env=? AND id=?",
        )
        .run(this.env, id, this.env, id, this.env, id);
    })();
  }
  sourceStatus(id: string, status: string, eraseToken = false) {
    this.db.transaction(() => {
      this.db
        .prepare(
          `UPDATE connections SET status=?${eraseToken ? ",token=NULL" : ""} WHERE env=? AND id=?`,
        )
        .run(status, this.env, id);
      this.db
        .prepare("UPDATE data_sources SET status=? WHERE env=? AND id=?")
        .run(status, this.env, id);
    })();
  }
  resolveMissingAccess(id: string) {
    return this.db.transaction(() => {
      const source = this.db
        .prepare("SELECT 1 FROM data_sources WHERE env=? AND id=?")
        .get(this.env, id);
      if (!source) return "missing";
      const connection = this.db
        .prepare("SELECT token FROM connections WHERE env=? AND id=?")
        .get(this.env, id) as any;
      if (connection?.token) return "credential_present";
      this.db
        .prepare(
          "INSERT INTO connections(env,id,token,cursor,status,last_sync) VALUES(?,?,NULL,NULL,'historical',NULL) ON CONFLICT(env,id) DO UPDATE SET status='historical',token=NULL",
        )
        .run(this.env, id);
      this.db
        .prepare(
          "UPDATE data_sources SET status='historical' WHERE env=? AND id=?",
        )
        .run(this.env, id);
      this.db
        .prepare(
          "INSERT INTO decision_history(env,kind,legacy_key,payload,archived_at) VALUES(?,?,?,?,?)",
        )
        .run(
          this.env,
          "source_authorization",
          id,
          JSON.stringify({
            authorizationBasis: "owner_confirmed_external_revocation",
            providerRevocationVerified: false,
          }),
          new Date().toISOString(),
        );
      return "resolved";
    })();
  }
  deleteAccount(id: string) {
    this.db.transaction(() => {
      const mappings = this.db
        .prepare(
          "SELECT s.*,d.status,c.token FROM source_accounts s LEFT JOIN data_sources d ON d.env=s.env AND d.id=s.source_id LEFT JOIN connections c ON c.env=s.env AND c.id=s.source_id WHERE s.env=? AND s.account_id=?",
        )
        .all(this.env, id) as any[];
      // Unknown/retry authorization is unsafe: only positively historical sources qualify.
      if (mappings.some((m) => m.status !== "historical" || m.token))
        throw Object.assign(
          Error(
            "Disconnect every source for this account before deleting its history. If its credential is missing, revoke access through your institution or Plaid Portal, then confirm external revocation using resolve-missing-access.",
          ),
          { code: "SOURCE_AUTHORIZED" },
        );
      this.db
        .prepare(
          "UPDATE account_links SET status='deleted' WHERE env=? AND status='linked' AND (left_id=? OR right_id=?)",
        )
        .run(this.env, id, id);
      for (const m of mappings) {
        this.db
          .prepare(
            "DELETE FROM transaction_metadata WHERE env=? AND source_id=? AND transaction_id IN (SELECT id FROM transactions WHERE env=? AND connection=? AND account=?)",
          )
          .run(
            this.env,
            m.source_id,
            this.env,
            m.source_id,
            m.provider_account_id,
          );
        this.db
          .prepare(
            "DELETE FROM transactions WHERE env=? AND connection=? AND account=?",
          )
          .run(this.env, m.source_id, m.provider_account_id);
        for (const [table, column] of [
          ["accounts", "id"],
          ["account_preferences", "account"],
          ["account_types", "account"],
        ])
          this.db
            .prepare(
              `DELETE FROM ${table} WHERE env=? AND connection=? AND ${column}=?`,
            )
            .run(this.env, m.source_id, m.provider_account_id);
        this.db
          .prepare(
            "DELETE FROM source_account_metadata WHERE env=? AND source_id=? AND account_id=?",
          )
          .run(this.env, m.source_id, m.provider_account_id);
      }
      for (const table of ["source_accounts", "account_id_aliases"])
        this.db
          .prepare(`DELETE FROM ${table} WHERE env=? AND account_id=?`)
          .run(this.env, id);
      this.db
        .prepare("DELETE FROM app_accounts WHERE env=? AND id=?")
        .run(this.env, id);
    })();
  }
  remove(id: string) {
    this.db.transaction(() => {
      for (const table of [
        "transactions",
        "accounts",
        "account_preferences",
        "account_types",
        "institution_details",
      ])
        this.db
          .prepare(`DELETE FROM ${table} WHERE env=? AND connection=?`)
          .run(this.env, id);
      this.db
        .prepare("DELETE FROM connections WHERE env=? AND id=?")
        .run(this.env, id);
    })();
  }
}

export function bootstrapLegacy(db: Database.Database) {
  db.exec(
    `CREATE TABLE IF NOT EXISTS account_types(env TEXT,connection TEXT,account TEXT,type TEXT,PRIMARY KEY(env,connection,account));CREATE TABLE IF NOT EXISTS institution_details(env TEXT,connection TEXT,name TEXT,label TEXT,PRIMARY KEY(env,connection));CREATE TABLE IF NOT EXISTS account_preferences(env TEXT,connection TEXT,account TEXT,hidden INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(env,connection,account));CREATE TABLE IF NOT EXISTS connections(env TEXT,id TEXT,token TEXT,cursor TEXT,status TEXT,last_sync TEXT,PRIMARY KEY(env,id));CREATE TABLE IF NOT EXISTS accounts(env TEXT,connection TEXT,id TEXT,name TEXT,mask TEXT,PRIMARY KEY(env,connection,id));CREATE TABLE IF NOT EXISTS transactions(env TEXT,connection TEXT,id TEXT,account TEXT,date TEXT,name TEXT,amount TEXT,currency TEXT,pending INTEGER,PRIMARY KEY(env,connection,id));`,
  );
}
