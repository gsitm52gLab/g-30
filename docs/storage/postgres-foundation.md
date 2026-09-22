# PostgreSQL foundation contract

Scope: additive infrastructure for SB-01–04 and G00/G02 at the accepted SQLite 0001–0015 baseline. The application still uses its existing mock/SQLite factory. This module does not claim full Supabase mode, Storage, Vercel, G14 0016, full fixture/bootstrap/import, or any complete SB acceptance gate.

## Async integration API

`src/server/postgres/types.ts` defines `AsyncUnitOfWork`: `get`, `list`, `create`, `update` all return `Promise`. `AsyncRecordRepository.transaction(async store => …)` and `.close()` also return `Promise`. Callers must await every operation and port synchronous domain services explicitly. A synchronous callback cast or a process-wide record snapshot is not supported.

`createPostgresRepository(config, clock?)` is lazy: it does not migrate or seed. Each transaction obtains one pg client, issues `BEGIN ISOLATION LEVEL SERIALIZABLE`, then commits or rolls back all records/audit/receipts together. Relation reads use that same client and snapshot. Postgres predicate conflict detection covers cross-row write skew and phantom reads; unique indexes and `WHERE revision=$expected` prevent duplicate facts and lost updates. Serialization, deadlock, uniqueness and lock-timeout conflicts return `StoreError(CONFLICT)`; callers may explicitly retry whole pure commands. Callbacks are never replayed automatically. There is no process lock, whole-database snapshot, REST transaction emulation, named prepared statement or persistent session state.

Transaction handles expire at callback completion. Unawaited pending operations force rollback; a caught failed repository operation poisons the transaction and cannot commit partial work. Network/LLM/Storage work must be outside the callback. The public API provides no delete or arbitrary SQL method. `list` preserves the existing complete kind/context query and C-collation ID ordering; it does not silently truncate or impose a new product limit.

`src/server/postgres/relations/` contains explicit async counterparts of every current synchronous relationship checker. The source hash inventory prevents silently ignoring subsequent domain changes. The only intentional semantic normalization is notification content comparison: JSONB reorders object properties, so `isDeepStrictEqual` compares values while allowing only `readAt` changes. All types, old-record checks, references, version links and uniqueness decisions remain. Future G14 changes must update this mapping and add migration 0016 after its accepted source is released.

## Configuration and TLS

`parsePostgresConfig(env)` requires `DATABASE_URL` (Supavisor transaction pooler, 6543), `DIRECT_URL` (session pooler or direct, 5432), and `SUPABASE_URL`. URLs must refer to the same project. `SUPABASE_URL` may be an origin or the dashboard-copied `/rest/v1[/]` or `/storage/v1[/]` path; only the origin is used to identify the project. Other paths, URL userinfo, query and fragment are rejected. The original `.env` is never rewritten.

The module parses SQL URI components itself and sets `ssl.rejectUnauthorized=true`, expected hostname and TLS ≥1.2. A URI `sslmode=require` is accepted without replacing strict TLS; unsafe SSL options are rejected. Official public Supabase production CA (not a secret) is bundled at `src/server/postgres/tls/supabase-prod-ca-2021.crt`; hash and validity are checked before using it together with Node's normal trusted roots. The default asset path is relative to the server cwd; application/Vercel integration must include this asset explicitly in tracing and validate the deployed bundle.

- CA source: https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt
- Official discovery: https://raw.githubusercontent.com/supabase/supabase/master/apps/studio/hooks/custom-content/custom-content.json
- SHA-256: `700723581420dd1ac98fd7e9ac529f0ef210eadcaf87fc868a3ad7d114c2f3b7`
- Valid until: 2031-04-26 10:56:53 UTC. A CA renewal requires reviewed file/hash update; verification is never disabled.
- Runtime pool maximum defaults to 4 (`SUPABASE_POOL_MAX`: 1–20); migration pool is 1. Connect timeout is 10 s, idle client timeout 30 s, client query timeout 30 s.
- Transaction-local defaults: statement 15 s (`SUPABASE_STATEMENT_TIMEOUT_MS`, max 120 s), lock 5 s (`SUPABASE_LOCK_TIMEOUT_MS`, max 30 s), idle transaction 15 s (`SUPABASE_IDLE_TRANSACTION_TIMEOUT_MS`, max 120 s). Client query timeout remains an independent 30 s upper bound. These control infrastructure stability, not product record counts or file limits.

Raw pg messages, details, causes, SQL, URI and credentials are never logged by this module. Only controlled configuration fields and `StoreError`/migration error codes leave the boundary. SQL transport TLS observation is client→Supavisor; it must not be represented as direct observation of the pooler's internal connection.

## Explicit migration, seeding and permissions

`SUPABASE_DB_SCHEMA` defaults to `gs_hale` and is restricted to that namespace (`gs_hale_*`, ≤63 bytes). Migration inventories the target before creating it. It refuses an existing schema without the application marker and current migration-role ownership. A transaction-level advisory migration lock prevents concurrent installers; it is released at transaction end. All 15 versioned scripts, checksums and privilege changes apply in one transaction. Missing sequence, unknown history and changed applied checksums fail. No schema/table reset, data deletion or hidden runtime migration occurs.

Tables use JSONB, a compound `(kind,id)` primary key, positive integer revisions and original text timestamps. JSON extraction for unique indexes uses JSONB equality (including numeric `1`/`1.0` equality) and maps JSON null to SQL null to preserve optional-key uniqueness. SQL triggers preserve immutable histories and the original SQL membership/invitation reference rules; full domain relations are enforced by async checkers on every repository write. Legacy product movement calls the original `updatedContext` validator and only permits the one documented lossless conversion.

The app schema and all tables/functions explicitly deny `PUBLIC`, `anon` and `authenticated` access; the records table enables RLS with no public policies. This protects direct client access even if the schema is accidentally exposed in Data API. Existing server role/context/price checks must still run after wiring. The supplied Supabase postgres credential owns the schema for foundation testing; a narrowly granted production runtime role remains a deployment integration task, not a claim that owner credentials are least-privileged. Never expose DB or service secrets in a browser.

```sh
# Explicit commands; env comes from .env or the absolute GS_HALE_ENV_FILE override.
# Choose an isolated authorized schema before running on a shared Supabase project.
SUPABASE_DB_SCHEMA=gs_hale_test npm run db:postgres:migrate
SUPABASE_DB_SCHEMA=gs_hale_test npm run db:postgres:seed
```

`seedPostgres(repository, orderedSyntheticFixtures)` inserts only missing `(kind,id)` rows atomically and never overwrites existing edits. The CLI currently passes base synthetic `fixtures`; it intentionally reports `foundation-fixtures-only`. Async legacy-product upgrade, built-in templates, credentials and corpus bootstrap must be added in the product-mode integration checkpoint. It must not be used to claim a fully prepared login/demo environment. Existing SQLite/file import remains a separate explicit, lossless operation after inventory and backup; this foundation does not read, modify or delete existing local data.

## Reproducible proof

```sh
npx vitest run tests/unit/postgres-foundation.test.ts
npm run db:postgres:verify -- /absolute/private/.env /absolute/private/new-proof.json
```

The real proof is hard restricted to `gs_hale_sb_foundation_20260922`, writes synthetic run-unique IDs, retains them, and creates a new evidence file with exclusive creation. It verifies migration repeat/checksum, seed preservation, JSONB/ordering, commit/rollback, independent-client CAS, write skew, phantom contention, immutable trigger and unique-index negatives, direct-role denial, timeout recovery and reconnect persistence. Temp raw SQL negative cases roll back. It never calls OpenAI or Storage and never deletes existing namespaces or records. Logs record counts and safe codes, with original `.env` hash equality checked in memory.

Official API references: https://node-postgres.com/features/transactions ; https://node-postgres.com/features/ssl ; https://supabase.com/docs/guides/database/connecting-to-postgres
