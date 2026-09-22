import { productMigrationDiagnostic } from "@/data/products/migrate";
import { loadProjectEnv } from "@/server/config/load-env";
import { parseStorageConfig } from "@/server/config/parse";
import { openDatabase, migrate } from "@/server/db/database";
import { createSqliteRepository } from "@/server/repositories/sqlite";
import { seed } from "@/server/db/seed";
import { StoreError } from "@/domain/records";
loadProjectEnv();
const action = process.argv[2];
if (!["migrate", "seed", "setup"].includes(action)) { console.error("Usage: npm run db:migrate | db:seed | db:setup"); process.exit(1); }
try {
  const config = parseStorageConfig(process.env);
  if (config.dataSource === 'supabase') {
    const [{ parsePostgresConfig }, { migratePostgres }, { createPostgresRepository }] = await Promise.all([import('@/server/postgres/config'), import('@/server/postgres/migrate'), import('@/server/postgres/repository')]);
    const postgres = parsePostgresConfig(process.env, action === 'seed' ? 'runtime' : 'migration');
    if (action === 'migrate' || action === 'setup') console.log(JSON.stringify({operation:'migration',...await migratePostgres(postgres)}));
    if (action === 'seed' || action === 'setup') {
      const repository = createPostgresRepository(postgres);
      try { console.log(JSON.stringify({operation:'seed',policy:'insert-missing-preserve-existing',...await seed(repository)})); }
      finally { await repository.close(); }
    }
  } else {
  const db = openDatabase(config.databaseFile, action !== "seed");
  try {
    if (action === "migrate" || action === "setup") console.log(JSON.stringify({ operation: "migration", ...migrate(db) }));
    if (action === "seed" || action === "setup") {
      const repository = createSqliteRepository(db);
      console.log(JSON.stringify({ operation: "seed", policy: "insert-missing-preserve-existing", ...await seed(repository) }));
    }
  } finally { if (db.open) db.close(); }
  }
} catch (error) {
  const diagnostic = productMigrationDiagnostic(error);
  console.error(JSON.stringify({ operation: action, status: "failed", code: error instanceof StoreError ? error.code : "DATABASE_OR_CONFIGURATION_ERROR", ...(diagnostic ? { diagnostic } : {}) }));
  process.exitCode = 1;
}
