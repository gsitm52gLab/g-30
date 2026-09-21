/** Standalone contracts. Repository wiring and authorization belong to the server stage. */
export type QuestionState = 'gsg_waiting' | 'brand_supplement_waiting' | 'external_waiting' | 'resolved';
export type PublicMessageKind = 'question' | 'comment' | 'acknowledgement' | 'answer' | 'supplement';
export interface ExternalWait {
    counterparty: string;
    /** An external contact fact, not the message's server-assigned creation time. */
    sentAt: string | null;
    responsibleUserId: string;
    nextCheckDate: string;
    timezone: string;
    latestResult: string;
}
interface ConversationBase {
    initiatorId: string;
    taskId: string | null;
    createdBy: string;
    createdAt: string;
    lastResolvedAt: string | null;
    lastReopenedAt: string | null;
}
/** Draft has no public question/event/counter. Its private CAS is the StoredRecord revision. */
export type ConversationData = ConversationBase & (
    { phase: 'draft'; title: ''; activatedAt: null; publicRevision: 0; publicSequence: 0; internalSequence: 0; publicUpdatedAt: null } |
    { phase: 'active'; title: string; activatedAt: string; publicRevision: number; publicSequence: number; internalSequence: number; publicUpdatedAt: string }
);
export interface QuestionData {
    conversationId: string;
    openingMessageId: string;
    state: QuestionState;
    externalWait: ExternalWait | null;
    latestAnswerMessageId: string | null;
    /** Latest resolution remains recorded when reopened; all resolutions also have history. */
    lastResolvedAt: string | null;
    createdBy: string;
    createdAt: string;
    updatedAt: string;
}
interface MessageBase {
    conversationId: string;
    questionId: string | null;
    clientMessageId: string;
    authorId: string;
    body: string;
    fileVersionIds: string[];
    createdAt: string;
    /** Private storage ordering within its visibility lane, not a public cursor. */
    sequence: number;
}
export type MessageData = MessageBase & (
    { visibility: 'public'; kind: PublicMessageKind } |
    { visibility: 'internal'; kind: 'internal_note' }
);
/** Immutable facts; later reads do not rewrite earlier receipts. */
export interface InquiryReadData {
    conversationId: string;
    userId: string;
    throughMessageId: string;
    at: string;
}
export interface QuestionTransitionData {
    conversationId: string;
    questionId: string;
    from: QuestionState | null;
    to: QuestionState;
    sourceMessageId: string | null;
    reason: string;
    externalWait: ExternalWait | null;
    actorId: string;
    at: string;
}
export interface InquiryTaskLinkData {
    conversationId: string;
    previousTaskId: string | null;
    taskId: string;
    actorId: string;
    at: string;
}
/** Durable pointers committed with their source facts; hydrate only after fresh permission. */
export type InquiryEventData = { conversationId: string; position: number; recordId: string; at: string } & (
    { lane: 'public'; kind: 'message' | 'question' | 'read' | 'task_link' } |
    { lane: 'internal'; kind: 'internal_message' }
);
/** Safe projected metadata only; storage paths/uploader grants never cross this boundary. */
export interface InquiryFileDTO {
    id: string;
    name: string;
    bytes: number;
    mime: string;
    sha256: string;
    uploaderLabel: string;
    uploadedAt: string;
    originalUrl: string;
    downloadUrl: string;
    previewUrl: string | null;
}
/** Multipart item; validating/writing bytes and current-owner authorization is server work. */
export interface InquiryUploadItem { clientItemId: string; name: string; type: string; bytes: Uint8Array }
export type InquiryUploadResult =
    { clientItemId: string; state: 'ready'; file: InquiryFileDTO } |
    { clientItemId: string; state: 'failed'; error: { code: string; message: string; retryable: boolean } };
export interface CreateConversationDraftResult { conversationId: string; phase: 'draft'; revision: number }
export interface PublicMessageDTO {
    id: string;
    conversationId: string;
    questionId: string | null;
    clientMessageId: string;
    kind: PublicMessageKind;
    body: string;
    authorLabel: string;
    createdAt: string;
    files: InquiryFileDTO[];
}
export interface InternalMessageDTO extends Omit<PublicMessageDTO, 'kind'> { kind: 'internal_note' }
export interface QuestionDTO {
    id: string;
    revision: number;
    openingMessageId: string;
    state: QuestionState;
    latestAnswerMessageId: string | null;
    lastResolvedAt: string | null;
    externalWait: (Omit<ExternalWait, 'responsibleUserId'> & { responsibleLabel: string }) | null;
}
export interface QuestionCounts {
    questions: number;
    answered: number;
    unresolved: number;
    waitingGsg: number;
    waitingBrand: number;
    externalWaiting: number;
}
export interface ConversationSummaryDTO {
    phase: 'active';
    id: string;
    contextId: string;
    title: string;
    revision: number;
    initiatorLabel: string;
    task: { id: string; title: string } | null;
    counts: QuestionCounts;
    unreadCount: number;
    createdAt: string;
    updatedAt: string;
    lastResolvedAt: string | null;
    nextChecks: { questionId: string; date: string; timezone: string; responsibleLabel: string }[];
}
export interface InquiryReadDTO { userLabel: string; throughMessageId: string; at: string }
export type InquiryHistoryDTO = { id: string; actorLabel: string; at: string } & (
    { action: 'question_state'; questionId: string; from: QuestionState | null; to: QuestionState; reason: string; sourceMessageId: string | null } |
    { action: 'task_link'; previousTask: { id: string; title: string } | null; task: { id: string; title: string } | null }
);
export interface DraftConversationDetailDTO {
    phase: 'draft';
    id: string;
    contextId: string;
    /** Positive private StoredRecord revision, even though publicRevision is zero. */
    revision: number;
    taskId: string | null;
    /** Only this currently authorized actor's ready files; no message publication implied. */
    files: InquiryFileDTO[];
    capabilities: { upload: boolean; publishFirst: boolean };
}
export interface ActiveConversationDetailDTO extends ConversationSummaryDTO {
    questions: QuestionDTO[];
    messages: PublicMessageDTO[];
    reads: InquiryReadDTO[];
    history: InquiryHistoryDTO[];
    capabilities: { send: boolean; ask: boolean; answer: boolean; supplement: boolean; manageState: boolean; linkTask: boolean; upload: boolean };
    cursor: string;
}
/** Staff-only fields must be constructed separately, never filtered in a client. */
export interface StaffConversationDetailDTO extends ActiveConversationDetailDTO {
    internalMessages: InternalMessageDTO[];
}
export type ConversationDetailDTO = DraftConversationDetailDTO | ActiveConversationDetailDTO | StaffConversationDetailDTO;
export interface InquiryCommandResult {
    conversationId: string;
    questionId: string | null;
    messageId: string | null;
    taskId: string | null;
}
/** Same shape for popup and full page; opaque tokens hide private ordering. */
export type PublicInquiryEvent =
    { type: 'message'; cursor: string; message: PublicMessageDTO } |
    { type: 'question'; cursor: string; question: QuestionDTO; counts: QuestionCounts } |
    { type: 'read'; cursor: string; read: InquiryReadDTO } |
    { type: 'task_link'; cursor: string; task: { id: string; title: string } | null } |
    { type: 'resync'; cursor: string; reason: 'cursor_unavailable' };
export type StaffInquiryEvent = PublicInquiryEvent | { type: 'internal_message'; cursor: string; message: InternalMessageDTO };
export interface InquiryEventPage<T extends PublicInquiryEvent | StaffInquiryEvent = PublicInquiryEvent> {
    events: T[];
    cursor: string;
    hasMore: boolean;
}
/** Server-private cursor binding. Never serialize its offsets, lane or actor as a token. */
export interface InquiryCursorBinding {
    conversationId: string;
    userId: string;
    view: 'public' | 'staff';
    publicPosition: number;
    internalPosition: number | null;
}
