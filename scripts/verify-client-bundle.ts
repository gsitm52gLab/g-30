import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
function files(directory: string): string[] { return readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(path.join(directory, entry.name)) : [path.join(directory, entry.name)]); }
const built = files(".next/static");
assert.ok(built.length > 0, "A production build must exist");
for (const filename of built) {
  const text = readFileSync(filename, "utf8");
  assert.ok(!text.includes("synthetic-build-canary-g00"), `Synthetic API key found in ${filename}`);
  assert.ok(!text.includes("OPENAI_API_KEY"), `Server configuration reference found in ${filename}`);
}
console.log(JSON.stringify({ status: "PASS", inspectedClientAssets: built.length, assertions: "synthetic key and server configuration absent from browser assets" }));
