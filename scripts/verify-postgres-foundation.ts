import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { execFileSync } from 'node:child_process';
import { parsePostgresConfig, quoteSchema } from '@/server/postgres/config';
import { begin, connect, createPostgresPool } from '@/server/postgres/client';
import { createPostgresRepository } from '@/server/postgres/repository';
import { migratePostgres, readMigrations } from '@/server/postgres/migrate';
import { seedPostgres, type SeedRecord } from '@/server/postgres/seed';
import { safePostgresError } from '@/server/postgres/errors';
import type { AsyncUnitOfWork } from '@/server/postgres/types';
import mappings from '@/server/postgres/migrations/source-map.json';

const envFile = process.argv[2], evidenceFile = process.argv[3];
if (!envFile || !evidenceFile) throw new Error('Usage: verify-postgres-foundation.ts ENV_FILE NEW_EVIDENCE_FILE');
const envBytes = readFileSync(envFile), beforeHash = createHash('sha256').update(envBytes).digest('hex');
const config = parsePostgresConfig({ ...parseEnv(envBytes.toString()), SUPABASE_DB_SCHEMA: 'gs_hale_sb_foundation_20260922' }, 'migration');
const schema = quoteSchema(config.schema), id = `foundation-${randomUUID()}`;
const plannedCheckCount = 21 + mappings.migrations.reduce((count, migration) => count
  + migration.indexes.filter(name => name !== 'records_kind_context').length
  + migration.triggers.filter(name => !name.endsWith('reference_insert')).length, 0);
const result = {
  started_at: new Date().toISOString(), actual_cwd: process.cwd(), candidate: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  schema: config.schema, fixture_prefix: id, real_supabase: true, strict_tls_required: true, existing_data_deleted: false,
  checks: [] as { name: string; status: 'PASS' | 'FAIL'; error?: string }[],
  inventory: {} as Record<string, unknown>, planned_check_count: plannedCheckCount, infrastructure_errors: [] as string[],
  counts: { pass: 0, fail: 0, skip: 0, not_run: plannedCheckCount }, env_unchanged: false,
};
writeFileSync(evidenceFile, JSON.stringify(result, null, 2), { flag: 'wx', mode: 0o600 });
function save() { writeFileSync(evidenceFile, JSON.stringify(result, null, 2) + '\n', { mode: 0o600 }); }
async function check(name: string, fn: () => Promise<void>) {
  try { await fn(); result.checks.push({ name, status: 'PASS' }); result.counts.pass++; }
  catch (error) { result.checks.push({ name, status: 'FAIL', error: safePostgresError(error).message }); result.counts.fail++; process.exitCode = 1; }
  result.counts.not_run = plannedCheckCount - result.checks.length;
  save();
}
const pool = createPostgresPool(config, 'migration'), repository = createPostgresRepository(config), other = createPostgresRepository(config);
const fixture = (suffix: string, value = 'initial') => ({ id: `${id}-${suffix}`, contextId: null, data: { value } });
try {
  await check('read-only namespace inventory before any mutation', async () => {
    const client = await connect(pool);
    try {
      await begin(client, config, true);
      const tls = (client as unknown as { connection: { stream: { encrypted: boolean; authorized: boolean; getProtocol(): string } } }).connection.stream;
      assert.equal(tls.encrypted, true); assert.equal(tls.authorized, true);
      const namespaces = await client.query('SELECT nspname FROM pg_namespace ORDER BY nspname');
      result.inventory = { existing_namespace_count: namespaces.rowCount, target_preexisted: namespaces.rows.some(r => r.nspname === config.schema), tls_authorized: tls.authorized, tls_protocol: tls.getProtocol() };
      if (result.inventory.target_preexisted) {
        const history = await client.query(`SELECT name FROM ${schema}.schema_migrations`);
        const rows = await client.query(`SELECT kind,id,context_id,data,revision::text AS revision,created_at,updated_at FROM ${schema}.records ORDER BY kind,id`);
        result.inventory.applied_migration_count = history.rowCount;
        result.inventory.record_count = rows.rowCount;
        result.inventory.records_sha256 = createHash('sha256').update(JSON.stringify(rows.rows)).digest('hex');
      } else {
        result.inventory.applied_migration_count = 0;
        result.inventory.record_count = 0;
        result.inventory.records_sha256 = createHash('sha256').update('[]').digest('hex');
      }
      await client.query('COMMIT');
    } finally { client.release(); }
  });
  await check('explicit migrations apply baseline 0001–0015 plus PG-only 0016 atomically', async () => {
    const migration = await migratePostgres(config); assert.equal(migration.total, 16);
    assert.equal(migration.applied, 16 - Number(result.inventory.applied_migration_count));
  });
  if (result.counts.fail) throw new Error('Migrations unavailable');
  await check('additive migration preserves every pre-existing record byte representation', async () => {
    const client = await connect(pool);
    try {
      const rows = await client.query(`SELECT kind,id,context_id,data,revision::text AS revision,created_at,updated_at FROM ${schema}.records ORDER BY kind,id`);
      assert.equal(rows.rowCount, result.inventory.record_count);
      assert.equal(createHash('sha256').update(JSON.stringify(rows.rows)).digest('hex'), result.inventory.records_sha256);
    } finally { client.release(); }
  });
  await check('repeated migrations apply zero', async () => { assert.equal((await migratePostgres(config)).applied, 0); });
  await check('changed applied checksum rejects without changing history', async () => {
    const changed = readMigrations(); changed[0] = { ...changed[0], sql: changed[0].sql + '\n-- changed' };
    changed[0].sha256 = createHash('sha256').update(changed[0].sql).digest('hex');
    await assert.rejects(migratePostgres(config, changed), { code: 'MIGRATION_CHECKSUM' });
    assert.equal((await migratePostgres(config)).applied, 0);
  });
  const contextId = `${id}-context`, userId = `${id}-user`, memberId = `${id}-member`;
  const fixtures: SeedRecord[] = [
    { kind: 'context', input: { id: contextId, contextId: null, data: { country: '합성 일본', retailer: '합성 소매', brand: '합성 브랜드', combinationKey: id } } },
    { kind: 'user', input: { id: userId, contextId: null, data: { name: '합성 담당자', email: `${id}@example.test`, normalizedEmail: `${id}@example.test`, role: 'brand' } } },
    { kind: 'membership', input: { id: memberId, contextId, data: { userId, role: 'brand', status: 'active', scope: 'synthetic', internalPriceAccess: false, activatedAt: null, suspendedAt: null } } },
    { kind: 'checkpoint', input: fixture('seed') },
  ];
  await check('seed inserts missing fixtures and preserves modified revisions/values', async () => {
    assert.deepEqual(await seedPostgres(repository, fixtures), { inserted: 4, preserved: 0 });
    await repository.transaction(async s => { const old = await s.get('checkpoint', `${id}-seed`); assert(old); await s.update('checkpoint', old.id, old.revision, { value: 'user edit' }); });
    assert.deepEqual(await seedPostgres(repository, fixtures), { inserted: 0, preserved: 4 });
    assert.equal((await other.get('checkpoint', `${id}-seed`))?.data.value, 'user edit');
    assert.equal((await other.get('checkpoint', `${id}-seed`))?.revision, 2);
  });
  await check('JSONB unicode, null context, ID ordering and empty result roundtrip', async () => {
    await repository.transaction(async s => { await s.create('checkpoint', fixture('z', '日本語 한국어 😀')); await s.create('checkpoint', fixture('a', '')); });
    assert.equal((await other.get('checkpoint', `${id}-z`))?.data.value, '日本語 한국어 😀');
    const rows = (await other.list('checkpoint')).filter(r => r.id.startsWith(id));
    assert.deepEqual(rows.map(r => r.id), rows.map(r => r.id).sort());
    assert.equal(await other.get('checkpoint', `${id}-absent`), null);
    assert.deepEqual(await other.list('checkpoint', `${id}-absent`), []);
  });
  await check('create/audit/idempotency receipt all rollback on thrown failure', async () => {
    await assert.rejects(repository.transaction(async s => {
      await s.create('checkpoint', fixture('rollback'));
      await s.create('audit', { id: `${id}-audit-rollback`, contextId, data: { actorId: userId, action: 'synthetic', targetId: id, before: {}, after: {}, at: new Date().toISOString() } });
      await s.create('commandReceipt', { id: `${id}-receipt-rollback`, contextId, data: { key: `${id}-receipt`, requestHash: 'synthetic' } as never });
      throw new Error('synthetic failure');
    }), /synthetic failure/);
    for (const [kind, suffix] of [['checkpoint', 'rollback'], ['audit', 'audit-rollback'], ['commandReceipt', 'receipt-rollback']] as const) assert.equal(await other.get(kind, `${id}-${suffix}`), null);
  });
  await check('two independent clients enforce one-winner CAS', async () => {
    await repository.transaction(s => s.create('checkpoint', fixture('cas')));
    let arrived = 0; let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
    const run = (repo: typeof repository, label: string) => repo.transaction(async s => { const old = await s.get('checkpoint', `${id}-cas`); assert(old); if (++arrived === 2) release(); await gate; return s.update('checkpoint', old.id, old.revision, { value: label }); });
    const outcomes = await Promise.allSettled([run(repository, 'one'), run(other, 'two')]);
    assert.equal(outcomes.filter(o => o.status === 'fulfilled').length, 1);
    assert.equal((outcomes.find(o => o.status === 'rejected') as PromiseRejectedResult).reason.code, 'CONFLICT');
    assert.equal((await other.get('checkpoint', `${id}-cas`))?.revision, 2);
  });
  await check('SERIALIZABLE rejects cross-row write skew after shared reads', async () => {
    await repository.transaction(async s => { await s.create('checkpoint', fixture('skew-a')); await s.create('checkpoint', fixture('skew-b')); });
    let arrived = 0; let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
    const run = (repo: typeof repository, own: string) => repo.transaction(async s => {
      const a = await s.get('checkpoint', `${id}-skew-a`), b = await s.get('checkpoint', `${id}-skew-b`); assert(a && b);
      if (++arrived === 2) release(); await gate; return s.update('checkpoint', `${id}-skew-${own}`, 1, { value: 'changed' });
    });
    const outcomes = await Promise.allSettled([run(repository, 'a'), run(other, 'b')]);
    assert.equal(outcomes.filter(o => o.status === 'fulfilled').length, 1);
    assert.equal((outcomes.find(o => o.status === 'rejected') as PromiseRejectedResult).reason.code, 'CONFLICT');
  });
  await check('SERIALIZABLE rejects phantom competing inserts after same list predicate', async () => {
    let arrived = 0; let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
    const run = (repo: typeof repository, own: string) => repo.transaction(async s => {
      await s.list('checkpoint', contextId); if (++arrived === 2) release(); await gate;
      return s.create('checkpoint', { ...fixture(`phantom-${own}`), contextId });
    });
    const outcomes = await Promise.allSettled([run(repository, 'a'), run(other, 'b')]);
    assert.equal(outcomes.filter(o => o.status === 'fulfilled').length, 1);
    assert.equal((outcomes.find(o => o.status === 'rejected') as PromiseRejectedResult).reason.code, 'CONFLICT');
  });
  await check('escaped and unawaited transaction operations cannot commit late', async () => {
    let escaped!: AsyncUnitOfWork;
    await repository.transaction(async s => { escaped = s; });
    await assert.rejects(escaped.create('checkpoint', fixture('escape')), { code: 'ASYNC_TRANSACTION' });
    await assert.rejects(repository.transaction(async s => { void s.create('checkpoint', fixture('unawaited')); }), { code: 'ASYNC_TRANSACTION' });
    assert.equal(await other.get('checkpoint', `${id}-unawaited`), null);
  });
  await check('relation check rejects missing and mismatched membership parents', async () => {
    const membership = fixtures[2]; assert.equal(membership.kind, 'membership');
    await assert.rejects(repository.transaction(s => s.create('membership', { ...membership.input, id: `${id}-invalid-member`, contextId: `${id}-missing` } as never)), { code: 'INVALID_RECORD' });
  });
  await check('caught failed write cannot commit earlier changes', async () => {
    await assert.rejects(repository.transaction(async s => {
      await s.create('checkpoint', fixture('poisoned'));
      try { await s.update('checkpoint', `${id}-absent`, 1, { value: 'missing' }); } catch { /* deliberately caught by application callback */ }
    }), { code: 'NOT_FOUND' });
    assert.equal(await other.get('checkpoint', `${id}-poisoned`), null);
  });
  await check('legacy product context movement only accepts explicit lossless migration contract', async () => {
    const oldData = { name: '합성 세럼', code: 'SYNTHETIC', brand: '합성', size: '30mL', category: 'cosmetic', status: 'draft' as const, missingMaterials: 0 };
    await repository.transaction(s => s.create('product', { id: `${id}-legacy-product`, contextId, data: oldData }));
    const next = { ...oldData, schemaVersion: 2 as const, brandId: 'brand-synthetic', legacyContextId: contextId };
    await assert.rejects(repository.transaction(s => s.update('product', `${id}-legacy-product`, 1, next, { legacyProductContextId: `${id}-wrong` })), { code: 'INVALID_RECORD' });
    const migrated = await repository.transaction(s => s.update('product', `${id}-legacy-product`, 1, next, { legacyProductContextId: contextId }));
    assert.equal(migrated.contextId, null); assert.equal(migrated.revision, 2); assert.equal(migrated.data.name, oldData.name);
    await assert.rejects(repository.transaction(s => s.update('product', migrated.id, migrated.revision, next, { legacyProductContextId: contextId })), { code: 'INVALID_RECORD' });
  });
  const rawClient = await connect(pool);
  try {
    const rawInsert = (kind: string, suffix: string, data: Record<string, unknown>) => rawClient.query(`INSERT INTO ${schema}.records VALUES($1,$2,$3,$4::jsonb,1,$5,$5)`, [kind, `${id}-${suffix}`, contextId, JSON.stringify(data), new Date().toISOString()]);
    await check('BIGINT revisions cross signed 32-bit boundary without losing CAS or metadata', async () => {
      const record = await repository.transaction(s => s.create('checkpoint', fixture('bigint')));
      await rawClient.query(`UPDATE ${schema}.records SET revision=$1::bigint WHERE kind='checkpoint' AND id=$2`, ['2147483647', record.id]);
      assert.equal((await other.get('checkpoint', record.id))?.revision, 2147483647);
      const updated = await repository.transaction(s => s.update('checkpoint', record.id, 2147483647, { value: 'over 32-bit' }));
      assert.equal(updated.revision, 2147483648); assert.equal(updated.createdAt, record.createdAt);
      await assert.rejects(other.transaction(s => s.update('checkpoint', record.id, 2147483647, { value: 'stale' })), { code: 'CONFLICT' });
    });
    await check('MAX_SAFE_INTEGER revision is exact and overflow/fractional writes roll back', async () => {
      const record = await repository.transaction(s => s.create('checkpoint', fixture('max-safe')));
      await rawClient.query(`UPDATE ${schema}.records SET revision=$1::bigint WHERE kind='checkpoint' AND id=$2`, ['9007199254740990', record.id]);
      const max = await repository.transaction(s => s.update('checkpoint', record.id, Number.MAX_SAFE_INTEGER - 1, { value: 'last exact value' }));
      assert.equal(max.revision, Number.MAX_SAFE_INTEGER);
      assert.equal((await other.list('checkpoint')).find(r => r.id === record.id)?.revision, Number.MAX_SAFE_INTEGER);
      await assert.rejects(repository.transaction(s => s.update('checkpoint', record.id, Number.MAX_SAFE_INTEGER, { value: 'must rollback' })), { code: 'INVALID_RECORD' });
      await assert.rejects(repository.transaction(s => s.update('checkpoint', record.id, 1.5, { value: 'invalid' })), { code: 'INVALID_RECORD' });
      await assert.rejects(rawClient.query(`UPDATE ${schema}.records SET revision=$1::bigint WHERE kind='checkpoint' AND id=$2`, ['9007199254740992', record.id]), { code: '23514' });
      const preserved = await other.get('checkpoint', record.id);
      assert.equal(preserved?.revision, Number.MAX_SAFE_INTEGER); assert.equal(preserved?.data.value, 'last exact value');
    });
    for (const map of mappings.migrations) {
      const sql = readFileSync(`src/server/postgres/migrations/${map.name}`, 'utf8');
      for (const index of map.indexes.filter(n => n !== 'records_kind_context')) {
        await check(`SQL unique index rejects duplicate: ${index}`, async () => {
          const line = sql.split('\n').find(l => l.includes(` ${index} `))!;
          const kind = line.match(/WHERE kind\s*=\s*'([^']+)'/)?.[1] || line.match(/WHERE kind IN \('([^']+)'/)?.[1]; assert(kind);
          const data: Record<string, unknown> = { userId, membershipId: memberId };
          for (const match of line.matchAll(/#> '\{([^}]+)\}'/g)) {
            const parts = match[1].split(','); let obj = data;
            for (const part of parts.slice(0, -1)) obj = (obj[part] ||= {}) as Record<string, unknown>;
            obj[parts.at(-1)!] = parts.at(-1) === 'userId' ? userId : parts.at(-1) === 'sequence' || parts.at(-1) === 'position' || parts.at(-1) === 'attempt' ? 1 : `${id}-${index}`;
          }
          await rawClient.query('BEGIN');
          try {
            // Existing seeded membership would collide, which is itself the intended unique identity evidence.
            if (kind === 'membership') await assert.rejects(rawInsert(kind, `index-${index}`, data), { code: '23505' });
            else { await rawInsert(kind, `index-${index}-a`, data); await assert.rejects(rawInsert(kind, `index-${index}-b`, data), { code: '23505' }); }
          } finally { await rawClient.query('ROLLBACK'); }
        });
      }
      for (const trigger of map.triggers.filter(n => !n.endsWith('reference_insert'))) {
        await check(`SQL immutable trigger denies mutation: ${trigger}`, async () => {
          const original = readFileSync(`src/server/db/migrations/${map.name}`, 'utf8');
          const start = original.indexOf(` ${trigger} `), definition = original.slice(start, original.indexOf('END;', start));
          const kind = definition.match(/OLD.kind\s*=\s*'([^']+)'/)?.[1] || definition.match(/OLD.kind IN \('([^']+)'/)?.[1]; assert(kind);
          const deleting = definition.includes('BEFORE DELETE');
          await rawClient.query('BEGIN');
          try {
            await rawInsert(kind, `trigger-${trigger}`, { publishedVersionId: `${id}-published`, value: 'original' });
            await assert.rejects(rawClient.query(deleting ? `DELETE FROM ${schema}.records WHERE kind=$1 AND id=$2` : `UPDATE ${schema}.records SET data='{"value":"changed"}'::jsonb WHERE kind=$1 AND id=$2`, [kind, `${id}-trigger-${trigger}`]), { code: '23514' });
          } finally { await rawClient.query('ROLLBACK'); }
        });
      }
    }
    await check('SQL reference triggers reject missing membership/invitation parent', async () => {
      for (const kind of ['membership', 'invitation']) {
        await rawClient.query('BEGIN');
        try { await assert.rejects(rawInsert(kind, `reference-${kind}`, { userId: 'missing', membershipId: 'missing' }), { code: '23514' }); }
        finally { await rawClient.query('ROLLBACK'); }
      }
    });
    await check('anon and authenticated have no schema or table privileges', async () => {
      const rows = await rawClient.query('SELECT has_schema_privilege($1,$2,\'USAGE\') AS schema,has_table_privilege($1,$3,\'SELECT\') AS table', ['anon', config.schema, `${config.schema}.records`]);
      assert.equal(rows.rows[0].schema, false); assert.equal(rows.rows[0].table, false);
      const second = await rawClient.query('SELECT has_schema_privilege($1,$2,\'USAGE\') AS schema,has_table_privilege($1,$3,\'SELECT\') AS table', ['authenticated', config.schema, `${config.schema}.records`]);
      assert.equal(second.rows[0].schema, false); assert.equal(second.rows[0].table, false);
    });
    await check('server timeout rolls back and same pool recovers', async () => {
      await rawClient.query('BEGIN');
      try { await rawClient.query("SET LOCAL statement_timeout='50ms'"); await assert.rejects(rawClient.query('SELECT pg_sleep(0.2)'), { code: '57014' }); }
      finally { await rawClient.query('ROLLBACK'); }
      assert.equal((await rawClient.query('SELECT 1 AS ok')).rows[0].ok, 1);
    });
  } finally { rawClient.release(); }
  await check('disconnect and recreate independent runtime pool preserves prior data', async () => {
    await other.close(); const reopened = createPostgresRepository(config);
    try { assert.equal((await reopened.get('checkpoint', `${id}-seed`))?.data.value, 'user edit'); }
    finally { await reopened.close(); }
  });
} catch (error) { result.infrastructure_errors.push(safePostgresError(error).message); process.exitCode = 1; }
finally {
  await Promise.allSettled([repository.close(), other.close(), pool.end()]);
  result.env_unchanged = createHash('sha256').update(readFileSync(envFile)).digest('hex') === beforeHash;
  if (!result.env_unchanged) { result.infrastructure_errors.push('ENV_CHANGED'); process.exitCode = 1; }
  if (result.counts.not_run) process.exitCode = 1;
  save(); console.log(JSON.stringify({ status: result.counts.fail || result.counts.not_run || result.infrastructure_errors.length ? 'failed' : 'ok', counts: result.counts, env_unchanged: result.env_unchanged, evidence: evidenceFile }));
}
