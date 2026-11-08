import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { mkdtemp, stat, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store, bootstrapLegacy } from "../server/store";
import {
  migrateDatabase,
  ensureAccountIdentities,
} from "../server/accountMigration";

const tables = [
  "account_types",
  "institution_details",
  "account_preferences",
  "connections",
  "accounts",
  "transactions",
  "bills",
  "income_decisions",
  "transfer_decisions",
];
function fixture(path = ":memory:") {
  const db = new Database(path);
  // Store creates the exact legacy schema, with no provider calls or real data.
  bootstrapLegacy(db);
  db.exec(`CREATE TABLE bills(env TEXT,key TEXT,name TEXT,status TEXT,excluded TEXT NOT NULL DEFAULT '[]',PRIMARY KEY(env,key));
    CREATE TABLE income_decisions(env TEXT,key TEXT,name TEXT,status TEXT,PRIMARY KEY(env,key));
    CREATE TABLE transfer_decisions(env TEXT,key TEXT,status TEXT,PRIMARY KEY(env,key));`);
  for (const env of ["sandbox", "production"]) {
    for (const source of ["macu-1", "macu-2"]) {
      db.prepare("INSERT INTO connections VALUES(?,?,?,?,?,?)").run(
        env,
        source,
        "sealed:\u0000token/==",
        "cursor:\u0000/==",
        "ready",
        "2026-01-01",
      );
      db.prepare("INSERT INTO institution_details VALUES(?,?,?,?)").run(
        env,
        source,
        "MACU",
        "My credit union",
      );
      db.prepare("INSERT INTO accounts VALUES(?,?,?,?,?)").run(
        env,
        source,
        "account",
        "Checking",
        "1234",
      );
      db.prepare("INSERT INTO account_types VALUES(?,?,?,?)").run(
        env,
        source,
        "account",
        "depository",
      );
      db.prepare("INSERT INTO account_preferences VALUES(?,?,?,?)").run(
        env,
        source,
        "account",
        source === "macu-2" ? 1 : 0,
      );
      db.prepare("INSERT INTO transactions VALUES(?,?,?,?,?,?,?,?,?)").run(
        env,
        source,
        "tx",
        "account",
        "2026-01-01",
        "Pay",
        "12.34",
        "USD",
        0,
      );
    }
    db.prepare("INSERT INTO bills VALUES(?,?,?,?,?)").run(
      env,
      "b",
      "Bill",
      "confirmed",
      '["tx", "\\u0000"]',
    );
    db.prepare("INSERT INTO income_decisions VALUES(?,?,?,?)").run(
      env,
      "i",
      "Pay",
      "ignored",
    );
    db.prepare("INSERT INTO transfer_decisions VALUES(?,?,?)").run(
      env,
      "t",
      "confirmed",
    );
  }
  return db;
}
const snapshot = (db: Database.Database) =>
  Object.fromEntries(
    tables.map((t) => [
      t,
      db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all(),
    ]),
  );

describe("account identity migration", () => {
  it("preserves every legacy row and creates distinct UUID identities across sources/environments, once", async () => {
    const db = fixture();
    try {
      const before = snapshot(db);
      await migrateDatabase(db);
      expect(snapshot(db)).toEqual(before);
      const accounts = db
        .prepare("SELECT * FROM app_accounts ORDER BY env,included")
        .all() as any[];
      expect(accounts).toHaveLength(4);
      expect(new Set(accounts.map((a) => a.id)).size).toBe(4);
      for (const a of accounts) {
        expect(a.id).toMatch(/^[\da-f]{8}-[\da-f-]{27}$/);
        expect(a.subtype).toBeNull();
        expect(a.ownership).toBeNull();
      }
      expect(accounts.map((a) => a.included)).toEqual([0, 1, 0, 1]);
      expect(db.prepare("SELECT * FROM app_institutions").all()).toHaveLength(
        4,
      );
      expect(db.prepare("SELECT * FROM source_accounts").all()).toHaveLength(4);
      expect(db.prepare("SELECT * FROM account_id_aliases").all()).toHaveLength(
        4,
      );
      expect(
        db.prepare("SELECT label,requested_days FROM data_sources").all(),
      ).toEqual(
        Array(4).fill({ label: "My credit union", requested_days: 90 }),
      );
      await migrateDatabase(db);
      expect(
        db.prepare("SELECT * FROM app_accounts ORDER BY env,included").all(),
      ).toEqual(accounts);
      expect(db.prepare("SELECT * FROM schema_migrations").all()).toHaveLength(
        3,
      );
    } finally {
      db.close();
    }
  });
  it("backfills new provider accounts without changing owner choices", async () => {
    const db = fixture();
    try {
      await migrateDatabase(db);
      db.exec("UPDATE app_accounts SET name='Owner name',included=0");
      const existing = db
        .prepare("SELECT * FROM app_accounts ORDER BY id")
        .all();
      db.prepare("INSERT INTO accounts VALUES(?,?,?,?,?)").run(
        "sandbox",
        "macu-1",
        "new",
        "Savings",
        "1234",
      );
      ensureAccountIdentities(db);
      ensureAccountIdentities(db);
      expect(
        db
          .prepare(
            "SELECT * FROM app_accounts WHERE name='Owner name' ORDER BY id",
          )
          .all(),
      ).toEqual(existing);
      expect(db.prepare("SELECT * FROM app_accounts").all()).toHaveLength(5);
    } finally {
      db.close();
    }
  });
  it("rolls back DDL, identities and version when a legacy read fails, then can retry", async () => {
    const db = fixture();
    try {
      const before = snapshot(db);
      db.exec(
        "ALTER TABLE accounts RENAME TO held_accounts; CREATE VIEW accounts AS SELECT * FROM missing_table",
      );
      await expect(migrateDatabase(db)).rejects.toThrow();
      expect(
        db
          .prepare(
            "SELECT name FROM sqlite_master WHERE name IN ('schema_migrations','app_accounts','app_institutions')",
          )
          .all(),
      ).toEqual([]);
      db.exec(
        "DROP VIEW accounts; ALTER TABLE held_accounts RENAME TO accounts",
      );
      expect(snapshot(db)).toEqual(before);
      await migrateDatabase(db);
      expect(db.prepare("SELECT * FROM schema_migrations").all()).toHaveLength(
        3,
      );
    } finally {
      db.close();
    }
  });
  it("awaits a private WAL-safe backup only when pending and fails closed on backup failure", async () => {
    const dir = await mkdtemp(join(tmpdir(), "account-migration-"));
    const db = fixture(join(dir, "live.sqlite"));
    try {
      const before = snapshot(db);
      await writeFile(join(dir, "blocked"), "file");
      await expect(
        migrateDatabase(db, { backupDirectory: join(dir, "blocked") }),
      ).rejects.toThrow(/backup/i);
      expect(
        db
          .prepare(
            "SELECT name FROM sqlite_master WHERE name='schema_migrations'",
          )
          .all(),
      ).toEqual([]);
      const backupDirectory = join(dir, "backups");
      await migrateDatabase(db, { backupDirectory });
      const files = await readdir(backupDirectory);
      expect(files).toHaveLength(1);
      expect((await stat(backupDirectory)).mode & 0o777).toBe(0o700);
      expect((await stat(join(backupDirectory, files[0]))).mode & 0o777).toBe(
        0o600,
      );
      const backup = new Database(join(backupDirectory, files[0]), {
        readonly: true,
      });
      expect(snapshot(backup)).toEqual(before);
      expect(
        backup
          .prepare(
            "SELECT name FROM sqlite_master WHERE name='schema_migrations'",
          )
          .all(),
      ).toEqual([]);
      backup.close();
      const afterRead = await readdir(backupDirectory);
      await migrateDatabase(db, { backupDirectory });
      expect(await readdir(backupDirectory)).toEqual(afterRead);
    } finally {
      db.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});

it("backs up a version-one database before read-boundary schema upgrade and guards disk Store construction", async () => {
  const dir = await mkdtemp(join(tmpdir(), "budget-read-upgrade-"));
  const path = join(dir, "legacy.sqlite");
  const db = fixture(path);
  try {
    expect(() => new Store(db, Buffer.alloc(32), "sandbox")).toThrow(
      /Await migrateDatabase/,
    );
    await migrateDatabase(db);
    db.exec(
      "DROP TABLE transaction_metadata; DROP TABLE source_account_metadata; DROP TABLE decision_id_aliases; DROP TABLE account_links; DROP TABLE transaction_events; DROP TABLE transaction_event_aliases; DELETE FROM schema_migrations WHERE version>=2",
    );
    const existing = (await readdir(join(dir, "migration-backups"))).length;
    expect(() => new Store(db, Buffer.alloc(32), "sandbox")).toThrow(
      /Await migrateDatabase/,
    );
    await migrateDatabase(db);
    expect((await readdir(join(dir, "migration-backups"))).length).toBe(
      existing + 1,
    );
    const s = new Store(db, Buffer.alloc(32), "sandbox");
    expect(s.repository.listAccounts()).toHaveLength(2);
  } finally {
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
});

it("backs up a version-two database before reversible-link schema changes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "budget-link-upgrade-"));
  const db = fixture(join(dir, "old.sqlite"));
  try {
    await migrateDatabase(db);
    const before = snapshot(db);
    db.exec(
      "DROP TABLE account_links; DROP TABLE transaction_events; DROP TABLE transaction_event_aliases; DELETE FROM schema_migrations WHERE version=3",
    );
    const count = (await readdir(join(dir, "migration-backups"))).length;
    expect(() => new Store(db, Buffer.alloc(32), "sandbox")).toThrow(
      /Await migrateDatabase/,
    );
    await migrateDatabase(db);
    expect((await readdir(join(dir, "migration-backups"))).length).toBe(
      count + 1,
    );
    expect(snapshot(db)).toEqual(before);
    expect(db.prepare("SELECT * FROM account_links").all()).toEqual([]);
  } finally {
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
});
