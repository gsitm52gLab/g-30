import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createWriteStream, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { openDatabase, migrate } from "@/server/db/database";
import { createSqliteRepository } from "@/server/repositories/sqlite";
import { seed } from "@/server/db/seed";

const projectNames = ["desktop", "mobile"] as const;
type Project = typeof projectNames[number];
type Counts = { unit: "test"; pass: number; fail: number; skip: number; flaky: number };
type ProcessResult = { code: number | null; signal: NodeJS.Signals | null };
const now = () => new Date().toISOString();
const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
let interrupted: NodeJS.Signals | undefined;
let activeRunner: ChildProcess | undefined;
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => {
    interrupted = signal;
    activeRunner?.kill(signal);
});

function argumentsForProjects(args: string[]) {
    const selected = new Set<Project>(), forwarded: string[] = [];
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === "--project" || arg.startsWith("--project=")) {
            const value = arg === "--project" ? args[++i] : arg.slice("--project=".length);
            if (!projectNames.includes(value as Project)) throw new Error("--project requires desktop or mobile; repeat the option to select both.");
            selected.add(value as Project);
        } else {
            if (/^(--config|--reporter|--output)(=|$)/.test(arg) || arg === "-c" || arg.startsWith("-c="))
                throw new Error("The isolated runner owns config/report/output. Use E2E_REPORT and E2E_ARTIFACTS for output paths.");
            if (["--ui", "--ui-host", "--ui-port"].some(flag => arg === flag || arg.startsWith(`${flag}=`)))
                throw new Error("Interactive UI mode is not supported by the isolated batch runner. Use --headed for a visible browser.");
            forwarded.push(arg);
        }
    }
    return { projects: projectNames.filter(p => !selected.size || selected.has(p)), forwarded };
}
function port(value: string | undefined, fallback: number) {
    const raw = value ?? String(fallback), n = Number(raw);
    if (!/^\d+$/.test(raw) || !Number.isInteger(n) || n < 1 || n > 65535) throw new Error("E2E ports must be integers from 1 to 65535.");
    return n;
}
async function listening(value: number) {
    return new Promise<boolean>(resolve => {
        const socket = net.connect({ host: "127.0.0.1", port: value });
        socket.once("connect", () => { socket.destroy(); resolve(true); });
        socket.once("error", () => resolve(false));
    });
}
function start(command: string[], env: NodeJS.ProcessEnv, logFile: string, echo = false) {
    const output = createWriteStream(logFile, { flags: "wx", mode: 0o600 });
    const child = spawn(command[0], command.slice(1), { cwd: process.cwd(), env, stdio: ["inherit", "pipe", "pipe"] });
    child.stdout!.on("data", chunk => { output.write(chunk); if (echo) process.stdout.write(chunk); });
    child.stderr!.on("data", chunk => { output.write(chunk); if (echo) process.stderr.write(chunk); });
    const done = new Promise<ProcessResult>((resolve, reject) => {
        child.once("error", error => { output.end(); reject(error); });
        child.once("close", (code, signal) => output.end(() => resolve({ code, signal })));
    });
    return { child, done };
}
async function stop(process: ReturnType<typeof start>) {
    if (process.child.exitCode === null && process.child.signalCode === null) process.child.kill("SIGTERM");
    const force = setTimeout(() => process.child.kill("SIGKILL"), 10000);
    try { return await process.done; } finally { clearTimeout(force); }
}
async function ready(server: ChildProcess, serverPort: number) {
    const until = Date.now() + 60000;
    while (Date.now() < until) {
        if (interrupted) throw new Error(`Interrupted by ${interrupted}`);
        if (server.exitCode !== null || server.signalCode !== null) throw new Error("Owned E2E server exited before readiness.");
        try { if ((await fetch(`http://127.0.0.1:${serverPort}/api/health`, { signal: AbortSignal.timeout(1000) })).ok) return; } catch {}
        await delay(100);
    }
    throw new Error("Owned E2E server did not become ready within 60 seconds.");
}
function reportCounts(filename: string): Counts {
    const { stats } = JSON.parse(readFileSync(filename, "utf8"));
    if (!stats || ["expected", "unexpected", "skipped", "flaky"].some(k => !Number.isInteger(stats[k]) || stats[k] < 0))
        throw new Error("Playwright report has no valid test counts.");
    return { unit: "test", pass: stats.expected, fail: stats.unexpected, skip: stats.skipped, flaky: stats.flaky };
}

async function main() {
    const input = process.argv.slice(2), { projects, forwarded } = argumentsForProjects(input);
    const mode = process.env.E2E_DATA_SOURCE || "mock";
    if (!["mock", "sqlite"].includes(mode)) throw new Error("E2E_DATA_SOURCE must be mock or sqlite.");
    const primaryPort = port(process.env.E2E_PORT, 4111), mobilePort = port(process.env.E2E_AUX_PORT, primaryPort);
    const runId = `${now().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
    const reportBase = path.resolve(process.env.E2E_REPORT || ".local/e2e-results.json");
    const parsed = path.parse(reportBase), reportPrefix = path.join(parsed.dir, `${parsed.name}.${runId}`);
    const summaryPath = `${reportPrefix}.summary.json`;
    const artifactsRoot = path.resolve(process.env.E2E_ARTIFACTS || "test-results", runId);
    const dataRoot = path.resolve(".local", `e2e-${mode}-${runId}`);
    const listingOnly = forwarded.some(a => ["--list", "--help", "-h"].includes(a));
    mkdirSync(parsed.dir, { recursive: true });
    const summary: Record<string, unknown> & { projects: Record<string, unknown>[] } = {
        schema_version: 1, candidate_commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
        cwd: process.cwd(), input_argv: input, mode, run_id: runId, started_at: now(),
        summary_path: summaryPath, artifacts_root: artifactsRoot, data_root: dataRoot, listing_only: listingOnly, projects: [],
    };
    let exitCode = 0;
    const aggregate: Counts = { unit: "test", pass: 0, fail: 0, skip: 0, flaky: 0 };
    const save = () => writeFileSync(summaryPath, JSON.stringify(summary, null, 2) + "\n", { mode: 0o600 });
    console.log(JSON.stringify({ event: "isolated-e2e-run", mode, projects, summary: summaryPath }));
    save();
    for (const project of projects) {
        if (interrupted) break;
        const serverPort = project === "desktop" ? primaryPort : mobilePort;
        const artifactDirectory = path.join(artifactsRoot, project), dataDirectory = path.join(dataRoot, project);
        mkdirSync(artifactDirectory, { recursive: true }); mkdirSync(dataDirectory, { recursive: true });
        const database = path.join(dataDirectory, "fixture.db"), files = path.join(dataDirectory, "files");
        const report = `${reportPrefix}.${project}.json`;
        const env = { ...process.env, E2E_RUN_PROJECT: project, E2E_PORT: String(serverPort), E2E_DATA_SOURCE: mode,
            E2E_REPORT: report, E2E_ARTIFACTS: path.join(artifactDirectory, "test-results"),
            DATA_SOURCE: mode, DATABASE_FILE: database, FILE_STORAGE_DIR: files,
            OPENAI_API_KEY: "", OPENAI_MODEL: "", OPENAI_BASE_URL: "https://api.openai.com/v1", NEXT_TELEMETRY_DISABLED: "1",
            APP_ORIGIN: `http://127.0.0.1:${serverPort}`, SESSION_COOKIE_NAME: `gs_hale_e2e_${serverPort}_${project}_${runId.slice(-8)}` };
        const serverCommand = [process.execPath, "node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", String(serverPort)];
        const testCommand = [process.execPath, "node_modules/@playwright/test/cli.js", "test", ...forwarded, `--project=${project}`];
        const result: Record<string, unknown> = { project, cwd: process.cwd(), started_at: now(), port: serverPort,
            database, file_storage: files, cookie_name: env.SESSION_COOKIE_NAME, app_origin: env.APP_ORIGIN,
            report, artifacts: env.E2E_ARTIFACTS, server_command: serverCommand, test_command: testCommand,
            server_log: path.join(artifactDirectory, "server.log"), runner_log: path.join(artifactDirectory, "runner.log") };
        summary.projects.push(result);
        let server: ReturnType<typeof start> | undefined;
        try {
            if (!listingOnly) {
                if (await listening(serverPort)) throw new Error(`Port ${serverPort} is already in use; no existing process was reused or stopped.`);
                if (mode === "sqlite") {
                    const db = openDatabase(database, true);
                    try { result.migration = migrate(db); result.seed = await seed(createSqliteRepository(db)); }
                    finally { db.close(); }
                }
                server = start(serverCommand, env, result.server_log as string); result.server_pid = server.child.pid;
                await ready(server.child, serverPort);
            }
            const runner = start(testCommand, env, result.runner_log as string, true); activeRunner = runner.child;
            result.runner_pid = runner.child.pid;
            const ended = await runner.done; activeRunner = undefined;
            result.exit_code = ended.code; result.signal = ended.signal;
            if (ended.code !== 0) exitCode = ended.code || 1;
            if (!listingOnly) {
                const counts = reportCounts(report); result.counts = counts;
                for (const key of ["pass", "fail", "skip", "flaky"] as const) aggregate[key] += counts[key];
            }
        } catch (error) {
            result.error = error instanceof Error ? error.message : String(error);
            result.exit_code ??= 1; exitCode = 1;
            console.error(`${project}: ${result.error}`);
        } finally {
            activeRunner = undefined;
            if (server) {
                result.server_exit = await stop(server);
                result.port_released = !await listening(serverPort);
                if (!result.port_released) { result.cleanup_error = "Owned port remains in use after server exit."; exitCode = 1; }
            }
            result.finished_at = now(); save();
        }
    }
    if (interrupted) exitCode = interrupted === "SIGINT" ? 130 : 143;
    Object.assign(summary, { finished_at: now(), exit_code: exitCode, interrupted: interrupted ?? null,
        counts: listingOnly ? null : aggregate, completed_projects: summary.projects.length });
    save();
    console.log(JSON.stringify({ event: "isolated-e2e-finished", exit_code: exitCode, counts: summary.counts, summary: summaryPath }));
    process.exitCode = exitCode;
}
main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
