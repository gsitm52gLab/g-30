import { openDatabase, migrate } from "@/server/db/database";
import { createSqliteRepository } from "@/server/repositories/sqlite";
const [action, filename] = process.argv.slice(2);
if (!filename || !["write", "read"].includes(action))
    throw new Error("Expected write/read and database path");
const db = openDatabase(filename, action === "write");
if (action === "write")
    migrate(db);
const repository = createSqliteRepository(db, () => "2026-09-21T00:00:00.000Z");
try {
    if (action === "write")
        await repository.transaction(async (store) => (await store.create("checkpoint", { id: "restart-checkpoint", contextId: null, data: { value: "synthetic-persisted-value" } })));
    console.log(JSON.stringify({ pid: process.pid, action, record: await repository.get("checkpoint", "restart-checkpoint") }));
}
finally {
    repository.close();
}
