import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createWriteStream, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { openDatabase, migrate } from "@/server/db/database";
import { createSqliteRepository } from "@/server/repositories/sqlite";
import { seed } from "@/server/db/seed";
import { addCounts, assertSelection, emptyCounts, reportCounts, selectedFiles, type Report } from "./e2e-runner-selection";
const projectNames = ["desktop", "mobile"] as const;
type Project = typeof projectNames[number];
type ProcessResult = {
    code: number | null;
    signal: NodeJS.Signals | null;
};
const now = () => new Date().toISOString();
const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
let interrupted: NodeJS.Signals | undefined;
let activeRunner: ChildProcess | undefined;
for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.on(signal, () => {
        interrupted = signal;
        activeRunner?.kill(signal);
    });
function argumentsForProjects(args: string[]) {
    const selected = new Set<Project>(), forwarded: string[] = [];
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === "--project" || arg.startsWith("--project=")) {
            const value = arg === "--project" ? args[++i] : arg.slice("--project=".length);
            if (!projectNames.includes(value as Project))
                throw new Error("--project requires desktop or mobile; repeat the option to select both.");
            selected.add(value as Project);
        }
        else {
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
    if (!/^\d+$/.test(raw) || !Number.isInteger(n) || n < 1 || n > 65535)
        throw new Error("E2E ports must be integers from 1 to 65535.");
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
    child.stdout!.on("data", chunk => { output.write(chunk); if (echo)
        process.stdout.write(chunk); });
    child.stderr!.on("data", chunk => { output.write(chunk); if (echo)
        process.stderr.write(chunk); });
    const done = new Promise<ProcessResult>((resolve, reject) => {
        child.once("error", error => { output.end(); reject(error); });
        child.once("close", (code, signal) => output.end(() => resolve({ code, signal })));
    });
    return { child, done };
}
async function stop(process: ReturnType<typeof start>) {
    if (process.child.exitCode === null && process.child.signalCode === null)
        process.child.kill("SIGTERM");
    const force = setTimeout(() => process.child.kill("SIGKILL"), 10000);
    try {
        return await process.done;
    }
    finally {
        clearTimeout(force);
    }
}
async function ready(server: ChildProcess, serverPort: number) {
    const until = Date.now() + 60000;
    while (Date.now() < until) {
        if (interrupted)
            throw new Error(`Interrupted by ${interrupted}`);
        if (server.exitCode !== null || server.signalCode !== null)
            throw new Error("Owned E2E server exited before readiness.");
        try {
            if ((await fetch(`http://127.0.0.1:${serverPort}/api/health`, { signal: AbortSignal.timeout(1000) })).ok)
                return;
        }
        catch { }
        await delay(100);
    }
    throw new Error("Owned E2E server did not become ready within 60 seconds.");
}
async function main() {
    const input = process.argv.slice(2), { projects, forwarded } = argumentsForProjects(input);
    const mode = process.env.E2E_DATA_SOURCE || "mock";
    if (!["mock", "sqlite"].includes(mode))
        throw new Error("E2E_DATA_SOURCE must be mock or sqlite.");
    const primaryPort = port(process.env.E2E_PORT, 4111), mobilePort = port(process.env.E2E_AUX_PORT, primaryPort);
    const runId = `${now().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
    const reportBase = path.resolve(process.env.E2E_REPORT || ".local/e2e-results.json");
    const parsed = path.parse(reportBase), reportPrefix = path.join(parsed.dir, `${parsed.name}.${runId}`);
    const summaryPath = `${reportPrefix}.summary.json`;
    const artifactsRoot = path.resolve(process.env.E2E_ARTIFACTS || "test-results", runId);
    const dataRoot = path.resolve(".local", `e2e-${mode}-${runId}`);
    const listingOnly = forwarded.some(a => ["--list", "--help", "-h"].includes(a));
    mkdirSync(parsed.dir, { recursive: true });
    const summary: Record<string, unknown> & {
        projects: Record<string, unknown>[];
    } = {
        schema_version: 1, candidate_commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
        cwd: process.cwd(), input_argv: input, mode, run_id: runId, started_at: now(),
        summary_path: summaryPath, artifacts_root: artifactsRoot, data_root: dataRoot, listing_only: listingOnly, projects: [],
    };
    let exitCode = 0;
    const aggregate = emptyCounts();
    const save = () => writeFileSync(summaryPath, JSON.stringify(summary, null, 2) + "\n", { mode: 0o600 });
    console.log(JSON.stringify({ event: "isolated-e2e-run", mode, projects, summary: summaryPath }));
    save();
    for (const project of projects) {
        if (interrupted)
            break;
        const serverPort = project === "desktop" ? primaryPort : mobilePort;
        const artifactDirectory = path.join(artifactsRoot, project), dataDirectory = path.join(dataRoot, project);
        mkdirSync(artifactDirectory, { recursive: true });
        const report = `${reportPrefix}.${project}.json`, discoveryReport = `${reportPrefix}.${project}.discovery.json`;
        const env = { ...process.env, E2E_RUN_PROJECT: project, E2E_RUN_FILE: "", E2E_PORT: String(serverPort), E2E_DATA_SOURCE: mode,
            E2E_REPORT: discoveryReport, E2E_ARTIFACTS: path.join(artifactDirectory, "discovery"),
            DATA_SOURCE: mode, OPENAI_API_KEY: "", OPENAI_MODEL: "", OPENAI_BASE_URL: "https://api.openai.com/v1", NEXT_TELEMETRY_DISABLED: "1",
            APP_ORIGIN: `http://127.0.0.1:${serverPort}` };
        const helpOnly = forwarded.some(a => ["--help", "-h"].includes(a));
        const discoveryCommand = [process.execPath, "node_modules/@playwright/test/cli.js", "test", ...forwarded, `--project=${project}`,
            ...(!listingOnly ? ["--list"] : [])];
        const projectCounts = emptyCounts(), completedReports: Report[] = [];
        const result: Record<string, unknown> & {
            files: Record<string, unknown>[];
        } = {
            project, cwd: process.cwd(), started_at: now(), port: serverPort, report, artifacts: artifactDirectory,
            discovery_report: discoveryReport, discovery_command: discoveryCommand,
            discovery_log: path.join(artifactDirectory, "discovery.log"), files: [], counts: listingOnly ? null : projectCounts,
        };
        summary.projects.push(result);
        save();
        let projectExit = 0;
        try {
            const discovery = start(discoveryCommand, env, result.discovery_log as string, true);
            activeRunner = discovery.child;
            result.discovery_pid = discovery.child.pid;
            const discovered = await discovery.done;
            activeRunner = undefined;
            result.discovery_exit = discovered;
            if (discovered.code !== 0)
                throw new Error(`Playwright selection discovery failed (exit ${discovered.code}).`);
            if (!helpOnly) {
                const plan = selectedFiles(JSON.parse(readFileSync(discoveryReport, "utf8")), project);
                result.selected_files = plan;
                result.selected_test_count = plan.reduce((n, f) => n + f.identities.length, 0);
                if (!listingOnly)
                    for (const [index, selection] of plan.entries()) {
                        if (interrupted)
                            break;
                        const slot = `${String(index + 1).padStart(2, "0")}-${path.basename(selection.file).replace(/[^a-zA-Z0-9._-]/g, "_")}`;
                        const fileArtifacts = path.join(artifactDirectory, slot), fileData = path.join(dataDirectory, slot);
                        mkdirSync(fileArtifacts, { recursive: true });
                        mkdirSync(fileData, { recursive: true });
                        const database = path.join(fileData, "fixture.db"), files = path.join(fileData, "files"), imports = path.join(fileData, "import_staging");
                        const fileReport = `${reportPrefix}.${project}.${slot}.json`;
                        const fileEnv = { ...env, E2E_RUN_FILE: selection.file, E2E_REPORT: fileReport,
                            E2E_ARTIFACTS: path.join(fileArtifacts, "test-results"), DATABASE_FILE: database, FILE_STORAGE_DIR: files, IMPORT_STORAGE_DIR: imports,
                            SESSION_COOKIE_NAME: `gs_hale_e2e_${serverPort}_${project}_${index}_${runId.slice(-8)}` };
                        const serverCommand = [process.execPath, "node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", String(serverPort)];
                        // Keep all original CLI selectors. The config's exact file matcher intersects them;
                        // adding another positional file here would instead OR the user's file filters.
                        const testCommand = [process.execPath, "node_modules/@playwright/test/cli.js", "test", ...forwarded, `--project=${project}`];
                        const fileResult: Record<string, unknown> = { file: selection.file, selected_identities: selection.identities,
                            cwd: process.cwd(), started_at: now(), port: serverPort, database, file_storage: files, import_storage: imports,
                            cookie_name: fileEnv.SESSION_COOKIE_NAME, app_origin: env.APP_ORIGIN, report: fileReport,
                            artifacts: fileEnv.E2E_ARTIFACTS, server_command: serverCommand, test_command: testCommand,
                            server_log: path.join(fileArtifacts, "server.log"), runner_log: path.join(fileArtifacts, "runner.log") };
                        result.files.push(fileResult);
                        save();
                        let server: ReturnType<typeof start> | undefined;
                        try {
                            if (await listening(serverPort))
                                throw new Error(`Port ${serverPort} is already in use; no existing process was reused or stopped.`);
                            if (mode === "sqlite") {
                                const db = openDatabase(database, true);
                                try {
                                    fileResult.migration = migrate(db);
                                    fileResult.seed = await seed(createSqliteRepository(db));
                                }
                                finally {
                                    db.close();
                                }
                            }
                            server = start(serverCommand, fileEnv, fileResult.server_log as string);
                            fileResult.server_pid = server.child.pid;
                            await ready(server.child, serverPort);
                            const runner = start(testCommand, fileEnv, fileResult.runner_log as string, true);
                            activeRunner = runner.child;
                            fileResult.runner_pid = runner.child.pid;
                            const ended = await runner.done;
                            activeRunner = undefined;
                            fileResult.exit_code = ended.code;
                            fileResult.signal = ended.signal;
                            if (ended.code !== 0)
                                projectExit = ended.code || 1;
                            const actual: Report = JSON.parse(readFileSync(fileReport, "utf8"));
                            completedReports.push(actual);
                            const counts = reportCounts(actual);
                            fileResult.counts = counts;
                            addCounts(projectCounts, counts);
                            addCounts(aggregate, counts);
                            assertSelection(selection, selectedFiles(actual, project));
                            fileResult.selection_verified = true;
                        }
                        catch (error) {
                            fileResult.error = error instanceof Error ? error.message : String(error);
                            fileResult.exit_code = 1;
                            projectExit = 1;
                            console.error(`${project}/${slot}: ${fileResult.error}`);
                        }
                        finally {
                            activeRunner = undefined;
                            if (server) {
                                fileResult.server_exit = await stop(server);
                                fileResult.port_released = !await listening(serverPort);
                                if (!fileResult.port_released) {
                                    fileResult.cleanup_error = "Owned port remains in use after server exit.";
                                    projectExit = 1;
                                }
                            }
                            fileResult.finished_at = now();
                            save();
                        }
                    }
            }
        }
        catch (error) {
            result.error = error instanceof Error ? error.message : String(error);
            projectExit = 1;
            console.error(`${project}: ${result.error}`);
        }
        finally {
            activeRunner = undefined;
            if (completedReports.length)
                writeFileSync(report, JSON.stringify({
                    ...completedReports[0], suites: completedReports.flatMap(r => r.suites ?? []), errors: completedReports.flatMap(r => r.errors ?? []),
                    stats: { startTime: result.started_at, duration: Date.now() - Date.parse(result.started_at as string),
                        expected: projectCounts.pass, unexpected: projectCounts.fail, skipped: projectCounts.skip, flaky: projectCounts.flaky },
                    isolation: { kind: "project-and-spec", reports: result.files.map(f => f.report) },
                }, null, 2) + "\n", { mode: 0o600 });
            result.exit_code = projectExit;
            result.completed_files = result.files.length;
            result.not_run_test_count = listingOnly ? null : Math.max(0, Number(result.selected_test_count ?? 0) - completedReports.reduce((n, r) => n + selectedFiles(r, project).reduce((m, f) => m + f.identities.length, 0), 0));
            result.port_released = result.files.every(f => f.port_released !== false);
            result.finished_at = now();
            if (projectExit)
                exitCode = projectExit;
            save();
        }
    }
    if (interrupted)
        exitCode = interrupted === "SIGINT" ? 130 : 143;
    Object.assign(summary, { finished_at: now(), exit_code: exitCode, interrupted: interrupted ?? null,
        counts: listingOnly ? null : aggregate, not_run_test_count: listingOnly ? null : summary.projects.reduce((n, p) => n + Number(p.not_run_test_count ?? 0), 0), completed_projects: summary.projects.length });
    save();
    console.log(JSON.stringify({ event: "isolated-e2e-finished", exit_code: exitCode, counts: summary.counts, summary: summaryPath }));
    process.exitCode = exitCode;
}
main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
