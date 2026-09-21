import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";
const port = process.env.E2E_PORT || "4101";
const baseURL = `http://127.0.0.1:${port}`;
mkdirSync(".local", { recursive: true });
const directory = mkdtempSync(path.resolve(".local/unavailable-"));
const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", port], { stdio: "pipe", env: { ...process.env, DATA_SOURCE: "sqlite", DATABASE_FILE: path.join(directory, "missing.db"), OPENAI_API_KEY: "synthetic-runtime-canary", OPENAI_BASE_URL: "https://api.openai.com/v1", NEXT_TELEMETRY_DISABLED: "1" } });
let logs = ""; server.stdout.on("data", chunk => logs += chunk); server.stderr.on("data", chunk => logs += chunk);
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  let response: Response | undefined;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null) throw new Error(`Owned server exited: ${server.exitCode}`);
    try { response = await fetch(`${baseURL}/api/health`); break; } catch { await new Promise(resolve => setTimeout(resolve, 100)); }
  }
  assert.ok(response, "server must start"); assert.equal(response.status, 503);
  const health = await response.json(); assert.deepEqual(health, { status: "unavailable", code: "STORAGE_OR_CONFIGURATION_ERROR" });
  browser = await chromium.launch(); const page = await browser.newPage(); await page.goto(baseURL);
  await page.getByRole("heading", { name: "자료를 불러오지 못했습니다" }).waitFor();
  assert.equal(await page.getByRole("link", { name: /신규 입점 상품 기본자료 준비/ }).count(), 0);
  const html = await page.content(); assert.ok(!html.includes("synthetic-runtime-canary"));
  const output = process.env.FAILURE_REPORT_DIR || directory; mkdirSync(output, { recursive: true });
  await page.screenshot({ path: path.join(output, "storage-unavailable.png"), fullPage: true });
  writeFileSync(path.join(output, "failure.json"), JSON.stringify({ status: "PASS", cwd: process.cwd(), serverPid: server.pid, health, httpStatus: 503, assertions: 5, syntheticKeyDisclosed: false, fallbackToMock: false }, null, 2));
  assert.ok(!logs.includes("synthetic-runtime-canary"));
  console.log(JSON.stringify({ status: "PASS", assertions: 6, evidence: path.resolve(output) }));
} finally {
  await browser?.close();
  const exited = new Promise<void>(resolve => server.once("exit", () => resolve()));
  server.kill("SIGTERM"); if (server.exitCode === null) await exited;
  writeFileSync(path.join(directory, "server.log"), logs);
}
