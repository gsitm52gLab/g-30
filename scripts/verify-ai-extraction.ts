import fs from "node:fs/promises";
import path from "node:path";
import { extractInput, contentHash } from "../src/server/ai-input/extraction";
const output = process.argv[2]; if (!output) throw new Error("Private output directory required");
await fs.mkdir(output, { recursive: true });
const scope = { classification: "general_cosmetic", language: "ja", media: "pop", use: "synthetic extraction verification" };
const source = async (filename: string) => { const bytes = await fs.readFile(path.join("tests/fixtures/ai-input", filename)); return { sourceId: filename, versionId: "v1", contextId: "synthetic-context", sha256: contentHash(bytes), filename, mime: filename.endsWith("pdf") ? "application/pdf" : "image/png", bytes }; };
const cases = [
 { id: "native-selection", input: { kind: "pdf", scope, source: await source("native-12.pdf"), selectedPages: [2,10] } },
 { id: "mixed-selection", input: { kind: "pdf", scope, source: await source("mixed-3.pdf"), selectedPages: [1,2] } },
 { id: "japanese-ocr", input: { kind: "images", scope, sources: [await source("japanese.png")] } },
 { id: "low-contrast", input: { kind: "images", scope, sources: [await source("low-contrast.png")] } },
 { id: "blank-image", input: { kind: "images", scope, sources: [await source("blank.png")] } },
 { id: "locked", input: { kind: "pdf", scope, source: await source("locked.pdf"), selectedPages: [1] } },
 { id: "corrupt", input: { kind: "pdf", scope, source: await source("corrupt.pdf"), selectedPages: [1] } },
 { id: "blank-pdf", input: { kind: "pdf", scope, source: await source("blank.pdf"), selectedPages: [1] } },
];
const expected: Record<string, string> = { "native-selection":"read", "mixed-selection":"partial", "japanese-ocr":"partial", "low-contrast":"unread", "blank-image":"unread", locked:"unread", corrupt:"unread", "blank-pdf":"unread" };
const results = [];
for (const item of cases) { const result = await extractInput(item.input); const file = path.join(output, `${item.id}.json`); await fs.writeFile(file, JSON.stringify(result, null, 2)+"\n"); results.push({ passed: result.ok && result.snapshot.status===expected[item.id], id: item.id, ok: result.ok, status: result.ok ? result.snapshot.status : result.status, issues: result.ok ? result.snapshot.issues : [result.issue], report: file, sha256: contentHash(await fs.readFile(file)) }); }
await fs.writeFile(path.join(output, "index.json"), JSON.stringify({ cwd: process.cwd(), provider_calls: 0, cases: results }, null, 2)+"\n");
if(results.some(r=>!r.passed))process.exitCode=1;
console.log(JSON.stringify(results.map(r=>({id:r.id,status:r.status,issues:r.issues}))));
