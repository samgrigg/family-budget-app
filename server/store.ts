import Database from "better-sqlite3";
import { seal, unseal } from "./crypto";
export class Store {
  db: Database.Database;
  constructor(
    path: string | Database.Database,
    private key: Buffer,
    public env: string,
  ) {
    this.db = typeof path === "string" ? new Database(path) : path;
    this.db.pragma("journal_mode = WAL");
    this.db.exec(
      `CREATE TABLE IF NOT EXISTS account_types(env TEXT,connection TEXT,account TEXT,type TEXT,PRIMARY KEY(env,connection,account));CREATE TABLE IF NOT EXISTS institution_details(env TEXT,connection TEXT,name TEXT,label TEXT,PRIMARY KEY(env,connection));CREATE TABLE IF NOT EXISTS account_preferences(env TEXT,connection TEXT,account TEXT,hidden INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(env,connection,account));CREATE TABLE IF NOT EXISTS connections(env TEXT,id TEXT,token TEXT,cursor TEXT,status TEXT,last_sync TEXT,PRIMARY KEY(env,id));CREATE TABLE IF NOT EXISTS accounts(env TEXT,connection TEXT,id TEXT,name TEXT,mask TEXT,PRIMARY KEY(env,connection,id));CREATE TABLE IF NOT EXISTS transactions(env TEXT,connection TEXT,id TEXT,account TEXT,date TEXT,name TEXT,amount TEXT,currency TEXT,pending INTEGER,PRIMARY KEY(env,connection,id));`,
    );
  }
  connect(id: string, token: string, accounts: any[]) {
    this.db.transaction(() => {
      this.db
        .prepare(
          "INSERT INTO connections VALUES(?,?,?,NULL,?,NULL) ON CONFLICT(env,id) DO UPDATE SET token=excluded.token",
        )
        .run(this.env, id, seal(token, this.key), "waiting");
      this.accounts(id, accounts);
    })();
  }
  accounts(id: string, accounts: any[]) {
    const q = this.db.prepare(
      "INSERT OR REPLACE INTO accounts VALUES(?,?,?,?,?)",
    );
    for (const a of accounts) {
      q.run(this.env, id, a.account_id, a.name, a.mask ?? "");
      if (typeof a.type === "string")
        this.db
          .prepare(
            "INSERT INTO account_types VALUES(?,?,?,?) ON CONFLICT(env,connection,account) DO UPDATE SET type=excluded.type",
          )
          .run(this.env, id, a.account_id, a.type);
    }
  }
  connection(id: string): any {
    const row = this.db
      .prepare("SELECT * FROM connections WHERE env=? AND id=?")
      .get(this.env, id);
    if (!row) throw Error("Connection not found");
    return row;
  }
  token(id: string) {
    return unseal(this.connection(id).token, this.key);
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
    return this.db
      .prepare(
        `SELECT a.*,COALESCE(p.hidden,0) AS hidden
      FROM accounts a LEFT JOIN account_preferences p
      ON p.env=a.env AND p.connection=a.connection AND p.account=a.id
      WHERE a.env=? ORDER BY a.connection,a.name,a.id`,
      )
      .all(this.env);
  }
  setAccountHidden(connection: string, account: string, hidden: boolean) {
    if (
      !this.db
        .prepare("SELECT 1 FROM accounts WHERE env=? AND connection=? AND id=?")
        .get(this.env, connection, account)
    )
      return false;
    this.db
      .prepare(
        `INSERT INTO account_preferences VALUES(?,?,?,?)
      ON CONFLICT(env,connection,account) DO UPDATE SET hidden=excluded.hidden`,
      )
      .run(this.env, connection, account, hidden ? 1 : 0);
    return true;
  }
  transactions(): any[] {
    return this.db
      .prepare(
        "SELECT t.id,t.connection,t.account AS account_id,a.mask,t.date,t.name,t.amount,t.currency,t.pending,a.name AS account FROM transactions t LEFT JOIN accounts a ON a.env=t.env AND a.connection=t.connection AND a.id=t.account WHERE t.env=? AND NOT EXISTS (SELECT 1 FROM account_preferences p WHERE p.env=t.env AND p.connection=t.connection AND p.account=t.account AND p.hidden=1) ORDER BY t.date DESC,t.id LIMIT 2000",
      )
      .all(this.env);
  }
  commit(id: string, pages: any[], cursor: string, accounts: any[]) {
    this.db.transaction(() => {
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
