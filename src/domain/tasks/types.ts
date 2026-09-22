export const requirementTypes = ["short_text", "long_text", "file", "choice", "number", "date", "link", "physical_record"] as const;
export type RequirementType = typeof requirementTypes[number];
export interface Requirement {
    key: string; label: string; type: RequirementType; required: boolean;
    help: string; unit: string; options: string[]; productIds: string[];
    condition: { key: string; equals: string } | null;
    specifications: { text: string; source: string; version: string; severity: "required" | "recommended"; check: "auto" | "human" }[];
}
export interface Deadline {
    value: string | null; precision: "date" | "datetime"; timezone: string;
    certainty: "confirmed" | "requested" | "expected" | "needs_confirmation";
    source: string; sourceVersion: string; responsibleUserId: string; raw: string;
}
export interface Milestone {
    id: string; kind: "application" | "review" | "printing_delivery" | "publication_use";
    deadline: Deadline; counterpart: string; visibility: "public" | "internal";
}
export interface RequestContent {
    title: string; description: string; purpose: string; output: string;
    productionResponsibility: string; subtitleResponsibility: string; originalResponsibility: string; usePlace: string;
    nextAction: string; deadline: Deadline; milestones: Milestone[];
    requirements: Requirement[]; referenceFileIds: string[];
    links: { url: string; description: string; contentFixed: false }[];
    internalOriginal: string; internalMemo: string;
}
export interface TaskExtension {
    schemaVersion?: 2; visibility?: "draft" | "public";
    /** Progress before hold/cancel; separate from per-request acceptance history. */
    resumeStatus?: "requested" | "in_progress" | "partial" | "submitted" | null;
    submissionProgress?: { latestSubmissionId: string; requestId: string; mode: "partial" | "full" };
    subtype?: string; projectId?: string | null; coAssigneeIds?: string[];
    draft?: RequestContent; currentRequestId?: string | null;
    templateVersionId?: string | null;
    cycle?: { sourceTaskId: string; label: string; start: string; end: string } | null;
}
/** Generated only from a GSG-approved campaign; actor is the actual selection recorder. */
export interface CampaignRequestSource {
    kind: 'campaign_selection'; campaignId: string; campaignVersionId: string;
    selectionVersionId: string | null; sourceFactId: string | null; originalRequestId: string;
    actorId: string; eventSequence: number; activeMenuKeys: string[];
    retainedCancellationMenuKeys: string[]; retainedRequirementKeys: string[];
    materialProductIds: string[]; noMaterials: boolean;
}
export interface RequestVersionData {
    taskId: string; sequence: number; previousId: string | null; templateVersionId: string | null;
    content: RequestContent; publishedBy: string; publishedAt: string; changedKeys: string[]; source?: CampaignRequestSource;
}
export interface TemplateVersionData {
    templateId: string; name: string; sequence: number; previousId: string | null;
    content: RequestContent; createdBy: string; builtin: boolean;
}
export interface ProjectData {
    title: string; taskIds: string[]; dependencies: { before: string; after: string }[];
    status: "active" | "completed"; createdBy: string;
}
export interface TaskActivityData {
    taskId: string; requestId: string; userId: string; kind: "read" | "accept" | "schedule" | "schedule_resolved";
    at: string; sequence: number; reason: string; proposedDeadline: Deadline | null; respondsTo: string | null;
    decision: "apply" | "keep" | null; resultingRequestId: string | null;
}
/** Read-only port for G05. Production submission creation belongs to G05. */
export interface PriorSubmissionData {
    taskId: string; requestId: string; authorId: string;
    answers: { requirementKey: string; productId: string | null; value: unknown; fileVersionIds: string[] }[];
}
export interface DomainEventData { eventType: string; targetId: string; sourceVersionId: string | null; actorId: string; at: string }
export interface CommandReceiptData { key: string; actorId: string; command: string; bodyHash: string; result: { ids: string[] } }
export type FileOwner = { kind: "inquiry"; conversationId: string } | { kind: "notice"; noticeId: string } | { kind: "task"; taskId: string } | { kind: "product"; productId: string; contextProductId: string };
export interface FileVersionData {
    backend?: import("../storage/types").StorageBackendReference;
    /** Legacy task files retain taskId and immutable bytes; new files also have an explicit owner. */
    taskId: string | null; owner?: FileOwner; storageKey: string; originalName: string; mime: string; bytes: number; sha256: string;
    submissionUpload?: { key: string; clientItemId: string; requestId: string; bodyHash: string };
    uploaderId: string; visibility: "public" | "internal"; preview: boolean;
}
export const certaintyLabels = { confirmed: "확정", requested: "요청", expected: "예상", needs_confirmation: "확인 필요" };
export const typeLabels: Record<RequirementType, string> = { short_text: "짧은 글", long_text: "긴 글", file: "파일", choice: "선택", number: "숫자", date: "날짜", link: "링크", physical_record: "실물 확인 기록" };
export function blankContent(): RequestContent {
    return { title: "", description: "", purpose: "", output: "", productionResponsibility: "", subtitleResponsibility: "", originalResponsibility: "", usePlace: "", nextAction: "브랜드 요청 확인", deadline: { value: null, precision: "date", timezone: "Asia/Seoul", certainty: "requested", source: "", sourceVersion: "", responsibleUserId: "", raw: "" }, milestones: [], requirements: [], referenceFileIds: [], links: [], internalOriginal: "", internalMemo: "" };
}
export function blankRequirement(key: string, type: RequirementType = "long_text"): Requirement {
    return { key, type, label: "", required: true, help: "", unit: "", options: [], productIds: [], condition: null, specifications: [] };
}
