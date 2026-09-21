import assert from "node:assert/strict";
import { spawn } from "node:child_process";
const port = process.env.E2E_PORT || "4101";
const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--hostname", "127.0.0.1", "--port", port], { stdio: "pipe", env: { ...process.env, DATA_SOURCE: "mock", OPENAI_API_KEY: "", OPENAI_BASE_URL: "invalid-optional-ai-setting", NEXT_TELEMETRY_DISABLED: "1" } });
let log = ""; server.stdout.on("data", chunk => log += chunk); server.stderr.on("data", chunk => log += chunk);
try {
  let health: Response | undefined;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null) throw new Error(`Owned dev server exited ${server.exitCode}`);
    try { health = await fetch(`http://127.0.0.1:${port}/api/health`); break; } catch { await new Promise(resolve => setTimeout(resolve, 100)); }
  }
  assert.equal(health?.status, 200);
  const payload = await health!.json(); assert.equal(payload.dataSource, "mock");
  const response = await fetch(`http://127.0.0.1:${port}/`); assert.equal(response.status, 200); assert.match(await response.text(), /GS HALE/);
  console.log(JSON.stringify({ status: "PASS", assertions: 4, cwd: process.cwd(), pid: server.pid, optionalAiConfigInvalid: true, coreAvailable: true, apiKey: "not_supplied" }));
} finally {
  const exited = new Promise<void>(resolve => server.once("exit", () => resolve()));
  server.kill("SIGTERM"); if (server.exitCode === null) await exited;
  console.log(log);
}
