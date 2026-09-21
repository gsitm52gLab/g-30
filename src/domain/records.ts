import type { CampaignRecords } from './campaigns/records';
import type { EvidenceData, EvidenceVersionData, EvidenceLinkData, EvidenceAssessmentData } from './evidence/types';
import type { ImportBatchData } from './imports/types';
import type { NoticeData, NoticeVersionData, NoticeReadData } from './notices/types';
import type { SubmissionData, SubmissionDraftData } from './submissions/types';
import type { CommonProductExtension, ProductVersionData, ContextProductData, ContextProductVersionData, PriceData, RetailPriceVersionData, InternalPriceVersionData, ProductUseSnapshotData } from "./products/types";
import type { TaskExtension, RequestVersionData, TemplateVersionData, ProjectData, TaskActivityData, PriorSubmissionData, DomainEventData, CommandReceiptData, FileVersionData } from "./tasks/types";
/** Foundation records plus module-owned typed extensions. */
export interface ContextData {
    country: string;
    retailer: string;
    brand: string;
    type?: "retail" | "event";
    countryId?: string;
    retailerId?: string | null;
    brandId?: string;
    eventName?: string;
    combinationKey?: string;
}
export type AccountStatus = "invited" | "active" | "suspended";
export interface AdminGrant {
    scope: "all" | "selected";
    contextIds: string[];
    internalPriceAccess: boolean;
}
export interface UserData {
    name: string;
    email: string;
    role: "gsg" | "brand";
    normalizedEmail?: string;
    status?: AccountStatus;
    authVersion?: number;
    adminGrant?: AdminGrant | null;
}
export interface MembershipData {
    userId: string;
    role: "operator" | "brand";
    status: AccountStatus;
    scope: string;
    internalPriceAccess: boolean;
    activatedAt: string | null;
    suspendedAt: string | null;
}
export interface CredentialData {
    userId: string;
    scheme: "scrypt-v1";
    salt: string;
    digest: string;
}
export interface SessionData {
    userId: string | null;
    tokenHash: string;
    csrfToken: string;
    authVersion: number;
    expiresAt: string;
    revokedAt: string | null;
}
export interface InvitationData {
    userId: string;
    membershipId: string;
    email: string;
    tokenHash: string;
    expiresAt: string;
    consumedAt: string | null;
    revokedAt: string | null;
    createdBy: string;
}
export interface AuditData {
    actorId: string;
    action: string;
    targetId: string;
    before: Record<string, unknown>;
    after: Record<string, unknown>;
    at: string;
}
export interface TaskData extends TaskExtension {
    title: string;
    category: "onboarding" | "spot";
    assigneeId: string;
    ownerId: string;
    description: string;
    status: "draft" | "requested" | "in_progress" | "partial" | "submitted" | "completed" | "on_hold" | "cancelled";
    deadline: string | null;
    nextAction: string;
    productIds: string[];
    notes: string[];
    authorId?: string;
    contributorIds?: string[];
    assignmentNeedsAttention?: boolean;
}
export interface ProductData extends CommonProductExtension {
    name: string;
    code: string;
    brand: string;
    size: string;
    category: string;
    status: "draft" | "active" | "archived";
    missingMaterials: number;
}
export interface RecordDataMap extends CampaignRecords {
    evidence: EvidenceData;
    evidenceVersion: EvidenceVersionData;
    evidenceLink: EvidenceLinkData;
    evidenceAssessment: EvidenceAssessmentData;
    importBatch: ImportBatchData;
    notice: NoticeData;
    noticeVersion: NoticeVersionData;
    noticeRead: NoticeReadData;
    submission: SubmissionData;
    submissionDraft: SubmissionDraftData;
    productVersion: ProductVersionData;
    contextProduct: ContextProductData;
    contextProductVersion: ContextProductVersionData;
    retailPrice: PriceData;
    internalPrice: PriceData;
    retailPriceVersion: RetailPriceVersionData;
    internalPriceVersion: InternalPriceVersionData;
    productUseSnapshot: ProductUseSnapshotData;
    productMigration: { productId: string; legacyContextId: string; legacyRevision: number; legacyData: Record<string, unknown> };
    requestVersion: RequestVersionData;
    templateVersion: TemplateVersionData;
    project: ProjectData;
    taskActivity: TaskActivityData;
    priorSubmission: PriorSubmissionData;
    domainEvent: DomainEventData;
    commandReceipt: CommandReceiptData;
    fileVersion: FileVersionData;
    context: ContextData;
    user: UserData;
    membership: MembershipData;
    credential: CredentialData;
    session: SessionData;
    invitation: InvitationData;
    audit: AuditData;
    throttle: {
        count: number;
        until: string;
    };
    task: TaskData;
    product: ProductData;
    checkpoint: {
        value: string;
    };
}
export type RecordKind = keyof RecordDataMap;
export interface StoredRecord<K extends RecordKind = RecordKind> {
    kind: K;
    id: string;
    contextId: string | null;
    data: RecordDataMap[K];
    revision: number;
    createdAt: string;
    updatedAt: string;
}
export type RecordInput<K extends RecordKind> = Pick<StoredRecord<K>, "id" | "contextId" | "data">;
export type Clock = () => string;
export type IdFactory = () => string;
export const systemClock: Clock = () => new Date().toISOString();
export class StoreError extends Error {
    constructor(public readonly code: "CONFLICT" | "NOT_FOUND" | "STORAGE_UNAVAILABLE" | "INVALID_RECORD" | "ASYNC_TRANSACTION") {
        super(code);
        this.name = "StoreError";
    }
}
/** Transaction callbacks are synchronous; perform network/crypto work before entering. */
export interface UnitOfWork {
    get<K extends RecordKind>(kind: K, id: string): StoredRecord<K> | null;
    list<K extends RecordKind>(kind: K, contextId?: string): StoredRecord<K>[];
    create<K extends RecordKind>(kind: K, input: RecordInput<K>): StoredRecord<K>;
    update<K extends RecordKind>(kind: K, id: string, expectedRevision: number, data: RecordDataMap[K], migration?: { legacyProductContextId: string }): StoredRecord<K>;
}
export interface RecordRepository {
    readonly mode: "mock" | "sqlite";
    get<K extends RecordKind>(kind: K, id: string): Promise<StoredRecord<K> | null>;
    list<K extends RecordKind>(kind: K, contextId?: string): Promise<StoredRecord<K>[]>;
    transaction<T>(operation: (store: UnitOfWork) => T): Promise<T>;
    close(): void;
}
export function jsonCopy<T>(value: T): T {
    try {
        return JSON.parse(JSON.stringify(value)) as T;
    }
    catch {
        throw new StoreError("INVALID_RECORD");
    }
}
export function checkInput<K extends RecordKind>(input: RecordInput<K>): void {
    if (!/^[a-zA-Z0-9_-]{1,160}$/.test(input.id) || (input.contextId !== null && !/^[a-zA-Z0-9_-]{1,160}$/.test(input.contextId)) || !input.data || typeof input.data !== "object")
        throw new StoreError("INVALID_RECORD");
}
export function assertSynchronous<T>(result: T): T {
    if (result && typeof (result as {
        then?: unknown;
    }).then === "function") {
        // Consume a rejected async callback to avoid an unhandled rejection; rollback is immediate.
        void Promise.resolve(result).catch(() => undefined);
        throw new StoreError("ASYNC_TRANSACTION");
    }
    return result;
}

/** Only the lossless legacy product migration may move a stored context. */
export function updatedContext<K extends RecordKind>(current: StoredRecord<K>, data: RecordDataMap[K], migration?: { legacyProductContextId: string }): string | null {
    if (!migration) return current.contextId;
    const old = current.data as ProductData, next = data as ProductData;
    if (current.kind !== "product" || !current.contextId || migration.legacyProductContextId !== current.contextId || old.schemaVersion === 2 || next.schemaVersion !== 2 || !next.brandId || next.legacyContextId !== current.contextId) throw new StoreError("INVALID_RECORD");
    return null;
}
