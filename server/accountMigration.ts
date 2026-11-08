import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { chmod, mkdir, open, rm } from "node:fs/promises";
import { dirname, join } from "node:path";

export const accountSchemaVersion = 6;
const version = accountSchemaVersion;
const schema = `
CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
CREATE TABLE app_institutions(env TEXT NOT NULL,id TEXT NOT NULL,name TEXT NOT NULL,provisional INTEGER NOT NULL DEFAULT 1,PRIMARY KEY(env,id));
CREATE TABLE institution_aliases(env TEXT NOT NULL,provider TEXT NOT NULL,provider_id TEXT NOT NULL,institution_id TEXT NOT NULL,PRIMARY KEY(env,provider,provider_id));
CREATE TABLE app_accounts(env TEXT NOT NULL,id TEXT NOT NULL,institution_id TEXT NOT NULL,name TEXT NOT NULL,type TEXT,subtype TEXT,ownership TEXT,included INTEGER NOT NULL DEFAULT 1,PRIMARY KEY(env,id));
CREATE TABLE data_sources(env TEXT NOT NULL,id TEXT NOT NULL,provider TEXT NOT NULL,institution_id TEXT NOT NULL,label TEXT,status TEXT NOT NULL,requested_days INTEGER NOT NULL,last_checked TEXT,PRIMARY KEY(env,id));
CREATE TABLE source_accounts(env TEXT NOT NULL,source_id TEXT NOT NULL,provider_account_id TEXT NOT NULL,account_id TEXT NOT NULL,PRIMARY KEY(env,source_id,provider_account_id));
CREATE TABLE account_id_aliases(env TEXT NOT NULL,source_id TEXT NOT NULL,provider_account_id TEXT NOT NULL,account_id TEXT NOT NULL,PRIMARY KEY(env,source_id,provider_account_id));`;

/** Backfill new provider records after migration, without overwriting owner choices.
 * Call inside the same write transaction as provider updates before enabling readers.
 * Legacy records contain no verified institution provider ID, so labels never merge IDs.
 */
export function ensureAccountIdentities(db: Database.Database): void {
  db.transaction(() => {
    const sources = db
      .prepare(
        `SELECT c.*,d.name,d.label FROM (SELECT env,id,status,last_sync FROM connections UNION SELECT env,connection,NULL,NULL FROM accounts WHERE NOT EXISTS(SELECT 1 FROM connections c WHERE c.env=accounts.env AND c.id=accounts.connection) UNION SELECT env,connection,NULL,NULL FROM transactions WHERE NOT EXISTS(SELECT 1 FROM connections c WHERE c.env=transactions.env AND c.id=transactions.connection)) c LEFT JOIN institution_details d ON d.env=c.env AND d.connection=c.id`,
      )
      .all() as any[];
    for (const source of sources) {
      let identity = db
        .prepare("SELECT institution_id FROM data_sources WHERE env=? AND id=?")
        .get(source.env, source.id) as { institution_id: string } | undefined;
      if (!identity) {
        identity = { institution_id: randomUUID() };
        db.prepare("INSERT INTO app_institutions VALUES(?,?,?,1)").run(
          source.env,
          identity.institution_id,
          source.name || "Institution",
        );
        db.prepare("INSERT INTO data_sources VALUES(?,?,?,?,?,?,90,?)").run(
          source.env,
          source.id,
          "plaid",
          identity.institution_id,
          source.label ?? source.name ?? null,
          source.status ?? "waiting",
          source.last_sync,
        );
      }
      const accounts = db
        .prepare(
          `SELECT a.*,t.type,COALESCE(p.hidden,0) AS hidden FROM (SELECT env,connection,id,name,mask FROM accounts UNION SELECT DISTINCT env,connection,account,'Unknown account','' FROM transactions WHERE NOT EXISTS(SELECT 1 FROM accounts a WHERE a.env=transactions.env AND a.connection=transactions.connection AND a.id=transactions.account)) a LEFT JOIN account_types t ON t.env=a.env AND t.connection=a.connection AND t.account=a.id LEFT JOIN account_preferences p ON p.env=a.env AND p.connection=a.connection AND p.account=a.id WHERE a.env=? AND a.connection=?`,
        )
        .all(source.env, source.id) as any[];
      for (const account of accounts) {
        if (
          db
            .prepare(
              "SELECT 1 FROM source_accounts WHERE env=? AND source_id=? AND provider_account_id=?",
            )
            .get(source.env, source.id, account.id)
        )
          continue;
        const id = randomUUID();
        db.prepare(
          "INSERT INTO app_accounts VALUES(?,?,?,?,?,NULL,NULL,?)",
        ).run(
          source.env,
          id,
          identity.institution_id,
          account.name,
          account.type ?? null,
          account.hidden ? 0 : 1,
        );
        db.prepare("INSERT INTO source_accounts VALUES(?,?,?,?)").run(
          source.env,
          source.id,
          account.id,
          id,
        );
        db.prepare("INSERT INTO account_id_aliases VALUES(?,?,?,?)").run(
          source.env,
          source.id,
          account.id,
          id,
        );
      }
    }
  })();
}

/** Explicit startup gate: await before constructing Store or serving requests.
 * Disk databases always require a successful SQLite online backup. In-memory
 * databases are identified by SQLite itself and need no disk snapshot.
 * No startup integration is enabled until the controller opts in.
 */
export async function migrateDatabase(
  db: Database.Database,
  options: { backupDirectory?: string } = {},
): Promise<void> {
  const hasVersions = db
    .prepare(
      "SELECT 1 FROM sqlite_master WHERE type='table' AND name='schema_migrations'",
    )
    .get();
  if (
    hasVersions &&
    db.prepare("SELECT 1 FROM schema_migrations WHERE version=?").get(version)
  )
    return;
  if (db.inTransaction)
    throw new Error(
      "Account migration must run outside an existing transaction",
    );
  const file = (
    db.pragma("database_list") as { name: string; file: string }[]
  ).find((row) => row.name === "main")?.file;
  if (file) {
    const directory =
      options.backupDirectory ?? join(dirname(file), "migration-backups");
    let destination: string | undefined;
    try {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      await chmod(directory, 0o700);
      destination = join(
        directory,
        `before-accounts-v${version}-${randomUUID()}.sqlite`,
      );
      const handle = await open(destination, "wx", 0o600);
      await handle.close();
      await db.backup(destination);
      await chmod(destination, 0o600);
    } catch (cause) {
      if (destination) await rm(destination, { force: true }).catch(() => {});
      throw new Error("Account migration stopped: database backup failed", {
        cause,
      });
    }
  }
  applyAccountMigration(db);
}

/** Synchronous only after startup backup, or for memory/fresh databases. */
export function applyAccountMigration(db: Database.Database): void {
  const hasVersions = db
    .prepare(
      "SELECT 1 FROM sqlite_master WHERE type='table' AND name='schema_migrations'",
    )
    .get();
  if (
    hasVersions &&
    db.prepare("SELECT 1 FROM schema_migrations WHERE version=?").get(version)
  )
    return;
  db.transaction(() => {
    if (
      !hasVersions ||
      !db.prepare("SELECT 1 FROM schema_migrations WHERE version=1").get()
    ) {
      db.exec(
        hasVersions
          ? schema.slice(schema.indexOf("CREATE TABLE app_institutions"))
          : schema,
      );
      db.prepare("INSERT INTO schema_migrations VALUES(1,?)").run(
        new Date().toISOString(),
      );
    }
    db.exec(`CREATE TABLE IF NOT EXISTS transaction_metadata(env TEXT,source_id TEXT,transaction_id TEXT,raw_name TEXT,merchant_name TEXT,PRIMARY KEY(env,source_id,transaction_id));
      CREATE TABLE IF NOT EXISTS source_account_metadata(env TEXT,source_id TEXT,account_id TEXT,subtype TEXT,ownership TEXT,PRIMARY KEY(env,source_id,account_id));
      CREATE TABLE IF NOT EXISTS decision_history(id INTEGER PRIMARY KEY,env TEXT,kind TEXT,legacy_key TEXT,payload TEXT NOT NULL,archived_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS decision_id_aliases(env TEXT,kind TEXT,legacy_key TEXT,canonical_key TEXT,PRIMARY KEY(env,kind,legacy_key,canonical_key));`);
    db.exec(`CREATE TABLE IF NOT EXISTS account_links(env TEXT NOT NULL,id TEXT NOT NULL,left_id TEXT NOT NULL,right_id TEXT NOT NULL,preferred_source TEXT NOT NULL,status TEXT NOT NULL,snapshot TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(env,id));
      CREATE TABLE IF NOT EXISTS transaction_events(env TEXT NOT NULL,account_id TEXT NOT NULL,signature TEXT NOT NULL,ordinal INTEGER NOT NULL,event_id TEXT NOT NULL,PRIMARY KEY(env,account_id,signature,ordinal));
      CREATE TABLE IF NOT EXISTS transaction_event_aliases(env TEXT NOT NULL,source_id TEXT NOT NULL,transaction_id TEXT NOT NULL,signature TEXT NOT NULL,event_id TEXT NOT NULL,PRIMARY KEY(env,source_id,transaction_id));`);
    if (!db.prepare("SELECT 1 FROM schema_migrations WHERE version=2").get())
      db.prepare("INSERT INTO schema_migrations VALUES(2,?)").run(
        new Date().toISOString(),
      );
    if (!db.prepare("SELECT 1 FROM schema_migrations WHERE version=3").get())
      db.prepare("INSERT INTO schema_migrations VALUES(3,?)").run(
        new Date().toISOString(),
      );
    if (!db.prepare("SELECT 1 FROM schema_migrations WHERE version=4").get()) {
      db.exec(`CREATE TABLE IF NOT EXISTS transaction_event_occupancy(env TEXT NOT NULL,source_id TEXT NOT NULL,event_id TEXT NOT NULL,transaction_id TEXT,PRIMARY KEY(env,source_id,event_id));
      INSERT OR IGNORE INTO transaction_event_occupancy SELECT env,source_id,event_id,transaction_id FROM transaction_event_aliases;
      INSERT OR IGNORE INTO transaction_event_occupancy SELECT e.env,s.source_id,e.event_id,NULL FROM transaction_events e JOIN source_accounts s ON s.env=e.env AND s.account_id=e.account_id;`);
      db.prepare("INSERT INTO schema_migrations VALUES(4,?)").run(
        new Date().toISOString(),
      );
    }
    db.exec(
      `CREATE TABLE IF NOT EXISTS source_account_access(env TEXT NOT NULL,source_id TEXT NOT NULL,provider_account_id TEXT NOT NULL,shared INTEGER NOT NULL,PRIMARY KEY(env,source_id,provider_account_id));`,
    );
    if (!db.prepare("SELECT 1 FROM schema_migrations WHERE version=5").get())
      db.prepare("INSERT INTO schema_migrations VALUES(5,?)").run(
        new Date().toISOString(),
      );
    db.exec(`CREATE TABLE IF NOT EXISTS source_replacements(env TEXT NOT NULL,id TEXT NOT NULL,old_source_id TEXT NOT NULL,new_source_id TEXT,state TEXT NOT NULL,requested_days INTEGER NOT NULL,last_error TEXT,PRIMARY KEY(env,id));
      CREATE TABLE IF NOT EXISTS replacement_reviews(env TEXT NOT NULL,operation_id TEXT NOT NULL,provider_account_id TEXT NOT NULL,account_id TEXT NOT NULL,outcome TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(env,operation_id,provider_account_id));`);
    // A missing historical v3 alias is unknown occupancy, not proof that a slot is free.
    ensureAccountIdentities(db);
    db.prepare("INSERT INTO schema_migrations VALUES(?,?)").run(
      version,
      new Date().toISOString(),
    );
  })();
}
