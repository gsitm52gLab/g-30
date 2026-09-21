import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { StoreError } from "@/domain/records";
export function openDatabase(filename: string, create = false): Database.Database {
  try {
    if (filename !== ":memory:" && create) mkdirSync(path.dirname(path.resolve(filename)), { recursive: true });
    const db = new Database(filename, { fileMustExist: !create && filename !== ":memory:" });
    db.pragma("foreign_keys = ON"); db.pragma("busy_timeout = 5000"); db.pragma("journal_mode = WAL");
    return db;
  } catch { throw new StoreError("STORAGE_UNAVAILABLE"); }
}
export function migrate(db: Database.Database, directory = path.resolve("src/server/db/migrations")) {
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, sha256 TEXT NOT NULL, applied_at TEXT NOT NULL)");
  const files = readdirSync(directory).filter(f => /^\d+.*\.sql$/.test(f)).sort();
  let applied = 0;
  for (const file of files) {
    const sql = readFileSync(path.join(directory, file), "utf8");
    const sha = createHash("sha256").update(sql).digest("hex");
    db.transaction(() => {
      const existing = db.prepare("SELECT sha256 FROM schema_migrations WHERE name = ?").get(file) as { sha256: string } | undefined;
      if (existing) { if (existing.sha256 !== sha) throw new Error("이미 적용한 migration이 변경됐습니다."); return; }
      db.exec(sql);
      db.prepare("INSERT INTO schema_migrations VALUES (?, ?, ?)").run(file, sha, new Date().toISOString()); applied++;
    }).immediate();
  }
  return { applied, total: files.length };
}
