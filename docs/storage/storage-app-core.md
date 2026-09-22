# Shared Storage application core (S1)

This module is a server contract. Existing file routes, browser uploads, import parsers and AI workers are not switched by S1. It requires a current-authorized feature adapter; a context membership check alone is insufficient. Upload completion does not submit answers, publish a notice, accept a request, approve a review or complete a task.

## Construction and authorization

`StorageCore<Credentials, Validated>(repository, () => transport, hooks, clock?)` receives a lazy `SupabasePrivateStorage` factory. Neither importing the core nor constructing it reads Storage environment variables. SQL/auth startup must work without Storage credentials. Only an operation that needs remote Storage constructs the transport; no local fallback is implemented. Storage namespace/bucket and the secret key are server configuration. Never serialize them through general DTOs or log the upload capability.

`hooks.authorize(s, credentials, binding, action)` must resolve fresh identity and the existing feature policy in the supplied UoW and return its actor ID. It runs for issue/replay/status/finalize/cleanup, again after remote I/O and before feature commit. `StorageBinding` names one context and one explicit owner: task reference, product plus ContextProduct, notice, submission plus exact request, private inquiry, AI asset PDF/image or import source. The adapter must reject wrong relationships and visibility. Grant replay is restricted to its original actor. Resolver errors remain safe feature errors; no raw database or remote body is exposed.

`hooks.validate(input, bytes)` runs outside a UoW after common file signature/size/hash checks. Apply actual feature rules here: parsed import limits; AI page/image bounds and source scope; inquiry-private restrictions; existing publication/reuse rules. `STORAGE_LIMITS.aiPages` represents the existing ten-page limit but cannot inspect pages itself. The adapter must enforce the aggregate AI image limit when assembling an input, even if files were issued individually.

## Issue, upload and finalize

Input fields are `contextId`, `owner`, `visibility`, stable `clientItemId`, `originalName`, `declaredMime`, `expectedBytes` and lowercase SHA-256 `expectedSha256`. Metadata uses the same file-format/MIME allowlist as `validateFile`; final bytes still pass `validateFile`. General limits are 25MiB per file and ten files per batch. AI/import inputs retain the stricter 10MiB limits; an AI image batch allows four images and at most 10MiB combined.

`issue(credentials, input)` returns `{ status, capability }`. Identity is deduplicated by actor/context/owner/client item; a canonical metadata hash rejects conflicting retries. A pending DB grant and fixed random staging/final keys exist before remote signing. Only the staging key is signed. The application deadline is fifteen minutes; provider expiry is stored separately, and cleanup waits at least 24 hours plus five minutes after possible issuance. The capability is returned only after a fresh-authorized durable `issued` commit. A pending issuance has a ten-minute lease and can be reclaimed at the same staging key while its application deadline remains open.

`issueBatch(credentials, inputs)` validates all metadata and batch limits before issuing, then returns ordered per-item `{clientItemId,ok:true,status,capability}` or `{clientItemId,ok:false,error}` results. Successes survive another item's remote failure. Retry only failed items with their original client item IDs. The generic batch error is allowlisted; it never includes the remote message/token. Authentication-specific UX belongs to the adapter's current identity response.

The later browser adapter uploads directly with the returned capability. S1 adds no route that receives a 25MiB Vercel request body. `status(credentials, id)` exposes only ID/revision/state/expiry/safe failure and the exact committed record kind/ID, never the remote key, token, descriptor or bytes.

`finalize(credentials, id)` uses a durable claim before I/O, stores the verified staging descriptor/hash before promotion and records that promotion has begun before issuing a remote create. Promotion uses the fixed final key. Current authorization and claim are checked again before the final DB transaction. The feature callback below commits atomically with the immutable `storageObject` and ready grant.

```
commit(s, { grant, object, descriptor, validated })
  => { record: { kind: 'fileVersion' | 'aiAsset' | 'importStage', id },
       receiptId, auditIds }
```

The callback must create the feature's immutable version/reference, its existing command receipt, and exact G14 `auditOperation`/`appendAudit` entries in **this UoW**. Do not call a public service that starts a nested transaction. FileVersion/AiAsset must have `backend:{kind:'supabase',objectId}` and matching byte count/SHA-256; an import source stage uses the exact object ID/hash. Audit entries must reference that exact returned record and receipt. Existing IDs, metadata and historical versions remain unchanged. Legacy `storageKey` remains required for existing callers; the new backend discriminant selects remote access in future consumers, not path inference.

After remote success but failed/ambiguous DB commit, the core never deletes a possible committed final object. A new instance recovers by inspecting the same final key and matching the persisted verified hash/size. A missing/mismatched final after an unknown promotion remains `recovery_required`; it is not permission to allocate or promote another key. A stale worker cannot commit after claim replacement. Ready replays reauthorize and return the same exact record; they do not create another receipt/audit.

`cleanup(credentials,id)` claims only expired staging after the conservative safe deadline. This blocks finalize, inspects the current staging descriptor, reauthorizes, and deletes only that exact version. A late replacement or active claim fails closed. This is cleanup of unused/rejected/recovery staging, not final-object garbage collection. Ready grants and final objects are retained. Missing staging can finish cleanup; an unknown deletion outcome is retried by inspection at the same key. Production orphan review must retain the durable grant/object record instead of guessing that a final object is unreferenced.

## Authorized internal reads

`AuthorizedStorageReader(repository, () => transport, resolve)` requires a feature resolver on every call. `resolve(s, credentials, object)` checks current identity, original **and** reference authorization, exact version inclusion, and returns a bounded `authorizationStamp` reflecting the relevant state/version. `chunk(credentials, objectId, start, end)` limits a request to 4MiB and rechecks descriptor/revision/stamp after remote reading before returning bytes. Revoked bytes are discarded. There is no long-lived download URL.

`snapshot(credentials, objectId, maximumBytes?)` composes those bounded reads for internal parsers/workers, caps the total at 25MiB (a caller can impose less), and verifies the final SHA-256 and authorization. A future HTTP range adapter must call `chunk` and preserve the same checks rather than retrieving a capability URL.

## Shared private import staging

`SharedImportStaging(repository, authorize, clock?)` provides `put`, `get` and same-UoW `consume`/`expire`. `createImportStage(s, actorId, input, now)` is the upload-commit helper. The authorization callback must enforce current import/price/context rights and original actor identity. Parsed JSON is private record data with an exact serialized payload hash; it is not smuggled through the generic file validator. Decimal strings and leading-zero product codes are preserved.

Each payload is capped at 64MiB; at most fifty active stages per actor are allowed. Source expiry is 24 hours; preview expiry is thirty minutes. Payload/context/source hash are immutable, consumption rolls back with failed apply, and expiry clears only the payload while retaining its hash and metadata. A preview's source-stage reference must resolve to the same actor/context/hash. A linked source object must have the same actor/context/hash. Future import consumers still recheck current permissions, target CAS/uniqueness and all-or-nothing apply inside their original UoW.

## Schema and verification boundary

SQLite adds `0017-storage.sql`; PostgreSQL adds `0018-storage.sql` after its separate revision-width migration. Previous SQL bytes are untouched. The new records are private `storageUploadGrant`, immutable `storageObject`, and `importStage`. Local and PostgreSQL adapters use the same pure relationship/state validation; PostgreSQL awaits dependency reads before invoking it. Unique grant identity/object-grant indexes and SQL immutability guards preserve cross-instance correctness.

The early contract checkpoint has local mock/SQLite and existing-file regression checks. Actual PostgreSQL, direct Storage, two-repository/process recovery and downstream app/browser integration are separately reported; typecheck/build or local mocks do not establish these results.
