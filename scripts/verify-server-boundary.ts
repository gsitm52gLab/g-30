import assert from "node:assert/strict";
import { mkdirSync, existsSync, writeFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
const directory = "src/app/__g00_boundary_probe";
if (existsSync(directory)) throw new Error("Probe path already exists; refusing to overwrite it");
mkdirSync(directory);
try {
  writeFileSync(`${directory}/page.tsx`, '"use client";\nimport { readServerConfig } from "@/server/config/env";\nexport default function Probe(){ readServerConfig(); return <div>probe</div>; }\n');
  // A leading underscore is a private Next folder; rename to a real route for this negative build.
  const { renameSync } = await import("node:fs");
  const route = "src/app/g00-boundary-probe";
  if (existsSync(route)) throw new Error("Public probe path already exists");
  renameSync(directory, route);
  try {
    const result = spawnSync(process.execPath, ["node_modules/next/dist/bin/next", "build"], { encoding: "utf8", env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1", OPENAI_API_KEY: "synthetic-boundary-canary", OPENAI_BASE_URL: "https://api.openai.com/v1" } });
    const output = result.stdout + result.stderr;
    console.log(output);
    assert.notEqual(result.status, 0, "Client import must fail build");
    assert.match(output, /server-only|Server Component/);
    assert.ok(!output.includes("synthetic-boundary-canary"), "Canary must not appear in build error");
    console.log(JSON.stringify({ expectedBuildExit: "nonzero", actualBuildExit: result.status, boundaryAssertions: 3, status: "PASS" }));
  } finally { rmSync(route, { recursive: true }); }
} finally { if (existsSync(directory)) rmSync(directory, { recursive: true }); }
