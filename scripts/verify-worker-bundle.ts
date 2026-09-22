/** Local-only proof: each worker sees only one route's declared NFT files. No DB/provider/env file. */
import { mkdir, readFile, writeFile, copyFile, mkdtemp, stat, realpath, readdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
const root = await realpath(process.cwd());
const evidence = process.env.WORKER_BUNDLE_EVIDENCE;
if (!evidence || !path.isAbsolute(evidence)) throw Error('WORKER_BUNDLE_EVIDENCE must be an absolute private path');
await mkdir(evidence, { recursive: true });
const hash = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
const runtimeDirectories = new Set(['node_modules', '.next', 'src', 'public']);
const runtimeFiles = new Set(['package.json', 'package-lock.json', 'tsconfig.json', 'vercel.json']);
function pathIssue(absolute: string): string | null {
  const relative = path.relative(root, absolute), parts = relative.split(path.sep);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return 'OUTSIDE_RUNTIME_ROOT';
  if (parts.some(p => ['.worktrees', '.execution', '.git', '.local', '.data'].includes(p) || /^\.env(?:\.|$)/i.test(p) || /\.(env|log)$/i.test(p))) return 'PRIVATE_PATH';
  if (!runtimeDirectories.has(parts[0]) && !(parts.length === 1 && runtimeFiles.has(relative))) return 'NON_RUNTIME_PATH';
  return null;
}
async function auditTrace(trace: string) {
  const bytes = await readFile(trace), parsed = JSON.parse(bytes.toString('utf8')) as { files: unknown };
  assert(Array.isArray(parsed.files), 'Invalid NFT file list');
  const denied: Record<string, number> = {};
  const safe: { lexical: string; resolved: string }[] = [];
  for (const file of new Set(parsed.files)) {
    if (typeof file !== 'string') { denied.INVALID_ENTRY = (denied.INVALID_ENTRY ?? 0) + 1; continue; }
    const lexical = path.resolve(path.dirname(trace), file), lexicalIssue = pathIssue(lexical);
    if (lexicalIssue) { denied[`LEXICAL_${lexicalIssue}`] = (denied[`LEXICAL_${lexicalIssue}`] ?? 0) + 1; continue; }
    // Resolve aliases before any file contents are read or copied. Never print private paths/bytes.
    let resolved: string;
    try { resolved = await realpath(lexical); } catch { denied.UNRESOLVED = (denied.UNRESOLVED ?? 0) + 1; continue; }
    const resolvedIssue = pathIssue(resolved);
    if (resolvedIssue) { denied[`RESOLVED_${resolvedIssue}`] = (denied[`RESOLVED_${resolvedIssue}`] ?? 0) + 1; continue; }
    safe.push({ lexical, resolved });
  }
  return { trace, sha256: hash(bytes), entries: parsed.files.length, denied, safe };
}
async function traceFiles(directory: string): Promise<string[]> {
  const results: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) results.push(...await traceFiles(file));
    else if (entry.isFile() && entry.name.endsWith('.nft.json')) results.push(file);
  }
  return results;
}
const traceArgument = process.argv.indexOf('--check-trace');
const traceNames = traceArgument >= 0
  ? [path.resolve(process.argv[traceArgument + 1] ?? '')]
  : [...await traceFiles(path.join(root, '.next/server')), path.join(root, '.next/next-server.js.nft.json')];
const audits: Awaited<ReturnType<typeof auditTrace>>[] = [];
for (const trace of traceNames) audits.push(await auditTrace(trace));
const preflight = {
  traces: audits.map(({ trace, sha256, entries, denied }) => ({ trace: path.relative(root, trace), sha256, entries, denied })),
  deniedEntries: audits.reduce((sum, trace) => sum + Object.values(trace.denied).reduce((a, b) => a + b, 0), 0),
  copiedFiles: 0,
};
await writeFile(path.join(evidence, 'trace-preflight.json'), JSON.stringify(preflight, null, 2));
assert.equal(preflight.deniedEntries, 0, 'Unsafe or non-runtime NFT entries rejected before any bundle copy; see aggregate trace-preflight.json');
if (traceArgument >= 0 || process.argv.includes('--audit-only')) {
  console.log(JSON.stringify({ traces: audits.length, deniedEntries: 0, copiedFiles: 0 }));
  process.exit(0);
}
const summary: { name: string; status: 'PASS' | 'FAIL'; error?: string }[] = [];
async function check(name: string, fn: () => Promise<void>) {
  try { await fn(); summary.push({ name, status: 'PASS' }); }
  catch (e) { summary.push({ name, status: 'FAIL', error: e instanceof Error ? e.message : 'unknown' }); }
}
async function bundle(label: string, traceName: string) {
  const trace = path.join(root, traceName), audit = audits.find(a => a.trace === trace);
  assert(audit, 'Route trace was not checked');
  const destination = await realpath(await mkdtemp(path.join(os.tmpdir(), `gs-hale-${label}-bundle-`)));
  assert(!destination.startsWith(root + path.sep));
  const entries: { path: string; sha256: string; bytes: number }[] = [];
  for (const { lexical: f, resolved } of audit.safe) {
    assert.equal(await realpath(f), resolved, 'Trace source changed after preflight');
    const relative = path.relative(root, f);
    assert(relative && !relative.startsWith('..') && !path.isAbsolute(relative), 'Trace escaped project root');
    const dest = path.join(destination, relative);
    if ((await stat(resolved)).isDirectory()) { await mkdir(dest, { recursive: true }); continue; }
    const bytes = await readFile(resolved);
    await mkdir(path.dirname(dest), { recursive: true }); await copyFile(resolved, dest);
    entries.push({ path: relative, bytes: bytes.length, sha256: hash(bytes) });
  }
  const parentNodeModules: string[] = [];
  for (let dir = path.dirname(destination); ; dir = path.dirname(dir)) {
    try { if ((await stat(path.join(dir, 'node_modules'))).isDirectory()) parentNodeModules.push(path.join(dir, 'node_modules')); } catch { /* absent */ }
    if (dir === path.dirname(dir)) break;
  }
  assert.equal(parentNodeModules.length, 0, 'Isolated bundle has ancestor node_modules');
  await writeFile(path.join(evidence!, `${label}-trace.json`), JSON.stringify({
    trace: traceName, traceSha256: hash(await readFile(trace)), destination,
    fileCount: entries.length, totalBytes: entries.reduce((sum, entry) => sum + entry.bytes, 0),
    largestFiles: [...entries].sort((a, b) => b.bytes - a.bytes).slice(0, 15),
    files: entries, parentNodeModules, sourceSymlinksCopied: false,
  }, null, 2));
  return destination;
}
const excel = await bundle('excel', '.next/server/app/api/imports/source/route.js.nft.json');
const ai = await bundle('ai', '.next/server/app/api/ai-input/[id]/extract/route.js.nft.json');
async function run(name: string, cwd: string, args: string[], input: Buffer, timeoutMs = 65000) {
  const temporary = path.join(cwd, '.worker-tmp');
  await mkdir(temporary, { recursive: true });
  // Permission mode forbids dependency fallback reads from the original repository or global modules.
  // TSX probes the same path with flipped ASCII case to detect case-insensitive filesystems.
  const caseProbe = cwd.replace(/[a-zA-Z]/g, c => c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase());
  const full = ['--permission', `--allow-fs-read=${cwd}`, `--allow-fs-read=${caseProbe}`, `--allow-fs-write=${temporary}`, '--allow-addons', '--allow-worker', '--allow-child-process', ...args];
  const start = Date.now();
  const result = await new Promise<{ code: number | null; signal: string | null; stdout: string; stderr: string; timeout: boolean }>((resolve, reject) => {
    const child = spawn(process.execPath, full, { cwd, env: { PATH: process.env.PATH ?? '/usr/bin:/bin', NODE_ENV: 'production', LANG: 'ja_JP.UTF-8', TZ: 'UTC', TMPDIR: temporary }, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', timeout = false;
    const timer = setTimeout(() => { timeout = true; child.kill('SIGKILL'); }, timeoutMs);
    child.stdout.on('data', chunk => { stdout += chunk; if (stdout.length > 70 * 1024 * 1024) child.kill('SIGKILL'); });
    child.stderr.on('data', chunk => { stderr += chunk; if (stderr.length > 1024 * 1024) child.kill('SIGKILL'); });
    child.stdin.on('error', () => undefined);
    child.on('error', e => { clearTimeout(timer); reject(e); });
    child.on('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal, stdout, stderr, timeout }); });
    child.stdin.end(input);
  });
  await writeFile(path.join(evidence!, `${name}.json`), JSON.stringify({ cwd, executable: process.execPath, args: full, envKeys: ['PATH', 'NODE_ENV', 'LANG', 'TZ', 'TMPDIR'], inputSha256: hash(input), elapsedMs: Date.now() - start, ...result }, null, 2));
  return result;
}
const fixture = (name: string) => readFile(path.join(root, 'tests/fixtures', name));
await check('excel_valid_exact_values', async () => {
  const r = await run('excel-valid', excel, ['--max-old-space-size=256', '--import', 'tsx', 'src/server/imports/parser-child.ts'], await fixture('imports-standard-prefixed.xlsx'), 15000);
  assert.equal(r.code, 0); const data = JSON.parse(r.stdout); assert.equal(data.ok, true);
  const texts = data.workbook.sheets.flatMap((s: { rows: { cells: { text: string }[] }[] }) => s.rows.flatMap(r => r.cells.map(c => c.text)));
  assert(texts.includes('0000000000003')); assert(texts.includes('12345678901234567890.123456'));
});
await check('excel_formula_stays_error', async () => {
  const r = await run('excel-formula', excel, ['--max-old-space-size=256', '--import', 'tsx', 'src/server/imports/parser-child.ts'], await fixture('imports-formula-cached-prefixed.xlsx'), 15000);
  assert.equal(r.code, 0); const data = JSON.parse(r.stdout); assert.equal(data.ok, true);
  assert.equal(data.workbook.sheets[0].rows.find((r: { row: number }) => r.row === 4)?.cells.find((c: { column: number }) => c.column === 6)?.error, 'FORMULA_UNSUPPORTED');
});
await check('excel_corrupt_rejected_by_parser', async () => {
  const r = await run('excel-corrupt', excel, ['--max-old-space-size=256', '--import', 'tsx', 'src/server/imports/parser-child.ts'], Buffer.from('not a zip'), 15000);
  assert.equal(r.code, 2); assert.deepEqual(JSON.parse(r.stdout), { ok: false, code: 'XLSX_REQUIRED' });
});
const job = async (kind: 'pdf' | 'images', name: string) => Buffer.from(JSON.stringify(kind === 'pdf' ? { kind, bytes: (await fixture(`ai-input/${name}`)).toString('base64'), selectedPages: [1, 3] } : { kind, images: [(await fixture(`ai-input/${name}`)).toString('base64')] }));
function lines(output: string) { return output.trim().split('\n').filter(Boolean).map(line => JSON.parse(line)); }
await check('ai_selected_pdf_native_text', async () => {
  const r = await run('ai-pdf', ai, ['--max-old-space-size=256', 'src/server/ai-input/extraction/worker.mjs'], await job('pdf', 'native-12.pdf'));
  assert.equal(r.code, 0); const events = lines(r.stdout); assert(events.some(e => e.type === 'done'));
  const units = events.filter(e => e.type === 'unit').map(e => e.unit); assert.deepEqual(units.map(u => u.page), [1, 3]);
  const text = JSON.stringify(units); assert(text.includes('PAGE_01_SYNTHETIC')); assert(text.includes('PAGE_03_SYNTHETIC')); assert(!text.includes('PAGE_02_SYNTHETIC'));
});
await check('ai_japanese_image_ocr_assets_native', async () => {
  const r = await run('ai-image', ai, ['--max-old-space-size=256', 'src/server/ai-input/extraction/worker.mjs'], await job('images', 'japanese.png'));
  assert.equal(r.code, 0); const events = lines(r.stdout), done = events.find(e => e.type === 'done'); assert(done);
  assert.match(done.engines.languageAssetSha256, /^[a-f0-9]{64}$/);
  const unit = events.find(e => e.type === 'unit')?.unit; assert(unit); assert.equal(unit.status, 'partial'); assert(JSON.stringify(unit.segments).includes('すこやか')); assert(unit.unread.some((x: { code: string }) => x.code === 'OCR_COVERAGE_UNKNOWN'));
});
await check('ai_corrupt_pdf_explicit_failure', async () => {
  const r = await run('ai-corrupt', ai, ['--max-old-space-size=256', 'src/server/ai-input/extraction/worker.mjs'], await job('pdf', 'corrupt.pdf'));
  assert.equal(r.code, 0); assert(lines(r.stdout).some(e => e.type === 'fatal' && e.code === 'PDF_CORRUPT'));
});
await check('original_repository_reads_denied', async () => {
  const r = await run('read-denied', ai, ['-e', `require('node:fs').readFileSync(${JSON.stringify(path.join(root, 'package.json'))})`], Buffer.alloc(0));
  assert.notEqual(r.code, 0); assert(r.stderr.includes('ERR_ACCESS_DENIED'));
});
const result = { cwd: root, platform: process.platform, arch: process.arch, node: process.version, completedAt: new Date().toISOString(), counts: { pass: summary.filter(x => x.status === 'PASS').length, fail: summary.filter(x => x.status === 'FAIL').length }, checks: summary, bundleDirs: [excel, ai], remoteCalls: 0, realVercel: 'NOT_RUN', linuxNative: process.platform === 'linux' ? 'LOCAL_ONLY_NOT_VERCEL' : 'NOT_RUN' };
await writeFile(path.join(evidence, 'result.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
if (result.counts.fail) process.exitCode = 1;
