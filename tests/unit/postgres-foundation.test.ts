import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parsePostgresConfig, quoteSchema, loadSupabaseCa, CA_SHA256 } from '@/server/postgres/config';
import { safePostgresError } from '@/server/postgres/errors';
import { readMigrations } from '@/server/postgres/migrate';
import { decodeRevision } from '@/server/postgres/revision';
import { checkRelations as asyncRelations } from '@/server/postgres/relations';
import { checkRelations } from '@/domain/constraints';
import { createMockRepository } from '@/server/repositories/mock';
import { fixtures } from '@/data/fixtures';
import type { AsyncUnitOfWork } from '@/server/postgres/types';
import type { RecordInput, RecordKind, StoredRecord, SyncUnitOfWork } from '@/domain/records';
import mappings from '@/server/postgres/migrations/source-map.json';
import relationSources from '@/server/postgres/relations/source-map.json';

const env = {
  SUPABASE_URL: 'https://syntheticproject.supabase.co',
  DATABASE_URL: 'postgresql://postgres.syntheticproject:synthetic%40password@aws-0-ap-northeast-2.pooler.supabase.com:6543/postgres?sslmode=require',
  DIRECT_URL: 'postgresql://postgres.syntheticproject:synthetic%40password@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres',
};
describe('Supabase strict configuration and redaction', () => {
  it('loads pinned valid public CA and keeps verify-full with URI sslmode=require', () => {
    expect(createHash('sha256').update(loadSupabaseCa()).digest('hex')).toBe(CA_SHA256);
    const config = parsePostgresConfig(env, 'migration');
    expect(config.runtime.ssl).toMatchObject({ rejectUnauthorized: true, minVersion: 'TLSv1.2' });
    expect(config.runtime).not.toHaveProperty('connectionString');
    expect(config.runtime.password).toBe('synthetic@password');
    expect(config.runtime.port).toBe(6543); expect(config.migration?.port).toBe(5432);
  });
  it.each([undefined, '', 'malformed', 'https://other.supabase.co', env.SUPABASE_URL + '/rest/v1/', env.SUPABASE_URL + '/arbitrary?key=synthetic'])('SQL configuration is independent of Storage API URL %s', value => {
    const config = parsePostgresConfig({ ...env, SUPABASE_URL: value }, 'migration');
    expect(config.runtime.user).toBe('postgres.syntheticproject');
    expect(config.migration?.user).toBe('postgres.syntheticproject');
  });
  it.each([
    ['DATABASE_URL', undefined], ['DIRECT_URL', undefined],
    ['DATABASE_URL', env.DATABASE_URL.replace(':6543/', ':5432/')],
    ['DIRECT_URL', env.DIRECT_URL.replace(':5432/', ':6543/')],
    ['DATABASE_URL', env.DATABASE_URL.replace('sslmode=require', 'sslmode=disable')],
    ['DATABASE_URL', env.DATABASE_URL + '&sslrootcert=/unsafe'],
    ['DATABASE_URL', env.DATABASE_URL.replace('postgres.syntheticproject', 'postgres')],
    ['DATABASE_URL', env.DATABASE_URL.replace('postgres.syntheticproject', 'postgres.invalid-project')],
    ['DIRECT_URL', env.DIRECT_URL.replace('postgres.syntheticproject', 'postgres.other')],
    ['DATABASE_URL', env.DATABASE_URL.replace('pooler.supabase.com', 'attacker.test')],
    ['DATABASE_URL', env.DATABASE_URL.replace('/postgres?', '/other?')],
    ['SUPABASE_DB_SCHEMA', 'public'], ['SUPABASE_DB_SCHEMA', 'gs_hale; DROP SCHEMA public'],
    ['SUPABASE_POOL_MAX', '0'], ['SUPABASE_POOL_MAX', '21'],
  ])('rejects unsafe/missing %s without echoing it', (field, value) => {
    expect(() => parsePostgresConfig({ ...env, [field!]: value }, 'migration')).toThrow(`Invalid PostgreSQL configuration: ${field}`);
  });
  it('runtime has no DIRECT_URL dependency while migrations require it', () => {
    expect(parsePostgresConfig({ ...env, DIRECT_URL: undefined }).migration).toBeNull();
    expect(parsePostgresConfig({ ...env, DIRECT_URL: 'unusable' }).migration).toBeNull();
    expect(() => parsePostgresConfig({ ...env, DIRECT_URL: undefined }, 'migration')).toThrow('DIRECT_URL');
  });
  it('rejects schema outside the app namespace', () => { expect(() => quoteSchema('auth')).toThrow(); });
  it.each([['23505', 'CONFLICT'], ['40001', 'CONFLICT'], ['40P01', 'CONFLICT'], ['23514', 'INVALID_RECORD'], ['08006', 'STORAGE_UNAVAILABLE']])('redacts driver %s', (code, expected) => {
    const error = safePostgresError({ code, message: env.DATABASE_URL, detail: env.DIRECT_URL });
    expect(error.message).toBe(expected); expect(JSON.stringify(error)).not.toContain('synthetic@password');
    expect(error).not.toHaveProperty('cause');
  });
});
describe('explicit 0001–0015 migration and relation parity inventory', () => {
  it('maps every immutable SQLite source checksum, index and trigger with no silent source drift', () => {
    const migrations = readMigrations(); expect(migrations).toHaveLength(17);
    for (const source of mappings.migrations) {
      const original = readFileSync(path.join('src/server/db/migrations', source.name), 'utf8');
      const target = migrations.find(m => m.name === (source.postgres_name ?? source.name))!;
      expect(createHash('sha256').update(original).digest('hex')).toBe(source.sqlite_sha256);
      expect(target.sha256).toBe(source.postgres_sha256);
      for (const index of source.indexes) expect(target.sql).toContain(`INDEX${target.sql.includes(`INDEX IF NOT EXISTS ${index}`) ? ' IF NOT EXISTS' : ''} ${index} `);
      for (const trigger of source.triggers) expect(target.sql).toContain(`CREATE TRIGGER ${trigger} `);
      expect(target.sql).not.toMatch(/json_extract|RAISE\(ABORT|json_valid/);
    }
    for (const source of relationSources) expect(createHash('sha256').update(readFileSync(source.source)).digest('hex')).toBe(source.sha256);
    for (const source of mappings.postgres_only) expect(migrations.find(m => m.name === source.name)?.sha256).toBe(source.postgres_sha256);
  });
  it('matches sync relation decisions on valid fixture inserts, duplicates and missing parents', async () => {
    const repository = createMockRepository();
    // Independent test-only reference state for synchronous constraint comparison.
    const reference = new Map<string, StoredRecord>();
    const sync: SyncUnitOfWork = {
      get: <K extends RecordKind>(kind: K, id: string) => (reference.get(`${kind}:${id}`) as StoredRecord<K> | undefined) ?? null,
      list: <K extends RecordKind>(kind: K, contextId?: string) => [...reference.values()].filter(r => r.kind === kind && (contextId === undefined || r.contextId === contextId)) as StoredRecord<K>[],
      create: () => { throw new Error('test read view'); }, update: () => { throw new Error('test read view'); },
    };
    for (const fixture of fixtures) {
      let syncResult: unknown;
      try { checkRelations(sync, fixture.kind, fixture.input); syncResult = 'ok'; } catch (e) { syncResult = (e as Error).message; }
      const view: AsyncUnitOfWork = {
        get: (kind, id) => repository.get(kind, id), list: (kind, context) => repository.list(kind, context),
        create: async () => { throw new Error('test read view'); }, update: async () => { throw new Error('test read view'); },
      };
      let asyncResult: unknown = 'ok'; try { await asyncRelations(view, fixture.kind, fixture.input); } catch (e) { asyncResult = (e as Error).message; }
      expect(asyncResult).toBe(syncResult);
      const saved = await repository.transaction(s => s.create(fixture.kind, fixture.input));
      reference.set(`${saved.kind}:${saved.id}`, saved);
      const missing: RecordInput<RecordKind> = { ...fixture.input, id: 'missing-reference-probe', contextId: 'missing-context', data: { ...fixture.input.data, userId: 'missing-user', taskId: 'missing-task', productId: 'missing-product' } as RecordInput<RecordKind>['data'] };
      try { checkRelations(sync, fixture.kind, missing); syncResult = 'ok'; } catch (e) { syncResult = (e as Error).message; }
      asyncResult = 'ok'; try { await asyncRelations(view, fixture.kind, missing); } catch (e) { asyncResult = (e as Error).message; }
      expect(asyncResult).toBe(syncResult);
    }
    await repository.close();
  });
});

describe('lossless BIGINT revision decoding', () => {
  it.each([1, '1', '2147483647', '2147483648', String(Number.MAX_SAFE_INTEGER)])('retains exact safe revision %s', value => {
    expect(decodeRevision(value)).toBe(Number(value));
  });
  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '9007199254740992', '9223372036854775807', '-1', '0', '1.5', '1e3', '', null, {}, Infinity, NaN])('rejects unsafe/corrupt revision %s', value => {
    expect(() => decodeRevision(value)).toThrow('INVALID_RECORD');
  });
});
