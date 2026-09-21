import type { ExternalWait, QuestionState } from './types';
export interface MessageInput { clientMessageId: string; body: string; fileVersionIds: string[] }
interface Intent { idempotencyKey: string }
/** Creates only a private owner-bound draft; no question/message is published. */
export interface CreateConversationDraftInput extends Intent {
    contextId: string;
    taskId: string | null;
}
export interface PublishFirstCommand extends Intent {
    command: 'publish_first';
    /** Positive private draft StoredRecord revision, not its zero publicRevision. */
    expectedRevision: number;
    title: string;
    content: MessageInput;
}
/** actor, timestamps, visibility, participant IDs and cursors are server-owned. */
export type InquiryCommand = PublishFirstCommand | Intent & (
    /** These expectedRevision fields refer to the active conversation's publicRevision. */
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
