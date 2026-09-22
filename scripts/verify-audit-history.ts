/** Filesystem copy of historical DB/sidecars/files always precedes the first SQLite open. */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir, readdir, copyFile, stat } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import path from 'node:path';
import { openDatabase, migrate } from '@/server/db/database';
import { createSqliteRepository } from '@/server/repositories/sqlite';
import { seed } from '@/server/db/seed';
import { IdentityService } from '@/server/auth/service';
import { ProductService } from '@/server/products/service';
import { TaskService } from '@/server/tasks/service';
import { blankContent, blankRequirement } from '@/domain/tasks/types';
import { DEMO_PASSWORD } from '@/domain/catalog';
import type { SearchList, SearchDetail } from '@/domain/search/types';
import type { AuditList } from '@/domain/audit/view';
const [label, originalDb, originalFiles, destination] = process.argv.slice(2);
assert(label && originalDb && originalFiles && destination);
const cwd = process.cwd(), candidate = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), port = Number(process.env.E2E_PORT ?? 4255), origin = `http://127.0.0.1:${port}`, database = path.join(destination, 'copy.db'), files = path.join(destination, 'files'), hash = (b: string | Buffer) => createHash('sha256').update(b).digest('hex');
const copies: {
    source: string;
    copy: string;
    sha256: string;
    bytes: number;
}[] = [], checks: {
    id: string;
    status: 'PASS' | 'FAIL';
    requirements: string[];
}[] = [], responses: {
    url: string;
    status: number;
    path: string;
    sha256: string;
}[] = [], processes: {
    pid?: number;
    argv: string[];
    cwd: string;
    log: string;
    stopped?: boolean;
    exitCode?: number | null;
    signal?: string | null;
}[] = [];
let child: ChildProcess | undefined, closed: Promise<void> | undefined, db: ReturnType<typeof openDatabase> | null = null, failure: string | undefined, firstOpenAt: string | undefined, copyCompletedAt: string | undefined;
const facts: Record<string, unknown> = {};
const planned = ['copy-first', 'prior-populated', 'old-sql-ledger-preserved', 'migration16', 'old-rows-unchanged', 'repeat-noop', 'seed-old-rows-preserved', 'legacy-no-backfill', 'actual-sixmonth-producers', 'pid1-login', 'pid1-history', 'pid1-audit', 'pid1-file', 'new-pid', 'pid2-login', 'pid2-history', 'pid2-audit', 'pid2-file', 'old-business-immutable', 'original-bytes-unchanged'];
function check(id: string, ok: unknown, requirements = ['AC-14-03', 'AC-14-04', 'A20']) { checks.push({ id, status: ok ? 'PASS' : 'FAIL', requirements }); assert(ok, id); }
async function copy(source: string, target: string) { const b = await readFile(source); await mkdir(path.dirname(target), { recursive: true }); await copyFile(source, target); assert.equal(hash(await readFile(target)), hash(b)); copies.push({ source, copy: target, sha256: hash(b), bytes: b.length }); }
async function tree(source: string, target: string) { await mkdir(target, { recursive: true }); for (const f of await readdir(source, { withFileTypes: true })) {
    if (f.isDirectory())
        await tree(path.join(source, f.name), path.join(target, f.name));
    else if (f.isFile())
        await copy(path.join(source, f.name), path.join(target, f.name));
} }
async function start() { await new Promise<void>((resolve, reject) => { const s = createServer(); s.once('error', reject); s.listen(port, '127.0.0.1', () => s.close(e => e ? reject(e) : resolve())); }); const argv = ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(port)], log = path.join(destination, `server-${processes.length + 1}.log`), out = createWriteStream(log); child = spawn(process.execPath, argv, { cwd, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, DATA_SOURCE: 'sqlite', DATABASE_FILE: database, FILE_STORAGE_DIR: files, IMPORT_STORAGE_DIR: path.join(destination, 'imports'), APP_ORIGIN: origin, SESSION_COOKIE_NAME: `gs_hale_g14_history_${port}`, OPENAI_API_KEY: '', OPENAI_MODEL: '', OPENAI_BASE_URL: 'https://api.openai.com/v1', NEXT_TELEMETRY_DISABLED: '1' } }); const c = child; processes.push({ pid: c.pid, cwd, argv: [process.execPath, ...argv], log }); c.stdout!.pipe(out, { end: false }); c.stderr!.pipe(out, { end: false }); closed = new Promise(r => c.once('close', (exitCode, signal) => { Object.assign(processes.find(p => p.pid === c.pid)!, { stopped: true, exitCode, signal }); out.end(); r(); })); for (let i = 0; i < 200; i++) {
    if (c.exitCode !== null)
        throw Error('own server exited');
    try {
        if ((await fetch(origin + '/api/health')).ok)
            return c.pid;
    }
    catch { }
    await new Promise(r => setTimeout(r, 50));
} throw Error('readiness'); }
async function stop() { if (child && child.exitCode === null)
    child.kill('SIGTERM'); await closed; child = undefined; }
let cookie = '';
async function request(url: string, body?: unknown): Promise<Buffer> { const csrf = body === undefined ? '' : JSON.parse((await request('/api/auth/csrf')).toString()).csrfToken, r = await fetch(origin + url, { method: body === undefined ? 'GET' : 'POST', headers: { Cookie: cookie, ...body !== undefined ? { 'Content-Type': 'application/json', Origin: origin, 'X-CSRF-Token': csrf } : {} }, body: body === undefined ? undefined : JSON.stringify(body) }); if (r.headers.get('set-cookie'))
    cookie = r.headers.get('set-cookie')!.split(';')[0]; const b = Buffer.from(await r.arrayBuffer()), file = path.join(destination, 'responses', `${responses.length + 1}.body`); await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, b); responses.push({ url, status: r.status, path: file, sha256: hash(b) }); assert.equal(r.status, 200, b.toString().slice(0, 300)); return b; }
type Row = {
    kind: string;
    id: string;
    context_id: string | null;
    data: string;
    revision: number;
};
try {
    await mkdir(destination, { recursive: false });
    for (const suffix of ['', '-wal', '-shm']) {
        try {
            await stat(originalDb + suffix);
        }
        catch (e) {
            if ((e as NodeJS.ErrnoException).code === 'ENOENT')
                continue;
            throw e;
        }
        await copy(originalDb + suffix, database + suffix);
        await copy(originalDb + suffix, path.join(destination, 'pristine', 'database' + suffix));
    }
    if (originalFiles === '-')
        await mkdir(files);
    else
        await tree(originalFiles, files);
    copyCompletedAt = new Date().toISOString();
    firstOpenAt = new Date().toISOString();
    db = openDatabase(database);
    check('copy-first', copies.length >= 2 && copyCompletedAt <= firstOpenAt);
    const before = db.prepare('SELECT * FROM records ORDER BY kind,id').all() as Row[], ledger = db.prepare('SELECT * FROM schema_migrations ORDER BY name').all() as {
        name: string;
        sha256: string;
    }[];
    check('prior-populated', before.length > 50 && ledger.length >= 10 && ledger.length <= 14);
    const migration = migrate(db), afterLedger = db.prepare('SELECT * FROM schema_migrations ORDER BY name').all() as {
        name: string;
        sha256: string;
    }[];
    check('old-sql-ledger-preserved', JSON.stringify(afterLedger.filter(a => ledger.some(b => b.name === a.name))) === JSON.stringify(ledger));
    check('migration16', migration.applied === 16 - ledger.length && migration.total === 16 && afterLedger.at(-1)?.name === '0016-audit.sql' && afterLedger.some(x => x.name === '0015-ai-provider.sql'));
    check('old-rows-unchanged', JSON.stringify(db.prepare('SELECT * FROM records ORDER BY kind,id').all()) === JSON.stringify(before));
    const repeat = migrate(db);
    check('repeat-noop', repeat.applied === 0 && repeat.total === 16);
    let now = '2026-01-01T10:00:00.000Z';
    const repo = createSqliteRepository(db, () => now);
    const seedResult = await seed(repo), rowMap = new Map((db.prepare('SELECT * FROM records ORDER BY kind,id').all() as Row[]).map(r => [r.kind + ':' + r.id, r]));
    check('seed-old-rows-preserved', before.every(r => JSON.stringify(rowMap.get(r.kind + ':' + r.id)) === JSON.stringify(r)));
    const oldAudit = before.filter(r => r.kind === 'audit');
    check('legacy-no-backfill', oldAudit.length > 0 && oldAudit.every(r => JSON.stringify(rowMap.get(r.kind + ':' + r.id)) === JSON.stringify(r)));
    const id = new IdentityService(repo, () => now), login = await id.login(undefined, { email: 'selected@example.test', password: DEMO_PASSWORD }), products = new ProductService(id), tasks = new TaskService(id), A = 'ctx-jp-a-luna';
    const pid = (await products.create(login.token, { contextId: A, brandId: 'brand-luna', common: { name: 'SIX_MONTH_PRODUCT_ORIGINAL', code: randomUUID() }, idempotencyKey: randomUUID() })).ids[0], version = (await repo.get('product', pid))!.data.currentVersionId!, content = { ...blankContent(), title: 'SIX_MONTH_TASK_ORIGINAL', description: 'SIX_MONTH_BODY_ORIGINAL', deadline: { ...blankContent().deadline, responsibleUserId: 'user-gsg' }, requirements: [{ ...blankRequirement('a'), label: '과거 실제 요청' }] };
    // Historical evidence can contain legitimate membership revocations. Select a
    // currently eligible fixture assignee through the real catalog; never reactivate
    // or rewrite copied original memberships to make a test pass.
    const catalog = await tasks.catalog(login.token, A), assignee = catalog.members.find(m => m.role === 'brand');
    assert(assignee, 'copied context has an active brand assignee');
    const tid = (await tasks.create(login.token, { category: 'spot', content, targets: [{ contextId: A, ownerId: 'user-gsg', assigneeId: assignee.id, coAssigneeIds: [], productIds: [pid] }], idempotencyKey: randomUUID() })).ids[0];
    await tasks.command(login.token, tid, { command: 'publish', expectedRevision: 1, idempotencyKey: randomUUID() });
    const requestId = (await repo.get('task', tid))!.data.currentRequestId!;
    now = new Date().toISOString();
    const currentAdmin = await id.login(undefined, { email: 'admin@example.test', password: DEMO_PASSWORD }), product = await products.detail(currentAdmin.token, pid, A);
    await products.command(currentAdmin.token, pid, { contextId: A, command: 'save_common', expectedCommonRevision: product.commonRevision, common: { ...product.common, name: 'CURRENT_DIFFERENT_PRODUCT' }, idempotencyKey: randomUUID() });
    await tasks.command(currentAdmin.token, tid, { command: 'save', expectedRevision: (await repo.get('task', tid))!.revision, content: { ...content, title: 'CURRENT_DIFFERENT_TASK', description: 'CURRENT_DIFFERENT_BODY' }, idempotencyKey: randomUUID() });
    await tasks.command(currentAdmin.token, tid, { command: 'publish', expectedRevision: (await repo.get('task', tid))!.revision, idempotencyKey: randomUUID() });
    const oldActor = (await repo.get('user', 'user-selected-admin'))!;
    await id.setUserStatus(currentAdmin.token, oldActor.id, { expectedRevision: oldActor.revision, status: 'suspended' });
    check('actual-sixmonth-producers', (await repo.get('productVersion', version))!.data.changedAt === '2026-01-01T10:00:00.000Z' && (await repo.get('requestVersion', requestId))!.data.publishedBy === 'user-selected-admin');
    facts.beforeRows = before.length;
    facts.beforeRowsSha256 = hash(JSON.stringify(before));
    facts.ledger = ledger;
    facts.migration = migration;
    facts.seed = seedResult;
    facts.actualSyntheticSixMonth = { productId: pid, version, taskId: tid, requestId, actor: 'user-selected-admin', assigneeId: assignee.id, productionClock: '2026-01-01T10:00:00.000Z', realOperationalRetention: false };
    await writeFile(path.join(destination, 'before-records-private.json'), JSON.stringify(before, null, 2));
    const historicalFile = before.find(r => r.kind === 'fileVersion' && JSON.parse(r.data).taskId), fileData = historicalFile ? JSON.parse(historicalFile.data) : null;
    repo.close();
    db = null;
    let firstHistory = '', firstAudit = '', lastPid: number | undefined;
    for (let round = 1; round <= 2; round++) {
        const newPid = await start();
        if (round === 2)
            check('new-pid', newPid !== lastPid);
        lastPid = newPid;
        cookie = '';
        await request('/api/auth/login', { email: 'admin@example.test', password: DEMO_PASSWORD });
        check(`pid${round}-login`, !!cookie);
        const result = (await request(`/api/search?context=${A}&mode=history&q=SIX_MONTH&to=2026-01-02&actor=user-selected-admin`)).toString(), found = JSON.parse(result) as SearchList;
        check(`pid${round}-history`, found.items.some(x => x.sourceId === version) && found.items.some(x => x.sourceId === requestId) && found.items.every(x => x.actor.id === 'user-selected-admin' && x.actor.label === '이전 작성자') && (round === 1 || firstHistory === result));
        if (round === 1)
            firstHistory = result;
        const exact = JSON.parse((await request(`/api/search/history?context=${A}&kind=requestVersion&id=${requestId}`)).toString()) as SearchDetail;
        assert(exact.fields.some(f => f.value === 'SIX_MONTH_BODY_ORIGINAL'));
        assert(!JSON.stringify(exact).includes('CURRENT_DIFFERENT_BODY'));
        const audit = (await request(`/api/audit?context=${A}&actor=user-selected-admin&to=2026-01-02`)).toString(), events = JSON.parse(audit) as AuditList;
        check(`pid${round}-audit`, events.items.some(x => x.target.id === tid) && events.items.some(x => x.target.id === pid) && events.items.every(x => x.actor.id === 'user-selected-admin' && x.actor.label === '이전 작성자') && (round === 1 || audit === firstAudit));
        if (round === 1)
            firstAudit = audit;
        if (historicalFile) {
            const bytes = await request(`/api/files/${historicalFile.id}?taskId=${fileData.taskId}&mode=original`);
            check(`pid${round}-file`, hash(bytes) === fileData.sha256);
        }
        else
            check(`pid${round}-file`, originalFiles === '-');
        await stop();
    }
    db = openDatabase(database);
    const business = new Map((db.prepare('SELECT * FROM records ORDER BY kind,id').all() as Row[]).map(r => [r.kind + ':' + r.id, r]));
    const intentionallyChanged = before.filter(r => r.kind === 'user' && r.id === 'user-selected-admin' || r.kind === 'task' && (() => { const d = JSON.parse(r.data); return d.status !== 'completed' && (d.assigneeId === 'user-selected-admin' || d.ownerId === 'user-selected-admin' || d.coAssigneeIds?.includes('user-selected-admin')); })()).map(r => r.kind + ':' + r.id);
    const originalBusiness = before.filter(r => !['session', 'throttle'].includes(r.kind) && !intentionallyChanged.includes(r.kind + ':' + r.id));
    check('old-business-immutable', originalBusiness.every(r => JSON.stringify(business.get(r.kind + ':' + r.id)) === JSON.stringify(r)));
    facts.businessDenominator = { count: originalBusiness.length, excludedKinds: ['session', 'throttle'], intentionallyChangedExactIds: intentionallyChanged, reason: 'Separate intentionally executed actual user suspension/reassignment flags and auth counters; immutable source/audit/file rows remain byte-identical. All rows were strict-identical immediately after migration and seed.' };
    db.close();
    db = null;
    check('original-bytes-unchanged', (await Promise.all(copies.map(async (c) => hash(await readFile(c.source)) === c.sha256))).every(Boolean));
}
catch (e) {
    failure = e instanceof Error ? e.stack : String(e);
    process.exitCode = 1;
}
finally {
    db?.close();
    await stop();
    await writeFile(path.join(destination, 'report.json'), JSON.stringify({ candidate, cwd, label, originalDb, originalFiles, sourceOpened: false, firstOpenAt, copyCompletedAt, copies, checks, counts: { unit: 'assertion', pass: checks.filter(x => x.status === 'PASS').length, fail: checks.filter(x => x.status === 'FAIL').length, executionFailure: failure && !checks.some(x => x.status === 'FAIL') ? 1 : 0 }, notRun: planned.filter(id => !checks.some(x => x.id === id)), failure, facts, responses, processes, providerCalls: 0 }, null, 2));
    console.log(JSON.stringify({ report: path.join(destination, 'report.json'), pass: checks.filter(x => x.status === 'PASS').length, failure }));
}
