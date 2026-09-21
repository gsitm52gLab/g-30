import { randomUUID } from "node:crypto";
import { catalog } from "@/domain/catalog";
import { type RecordRepository, type UnitOfWork, type StoredRecord, type Clock, systemClock, type ContextData } from "@/domain/records";
import { digestToken, randomToken, hashPassword, verifyPassword } from "./crypto";
export class AuthError extends Error {
    constructor(public code: string, public status: number, message: string) { super(message); this.name = "AuthError"; }
}
export function fail(code: string, status: number, message: string): never { throw new AuthError(code, status, message); }
/** Identity fields needed for member management; never serialize another user's grants. */
const memberIdentity = (u: StoredRecord<"user">) => ({
    id: u.id, revision: u.revision, name: u.data.name,
    email: u.data.email, role: u.data.role, status: u.data.status,
});
/** Capability details are returned only to the authenticated account itself. */
const sessionUser = (u: StoredRecord<"user">) => ({
    ...memberIdentity(u), adminGrant: u.data.adminGrant ?? null,
});
export type Principal = {
    user: StoredRecord<"user">;
    session: StoredRecord<"session">;
};
const id = () => randomUUID();
export const normalizeEmail = (v: unknown) => typeof v === "string" ? v.trim().toLowerCase() : "";
export function text(v: unknown, label: string, max = 200): string { if (typeof v !== "string" || !v.trim() || v.length > max)
    fail("VALIDATION", 422, `${label} 값을 확인해 주세요.`); return v.trim(); }
export function revision(v: unknown): number { if (!Number.isSafeInteger(v) || Number(v) < 1)
    fail("VALIDATION", 422, "저장 버전을 확인해 주세요."); return Number(v); }
export function passwordValue(v: unknown): string { if (typeof v !== "string" || v.length < 12 || v.length > 128)
    fail("VALIDATION", 422, "비밀번호는 12~128자로 입력해 주세요."); return v; }
function emailValue(v: unknown): string { const email = normalizeEmail(v); if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    fail("VALIDATION", 422, "이메일을 확인해 주세요."); return email; }
function activeMember(s: UnitOfWork, userId: string, contextId: string) { return s.list("membership", contextId).find(m => m.data.userId === userId && m.data.status === "active"); }
export function canAdmin(user: StoredRecord<"user">, contextId?: string) { const g = user.data.adminGrant; return user.data.role === "gsg" && !!g && (g.scope === "all" || !!contextId && g.contextIds.includes(contextId)); }
export function hasScope(s: UnitOfWork, p: Principal, contextId: string) { return !!s.get("context", contextId) && (canAdmin(p.user, contextId) || !!activeMember(s, p.user.id, contextId)); }
export function needScope(s: UnitOfWork, p: Principal, contextId: string) { if (!hasScope(s, p, contextId))
    fail("NOT_FOUND", 404, "자료를 찾을 수 없습니다."); }
function needAdmin(p: Principal, contextId?: string) { if (!canAdmin(p.user, contextId))
    fail("FORBIDDEN", 403, "관리 권한이 필요합니다."); }
export class IdentityService {
    constructor(public repo: RecordRepository, public clock: Clock = systemClock, private fault?: (operation: string) => void) { }
    private expiry(ms: number) { return new Date(Date.parse(this.clock()) + ms).toISOString(); }
    session(s: UnitOfWork, token: string | undefined) { if (!token || token.length > 200)
        return null; const row = s.list("session").find(r => r.data.tokenHash === digestToken(token)); return row && !row.data.revokedAt && row.data.expiresAt > this.clock() ? row : null; }
    principal(s: UnitOfWork, token: string | undefined): Principal { const session = this.session(s, token); const user = session?.data.userId ? s.get("user", session.data.userId) : null; if (!session || !user || user.data.status !== "active" || user.data.authVersion !== session.data.authVersion)
        fail("UNAUTHENTICATED", 401, "로그인이 필요합니다."); return { user, session }; }
    private audit(s: UnitOfWork, p: Principal, action: string, targetId: string, contextId: string | null, before: Record<string, unknown>, after: Record<string, unknown>) { s.create("audit", { id: id(), contextId, data: { actorId: p.user.id, action, targetId, before, after, at: this.clock() } }); }
    private issue(s: UnitOfWork, user: StoredRecord<"user"> | null) { const token = randomToken(); const row = s.create("session", { id: id(), contextId: null, data: { userId: user?.id ?? null, tokenHash: digestToken(token), csrfToken: randomToken(), authVersion: user?.data.authVersion ?? 0, expiresAt: this.expiry(user ? 8 * 3600000 : 15 * 60000), revokedAt: null } }); return { token, csrfToken: row.data.csrfToken, expiresAt: row.data.expiresAt }; }
    async csrf(token?: string) { return this.repo.transaction(s => { const old = this.session(s, token); if (old && (!old.data.userId || s.get("user", old.data.userId)?.data.status === "active" && s.get("user", old.data.userId)?.data.authVersion === old.data.authVersion))
        return { csrfToken: old.data.csrfToken, expiresAt: old.data.expiresAt, token: undefined }; return this.issue(s, null); }); }
    async checkCsrf(token: string | undefined, csrf: string | null) { return this.repo.transaction(s => { const session = this.session(s, token); if (!session || !csrf || session.data.csrfToken !== csrf)
        fail("CSRF", 403, "요청을 확인할 수 없습니다. 다시 시도해 주세요."); }); }
    async throttle(key: string) { const now = this.clock(); return this.repo.transaction(s => { const keyId = digestToken(key); const old = s.get("throttle", keyId); if (old && old.data.until > now && old.data.count >= 20)
        return false; const data = { count: old && old.data.until > now ? old.data.count + 1 : 1, until: old && old.data.until > now ? old.data.until : this.expiry(15 * 60000) }; if (old)
        s.update("throttle", old.id, old.revision, data);
    else
        s.create("throttle", { id: keyId, contextId: null, data }); return true; }); }
    async login(token: string | undefined, input: Record<string, unknown>) { const email = emailValue(input.email); const password = passwordValue(input.password); if (!await this.throttle(`login:${email}`))
        fail("RATE_LIMITED", 429, "시도가 많습니다. 잠시 후 다시 시도해 주세요."); const user = (await this.repo.list("user")).find(u => u.data.normalizedEmail === email); const credential = user ? (await this.repo.list("credential")).find(c => c.data.userId === user.id) : undefined; const valid = await verifyPassword(password, credential?.data); if (!valid || !user)
        fail("LOGIN_FAILED", 401, "이메일 또는 비밀번호를 확인해 주세요."); return this.repo.transaction(s => { const current = s.get("user", user.id); const currentCredential = credential ? s.get("credential", credential.id) : null; if (!current || current.data.status !== "active" || current.data.authVersion !== user.data.authVersion || currentCredential?.revision !== credential?.revision)
        fail("LOGIN_FAILED", 401, "이메일 또는 계정 상태를 확인해 주세요."); const old = this.session(s, token); if (old)
        s.update("session", old.id, old.revision, { ...old.data, revokedAt: this.clock() }); return { ...this.issue(s, current), user: sessionUser(current) }; }); }
    async logout(token?: string) { return this.repo.transaction(s => { const session = this.session(s, token); if (session)
        s.update("session", session.id, session.revision, { ...session.data, revokedAt: this.clock() }); }); }
    async me(token?: string) { return this.repo.transaction(s => { const p = this.principal(s, token); const contexts = s.list("context").filter(c => hasScope(s, p, c.id)); return { storageMode: this.repo.mode, user: sessionUser(p.user), contexts, memberships: s.list("membership").filter(m => m.data.userId === p.user.id), canCreateContext: canAdmin(p.user) }; }); }
    async createContext(token: string | undefined, input: Record<string, unknown>) { const type = input.type; if (type !== "retail" && type !== "event")
        fail("VALIDATION", 422, "컨텍스트 유형을 확인해 주세요."); const country = catalog.countries.find(x => x.id === input.countryId); const brand = catalog.brands.find(x => x.id === input.brandId); const retailer = catalog.retailers.find(x => x.id === input.retailerId); if (!country || !brand || type === "retail" && !retailer || type === "event" && input.retailerId)
        fail("VALIDATION", 422, "국가·브랜드·리테일러를 확인해 주세요."); const eventName = type === "event" ? text(input.eventName, "행사명") : undefined; const data: ContextData = { country: country.name, brand: brand.name, retailer: type === "event" ? "리테일러 미지정" : retailer!.name, type, countryId: country.id, brandId: brand.id, retailerId: type === "event" ? null : retailer!.id, eventName, combinationKey: type === "event" ? `event:${country.id}:${brand.id}:${eventName}` : `retail:${country.id}:${retailer!.id}:${brand.id}` }; return this.repo.transaction(s => { const p = this.principal(s, token); needAdmin(p); const row = s.create("context", { id: id(), contextId: null, data }); this.audit(s, p, "context.created", row.id, row.id, {}, data as unknown as Record<string, unknown>); this.fault?.("context"); return row; }); }
    async members(token: string | undefined, contextId: string) { return this.repo.transaction(s => { const p = this.principal(s, token); needScope(s, p, contextId); needAdmin(p, contextId); return { context: s.get("context", contextId), members: s.list("membership", contextId).map(m => ({ ...m, user: memberIdentity(s.get("user", m.data.userId)!) })), invitations: s.list("invitation", contextId).map(r => ({ id: r.id, revision: r.revision, userId: r.data.userId, membershipId: r.data.membershipId, expiresAt: r.data.expiresAt, consumedAt: r.data.consumedAt, revokedAt: r.data.revokedAt })), tasks: s.list("task", contextId), history: s.list("audit").filter(a => a.contextId === contextId || a.contextId === null && s.list("membership", contextId).some(m => m.data.userId === a.data.targetId)), canManageAccounts: canAdmin(p.user) }; }); }
    async invite(token: string | undefined, contextId: string, input: Record<string, unknown>) { const email = emailValue(input.email); const name = text(input.name, "이름"); const role = input.role; if (role !== "brand" && role !== "operator")
        fail("VALIDATION", 422, "브랜드 또는 GSG 운영자 역할만 지원합니다."); const scope = typeof input.scope === "string" ? input.scope.trim().slice(0, 500) : ""; const raw = randomToken(); return this.repo.transaction(s => { const p = this.principal(s, token); needScope(s, p, contextId); needAdmin(p, contextId); let user = s.list("user").find(u => u.data.normalizedEmail === email); if (user && ((user.data.role === "gsg") !== (role === "operator")))
        fail("CONFLICT", 409, "기존 계정의 유형과 역할이 다릅니다."); if (user?.data.status === "suspended")
        fail("ACCOUNT_SUSPENDED", 409, "중지된 계정은 먼저 관리자가 복구해야 합니다."); if (!user)
        user = s.create("user", { id: id(), contextId: null, data: { name, email, normalizedEmail: email, role: role === "operator" ? "gsg" : "brand", status: "invited", authVersion: 1, adminGrant: null } }); let member = s.list("membership", contextId).find(m => m.data.userId === user!.id); if (member?.data.status === "active")
        fail("ALREADY_MEMBER", 409, "이미 활성 멤버입니다."); if (member?.data.status === "suspended")
        fail("MEMBER_SUSPENDED", 409, "중지된 멤버십은 명시적으로 복구해 주세요."); if (!member)
        member = s.create("membership", { id: id(), contextId, data: { userId: user.id, role, status: "invited", scope, internalPriceAccess: false, activatedAt: null, suspendedAt: null } }); if (s.list("invitation", contextId).some(i => i.data.membershipId === member!.id && !i.data.consumedAt && !i.data.revokedAt))
        fail("ALREADY_INVITED", 409, "이미 생성된 초대가 있습니다. 링크가 없거나 만료됐다면 명시적으로 재발급해 주세요."); const inv = s.create("invitation", { id: id(), contextId, data: { userId: user.id, membershipId: member.id, email, tokenHash: digestToken(raw), expiresAt: this.expiry(48 * 3600000), consumedAt: null, revokedAt: null, createdBy: p.user.id } }); this.audit(s, p, "invitation.created", inv.id, contextId, {}, { userId: user.id, membershipId: member.id }); this.fault?.("invite"); return { id: inv.id, revision: inv.revision, token: raw, expiresAt: inv.data.expiresAt, emailSent: false, userId: user.id }; }); }
    async reissue(token: string | undefined, invitationId: string, input: Record<string, unknown>) { const expected = revision(input.expectedRevision); const raw = randomToken(); return this.repo.transaction(s => { const p = this.principal(s, token); const old = s.get("invitation", invitationId); if (!old)
        fail("NOT_FOUND", 404, "초대를 찾을 수 없습니다."); needScope(s, p, old.contextId!); needAdmin(p, old.contextId!); if (old.revision !== expected)
        fail("CONFLICT", 409, "변경된 초대입니다. 새로고침해 주세요."); const user = s.get("user", old.data.userId)!; const member = s.get("membership", old.data.membershipId)!; if (user.data.status === "suspended" || member.data.status !== "invited" || old.data.consumedAt || old.data.revokedAt)
        fail("CONFLICT", 409, "현재 상태에서는 재발급할 수 없습니다."); s.update("invitation", old.id, old.revision, { ...old.data, revokedAt: this.clock() }); const inv = s.create("invitation", { id: id(), contextId: old.contextId, data: { ...old.data, tokenHash: digestToken(raw), expiresAt: this.expiry(48 * 3600000), revokedAt: null, consumedAt: null, createdBy: p.user.id } }); this.audit(s, p, "invitation.reissued", inv.id, old.contextId, { invitationId: old.id }, { invitationId: inv.id }); this.fault?.("reissue"); return { id: inv.id, revision: inv.revision, token: raw, expiresAt: inv.data.expiresAt, emailSent: false }; }); }
    async accept(token: string | undefined, input: Record<string, unknown>) { const raw = text(input.token, "초대 링크", 200); if (!await this.throttle(`accept:${digestToken(raw)}`))
        fail("RATE_LIMITED", 429, "시도가 많습니다. 잠시 후 다시 시도해 주세요."); const initial = (await this.repo.list("invitation")).find(i => i.data.tokenHash === digestToken(raw)); if (!initial)
        fail("INVITATION_INVALID", 410, "유효하지 않거나 만료된 초대입니다. 관리자에게 재발급을 요청하세요."); const before = await this.repo.get("user", initial.data.userId); const credential = before?.data.status === "invited" ? await hashPassword(passwordValue(input.password), before.id) : null; return this.repo.transaction(s => { const inv = s.get("invitation", initial.id)!; const user = s.get("user", inv.data.userId)!; const member = s.get("membership", inv.data.membershipId)!; if (inv.data.revokedAt || inv.data.consumedAt || inv.data.expiresAt <= this.clock() || member.data.status !== "invited")
        fail("INVITATION_INVALID", 410, "유효하지 않거나 만료된 초대입니다. 관리자에게 재발급을 요청하세요."); if (user.data.status === "suspended")
        fail("ACCOUNT_SUSPENDED", 403, "중지된 계정입니다."); if (user.data.status === "active") {
        const p = this.principal(s, token);
        if (p.user.id !== user.id)
            fail("INVITATION_ACCOUNT", 403, "초대받은 계정으로 로그인해 주세요.");
    }
    else {
        if (!credential || before?.revision !== user.revision)
            fail("CONFLICT", 409, "계정 상태가 변경됐습니다.");
        s.create("credential", { id: id(), contextId: null, data: credential });
        s.update("user", user.id, user.revision, { ...user.data, status: "active" });
    } s.update("membership", member.id, member.revision, { ...member.data, status: "active", activatedAt: this.clock() }); s.update("invitation", inv.id, inv.revision, { ...inv.data, consumedAt: this.clock() }); s.create("audit", { id: id(), contextId: inv.contextId, data: { actorId: user.id, action: "invitation.accepted", targetId: inv.id, before: { status: "invited" }, after: { status: "active", membershipId: member.id }, at: this.clock() } }); this.fault?.("accept"); return { accepted: true, contextId: inv.contextId, loginRequired: true }; }); }
    async setUserStatus(token: string | undefined, userId: string, input: Record<string, unknown>) { const expected = revision(input.expectedRevision); const status = input.status; if (status !== "active" && status !== "suspended")
        fail("VALIDATION", 422, "계정 상태를 확인해 주세요."); return this.repo.transaction(s => { const p = this.principal(s, token); needAdmin(p); const user = s.get("user", userId); if (!user)
        fail("NOT_FOUND", 404, "사용자를 찾을 수 없습니다."); if (user.id === p.user.id)
        fail("CONFLICT", 409, "현재 관리자 자신의 계정은 이 화면에서 중지할 수 없습니다."); if (user.data.status === "invited")
        fail("CONFLICT", 409, "초대 수락으로 계정을 활성화해 주세요."); const updated = s.update("user", user.id, expected, { ...user.data, status, authVersion: (user.data.authVersion ?? 0) + 1 }); for (const session of s.list("session").filter(r => r.data.userId === userId && !r.data.revokedAt))
        s.update("session", session.id, session.revision, { ...session.data, revokedAt: this.clock() }); if (status === "suspended")
        this.markAssignments(s, userId); this.audit(s, p, "user.status", userId, null, { status: user.data.status }, { status }); this.fault?.("suspend"); return memberIdentity(updated); }); }
    private markAssignments(s: UnitOfWork, userId: string, contextId?: string) { for (const task of s.list("task", contextId).filter(t => (t.data.assigneeId === userId || t.data.ownerId === userId) && t.data.status !== "completed"))
        s.update("task", task.id, task.revision, { ...task.data, assignmentNeedsAttention: true }); }
    async setMembership(token: string | undefined, contextId: string, memberId: string, input: Record<string, unknown>) { const expected = revision(input.expectedRevision); const status = input.status; if (status !== "active" && status !== "suspended")
        fail("VALIDATION", 422, "멤버십 상태를 확인해 주세요."); return this.repo.transaction(s => { const p = this.principal(s, token); needScope(s, p, contextId); needAdmin(p, contextId); const member = s.get("membership", memberId); if (!member || member.contextId !== contextId)
        fail("NOT_FOUND", 404, "멤버십을 찾을 수 없습니다."); const user = s.get("user", member.data.userId)!; if (member.data.status === "invited")
        fail("CONFLICT", 409, "초대 대기 멤버십은 수락 전에 중지하거나 활성화할 수 없습니다."); if (status === "active" && user.data.status !== "active")
        fail("CONFLICT", 409, "계정 활성화와 초대 수락을 먼저 완료해 주세요."); const scope = input.scope === undefined ? member.data.scope : text(input.scope, "담당 범위", 500); const price = input.internalPriceAccess === undefined ? member.data.internalPriceAccess : input.internalPriceAccess; if (typeof price !== "boolean" || price && member.data.role !== "operator")
        fail("VALIDATION", 422, "내부 가격 권한을 확인해 주세요."); const changed = s.update("membership", member.id, expected, { ...member.data, status, scope, internalPriceAccess: price, suspendedAt: status === "suspended" ? this.clock() : null }); if (status === "suspended")
        this.markAssignments(s, user.id, contextId); this.audit(s, p, "membership.changed", member.id, contextId, { status: member.data.status, scope: member.data.scope, internalPriceAccess: member.data.internalPriceAccess }, { status, scope, internalPriceAccess: price }); this.fault?.("membership"); return changed; }); }
    async reassign(token: string | undefined, contextId: string, input: Record<string, unknown>) { const taskId = text(input.taskId, "업무"); const toUserId = text(input.toUserId, "담당자"); const expected = revision(input.expectedRevision); const role = input.assignmentRole ?? "brand"; if (role !== "brand" && role !== "gsg")
        fail("VALIDATION", 422, "배정 역할을 확인해 주세요."); return this.repo.transaction(s => { const p = this.principal(s, token); needScope(s, p, contextId); if (p.user.data.role !== "gsg")
        fail("FORBIDDEN", 403, "GSG 담당자만 재배정할 수 있습니다."); const task = s.get("task", taskId); if (!task || task.contextId !== contextId)
        fail("NOT_FOUND", 404, "업무를 찾을 수 없습니다."); const target = s.get("user", toUserId); const member = activeMember(s, toUserId, contextId); if (!target || target.data.status !== "active" || target.data.role !== role || !member)
        fail("VALIDATION", 422, "같은 컨텍스트의 활성 담당자를 역할에 맞게 선택해 주세요."); const next = { ...task.data, ...(role === "brand" ? { assigneeId: toUserId } : { ownerId: toUserId }) }; const assignmentNeedsAttention = [next.assigneeId, next.ownerId].some(uid => s.get("user", uid)?.data.status !== "active" || !activeMember(s, uid, contextId)); const changed = s.update("task", task.id, expected, { ...next, assignmentNeedsAttention }); this.audit(s, p, "task.reassigned", task.id, contextId, { assigneeId: task.data.assigneeId, ownerId: task.data.ownerId, authorId: task.data.authorId }, { assigneeId: changed.data.assigneeId, ownerId: changed.data.ownerId, authorId: changed.data.authorId }); this.fault?.("reassign"); return changed; }); }
}
