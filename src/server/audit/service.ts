import { asyncFlatMap } from "@/domain/async-collections";
import type { IdentityService } from '@/server/auth/service';
import type { AuditList } from '@/domain/audit/view';
import { searchQuery } from '@/domain/search/query';
import { authorize } from '@/server/policy/policy';
import { unavailable, fail } from '@/server/auth/errors';
import { access, normalized } from '@/server/search/service';
import { collectDocuments } from '@/server/search/collect';
import { auditItem } from './read';
export class AuditService {
    constructor(public identity: IdentityService) { }
    async list(token: string | undefined, params: URLSearchParams): Promise<AuditList> {
        if (params.has('mode'))
            fail('VALIDATION', 422, '감사 조회는 항상 기록 이력을 표시합니다.');
        const { mode: unusedMode, ...q } = searchQuery(params);
        void unusedMode;
        return this.identity.repo.transaction(async (s) => { const a = (await access(this.identity, token, q.context, s)); (await authorize(s, a.p, 'audit.read', { kind: 'audit', id: q.context, contextId: q.context, visibility: 'internal' }, a.clock)); const docs = (await collectDocuments(a)), related = (d: import('@/domain/audit/view').AuditItem) => docs.filter(x => x.rootId === d.target.id || x.sourceId === d.target.id || d.versions.some(v => v.kind === x.sourceKind && v.id === x.sourceId)), all = (await asyncFlatMap((await s.list('audit')), async (r) => { const d = (await auditItem(a, r, docs)); return d ? [d] : []; })), filtered = all.filter(d => (!q.q || normalized([d.label, d.target.title, ...d.versions.map(v => v.label), ...d.fields.map(f => f.value)].join('\n')).includes(normalized(q.q))) && (!q.status || d.action === q.status) && (!q.actor || d.actor.id === q.actor) && (!q.assignee || related(d).some(x => x.assignees.some(v => v.id === q.assignee))) && (!q.from || d.occurredAt.slice(0, 10) >= q.from) && (!q.to || d.occurredAt.slice(0, 10) <= q.to) && (!q.kind || related(d).some(x => x.kind === q.kind)) && (!q.task || d.target.id === q.task || related(d).some(x => x.taskId === q.task)) && (!q.product || related(d).some(x => x.productIds.includes(q.product))) && (!q.sku || related(d).some(x => x.sku.includes(q.sku))) && (!q.jan || related(d).some(x => x.jan.includes(q.jan)))).sort((a, b) => b.occurredAt.localeCompare(a.occurredAt) || a.id.localeCompare(b.id)); return { query: q, items: filtered.slice((q.page - 1) * q.pageSize, q.page * q.pageSize), total: filtered.length, page: q.page, pageSize: q.pageSize, pages: Math.ceil(filtered.length / q.pageSize), filters: { actions: [...new Map(all.map(d => [d.action, { value: d.action, label: d.label }])).values()], actors: [...new Map(all.flatMap(d => d.actor.id ? [[d.actor.id, { id: d.actor.id, label: d.actor.label }] as const] : [])).values()] }, readOnly: true }; });
    }
    async detail(token: string | undefined, contextId: string, id: string) {
        const q = searchQuery(new URLSearchParams({ context: contextId }));
        return this.identity.repo.transaction(async (s) => {
            const a = (await access(this.identity, token, q.context, s));
            (await authorize(s, a.p, 'audit.read', { kind: 'audit', id: contextId, contextId, visibility: 'internal' }, a.clock));
            const r = (await s.get('audit', id)), d = r ? (await auditItem(a, r, (await collectDocuments(a)))) : null;
            if (!d)
                unavailable();
            return d;
        });
    }
}
