import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { createWriteStream, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { migrate, openDatabase } from '@/server/db/database';
import { createMockRepository } from '@/server/repositories/mock';
import { createSqliteRepository } from '@/server/repositories/sqlite';
import type { RecordRepository } from '@/domain/records';
import { seed } from '@/server/db/seed';
import { DEMO_PASSWORD } from '@/domain/catalog';
import { blankFileBinding } from '@/domain/products/types';
import { blankEvidenceMetadata } from '@/domain/evidence/types';
import { blankContent, blankRequirement } from '@/domain/tasks/types';
import { blankDraft } from '@/domain/submissions/types';
import type { ProductDetail } from '@/server/products/service';
import type { TaskDetail } from '@/server/tasks/service';
import type { SubmissionWorkspace } from '@/server/submissions/contracts';
import type { EvidenceDetail, MaterialTable } from '@/server/evidence/contracts';
import type { WorkbookInspection, ImportPreview, ImportBatch } from '@/server/imports/contracts';
import { guardedZip } from '@/server/imports/zip';
import { importFixture, type ImportFixtureInput, type ImportFixtureSnapshot } from './verify-imports-fixtures';
if (process.argv.includes('--mock-server')) {
    const repo = createMockRepository();
    await seed(repo);
    (globalThis as typeof globalThis & {
        gsHaleRepository?: {
            key: string;
            pending: Promise<RecordRepository>;
        };
    }).gsHaleRepository = { key: `mock:${process.env.DATABASE_FILE}`, pending: Promise.resolve(repo) };
    process.on('message', async (message) => { const m = message as {
        id: string;
        input: ImportFixtureInput;
    }; try {
        process.send?.({ id: m.id, value: await importFixture(repo, m.input) });
    }
    catch {
        process.send?.({ id: m.id, error: 'private fixture failed' });
    } });
    const { startServer } = await import('next/dist/server/lib/start-server.js');
    await startServer({ dir: process.cwd(), hostname: '127.0.0.1', port: Number(process.env.E2E_PORT), isDev: false, allowRetry: false });
    await new Promise<never>(() => { });
}
const mode = process.env.IMPORTS_MODE ?? 'sqlite';
assert(['mock', 'sqlite'].includes(mode));
const port = Number(process.env.E2E_PORT ?? 4171);
assert(Number.isSafeInteger(port) && port > 1024 && port < 65536);
mkdirSync('.local/g07-http', { recursive: true });
const directory = mkdtempSync(path.resolve(`.local/g07-http/${mode}-`)), database = path.join(directory, 'g07.db'), fileDirectory = path.join(directory, 'files'), stageDirectory = path.join(directory, 'imports');
const report = path.resolve(process.env.IMPORTS_HTTP_REPORT ?? path.join(directory, 'report.json'));
mkdirSync(path.dirname(report), { recursive: true });
const artifacts: string[] = [], checks: {
    id: string;
    requirements: string[];
    status: 'PASS' | 'FAIL';
}[] = [], transcript: {
    method: string;
    url: string;
    status: number;
    artifact: string;
    sha256: string;
}[] = [], processes: {
    pid?: number;
    port: number;
    argv: string[];
    log: string;
    stopped?: boolean;
    exitCode?: number | null;
    signal?: string | null;
}[] = [];
const candidate = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), startedAt = new Date().toISOString(), origin = `http://127.0.0.1:${port}`;
let child: ChildProcess | undefined, failure: string | undefined, complete = false;
const hash = (value: unknown) => createHash('sha256').update(Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');
function check(id: string, ok: unknown, requirements = ['AC-07-03']) { checks.push({ id, requirements, status: ok ? 'PASS' : 'FAIL' }); assert(ok, id); }
async function start() {
    await new Promise<void>((resolve, reject) => { const server = createServer(); server.once('error', reject); server.listen(port, '127.0.0.1', () => server.close(e => e ? reject(e) : resolve())); });
    const args = mode === 'mock' ? ['--import', 'tsx', 'scripts/verify-imports-http.ts', '--mock-server'] : ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(port)], log = `${report}.server-${processes.length + 1}.log`, stream = createWriteStream(log, { mode: 0o600 });
    artifacts.push(log);
    child = spawn(process.execPath, args, { cwd: process.cwd(), stdio: ['pipe', 'pipe', 'pipe', 'ipc'], env: { ...process.env, DATA_SOURCE: mode, DATABASE_FILE: database, FILE_STORAGE_DIR: fileDirectory, IMPORT_STORAGE_DIR: stageDirectory, APP_ORIGIN: origin, SESSION_COOKIE_NAME: `gs_hale_g07_http_${port}`, E2E_PORT: String(port), OPENAI_API_KEY: '', OPENAI_MODEL: '', OPENAI_BASE_URL: 'https://api.openai.com/v1', NEXT_TELEMETRY_DISABLED: '1' } });
    processes.push({ pid: child.pid, port, argv: [process.execPath, ...args], log });
    child.stdout?.pipe(stream, { end: false });
    child.stderr?.pipe(stream, { end: false });
    child.once('exit', () => stream.end());
    for (let i = 0; i < 200; i++) {
        if (child.exitCode !== null)
            throw new Error('own server exited');
        try {
            if ((await fetch(`${origin}/api/health`)).ok)
                return;
        }
        catch { }
        await new Promise(r => setTimeout(r, 50));
    }
    throw new Error('readiness timeout');
}
async function stop() { if (!child)
    return; const own = child, done = new Promise<void>(r => own.once('exit', () => r())); if (own.exitCode === null && own.signalCode === null) {
    own.kill('SIGTERM');
    await done;
} const record = processes.at(-1)!; record.stopped = true; record.exitCode = own.exitCode; record.signal = own.signalCode; child = undefined; }
async function fixture(input: ImportFixtureInput): Promise<ImportFixtureSnapshot> { if (mode === 'sqlite') {
    const repo = createSqliteRepository(openDatabase(database));
    try {
        return await importFixture(repo, input);
    }
    finally {
        repo.close();
    }
} return new Promise((resolve, reject) => { const id = randomUUID(), timer = setTimeout(() => reject(new Error('fixture timeout')), 5000); const listener = (raw: unknown) => { const m = raw as {
    id: string;
    value: ImportFixtureSnapshot;
    error?: string;
}; if (m.id !== id)
    return; clearTimeout(timer); child!.off('message', listener); if (m.error)
    reject(new Error(m.error));
else
    resolve(m.value); }; child!.on('message', listener); child!.send({ id, input }); }); }
class Client {
    cookie = '';
    async send(url: string, method = 'GET', body?: unknown, csrf?: string) { const response = await fetch(origin + url, { method, redirect: 'manual', headers: { Cookie: this.cookie, ...method !== 'GET' ? { Origin: origin, 'X-CSRF-Token': csrf ?? '', ...body instanceof FormData ? {} : { 'Content-Type': 'application/json' } } : {} }, body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body) }); const cookie = response.headers.get('set-cookie'); if (cookie)
        this.cookie = cookie.split(';')[0]; const bytes = Buffer.from(await response.clone().arrayBuffer()), artifact = `${report}.response-${transcript.length + 1}${response.headers.get('content-type')?.includes('json') ? '.json' : '.bin'}`; writeFileSync(artifact, bytes, { mode: 0o600 }); artifacts.push(artifact); transcript.push({ method, url, status: response.status, artifact, sha256: hash(bytes) }); return response; }
    async get<T>(url: string): Promise<T> { const r = await this.send(url); assert.equal(r.status, 200, await r.clone().text()); return r.json() as Promise<T>; }
    async mutate(url: string, body: unknown) { const c = await this.get<{
        csrfToken: string;
    }>('/api/auth/csrf'); return this.send(url, 'POST', body, c.csrfToken); }
    async login(name: string) { const r = await this.mutate('/api/auth/login', { email: `${name}@example.test`, password: DEMO_PASSWORD }); assert.equal(r.status, 200, await r.clone().text()); }
}
const A = 'ctx-jp-a-luna', admin = new Client(), brand = new Client(), team = new Client(), gsg = new Client(), price = new Client(), foreign = new Client();
const detail = (id: string, c = brand) => c.get<ProductDetail>(`/api/products/${id}?context=${A}`);
async function posted<T>(c: Client, url: string, body: unknown, status = 200): Promise<T> { const r = await c.mutate(url, body); assert.equal(r.status, status, await r.clone().text()); return r.json() as Promise<T>; }
async function create(code: string) { return (await posted<{
    ids: string[];
}>(brand, '/api/products', { contextId: A, brandId: 'brand-luna', common: { name: `합성 ${code}`, code }, idempotencyKey: randomUUID() }, 201)).ids[0]; }
async function workbook(rows: unknown[][], headers = ['contextKey', 'common.code', 'common.name', 'local.jan', 'retail.amount', 'retail.currency'], headerRow = 1) { const book = new ExcelJS.Workbook(), sheet = book.addWorksheet('상품'); for (let i = 1; i < headerRow; i++)
    sheet.addRow(['안내']); sheet.addRow(headers); for (const row of rows)
    sheet.addRow(row); return Buffer.from(await book.xlsx.writeBuffer()); }
async function preview(c: Client, bytes: Buffer, headers = ['contextKey', 'common.code', 'common.name', 'local.jan', 'retail.amount', 'retail.currency'], headerRow = 1) { const form = new FormData(); form.append('file', new Blob([new Uint8Array(bytes)]), 'standard.xlsx'); const source = await posted<WorkbookInspection>(c, `/api/imports/source?context=${A}`, form, 201); return posted<ImportPreview>(c, '/api/imports/preview', { sourceId: source.sourceId, sheetId: source.sheets[0].id, headerRow, mapping: headers.map((field, i) => ({ column: i + 1, field })), choices: [] }, 201); }
try {
    if (mode === 'sqlite') {
        const db = openDatabase(database, true);
        migrate(db);
        const repo = createSqliteRepository(db);
        await seed(repo);
        repo.close();
    }
    await start();
    for (const [c, name] of [[admin, 'admin'], [brand, 'luna'], [team, 'team'], [gsg, 'operator'], [price, 'price'], [foreign, 'wave']] as const)
        await c.login(name);
    check('anonymous imports denied', (await new Client().send(`/api/imports?context=${A}`)).status === 401, ['A19']);
    check('foreign context neutral404', (await foreign.send(`/api/imports?context=${A}`)).status === 404, ['A19']);
    check('CSRF preview denied', (await brand.send('/api/imports/preview', 'POST', {})).status === 403, ['A19']);
    const p1 = await create('G07-HTTP-ONE'), p2 = await create('G07-HTTP-TWO'), png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aS0cAAAAASUVORK5CYII=', 'base64');
    const form = new FormData();
    form.append('files', new Blob([png], { type: 'image/png' }), 'questionnaire.png');
    form.append('visibility', 'public');
    const file = (await posted<{
        files: {
            id: string;
            sha256: string;
        }[];
    }>(team, `/api/files?productId=${p1}&contextId=${A}`, form, 201)).files[0];
    let d = await detail(p1);
    const binding = blankFileBinding('g07-http-binding', file.id);
    await posted(team, `/api/products/${p1}`, { contextId: A, command: 'save_files', expectedContextRevision: d.contextRevision, files: [binding], idempotencyKey: randomUUID() });
    d = await detail(p1);
    const source = { kind: 'product_binding', productId: p1, contextProductId: d.contextProductId, contextVersionId: d.contextVersionId, bindingId: binding.id, fileVersionId: file.id }, registered = await posted<{
        ids: string[];
    }>(team, '/api/evidence', { contextId: A, source, metadata: { ...blankEvidenceMetadata(), title: '합성 서명 질문지', documentType: 'signed_questionnaire' }, productIds: [p1, p2], idempotencyKey: randomUUID() }, 201);
    let evidence = await brand.get<EvidenceDetail>(`/api/evidence/${registered.ids[0]}`);
    check('one file two independent evidence links', evidence.current.links.length === 2 && new Set(evidence.current.links.map(l => l.file.id)).size === 1, ['AC-07-01']);
    check('unknown period never fabricated', evidence.current.metadata.statedValidTo === null && evidence.notice.includes('인증 승인'), ['AC-07-02']);
    const first = evidence.current.links.find(l => l.productId === p1)!;
    check('brand cannot assess', (await brand.mutate(`/api/evidence/${evidence.id}`, { command: 'assess', linkId: first.id, expectedLinkRevision: first.revision, status: 'application_confirmed', reason: 'x', idempotencyKey: randomUUID() })).status === 403, ['A19']);
    await posted(admin, `/api/evidence/${evidence.id}`, { command: 'assess', linkId: first.id, expectedLinkRevision: first.revision, status: 'application_confirmed', reason: '제품 관계만 확인', idempotencyKey: randomUUID() });
    evidence = await brand.get<EvidenceDetail>(`/api/evidence/${evidence.id}`);
    check('application states independently stored', evidence.current.links.find(l => l.productId === p1)!.assessments[0].status === 'application_confirmed' && evidence.current.links.find(l => l.productId === p2)!.assessments.length === 0, ['AC-07-01']);
    check('foreign evidence direct path denied', (await foreign.send(`/api/evidence/${evidence.id}`)).status === 404, ['A19']);
    const download = await brand.send(first.file.downloadUrl);
    check('current-authorized exact file bytes', download.ok && hash(Buffer.from(await download.arrayBuffer())) === hash(png), ['A19', 'AC-07-01']);
    const content = { ...blankContent(), title: 'G07 실제 제출 연결', description: '두 상품의 자료 제출', deadline: { ...blankContent().deadline, responsibleUserId: 'user-gsg' }, requirements: [{ ...blankRequirement('document', 'file'), label: '요청 문서', productIds: [p1, p2], specifications: [{ text: '서명 내용 확인', source: '합성 규격', version: '1', severity: 'required', check: 'human' }] }] }, taskId = (await posted<{
        ids: string[];
    }>(admin, '/api/tasks', { targets: [{ contextId: A, ownerId: 'user-gsg', assigneeId: 'user-luna', coAssigneeIds: [], productIds: [p1, p2] }], content, category: 'spot', idempotencyKey: randomUUID() }, 201)).ids[0];
    const task = await admin.get<TaskDetail>(`/api/tasks/${taskId}`);
    await posted(admin, `/api/tasks/${taskId}`, { command: 'publish', expectedRevision: task.task.revision, idempotencyKey: randomUUID() });
    let w = await brand.get<SubmissionWorkspace>(`/api/tasks/${taskId}/submissions`);
    const selections = await Promise.all([p1, p2].map(async (id) => { const p = await detail(id); return { productId: id, expectedCommonRevision: p.commonRevision, expectedContextRevision: p.contextRevision, bindingIds: id === p1 ? [binding.id] : [], retailPriceVersionId: null, asOfDate: '2026-09-21' }; }));
    await posted(brand, `/api/tasks/${taskId}/submission-draft`, { command: 'save', baseRequestId: w.request.id, expectedDraftRevision: 0, content: { ...blankDraft(), answers: [{ requestId: w.request.id, requirementKey: 'document', productId: p1, type: 'file', input: { fileVersionIds: [file.id] } }], productSelections: selections }, idempotencyKey: randomUUID() });
    w = await brand.get<SubmissionWorkspace>(`/api/tasks/${taskId}/submissions`);
    await posted(brand, `/api/tasks/${taskId}/submissions`, { baseRequestId: w.request.id, expectedDraftRevision: w.draft!.revision, expectedTaskRevision: w.taskRevision, mode: 'partial', idempotencyKey: randomUUID() }, 201);
    const table = await brand.get<MaterialTable>(`/api/evidence/table?context=${A}`), row = table.rows.find(r => r.productId === p1)!, cell = row.cells.find(c => c.taskId === taskId)!;
    check('actual partial submission plus human pending retained after application confirmation', cell.status === 'content_confirmation' && cell.humanReviewPending && row.counts.unconfirmed > 0, ['AC-07-01']);
    check('inventory on second product is not submission', table.rows.find(r => r.productId === p2)!.cells.find(c => c.taskId === taskId)!.status === 'missing', ['AC-07-01']);
    check('product and table aggregate identical', hash((await detail(p1)).materialCounts) === hash(row.counts), ['SA-22']);
    const before = await fixture({ action: 'snapshot' }), bytes = await workbook([[A, 'G07-HTTP-ONE', 'Excel 최신', '00001', '0', 'JPY'], [A, 'G07-HTTP-THREE', '새 상품', '00003', '12.345', 'USD']], undefined, 2), p = await preview(brand, bytes, undefined, 2);
    check('all-row preview valid', p.canApply && p.totalRows === 2 && p.rows[0].action === 'update' && p.rows[1].action === 'new');
    check('preview changes zero business rows', hash(await fixture({ action: 'snapshot' })) === hash(before));
    const apply = { previewId: p.id, idempotencyKey: randomUUID() };
    const [applied, concurrent] = await Promise.all([posted<{ids:string[]}>(brand,'/api/imports/apply',apply,201),posted<{ids:string[]}>(brand,'/api/imports/apply',apply,201)]);
    check('concurrent HTTP same-key apply returns one identical batch',hash(applied)===hash(concurrent));
    const replay=await posted<{ids:string[]}>(brand,'/api/imports/apply',apply,201);
    check('response loss retry one identical batch', hash(applied) === hash(replay));
    const batch = await brand.get<ImportBatch>(`/api/imports/batches/${applied.ids[0]}`);
    check('batch provenance and both row results durable', batch.rows.length === 2 && batch.sourceHash === p.sourceHash);
    check('zero/leading-zero public values exact', (await detail(p1)).retail.current?.fields.amount === '0' && (await detail(p1)).local.jan === '00001');
    const after = await fixture({ action: 'snapshot' });
    check('actual G05 snapshot/file versions unchanged by import', after.submission.sha256 === before.submission.sha256 && after.productUseSnapshot.sha256 === before.productUseSnapshot.sha256 && after.fileVersion.sha256 === before.fileVersion.sha256, ['D09-downstream-consumers', 'AC-07-03']);
    const errorBefore = await fixture({ action: 'snapshot' }), bad = await preview(brand, await workbook([[A, ' dup ', 'one', '', '1', 'JPY'], [A, 'DUP', 'two', 123, '2', 'JPY']]));
    check('duplicate and numeric identifier errors visible', bad.errorRows === 2 && !bad.canApply);
    check('any error blocks full batch', (await brand.mutate('/api/imports/apply', { previewId: bad.id, idempotencyKey: randomUUID() })).status === 422);
    check('failed batch no business writes', hash(await fixture({ action: 'snapshot' })) === hash(errorBefore));
    const privateHeaders = ['contextKey', 'common.code', 'common.name', 'internal.supplyAmount', 'internal.currency'], privateBytes = await workbook([[A, 'PRIVATE-HTTP', 'private', '999123.456789', 'JPY']], privateHeaders), privateForm = new FormData();
    privateForm.append('file', new Blob([new Uint8Array(privateBytes)]), 'price.xlsx');
    const privateSource = await posted<WorkbookInspection>(brand, `/api/imports/source?context=${A}`, privateForm, 201);
    check('brand private mapping forbidden', (await brand.mutate('/api/imports/preview', { sourceId: privateSource.sourceId, sheetId: privateSource.sheets[0].id, headerRow: 1, mapping: privateHeaders.map((field, i) => ({ column: i + 1, field })), choices: [] })).status === 403, ['AC-07-04']);
    const pricePreview = await preview(price, privateBytes, privateHeaders);
    await posted(price, '/api/imports/apply', { previewId: pricePreview.id, idempotencyKey: randomUUID() }, 201);
    const exported = await brand.send(`/api/imports/workbook?context=${A}&kind=export`);
    check('public export succeeds', exported.status === 200, ['AC-07-04']);
    const exportBytes = Buffer.from(await exported.arrayBuffer()), zip = await guardedZip(exportBytes), xml = [...zip.values()].map(b => b.toString('utf8')).join('');
    check('every exported ZIP member lacks hidden price values/headers', !xml.includes('999123.456789') && !xml.includes('internal.supplyAmount') && xml.includes('retail.amount'), ['AC-07-04']);
    check('nonprice GSG private export denied', (await gsg.send(`/api/imports/workbook?context=${A}&kind=export&internal=1`)).status === 404, ['AC-07-04']);
    const malformedId = randomUUID(), extendedId = randomUUID();
    await fixture({ action: 'poison_batch', batchId: batch.id, poisonedId: malformedId, malformed: true });
    await fixture({ action: 'poison_batch', batchId: batch.id, poisonedId: extendedId, malformed: false });
    const poisonedBefore = await fixture({ action: 'snapshot' }), malformedResponse = await brand.send(`/api/imports/batches/${malformedId}`), malformedRaw = await malformedResponse.text();
    check('SRV01 actual malformed nested batch response is neutral503 without marker', malformedResponse.status === 503 && !malformedRaw.includes('G07_IMPORT_CANARY'), ['G07-SRV-01', 'A19']);
    const extendedRaw = await brand.get<ImportBatch>(`/api/imports/batches/${extendedId}`);
    check('SRV01 legitimate stored extras omitted while result rows retained', extendedRaw.rows.length === batch.rows.length && !JSON.stringify(extendedRaw).includes('G07_IMPORT_CANARY'), ['G07-SRV-01', 'A19']);
    check('SRV01 original stored batches never rewritten by reads', hash(await fixture({ action: 'snapshot' })) === hash(poisonedBefore), ['G07-SRV-01']);
    const original = await fixture({ action: 'snapshot' });
    await fixture({ action: 'membership', userId: 'user-luna', contextId: A, active: false });
    check('revocation rejects successful batch replay', (await brand.mutate('/api/imports/apply', apply)).status === 404, ['A19']);
    check('revocation rejects original/reference download', (await brand.send(first.file.downloadUrl)).status === 404, ['A19']);
    await fixture({ action: 'membership', userId: 'user-luna', contextId: A, active: true });
    if (mode === 'sqlite') {
        const oldPid = processes.at(-1)!.pid;
        await stop();
        await start();
        brand.cookie = '';
        await brand.login('luna');
        check('new PID restart occurred', processes.at(-1)!.pid !== oldPid, ['A20']);
        check('relogin evidence and batch survive', (await brand.get<EvidenceDetail>(`/api/evidence/${evidence.id}`)).current.id === evidence.current.id && (await brand.get<ImportBatch>(`/api/imports/batches/${batch.id}`)).sourceHash === batch.sourceHash, ['A20']);
        const persisted = await fixture({ action: 'snapshot' });
        check('restart original immutable business rows identical', hash(persisted) === hash(original), ['A20']);
    }
    complete = true;
}
catch (error) {
    failure = error instanceof Error ? error.stack : String(error);
    process.exitCode = 1;
}
finally {
    await stop();
    const result = { candidate_commit: candidate, cwd: process.cwd(), mode, port, startedAt, finishedAt: new Date().toISOString(), checksReachedEnd: complete, checks, counts: { unit: 'assertions', pass: checks.filter(c => c.status === 'PASS').length, fail: checks.filter(c => c.status === 'FAIL').length, not_run: complete ? 0 : 1 }, processes, transcript, artifacts, failure, operationalWorkbook: 'NOT_RUN' };
    writeFileSync(report, JSON.stringify(result, null, 2), { mode: 0o600 });
    console.log(JSON.stringify({ report, complete, counts: result.counts, failure }));
}
