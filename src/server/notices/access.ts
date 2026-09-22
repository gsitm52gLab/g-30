import { asyncSome } from "@/domain/async-collections";
import type { Clock, StoredRecord, UnitOfWork } from '@/domain/records';
import type { Principal } from '@/server/auth/service';
import type { ResourceScope } from '@/server/policy/types';
import { authorize, decide } from '@/server/policy/policy';
import { unavailable, fail } from '@/server/auth/errors';
import type { NoticeContent } from '@/domain/notices/types';
function audience(content: NoticeContent): Pick<ResourceScope, 'audienceUserIds'> {
    // A rule, not a frozen membership list: later active context members can read all-member notices.
    if (content.audience?.mode === 'all')
        return {};
    return { audienceUserIds: Array.isArray(content.audience?.userIds) ? content.audience.userIds.filter(x => typeof x === 'string') : [] };
}
export async function noticeScope(s: UnitOfWork, notice: StoredRecord<'notice'>): Promise<ResourceScope> {
    const current = notice.data.currentVersionId ? (await s.get('noticeVersion', notice.data.currentVersionId)) : null;
    if (notice.data.currentVersionId && (!current || current.data.noticeId !== notice.id || current.contextId !== notice.contextId))
        unavailable();
    return { id: notice.id, contextId: notice.contextId, kind: 'notice', visibility: current ? 'public' : 'draft', ...(current ? audience(current.data.content) : {}) };
}
export async function noticeVersionScope(s: UnitOfWork, notice: StoredRecord<'notice'>, version: StoredRecord<'noticeVersion'>): Promise<ResourceScope> {
    if (version.data.noticeId !== notice.id || version.contextId !== notice.contextId)
        unavailable();
    return { id: notice.id, contextId: notice.contextId, kind: 'notice', visibility: 'public', ...audience(version.data.content), sourceScopes: [(await noticeScope(s, notice))] };
}
export async function resolveNotice(s: UnitOfWork, p: Principal, id: string, clock: Clock, edit = false, versionId?: string) {
    if (versionId !== undefined && (typeof versionId !== 'string' || !/^[-\w]{1,160}$/.test(versionId)))
        fail('VALIDATION', 422, '정확한 공개 버전을 지정해 주세요.');
    const notice = (await s.get('notice', id));
    if (!notice?.contextId)
        unavailable();
    const scope = (await noticeScope(s, notice));
    (await authorize(s, p, edit ? 'notice.manage' : 'notice.read', scope, clock));
    const current = notice.data.currentVersionId ? (await s.get('noticeVersion', notice.data.currentVersionId)) : null;
    const version = versionId ? (await s.get('noticeVersion', versionId)) : current;
    if (versionId && !version)
        unavailable();
    if (version)
        (await authorize(s, p, 'notice.read', (await noticeVersionScope(s, notice, version)), clock));
    return { notice, current, version, scope };
}
export async function releasedNoticeFile(s: UnitOfWork, p: Principal, file: StoredRecord<'fileVersion'>, clock: Clock) {
    const owner = file.data.owner;
    if (owner?.kind !== 'notice')
        return false;
    const notice = (await s.get('notice', owner.noticeId));
    if (!notice || notice.contextId !== file.contextId)
        return false;
    return (await asyncSome((await s.list('noticeVersion', file.contextId!)), async (v) => v.data.noticeId === notice.id && v.data.content.fileIds.includes(file.id) && (await decide(s, p, 'notice.read', (await noticeVersionScope(s, notice, v)), clock)).allowed));
}
