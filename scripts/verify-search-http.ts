import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { createWriteStream, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { openDatabase, migrate } from '@/server/db/database';
import { createSqliteRepository } from '@/server/repositories/sqlite';
import { seed } from '@/server/db/seed';
import { DEMO_PASSWORD } from '@/domain/catalog';
import { blankContent, blankRequirement } from '@/domain/tasks/types';
import { blankDraft } from '@/domain/submissions/types';
import { blankNotice } from '@/domain/notices/types';
import type { NoticeDetail } from '@/server/notices/contracts';
import { blankInternalPrice, blankFileBinding } from '@/domain/products/types';
import type { ProductDetail } from '@/server/products/service';
import type { TaskDetail } from '@/server/tasks/service';
import type { SubmissionWorkspace } from '@/server/submissions/contracts';
import type { CompletionService } from '@/server/completion/service';
import type { SearchList, SearchDetail } from '@/domain/search/types';
import type { AuditList } from '@/domain/audit/view';
import type { WorkbookInspection, ImportPreview } from '@/server/imports/contracts';
const mode = process.env.SEARCH_MODE ?? 'sqlite';
assert(['mock', 'sqlite'].includes(mode));
const port = Number(process.env.E2E_PORT ?? 4255), aux = Number(process.env.E2E_AUX_PORT ?? 4256);
assert(Number.isInteger(port) && Number.isInteger(aux) && port > 1024 && aux > 1024 && port !== aux);
const root = path.resolve(process.env.SEARCH_ROOT ?? '.local/g14-http');
mkdirSync(root, { recursive: true });
const directory = mkdtempSync(path.join(root, `${mode}-`)), database = path.join(directory, 'search.db'), files = path.join(directory, 'files'), report = path.resolve(process.env.SEARCH_REPORT ?? path.join(directory, 'report.json'));
mkdirSync(path.dirname(report), { recursive: true });
const candidate = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), cwd = process.cwd(), startedAt = new Date().toISOString(), hash = (b: string | Buffer) => createHash('sha256').update(b).digest('hex');
const checks: {
    id: string;
    status: 'PASS' | 'FAIL' | 'SKIP';
    requirements: string[];
    reason?: string;
}[] = [], transcript: {
    url: string;
    method: string;
    status: number;
    path: string;
    sha256: string;
}[] = [], processes: {
    pid?: number;
    port: number;
    cwd: string;
    argv: string[];
    log: string;
    stopped?: boolean;
    exitCode?: number | null;
    signal?: string | null;
}[] = [];
const children = new Map<number, ChildProcess>();
let failure: string | undefined;
const planned = Array.from({ length: 28 }, (_, i) => `H${String(i + 1).padStart(2, '0')}`);
function check(id: string, condition: unknown, requirements = ['AC-14-01']) { checks.push({ id, status: condition ? 'PASS' : 'FAIL', requirements }); assert(condition, id); }
async function capture(r: Response, method: string, url: string) { const b = Buffer.from(await r.clone().arrayBuffer()), p = `${report}.responses/${String(transcript.length + 1).padStart(4, '0')}.body`; mkdirSync(path.dirname(p), { recursive: true }); writeFileSync(p, b, { mode: 0o600 }); transcript.push({ url, method, status: r.status, path: p, sha256: hash(b) }); }
async function start(p = port) {
    await new Promise<void>((res, rej) => { const s = createServer(); s.once('error', rej); s.listen(p, '127.0.0.1', () => s.close(e => e ? rej(e) : res())); });
    const origin = `http://127.0.0.1:${p}`, args = ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(p)], log = `${report}.server-${processes.length + 1}.log`, out = createWriteStream(log);
    const child = spawn(process.execPath, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, DATA_SOURCE: mode, DATABASE_FILE: database, FILE_STORAGE_DIR: files, IMPORT_STORAGE_DIR: path.join(directory, 'imports'), APP_ORIGIN: origin, SESSION_COOKIE_NAME: `gs_hale_g14_${p}`, OPENAI_API_KEY: '', OPENAI_MODEL: '', OPENAI_BASE_URL: 'https://api.openai.com/v1', NEXT_TELEMETRY_DISABLED: '1' } });
    children.set(p, child);
    processes.push({ pid: child.pid, port: p, cwd, argv: [process.execPath, ...args], log });
    child.stdout!.pipe(out, { end: false });
    child.stderr!.pipe(out, { end: false });
    child.once('exit', () => out.end());
    for (let i = 0; i < 200; i++) {
        if (child.exitCode !== null)
            throw Error('owned server exited');
        try {
            if ((await fetch(origin + '/api/health')).ok)
                return;
        }
        catch { }
        await new Promise(r => setTimeout(r, 50));
    }
    throw Error('owned server readiness');
}
async function stop(p: number) {
    const child = children.get(p);
    if (!child)
        return;
    const closed = new Promise<void>(r => child.once('exit', () => r()));
    child.kill('SIGTERM');
    if (child.exitCode === null && child.signalCode === null)
        await closed;
    Object.assign(processes.findLast(r => r.pid === child.pid)!, { stopped: true, exitCode: child.exitCode, signal: child.signalCode });
    children.delete(p);
}
class Client {
    cookie = '';
    constructor(readonly slot = port) { }
    get origin() { return `http://127.0.0.1:${this.slot}`; }
    async send(url: string, method = 'GET', body?: unknown, csrf = '') {
        const r = await fetch(this.origin + url, { method, redirect: 'manual', headers: { Cookie: this.cookie, ...method !== 'GET' ? { 'Content-Type': 'application/json', Origin: this.origin, 'X-CSRF-Token': csrf } : {} }, body: body === undefined ? undefined : JSON.stringify(body) });
        const c = r.headers.get('set-cookie');
        if (c)
            this.cookie = c.split(';')[0];
        await capture(r, method, url);
        return r;
    }
    async get<T>(url: string): Promise<T> { const r = await this.send(url); assert.equal(r.status, 200, await r.clone().text()); return r.json(); }
    async mutate(url: string, body: unknown, method = 'POST') {
        const c = await this.get<{
            csrfToken: string;
        }>('/api/auth/csrf');
        return this.send(url, method, body, c.csrfToken);
    }
    async ok<T>(url: string, body: unknown, method = 'POST'): Promise<T> { const r = await this.mutate(url, body, method); assert([200, 201].includes(r.status), await r.clone().text()); return r.json(); }
    async login(email: string) { await this.ok('/api/auth/login', { email, password: DEMO_PASSWORD }); }
    async form(url: string, body: FormData) {
        const c = await this.get<{
            csrfToken: string;
        }>('/api/auth/csrf'), r = await fetch(this.origin + url, { method: 'POST', headers: { Cookie: this.cookie, Origin: this.origin, 'X-CSRF-Token': c.csrfToken }, body });
        await capture(r, 'POST multipart', url);
        assert([200, 201].includes(r.status), await r.clone().text());
        return r;
    }
}
const A = 'ctx-jp-a-luna', B = 'ctx-jp-b-luna', admin = new Client(), brand = new Client(), team = new Client(), gsg = new Client(), price = new Client(), q = `?context=${A}`;
const search = (client = brand, extra = '') => client.get<SearchList>('/api/search' + q + extra), audit = (client = gsg, extra = '') => client.get<AuditList>('/api/audit' + q + extra);
const product = async (name: string, contextId = A) => (await admin.ok<{
    ids: string[];
}>('/api/products', { contextId, brandId: 'brand-luna', common: { name, code: randomUUID() }, idempotencyKey: randomUUID() })).ids[0];
const pd = (id: string, client = brand) => client.get<ProductDetail>(`/api/products/${id}${q}`);
const td = (id: string, client = admin) => client.get<TaskDetail>(`/api/tasks/${id}`);
const taskContent = { ...blankContent(), title: 'HTTP_HISTORICAL_REQUEST', description: 'HTTP_OLD_BODY', internalOriginal: 'HTTP_INTERNAL_CANARY', internalMemo: 'HTTP_INTERNAL_CANARY', deadline: { ...blankContent().deadline, responsibleUserId: 'user-gsg' }, requirements: [{ ...blankRequirement('answer'), label: '합성 답변' }] };
let taskId = '', submissionId = '', completionId = '', productId = '';
try {
    if (mode === 'sqlite') {
        const db = openDatabase(database, true);
        migrate(db);
        const repo = createSqliteRepository(db);
        await seed(repo);
        repo.close();
    }
    await start();
    check('H01 unauthenticated search401', (await new Client().send('/api/search' + q)).status === 401, ['A19']);
    await admin.login('admin@example.test');
    await brand.login('luna@example.test');
    await team.login('team@example.test');
    await gsg.login('operator@example.test');
    await price.login('price@example.test');
    check('H02 brand audit denied and malformed pagination422', (await brand.send('/api/audit' + q)).status === 404 && (await brand.send('/api/search' + q + '&page=Infinity')).status === 422 && (await brand.send('/api/search' + q + '&q=a&q=b')).status === 422, ['A19']);
    const visible = [];
    for (let i = 0; i < 3; i++)
        visible.push(await product('HTTP_THREE_ALLOWED ' + i));
    productId = visible[0];
    const before = await search(team, '&q=HTTP_THREE_ALLOWED&kind=product&pageSize=2');
    for (let i = 0; i < 2; i++)
        await product('HTTP_THREE_ALLOWED FOREIGN ' + i, B);
    const after = await search(team, '&q=HTTP_THREE_ALLOWED&kind=product&pageSize=2');
    check('H03 foreign rows cannot affect three hits count page or filters', before.total === 3 && before.items.length === 2 && JSON.stringify(after) === JSON.stringify(before));
    check('H04 page2 and unauthorized context neutral404', (await search(team, '&q=HTTP_THREE_ALLOWED&kind=product&pageSize=2&page=2')).items.length === 1 && (await team.send('/api/search?context=' + B)).status === 404);
    const hiddenBefore = await audit(gsg);
    await price.ok(`/api/products/${productId}`, { contextId: A, command: 'save_internal', expectedPriceRevision: 0, price: { ...blankInternalPrice(), supplyAmount: '923456789', currency: 'JPY', source: 'HTTP_PRICE_CANARY' }, idempotencyKey: randomUUID() });
    check('H05 nonprice price-only audit existence and search hidden', JSON.stringify(await audit(gsg)) === JSON.stringify(hiddenBefore) && (await search(gsg, '&q=HTTP_PRICE_CANARY')).total === 0 && (await search(price, '&q=HTTP_PRICE_CANARY')).total === 1);
    const old = await pd(productId), oldId = old.commonVersionId;
    await brand.ok(`/api/products/${productId}`, { command: 'save_common', contextId: A, expectedCommonRevision: old.commonRevision, common: { ...old.common, name: 'HTTP_REVISED_PRODUCT' }, idempotencyKey: randomUUID() });
    const historical = await brand.get<SearchDetail>(`/api/search/history${q}&kind=productVersion&id=${oldId}`);
    check('H06 actual old product version retained not latest fallback', historical.item.title === 'HTTP_THREE_ALLOWED 0' && historical.item.sourcePrecision === 'exact_version' && historical.item.sourceUrlPrecision === 'related_current' && (await search(brand, '&q=HTTP_THREE_ALLOWED%200&mode=history')).total === 1, ['AC-14-04']);
    taskId = (await admin.ok<{
        ids: string[];
    }>('/api/tasks', { category: 'spot', content: taskContent, targets: [{ contextId: A, ownerId: 'user-gsg', assigneeId: 'user-luna', coAssigneeIds: ['user-co'], productIds: [productId] }], idempotencyKey: randomUUID() })).ids[0];
    const publish = { command: 'publish', expectedRevision: 1, idempotencyKey: randomUUID() }, p1 = await admin.ok(`/api/tasks/${taskId}`, publish);
    assert.deepEqual(await admin.ok(`/api/tasks/${taskId}`, publish), p1);
    const published = (await audit(admin, '&task=' + taskId + '&status=task.published')).items;
    check('H07 publish replay one audit exact request receipt event IDs', published.length === 1 && !!published[0].receiptId && published[0].eventIds.length === 1 && published[0].versions.some(v => v.kind === 'requestVersion'), ['AC-14-03']);
    const request = (await td(taskId)).versions[0], saved = await td(taskId);
    await admin.ok(`/api/tasks/${taskId}`, { command: 'save', expectedRevision: saved.task.revision, content: { ...taskContent, title: 'HTTP_CURRENT_REQUEST', description: 'HTTP_NEW_BODY' }, idempotencyKey: randomUUID() });
    await admin.ok(`/api/tasks/${taskId}`, { command: 'publish', expectedRevision: (await td(taskId)).task.revision, idempotencyKey: randomUUID() });
    const oldTask = await brand.get<SearchDetail>(`/api/search/history${q}&kind=requestVersion&id=${request.id}`);
    check('H08 actual request old body and internal ACL', oldTask.fields.some(f => f.value === 'HTTP_OLD_BODY') && !JSON.stringify(oldTask).includes('HTTP_INTERNAL_CANARY') && (await search(brand, '&q=HTTP_INTERNAL_CANARY&mode=history')).total === 0 && (await search(gsg, '&q=HTTP_INTERNAL_CANARY&mode=history')).total > 0, ['AC-14-04', 'A19']);
    const assigned = await search(brand, '&task=' + taskId), co = assigned.items.flatMap(x => x.assignees).find(x => x.id === 'user-co')!;
    assert(co);
    const assigneeResults = await Promise.all(['user-luna', 'user-co', 'user-gsg'].map(id => search(brand, '&task=' + taskId + '&assignee=' + id)));
    check('H27 actual primary co and GSG assignee filters plus safe name keyword distinct from author', assigneeResults.every(r => r.total > 0) && new Set(assigned.items.flatMap(x => x.assignees.map(a => a.role))).size === 3 && assigned.items.every(x => x.assignees.every(a => a.scope === 'current_related_task')) && (await search(brand, '&task=' + taskId + '&q=' + encodeURIComponent(co.label))).total > 0 && (await search(brand, '&task=' + taskId + '&mode=history&actor=user-co')).total === 0 && (await audit(admin, '&task=' + taskId + '&assignee=user-co')).total > 0, ['SA-55', 'AC-14-04']);
    await admin.ok(`/api/tasks/${taskId}`, { command: 'assign', expectedRevision: (await td(taskId)).task.revision, assignment: { ownerId: 'user-gsg', assigneeId: 'user-luna', coAssigneeIds: [] }, idempotencyKey: randomUUID() });
    const afterAssignment = await brand.get<SearchDetail>(`/api/search/history${q}&kind=requestVersion&id=${request.id}`);
    check('H28 historical author stays exact while current related assignee changes', (await search(brand, '&task=' + taskId + '&mode=history&assignee=user-co')).total === 0 && (await audit(admin, '&task=' + taskId + '&assignee=user-co')).total === 0 && afterAssignment.item.actor.id === 'user-admin' && !afterAssignment.item.assignees.some(a => a.id === 'user-co') && afterAssignment.fields.some(f => f.value === 'HTTP_OLD_BODY'), ['SA-55', 'AC-14-04']);
    const selectedProduct = await pd(productId);
    let workspace = await brand.get<SubmissionWorkspace>(`/api/tasks/${taskId}/submissions`);
    await brand.ok(`/api/tasks/${taskId}/submission-draft`, { command: 'save', baseRequestId: workspace.request.id, expectedDraftRevision: 0, content: { ...blankDraft(), narrative: 'HTTP_SUBMITTED_NARRATIVE', productSelections: [{ productId, expectedCommonRevision: selectedProduct.commonRevision, expectedContextRevision: selectedProduct.contextRevision, bindingIds: [], retailPriceVersionId: null, asOfDate: '2026-09-21' }], answers: [{ requestId: workspace.request.id, requirementKey: 'answer', productId: null, type: 'long_text', input: { text: 'HTTP_SUBMITTED_ANSWER' } }] }, idempotencyKey: randomUUID() });
    workspace = await brand.get<SubmissionWorkspace>(`/api/tasks/${taskId}/submissions`);
    const submit = { baseRequestId: workspace.request.id, expectedDraftRevision: workspace.draft!.revision, expectedTaskRevision: workspace.taskRevision, mode: 'full', idempotencyKey: randomUUID() }, s1 = await brand.ok<{
        ids: string[];
    }>(`/api/tasks/${taskId}/submissions`, submit);
    submissionId = s1.ids[0];
    assert.deepEqual(await brand.ok(`/api/tasks/${taskId}/submissions`, submit), s1);
    check('H09 actual immutable submission search and single audit', (await search(brand, '&q=HTTP_SUBMITTED_ANSWER')).total === 1 && (await audit(admin, '&task=' + taskId + '&status=submission.created')).total === 1, ['AC-14-03']);
    type Completion = Awaited<ReturnType<CompletionService['workspace']>>;
    const w = await admin.get<Completion>(`/api/completion?taskId=${taskId}`), complete = { command: 'complete', taskId, expectedTaskRevision: w.taskRevision, expectedBasisHash: w.preview!.basisHash, memo: 'HTTP_COMPLETION_MEMO', idempotencyKey: randomUUID() }, c1 = await admin.ok<{
        ids: string[];
    }>('/api/completion', complete);
    completionId = c1.ids[0];
    assert.deepEqual(await admin.ok('/api/completion', complete), c1);
    check('H10 unresolved-independent manual completion searchable and idempotent', (await search(brand, '&q=HTTP_COMPLETION_MEMO&mode=history')).total === 1 && (await audit(admin, '&task=' + taskId + '&status=task.manually_completed')).total === 1, ['AC-14-03']);
    const external = { command: 'record_external', taskId, expectedTaskRevision: (await td(taskId)).task.revision, idempotencyKey: randomUUID(), action: { purpose: 'review_request', destination: 'HTTP_DESTINATION', requester: { kind: 'user', userId: 'user-luna' }, performer: { kind: 'external', label: '합성 수행자', source: '수동' }, source: { requestId: workspace.request.id, submissionId: null, submissionContentHash: null, fileVersionIds: [], productUseIds: [] }, observedAt: { value: '2026-09-21', precision: 'date', timezone: 'Asia/Tokyo', source: '합성' }, evidenceFileVersionIds: [], latestProgress: 'HTTP_EXTERNAL_WAIT', waitingExternal: true, visibility: 'public' } };
    const ex = await admin.ok('/api/completion', external);
    assert.deepEqual(await admin.ok('/api/completion', external), ex);
    check('H11 actual external record single audit separate from complete', (await audit(admin, '&task=' + taskId + '&status=external.action_recorded')).total === 1 && (await search(brand, '&q=HTTP_EXTERNAL_WAIT')).total === 1, ['AC-14-03']);
    const book = new ExcelJS.Workbook(), sheet = book.addWorksheet('합성'), keys = ['contextKey', 'common.code', 'common.name', 'internal.supplyAmount', 'internal.currency'];
    sheet.addRow(keys);
    sheet.addRow([A, 'HTTP_PRIVATE_IMPORT', 'HTTP_IMPORT_CANARY', '1200', 'JPY']);
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(await book.xlsx.writeBuffer())], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'HTTP_PRIVATE_FILE.xlsx');
    const inspected = await (await price.form('/api/imports/source?context=' + A, form)).json() as WorkbookInspection;
    const preview = await price.ok<ImportPreview>('/api/imports/preview', { sourceId: inspected.sourceId, sheetId: inspected.sheets[0].id, headerRow: 1, mapping: keys.map((field, i) => ({ column: i + 1, field })), choices: [] });
    assert(preview.canApply);
    const auditBefore = await audit(gsg), apply = { previewId: preview.id, idempotencyKey: randomUUID() }, applied = await price.ok('/api/imports/apply', apply);
    assert.deepEqual(await price.ok('/api/imports/apply', apply), applied);
    check('H12 private import batch and row events excluded before options count', JSON.stringify(await audit(gsg)) === JSON.stringify(auditBefore) && (await search(gsg, '&q=HTTP_PRIVATE_FILE')).total === 0 && (await audit(price, '&status=import.applied')).total === 1, ['AC-14-03', 'A19']);
    const inquiry = await brand.ok<{
        conversationId: string;
        revision: number;
    }>('/api/inquiries', { contextId: A, taskId: null, idempotencyKey: randomUUID() });
    await brand.ok(`/api/inquiries/${inquiry.conversationId}`, { command: 'publish_first', expectedRevision: inquiry.revision, title: 'HTTP_PRIVATE_INQUIRY', content: { clientMessageId: randomUUID(), body: 'HTTP_PRIVATE_INQUIRY_BODY', fileVersionIds: [] }, idempotencyKey: randomUUID() });
    check('H13 same-context other brand has no private inquiry existence', (await search(brand, '&q=HTTP_PRIVATE_INQUIRY_BODY')).total === 1 && (await search(team, '&q=HTTP_PRIVATE_INQUIRY_BODY')).total === 0);
    const notifications = await brand.get('/api/notifications' + q);
    await search(brand);
    await audit(admin);
    await brand.get('/api/search/contexts');
    check('H14 read search audit contexts cause no notification sync/read', JSON.stringify(await brand.get('/api/notifications' + q)) === JSON.stringify(notifications), ['A19']);
    const members = await admin.get<{
        members: {
            id: string;
            revision: number;
            data: {
                userId: string;
            };
        }[];
    }>(`/api/contexts/${A}/members`), member = members.members.find(m => m.data.userId === 'user-team')!;
    await admin.ok(`/api/contexts/${A}/members/${member.id}`, { expectedRevision: member.revision, status: 'suspended' }, 'PATCH');
    check('H15 current revoke denies prior history and query neutrally', (await team.send('/api/search' + q)).status === 404 && (await team.send(`/api/search/history${q}&kind=productVersion&id=${oldId}`)).status === 404, ['D04', 'A19']);
    const current = await pd(productId), intents = ['RACE_ONE', 'RACE_TWO'].map(name => ({ command: 'save_common', contextId: A, expectedCommonRevision: current.commonRevision, common: { ...current.common, name }, idempotencyKey: randomUUID() }));
    let writer = brand;
    if (mode === 'sqlite') {
        await start(aux);
        writer = new Client(aux);
        await writer.login('luna@example.test');
    }
    const race = await Promise.all([brand.mutate(`/api/products/${productId}`, intents[0]), writer.mutate(`/api/products/${productId}`, intents[1])]);
    check('H16 two concurrent writers one commit one409', race.filter(r => r.status === 200).length === 1 && race.filter(r => r.status === 409).length === 1, ['AC-14-02']);
    const latest = await pd(productId), loser = intents[race.findIndex(r => r.status === 409)];
    await brand.ok(`/api/products/${productId}`, { ...loser, expectedCommonRevision: latest.commonRevision, idempotencyKey: randomUUID() });
    check('H17 retained loser explicit latest reapply', (await pd(productId)).common.name === loser.common.name, ['AC-14-02']);
    if (mode === 'sqlite')
        await stop(aux);
    const privateEvent = (await audit(price, '&status=product.save_internal')).items[0];
    check('H18 exact hidden audit direct ID denied to nonprice', (await gsg.send(`/api/audit/${privateEvent.id}${q}`)).status === 404, ['A19']);
    const content = { ...blankNotice(), title: 'HTTP_FILE_NOTICE', body: '원본 권한 검증' }, noticeId = (await admin.ok<{
        ids: string[];
    }>('/api/notices', { contextId: A, content, idempotencyKey: randomUUID() })).ids[0];
    const uploadForm = new FormData(), originalBytes = Buffer.from('item,value\nsynthetic,G14\n');
    uploadForm.append('files', new Blob([new Uint8Array(originalBytes)], { type: 'text/csv' }), 'HTTP_FILENAME.csv');
    uploadForm.append('visibility', 'public');
    const uploaded = await (await admin.form('/api/files?noticeId=' + noticeId, uploadForm)).json() as {
        files: {
            id: string;
        }[];
    }, fileId = uploaded.files[0].id;
    const n = () => admin.get<NoticeDetail>('/api/notices/' + noticeId);
    await admin.ok('/api/notices/' + noticeId, { command: 'save', expectedRevision: (await n()).revision, content: { ...content, fileIds: [fileId] }, idempotencyKey: randomUUID() });
    await admin.ok('/api/notices/' + noticeId, { command: 'publish', expectedRevision: (await n()).revision, idempotencyKey: randomUUID() });
    const p = await pd(productId);
    await brand.ok('/api/products/' + productId, { contextId: A, command: 'save_files', expectedContextRevision: p.contextRevision, files: [blankFileBinding('http-binding', fileId)], idempotencyKey: randomUUID() });
    const fileSearch = await search(brand, '&q=HTTP_FILENAME&mode=history'), fileHit = fileSearch.items.find(x => x.sourceKind === 'contextProductVersion')!;
    assert(fileHit);
    const detail = await brand.get<SearchDetail>('/api/search/history' + q + '&kind=' + fileHit.sourceKind + '&id=' + fileHit.sourceId), download = await brand.send(detail.files[0].downloadUrl);
    check('H25 actual filename original plus reference read and bytes', fileSearch.total > 0 && download.status === 200 && hash(Buffer.from(await download.arrayBuffer())) === hash(originalBytes), ['A19']);
    await admin.ok('/api/notices/' + noticeId, { command: 'save', expectedRevision: (await n()).revision, content: { ...content, fileIds: [fileId], audience: { mode: 'selected', userIds: [] } }, idempotencyKey: randomUUID() });
    await admin.ok('/api/notices/' + noticeId, { command: 'publish', expectedRevision: (await n()).revision, idempotencyKey: randomUUID() });
    check('H26 current origin revoke removes filename and authenticated download', (await search(brand, '&q=HTTP_FILENAME&mode=history')).total === 0 && (await brand.send(detail.files[0].downloadUrl)).status === 404 && (await pd(productId)).productId === productId, ['D04', 'A19']);
    if (mode === 'sqlite') {
        const priorAudit = await audit(admin, '&task=' + taskId), priorSearch = await search(brand, '&task=' + taskId + '&mode=history'), pid = processes.findLast(p => p.port === port)!.pid;
        await stop(port);
        await start();
        admin.cookie = '';
        brand.cookie = '';
        await admin.login('admin@example.test');
        await brand.login('luna@example.test');
        check('H19 new PID relogin preserves exact audit and source history', pid !== processes.findLast(p => p.port === port)!.pid && JSON.stringify(await audit(admin, '&task=' + taskId)) === JSON.stringify(priorAudit) && JSON.stringify(await search(brand, '&task=' + taskId + '&mode=history')) === JSON.stringify(priorSearch), ['AC-14-03', 'AC-14-04']);
        const db = openDatabase(database), rows = db.prepare("SELECT kind,id,data FROM records WHERE kind IN ('audit','commandReceipt','requestVersion','submission','completionSnapshot') ORDER BY kind,id").all();
        writeFileSync(`${report}.durable-records.json`, JSON.stringify(rows, null, 2));
        check('H20 actual DB receipt event relationships survived', priorAudit.items.filter(i => i.correlation === 'recorded').every(i => !!i.receiptId && !!db.prepare("SELECT id FROM records WHERE kind='commandReceipt' AND id=?").get(i.receiptId)), ['AC-14-03']);
        const baseline = db.prepare("SELECT * FROM records WHERE kind='audit' ORDER BY id").all();
        let refused = false;
        try {
            db.prepare("UPDATE records SET revision=revision+1 WHERE kind='audit'").run();
        }
        catch {
            refused = true;
        }
        check('H21 persisted audit SQL append-only', refused && JSON.stringify(db.prepare("SELECT * FROM records WHERE kind='audit' ORDER BY id").all()) === JSON.stringify(baseline), ['AC-14-03']);
        db.close();
        const repo = createSqliteRepository(openDatabase(database));
        const common = (await repo.get('product', productId))!.data.currentVersionId!, original = (await repo.get('productVersion', common))!;
        // Append a permitted unknown extension to mutable root, keeping immutable versions unchanged.
        await repo.transaction(async (s) => { const root = (await s.get('product', productId))!; (await s.update('product', root.id, root.revision, { ...root.data, extra: { canary: 'HTTP_UNKNOWN_CANARY' } } as typeof root.data)); });
        check('H22 unknown persisted extension has no search influence', (await search(brand, '&q=HTTP_UNKNOWN_CANARY&mode=history')).total === 0 && JSON.stringify(await repo.get('productVersion', common)) === JSON.stringify(original), ['A19']);
        const base = (await repo.list('audit')).find(r => r.data.targetId === productId)!, bad = randomUUID();
        await repo.transaction(async (s) => (await s.create('audit', { id: bad, contextId: A, data: { ...base.data, detail: { ...base.data.detail!, changes: [{ key: 'name', before: null, after: { secret: 'HTTP_KNOWN_CANARY' } }] } } as unknown as typeof base.data })));
        const stored = await repo.get('audit', bad), error = await admin.send(`/api/audit/${bad}${q}`);
        check('H23 malformed known audit scalar explicit503 no leak no rewrite', error.status === 503 && !(await error.text()).includes('HTTP_KNOWN_CANARY') && JSON.stringify(await repo.get('audit', bad)) === JSON.stringify(stored), ['A19']);
        repo.close();
        check('H24 two distinct simultaneous OS servers and all owned resources tracked', processes.some(p => p.port === aux) && processes.filter(p => p.port === port).length === 2, ['AC-14-02', 'AC-14-03']);
    }
    else
        for (let n = 19; n <= 24; n++)
            checks.push({ id: `H${n} SQLite durable only`, status: 'SKIP', requirements: ['AC-14-03'], reason: 'Mock is process-local; actual SQLite covers cross-process persistence and stored SQL fixtures.' });
}
catch (e) {
    failure = e instanceof Error ? e.stack : String(e);
    process.exitCode = 1;
}
finally {
    for (const p of [...children.keys()])
        await stop(p);
    writeFileSync(report, JSON.stringify({ candidate, cwd, mode, directory, database, files, startedAt, endedAt: new Date().toISOString(), normalProductionStartup: true, providerCalls: 0, checks, counts: { unit: 'assertion', pass: checks.filter(c => c.status === 'PASS').length, fail: checks.filter(c => c.status === 'FAIL').length, skip: checks.filter(c => c.status === 'SKIP').length, executionFailure: failure && !checks.some(c => c.status === 'FAIL') ? 1 : 0 }, notRun: planned.filter(id => !checks.some(c => c.id.split(' ')[0] === id)), failure, transcript, processes, fixtureIds: { taskId, submissionId, completionId, productId } }, null, 2));
    console.log(JSON.stringify({ report, pass: checks.filter(c => c.status === 'PASS').length, fail: checks.filter(c => c.status === 'FAIL').length, failure }));
}
