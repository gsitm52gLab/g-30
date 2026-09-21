import { legacyProductScope } from "@/server/products/access";
import { systemClock } from "@/domain/records";
import type { StoredRecord, RecordKind, Clock, UnitOfWork } from "@/domain/records";
import type { Principal } from "@/server/auth/service";
import type { Decision, ResourceScope } from "./types";
import { authorize } from "./policy";

const strings = (value: readonly string[] | undefined) => (value ?? []).filter(v => typeof v === "string");
const scalar = (value: unknown) => typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value === null;
function metadata<K extends RecordKind>(row: StoredRecord<K>) {
    return { kind: row.kind, id: row.id, contextId: row.contextId, revision: row.revision, createdAt: row.createdAt, updatedAt: row.updatedAt };
}

/** Legacy synthetic records are public; G04 records use persisted visibility/assignment. */
export function taskScope(row: StoredRecord<"task">): ResourceScope {
    return { id: row.id, contextId: row.contextId, kind: "task", visibility: row.data.schemaVersion === 2 ? row.data.visibility ?? "draft" : "public", assigneeUserId: row.data.assigneeId, coAssigneeUserIds: row.data.coAssigneeIds ?? [] };
}
export function productScope(row: StoredRecord<"product">): ResourceScope {
    return { id: row.id, contextId: row.contextId, kind: "product", visibility: "public" };
}

/** These names are the extension contract, not a new product/price persistence schema. */
export function privateFields(data: object, decision: Extract<Decision, { allowed: true }>) {
    const source = data as Record<string, unknown>;
    const result: Record<string, string | number> = {};
    for (const key of decision.internalFields ? ["internalOriginal", "internalMemo"] : []) {
        if (typeof source[key] === "string") result[key] = source[key];
    }
    for (const key of decision.internalPrice ? ["internalSupplyPrice", "internalSupplyRate"] : []) {
        if (typeof source[key] === "string" || typeof source[key] === "number" && Number.isFinite(source[key])) result[key] = source[key];
    }
    return result;
}

export function projectTask(store: UnitOfWork, principal: Principal, row: StoredRecord<"task">, clock?: Clock) {
    const decision = authorize(store, principal, "task.read", taskScope(row), clock);
    const d = row.data;
    const submitted = store.list("submission", row.contextId!).filter(v=>v.data.taskId===row.id).sort((a,b)=>b.data.sequence-a.data.sequence)[0];
    return { ...metadata(row), data: {
        submissionSummary: submitted ? { id:submitted.id,sequence:submitted.data.sequence,requestId:submitted.data.requestId,mode:submitted.data.mode,isCurrentRequest:submitted.data.requestId===d.currentRequestId,submittedAt:submitted.data.submittedAt } : null,
        title: d.title, category: d.category, description: d.description, status: d.status,
        assigneeId: d.assigneeId, ownerId: d.ownerId, deadline: d.deadline, nextAction: d.nextAction,
        productIds: strings(d.productIds), notes: strings(d.notes), authorId: d.authorId,
        contributorIds: strings(d.contributorIds), assignmentNeedsAttention: d.assignmentNeedsAttention,
        schemaVersion: d.schemaVersion, visibility: d.visibility, subtype: d.subtype, projectId: d.projectId,
        coAssigneeIds: strings(d.coAssigneeIds), currentRequestId: d.currentRequestId, templateVersionId: d.templateVersionId, cycle: d.cycle ? {sourceTaskId:d.cycle.sourceTaskId,label:d.cycle.label,start:d.cycle.start,end:d.cycle.end} : null,
        ...privateFields(d, decision),
    } };
}

export function projectProduct(store: UnitOfWork, principal: Principal, row: StoredRecord<"product">, clock: Clock = systemClock, contextId?: string) {
    const scope = legacyProductScope(store,principal,row,clock,contextId);
    const decision = authorize(store, principal, "product.read", scope, clock);
    const d = row.data;
    return { ...metadata(row), contextId: scope.contextId, data: {
        name: typeof d.name === "string" ? d.name : "", code: typeof d.code === "string" ? d.code : "", brand: typeof d.brand === "string" ? d.brand : "", size: typeof d.size === "string" ? d.size : "", category: typeof d.category === "string" ? d.category : "",
        status: ["draft","active","archived"].includes(d.status) ? d.status : "draft", missingMaterials: typeof d.missingMaterials === "number" ? d.missingMaterials : 0, ...privateFields(d, decision),
    } };
}

export function projectContext(row: StoredRecord<"context">) {
    const d = row.data;
    return { ...metadata(row), data: {
        country: d.country, retailer: d.retailer, brand: d.brand, type: d.type,
        countryId: d.countryId, retailerId: d.retailerId, brandId: d.brandId, eventName: d.eventName,
        combinationKey: d.combinationKey,
    } };
}

/** Peer identity deliberately excludes grants; only authenticated self gets sessionUser. */
export function memberIdentity(row: StoredRecord<"user">) {
    return { id: row.id, revision: row.revision, name: row.data.name, email: row.data.email, role: row.data.role, status: row.data.status };
}
export function sessionUser(row: StoredRecord<"user">) {
    const grant = row.data.adminGrant;
    return { ...memberIdentity(row), adminGrant: grant ? {
        scope: grant.scope, contextIds: strings(grant.contextIds), internalPriceAccess: grant.internalPriceAccess === true,
    } : null };
}
export function projectUserLabel(row: StoredRecord<"user">) {
    return { ...metadata(row), data: { name: row.data.name, email: "", role: row.data.role } };
}
export function projectMembership(row: StoredRecord<"membership">) {
    const d = row.data;
    return { ...metadata(row), data: {
        userId: d.userId, role: d.role, status: d.status, scope: d.scope,
        internalPriceAccess: d.internalPriceAccess === true, activatedAt: d.activatedAt, suspendedAt: d.suspendedAt,
    } };
}

const auditKeys: Record<string, readonly string[]> = {
    "context.created": ["country", "retailer", "brand", "type", "countryId", "brandId", "retailerId", "eventName", "combinationKey"],
    "invitation.created": ["userId", "membershipId"],
    "invitation.reissued": ["invitationId"],
    "invitation.accepted": ["status", "membershipId"],
    "membership.changed": ["status", "scope", "internalPriceAccess"],
    "user.status": ["status"],
    "task.reassigned": ["assigneeId", "ownerId", "authorId", "coAssigneeIds"],
    "task.created": ["title", "category", "projectId"],
    "task.draft": ["revision"],
    "task.published": ["requestVersionId", "sequence"],
    "task.state": ["status", "reason"],
    "task.read": ["requestVersionId"], "task.accept": ["requestVersionId"],
    "task.schedule": ["requestVersionId"], "task.schedule_decide": ["requestVersionId", "decision", "resultingRequestId"],
    "project.created": ["title", "taskCount"], "project.dependencies": ["count"],
    "template.saved": ["previousId", "templateVersionId"],
};

export function projectAudit(row: StoredRecord<"audit">) {
    const d = row.data;
    function changes(value: Record<string, unknown>) {
        const safe: Record<string, unknown> = {};
        for (const key of auditKeys[d.action] ?? []) if (Object.hasOwn(value, key) && scalar(value[key])) safe[key] = value[key];
        if (d.action === "task.reassigned" && Array.isArray(value.coAssigneeIds) && value.coAssigneeIds.every(id => typeof id === "string")) safe.coAssigneeIds = [...value.coAssigneeIds];
        return safe;
    }
    return { ...metadata(row), data: {
        actorId: d.actorId, action: Object.hasOwn(auditKeys, d.action) ? d.action : "record.changed", targetId: d.targetId,
        before: changes(d.before), after: changes(d.after), at: d.at,
    } };
}

/** Harness contract for future channels: never spread the future producer's raw payload. */
export function projectChannel(store: UnitOfWork, principal: Principal, action: import("./types").Action,
    scope: ResourceScope, source: Record<string, unknown>, clock?: Clock) {
    const decision = authorize(store, principal, action, scope, clock);
    return {
        id: scope.id, contextId: scope.contextId,
        ...(typeof source.title === "string" ? { title: source.title } : {}),
        ...(typeof source.description === "string" ? { description: source.description } : {}),
        ...(typeof source.fileVersionId === "string" ? { fileVersionId: source.fileVersionId } : {}),
        ...privateFields(source, decision),
    };
}
