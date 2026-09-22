// Explicit asynchronous counterpart of src/domain/inquiries/constraints.ts; source hash tracked in source-map.json.
import type { AsyncUnitOfWork as UnitOfWork } from '../types';
import { StoreError, type RecordKind, type RecordInput } from "@/domain/records";
const immutable: RecordKind[] = ['inquiryMessage', 'inquiryRead', 'inquiryTransition', 'inquiryTaskLink', 'inquiryEvent', 'inquiryCursor'];
export async function inquiryRelations<K extends RecordKind>(s: UnitOfWork, kind: K, input: RecordInput<K>) {
    if (kind !== 'conversation' && kind !== 'inquiryQuestion' && !immutable.includes(kind))
        return;
    const bad = () => { throw new StoreError('INVALID_RECORD'); };
    if (!input.contextId || !(await s.get('context', input.contextId)))
        bad();
    if (immutable.includes(kind) && (await s.get(kind, input.id)))
        bad();
    const d = input.data as unknown as Record<string, unknown>;
    if (kind === 'conversation') {
        if (!(await s.get('user', String(d.initiatorId))) || !(await s.get('user', String(d.createdBy))) || !['draft', 'active'].includes(String(d.phase)))
            bad();
        if (d.taskId !== null && (await s.get('task', String(d.taskId)))?.contextId !== input.contextId)
            bad();
        return;
    }
    if (typeof d.conversationId !== 'string' || (await s.get('conversation', d.conversationId))?.contextId !== input.contextId)
        bad();
    const sameQuestion = async (id: unknown) => typeof id === 'string' && (await s.get('inquiryQuestion', id))?.data.conversationId === d.conversationId;
    if (kind === 'inquiryQuestion' && !(await s.get('user', String(d.createdBy))))
        bad();
    if (kind === 'inquiryMessage') {
        if (!(await s.get('user', String(d.authorId))) || d.questionId !== null && !(await sameQuestion(d.questionId)))
            bad();
        if ((await s.list('inquiryMessage')).some(r => r.data.conversationId === d.conversationId && r.data.authorId === d.authorId && r.data.clientMessageId === d.clientMessageId))
            throw new StoreError('CONFLICT');
    }
    if (kind === 'inquiryTransition' && (!(await sameQuestion(d.questionId)) || !(await s.get('user', String(d.actorId)))))
        bad();
    if (kind === 'inquiryRead') {
        const m = (await s.get('inquiryMessage', String(d.throughMessageId)));
        if (!(await s.get('user', String(d.userId))) || m?.data.conversationId !== d.conversationId || m?.data.visibility !== 'public')
            bad();
        if ((await s.list('inquiryRead')).some(r => r.data.conversationId === d.conversationId && r.data.userId === d.userId && r.data.throughMessageId === d.throughMessageId))
            throw new StoreError('CONFLICT');
    }
    if (kind === 'inquiryTaskLink' && ((await s.get('task', String(d.taskId)))?.contextId !== input.contextId || !(await s.get('user', String(d.actorId)))))
        bad();
    if (kind === 'inquiryEvent' && (await s.list('inquiryEvent')).some(r => r.data.conversationId === d.conversationId && r.data.lane === d.lane && r.data.position === d.position))
        throw new StoreError('CONFLICT');
    if (kind === 'inquiryCursor' && (!(await s.get('user', String(d.userId))) || (await s.list('inquiryCursor')).some(r => r.data.token === d.token)))
        bad();
}
