import { readFileSync } from 'node:fs';
import { openDatabase } from '@/server/db/database';
import { createSqliteRepository } from '@/server/repositories/sqlite';
import { curatedRelease } from '@/domain/ai-review/curated';
import { publishCorpus, loadCorpus } from '@/server/ai-review/corpus';
import { AuthError } from '@/server/auth/errors';
import { StoreError } from '@/domain/records';
// Deliberately no .env loader, credentials, network or user-facing publication API.
const [operation, filename, expected, manifestFile, ...extra] = process.argv.slice(2);
if (!filename || extra.length || operation !== 'inspect' && operation !== 'publish' || operation === 'inspect' && expected !== undefined || operation === 'publish' && !expected) {
  console.error('Usage: tsx scripts/ai-review-corpus.ts inspect DB_FILE | publish DB_FILE EXPECTED_RELEASE_ID_OR_NONE [VALIDATED_RELEASE_JSON]'); process.exit(1);
}
let repository: ReturnType<typeof createSqliteRepository> | undefined;
try {
  repository = createSqliteRepository(openDatabase(filename));
  if (operation === 'inspect') {
    const release = await repository.transaction(s => loadCorpus(s));
    console.log(JSON.stringify({ operation, releaseId: release.id, manifestHash: release.manifestHash, sources: release.sources.length, excerpts: release.excerpts.length, translations: release.translations.length, humanReviewed: release.translations.filter(t => t.status === 'human_reviewed').length }));
  } else {
    const bytes = manifestFile ? readFileSync(manifestFile) : null;
    if (bytes && bytes.length > 1024 * 1024) throw new Error('Manifest exceeds technical input limit');
    const release: unknown = bytes ? JSON.parse(bytes.toString('utf8')) : curatedRelease();
    console.log(JSON.stringify({ operation, ...await repository.transaction(s => publishCorpus(s, release, expected === 'NONE' ? null : expected)) }));
  }
} catch (error) {
  console.error(JSON.stringify({ operation, status: 'failed', code: error instanceof AuthError || error instanceof StoreError ? error.code : 'CORPUS_IMPORT_FAILED' })); process.exitCode = 1;
} finally { repository?.close(); }
