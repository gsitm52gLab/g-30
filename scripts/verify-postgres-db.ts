import { parseEnv } from 'node:util';
import { readFileSync } from 'node:fs';
import { parsePostgresConfig } from '@/server/postgres/config';
import { createPostgresRepository } from '@/server/postgres/repository';
import { migratePostgres } from '@/server/postgres/migrate';
import { seed } from '@/server/db/seed';
import { safePostgresError } from '@/server/postgres/errors';

const command = process.argv[2];
try {
  if (!['migrate', 'seed'].includes(command)) throw new Error('Expected migrate or seed');
  const file = process.env.GS_HALE_ENV_FILE || '.env';
  const env = { ...parseEnv(readFileSync(file, 'utf8')), ...process.env };
  const config = parsePostgresConfig(env, command === 'migrate' ? 'migration' : 'runtime');
  if (command === 'migrate') console.log(JSON.stringify({ status: 'ok', ...await migratePostgres(config) }));
  else {
    const repository = createPostgresRepository(config);
    try { console.log(JSON.stringify({ status: 'ok', scope: 'full-app-synthetic-seed', ...await seed(repository) })); }
    finally { await repository.close(); }
  }
} catch (error) { console.error(JSON.stringify({ status: 'failed', code: safePostgresError(error).message })); process.exitCode = 1; }
