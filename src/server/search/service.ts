import { asyncFilter } from "@/domain/async-collections";
import type { IdentityService } from '@/server/auth/service';
import type { SearchDocument, SearchQuery, SearchList, SearchDetail } from '@/domain/search/types';
import { searchQuery } from '@/domain/search/query';
import { authorize, decide } from '@/server/policy/policy';
import { contextResource } from '@/server/policy/types';
import { projectContext } from '@/server/policy/projection';
import { fail, unavailable } from '@/server/auth/errors';
import { collectDocuments } from './collect';
import { publicHit, type SearchAccess } from './safe';
export const normalized = (v: string) => v.normalize('NFKC').toLocaleLowerCase();
export function matches(d: SearchDocument, q: SearchQuery) { const hay = normalized([d.title, ...d.fields.map(f => f.value), ...d.files.map(f => f.name)].join('\n')); return (!q.q || hay.includes(normalized(q.q))) && (!q.kind || d.kind === q.kind) && (q.mode === 'history' || d.isCurrent) && (!q.product || d.productIds.includes(q.product)) && (!q.task || d.taskId === q.task) && (!q.sku || d.sku.some(s => normalized(s).includes(normalized(q.sku)))) && (!q.jan || d.jan.some(s => normalized(s).includes(normalized(q.jan)))) && (!q.status || d.status === q.status) && (!q.actor || d.actor.id === q.actor) && (!q.assignee || d.assignees.some(x => x.id === q.assignee)) && (!q.from || !!d.occurredAt && d.occurredAt.slice(0, 10) >= q.from) && (!q.to || !!d.occurredAt && d.occurredAt.slice(0, 10) <= q.to); }
export async function access(identity: IdentityService, token: string | undefined, contextId: string, s: SearchAccess['s']): Promise<SearchAccess> { const p = (await identity.principal(s, token)); (await authorize(s, p, 'search.read', { id: contextId, contextId, kind: 'search', visibility: 'public' }, identity.clock)); return { s, p, clock: identity.clock, contextId }; }
export class SearchService {
    constructor(public identity: IdentityService) { }
    async contexts(token: string | undefined) { return this.identity.repo.transaction(async (s) => { const p = (await this.identity.principal(s, token)); return { contexts: (await asyncFilter((await s.list('context')), async (c) => (await decide(s, p, 'context.read', contextResource(c.id), this.identity.clock)).allowed)).map(projectContext), actor: { id: p.user.id, role: p.user.data.role }, sideEffects: 'none' as const }; }); }
    async list(token: string | undefined, params: URLSearchParams): Promise<SearchList> { const q = searchQuery(params); return this.identity.repo.transaction(async (s) => { const a = (await access(this.identity, token, q.context, s)), all = (await collectDocuments(a)), filtered = all.filter(d => matches(d, q)).sort((a, b) => (b.occurredAt ?? '').localeCompare(a.occurredAt ?? '') || a.key.localeCompare(b.key)); return { query: q, items: filtered.slice((q.page - 1) * q.pageSize, q.page * q.pageSize).map(publicHit), total: filtered.length, page: q.page, pageSize: q.pageSize, pages: Math.ceil(filtered.length / q.pageSize), filters: { assignees: [...new Map(all.flatMap(d => d.assignees.map(x => [x.id, { id: x.id, label: x.label }] as const))).values()].sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id)), kinds: [...new Set(all.map(d => d.kind))].sort(), statuses: [...new Set(all.map(d => d.status).filter(Boolean))].sort(), actors: [...new Map(all.flatMap(d => d.actor.id ? [[d.actor.id, { id: d.actor.id, label: d.actor.label }] as const] : [])).values()].sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id)) }, capabilities: { audit: (await decide(s, a.p, 'audit.read', { id: q.context, contextId: q.context, kind: 'audit', visibility: 'internal' }, a.clock)).allowed }, notice: '현재 열람 권한으로 검색합니다. 과거 기록의 상태와 현재 업무 상태는 별개이며, 검색은 읽음·알림 발송을 기록하지 않습니다.' }; }); }
    async detail(token: string | undefined, contextId: string, kind: string, id: string): Promise<SearchDetail> {
        if (!/^[A-Za-z0-9_-]{1,160}$/.test(id) || !/^[A-Za-z][A-Za-z0-9]{0,80}$/.test(kind))
            fail('VALIDATION', 422, '정확한 기록을 선택해 주세요.');
        searchQuery(new URLSearchParams({ context: contextId }));
        return this.identity.repo.transaction(async (s) => {
            const a = (await access(this.identity, token, contextId, s)), d = (await collectDocuments(a)).find(d => d.sourceKind === kind && d.sourceId === id);
            if (!d)
                unavailable();
            return { item: publicHit(d), fields: d.fields, files: d.files, notice: d.sourcePrecision === 'exact_version' ? '지정한 저장 버전입니다. 원본 화면 링크는 표시된 정확도에 따라 현재 화면으로 이동할 수 있습니다.' : '현재 기록입니다. 저장되지 않은 과거 상태를 추정하지 않습니다.' };
        });
    }
}
