import { auditRelations } from './audit';
// Explicit asynchronous counterpart of src/domain/constraints.ts; source hash tracked in source-map.json.
import type { AsyncUnitOfWork as UnitOfWork } from '../types';
import { schedulingRelations } from "./scheduling";
import { notificationRelations } from "./notifications";
import { providerRelations } from "./ai-provider";
import { aiReviewRelations } from "./ai-review";
import { completionRelations } from "./completion";
import { aiRelations } from "./ai-input";
import { correctionRelations } from "./corrections";
import { inquiryRelations } from "./inquiries";
import { campaignRelations } from "./campaigns";
import { evidenceRelations } from "./evidence";
import { noticeRelations } from "./notices";
import { submissionRelations } from "./submissions";
import { StoreError, type RecordKind, type RecordInput } from "@/domain/records";
import { productRelations } from "./products";
import { taskRelations } from "./tasks";
/** Same constraints for mock/SQLite; SQL adds cross-process uniqueness. */
export async function checkRelations<K extends RecordKind>(store: UnitOfWork, kind: K, input: RecordInput<K>) {
    await auditRelations(store, kind, input);
    (await schedulingRelations(store, kind, input));
    (await notificationRelations(store, kind, input));
    (await providerRelations(store, kind, input));
    (await aiReviewRelations(store, kind, input));
    (await aiRelations(store, kind, input));
    (await completionRelations(store, kind, input));
    (await correctionRelations(store, kind, input));
    (await inquiryRelations(store, kind, input));
    (await campaignRelations(store, kind, input));
    (await evidenceRelations(store, kind, input));
    (await noticeRelations(store, kind, input));
    (await taskRelations(store, kind, input));
    (await submissionRelations(store, kind, input));
    (await productRelations(store, kind, input));
    const data = input.data as unknown as Record<string, unknown>;
    const unique = async (field: string, value: unknown, scoped = false) => {
        if (value !== undefined && (await store.list(kind, scoped ? input.contextId ?? "" : undefined)).some(r => r.id !== input.id && (r.data as unknown as Record<string, unknown>)[field] === value))
            throw new StoreError("CONFLICT");
    };
    if (kind === "context")
        (await unique("combinationKey", data.combinationKey));
    if (kind === "user")
        (await unique("normalizedEmail", data.normalizedEmail));
    if (kind === "membership") {
        (await unique("userId", data.userId, true));
        const user = (await store.get("user", String(data.userId)));
        if (!input.contextId || !(await store.get("context", input.contextId)) || !user || !["operator", "brand"].includes(String(data.role)) || !["active", "invited", "suspended"].includes(String(data.status)) || (data.role === "operator") !== (user.data.role === "gsg") || (data.role === "brand" && data.internalPriceAccess))
            throw new StoreError("INVALID_RECORD");
    }
    if (kind === "credential") {
        (await unique("userId", data.userId));
        if (!(await store.get("user", String(data.userId))))
            throw new StoreError("INVALID_RECORD");
    }
    if (kind === "session" || kind === "invitation") {
        (await unique("tokenHash", data.tokenHash));
        if (data.userId && !(await store.get("user", String(data.userId))))
            throw new StoreError("INVALID_RECORD");
    }
    if (kind === "invitation") {
        const member = (await store.get("membership", String(data.membershipId)));
        if (!member || member.contextId !== input.contextId || member.data.userId !== data.userId)
            throw new StoreError("INVALID_RECORD");
    }
}
