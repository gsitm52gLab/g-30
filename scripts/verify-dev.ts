import assert from "node:assert/strict";
import { spawn } from "node:child_process";
const port = process.env.E2E_PORT || "3000";
const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--hostname", "127.0.0.1", "--port", port], { stdio: "pipe", env: { ...process.env, DATA_SOURCE: "mock", APP_ORIGIN: port === "3000" ? "" : `http://127.0.0.1:${port}`, SESSION_COOKIE_NAME: port === "3000" ? "" : `gs_hale_dev_${port}`, OPENAI_API_KEY: "", OPENAI_BASE_URL: "invalid-optional-ai-setting", NEXT_TELEMETRY_DISABLED: "1" } });
let log = "";
server.stdout.on("data", chunk => log += chunk);
server.stderr.on("data", chunk => log += chunk);
try {
    let health: Response | undefined;
    for (let attempt = 0; attempt < 100; attempt++) {
        if (server.exitCode !== null)
            throw new Error(`Owned dev server exited ${server.exitCode}`);
        try {
            health = await fetch(`http://127.0.0.1:${port}/api/health`);
            break;
        }
        catch {
            await new Promise(resolve => setTimeout(resolve, 100));
        }
    }
    assert.equal(health?.status, 200);
    const payload = await health!.json();
    assert.equal(payload.authentication, "server_session");
    const origin = `http://127.0.0.1:${port}`;
    const pre = await fetch(`${origin}/api/auth/csrf`);
    const cookie = pre.headers.get("set-cookie")!.split(";")[0];
    const csrf = await pre.json();
    const login = await fetch(`${origin}/api/auth/login`, { method: "POST", headers: { Cookie: cookie, Origin: origin, "Content-Type": "application/json", "X-CSRF-Token": csrf.csrfToken }, body: JSON.stringify({ email: "admin@example.test", password: "Demo-Hale-2026!" }) });
    assert.equal(login.status, 200);
    const session = login.headers.get("set-cookie")!.split(";")[0];
    const me = await fetch(`${origin}/api/auth/me`, { headers: { Cookie: session } });
    assert.equal((await me.json()).storageMode, "mock");
    const response = await fetch(`http://127.0.0.1:${port}/`, { headers: { Cookie: session } });
    assert.equal(response.status, 200);
    assert.match(await response.text(), /GS HALE/);
    console.log(JSON.stringify({ status: "PASS", assertions: 6, cwd: process.cwd(), pid: server.pid, optionalAiConfigInvalid: true, coreAvailable: true, apiKey: "not_supplied" }));
}
finally {
    const exited = new Promise<void>(resolve => server.once("exit", () => resolve()));
    server.kill("SIGTERM");
    if (server.exitCode === null)
        await exited;
    console.log(log);
}
