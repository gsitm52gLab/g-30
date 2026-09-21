import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync } from "node:fs";
import path from "node:path";
import { openDatabase, migrate } from "@/server/db/database";
import { createSqliteRepository } from "@/server/repositories/sqlite";
import { seed } from "@/server/db/seed";
const mode = process.env.E2E_DATA_SOURCE || "mock";
if (!["mock", "sqlite"].includes(mode))
    throw new Error("Invalid E2E_DATA_SOURCE");
mkdirSync(".local", { recursive: true });
const directory = mkdtempSync(path.resolve(".local/e2e-"));
const filename = path.join(directory, "fixture.db");
if (mode === "sqlite") {
    const db = openDatabase(filename, true);
    migrate(db);
    const repository = createSqliteRepository(db);
    await seed(repository);
    repository.close();
}
const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", process.env.E2E_PORT || "4111"], {
    stdio: "inherit", env: { ...process.env, DATA_SOURCE: mode, DATABASE_FILE: filename, OPENAI_API_KEY: "", OPENAI_MODEL: "", OPENAI_BASE_URL: "https://api.openai.com/v1", NEXT_TELEMETRY_DISABLED: "1", APP_ORIGIN: `http://127.0.0.1:${process.env.E2E_PORT || "4111"}`, SESSION_COOKIE_NAME: `gs_hale_e2e_${process.env.E2E_PORT || "4111"}` },
});
console.log(JSON.stringify({ event: "test-server-start", pid: server.pid, mode, cwd: process.cwd(), startedAt: new Date().toISOString() }));
for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.on(signal, () => { server.kill(signal); });
server.on("exit", (code, signal) => { console.log(JSON.stringify({ event: "test-server-stop", pid: server.pid, code, signal, finishedAt: new Date().toISOString() })); process.exit(code ?? 0); });
