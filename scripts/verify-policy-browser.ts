import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import path from "node:path";
import { openDatabase, migrate } from "@/server/db/database";
import { createSqliteRepository } from "@/server/repositories/sqlite";
import { seed } from "@/server/db/seed";
import { DEMO_PASSWORD } from "@/domain/catalog";
const root = path.resolve(process.env.EVIDENCE_ROOT || ".local/g02-evidence");
const output = path.join(root, `browser-${Date.now()}`);
mkdirSync(output, { recursive: true });
mkdirSync(".local", { recursive: true });
const directory = mkdtempSync(path.resolve(".local/g02-browser-"));
const filename = path.join(directory, "policy.db");
const db = openDatabase(filename, true);
migrate(db);
const repository = createSqliteRepository(db);
await seed(repository);
const marker = "G02_BROWSER_PRIVATE_CANARY";
await repository.transaction(async (s) => {
    for (const id of ["task-onboarding", "task-pop"]) {
        const row = (await s.get("task", id))!;
        (await s.update("task", id, row.revision, { ...row.data, internalOriginal: marker, internalMemo: marker, unknown: { private: marker } } as typeof row.data));
    }
    const row = (await s.get("product", "product-serum"))!;
    (await s.update("product", row.id, row.revision, { ...row.data, internalSupplyPrice: marker, internalSupplyRate: marker, unknown: { private: marker } } as typeof row.data));
});
repository.close();
const port = process.env.E2E_PORT || "4121";
const origin = `http://127.0.0.1:${port}`;
const args = ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", port];
let server: ChildProcess | undefined;
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
const observations: {
    viewport: string;
    path: string;
    status: number;
    bytes: number;
    sha256: string;
    markerAbsent: boolean;
    artifact: string;
}[] = [];
const checks: string[] = [];
const pending: Promise<void>[] = [];
const responseErrors: string[] = [];
let failure: string | undefined;
function check(name: string, condition: boolean) { assert.equal(condition, true, name); checks.push(name); }
try {
    server = spawn(process.execPath, args, { stdio: "ignore", env: { ...process.env,
            DATA_SOURCE: "sqlite", DATABASE_FILE: filename, APP_ORIGIN: origin, SESSION_COOKIE_NAME: `gs_hale_g02_${port}`,
            OPENAI_API_KEY: "", OPENAI_MODEL: "", OPENAI_BASE_URL: "https://api.openai.com/v1", NEXT_TELEMETRY_DISABLED: "1" } });
    let ready = false;
    for (let i = 0; i < 200; i++) {
        if (server.exitCode !== null)
            throw new Error("Owned browser server exited");
        try {
            if ((await fetch(`${origin}/api/health`)).status === 200) {
                ready = true;
                break;
            }
        }
        catch { }
        await new Promise(resolve => setTimeout(resolve, 50));
    }
    check("owned server ready", ready);
    browser = await chromium.launch();
    for (const viewport of [{ name: "desktop", width: 1280, height: 900 }, { name: "mobile", width: 390, height: 844 }]) {
        const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
        const page = await context.newPage();
        await page.route("**/*", async (route) => {
            if (route.request().headers()["rsc"] !== "1") {
                await route.continue();
                return;
            }
            // Capture the server body before browser speculative prefetch disposal.
            // The request/headers are browser-generated; the response is fulfilled unchanged.
            const result = (async () => {
                const response = await route.fetch();
                const bytes = await response.body();
                if (response.status() === 200 && response.headers()["content-type"]?.includes("text/x-component")) {
                    const body = bytes.toString("utf8");
                    if (/tokenHash|csrfToken|"password"/.test(body))
                        throw new Error("Unexpected secret field in RSC; body not saved");
                    const absent = !body.includes(marker) && !body.includes("internalSupplyPrice") && !body.includes("internalOriginal");
                    const artifact = path.join(output, `rsc-${observations.length + 1}-${viewport.name}.txt`);
                    writeFileSync(artifact, body);
                    observations.push({ viewport: viewport.name, path: new URL(route.request().url()).pathname,
                        status: response.status(), bytes: bytes.byteLength, sha256: createHash("sha256").update(bytes).digest("hex"), markerAbsent: absent, artifact });
                }
                await route.fulfill({ response, body: bytes });
            })().catch(error => { responseErrors.push(error instanceof Error ? error.message : "RSC capture error"); });
            pending.push(result);
            await result;
        });
        await page.goto(`${origin}/login`);
        await page.getByLabel("이메일", { exact: true }).fill("luna@example.test");
        await page.getByLabel("비밀번호", { exact: true }).fill(DEMO_PASSWORD);
        await page.getByRole("button", { name: "로그인", exact: true }).click();
        await page.waitForURL(origin + "/");
        await page.waitForLoadState("networkidle");
        await Promise.all(pending);
        await page.getByRole("navigation", { name: "주 메뉴" }).getByRole("link", { name: /업무/ }).click();
        await page.getByRole("heading", { name: "업무", exact: true }).waitFor();
        await page.waitForLoadState("networkidle");
        await Promise.all(pending);
        await page.getByRole("link", { name: /신규 입점 상품 기본자료 준비/ }).click();
        await page.getByRole("heading", { name: "신규 입점 상품 기본자료 준비" }).waitFor();
        await page.waitForLoadState("networkidle");
        await Promise.all(pending);
        check(`${viewport.name} public notes retained`, await page.getByText("요청 3개 중 2개 제출 상태의 합성 예시").isVisible());
        await page.screenshot({ path: path.join(output, `${viewport.name}-task.png`), fullPage: true });
        await page.getByRole("link", { name: /루나 데일리 세럼/ }).click();
        await page.getByRole("heading", { name: "루나 데일리 세럼" }).waitFor();
        await page.waitForLoadState("networkidle");
        await Promise.all(pending);
        check(`${viewport.name} DOM private marker absent`, !(await page.content()).includes(marker));
        check(`${viewport.name} viewport fits`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
        check(`${viewport.name} actual navigation RSC received`, observations.filter(r => r.viewport === viewport.name && r.path.startsWith("/tasks") && r.status === 200).length > 0 && observations.some(r => r.viewport === viewport.name && r.path.startsWith("/products") && r.status === 200));
        await page.screenshot({ path: path.join(output, `${viewport.name}-product.png`), fullPage: true });
        await context.close();
    }
    check("all actual RSC bodies omit private fields", observations.length > 0 && observations.every(r => r.markerAbsent));
    check("all response capture operations succeeded", responseErrors.length === 0);
}
catch (error) {
    failure = error instanceof Error ? error.message : "unknown failure";
}
finally {
    await browser?.close();
    if (server && server.exitCode === null) {
        const done = new Promise<void>(resolve => server!.once("exit", () => resolve()));
        server.kill("SIGTERM");
        await done;
    }
    const report = { status: failure ? "FAIL" : "PASS", requirements: ["AC-02-02", "A19", "A24"], level: "REAL_BROWSER_NAVIGATION_RSC", capture: "Browser-generated request; route.fetch captures server body before speculative disposal; route.fulfill sends unchanged bytes",
        counts: { unit: "assertion", pass: checks.length, fail: failure ? 1 : 0, skip: 0, not_run: 0 }, checks, failure, observations, responseErrors,
        process: { pid: server?.pid, command: [process.execPath, ...args], cwd: process.cwd(), exitCode: server?.exitCode, origin, cookieNamespace: `gs_hale_g02_${port}` } };
    const reportPath = path.join(output, "report.json");
    writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ status: report.status, counts: report.counts, actualRscResponses: observations.length, report: reportPath, failure }));
}
if (failure)
    process.exitCode = 1;
