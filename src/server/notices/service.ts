import { asyncFilter, asyncFlatMap, asyncMap } from "@/domain/async-collections";
import type { Clock, UnitOfWork, StoredRecord } from '@/domain/records';
import type { Principal, IdentityService } from '@/server/auth/service';
import { fail, unavailable } from '@/server/auth/errors';
import { object, str } from '@/domain/tasks/validate';
import { noticeInput } from '@/domain/notices/validate';
import type { NoticeContent } from '@/domain/notices/types';
import { noticeTypes } from '@/domain/notices/types';
import { authorize, decide } from '@/server/policy/policy';
import { contextResource } from '@/server/policy/types';
import { projectContext, taskScope } from '@/server/policy/projection';
import { newId, receipt, fresh, audit } from '@/server/products/store';
import { canReferenceFile, visibleFile } from '@/server/files/access';
import { resolveNotice, noticeScope, noticeVersionScope } from './access';
import { actorLabel, fileDTO, publicContent, versionDTO, nullableText, noticeSequence } from './projection';
async function manageContext(s: UnitOfWork, p: Principal, contextId: string, clock: Clock) {
    (await authorize(s, p, 'notice.manage', { ...contextResource(contextId), kind: 'notice' }, clock));
}
async function activeBrands(s: UnitOfWork, contextId: string) {
    return (await asyncFlatMap((await s.list('membership', contextId)).filter(m => m.data.role === 'brand' && m.data.status === 'active'), async (m) => { const u = (await s.get('user', m.data.userId)); return u?.data.role === 'brand' && u.data.status === 'active' ? [u] : []; }));
}
async function validateReferences(s: UnitOfWork, p: Principal, n: StoredRecord<'notice'>, content: NoticeContent, clock: Clock, publishing = false) {
    const allowed = (await activeBrands(s, n.contextId!));
    if (content.audience.mode === 'selected' && content.audience.userIds.some(id => !allowed.some(u => u.id === id)))
        fail('VALIDATION', 422, '현재 컨텍스트의 활성 브랜드 사용자를 선택해 주세요.');
    for (const id of content.fileIds) {
        const f = (await s.get('fileVersion', id));
        if (!f)
            unavailable();
        (await canReferenceFile(s, p, f, (await noticeScope(s, n)), clock));
        if (publishing && f.data.visibility !== 'public')
            fail('VALIDATION', 422, '내부 파일은 공개 공지에서 제외해 주세요.');
    }
    for (const id of content.taskIds) {
        const t = (await s.get('task', id));
        if (!t || t.contextId !== n.contextId)
            unavailable();
        (await authorize(s, p, 'task.read', taskScope(t), clock));
    }
}
export class NoticeService {
    constructor(public identity: IdentityService, private fault?: () => void) { }
    get clock() { return this.identity.clock; }
    async list(token: string | undefined, contextId: string, query: {
        q?: string;
        type?: string;
        state?: string;
    } = {}) {
        return this.identity.repo.transaction(async (s) => {
            const p = (await this.identity.principal(s, token));
            (await authorize(s, p, 'context.read', contextResource(contextId), this.clock));
            if (query.type && !noticeTypes.includes(query.type as typeof noticeTypes[number]) || query.state && !['draft', 'published', 'revised', 'unread'].includes(query.state))
                fail('VALIDATION', 422, '목록 필터를 확인해 주세요.');
            const canManage = (await decide(s, p, 'notice.manage', { ...contextResource(contextId), kind: 'notice' }, this.clock)).allowed;
            const items = (await asyncFlatMap((await asyncFilter((await s.list('notice', contextId)), async (n) => (await decide(s, p, 'notice.read', (await noticeScope(s, n)), this.clock)).allowed)), async (n) => {
                const v = n.data.currentVersionId ? (await s.get('noticeVersion', n.data.currentVersionId)) : null;
                const content = canManage ? n.data.draft : v?.data.content;
                if (!content)
                    return [];
                const ownReadAt = v ? nullableText((await s.list('noticeRead', contextId)).find(r => r.data.versionId === v.id && r.data.userId === p.user.id)?.data.readAt) : null;
                const state = !v ? 'draft' as const : canManage && JSON.stringify(n.data.draft) !== JSON.stringify(v.data.content) ? 'revised' as const : 'published' as const;
                return [{ id: n.id, revision: canManage ? n.revision : v ? noticeSequence(v) : 0, title: typeof content.title === 'string' ? content.title : '', type: noticeTypes.includes(content.type) ? content.type : 'notice' as const, category: typeof content.category === 'string' ? content.category : '', documentVersion: typeof content.documentVersion === 'string' ? content.documentVersion : '', state, currentVersionId: v?.id ?? null, sequence: v ? noticeSequence(v) : null, publishedAt: nullableText(v?.data.publishedAt), updatedAt: canManage ? n.updatedAt : nullableText(v?.data.publishedAt) ?? '', ownReadAt }];
            })).filter(n => (!query.q || `${n.title} ${n.category}`.toLowerCase().includes(query.q.toLowerCase())) && (!query.type || n.type === query.type) && (!query.state || query.state === 'unread' ? !query.state || !!n.currentVersionId && !n.ownReadAt : n.state === query.state)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
            return { context: projectContext((await s.get('context', contextId))!), actorId: p.user.id, canManage, items, total: items.length };
        });
    }
    async create(token: string | undefined, input: Record<string, unknown>) {
        const v = object(input, ['contextId', 'content', 'idempotencyKey']), contextId = str(v.contextId, 160, true), content = noticeInput(v.content);
        return this.identity.repo.transaction(async (s) => {
            const p = (await this.identity.principal(s, token));
            (await manageContext(s, p, contextId, this.clock));
            return (await receipt(s, p, contextId, 'notice.create', v, async () => {
                const n = (await s.create('notice', { id: newId(), contextId, data: { createdBy: p.user.id, draft: content, currentVersionId: null } }));
                (await validateReferences(s, p, n, content, this.clock));
                (await audit(s, p, this.clock, contextId, 'notice.created', n.id, {}, {}));
                return { ids: [n.id] };
            }, this.fault));
        });
    }
    async command(token: string | undefined, id: string, input: Record<string, unknown>) {
        const v = object(input, ['command', 'content', 'expectedRevision', 'versionId', 'idempotencyKey']), command = str(v.command, 30, true);
        if (!['save', 'publish', 'read'].includes(command))
            fail('VALIDATION', 422, '공지 동작을 확인해 주세요.');
        return this.identity.repo.transaction(async (s) => {
            const p = (await this.identity.principal(s, token)), r = (await resolveNotice(s, p, id, this.clock, command !== 'read', command === 'read' ? str(v.versionId, 160, true) : undefined)), n = r.notice;
            return (await receipt(s, p, n.contextId!, `notice.${command}:${id}`, v, async () => {
                if (command === 'read') {
                    const version = r.version!;
                    const old = (await s.list('noticeRead', n.contextId!)).find(x => x.data.versionId === version.id && x.data.userId === p.user.id);
                    if (old)
                        return { ids: [old.id] };
                    const read = (await s.create('noticeRead', { id: newId(), contextId: n.contextId, data: { noticeId: id, versionId: version.id, userId: p.user.id, readAt: this.clock() } }));
                    return { ids: [read.id] };
                }
                fresh(n, v.expectedRevision);
                if (command === 'save') {
                    const content = noticeInput(v.content);
                    (await validateReferences(s, p, n, content, this.clock));
                    (await s.update('notice', id, n.revision, { ...n.data, draft: content }));
                    (await audit(s, p, this.clock, n.contextId!, 'notice.draft_saved', id, { revision: n.revision }, { revision: n.revision + 1 }));
                    return { ids: [id] };
                }
                const content = noticeInput(n.data.draft, true);
                (await validateReferences(s, p, n, content, this.clock, true));
                const previous = r.current, version = (await s.create('noticeVersion', { id: newId(), contextId: n.contextId, data: { noticeId: id, sequence: (previous ? noticeSequence(previous) : 0) + 1, previousId: previous?.id ?? null, content, publishedBy: p.user.id, publishedAt: this.clock(), publishedRecipientUserIds: (await activeBrands(s, n.contextId!)).filter(u => content.audience.mode === 'all' || content.audience.userIds.includes(u.id)).map(u => u.id) } }));
                (await s.update('notice', id, n.revision, { ...n.data, currentVersionId: version.id }));
                (await s.create('domainEvent', { id: newId(), contextId: n.contextId, data: { eventType: previous ? 'NOTICE_REVISED' : 'NOTICE_PUBLISHED', targetId: id, sourceVersionId: version.id, actorId: p.user.id, at: this.clock() } }));
                (await audit(s, p, this.clock, n.contextId!, 'notice.published', id, { versionId: previous?.id ?? null }, { versionId: version.id }));
                return { ids: [id, version.id] };
            }, this.fault));
        });
    }
    async detail(token: string | undefined, id: string, versionId?: string) {
        return this.identity.repo.transaction(async (s) => {
            const p = (await this.identity.principal(s, token)), r = (await resolveNotice(s, p, id, this.clock, false, versionId)), n = r.notice, canManage = (await decide(s, p, 'notice.manage', r.scope, this.clock)).allowed;
            const versions = (await asyncFilter((await s.list('noticeVersion', n.contextId!)), async (v) => v.data.noticeId === id && (await decide(s, p, 'notice.read', (await noticeVersionScope(s, n, v)), this.clock)).allowed)).sort((a, b) => b.data.sequence - a.data.sequence);
            const selected = r.version ? (await versionDTO(s, p, n, r.version, this.clock)) : null;
            const basic = { id, context: projectContext((await s.get('context', n.contextId!))!), actorId: p.user.id, revision: canManage ? n.revision : r.current ? noticeSequence(r.current) : 0, createdAt: n.createdAt, authorLabel: (await actorLabel(s, n.data.createdBy, n.contextId!, p)), currentVersionId: r.current?.id ?? null, selected, versions: (await asyncMap(versions, async (v) => (await versionDTO(s, p, n, v, this.clock)))), capabilities: { manage: canManage, read: !!r.version } };
            if (!canManage)
                return basic;
            const members = (await activeBrands(s, n.contextId!)).map(u => ({ id: u.id, name: typeof u.data.name === 'string' ? u.data.name : '' }));
            const audience = r.version?.data.content.audience, targets = members.filter(u => audience?.mode === 'all' || audience?.mode === 'selected' && audience.userIds.includes(u.id));
            const reads = r.version ? (await s.list('noticeRead', n.contextId!)).filter(x => x.data.versionId === r.version!.id) : [];
            const files = (await asyncMap((await asyncFilter((await s.list('fileVersion', n.contextId!)), async (f) => (await visibleFile(s, p, f, r.scope, this.clock)))), async (f) => (await fileDTO(s, p, f, id))));
            return { ...basic, draft: noticeInput(n.data.draft), draftPreview: (await publicContent(s, p, n, n.data.draft, this.clock)), members, files, roster: { targetCount: targets.length, targets: targets.map(u => ({ ...u, readAt: nullableText(reads.find(x => x.data.userId === u.id)?.data.readAt) })), reads: (await asyncMap(reads, async (x) => ({ userId: x.data.userId, name: (await actorLabel(s, x.data.userId, n.contextId!, p)), readAt: nullableText(x.data.readAt) }))) } };
        });
    }
    async preview(token: string | undefined, id: string) { return this.identity.repo.transaction(async (s) => { const p = (await this.identity.principal(s, token)), r = (await resolveNotice(s, p, id, this.clock, true)); return (await publicContent(s, p, r.notice, r.notice.data.draft, this.clock)); }); }
}
export type NoticeList = Awaited<ReturnType<NoticeService['list']>>;
export type NoticeDetail = Awaited<ReturnType<NoticeService['detail']>>;
