import { createHash, randomUUID } from 'node:crypto';
import type { RecordRepository, RecordKind } from '@/domain/records';
/** Private runner IPC/repository setup only. Never mounted on an application route. */
export interface NoticeFixtureInput { noticeId: string; action?: 'add_later_member' | 'extend_version' }
export async function noticeFixture(repo: RecordRepository, input: NoticeFixtureInput) {
    return repo.transaction(s => {
        const n = s.get('notice', input.noticeId);
        if (!n) throw new Error('synthetic notice missing');
        if (input.action === 'add_later_member') s.create('membership', { id: randomUUID(), contextId: n.contextId, data: { userId: 'user-none', role: 'brand', status: 'active', scope: '합성 신규 구성원', internalPriceAccess: false, activatedAt: new Date().toISOString(), suspendedAt: null } });
        if (input.action === 'extend_version') {
            const old = s.get('noticeVersion', n.data.currentVersionId!)!;
            const version = s.create('noticeVersion', { id: randomUUID(), contextId: n.contextId, data: { ...old.data, sequence: old.data.sequence + 1, previousId: old.id, unknownExtension: { private: 'G08_STORED_EXTENSION_CANARY' } } as typeof old.data });
            s.update('notice', n.id, n.revision, { ...n.data, currentVersionId: version.id });
        }
        const rows = (['notice', 'noticeVersion', 'noticeRead', 'domainEvent'] as const).map(kind => ({ kind, rows: s.list(kind, n.contextId!).filter(r => r.id === n.id || 'noticeId' in r.data && r.data.noticeId === n.id || 'targetId' in r.data && r.data.targetId === n.id) }));
        const businessKinds: RecordKind[] = ['task', 'requestVersion', 'taskActivity', 'submission', 'submissionDraft', 'productUseSnapshot', 'fileVersion'];
        const business = businessKinds.map(kind => ({ kind, rows: s.list(kind, n.contextId!) }));
        const sha = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
        return { rows, rowsSha256: sha(rows), businessSha256: sha(business), business, nativeNotice: s.get('notice', n.id) };
    });
}
export type NoticeFixtureSnapshot = Awaited<ReturnType<typeof noticeFixture>>;
