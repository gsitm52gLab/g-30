import { canReferenceFile } from '@/server/files/access';
import { noticeVersionScope } from '@/server/notices/access';
import type { SearchDocument } from '@/domain/search/types';
import { resolveNotice } from '@/server/notices/access';
import { publicContent, versionDTO as noticeVersion } from '@/server/notices/projection';
import { resolveInquiry } from '@/server/inquiries/access';
import { messageDTO, summary, history, questionDTO } from '@/server/inquiries/projection';
import { document, field, fields, visible, url, text, type SearchAccess } from './safe';
export async function communicationDocuments(a: SearchAccess): Promise<SearchDocument[]> {
    const { s, p, clock, contextId } = a, docs: SearchDocument[] = [];
    for (const n of (await s.list('notice', contextId))) {
        if (p.user.data.role === 'gsg' && (await visible(async () => (await resolveNotice(s, p, n.id, clock, true))))) {
            const c = (await publicContent(s, p, n, n.data.draft, clock));
            docs.push((await document(a, 'notice', n, n.id, c.title, [field('초안 본문', c.body), field('문서 버전', c.documentVersion)], url(`/notices/${n.id}`, contextId), { current: true, at: n.updatedAt, actor: n.data.createdBy, status: 'draft', statusPrecision: 'current' })));
        }
        for (const v of (await s.list('noticeVersion', contextId)).filter(v => v.data.noticeId === n.id)) {
            if (!(await visible(async () => (await resolveNotice(s, p, n.id, clock, false, v.id)))))
                continue;
            for (const id of v.data.content.fileIds) {
                const file = (await s.get('fileVersion', id));
                if (file && file.data.visibility === 'public')
                    (await visible(async () => (await canReferenceFile(s, p, file, (await noticeVersionScope(s, n, v)), clock))));
            }
            const d = (await noticeVersion(s, p, n, v, clock)), c = d.content;
            fields(v.data.content as unknown as Record<string, unknown>, { title: '제목', body: '내용', category: '분류', documentVersion: '문서 버전', changeSummary: '변경 요약' });
            const fs = c.files.map(f => ({ id: f.id, name: text(f.name), downloadUrl: f.downloadUrl, previewUrl: f.previewUrl }));
            docs.push((await document(a, 'notice', v, n.id, c.title, [...fields(c, { body: '내용', category: '분류', documentVersion: '문서 버전', changeSummary: '변경 요약' }), ...fs.map(f => field('파일명', f.name))], url(`/notices/${n.id}`, contextId, { version: v.id }), { current: v.id === n.data.currentVersionId, version: d.sequence, at: d.publishedAt, actor: v.data.publishedBy, status: c.type, statusPrecision: 'historical', files: fs, exactSource: true })));
        }
    }
    for (const c of (await s.list('conversation', contextId))) {
        if (!(await visible(async () => (await resolveInquiry(s, p, c.id, clock)))) || c.data.phase !== 'active')
            continue;
        const d = (await summary(s, p, c, clock)), link = url(`/inquiries/${c.id}`, contextId);
        docs.push((await document(a, 'inquiry', c, c.id, d.title, [field('문의 제목', d.title)], link, { current: true, at: d.updatedAt, actor: c.data.initiatorId, taskId: d.task?.id, status: 'active' })));
        for (const m of (await s.list('inquiryMessage', contextId)).filter(m => m.data.conversationId === c.id)) {
            if (p.user.data.role !== 'gsg' && m.data.visibility === 'internal')
                continue;
            const v = (await messageDTO(s, p, m, c, clock)), q = m.data.questionId ? (await s.get('inquiryQuestion', m.data.questionId)) : null, qd = q ? (await questionDTO(s, p, q, c)) : null;
            const fs = v.files.map(f => ({ id: f.id, name: text(f.name), downloadUrl: f.downloadUrl, previewUrl: f.previewUrl }));
            docs.push((await document(a, 'inquiry', m, c.id, d.title, [field(m.data.visibility === 'internal' ? '내부 메모' : '대화', v.body), ...fs.map(f => field('파일명', f.name)), ...qd?.externalWait ? [field('외부 대기처', qd.externalWait.counterparty), field('외부 결과', qd.externalWait.latestResult)] : []], link, { current: true, precision: 'exact_version', at: v.createdAt, actor: m.data.authorId, status: qd?.state ?? v.kind, statusPrecision: 'current', taskId: d.task?.id, files: fs })));
        }
        for (const h of (await history(s, p, c, clock))) {
            const r = h.action === 'question_state' ? (await s.get('inquiryTransition', h.id)) : (await s.get('inquiryTaskLink', h.id));
            if (!r)
                continue;
            docs.push((await document(a, 'inquiry', r, c.id, d.title, h.action === 'question_state' ? [field('변경 전 상태', h.from), field('변경 후 상태', h.to), field('사유', h.reason)] : [field('연결 업무', h.task?.title), field('이전 업무', h.previousTask?.title)], link, { current: false, precision: 'exact_version', at: h.at, actor: r.data.actorId, status: h.action === 'question_state' ? h.to : 'task_link', statusPrecision: 'historical', taskId: d.task?.id })));
        }
    }
    return docs;
}
