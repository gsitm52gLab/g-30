import { asyncFlatMap } from "@/domain/async-collections";
import type { StoredRecord, UnitOfWork } from '@/domain/records';
import { systemClock } from '@/domain/records';
import type { AiContent } from '@/domain/ai-input/records';
import { id, obj, parseContent, visibility, str } from '@/domain/ai-input/validate';
import type { IdentityService, Principal } from '@/server/auth/service';
import { AuthError, fail, unavailable } from '@/server/auth/errors';
import { audit, fresh, newId, receipt } from '@/server/products/store';
import { contextAccess, contentAccess, resolveInput, resolveVersion } from './access';
import { contentHash, extractInput, type ExtractionResult } from './extraction';
import { prepareExternalTransfer } from './extraction/transfer';
import { fileDirectory } from './assets';
import { inputDetail, runDTO, runLimits, transientIssues } from './read';
import { loadRequest, sourcePicker } from './sources';
import { provenance } from './provenance';
import { readSnapshot } from './snapshot';
import type { ExtractionRequest } from '@/domain/ai-input/types';
export class AiInputService {
    constructor(readonly identity: IdentityService, readonly directory = fileDirectory(), private hooks: {
        extract?: (request: ExtractionRequest) => Promise<ExtractionResult>;
        fault?: (stage: string) => void;
        afterExtraction?: () => Promise<void>;
    } = {}) { }
    get clock() { return this.identity.clock; }
    async picker(token: string | undefined, contextId: string) { return this.identity.repo.transaction(async (s) => (await sourcePicker(s, (await this.identity.principal(s, token)), id(contextId), this.clock))); }
    async list(token: string | undefined, contextId: string) { return this.identity.repo.transaction(async (s) => { const p = (await this.identity.principal(s, token)); (await contextAccess(s, p, id(contextId), this.clock)); const items = (await asyncFlatMap((await s.list('aiInput', contextId)), async (row) => { try {
        const d = (await inputDetail(s, p, row.id, this.clock));
        return [{ id: d.id, title: d.version.content.title, visibility: d.visibility, kind: d.version.content.kind, sequence: d.version.sequence, state: d.runs[0]?.state ?? 'not_extracted', updatedAt: row.updatedAt }];
    }
    catch (e) {
        if (e instanceof AuthError && [403, 404].includes(e.status))
            return [];
        throw e;
    } })).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id)); return { contextId, items, total: items.length, capabilities: { create: true, createInternal: p.user.data.role === 'gsg' } }; }); }
    async detail(token: string | undefined, inputId: string, versionId?: string) { return this.identity.repo.transaction(async (s) => (await inputDetail(s, (await this.identity.principal(s, token)), id(inputId), this.clock, versionId === undefined ? undefined : id(versionId)))); }
    private async version(s: UnitOfWork, p: Principal, root: StoredRecord<'aiInput'>, content: AiContent) { (await contentAccess(s, p, root.contextId!, content, this.clock, root.data.visibility)); const old = root.data.currentVersionId ? (await s.get('aiVersion', root.data.currentVersionId)) : null; const v = (await s.create('aiVersion', { id: newId(), contextId: root.contextId, data: { ...content, inputId: root.id, sequence: (old?.data.sequence ?? 0) + 1, previousId: old?.id ?? null, createdBy: p.user.id, contentHash: contentHash(JSON.stringify(content)) } })); (await s.update('aiInput', root.id, root.revision, { createdBy: root.data.createdBy, visibility: root.data.visibility, currentVersionId: v.id })); return v; }
    async create(token: string | undefined, raw: Record<string, unknown>) { const input = obj(raw, ['contextId', 'visibility', 'content', 'idempotencyKey']), contextId = id(input.contextId), vis = visibility(input.visibility), content = parseContent(input.content); return this.identity.repo.transaction(async (s) => { const p = (await this.identity.principal(s, token)); (await contextAccess(s, p, contextId, this.clock, vis)); (await contentAccess(s, p, contextId, content, this.clock, vis)); const result = (await receipt(s, p, contextId, 'ai.create', input, async () => { const row = (await s.create('aiInput', { id: newId(), contextId, data: { createdBy: p.user.id, visibility: vis, currentVersionId: null } })); const version = (await this.version(s, p, row, content)); (await audit(s, p, this.clock, contextId, 'ai.input.created', row.id, {}, { versionId: version.id })); this.hooks.fault?.('create'); return { ids: [row.id] }; })); return (await inputDetail(s, p, result.ids[0], this.clock)); }); }
    async revise(token: string | undefined, inputId: string, raw: Record<string, unknown>) { const input = obj(raw, ['expectedRevision', 'content', 'idempotencyKey']), content = parseContent(input.content); return this.identity.repo.transaction(async (s) => { const p = (await this.identity.principal(s, token)), root = (await resolveInput(s, p, id(inputId), this.clock, true)); (await contentAccess(s, p, root.contextId!, content, this.clock, root.data.visibility)); const result = (await receipt(s, p, root.contextId!, `ai.revise:${root.id}`, input, async () => { fresh(root, input.expectedRevision); const v = (await this.version(s, p, root, content)); (await audit(s, p, this.clock, root.contextId!, 'ai.input.revised', root.id, { versionId: root.data.currentVersionId }, { versionId: v.id })); this.hooks.fault?.('revise'); return { ids: [v.id] }; })); return (await inputDetail(s, p, root.id, this.clock, result.ids[0])); }); }
    async extract(token: string | undefined, inputId: string, raw: Record<string, unknown>) {
        const input = obj(raw, ['versionId', 'expectedRunId', 'idempotencyKey']), versionId = id(input.versionId);
        if (input.expectedRunId !== null)
            id(input.expectedRunId);
        str(input.idempotencyKey);
        const claimed = await this.identity.repo.transaction(async (s) => {
            const p = (await this.identity.principal(s, token)), r = (await resolveVersion(s, p, id(inputId), versionId, this.clock));
            const result = (await receipt(s, p, r.input.contextId!, `ai.extract:${inputId}:${versionId}`, input, async () => { const previous = (await s.list('aiRun', r.input.contextId!)).filter(v => v.data.versionId === versionId).sort((a, b) => b.data.attempt - a.data.attempt)[0]; if ((previous?.id ?? null) !== input.expectedRunId)
                fail('CONFLICT', 409, '실행 상태가 바뀌었습니다. 현재 실행을 확인해 주세요.'); if (previous) {
                if (previous.data.state === 'queued')
                    return { ids: [previous.id] };
                const dto = (await runDTO(s, previous, this.clock));
                if (!dto.retryable)
                    fail('RETRY_UNAVAILABLE', 409, '현재 실행을 확인하거나 새 입력 버전을 만들어 주세요.');
                if (dto.state === 'interrupted')
                    (await s.update('aiRun', previous.id, previous.revision, { ...previous.data, state: 'failed', issue: 'INTERRUPTED', endedAt: this.clock(), leaseUntil: null }));
            } if ((await s.list('aiRun')).filter(v => v.data.state === 'queued').length >= runLimits.queued)
                fail('QUEUE_FULL', 503, '읽기 대기 작업이 많습니다. 입력을 유지한 채 잠시 후 다시 시도해 주세요.'); const run = (await s.create('aiRun', { id: newId(), contextId: r.input.contextId, data: { inputId, versionId, attempt: (previous?.data.attempt ?? 0) + 1, createdBy: p.user.id, state: 'queued', claimId: null, leaseUntil: null, startedAt: null, endedAt: null, snapshotId: null, issue: null } })); this.hooks.fault?.('queue'); return { ids: [run.id] }; }));
            let run = (await s.get('aiRun', result.ids[0]));
            if (!run || run.data.inputId !== inputId || run.data.versionId !== versionId)
                unavailable();
            (await resolveVersion(s, p, inputId, versionId, this.clock));
            if (run.data.state !== 'queued')
                return { runId: run.id, claimId: null };
            const active = (await s.list('aiRun')).filter(v => v.data.state === 'reading' && !!v.data.leaseUntil && v.data.leaseUntil > this.clock());
            if (active.length >= runLimits.concurrent)
                return { runId: run.id, claimId: null };
            const claimId = newId();
            run = (await s.update('aiRun', run.id, run.revision, { ...run.data, state: 'reading', claimId, leaseUntil: new Date(Date.parse(this.clock()) + runLimits.leaseMs).toISOString(), startedAt: this.clock() }));
            this.hooks.fault?.('claim');
            return { runId: run.id, claimId };
        });
        if (claimed.claimId) {
            try {
                const request = await loadRequest(this.identity, token, inputId, versionId, this.directory), result = await (this.hooks.extract ?? extractInput)(request);
                await this.hooks.afterExtraction?.();
                await this.identity.repo.transaction(async (s) => {
                    const p = (await this.identity.principal(s, token));
                    (await resolveVersion(s, p, inputId, versionId, this.clock));
                    const run = (await s.get('aiRun', claimed.runId))!;
                    if (run.data.state !== 'reading' || run.data.claimId !== claimed.claimId || !run.data.leaseUntil || run.data.leaseUntil <= this.clock())
                        fail('CONFLICT', 409, '실행 시간이 만료되었습니다. 현재 상태를 확인해 주세요.');
                    let snapshotId: string | null = null, state: StoredRecord<'aiRun'>['data']['state'], issue: string | null;
                    if (result.ok) {
                        const snap = readSnapshot(JSON.stringify(result.snapshot), result.snapshot.snapshotHash);
                        snapshotId = newId();
                        (await s.create('aiSnapshot', { id: snapshotId, contextId: run.contextId, data: { inputId, versionId, runId: run.id, payload: JSON.stringify(snap), snapshotHash: snap.snapshotHash } }));
                        issue = snap.issues.find(i => transientIssues.has(i)) ?? snap.issues[0] ?? null;
                        state = issue && transientIssues.has(issue) ? 'failed' : snap.status === 'read' || snap.status === 'partial' ? 'finished' : snap.status === 'unread' ? 'unread' : snap.status;
                    }
                    else {
                        state = result.status;
                        issue = result.issue;
                    }
                    (await s.update('aiRun', run.id, run.revision, { ...run.data, state, issue, snapshotId, leaseUntil: null, endedAt: this.clock() }));
                    (await audit(s, p, this.clock, run.contextId!, 'ai.extraction.finished', run.id, {}, { state, runId: run.id, snapshotId }));
                    this.hooks.fault?.('result');
                });
            }
            catch (error) {
                await this.identity.repo.transaction(async (s) => { const run = (await s.get('aiRun', claimed.runId)); if (run?.data.state === 'reading' && run.data.claimId === claimed.claimId)
                    (await s.update('aiRun', run.id, run.revision, { ...run.data, state: 'failed', issue: error instanceof AuthError && [401, 403, 404].includes(error.status) ? 'ACCESS_CHANGED' : 'STORAGE_UNAVAILABLE', leaseUntil: null, endedAt: this.clock() })); });
                throw error;
            }
        }
        return this.identity.repo.transaction(async (s) => { const p = (await this.identity.principal(s, token)); (await resolveVersion(s, p, inputId, versionId, this.clock)); return { runId: claimed.runId, detail: (await inputDetail(s, p, inputId, this.clock, versionId)) }; });
    }
    /** Future provider boundary: persisted result + freshly loaded original bytes/permission. Never receives a client snapshot/provenance. */
    async prepareTransfer(token: string | undefined, inputId: string, runId: string) { const stored = await this.identity.repo.transaction(async (s) => { const p = (await this.identity.principal(s, token)), run = (await s.get('aiRun', id(runId))); if (!run || run.data.inputId !== id(inputId) || !run.data.snapshotId)
        unavailable(); (await resolveVersion(s, p, inputId, run.data.versionId, this.clock)); const snap = (await s.get('aiSnapshot', run.data.snapshotId)); if (!snap || snap.data.runId !== run.id)
        unavailable(); return { versionId: run.data.versionId, snapshot: readSnapshot(snap.data.payload, snap.data.snapshotHash) }; }); const request = await loadRequest(this.identity, token, inputId, stored.versionId, this.directory), sources = request.kind === 'images' ? request.sources : [request.source]; return prepareExternalTransfer(stored.snapshot, async (source, hash) => { await this.identity.repo.transaction(async (s) => (await resolveVersion(s, (await this.identity.principal(s, token)), inputId, stored.versionId, this.clock))); const fresh = sources.find(s => s.sourceId === source.sourceId && s.versionId === source.versionId), actual = fresh ? contentHash(request.kind === 'text' ? request.text : ('bytes' in fresh ? fresh.bytes : new Uint8Array())) : ''; return { ...source, verifiedSnapshotHash: hash, currentReadAllowed: !!fresh && actual === source.sha256, externalUseAllowed: provenance(actual) === 'synthetic', provenance: provenance(actual), checkedAt: systemClock() }; }); }
}
