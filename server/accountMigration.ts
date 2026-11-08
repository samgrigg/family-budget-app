import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { chmod, mkdir, open, rm } from "node:fs/promises";
import { dirname, join } from "node:path";

const version = 1;
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
        `SELECT c.*,d.name,d.label FROM connections c LEFT JOIN institution_details d ON d.env=c.env AND d.connection=c.id`,
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
          `SELECT a.*,t.type,COALESCE(p.hidden,0) AS hidden FROM accounts a LEFT JOIN account_types t ON t.env=a.env AND t.connection=a.connection AND t.account=a.id LEFT JOIN account_preferences p ON p.env=a.env AND p.connection=a.connection AND p.account=a.id WHERE a.env=? AND a.connection=?`,
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
  db.transaction(() => {
    db.exec(
      hasVersions
        ? schema.slice(schema.indexOf("CREATE TABLE app_institutions"))
        : schema,
    );
    ensureAccountIdentities(db);
    db.prepare("INSERT INTO schema_migrations VALUES(?,?)").run(
      version,
      new Date().toISOString(),
    );
  })();
}
