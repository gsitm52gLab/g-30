import { asyncFlatMap, asyncMap } from "@/domain/async-collections";
import type { Clock, StoredRecord, UnitOfWork } from '@/domain/records';
import type { Principal } from '@/server/auth/service';
import type { InquiryFileDTO, QuestionDTO, QuestionCounts, PublicMessageDTO, InternalMessageDTO, InquiryReadDTO, InquiryHistoryDTO, ConversationSummaryDTO } from '@/domain/inquiries/types';
import { fileUrls } from '@/server/files/service';
import { canReferenceFile } from '@/server/files/access';
import { label, inquiryScope, inquiryFileIncluded, visibleTask } from './access';
import * as safe from './stored';
export async function messages(s: UnitOfWork, c: StoredRecord<'conversation'>, internal = false) { return (await s.list('inquiryMessage', c.contextId!)).filter(m => m.data.conversationId === c.id).filter(m => { if (m.data.visibility !== 'public' && m.data.visibility !== 'internal')
    safe.corrupt(); return m.data.visibility === (internal ? 'internal' : 'public'); }).map(m => ({ ...m, data: safe.message(m.data) })).sort((a, b) => a.data.sequence - b.data.sequence); }
export async function questions(s: UnitOfWork, c: StoredRecord<'conversation'>) { return (await s.list('inquiryQuestion', c.contextId!)).filter(q => q.data.conversationId === c.id).map(q => ({ ...q, data: safe.question(q.data) })); }
export async function counts(s: UnitOfWork, c: StoredRecord<'conversation'>): Promise<QuestionCounts> {
    const q = (await questions(s, c));
    return { questions: q.length, answered: q.filter(x => x.data.state === 'resolved').length, unresolved: q.filter(x => x.data.state !== 'resolved').length, waitingGsg: q.filter(x => x.data.state === 'gsg_waiting').length, waitingBrand: q.filter(x => x.data.state === 'brand_supplement_waiting').length, externalWaiting: q.filter(x => x.data.state === 'external_waiting').length };
}
export async function fileDTO(s: UnitOfWork, p: Principal, f: StoredRecord<'fileVersion'>, c: StoredRecord<'conversation'>, clock: Clock, messageId?: string): Promise<InquiryFileDTO> {
    if (!(await inquiryFileIncluded(s, p, f, c.id, clock, messageId)))
        safe.corrupt();
    (await canReferenceFile(s, p, f, inquiryScope(c), clock));
    const d = f.data, hash = safe.text(d.sha256, 64);
    if (!/^[a-f0-9]{64}$/.test(hash) || typeof d.preview !== 'boolean' || !['public', 'internal'].includes(d.visibility))
        safe.corrupt();
    return { visibility: d.visibility, id: safe.id(f.id), name: safe.text(d.originalName, 240), bytes: safe.count(d.bytes, 1), mime: safe.text(d.mime, 200), sha256: hash, uploaderLabel: (await label(s, p, safe.id(d.uploaderId), c.contextId!)), uploadedAt: safe.timestamp(f.createdAt), ...fileUrls(f, { kind: 'inquiry', conversationId: c.id, ...messageId ? { messageId } : {} }) };
}
export async function messageDTO(s: UnitOfWork, p: Principal, m: StoredRecord<'inquiryMessage'>, c: StoredRecord<'conversation'>, clock: Clock): Promise<PublicMessageDTO | InternalMessageDTO> {
    const d = safe.message(m.data);
    if (d.conversationId !== c.id || m.contextId !== c.contextId || d.visibility === 'internal' && p.user.data.role !== 'gsg')
        safe.corrupt();
    const files = (await asyncMap(d.fileVersionIds, async (id) => { const f = (await s.get('fileVersion', id)); if (!f)
        safe.corrupt(); return (await fileDTO(s, p, f, c, clock, m.id)); }));
    return { id: safe.id(m.id), conversationId: c.id, questionId: d.questionId, clientMessageId: d.clientMessageId, kind: d.kind, body: d.body, authorLabel: (await label(s, p, d.authorId, c.contextId!)), createdAt: d.createdAt, files };
}
export async function questionDTO(s: UnitOfWork, p: Principal, q: StoredRecord<'inquiryQuestion'>, c: StoredRecord<'conversation'>): Promise<QuestionDTO> {
    const d = safe.question(q.data);
    if (d.conversationId !== c.id || q.contextId !== c.contextId)
        safe.corrupt();
    const e = d.externalWait;
    return { id: safe.id(q.id), revision: safe.count(q.revision, 1), openingMessageId: d.openingMessageId, state: d.state, latestAnswerMessageId: d.latestAnswerMessageId, lastResolvedAt: d.lastResolvedAt, externalWait: e ? { counterparty: e.counterparty, sentAt: e.sentAt, responsibleLabel: (await label(s, p, e.responsibleUserId, c.contextId!)), nextCheckDate: e.nextCheckDate, timezone: e.timezone, latestResult: e.latestResult } : null };
}
export async function readDTO(s: UnitOfWork, p: Principal, r: StoredRecord<'inquiryRead'>, c: StoredRecord<'conversation'>): Promise<InquiryReadDTO> {
    const d = safe.object(r.data);
    if (d.conversationId !== c.id || r.contextId !== c.contextId)
        safe.corrupt();
    const messageId = safe.id(d.throughMessageId), m = (await s.get('inquiryMessage', messageId));
    if (!m || m.data.conversationId !== c.id || m.data.visibility !== 'public')
        safe.corrupt();
    return { userLabel: (await label(s, p, safe.id(d.userId), c.contextId!)), throughMessageId: messageId, at: safe.timestamp(d.at) };
}
async function projectWait(s: UnitOfWork, p: Principal, c: StoredRecord<'conversation'>, e: import('@/domain/inquiries/types').ExternalWait | null): Promise<QuestionDTO['externalWait']> { return e ? { counterparty: e.counterparty, sentAt: e.sentAt, responsibleLabel: (await label(s, p, e.responsibleUserId, c.contextId!)), nextCheckDate: e.nextCheckDate, timezone: e.timezone, latestResult: e.latestResult } : null; }
export async function history(s: UnitOfWork, p: Principal, c: StoredRecord<'conversation'>, clock: Clock): Promise<InquiryHistoryDTO[]> {
    const transitions = (await asyncMap((await s.list('inquiryTransition', c.contextId!)).filter(t => t.data.conversationId === c.id), async (t) => { const d = t.data; return { id: safe.id(t.id), actorLabel: (await label(s, p, safe.id(d.actorId), c.contextId!)), at: safe.timestamp(d.at), action: 'question_state' as const, questionId: safe.id(d.questionId), from: d.from === null ? null : safe.state(d.from), to: safe.state(d.to), reason: safe.text(d.reason, 2000), sourceMessageId: safe.nullableId(d.sourceMessageId), externalWait: (await projectWait(s, p, c, safe.external(d.externalWait))) }; }));
    const links = (await asyncMap((await s.list('inquiryTaskLink', c.contextId!)).filter(t => t.data.conversationId === c.id), async (t) => { const d = t.data; return { id: safe.id(t.id), actorLabel: (await label(s, p, safe.id(d.actorId), c.contextId!)), at: safe.timestamp(d.at), action: 'task_link' as const, previousTask: (await visibleTask(s, p, safe.nullableId(d.previousTaskId), c.contextId!, clock)), task: (await visibleTask(s, p, safe.id(d.taskId), c.contextId!, clock)) }; }));
    return [...transitions, ...links].sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
}
export async function summary(s: UnitOfWork, p: Principal, c: StoredRecord<'conversation'>, clock: Clock): Promise<ConversationSummaryDTO> {
    const d = safe.conversation(c.data);
    if (d.phase !== 'active')
        safe.corrupt();
    const publicMessages = (await messages(s, c));
    const ownReads = (await s.list('inquiryRead', c.contextId!)).filter(r => r.data.conversationId === c.id && r.data.userId === p.user.id);
    let through = 0;
    for (const r of ownReads) {
        (await readDTO(s, p, r, c));
        const m = publicMessages.find(x => x.id === r.data.throughMessageId);
        if (!m)
            safe.corrupt();
        through = Math.max(through, m.data.sequence);
    }
    return { phase: 'active', id: c.id, contextId: c.contextId!, title: d.title, revision: d.publicRevision, initiatorLabel: (await label(s, p, d.initiatorId, c.contextId!)), task: (await visibleTask(s, p, d.taskId, c.contextId!, clock)), counts: (await counts(s, c)), unreadCount: publicMessages.filter(m => m.data.authorId !== p.user.id && m.data.sequence > through).length, createdAt: d.activatedAt, updatedAt: d.publicUpdatedAt, lastResolvedAt: d.lastResolvedAt, nextChecks: (await asyncFlatMap((await questions(s, c)), async (q) => { const e = q.data.externalWait; return e ? [{ questionId: q.id, date: e.nextCheckDate, timezone: e.timezone, responsibleLabel: (await label(s, p, e.responsibleUserId, c.contextId!)) }] : []; })).sort((a, b) => a.date.localeCompare(b.date)) };
}
