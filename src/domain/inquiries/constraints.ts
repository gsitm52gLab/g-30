import { StoreError, type RecordKind, type RecordInput, type SyncUnitOfWork as UnitOfWork } from '../records';
const immutable: RecordKind[] = ['inquiryMessage','inquiryRead','inquiryTransition','inquiryTaskLink','inquiryEvent','inquiryCursor'];
export function inquiryRelations<K extends RecordKind>(s: UnitOfWork, kind: K, input: RecordInput<K>) {
    if (kind !== 'conversation' && kind !== 'inquiryQuestion' && !immutable.includes(kind)) return;
    const bad = () => { throw new StoreError('INVALID_RECORD'); };
    if (!input.contextId || !s.get('context', input.contextId)) bad();
    if (immutable.includes(kind) && s.get(kind, input.id)) bad();
    const d = input.data as unknown as Record<string, unknown>;
    if (kind === 'conversation') {
        if (!s.get('user',String(d.initiatorId)) || !s.get('user',String(d.createdBy)) || !['draft','active'].includes(String(d.phase))) bad();
        if (d.taskId !== null && s.get('task',String(d.taskId))?.contextId !== input.contextId) bad();
        return;
    }
    if (typeof d.conversationId !== 'string' || s.get('conversation',d.conversationId)?.contextId !== input.contextId) bad();
    const sameQuestion = (id: unknown) => typeof id === 'string' && s.get('inquiryQuestion',id)?.data.conversationId === d.conversationId;
    if (kind === 'inquiryQuestion' && !s.get('user',String(d.createdBy))) bad();
    if (kind === 'inquiryMessage') {
        if (!s.get('user',String(d.authorId)) || d.questionId !== null && !sameQuestion(d.questionId)) bad();
        if (s.list('inquiryMessage').some(r=>r.data.conversationId===d.conversationId && r.data.authorId===d.authorId && r.data.clientMessageId===d.clientMessageId)) throw new StoreError('CONFLICT');
    }
    if (kind === 'inquiryTransition' && (!sameQuestion(d.questionId) || !s.get('user',String(d.actorId)))) bad();
    if (kind === 'inquiryRead') {
        const m=s.get('inquiryMessage',String(d.throughMessageId));
        if (!s.get('user',String(d.userId)) || m?.data.conversationId!==d.conversationId || m?.data.visibility!=='public') bad();
        if(s.list('inquiryRead').some(r=>r.data.conversationId===d.conversationId&&r.data.userId===d.userId&&r.data.throughMessageId===d.throughMessageId)) throw new StoreError('CONFLICT');
    }
    if (kind === 'inquiryTaskLink' && (s.get('task',String(d.taskId))?.contextId!==input.contextId || !s.get('user',String(d.actorId)))) bad();
    if (kind === 'inquiryEvent' && s.list('inquiryEvent').some(r=>r.data.conversationId===d.conversationId&&r.data.lane===d.lane&&r.data.position===d.position)) throw new StoreError('CONFLICT');
    if (kind === 'inquiryCursor' && (!s.get('user',String(d.userId)) || s.list('inquiryCursor').some(r=>r.data.token===d.token))) bad();
}
