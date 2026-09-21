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
function manageContext(s: UnitOfWork, p: Principal, contextId: string, clock: Clock) {
    authorize(s, p, 'notice.manage', { ...contextResource(contextId), kind: 'notice' }, clock);
}
function activeBrands(s: UnitOfWork, contextId: string) {
    return s.list('membership', contextId).filter(m => m.data.role === 'brand' && m.data.status === 'active').flatMap(m => { const u = s.get('user', m.data.userId); return u?.data.role === 'brand' && u.data.status === 'active' ? [u] : []; });
}
function validateReferences(s: UnitOfWork, p: Principal, n: StoredRecord<'notice'>, content: NoticeContent, clock: Clock, publishing = false) {
    const allowed = activeBrands(s, n.contextId!);
    if (content.audience.mode === 'selected' && content.audience.userIds.some(id => !allowed.some(u => u.id === id)))
        fail('VALIDATION', 422, '현재 컨텍스트의 활성 브랜드 사용자를 선택해 주세요.');
    for (const id of content.fileIds) {
        const f = s.get('fileVersion', id);
        if (!f)
            unavailable();
        canReferenceFile(s, p, f, noticeScope(s, n), clock);
        if (publishing && f.data.visibility !== 'public')
            fail('VALIDATION', 422, '내부 파일은 공개 공지에서 제외해 주세요.');
    }
    for (const id of content.taskIds) {
        const t = s.get('task', id);
        if (!t || t.contextId !== n.contextId)
            unavailable();
        authorize(s, p, 'task.read', taskScope(t), clock);
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
        return this.identity.repo.transaction(s => {
            const p = this.identity.principal(s, token);
            authorize(s, p, 'context.read', contextResource(contextId), this.clock);
            if (query.type && !noticeTypes.includes(query.type as typeof noticeTypes[number]) || query.state && !['draft', 'published', 'revised', 'unread'].includes(query.state))
                fail('VALIDATION', 422, '목록 필터를 확인해 주세요.');
            const canManage = decide(s, p, 'notice.manage', { ...contextResource(contextId), kind: 'notice' }, this.clock).allowed;
            const items = s.list('notice', contextId).filter(n => decide(s, p, 'notice.read', noticeScope(s, n), this.clock).allowed).flatMap(n => {
                const v = n.data.currentVersionId ? s.get('noticeVersion', n.data.currentVersionId) : null;
                const content = canManage ? n.data.draft : v?.data.content;
                if (!content)
                    return [];
                const ownReadAt = v ? nullableText(s.list('noticeRead', contextId).find(r => r.data.versionId === v.id && r.data.userId === p.user.id)?.data.readAt) : null;
                const state = !v ? 'draft' as const : canManage && JSON.stringify(n.data.draft) !== JSON.stringify(v.data.content) ? 'revised' as const : 'published' as const;
                return [{ id: n.id, revision: canManage ? n.revision : v ? noticeSequence(v) : 0, title: typeof content.title === 'string' ? content.title : '', type: noticeTypes.includes(content.type) ? content.type : 'notice' as const, category: typeof content.category === 'string' ? content.category : '', documentVersion: typeof content.documentVersion === 'string' ? content.documentVersion : '', state, currentVersionId: v?.id ?? null, sequence: v ? noticeSequence(v) : null, publishedAt: nullableText(v?.data.publishedAt), updatedAt: canManage ? n.updatedAt : nullableText(v?.data.publishedAt) ?? '', ownReadAt }];
            }).filter(n => (!query.q || `${n.title} ${n.category}`.toLowerCase().includes(query.q.toLowerCase())) && (!query.type || n.type === query.type) && (!query.state || query.state === 'unread' ? !query.state || !!n.currentVersionId && !n.ownReadAt : n.state === query.state)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
            return { context: projectContext(s.get('context', contextId)!), actorId: p.user.id, canManage, items, total: items.length };
        });
    }
    async create(token: string | undefined, input: Record<string, unknown>) {
        const v = object(input, ['contextId', 'content', 'idempotencyKey']), contextId = str(v.contextId, 160, true), content = noticeInput(v.content);
        return this.identity.repo.transaction(s => {
            const p = this.identity.principal(s, token);
            manageContext(s, p, contextId, this.clock);
            return receipt(s, p, contextId, 'notice.create', v, () => {
                const n = s.create('notice', { id: newId(), contextId, data: { createdBy: p.user.id, draft: content, currentVersionId: null } });
                validateReferences(s, p, n, content, this.clock);
                audit(s, p, this.clock, contextId, 'notice.created', n.id, {}, {});
                return { ids: [n.id] };
            }, this.fault);
        });
    }
    async command(token: string | undefined, id: string, input: Record<string, unknown>) {
        const v = object(input, ['command', 'content', 'expectedRevision', 'versionId', 'idempotencyKey']), command = str(v.command, 30, true);
        if (!['save', 'publish', 'read'].includes(command))
            fail('VALIDATION', 422, '공지 동작을 확인해 주세요.');
        return this.identity.repo.transaction(s => {
            const p = this.identity.principal(s, token), r = resolveNotice(s, p, id, this.clock, command !== 'read', command === 'read' ? str(v.versionId, 160, true) : undefined), n = r.notice;
            return receipt(s, p, n.contextId!, `notice.${command}:${id}`, v, () => {
                if (command === 'read') {
                    const version = r.version!;
                    const old = s.list('noticeRead', n.contextId!).find(x => x.data.versionId === version.id && x.data.userId === p.user.id);
                    if (old)
                        return { ids: [old.id] };
                    const read = s.create('noticeRead', { id: newId(), contextId: n.contextId, data: { noticeId: id, versionId: version.id, userId: p.user.id, readAt: this.clock() } });
                    return { ids: [read.id] };
                }
                fresh(n, v.expectedRevision);
                if (command === 'save') {
                    const content = noticeInput(v.content);
                    validateReferences(s, p, n, content, this.clock);
                    s.update('notice', id, n.revision, { ...n.data, draft: content });
                    audit(s, p, this.clock, n.contextId!, 'notice.draft_saved', id, { revision: n.revision }, { revision: n.revision + 1 });
                    return { ids: [id] };
                }
                const content = noticeInput(n.data.draft, true);
                validateReferences(s, p, n, content, this.clock, true);
                const previous = r.current, version = s.create('noticeVersion', { id: newId(), contextId: n.contextId, data: { noticeId: id, sequence: (previous ? noticeSequence(previous) : 0) + 1, previousId: previous?.id ?? null, content, publishedBy: p.user.id, publishedAt: this.clock(), publishedRecipientUserIds: activeBrands(s, n.contextId!).filter(u => content.audience.mode === 'all' || content.audience.userIds.includes(u.id)).map(u => u.id) } });
                s.update('notice', id, n.revision, { ...n.data, currentVersionId: version.id });
                s.create('domainEvent', { id: newId(), contextId: n.contextId, data: { eventType: previous ? 'NOTICE_REVISED' : 'NOTICE_PUBLISHED', targetId: id, sourceVersionId: version.id, actorId: p.user.id, at: this.clock() } });
                audit(s, p, this.clock, n.contextId!, 'notice.published', id, { versionId: previous?.id ?? null }, { versionId: version.id });
                return { ids: [id, version.id] };
            }, this.fault);
        });
    }
    async detail(token: string | undefined, id: string, versionId?: string) {
        return this.identity.repo.transaction(s => {
            const p = this.identity.principal(s, token), r = resolveNotice(s, p, id, this.clock, false, versionId), n = r.notice, canManage = decide(s, p, 'notice.manage', r.scope, this.clock).allowed;
            const versions = s.list('noticeVersion', n.contextId!).filter(v => v.data.noticeId === id && decide(s, p, 'notice.read', noticeVersionScope(s, n, v), this.clock).allowed).sort((a, b) => b.data.sequence - a.data.sequence);
            const selected = r.version ? versionDTO(s, p, n, r.version, this.clock) : null;
            const basic = { id, context: projectContext(s.get('context', n.contextId!)!), actorId: p.user.id, revision: canManage ? n.revision : r.current ? noticeSequence(r.current) : 0, createdAt: n.createdAt, authorLabel: actorLabel(s, n.data.createdBy, n.contextId!, p), currentVersionId: r.current?.id ?? null, selected, versions: versions.map(v => versionDTO(s, p, n, v, this.clock)), capabilities: { manage: canManage, read: !!r.version } };
            if (!canManage)
                return basic;
            const members = activeBrands(s, n.contextId!).map(u => ({ id: u.id, name: typeof u.data.name === 'string' ? u.data.name : '' }));
            const audience = r.version?.data.content.audience, targets = members.filter(u => audience?.mode === 'all' || audience?.mode === 'selected' && audience.userIds.includes(u.id));
            const reads = r.version ? s.list('noticeRead', n.contextId!).filter(x => x.data.versionId === r.version!.id) : [];
            const files = s.list('fileVersion', n.contextId!).filter(f => visibleFile(s, p, f, r.scope, this.clock)).map(f => fileDTO(s, p, f, id));
            return { ...basic, draft: noticeInput(n.data.draft), draftPreview: publicContent(s, p, n, n.data.draft, this.clock), members, files, roster: { targetCount: targets.length, targets: targets.map(u => ({ ...u, readAt: nullableText(reads.find(x => x.data.userId === u.id)?.data.readAt) })), reads: reads.map(x => ({ userId: x.data.userId, name: actorLabel(s, x.data.userId, n.contextId!, p), readAt: nullableText(x.data.readAt) })) } };
        });
    }
    async preview(token: string | undefined, id: string) { return this.identity.repo.transaction(s => { const p = this.identity.principal(s, token), r = resolveNotice(s, p, id, this.clock, true); return publicContent(s, p, r.notice, r.notice.data.draft, this.clock); }); }
}
export type NoticeList = Awaited<ReturnType<NoticeService['list']>>;
export type NoticeDetail = Awaited<ReturnType<NoticeService['detail']>>;
