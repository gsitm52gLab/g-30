import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { openDatabase, migrate } from '@/server/db/database';
import { createSqliteRepository } from '@/server/repositories/sqlite';
import { seed } from '@/server/db/seed';
const input = process.env.CORRECTIONS_COPY_MANIFEST, output = process.env.CORRECTIONS_COPY_REPORT;
assert(input && output, 'Use a filesystem-copy manifest and new private report path.');
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const manifest = JSON.parse(readFileSync(input, 'utf8')) as {
    original_database_opened: boolean;
    any_sqlite_open_before_copy: boolean;
    copies: {
        label: string;
        copied_database: string;
        files: {
            source: string;
            destination: string;
            sha256: string;
        }[];
    }[];
};
assert.equal(manifest.original_database_opened, false);
assert.equal(manifest.any_sqlite_open_before_copy, false);
const checks: {
    id: string;
    status: 'PASS' | 'FAIL';
    unit: 'assertion';
    requirements: string[];
}[] = [];
const results: unknown[] = [];
const check = (id: string, value: boolean) => { checks.push({ id, status: value ? 'PASS' : 'FAIL', unit: 'assertion', requirements: ['G10-UNION', 'A01', 'A02', 'AC-10-01', 'AC-10-04'] }); assert(value, id); };
let failure: string | null = null;
try {
    for (const copy of manifest.copies) {
        check(`${copy.label}: filesystem bytes copied before first SQLite open`, copy.files.every(f => hash(readFileSync(f.source)) === f.sha256 && hash(readFileSync(f.destination)) === f.sha256));
        const db = openDatabase(copy.copied_database), repo = createSqliteRepository(db);
        try {
            const before = db.prepare('SELECT * FROM records ORDER BY kind,id').all();
            const migrations = db.prepare('SELECT * FROM schema_migrations ORDER BY name').all() as {
                name: string;
                sha256: string;
            }[];
            const source = path.resolve('src/server/db/migrations'), names = readdirSync(source).filter(n => n.endsWith('.sql')).sort();
            check(`${copy.label}: actual SQL 0001 through 0009`, names.map(n => Number(n.slice(0, 4))).join(',') === '1,2,3,4,5,6,7,8,9');
            const missing = names.filter(n => !migrations.some(m => m.name === n));
            check(`${copy.label}: historical chain is the recorded sibling chain`, copy.label === 'accepted-g09' ? migrations.length === 8 && missing.join(',') === '0009-corrections.sql' : migrations.length === 7 && missing.join(',') === '0006-evidence-imports.sql,0008-inquiries.sql');
            const applied = migrate(db);
            check(`${copy.label}: only missing SQL applied`, applied.applied === missing.length && applied.total === 9);
            check(`${copy.label}: all original rows including versions and receipts unchanged`, JSON.stringify(db.prepare('SELECT * FROM records ORDER BY kind,id').all()) === JSON.stringify(before));
            const afterMigrations = db.prepare('SELECT * FROM schema_migrations ORDER BY name').all() as {
                name: string;
                sha256: string;
            }[];
            check(`${copy.label}: old ledger exact and all SQL hashes verified`, JSON.stringify(afterMigrations.filter(m => migrations.some(old => old.name === m.name))) === JSON.stringify(migrations) && afterMigrations.every(m => m.sha256 === hash(readFileSync(path.join(source, m.name)))));
            const repeat = migrate(db), seeded = await seed(repo);
            check(`${copy.label}: repeat migration and seed write nothing`, repeat.applied === 0 && repeat.total === 9 && seeded.inserted === 0 && JSON.stringify(db.prepare('SELECT * FROM records ORDER BY kind,id').all()) === JSON.stringify(before));
            const immutableKinds = ['submission', 'productUseSnapshot', 'inquiryMessage', 'inquiryRead', 'noticeVersion', 'evidenceVersion', 'importBatch', 'correctionOpinionVersion', 'correctionBatch', 'correctionReflection', 'correctionReview'];
            const guarded: string[] = [];
            for (const kind of immutableKinds) {
                const row = db.prepare('SELECT id FROM records WHERE kind=? LIMIT 1').get(kind) as {
                    id: string;
                } | undefined;
                if (!row)
                    continue;
                assert.throws(() => db.prepare('UPDATE records SET revision=revision+1 WHERE kind=? AND id=?').run(kind, row.id));
                guarded.push(kind);
            }
            check(`${copy.label}: existing immutable records remain protected`, guarded.length > 0 && JSON.stringify(db.prepare('SELECT * FROM records ORDER BY kind,id').all()) === JSON.stringify(before));
            check(`${copy.label}: copied upload bytes and original DB sidecars untouched`, copy.files.every(f => hash(readFileSync(f.source)) === f.sha256 && (f.destination.includes(`${path.sep}files${path.sep}`) ? hash(readFileSync(f.destination)) === f.sha256 : true)));
            results.push({ label: copy.label, copiedDatabase: copy.copied_database, priorRows: before.length, rowsSha256: hash(JSON.stringify(before)), priorMigrations: migrations, missing, applied, finalMigrations: afterMigrations, immutableKindsChecked: guarded, originalFiles: copy.files });
        }
        finally {
            (await repo.close());
        }
    }
}
catch (error) {
    failure = error instanceof Error ? error.stack ?? error.message : String(error);
    process.exitCode = 1;
}
finally {
    writeFileSync(output, JSON.stringify({ candidate_commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), cwd: process.cwd(), session_uuid: '01a0c307-c975-75b1-b96a-5a5c4e448aec', runner_sha256: hash(readFileSync('scripts/verify-corrections-union-migration.ts')), input, input_sha256: hash(readFileSync(input)), status: failure ? 'FAIL' : 'PASS', pass: checks.filter(c => c.status === 'PASS').length, fail: checks.filter(c => c.status === 'FAIL').length, count_unit: 'assertion', checks, results, failure }, null, 2) + '\n', { mode: 0o600 });
}
