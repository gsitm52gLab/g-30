import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, mkdirSync, writeFileSync, createWriteStream } from 'node:fs';
import { parseEnv } from 'node:util';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { chromium, expect, type APIRequestContext } from '@playwright/test';
import { parsePostgresConfig, quoteSchema } from '@/server/postgres/config';
import { createPostgresPool, connect, query } from '@/server/postgres/client';
import { createPostgresRepository } from '@/server/postgres/repository';
import { migratePostgres } from '@/server/postgres/migrate';
import { seed } from '@/server/db/seed';
import { IdentityService } from '@/server/auth/service';
import { ProductService } from '@/server/products/service';
import { SearchService } from '@/server/search/service';
import { AuditService } from '@/server/audit/service';
import { blankInternalPrice } from '@/domain/products/types';
import { appendAudit, auditOperation } from '@/server/audit/writer';
import type { ProductDetail } from '@/server/products/service';
import type { SearchList } from '@/domain/search/types';
import type { AuditList } from '@/domain/audit/view';

// Explicit isolated schema only; never infer or use the production/default schema.
const schema = 'gs_hale_g14_port_20260922', cwd = process.cwd();
const envFile = path.resolve(process.env.GS_HALE_ENV_FILE || '.env');
const hash = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
const envBefore = hash(readFileSync(envFile));
const privateEnv = { ...parseEnv(readFileSync(envFile, 'utf8')), ...process.env, DATA_SOURCE: 'supabase', SUPABASE_DB_SCHEMA: schema };
const config = parsePostgresConfig(privateEnv, 'migration');
const root = path.resolve(process.env.SEARCH_REPORT_DIR || `.local/g14-supabase/${randomUUID()}`);
mkdirSync(root, { recursive: true, mode: 0o700 });
const id = `G14_${randomUUID().replaceAll('-', '')}`, A = 'ctx-jp-a-luna', B = 'ctx-jp-b-luna';
const candidate = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const dirty = !!execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim();
const checks: { id: string; status: 'PASS' | 'FAIL'; ms: number; error?: string }[] = [];
const processes: { pid?: number; port: number; log: string; stopped?: boolean }[] = [];
const servers = new Map<number, ChildProcess>();
const repo = createPostgresRepository(config), second = createPostgresRepository(config);
const identity = new IdentityService(repo), products = new ProductService(identity), search = new SearchService(identity), audit = new AuditService(identity);
const startedAt = new Date().toISOString();
let productId = '', originalVersion = '', auditId = '', admin = '', brand = '', gsg = '', team = '';
let failure: string | undefined;
const errorCode = (e: unknown) => e && typeof e === 'object' && 'code' in e ? String(e.code).replace(/[^A-Z_0-9]/g, '').slice(0, 64) : e instanceof assert.AssertionError ? 'ASSERTION' : 'CHECK_FAILED';
async function check(name: string, fn: () => Promise<void>) {
  const start = performance.now();
  try { await fn(); checks.push({ id: name, status: 'PASS', ms: Math.round(performance.now() - start) }); }
  catch (e) { checks.push({ id: name, status: 'FAIL', ms: Math.round(performance.now() - start), error: errorCode(e) }); throw e; }
  writeFileSync(path.join(root, 'progress.json'), JSON.stringify({ candidate, dirty, schema, id, checks }, null, 2), { mode: 0o600 });
  console.log(JSON.stringify(checks.at(-1)));
}
const params = (extra: Record<string, string> = {}) => new URLSearchParams({ context: A, ...extra });
async function start(port: number) {
  const log = path.join(root, `server-${processes.length + 1}.log`), output = createWriteStream(log, { flags: 'wx', mode: 0o600 });
  const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(port)], { cwd, stdio: ['ignore', 'pipe', 'pipe'], env: { ...privateEnv, APP_ORIGIN: `http://127.0.0.1:${port}`, SESSION_COOKIE_NAME: 'g14_supabase_proof', FILE_STORAGE_DIR: path.join(root, 'files'), IMPORT_STORAGE_DIR: path.join(root, 'imports'), OPENAI_API_KEY: '', OPENAI_MODEL: '', OPENAI_BASE_URL: 'https://api.openai.com/v1', NEXT_TELEMETRY_DISABLED: '1' } });
  child.stdout!.pipe(output, { end: false }); child.stderr!.pipe(output, { end: false }); child.once('close', () => output.end());
  servers.set(port, child); processes.push({ pid: child.pid, port, log });
  for (let n = 0; n < 200; n++) { if (child.exitCode !== null) throw Error('owned server exited'); try { if ((await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1000) })).ok) return; } catch { /* retry readiness only */ } await new Promise(r => setTimeout(r, 100)); }
  throw Error('owned server readiness');
}
async function stop(port: number) { const child = servers.get(port); if (!child) return; if (child.exitCode === null && child.signalCode === null) { const done = new Promise<void>(r => child.once('close', () => r())); child.kill('SIGTERM'); await done; } servers.delete(port); processes.findLast(p => p.pid === child.pid)!.stopped = true; }
async function mutate(r: APIRequestContext, origin: string, url: string, body: unknown) { const c = await r.get(origin + '/api/auth/csrf'); assert.equal(c.status(), 200); return r.post(origin + url, { data: body, headers: { Origin: origin, 'X-CSRF-Token': (await c.json()).csrfToken }, timeout: 120000 }); }
async function login(r: APIRequestContext, origin: string, email: string) { assert.equal((await mutate(r, origin, '/api/auth/login', { email, password: 'Demo-Hale-2026!' })).status(), 200); }
try {
  await check('PG01 additive migrations17 and idempotent seed', async () => { assert.equal((await migratePostgres(config)).total, 17); assert.equal((await migratePostgres(config)).applied, 0); await seed(repo); });
  await check('PG02 real identity and unique product writes', async () => {
    const login = async (email: string) => (await identity.login(undefined, { email, password: 'Demo-Hale-2026!' })).token;
    admin = await login('admin@example.test'); brand = await login('luna@example.test'); gsg = await login('operator@example.test'); team = await login('team@example.test');
    productId = (await products.create(brand, { contextId: A, brandId: 'brand-luna', common: { name: `${id}_OLD`, code: id }, idempotencyKey: randomUUID() })).ids[0];
    originalVersion = (await products.detail(brand, productId, A)).commonVersionId;
    await products.create(admin, { contextId: B, brandId: 'brand-luna', common: { name: `${id}_FOREIGN`, code: `${id}_FOREIGN` }, idempotencyKey: randomUUID() });
  });
  await check('PG03 populated literal search empty result and foreign denial', async () => {
    const result = await search.list(team, params({ q: id, kind: 'product' })); assert.equal(result.total, 1); assert.equal(result.items[0].title, `${id}_OLD`); assert(!JSON.stringify(result).includes('_FOREIGN'));
    assert.equal((await search.list(team, params({ q: `${id}_MISSING` }))).total, 0);
    await assert.rejects(search.list(team, new URLSearchParams({ context: B })), { status: 404 });
  });
  await check('PG04 actual audit receipt replay and exact old history', async () => {
    const before = await products.detail(brand, productId, A), command = { contextId: A, command: 'save_common', expectedCommonRevision: before.commonRevision, common: { ...before.common, name: `${id}_NEW` }, idempotencyKey: randomUUID() };
    const saved = await products.command(brand, productId, command); assert.deepEqual(await products.command(brand, productId, command), saved);
    const detail = await search.detail(team, A, 'productVersion', originalVersion); assert.equal(detail.item.title, `${id}_OLD`); assert.equal(detail.item.sourcePrecision, 'exact_version');
    const result = await audit.list(admin, params({ product: productId, status: 'product.save_common' })); assert.equal(result.total, 1); auditId = result.items[0].id;
    assert.equal(result.items[0].correlation, 'recorded'); assert(await repo.get('commandReceipt', result.items[0].receiptId!));
  });
  await check('PG05 price excluded before search audit count and direct lookup', async () => {
    const before = await audit.list(gsg, params({ product: productId }));
    await products.command(admin, productId, { contextId: A, command: 'save_internal', expectedPriceRevision: 0, price: { ...blankInternalPrice(), supplyAmount: '987654321', currency: 'JPY', source: `${id}_PRIVATE` }, idempotencyKey: randomUUID() });
    assert.deepEqual(await audit.list(gsg, params({ product: productId })), before);
    assert.equal((await search.list(gsg, params({ q: `${id}_PRIVATE` }))).total, 0);
    const privateAudit = await audit.list(admin, params({ product: productId, status: 'product.save_internal' })); assert.equal(privateAudit.total, 1);
    await assert.rejects(audit.detail(gsg, A, privateAudit.items[0].id), { status: 404 });
  });
  await check('PG06 two independent connections CAS one commit and rollback audit', async () => {
    const original = await repo.get('product', productId); assert(original);
    const outcomes = await Promise.allSettled([repo, second].map(r => r.transaction(s => s.update('product', productId, original.revision, original.data))));
    assert.equal(outcomes.filter(o => o.status === 'fulfilled').length, 1); assert.equal(outcomes.filter(o => o.status === 'rejected' && errorCode(o.reason) === 'CONFLICT').length, 1);
    const actor = { user: (await repo.get('user', 'user-admin'))! }, target = `${id}_ROLLBACK`;
    await assert.rejects(repo.transaction(s => auditOperation(s, target, async () => { await appendAudit(s, actor, () => new Date().toISOString(), A, 'context.probe', target, {}, {}); throw new Error('synthetic rollback'); })), /synthetic rollback/);
    assert(!(await repo.list('audit')).some(r => r.data.targetId === target));
  });
  await check('PG07 audit API and SQL immutable update delete', async () => {
    const row = await repo.get('audit', auditId); assert(row);
    await assert.rejects(repo.transaction(s => s.update('audit', row.id, row.revision, row.data)), { code: 'INVALID_RECORD' });
    const pool = createPostgresPool(config), client = await connect(pool);
    try { for (const sql of [`UPDATE ${quoteSchema(schema)}.records SET revision=revision+1 WHERE kind='audit' AND id=$1`, `DELETE FROM ${quoteSchema(schema)}.records WHERE kind='audit' AND id=$1`]) await assert.rejects(query(client, sql, [auditId]), { code: 'INVALID_RECORD' }); } finally { client.release(); await pool.end(); }
    assert.deepEqual(await repo.get('audit', auditId), row);
  });
  const port = 4381, other = 4382, origin = `http://127.0.0.1:${port}`, otherOrigin = `http://127.0.0.1:${other}`;
  await start(port); await start(other);
  const browser = await chromium.launch();
  try {
    for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) await check(`PG08 browser ${viewport.width} search history audit and saved conflict`, async () => {
      const dir = path.join(root, `browser-${viewport.width}`); mkdirSync(dir, { recursive: true });
      const context = await browser.newContext({ viewport, isMobile: viewport.width === 390, hasTouch: viewport.width === 390 });
      await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
      const page = await context.newPage(); page.setDefaultTimeout(120000); page.setDefaultNavigationTimeout(120000);
      try {
        await login(page.request, origin, 'admin@example.test');
        assert.equal((await page.request.get(otherOrigin + '/api/auth/me')).status(), 200, 'same durable session in second process');
        await page.goto(`${origin}/search?${params({ q: id, kind: 'product' })}`);
        await expect(page.locator('[data-search-hit]')).toHaveCount(1);
        await expect(page.locator('[data-search-hit]')).not.toContainText('_FOREIGN');
        await page.goto(`${origin}/search/history?${params({ kind: 'productVersion', id: originalVersion })}`);
        await expect(page.getByRole('article', { name: '선택한 기록' })).toContainText(`${id}_OLD`);
        await page.screenshot({ path: path.join(dir, 'history.png'), fullPage: true });
        await page.goto(`${origin}/products/${productId}?context=${A}`);
        const editor = page.locator('#common'), name = `${id}_${viewport.width}_REAPPLY`;
        await editor.getByRole('textbox', { name: /^상품명\s*\*?$/, exact: true }).fill(name);
        const latest = await products.detail(brand, productId, A);
        await products.command(brand, productId, { contextId: A, command: 'save_common', expectedCommonRevision: latest.commonRevision, common: { ...latest.common, name: `${id}_${viewport.width}_WINNER` }, idempotencyKey: randomUUID() });
        await editor.getByRole('button', { name: '브랜드 공통 정보 저장', exact: true }).click();
        await expect(editor.getByRole('alert')).toBeVisible();
        await expect(editor.getByRole('textbox', { name: /^상품명\s*\*?$/, exact: true })).toHaveValue(name);
        await editor.getByRole('button', { name: '최신 저장값 확인', exact: true }).click();
        await expect(editor).toContainText(`${id}_${viewport.width}_WINNER`);
        await editor.getByRole('button', { name: '입력 유지하고 최신 버전 기준 사용', exact: true }).click();
        await editor.getByRole('button', { name: '브랜드 공통 정보 저장', exact: true }).click();
        await expect(editor.getByRole('status').filter({ hasText: '브랜드 공통 정보를 저장했습니다.' })).toBeVisible();
        assert.equal((await products.detail(brand, productId, A)).common.name, name);
        await page.goto(`${origin}/audit?${params({ product: productId, status: 'product.save_common' })}`);
        await expect(page.locator('[data-g14-view]')).toContainText(name);
        await page.screenshot({ path: path.join(dir, 'audit.png'), fullPage: true });
      } finally { await context.tracing.stop({ path: path.join(dir, 'trace.zip') }); await context.close(); }
    });
    await check('PG09 restarted server relogin retains exact search and audit', async () => {
      const context = await browser.newContext();
      try {
        await login(context.request, origin, 'admin@example.test');
        const s = async () => { const r = await context.request.get(`${origin}/api/search?${params({ product: productId, mode: 'history' })}`, { timeout: 120000 }); assert.equal(r.status(), 200); return await r.json() as SearchList; };
        const a = async () => { const r = await context.request.get(`${origin}/api/audit?${params({ product: productId })}`, { timeout: 120000 }); assert.equal(r.status(), 200); return await r.json() as AuditList; };
        const before = { search: await s(), audit: await a() }; await stop(port); await start(port); await context.clearCookies(); await login(context.request, origin, 'admin@example.test');
        assert.deepEqual(await s(), before.search); assert.deepEqual(await a(), before.audit);
        const value = await context.request.get(`${origin}/api/products/${productId}?context=${A}`); assert.equal(value.status(), 200); const saved = await value.json() as ProductDetail; assert(saved.common.name.endsWith('_390_REAPPLY'));
      } finally { await context.close(); }
    });
  } finally { await browser.close(); }
  await check('PG10 current membership revoke denies historical and count', async () => {
    const member = (await repo.list('membership')).find(r => r.contextId === A && r.data.userId === 'user-team'); assert(member);
    await identity.setMembership(admin, A, member.id, { expectedRevision: member.revision, status: 'suspended' });
    try { await assert.rejects(search.list(team, params({ q: id })), { status: 404 }); await assert.rejects(search.detail(team, A, 'productVersion', originalVersion), { status: 404 }); }
    finally { const current = await repo.get('membership', member.id); assert(current); await identity.setMembership(admin, A, member.id, { expectedRevision: current.revision, status: 'active' }); }
  });
} catch (e) { failure = errorCode(e); process.exitCode = 1; }
finally {
  for (const port of [...servers.keys()]) await stop(port);
  await repo.close(); await second.close();
  const envUnchanged = hash(readFileSync(envFile)) === envBefore; if (!envUnchanged) process.exitCode = 1;
  const report = { candidate, dirty, cwd, schema, id, startedAt, finishedAt: new Date().toISOString(), checks, failure, processes, counts: { pass: checks.filter(x => x.status === 'PASS').length, fail: checks.filter(x => x.status === 'FAIL').length }, envUnchanged, fixtureIds: { productId, originalVersion, auditId }, dataDeleted: 0, externalLlmCalls: 0, limitations: ['Author validation only; separate independent verification required.', 'Synthetic PostgreSQL records retained. Local file mode; Storage application integration not tested.'] };
  writeFileSync(path.join(root, 'report.json'), JSON.stringify(report, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ report: path.join(root, 'report.json'), counts: report.counts, failure, envUnchanged }));
}
