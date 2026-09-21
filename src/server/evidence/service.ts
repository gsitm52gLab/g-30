import { sourceChoices } from './sources';
import type { EvidenceSource } from '@/domain/evidence/types';
import { evidenceNotice, assessmentStatuses } from '@/domain/evidence/types';
import { id, metadataInput, sourceInput, productIdsInput } from '@/domain/evidence/validate';
import { object, str, enumValue } from '@/domain/tasks/validate';
import type { Clock, UnitOfWork } from '@/domain/records';
import type { Principal } from '@/server/auth/service';
import { IdentityService } from '@/server/auth/service';
import { unavailable, fail } from '@/server/auth/errors';
import { authorize, decide } from '@/server/policy/policy';
import { resolveProduct, productContextScope } from '@/server/products/access';
import { newId, fresh, receipt, audit } from '@/server/products/store';
import { canReferenceFile } from '@/server/files/access';
import { FileService, sourceReference } from '@/server/files/service';
import { resolveSource, resolveEvidenceVersion, resolveLink, evidenceScope } from './access';
import { versionDTO } from './projection';
import { materialTable } from './table';
function addLinks(s: UnitOfWork, p: Principal, clock: Clock, contextId: string, versionId: string, source: EvidenceSource, productIds: string[]) {
    const file = resolveSource(s, p, contextId, source, clock);
    return productIds.map(productId => {
        const r = resolveProduct(s, p, contextId, productId, clock, true);
        canReferenceFile(s, p, file, productContextScope(contextId, productId), clock);
        const old = s.list('evidenceLink', contextId).find(l => l.data.evidenceVersionId === versionId && l.data.productId === productId);
        if (old) {
            if (!old.data.active)
                s.update('evidenceLink', old.id, old.revision, { ...old.data, active: true });
            return old.id;
        }
        return s.create('evidenceLink', { id: newId(), contextId, data: { evidenceVersionId: versionId, productId, contextProductId: r.relation.id, active: true, currentAssessmentId: null } }).id;
    });
}
export class EvidenceService {
    constructor(public identity: IdentityService, private fault?: () => void) { }
    get clock() { return this.identity.clock; }
    async list(token: string | undefined, contextId: string, productId?: string) {
        return this.identity.repo.transaction(s => {
            const p = this.identity.principal(s, token);
            authorize(s, p, 'evidence.read', evidenceScope(contextId), this.clock);
            if (productId)
                resolveProduct(s, p, contextId, productId, this.clock);
            const items = s.list('evidence', contextId).flatMap(root => { try {
                if (!root.data.currentVersionId)
                    return [];
                const v = versionDTO(s, p, root.data.currentVersionId, this.clock);
                return (!productId || v.links.some(l => l.productId === productId && l.active)) ? [{ id: root.id, revision: root.revision, current: v }] : [];
            }
            catch {
                return [];
            } });
            return { contextId, items, notice: evidenceNotice, capabilities: { register: decide(s, p, 'evidence.edit', evidenceScope(contextId), this.clock).allowed, assess: decide(s, p, 'evidence.assess', evidenceScope(contextId), this.clock).allowed } };
        });
    }
    async detail(token: string | undefined, evidenceId: string) {
        return this.identity.repo.transaction(s => {
            const p = this.identity.principal(s, token), root = s.get('evidence', evidenceId);
            if (!root?.contextId || !root.data.currentVersionId)
                unavailable();
            const current = versionDTO(s, p, root.data.currentVersionId, this.clock), versions = s.list('evidenceVersion', root.contextId).filter(v => v.data.evidenceId === root.id).sort((a, b) => b.data.sequence - a.data.sequence).flatMap(v => { try {
                return [versionDTO(s, p, v.id, this.clock)];
            }
            catch {
                return [];
            } });
            return { id: root.id, contextId: root.contextId, revision: root.revision, current, versions, notice: evidenceNotice, capabilities: { edit: decide(s, p, 'evidence.edit', evidenceScope(root.contextId), this.clock).allowed, assess: decide(s, p, 'evidence.assess', evidenceScope(root.contextId), this.clock).allowed } };
        });
    }
    async register(token: string | undefined, input: Record<string, unknown>) {
        const v = object(input, ['contextId', 'source', 'metadata', 'productIds', 'idempotencyKey']), contextId = id(v.contextId), source = sourceInput(v.source), metadata = metadataInput(v.metadata), productIds = productIdsInput(v.productIds);
        return this.identity.repo.transaction(s => {
            const p = this.identity.principal(s, token);
            authorize(s, p, 'evidence.edit', evidenceScope(contextId), this.clock);
            resolveSource(s, p, contextId, source, this.clock);
            for (const pid of productIds)
                resolveProduct(s, p, contextId, pid, this.clock, true);
            return receipt(s, p, contextId, 'evidence.register', v, () => { const root = s.create('evidence', { id: newId(), contextId, data: { currentVersionId: null } }), version = s.create('evidenceVersion', { id: newId(), contextId, data: { evidenceId: root.id, source, metadata, sequence: 1, previousId: null, recordedBy: p.user.id, recordedAt: this.clock() } }); s.update('evidence', root.id, root.revision, { currentVersionId: version.id }); const links = addLinks(s, p, this.clock, contextId, version.id, source, productIds); audit(s, p, this.clock, contextId, 'evidence.register', root.id, {}, { versionId: version.id, linkIds: links }); return { ids: [root.id, version.id, ...links] }; }, this.fault);
        });
    }
    async command(token: string | undefined, evidenceId: string, input: Record<string, unknown>) {
        const command = enumValue(input.command, ['revise', 'link', 'unlink', 'assess']), keys = { revise: ['expectedRevision', 'source', 'metadata', 'productIds'], link: ['versionId', 'productIds', 'expectedRevision'], unlink: ['linkId', 'expectedLinkRevision'], assess: ['linkId', 'expectedLinkRevision', 'status', 'reason'] };
        const v = object(input, ['command', 'idempotencyKey', ...keys[command]]);
        return this.identity.repo.transaction(s => {
            const p = this.identity.principal(s, token), root = s.get('evidence', evidenceId);
            if (!root?.contextId || !root.data.currentVersionId)
                unavailable();
            const contextId = root.contextId;
            resolveEvidenceVersion(s, p, root.data.currentVersionId, this.clock);
            authorize(s, p, command === 'assess' ? 'evidence.assess' : 'evidence.edit', evidenceScope(contextId, evidenceId), this.clock);
            const linked = command === 'assess' || command === 'unlink' ? resolveLink(s, p, id(v.linkId), this.clock, true) : null;
            if (linked && linked.version.data.evidenceId !== root.id)
                unavailable();
            if (command === 'revise')
                resolveSource(s, p, contextId, sourceInput(v.source), this.clock);
            return receipt(s, p, contextId, `evidence.${evidenceId}.${command}`, v, () => {
                let ids: string[] = [];
                if (command === 'revise') {
                    fresh(root, v.expectedRevision);
                    const old = s.get('evidenceVersion', root.data.currentVersionId!)!, source = sourceInput(v.source), metadata = metadataInput(v.metadata), productIds = productIdsInput(v.productIds);
                    const version = s.create('evidenceVersion', { id: newId(), contextId, data: { evidenceId: root.id, source, metadata, sequence: old.data.sequence + 1, previousId: old.id, recordedBy: p.user.id, recordedAt: this.clock() } });
                    s.update('evidence', root.id, root.revision, { currentVersionId: version.id });
                    ids = [version.id, ...addLinks(s, p, this.clock, contextId, version.id, source, productIds)];
                }
                else if (command === 'link') {
                    fresh(root, v.expectedRevision);
                    const { version } = resolveEvidenceVersion(s, p, id(v.versionId), this.clock);
                    if (version.data.evidenceId !== root.id)
                        unavailable();
                    ids = addLinks(s, p, this.clock, contextId, version.id, version.data.source, productIdsInput(v.productIds));
                    s.update('evidence', root.id, root.revision, root.data);
                }
                else {
                    const { link } = linked!;
                    fresh(link, v.expectedLinkRevision);
                    if (command === 'unlink') {
                        s.update('evidenceLink', link.id, link.revision, { ...link.data, active: false });
                        ids = [link.id];
                    }
                    else {
                        if (!link.data.active)
                            fail('VALIDATION', 422, '연결된 상품의 적용 상태만 확인할 수 있습니다.');
                        const status = enumValue(v.status, assessmentStatuses), reason = str(v.reason, 2000, true), old = link.data.currentAssessmentId ? s.get('evidenceAssessment', link.data.currentAssessmentId) : null;
                        const row = s.create('evidenceAssessment', { id: newId(), contextId, data: { linkId: link.id, status, reason, assessedBy: p.user.id, assessedAt: this.clock(), sequence: (old?.data.sequence ?? 0) + 1, previousId: old?.id ?? null } });
                        s.update('evidenceLink', link.id, link.revision, { ...link.data, currentAssessmentId: row.id });
                        ids = [link.id, row.id];
                    }
                }
                audit(s, p, this.clock, contextId, `evidence.${command}`, root.id, {}, { ids });
                return { ids: [root.id, ...ids] };
            }, this.fault);
        });
    }
    async sources(token: string | undefined, contextId: string) { return this.identity.repo.transaction(s => ({ contextId, items: sourceChoices(s, this.identity.principal(s, token), contextId, this.clock) })); }
    async table(token: string | undefined, contextId: string, history = false) { return this.identity.repo.transaction(s => materialTable(s, this.identity.principal(s, token), contextId, this.clock, history)); }
    async download(token: string | undefined, evidenceId: string, versionId: string, linkId: string, mode: 'download' | 'preview', directory?: string) {
        const check = () => this.identity.repo.transaction(s => { const p = this.identity.principal(s, token), r = resolveLink(s, p, linkId, this.clock); if (r.version.id !== versionId || r.version.data.evidenceId !== evidenceId)
            unavailable(); return { id: r.file.id, reference: sourceReference(r.file) }; });
        const target = await check(), result = await new FileService(this.identity, directory).download(token, target.id, target.reference, mode);
        await check();
        return result;
    }
}
export type EvidenceList = Awaited<ReturnType<EvidenceService['list']>>;
export type EvidenceDetail = Awaited<ReturnType<EvidenceService['detail']>>;
