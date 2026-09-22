import { asyncFlatMap } from "@/domain/async-collections";
import { fail } from '@/server/auth/errors';
import type { Clock, StoredRecord, UnitOfWork } from '@/domain/records';
import type { Principal } from '@/server/auth/service';
import type { NoticeContent } from '@/domain/notices/types';
import { noticeTypes } from '@/domain/notices/types';
import { decide, activeMember } from '@/server/policy/policy';
import { taskScope } from '@/server/policy/projection';
import { fileMetadata, fileUrls } from '@/server/files/service';
import { visibleFile } from '@/server/files/access';
import { noticeScope, noticeVersionScope } from './access';
const text = (v: unknown) => typeof v === 'string' ? v : '';
export const nullableText = (v: unknown) => typeof v === 'string' ? v : null;
export async function actorLabel(s: UnitOfWork, id: string, contextId: string, p: Principal) {
    const u = (await s.get('user', id));
    return u && (id === p.user.id || (await activeMember(s, id, contextId))) ? text(u.data.name) : '작성자 정보 비공개';
}
export async function fileDTO(s: UnitOfWork, p: Principal, f: StoredRecord<'fileVersion'>, noticeId: string, versionId?: string) {
    return { ...fileMetadata(f), ...fileUrls(f, { kind: 'notice', noticeId, ...versionId ? { versionId } : {} }), uploaderLabel: (await actorLabel(s, f.data.uploaderId, f.contextId!, p)), uploadedAt: f.createdAt };
}
export async function publicContent(s: UnitOfWork, p: Principal, notice: StoredRecord<'notice'>, content: NoticeContent, clock: Clock, version?: StoredRecord<'noticeVersion'>) {
    const scope = version ? (await noticeVersionScope(s, notice, version)) : (await noticeScope(s, notice));
    const files = (await asyncFlatMap((Array.isArray(content.fileIds) ? content.fileIds : []), async (id) => { const f = typeof id === 'string' ? (await s.get('fileVersion', id)) : null; return f && f.data.visibility === 'public' && (await visibleFile(s, p, f, scope, clock)) ? [(await fileDTO(s, p, f, notice.id, version?.id))] : []; }));
    const tasks = (await asyncFlatMap((Array.isArray(content.taskIds) ? content.taskIds : []), async (id) => {
        const t = typeof id === 'string' ? (await s.get('task', id)) : null;
        if (!t || t.contextId !== notice.contextId || taskScope(t).visibility !== 'public' || !(await decide(s, p, 'task.read', taskScope(t), clock)).allowed)
            return [];
        const activities = (await s.list('taskActivity', t.contextId!)).filter(a => a.data.taskId === t.id && a.data.requestId === t.data.currentRequestId && a.data.userId === p.user.id);
        const submissions = (await s.list('submission', t.contextId!)).filter(v => v.data.taskId === t.id).sort((a, b) => b.data.sequence - a.data.sequence);
        return [{ id: t.id, title: text(t.data.title), status: text(t.data.status), requestId: nullableText(t.data.currentRequestId), ownReadAt: nullableText(activities.find(a => a.data.kind === 'read')?.data.at), ownAcceptedAt: nullableText(activities.find(a => a.data.kind === 'accept')?.data.at), latestSubmittedAt: nullableText(submissions[0]?.data.submittedAt), completed: t.data.status === 'completed', url: `/tasks/${encodeURIComponent(t.id)}?context=${encodeURIComponent(t.contextId!)}` }];
    }));
    return { title: text(content.title), body: text(content.body), type: noticeTypes.includes(content.type) ? content.type : 'notice' as const, category: text(content.category), documentVersion: text(content.documentVersion), changeSummary: text(content.changeSummary), files, tasks };
}
export function noticeSequence(v: StoredRecord<'noticeVersion'>): number {
    if (!Number.isSafeInteger(v.data.sequence) || v.data.sequence < 1)
        fail('STORAGE_UNAVAILABLE', 503, '공지 버전 정보를 확인할 수 없습니다. 관리자에게 확인을 요청해 주세요.');
    return v.data.sequence;
}
export async function versionDTO(s: UnitOfWork, p: Principal, n: StoredRecord<'notice'>, v: StoredRecord<'noticeVersion'>, clock: Clock) {
    const previous = typeof v.data.previousId === 'string' ? (await s.get('noticeVersion', v.data.previousId)) : null;
    const previousId = previous && (await decide(s, p, 'notice.read', (await noticeVersionScope(s, n, previous)), clock)).allowed ? previous.id : null;
    return { id: v.id, sequence: noticeSequence(v), previousId, publishedAt: text(v.data.publishedAt), authorLabel: (await actorLabel(s, v.data.publishedBy, n.contextId!, p)), content: (await publicContent(s, p, n, v.data.content, clock, v)), ownReadAt: nullableText((await s.list('noticeRead', n.contextId!)).find(r => r.data.versionId === v.id && r.data.userId === p.user.id)?.data.readAt) };
}
