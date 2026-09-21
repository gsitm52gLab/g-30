import type { ExternalWait, QuestionState } from './types';
export interface MessageInput { clientMessageId: string; body: string; fileVersionIds: string[] }
interface Intent { idempotencyKey: string }
export interface CreateConversationInput extends Intent {
    contextId: string;
    taskId: string | null;
    title: string;
    question: MessageInput;
}
/** actor, timestamps, visibility, participant IDs and cursors are server-owned. */
export type InquiryCommand = Intent & (
    { command: 'question'; expectedRevision: number; content: MessageInput } |
    { command: 'message'; kind: 'comment' | 'acknowledgement'; questionId: string | null; content: MessageInput } |
    { command: 'answer' | 'supplement'; questionId: string; expectedQuestionRevision: number; content: MessageInput } |
    { command: 'internal_note'; questionId: string | null; content: MessageInput } |
    { command: 'state'; questionId: string; expectedQuestionRevision: number; state: Exclude<QuestionState, 'resolved' | 'external_waiting'>; reason: string; externalWait: null } |
    { command: 'state'; questionId: string; expectedQuestionRevision: number; state: 'external_waiting'; reason: string; externalWait: ExternalWait } |
    { command: 'link_task'; expectedRevision: number; taskId: string } |
    { command: 'read'; throughMessageId: string }
);
export interface InquiryListQuery {
    contextId: string;
    taskId: string | null;
    state: 'all' | 'unresolved';
    limit: number;
    offset: number;
}
export interface InquiryEventsQuery { after: string | null; limit: number }
