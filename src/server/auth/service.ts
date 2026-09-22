import { asyncFilter, asyncMap, asyncSome } from "@/domain/async-collections";
import { randomUUID } from "node:crypto";
import { catalog } from "@/domain/catalog";
import { type RecordRepository, type UnitOfWork, type StoredRecord, type Clock, systemClock, type ContextData } from "@/domain/records";
import { digestToken, randomToken, hashPassword, verifyPassword } from "./crypto";
import { AuthError, fail, unavailable } from "./errors";
import { activeMember, authorize, canAdmin, decide } from "@/server/policy/policy";
import { contextResource } from "@/server/policy/types";
import { memberIdentity, sessionUser, projectContext, projectMembership, projectTask, projectAudit } from "@/server/policy/projection";
export { AuthError, fail, canAdmin };
export type Principal = {
    user: StoredRecord<"user">;
    session: StoredRecord<"session">;
};
const id = () => randomUUID();
export const normalizeEmail = (v: unknown) => typeof v === "string" ? v.trim().toLowerCase() : "";
export function text(v: unknown, label: string, max = 200): string {
    if (typeof v !== "string" || !v.trim() || v.length > max)
        fail("VALIDATION", 422, `${label} 값을 확인해 주세요.`);
    return v.trim();
}
export function revision(v: unknown): number {
    if (!Number.isSafeInteger(v) || Number(v) < 1)
        fail("VALIDATION", 422, "저장 버전을 확인해 주세요.");
    return Number(v);
}
export function passwordValue(v: unknown): string {
    if (typeof v !== "string" || v.length < 12 || v.length > 128)
        fail("VALIDATION", 422, "비밀번호는 12~128자로 입력해 주세요.");
    return v;
}
function emailValue(v: unknown): string {
    const email = normalizeEmail(v);
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
        fail("VALIDATION", 422, "이메일을 확인해 주세요.");
    return email;
}
export async function hasScope(s: UnitOfWork, p: Principal, contextId: string, clock: Clock = systemClock) {
    return (await decide(s, p, "context.read", contextResource(contextId), clock)).allowed;
}
export async function needScope(s: UnitOfWork, p: Principal, contextId: string, clock: Clock = systemClock) {
    (await authorize(s, p, "context.read", contextResource(contextId), clock));
}
async function needAdmin(s: UnitOfWork, p: Principal, contextId: string | undefined, clock: Clock) {
    (await authorize(s, p, contextId ? "membership.manage" : "account.manage", {
        id: contextId ?? "accounts", contextId: contextId ?? null,
        kind: contextId ? "membership" : "account", visibility: contextId ? "public" : "internal",
    }, clock));
}
export class IdentityService {
    constructor(public repo: RecordRepository, public clock: Clock = systemClock, private fault?: (operation: string) => void) { }
    private expiry(ms: number) { return new Date(Date.parse(this.clock()) + ms).toISOString(); }
    async session(s: UnitOfWork, token: string | undefined) {
        if (!token || token.length > 200)
            return null;
        const row = (await s.list("session")).find(r => r.data.tokenHash === digestToken(token));
        return row && !row.data.revokedAt && row.data.expiresAt > this.clock() ? row : null;
    }
    async principal(s: UnitOfWork, token: string | undefined): Promise<Principal> {
        const session = (await this.session(s, token));
        const user = session?.data.userId ? (await s.get("user", session.data.userId)) : null;
        if (!session || !user || user.data.status !== "active" || user.data.authVersion !== session.data.authVersion)
            fail("UNAUTHENTICATED", 401, "로그인이 필요합니다.");
        return { user, session };
    }
    private async audit(s: UnitOfWork, p: Principal, action: string, targetId: string, contextId: string | null, before: Record<string, unknown>, after: Record<string, unknown>) { (await s.create("audit", { id: id(), contextId, data: { actorId: p.user.id, action, targetId, before, after, at: this.clock() } })); }
    private async issue(s: UnitOfWork, user: StoredRecord<"user"> | null) { const token = randomToken(); const row = (await s.create("session", { id: id(), contextId: null, data: { userId: user?.id ?? null, tokenHash: digestToken(token), csrfToken: randomToken(), authVersion: user?.data.authVersion ?? 0, expiresAt: this.expiry(user ? 8 * 3600000 : 15 * 60000), revokedAt: null } })); return { token, csrfToken: row.data.csrfToken, expiresAt: row.data.expiresAt }; }
    async csrf(token?: string) {
        return this.repo.transaction(async (s) => {
            const old = (await this.session(s, token));
            if (old && (!old.data.userId || (await s.get("user", old.data.userId))?.data.status === "active" && (await s.get("user", old.data.userId))?.data.authVersion === old.data.authVersion))
                return { csrfToken: old.data.csrfToken, expiresAt: old.data.expiresAt, token: undefined };
            return (await this.issue(s, null));
        });
    }
    async checkCsrf(token: string | undefined, csrf: string | null) {
        return this.repo.transaction(async (s) => {
            const session = (await this.session(s, token));
            if (!session || !csrf || session.data.csrfToken !== csrf)
                fail("CSRF", 403, "요청을 확인할 수 없습니다. 다시 시도해 주세요.");
        });
    }
    async throttle(key: string) {
        const now = this.clock();
        return this.repo.transaction(async (s) => {
            const keyId = digestToken(key);
            const old = (await s.get("throttle", keyId));
            if (old && old.data.until > now && old.data.count >= 20)
                return false;
            const data = { count: old && old.data.until > now ? old.data.count + 1 : 1, until: old && old.data.until > now ? old.data.until : this.expiry(15 * 60000) };
            if (old)
                (await s.update("throttle", old.id, old.revision, data));
            else
                (await s.create("throttle", { id: keyId, contextId: null, data }));
            return true;
        });
    }
    async login(token: string | undefined, input: Record<string, unknown>) {
        const email = emailValue(input.email);
        const password = passwordValue(input.password);
        if (!await this.throttle(`login:${email}`))
            fail("RATE_LIMITED", 429, "시도가 많습니다. 잠시 후 다시 시도해 주세요.");
        const user = (await this.repo.list("user")).find(u => u.data.normalizedEmail === email);
        const credential = user ? (await this.repo.list("credential")).find(c => c.data.userId === user.id) : undefined;
        const valid = await verifyPassword(password, credential?.data);
        if (!valid || !user)
            fail("LOGIN_FAILED", 401, "이메일 또는 비밀번호를 확인해 주세요.");
        return this.repo.transaction(async (s) => {
            const current = (await s.get("user", user.id));
            const currentCredential = credential ? (await s.get("credential", credential.id)) : null;
            if (!current || current.data.status !== "active" || current.data.authVersion !== user.data.authVersion || currentCredential?.revision !== credential?.revision)
                fail("LOGIN_FAILED", 401, "이메일 또는 계정 상태를 확인해 주세요.");
            const old = (await this.session(s, token));
            if (old)
                (await s.update("session", old.id, old.revision, { ...old.data, revokedAt: this.clock() }));
            return { ...(await this.issue(s, current)), user: sessionUser(current) };
        });
    }
    async logout(token?: string) {
        return this.repo.transaction(async (s) => {
            const session = (await this.session(s, token));
            if (session)
                (await s.update("session", session.id, session.revision, { ...session.data, revokedAt: this.clock() }));
        });
    }
    async me(token?: string) {
        return this.repo.transaction(async (s) => {
            const p = (await this.principal(s, token));
            const contexts = (await asyncFilter((await s.list("context")), async (c) => (await hasScope(s, p, c.id, this.clock)))).map(projectContext);
            return { storageMode: this.repo.mode, user: sessionUser(p.user), contexts,
                memberships: (await s.list("membership")).filter(m => m.data.userId === p.user.id).map(projectMembership),
                canCreateContext: canAdmin(p.user) };
        });
    }
    async createContext(token: string | undefined, input: Record<string, unknown>) {
        const type = input.type;
        if (type !== "retail" && type !== "event")
            fail("VALIDATION", 422, "컨텍스트 유형을 확인해 주세요.");
        const country = catalog.countries.find(x => x.id === input.countryId);
        const brand = catalog.brands.find(x => x.id === input.brandId);
        const retailer = catalog.retailers.find(x => x.id === input.retailerId);
        if (!country || !brand || type === "retail" && !retailer || type === "event" && input.retailerId)
            fail("VALIDATION", 422, "국가·브랜드·리테일러를 확인해 주세요.");
        const eventName = type === "event" ? text(input.eventName, "행사명") : undefined;
        const data: ContextData = { country: country.name, brand: brand.name, retailer: type === "event" ? "리테일러 미지정" : retailer!.name, type, countryId: country.id, brandId: brand.id, retailerId: type === "event" ? null : retailer!.id, eventName, combinationKey: type === "event" ? `event:${country.id}:${brand.id}:${eventName}` : `retail:${country.id}:${retailer!.id}:${brand.id}` };
        return this.repo.transaction(async (s) => { const p = (await this.principal(s, token)); (await authorize(s, p, "context.create", { id: "new-context", contextId: null, kind: "context", visibility: "internal" }, this.clock)); const row = (await s.create("context", { id: id(), contextId: null, data })); (await this.audit(s, p, "context.created", row.id, row.id, {}, data as unknown as Record<string, unknown>)); this.fault?.("context"); return projectContext(row); });
    }
    async members(token: string | undefined, contextId: string) {
        return this.repo.transaction(async (s) => {
            const p = (await this.principal(s, token));
            (await needAdmin(s, p, contextId, this.clock));
            const members = (await s.list("membership", contextId));
            const memberIds = new Set(members.map(m => m.data.userId));
            return {
                context: projectContext((await s.get("context", contextId))!),
                members: (await asyncMap(members, async (m) => ({ ...projectMembership(m), user: memberIdentity((await s.get("user", m.data.userId))!) }))),
                invitations: (await s.list("invitation", contextId)).map(r => ({ id: r.id, revision: r.revision,
                    userId: r.data.userId, membershipId: r.data.membershipId, expiresAt: r.data.expiresAt,
                    consumedAt: r.data.consumedAt, revokedAt: r.data.revokedAt })),
                tasks: (await asyncMap((await s.list("task", contextId)), async (t) => (await projectTask(s, p, t, this.clock)))),
                history: (await s.list("audit")).filter(a => a.contextId === contextId ||
                    a.contextId === null && a.data.action === "user.status" && memberIds.has(a.data.targetId)).map(projectAudit),
                canManageAccounts: canAdmin(p.user),
            };
        });
    }
    async invite(token: string | undefined, contextId: string, input: Record<string, unknown>) {
        const email = emailValue(input.email);
        const name = text(input.name, "이름");
        const role = input.role;
        if (role !== "brand" && role !== "operator")
            fail("VALIDATION", 422, "브랜드 또는 GSG 운영자 역할만 지원합니다.");
        const scope = typeof input.scope === "string" ? input.scope.trim().slice(0, 500) : "";
        const raw = randomToken();
        return this.repo.transaction(async (s) => {
            const p = (await this.principal(s, token));
            (await needScope(s, p, contextId, this.clock));
            (await needAdmin(s, p, contextId, this.clock));
            let user = (await s.list("user")).find(u => u.data.normalizedEmail === email);
            if (user && ((user.data.role === "gsg") !== (role === "operator")))
                fail("CONFLICT", 409, "기존 계정의 유형과 역할이 다릅니다.");
            if (user?.data.status === "suspended")
                fail("ACCOUNT_SUSPENDED", 409, "중지된 계정은 먼저 관리자가 복구해야 합니다.");
            if (!user)
                user = (await s.create("user", { id: id(), contextId: null, data: { name, email, normalizedEmail: email, role: role === "operator" ? "gsg" : "brand", status: "invited", authVersion: 1, adminGrant: null } }));
            let member = (await s.list("membership", contextId)).find(m => m.data.userId === user!.id);
            if (member?.data.status === "active")
                fail("ALREADY_MEMBER", 409, "이미 활성 멤버입니다.");
            if (member?.data.status === "suspended")
                fail("MEMBER_SUSPENDED", 409, "중지된 멤버십은 명시적으로 복구해 주세요.");
            if (!member)
                member = (await s.create("membership", { id: id(), contextId, data: { userId: user.id, role, status: "invited", scope, internalPriceAccess: false, activatedAt: null, suspendedAt: null } }));
            if ((await s.list("invitation", contextId)).some(i => i.data.membershipId === member!.id && !i.data.consumedAt && !i.data.revokedAt))
                fail("ALREADY_INVITED", 409, "이미 생성된 초대가 있습니다. 링크가 없거나 만료됐다면 명시적으로 재발급해 주세요.");
            const inv = (await s.create("invitation", { id: id(), contextId, data: { userId: user.id, membershipId: member.id, email, tokenHash: digestToken(raw), expiresAt: this.expiry(48 * 3600000), consumedAt: null, revokedAt: null, createdBy: p.user.id } }));
            (await this.audit(s, p, "invitation.created", inv.id, contextId, {}, { userId: user.id, membershipId: member.id }));
            this.fault?.("invite");
            return { id: inv.id, revision: inv.revision, token: raw, expiresAt: inv.data.expiresAt, emailSent: false, userId: user.id };
        });
    }
    async reissue(token: string | undefined, invitationId: string, input: Record<string, unknown>) {
        const expected = revision(input.expectedRevision);
        const raw = randomToken();
        return this.repo.transaction(async (s) => {
            const p = (await this.principal(s, token));
            const old = (await s.get("invitation", invitationId));
            if (!old)
                unavailable();
            (await needScope(s, p, old.contextId!, this.clock));
            (await needAdmin(s, p, old.contextId!, this.clock));
            if (old.revision !== expected)
                fail("CONFLICT", 409, "변경된 초대입니다. 새로고침해 주세요.");
            const user = (await s.get("user", old.data.userId))!;
            const member = (await s.get("membership", old.data.membershipId))!;
            if (user.data.status === "suspended" || member.data.status !== "invited" || old.data.consumedAt || old.data.revokedAt)
                fail("CONFLICT", 409, "현재 상태에서는 재발급할 수 없습니다.");
            (await s.update("invitation", old.id, old.revision, { ...old.data, revokedAt: this.clock() }));
            const inv = (await s.create("invitation", { id: id(), contextId: old.contextId, data: { ...old.data, tokenHash: digestToken(raw), expiresAt: this.expiry(48 * 3600000), revokedAt: null, consumedAt: null, createdBy: p.user.id } }));
            (await this.audit(s, p, "invitation.reissued", inv.id, old.contextId, { invitationId: old.id }, { invitationId: inv.id }));
            this.fault?.("reissue");
            return { id: inv.id, revision: inv.revision, token: raw, expiresAt: inv.data.expiresAt, emailSent: false };
        });
    }
    async accept(token: string | undefined, input: Record<string, unknown>) {
        const raw = text(input.token, "초대 링크", 200);
        if (!await this.throttle(`accept:${digestToken(raw)}`))
            fail("RATE_LIMITED", 429, "시도가 많습니다. 잠시 후 다시 시도해 주세요.");
        const initial = (await this.repo.list("invitation")).find(i => i.data.tokenHash === digestToken(raw));
        if (!initial)
            fail("INVITATION_INVALID", 410, "유효하지 않거나 만료된 초대입니다. 관리자에게 재발급을 요청하세요.");
        const before = await this.repo.get("user", initial.data.userId);
        const credential = before?.data.status === "invited" ? await hashPassword(passwordValue(input.password), before.id) : null;
        return this.repo.transaction(async (s) => {
            const inv = (await s.get("invitation", initial.id))!;
            const user = (await s.get("user", inv.data.userId))!;
            const member = (await s.get("membership", inv.data.membershipId))!;
            if (inv.data.revokedAt || inv.data.consumedAt || inv.data.expiresAt <= this.clock() || member.data.status !== "invited")
                fail("INVITATION_INVALID", 410, "유효하지 않거나 만료된 초대입니다. 관리자에게 재발급을 요청하세요.");
            if (user.data.status === "suspended")
                fail("ACCOUNT_SUSPENDED", 403, "중지된 계정입니다.");
            if (user.data.status === "active") {
                const p = (await this.principal(s, token));
                if (p.user.id !== user.id)
                    fail("INVITATION_ACCOUNT", 403, "초대받은 계정으로 로그인해 주세요.");
            }
            else {
                if (!credential || before?.revision !== user.revision)
                    fail("CONFLICT", 409, "계정 상태가 변경됐습니다.");
                (await s.create("credential", { id: id(), contextId: null, data: credential }));
                (await s.update("user", user.id, user.revision, { ...user.data, status: "active" }));
            }
            (await s.update("membership", member.id, member.revision, { ...member.data, status: "active", activatedAt: this.clock() }));
            (await s.update("invitation", inv.id, inv.revision, { ...inv.data, consumedAt: this.clock() }));
            (await s.create("audit", { id: id(), contextId: inv.contextId, data: { actorId: user.id, action: "invitation.accepted", targetId: inv.id, before: { status: "invited" }, after: { status: "active", membershipId: member.id }, at: this.clock() } }));
            this.fault?.("accept");
            return { accepted: true, contextId: inv.contextId, loginRequired: true };
        });
    }
    async setUserStatus(token: string | undefined, userId: string, input: Record<string, unknown>) {
        const expected = revision(input.expectedRevision);
        const status = input.status;
        if (status !== "active" && status !== "suspended")
            fail("VALIDATION", 422, "계정 상태를 확인해 주세요.");
        return this.repo.transaction(async (s) => {
            const p = (await this.principal(s, token));
            (await needAdmin(s, p, undefined, this.clock));
            const user = (await s.get("user", userId));
            if (!user)
                unavailable();
            if (user.id === p.user.id)
                fail("CONFLICT", 409, "현재 관리자 자신의 계정은 이 화면에서 중지할 수 없습니다.");
            if (user.data.status === "invited")
                fail("CONFLICT", 409, "초대 수락으로 계정을 활성화해 주세요.");
            const updated = (await s.update("user", user.id, expected, { ...user.data, status, authVersion: (user.data.authVersion ?? 0) + 1 }));
            for (const session of (await s.list("session")).filter(r => r.data.userId === userId && !r.data.revokedAt))
                (await s.update("session", session.id, session.revision, { ...session.data, revokedAt: this.clock() }));
            if (status === "suspended")
                (await this.markAssignments(s, userId));
            (await this.audit(s, p, "user.status", userId, null, { status: user.data.status }, { status }));
            this.fault?.("suspend");
            return memberIdentity(updated);
        });
    }
    private async markAssignments(s: UnitOfWork, userId: string, contextId?: string) {
        for (const task of (await s.list("task", contextId)).filter(t => (t.data.assigneeId === userId || t.data.ownerId === userId || t.data.coAssigneeIds?.includes(userId)) && t.data.status !== "completed"))
            (await s.update("task", task.id, task.revision, { ...task.data, assignmentNeedsAttention: true }));
    }
    async setMembership(token: string | undefined, contextId: string, memberId: string, input: Record<string, unknown>) {
        const expected = revision(input.expectedRevision);
        const status = input.status;
        if (status !== "active" && status !== "suspended")
            fail("VALIDATION", 422, "멤버십 상태를 확인해 주세요.");
        return this.repo.transaction(async (s) => {
            const p = (await this.principal(s, token));
            (await needScope(s, p, contextId, this.clock));
            (await needAdmin(s, p, contextId, this.clock));
            const member = (await s.get("membership", memberId));
            if (!member || member.contextId !== contextId)
                unavailable();
            const user = (await s.get("user", member.data.userId))!;
            if (member.data.status === "invited")
                fail("CONFLICT", 409, "초대 대기 멤버십은 수락 전에 중지하거나 활성화할 수 없습니다.");
            if (status === "active" && user.data.status !== "active")
                fail("CONFLICT", 409, "계정 활성화와 초대 수락을 먼저 완료해 주세요.");
            const scope = input.scope === undefined ? member.data.scope : text(input.scope, "담당 범위", 500);
            const price = input.internalPriceAccess === undefined ? member.data.internalPriceAccess : input.internalPriceAccess;
            if (typeof price !== "boolean" || price && member.data.role !== "operator")
                fail("VALIDATION", 422, "내부 가격 권한을 확인해 주세요.");
            const changed = (await s.update("membership", member.id, expected, { ...member.data, status, scope, internalPriceAccess: price, suspendedAt: status === "suspended" ? this.clock() : null }));
            if (status === "suspended")
                (await this.markAssignments(s, user.id, contextId));
            (await this.audit(s, p, "membership.changed", member.id, contextId, { status: member.data.status, scope: member.data.scope, internalPriceAccess: member.data.internalPriceAccess }, { status, scope, internalPriceAccess: price }));
            this.fault?.("membership");
            return projectMembership(changed);
        });
    }
    async reassign(token: string | undefined, contextId: string, input: Record<string, unknown>) {
        const taskId = text(input.taskId, "업무");
        const toUserId = text(input.toUserId, "담당자");
        const expected = revision(input.expectedRevision);
        const role = input.assignmentRole ?? "brand";
        if (role !== "brand" && role !== "gsg")
            fail("VALIDATION", 422, "배정 역할을 확인해 주세요.");
        return this.repo.transaction(async (s) => {
            const p = (await this.principal(s, token));
            (await needScope(s, p, contextId, this.clock));
            (await authorize(s, p, "task.manage", { id: taskId, contextId, kind: "task", visibility: "public" }, this.clock));
            const task = (await s.get("task", taskId));
            if (!task || task.contextId !== contextId)
                unavailable();
            const target = (await s.get("user", toUserId));
            const member = (await activeMember(s, toUserId, contextId));
            if (!target || target.data.status !== "active" || target.data.role !== role || !member)
                fail("VALIDATION", 422, "같은 컨텍스트의 활성 담당자를 역할에 맞게 선택해 주세요.");
            const next = { ...task.data, ...(role === "brand" ? { assigneeId: toUserId, ...(task.data.coAssigneeIds ? { coAssigneeIds: task.data.coAssigneeIds.filter(uid => uid !== toUserId) } : {}) } : { ownerId: toUserId }) };
            const assignmentNeedsAttention = (await asyncSome([next.assigneeId, next.ownerId, ...(next.coAssigneeIds ?? [])], async (uid) => (await s.get("user", uid))?.data.status !== "active" || !(await activeMember(s, uid, contextId))));
            const changed = (await s.update("task", task.id, expected, { ...next, assignmentNeedsAttention }));
            (await this.audit(s, p, "task.reassigned", task.id, contextId, { assigneeId: task.data.assigneeId, ownerId: task.data.ownerId, authorId: task.data.authorId, coAssigneeIds: task.data.coAssigneeIds ?? [] }, { assigneeId: changed.data.assigneeId, ownerId: changed.data.ownerId, authorId: changed.data.authorId, coAssigneeIds: changed.data.coAssigneeIds ?? [] }));
            if (task.data.schemaVersion === 2)
                (await s.create("domainEvent", { id: id(), contextId, data: { eventType: "TASK_ASSIGNMENT_CHANGED", targetId: task.id, sourceVersionId: task.data.currentRequestId ?? null, actorId: p.user.id, at: this.clock() } }));
            this.fault?.("reassign");
            return (await projectTask(s, p, changed, this.clock));
        });
    }
}
