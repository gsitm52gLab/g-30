import { aiReviewRelations } from './ai-review/constraints';
import { completionRelations } from './completion/constraints';
import { aiRelations } from './ai-input/constraints';
import { correctionRelations } from './corrections/constraints';
import { inquiryRelations } from './inquiries/constraints';
import { campaignRelations } from './campaigns/constraints';
import { evidenceRelations } from './evidence/constraints';
import { noticeRelations } from './notices/constraints';
import { submissionRelations } from './submissions/constraints';
import { StoreError, type RecordKind, type RecordInput, type UnitOfWork } from "./records";
import { productRelations } from "./products/constraints";
import { taskRelations } from "./tasks/constraints";
/** Same constraints for mock/SQLite; SQL adds cross-process uniqueness. */
export function checkRelations<K extends RecordKind>(store: UnitOfWork, kind: K, input: RecordInput<K>) {
    aiReviewRelations(store, kind, input);
    aiRelations(store, kind, input);
    completionRelations(store, kind, input);
    correctionRelations(store, kind, input);
    inquiryRelations(store, kind, input);
    campaignRelations(store, kind, input);
    evidenceRelations(store, kind, input);
    noticeRelations(store, kind, input);
    taskRelations(store, kind, input);
    submissionRelations(store, kind, input);
    productRelations(store, kind, input);
    const data = input.data as unknown as Record<string, unknown>;
    const unique = (field: string, value: unknown, scoped = false) => {
        if (value !== undefined && store.list(kind, scoped ? input.contextId ?? "" : undefined).some(r => r.id !== input.id && (r.data as unknown as Record<string, unknown>)[field] === value))
            throw new StoreError("CONFLICT");
    };
    if (kind === "context")
        unique("combinationKey", data.combinationKey);
    if (kind === "user")
        unique("normalizedEmail", data.normalizedEmail);
    if (kind === "membership") {
        unique("userId", data.userId, true);
        const user = store.get("user", String(data.userId));
        if (!input.contextId || !store.get("context", input.contextId) || !user || !["operator", "brand"].includes(String(data.role)) || !["active", "invited", "suspended"].includes(String(data.status)) || (data.role === "operator") !== (user.data.role === "gsg") || (data.role === "brand" && data.internalPriceAccess))
            throw new StoreError("INVALID_RECORD");
    }
    if (kind === "credential") {
        unique("userId", data.userId);
        if (!store.get("user", String(data.userId)))
            throw new StoreError("INVALID_RECORD");
    }
    if (kind === "session" || kind === "invitation") {
        unique("tokenHash", data.tokenHash);
        if (data.userId && !store.get("user", String(data.userId)))
            throw new StoreError("INVALID_RECORD");
    }
    if (kind === "invitation") {
        const member = store.get("membership", String(data.membershipId));
        if (!member || member.contextId !== input.contextId || member.data.userId !== data.userId)
            throw new StoreError("INVALID_RECORD");
    }
}
