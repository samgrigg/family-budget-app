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
      `CREATE TABLE IF NOT EXISTS connections(env TEXT,id TEXT,token TEXT,cursor TEXT,status TEXT,last_sync TEXT,PRIMARY KEY(env,id));CREATE TABLE IF NOT EXISTS accounts(env TEXT,connection TEXT,id TEXT,name TEXT,mask TEXT,PRIMARY KEY(env,connection,id));CREATE TABLE IF NOT EXISTS transactions(env TEXT,connection TEXT,id TEXT,account TEXT,date TEXT,name TEXT,amount TEXT,currency TEXT,pending INTEGER,PRIMARY KEY(env,connection,id));`,
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
    for (const a of accounts)
      q.run(this.env, id, a.account_id, a.name, a.mask ?? "");
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
      .prepare("SELECT id,status,last_sync FROM connections WHERE env=?")
      .all(this.env);
  }
  transactions(): any[] {
    return this.db
      .prepare(
        "SELECT t.id,t.connection,t.date,t.name,t.amount,t.currency,t.pending,a.name AS account FROM transactions t LEFT JOIN accounts a ON a.env=t.env AND a.connection=t.connection AND a.id=t.account WHERE t.env=? ORDER BY t.date DESC,t.id LIMIT 2000",
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
      for (const table of ["transactions", "accounts"])
        this.db
          .prepare(`DELETE FROM ${table} WHERE env=? AND connection=?`)
          .run(this.env, id);
      this.db
        .prepare("DELETE FROM connections WHERE env=? AND id=?")
        .run(this.env, id);
    })();
  }
}
