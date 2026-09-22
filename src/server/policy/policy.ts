import { asyncMap, asyncSome } from "@/domain/async-collections";
import type { StoredRecord, UnitOfWork, Clock } from "@/domain/records";
import { systemClock } from "@/domain/records";
import type { Principal } from "@/server/auth/service";
import { fail, unavailable } from "@/server/auth/errors";
import { actionKinds, type Action, type ResourceScope, type Decision } from "./types";
export async function activeMember(store: UnitOfWork, userId: string, contextId: string) {
    return (await store.list("membership", contextId)).find(m => m.data.userId === userId && m.data.status === "active");
}
/** This helper is only for already-authenticated current user records. */
export function canAdmin(user: StoredRecord<"user">, contextId?: string) {
    const grant = user.data.adminGrant;
    return user.data.status === "active" && user.data.role === "gsg" && !!grant &&
        (grant.scope === "all" || grant.scope === "selected" && !!contextId && grant.contextIds.includes(contextId));
}
async function currentUser(store: UnitOfWork, principal: Principal, clock: Clock) {
    const session = (await store.get("session", principal.session.id));
    const user = (await store.get("user", principal.user.id));
    if (!session || !user || session.data.userId !== user.id || session.data.tokenHash !== principal.session.data.tokenHash ||
        session.data.revokedAt || session.data.expiresAt <= clock() || user.data.status !== "active" ||
        !["gsg", "brand"].includes(user.data.role) ||
        session.data.authVersion !== user.data.authVersion)
        return null;
    return user;
}
async function scopeDecision(store: UnitOfWork, user: StoredRecord<"user">, resource: ResourceScope, depth = 0): Promise<Decision> {
    if (depth > 8 || !Object.values(actionKinds).includes(resource.kind) || !resource.contextId || !(await store.get("context", resource.contextId)) ||
        !["public", "internal", "draft"].includes(resource.visibility))
        return { allowed: false, status: 404 };
    const membership = (await activeMember(store, user.id, resource.contextId));
    const admin = canAdmin(user, resource.contextId);
    const validMember = membership && (user.data.role === "gsg" ? membership.data.role === "operator" : membership.data.role === "brand");
    if (!admin && !validMember)
        return { allowed: false, status: 404 };
    const internalFields = user.data.role === "gsg";
    if (!internalFields && resource.audienceUserIds !== undefined && (!Array.isArray(resource.audienceUserIds) || !resource.audienceUserIds.includes(user.id)))
        return { allowed: false, status: 404 };
    if (resource.privateOwnerId !== undefined && resource.privateOwnerId !== user.id)
        return { allowed: false, status: 404 };
    if (resource.visibility !== "public" && !internalFields && resource.privateOwnerId !== user.id)
        return { allowed: false, status: 404 };
    const internalPrice = internalFields && (admin && user.data.adminGrant?.internalPriceAccess === true ||
        !!validMember && membership.data.internalPriceAccess === true);
    if (resource.requiresInternalPrice && !internalPrice)
        return { allowed: false, status: 404 };
    const references = [resource.originalScope, resource.referenceScope, ...(resource.sourceScopes ?? [])].filter((r): r is ResourceScope => !!r);
    if ((await asyncSome(references, async (r) => !(await scopeDecision(store, user, r, depth + 1)).allowed)))
        return { allowed: false, status: 404 };
    return { allowed: true, internalFields, internalPrice };
}
/** Call inside the same transaction as the protected read/write. No decision cache. */
export async function decide(store: UnitOfWork, principal: Principal, action: Action, resource: ResourceScope, clock: Clock = systemClock): Promise<Decision> {
    const user = (await currentUser(store, principal, clock));
    if (!user)
        return { allowed: false, status: 401 };
    if (!Object.hasOwn(actionKinds, action) || actionKinds[action] !== resource.kind)
        return { allowed: false, status: 403 };
    if (action === "context.create" || action === "account.manage") {
        return resource.contextId === null && resource.visibility === "internal" && canAdmin(user)
            ? { allowed: true, internalFields: true, internalPrice: user.data.adminGrant?.internalPriceAccess === true }
            : { allowed: false, status: 403 };
    }
    const scope = (await scopeDecision(store, user, resource));
    if (!scope.allowed)
        return scope;
    if (action.startsWith("file.")) {
        if (!resource.originalScope || !resource.referenceScope ||
            !(await scopeDecision(store, user, resource.originalScope)).allowed ||
            !(await scopeDecision(store, user, resource.referenceScope)).allowed)
            return { allowed: false, status: 404 };
    }
    if (action === "notification.read" && resource.recipientUserId !== user.id)
        return { allowed: false, status: 404 };
    if (action === "membership.manage" && !canAdmin(user, resource.contextId!))
        return { allowed: false, status: 403 };
    if (["task.manage", "task.complete", "audit.read", "evidence.assess", "notice.manage", "inquiry.manage", "ai.result.manage"].includes(action) && !scope.internalFields)
        return { allowed: false, status: 403 };
    if (action === "price.read" && !scope.internalPrice)
        return { allowed: false, status: 403 };
    if (action === "submission.write" && !scope.internalFields &&
        resource.assigneeUserId !== user.id && !resource.coAssigneeUserIds?.includes(user.id))
        return { allowed: false, status: 403 };
    return scope;
}
export async function authorize(store: UnitOfWork, principal: Principal, action: Action, resource: ResourceScope, clock: Clock = systemClock) {
    const decision = (await decide(store, principal, action, resource, clock));
    if (!decision.allowed) {
        if (decision.status === 404)
            unavailable();
        if (decision.status === 401)
            fail("UNAUTHENTICATED", 401, "로그인이 필요합니다.");
        fail("FORBIDDEN", 403, "이 작업을 수행할 권한이 없습니다.");
    }
    return decision;
}
/** Public projections are produced BEFORE matching, ordering, pagination and total. */
export async function visiblePage<T, D>(rows: readonly T[], project: (row: T) => (D | null) | Promise<D | null>, options: {
    matches?: (row: D) => boolean;
    compare?: (a: D, b: D) => number;
    offset?: number;
    limit?: number;
} = {}) {
    const visible = (await asyncMap(rows, project)).filter((row): row is D => row !== null).filter(options.matches ?? (() => true));
    if (options.compare)
        visible.sort(options.compare);
    const offset = Math.max(0, options.offset ?? 0);
    const limit = Math.max(0, options.limit ?? visible.length);
    return { total: visible.length, items: visible.slice(offset, offset + limit) };
}
