import { resolveProduct, visibleProductRelations } from "@/server/products/access";
import { latestSubmission } from "@/server/submissions/read";
import { safeEvaluation } from "@/server/submissions/projection";
import { canReferenceFile, visibleFile } from "@/server/files/access";
import { createHash, randomUUID } from "node:crypto";
import type { UnitOfWork, StoredRecord } from "@/domain/records";
import type { RequestContent, PriorSubmissionData } from "@/domain/tasks/types";
import { content, deadline, enumValue, ids, list, object, str, dateValue } from "@/domain/tasks/validate";
import { evaluateRequirements } from "@/domain/tasks/evaluate";
import { IdentityService, type Principal, revision, hasScope } from "@/server/auth/service";
import { fail, unavailable } from "@/server/auth/errors";
import { authorize, activeMember, decide } from "@/server/policy/policy";
import { taskScope, projectTask, projectContext, projectAudit } from "@/server/policy/projection";
import { projectedRequest, projectedVersion, projectedActivity, projectedTemplate, projectedProject, projectedRequirementStatus, stringList } from "./projection";
const id = () => randomUUID();
type Target = { contextId: string; ownerId: string; assigneeId: string; coAssigneeIds: string[]; productIds: string[] };
export class TaskService {
    constructor(public identity: IdentityService, private fault?: (stage: string) => void) {}
    get clock() { return this.identity.clock; }
    manage(s: UnitOfWork, p: Principal, contextId: string) { authorize(s, p, "task.manage", { id: contextId, contextId, kind: "task", visibility: "public" }, this.clock); }
    task(s: UnitOfWork, p: Principal, taskId: string, manage = false) {
        const row = s.get("task", taskId); if (!row) unavailable();
        authorize(s, p, manage ? "task.manage" : "task.read", taskScope(row), this.clock); return row;
    }
    private fresh(row: StoredRecord<"task"> | StoredRecord<"project">, expected: unknown) {
        if (row.revision !== revision(expected)) fail("CONFLICT", 409, "다른 사용자가 변경했습니다. 최신 내용을 다시 불러와 입력을 재적용해 주세요.");
    }
    private audit(s: UnitOfWork, p: Principal, contextId: string, action: string, targetId: string, before: Record<string, unknown>, after: Record<string, unknown>) {
        s.create("audit", { id: id(), contextId, data: { actorId: p.user.id, action, targetId, before, after, at: this.clock() } });
    }
    private event(s: UnitOfWork, p: Principal, contextId: string, eventType: string, targetId: string, sourceVersionId: string | null) {
        s.create("domainEvent", { id: id(), contextId, data: { eventType, targetId, sourceVersionId, actorId: p.user.id, at: this.clock() } });
    }
    /** G05 may use the same UoW shape: fresh principal -> command -> snapshot/audit/event/receipt. */
    private receipt(s: UnitOfWork, p: Principal, contextId: string, command: string, input: Record<string, unknown>, action: () => { ids: string[] }) {
        const key = str(input.idempotencyKey, 160, true);
        const compound = createHash("sha256").update(`${p.user.id}:${contextId}:${command}:${key}`).digest("hex");
        const bodyHash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
        const old = s.list("commandReceipt").find(r => r.data.key === compound);
        if (old) { if (old.data.bodyHash !== bodyHash) fail("CONFLICT", 409, "같은 재시도 키에 다른 내용을 사용할 수 없습니다."); return old.data.result; }
        const result = action(); this.fault?.(command);
        s.create("commandReceipt", { id: id(), contextId, data: { key: compound, actorId: p.user.id, command, bodyHash, result } }); return result;
    }
    private target(s: UnitOfWork, p: Principal, input: unknown): Target {
        const v = object(input, ["contextId", "ownerId", "assigneeId", "coAssigneeIds", "productIds"]);
        const contextId = str(v.contextId, 160, true); this.manage(s, p, contextId);
        const ownerId = str(v.ownerId, 160, true), assigneeId = str(v.assigneeId, 160, true), coAssigneeIds = ids(v.coAssigneeIds, 30), productIds = ids(v.productIds);
        if (coAssigneeIds.includes(assigneeId)) fail("VALIDATION", 422, "주담당과 공동담당은 구분해 주세요.");
        for (const [uid, role] of [[ownerId, "gsg"], [assigneeId, "brand"], ...coAssigneeIds.map(uid => [uid, "brand"])]) {
            const u = s.get("user", uid), m = activeMember(s, uid, contextId);
            if (!u || u.data.status !== "active" || u.data.role !== role || !m || m.data.role !== (role === "gsg" ? "operator" : "brand")) fail("VALIDATION", 422, "담당자는 같은 컨텍스트의 활성 멤버여야 합니다.");
        }
        for (const productId of productIds) resolveProduct(s,p,contextId,productId,this.clock);
        return { contextId, ownerId, assigneeId, coAssigneeIds, productIds };
    }
    private validateContent(s: UnitOfWork, p: Principal, target: Target, c: RequestContent, taskId?: string) {
        for (const d of [c.deadline, ...c.milestones.map(m => m.deadline)]) {
            if (!activeMember(s, d.responsibleUserId, target.contextId) || s.get("user", d.responsibleUserId)?.data.status !== "active") fail("VALIDATION", 422, "기한 확인 주체는 활성 멤버여야 합니다.");
        }
        if (c.requirements.some(q => q.productIds.some(pid => !target.productIds.includes(pid)))) fail("VALIDATION", 422, "요청 항목의 제품 범위를 확인해 주세요.");
        for (const fid of c.referenceFileIds) {
            const file = s.get("fileVersion", fid);
            if (!file || file.contextId !== target.contextId) unavailable();
            canReferenceFile(s,p,file,{id:taskId ?? "new-task",contextId:target.contextId,kind:"task",visibility:"draft"},this.clock);
        }
    }
    private template(s: UnitOfWork, p: Principal, contextId: string, versionId: unknown) {
        if (versionId === null || versionId === undefined || versionId === "") return null;
        const row = s.get("templateVersion", str(versionId, 160, true));
        if (!row || row.contextId !== contextId && !(row.contextId === null && row.data.builtin && row.id.startsWith("builtin-"))) unavailable();
        this.manage(s, p, contextId); return row;
    }
    private createOne(s: UnitOfWork, p: Principal, target: Target, c: RequestContent, category: "onboarding" | "spot", projectId: string | null, templateId: string | null, subtype: string) {
        this.validateContent(s, p, target, c);
        const taskId = id();
        s.create("task", { id: taskId, contextId: target.contextId, data: { schemaVersion: 2, visibility: "draft", title: c.title, category, ownerId: target.ownerId, assigneeId: target.assigneeId, coAssigneeIds: target.coAssigneeIds, productIds: target.productIds, description: c.description, status: "draft", deadline: c.deadline.value, nextAction: c.nextAction, notes: [], authorId: p.user.id, contributorIds: [], assignmentNeedsAttention: false, subtype, projectId, draft: c, currentRequestId: null, templateVersionId: templateId, cycle: null } });
        this.audit(s, p, target.contextId, "task.created", taskId, {}, { title: c.title, category, projectId }); return taskId;
    }
    async create(token: string | undefined, input: Record<string, unknown>) {
        return this.identity.repo.transaction(s => { const p = this.identity.principal(s, token); const targets = list(input.targets, 20).map(v => this.target(s, p, v));
            if (!targets.length || new Set(targets.map(t => t.contextId)).size !== targets.length) fail("VALIDATION", 422, "서로 다른 대상 컨텍스트를 선택해 주세요.");
            const c = content(input.content); const category = enumValue(input.category, ["onboarding", "spot"]);
            return this.receipt(s, p, targets[0].contextId, "task.create", input, () => {
                const result: string[] = [];
                for (const t of targets) {
                    const template = this.template(s, p, t.contextId, input.templateVersionId);
                    const projectId = input.projectId ? str(input.projectId, 160, true) : null;
                    const project = projectId ? s.get("project", projectId) : null;
                    if (projectId && (!project || project.contextId !== t.contextId) || category === "onboarding" && !project) fail("VALIDATION", 422, "신규 입점 프로젝트를 선택해 주세요.");
                    const localContent = targets.length > 1 ? { ...c, deadline: { ...c.deadline, responsibleUserId: t.ownerId }, milestones: c.milestones.map(m => ({ ...m, deadline: { ...m.deadline, responsibleUserId: t.ownerId } })), requirements: c.requirements.map(q => ({ ...q, productIds: q.productIds.length ? t.productIds : [] })) } : c;
                    if (targets.length > 1 && c.requirements.some(q => q.productIds.length) && !t.productIds.length) fail("VALIDATION",422,"제품별 요청을 복제할 각 컨텍스트의 제품을 선택해 주세요.");
                    const tid = this.createOne(s, p, t, localContent, category, projectId, template?.id ?? null, str(input.subtype ?? "직접 작성", 200)); result.push(tid);
                    if (project) s.update("project", project.id, project.revision, { ...project.data, taskIds: [...project.data.taskIds, tid] });
                }
                return { ids: result };
            });
        });
    }
    async createProject(token: string | undefined, input: Record<string, unknown>) {
        return this.identity.repo.transaction(s => { const p = this.identity.principal(s, token), t = this.target(s, p, input.target); const title = str(input.title, 200, true); const templates = ids(input.templateVersionIds, 20).map(x => this.template(s, p, t.contextId, x)!);
            if (!templates.length) fail("VALIDATION", 422, "필요한 업무 유형을 선택해 주세요.");
            return this.receipt(s, p, t.contextId, "project.create", input, () => {
                const project = s.create("project", { id: id(), contextId: t.contextId, data: { title, taskIds: [], dependencies: [], status: "active", createdBy: p.user.id } });
                const taskIds = templates.map(template => this.createOne(s, p, t, { ...template.data.content, deadline: { ...template.data.content.deadline, responsibleUserId: t.ownerId } }, "onboarding", project.id, template.id, template.data.name));
                s.update("project", project.id, project.revision, { ...project.data, taskIds });
                this.audit(s, p, t.contextId, "project.created", project.id, {}, { title, taskCount: taskIds.length }); return { ids: [project.id, ...taskIds] };
            });
        });
    }
    async project(token: string | undefined, projectId: string) {
        return this.identity.repo.transaction(s => { const p = this.identity.principal(s, token), row = s.get("project", projectId); if (!row || !row.contextId) unavailable();
            authorize(s, p, "task.read", { id: row.id, contextId: row.contextId, kind: "task", visibility: "public" }, this.clock);
            const tasks = stringList(row.data.taskIds).map(t => s.get("task", t)).filter((t): t is StoredRecord<"task"> => !!t).filter(t => decide(s, p, "task.read", taskScope(t), this.clock).allowed).map(t => projectTask(s, p, t, this.clock));
            if (!tasks.length && p.user.data.role !== "gsg") unavailable();
            const visible = new Set(tasks.map(t => t.id));
            return { ...projectedProject(row, visible), tasks, canManage: p.user.data.role === "gsg" };
        });
    }
    async dependencies(token: string | undefined, projectId: string, input: Record<string, unknown>) {
        return this.identity.repo.transaction(s => { const p = this.identity.principal(s, token), row = s.get("project", projectId); if (!row?.contextId) unavailable(); this.manage(s, p, row.contextId);
            return this.receipt(s, p, row.contextId, `project.dependencies:${row.id}`, input, () => {
                this.fresh(row, input.expectedRevision);
                const edges = list(input.dependencies, 100).map(v => { const e = object(v, ["before", "after"]); return { before: str(e.before, 160, true), after: str(e.after, 160, true) }; });
                if (new Set(edges.map(e => `${e.before}:${e.after}`)).size !== edges.length || edges.some(e => e.before === e.after || !row.data.taskIds.includes(e.before) || !row.data.taskIds.includes(e.after))) fail("VALIDATION", 422, "같은 프로젝트의 서로 다른 업무를 연결해 주세요.");
                const visit = (node: string, stack: Set<string>) => { if (stack.has(node)) fail("VALIDATION", 422, "선행 관계가 순환합니다."); const next = new Set(stack).add(node); for (const e of edges.filter(e => e.before === node)) visit(e.after, next); };
                for (const taskId of row.data.taskIds) visit(taskId, new Set());
                s.update("project", row.id, row.revision, { ...row.data, dependencies: edges }); this.audit(s, p, row.contextId!, "project.dependencies", row.id, { count: row.data.dependencies.length }, { count: edges.length }); return { ids: [row.id] };
            });
        });
    }
    private resumeStatus(s: UnitOfWork, row: StoredRecord<"task">): "requested" | "in_progress" | "partial" | "submitted" {
        if (row.data.resumeStatus) return row.data.resumeStatus;
        const live = latestSubmission(s,row);
        if (live && live.data.requestId === row.data.currentRequestId) return live.data.mode === "full" ? "submitted" : "partial";
        // Legacy paused rows have no saved progress. Only the current version's actual
        // acceptance can restore in_progress; old versions never imply new acceptance.
        return row.data.currentRequestId && s.list("taskActivity", row.contextId!).some(a =>
            a.data.taskId === row.id && a.data.requestId === row.data.currentRequestId && a.data.kind === "accept") ? "in_progress" : "requested";
    }
    private publish(s: UnitOfWork, p: Principal, row: StoredRecord<"task">, c: RequestContent, templateVersionId = row.data.templateVersionId ?? null, preservedDraft?: RequestContent) {
        if (row.data.status === "completed") fail("REOPEN_REQUIRED", 409, "완료 이력을 보존하고 사유를 입력해 재개한 뒤 새 요청을 공개해 주세요.");
        if (!row.contextId || row.data.schemaVersion !== 2) fail("VALIDATION", 422, "새 요청 업무에서 공개해 주세요.");
        const target = this.target(s, p, { contextId: row.contextId, ownerId: row.data.ownerId, assigneeId: row.data.assigneeId, coAssigneeIds: row.data.coAssigneeIds ?? [], productIds: row.data.productIds });
        this.validateContent(s, p, target, c, row.id);
        if (!c.description.trim() || !c.requirements.length) fail("VALIDATION", 422, "공개 설명과 요청 항목을 작성해 주세요.");
        const previous = row.data.currentRequestId ? s.get("requestVersion", row.data.currentRequestId) : null;
        const version = s.create("requestVersion", { id: id(), contextId: row.contextId, data: { taskId: row.id, sequence: (previous?.data.sequence ?? 0) + 1, previousId: previous?.id ?? null, templateVersionId, content: c, publishedBy: p.user.id, publishedAt: this.clock(), changedKeys: c.requirements.filter(q => !previous?.data.content.requirements.some(old => JSON.stringify(old) === JSON.stringify(q))).map(q => q.key) } });
        s.update("task", row.id, row.revision, { ...row.data, visibility: "public", status: row.data.status === "draft" || row.data.submissionProgress && ["partial","submitted","in_progress"].includes(row.data.status) ? "requested" : row.data.status, resumeStatus: row.data.submissionProgress && ["on_hold","cancelled"].includes(row.data.status) ? "requested" : row.data.resumeStatus, title: c.title, description: c.description, deadline: c.deadline.value, nextAction: c.nextAction, currentRequestId: version.id, draft: preservedDraft ?? c, templateVersionId });
        this.audit(s, p, row.contextId, "task.published", row.id, { requestVersionId: previous?.id ?? null }, { requestVersionId: version.id, sequence: version.data.sequence });
        this.event(s, p, row.contextId, previous ? "TASK_REQUEST_REVISED" : "TASK_PUBLISHED", row.id, version.id); return version;
    }
    async command(token: string | undefined, taskId: string, input: Record<string, unknown>) {
        return this.identity.repo.transaction(s => { const p = this.identity.principal(s, token); const cmd = enumValue(input.command, ["save", "publish", "read", "accept", "schedule", "schedule_decide", "assign", "hold", "cancel", "resume", "duplicate"]);
            const manager = !["read", "accept", "schedule"].includes(cmd), row = this.task(s, p, taskId, manager);
            if (!row.contextId || row.data.schemaVersion !== 2 || !row.data.draft) fail("VALIDATION", 422, "기존 합성 예시는 읽기 전용입니다. 새 업무를 만들어 주세요.");
            if (cmd === "accept" || cmd === "schedule") authorize(s, p, "submission.write", taskScope(row), this.clock);
            return this.receipt(s, p, row.contextId, `task.${cmd}:${row.id}`, input, () => {
                this.fresh(row, input.expectedRevision);
                if (cmd === "save") {
                    const c = content(input.content);
                    this.validateContent(s, p, { contextId: row.contextId!, ownerId: row.data.ownerId, assigneeId: row.data.assigneeId, coAssigneeIds: row.data.coAssigneeIds ?? [], productIds: row.data.productIds }, c, row.id);
                    s.update("task", row.id, row.revision, { ...row.data, draft: c, ...(row.data.visibility === "draft" ? { title: c.title, description: c.description, nextAction: c.nextAction, deadline: c.deadline.value } : {}) });
                    this.audit(s, p, row.contextId!, "task.draft", row.id, { revision: row.revision }, { revision: row.revision + 1 });
                } else if (cmd === "publish") this.publish(s, p, row, row.data.draft!);
                else if (cmd === "assign") {
                    const t = this.target(s, p, { ...object(input.assignment, ["ownerId", "assigneeId", "coAssigneeIds"]), contextId: row.contextId, productIds: row.data.productIds });
                    s.update("task", row.id, row.revision, { ...row.data, ownerId: t.ownerId, assigneeId: t.assigneeId, coAssigneeIds: t.coAssigneeIds, assignmentNeedsAttention: false });
                    this.audit(s, p, row.contextId!, "task.reassigned", row.id, { assigneeId: row.data.assigneeId, ownerId: row.data.ownerId, coAssigneeIds: row.data.coAssigneeIds ?? [], authorId: row.data.authorId }, { assigneeId: t.assigneeId, ownerId: t.ownerId, coAssigneeIds: t.coAssigneeIds, authorId: row.data.authorId });
                    this.event(s, p, row.contextId!, "TASK_ASSIGNMENT_CHANGED", row.id, row.data.currentRequestId ?? null);
                } else if (["hold", "cancel", "resume"].includes(cmd)) {
                    const reason = str(input.reason, 2000, true);
                    if (row.data.status === "completed" || row.data.status === "draft") fail("CONFLICT", 409, "현재 상태에서는 변경할 수 없습니다.");
                    const paused = row.data.status === "on_hold" || row.data.status === "cancelled";
                    if (cmd === "resume" && !paused) fail("CONFLICT", 409, "보류 또는 취소한 업무만 재개할 수 있습니다.");
                    const status = cmd === "hold" ? "on_hold" : cmd === "cancel" ? "cancelled" : this.resumeStatus(s, row);
                    if (status === row.data.status) return { ids: [row.id] };
                    const resumeStatus = cmd === "resume" ? null : paused ? this.resumeStatus(s, row) : row.data.status as "requested" | "in_progress" | "partial" | "submitted";
                    s.update("task", row.id, row.revision, { ...row.data, status, resumeStatus });
                    this.audit(s, p, row.contextId!, "task.state", row.id, { status: row.data.status, resumeStatus: row.data.resumeStatus ?? null }, { status, resumeStatus, reason });
                    this.event(s, p, row.contextId!, `TASK_${cmd.toUpperCase()}`, row.id, row.data.currentRequestId ?? null);
                } else if (cmd === "duplicate") {
                    const cycle = object(input.cycle, ["label", "start", "end"]), start = dateValue(cycle.start), end = dateValue(cycle.end);
                    if (end < start) fail("VALIDATION", 422, "대상 기간 순서를 확인해 주세요.");
                    const target = this.target(s, p, { contextId: row.contextId, ownerId: row.data.ownerId, assigneeId: row.data.assigneeId, coAssigneeIds: row.data.coAssigneeIds ?? [], productIds: input.productIds ?? row.data.productIds });
                    const c = { ...row.data.draft!, title: `${row.data.draft!.title} · ${str(cycle.label, 100, true)}`, requirements: row.data.draft!.requirements.map(q => ({ ...q, productIds: input.productIds !== undefined && q.productIds.length ? target.productIds : q.productIds })) };
                    if (input.productIds !== undefined && row.data.draft!.requirements.some(q=>q.productIds.length) && !target.productIds.length) fail("VALIDATION",422,"제품별 요청을 복제할 제품을 선택해 주세요.");
                    const tid = this.createOne(s, p, target, c, "spot", null, row.data.templateVersionId ?? null, row.data.subtype ?? "정기 업데이트");
                    const fresh = s.get("task", tid)!; s.update("task", tid, fresh.revision, { ...fresh.data, cycle: { sourceTaskId: row.id, label: str(cycle.label, 100, true), start, end } }); return { ids: [tid] };
                } else {
                    if (!row.data.currentRequestId || ["cancelled", "completed", "on_hold"].includes(row.data.status)) fail("CONFLICT", 409, "공개된 진행 업무에서 사용해 주세요.");
                    if (["read","accept"].includes(cmd) && s.list("taskActivity",row.contextId!).some(a=>a.data.taskId===row.id && a.data.requestId===row.data.currentRequestId && a.data.userId===p.user.id && a.data.kind===cmd)) {
                        // Repair rows left inconsistent by the former resume=requested behavior,
                        // without fabricating a second acceptance activity or notification event.
                        if (cmd === "accept" && row.data.status === "requested") {
                            s.update("task", row.id, row.revision, { ...row.data, status: "in_progress" });
                            this.audit(s, p, row.contextId!, "task.acceptance_restored", row.id, { status: "requested" }, { status: "in_progress", requestVersionId: row.data.currentRequestId });
                        }
                        return { ids: [row.id] };
                    }
                    let proposed = null, decision: "apply" | "keep" | null = null, resultingRequestId: string | null = null; const reason = str(input.reason ?? "", 2000, cmd === "schedule");
                    if (cmd === "schedule") { proposed = deadline(input.deadline); if (!activeMember(s, proposed.responsibleUserId, row.contextId!)) fail("VALIDATION", 422, "확인 담당자를 확인해 주세요."); }
                    if (cmd === "schedule_decide") {
                        const request = s.get("taskActivity", str(input.activityId, 160, true));
                        if (!request || request.data.taskId !== row.id || request.data.kind !== "schedule" || s.list("taskActivity", row.contextId!).some(a => a.data.respondsTo === request.id)) fail("CONFLICT", 409, "처리할 일정 조정 요청을 확인해 주세요.");
                        decision = enumValue(input.decision, ["apply", "keep"] as const);
                        const published = s.get("requestVersion", row.data.currentRequestId)!;
                        if (request.data.requestId !== published.id) fail("CONFLICT",409,"조정 요청 이후 공개 내용이 변경됐습니다. 최신 요청에서 일정을 다시 협의해 주세요.");
                        resultingRequestId = decision === "apply" ? this.publish(s, p, row, { ...published.data.content, deadline: request.data.proposedDeadline! }, row.data.templateVersionId, JSON.stringify(row.data.draft) === JSON.stringify(published.data.content) ? undefined : row.data.draft).id : published.id;
                    }
                    const sequence = 1 + Math.max(0, ...s.list("taskActivity",row.contextId!).filter(a=>a.data.taskId===row.id).map(a=>a.data.sequence ?? 0));
                    s.create("taskActivity", { id: id(), contextId: row.contextId, data: { taskId: row.id, requestId: row.data.currentRequestId, userId: p.user.id, kind: cmd === "schedule_decide" ? "schedule_resolved" : cmd as "read" | "accept" | "schedule", at: this.clock(), sequence, reason, proposedDeadline: proposed, respondsTo: cmd === "schedule_decide" ? str(input.activityId, 160, true) : null, decision, resultingRequestId } });
                    if (cmd === "accept" && row.data.status === "requested") s.update("task", row.id, row.revision, { ...row.data, status: "in_progress" });
                    this.audit(s, p, row.contextId!, `task.${cmd}`, row.id, {}, { requestVersionId: row.data.currentRequestId, decision, resultingRequestId });
                    if (cmd === "accept") this.event(s, p, row.contextId!, "TASK_ACCEPTED", row.id, row.data.currentRequestId);
                    if (cmd === "schedule") this.event(s, p, row.contextId!, "TASK_SCHEDULE_CHANGE_REQUESTED", row.id, row.data.currentRequestId);
                }
                return { ids: [row.id] };
            });
        });
    }
    async saveTemplate(token: string | undefined, input: Record<string, unknown>) {
        return this.identity.repo.transaction(s => { const p = this.identity.principal(s, token), contextId = str(input.contextId, 160, true); this.manage(s, p, contextId);
            return this.receipt(s, p, contextId, "template.save", input, () => {
                const previous = this.template(s, p, contextId, input.previousId);
                const templateId = previous && !previous.data.builtin ? previous.data.templateId : id();
                if (previous && !previous.data.builtin && s.list("templateVersion", contextId).some(t => t.data.templateId === templateId && t.data.sequence > previous.data.sequence)) fail("CONFLICT", 409, "새 템플릿 버전이 있습니다. 최신본을 선택해 주세요.");
                const c = content(input.content); if (c.referenceFileIds.length || c.requirements.some(q => q.productIds.length)) fail("VALIDATION", 422, "공용 템플릿에서는 파일과 특정 제품 선택을 비워 주세요.");
                const row = s.create("templateVersion", { id: id(), contextId, data: { templateId, previousId: previous?.id ?? null, sequence: previous && !previous.data.builtin ? previous.data.sequence + 1 : 1, name: str(input.name, 200, true), content: c, createdBy: p.user.id, builtin: false } });
                this.audit(s, p, contextId, "template.saved", row.id, { previousId: previous?.id ?? null }, { templateVersionId: row.id }); return { ids: [row.id] };
            });
        });
    }
    async applyTemplate(token: string | undefined, input: Record<string, unknown>) {
        return this.identity.repo.transaction(s => { const p = this.identity.principal(s, token), contextId = str(input.contextId, 160, true); this.manage(s, p, contextId); const template = this.template(s, p, contextId, input.versionId); if (!template) unavailable();
            const selected = list(input.targets, 50).map(v => object(v, ["id", "expectedRevision"]));
            if (!selected.length || new Set(selected.map(t => t.id)).size !== selected.length) fail("VALIDATION", 422, "적용할 업무를 선택해 주세요.");
            return this.receipt(s, p, contextId, "template.apply", input, () => {
                const result = selected.map(t => { const row = this.task(s, p, str(t.id, 160, true), true); if (row.contextId !== contextId) unavailable(); this.fresh(row, t.expectedRevision); if (!row.data.currentRequestId || ["cancelled", "completed"].includes(row.data.status)) fail("CONFLICT", 409, "공개된 현재 업무를 선택해 주세요."); this.publish(s, p, row, { ...template.data.content, deadline: { ...template.data.content.deadline, responsibleUserId: template.data.content.deadline.responsibleUserId || row.data.ownerId } }, template.id); return row.id; }); return { ids: result };
            });
        });
    }
    async previewTemplate(token: string | undefined, input: Record<string,unknown>) {
        return this.identity.repo.transaction(s=>{const p=this.identity.principal(s,token),contextId=str(input.contextId,160,true);this.manage(s,p,contextId);const template=this.template(s,p,contextId,input.versionId);if(!template)unavailable();
            return {targets:list(input.targets,50).map(v=>{const t=object(v,["id","expectedRevision"]),row=this.task(s,p,str(t.id,160,true),true);if(row.contextId!==contextId)unavailable();this.fresh(row,t.expectedRevision);const previous=row.data.currentRequestId?s.get("requestVersion",row.data.currentRequestId):null;
                return {id:row.id,title:row.data.title,currentVersionId:previous?.id??null,addedKeys:stringList(template.data.content.requirements.filter(q=>!previous?.data.content.requirements.some(o=>o.key===q.key)).map(q=>q.key)),changedKeys:stringList(template.data.content.requirements.filter(q=>previous?.data.content.requirements.some(o=>o.key===q.key&&JSON.stringify(o)!==JSON.stringify(q))).map(q=>q.key))};
            })};
        });
    }
    async preview(token:string|undefined,taskId:string) {
        return this.identity.repo.transaction(s=>{const p=this.identity.principal(s,token),row=this.task(s,p,taskId,true);if(!row.data.draft)fail("VALIDATION",422,"새 요청 업무에서 미리보기를 사용해 주세요.");return {content:this.projectedContent(s,p,row.data.draft,false,row.id)};});
    }
    private projectedContent(s: UnitOfWork, p: Principal, c: RequestContent, internal: boolean, prospectiveTaskId?:string) {
        const referenceFileIds = stringList(c.referenceFileIds).filter(fid => {
            const file=s.get("fileVersion",fid); if(!file)return false;
            try { const origin=canReferenceFile(s,p,file,{id:prospectiveTaskId??"request-projection",contextId:file.contextId,kind:"task",visibility:internal?"draft":"public"},this.clock); return internal || file.data.visibility === "public" && (origin.visibility === "public" || origin.id===prospectiveTaskId); } catch { return false; }
        });
        return projectedRequest(c, internal, referenceFileIds);
    }
    async detail(token: string | undefined, taskId: string, contextId?: string) {
        return this.identity.repo.transaction(s => { const p = this.identity.principal(s, token), row = this.task(s, p, taskId); if (contextId && contextId !== row.contextId) unavailable(); const internal = p.user.data.role === "gsg";
            const versions = s.list("requestVersion", row.contextId!).filter(v => v.data.taskId === taskId).sort((a,b) => b.data.sequence - a.data.sequence);
            const current = versions.find(v => v.id === row.data.currentRequestId);
            const prior = s.list("priorSubmission", row.contextId!).filter(v => v.data.taskId === taskId).sort((a,b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
            const live = latestSubmission(s,row);
            const liveRequest = live ? s.get("requestVersion",live.data.requestId) : null;
            const previous = prior ? s.get("requestVersion", prior.data.requestId) : null;
            const request = current ? this.projectedContent(s, p, current.data.content, internal) : null;
            const projectedVersions = versions.map(v => projectedVersion(v, this.projectedContent(s,p,v.data.content,internal)));
            const fileIds = new Set([...projectedVersions.flatMap(v=>v.content.referenceFileIds), ...(internal ? row.data.draft?.referenceFileIds ?? [] : [])]);
            const files = s.list("fileVersion", row.contextId!).filter(f => fileIds.has(f.id) || internal && f.data.taskId === taskId).filter(f => internal || f.data.visibility === "public").filter(f => visibleFile(s,p,f,taskScope(row),this.clock)).map(f => ({ id: f.id, name: f.data.originalName, bytes: f.data.bytes, mime: f.data.mime, sha256: f.data.sha256, preview: f.data.preview, visibility: f.data.visibility }));
            return { task: projectTask(s, p, row, this.clock), canManage: internal, canRespond: decide(s,p,"submission.write",taskScope(row),this.clock).allowed, draft: internal && row.data.draft ? projectedRequest(row.data.draft, true, this.projectedContent(s,p,row.data.draft,true,row.id).referenceFileIds) : null, request,
                versions: projectedVersions,
                activities: s.list("taskActivity", row.contextId!).filter(a => a.data.taskId === taskId).sort((a,b)=>(a.data.sequence??0)-(b.data.sequence??0)).map(projectedActivity),
                history: s.list("audit", row.contextId!).filter(a => a.data.targetId === taskId).map(projectAudit), files,
                requirementStatus: current && live ? safeEvaluation(current.data.content,live.data.answers,liveRequest?.data.content??null,true).items.map(projectedRequirementStatus) : current ? evaluateRequirements(projectedRequest(current.data.content,true,stringList(current.data.content.referenceFileIds)), prior?.data as PriorSubmissionData ?? null, previous ? projectedRequest(previous.data.content,true,stringList(previous.data.content.referenceFileIds)) : null).map(projectedRequirementStatus) : [],
                submissionConnection: current ? "공개 요청에 답변을 저장하고 제출할 수 있습니다" : "요청 공개 후 답변할 수 있습니다", submissionSummary: live ? { id:live.id,sequence:live.data.sequence,requestId:live.data.requestId,mode:live.data.mode,submittedAt:live.data.submittedAt,isCurrentRequest:live.data.requestId===current?.id } : null, completionConnection: "GSG가 잔여 상태를 확인하고 수동 완료할 수 있습니다", notificationConnection: "앱 알림은 준비 중입니다" };
        });
    }
    async catalog(token: string | undefined, contextId: string) {
        return this.identity.repo.transaction(s => { const p = this.identity.principal(s, token); authorize(s,p,"task.read",{id:contextId,contextId,kind:"task",visibility:"public"},this.clock);
            const internal = p.user.data.role === "gsg";
            const tasks = s.list("task",contextId).filter(t=>decide(s,p,"task.read",taskScope(t),this.clock).allowed).map(t=>projectTask(s,p,t,this.clock));
            const members = s.list("membership",contextId).filter(m=>m.data.status==="active").flatMap(m=> { const u=s.get("user",m.data.userId); return u?.data.status==="active" ? [{id:u.id,name:u.data.name,role:u.data.role}] : []; });
            const visible = new Set(tasks.map(t=>t.id));
            return { userId:p.user.id, canManage:internal, mode:this.identity.repo.mode, contexts:s.list("context").filter(c=>hasScope(s,p,c.id,this.clock)).map(projectContext), members, tasks,
                products:visibleProductRelations(s,p,this.clock,contextId).map(cp=>resolveProduct(s,p,contextId,cp.data.productId,this.clock)).filter(r=>!r.common.data.archived).map(r=>({id:r.product.id,name:r.common.data.common.name})),
                projects:s.list("project",contextId).filter(v=>internal || v.data.taskIds.some(t=>visible.has(t))).map(v=>({id:v.id,revision:v.revision,title:v.data.title,status:v.data.status})),
                templates:internal?s.list("templateVersion").filter(v=>v.contextId===contextId || v.contextId===null && v.data.builtin && v.id.startsWith("builtin-")).map(v=>projectedTemplate(v,projectedRequest(v.data.content,true,this.projectedContent(s,p,v.data.content,true).referenceFileIds))):[] };
        });
    }
}
export type TaskDetail = Awaited<ReturnType<TaskService["detail"]>>;
export type TaskCatalog = Awaited<ReturnType<TaskService["catalog"]>>;
