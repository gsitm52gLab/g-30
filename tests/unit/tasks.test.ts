import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createMockRepository } from "@/server/repositories/mock";
import { createSqliteRepository } from "@/server/repositories/sqlite";
import { migrate, openDatabase } from "@/server/db/database";
import { seed } from "@/server/db/seed";
import { IdentityService } from "@/server/auth/service";
import { TaskService } from "@/server/tasks/service";
import { FileService } from "@/server/files/service";
import { DEMO_PASSWORD } from "@/domain/catalog";
import type { RecordRepository } from "@/domain/records";
import { blankContent, blankRequirement, requirementTypes } from "@/domain/tasks/types";
import { content, deadline } from "@/domain/tasks/validate";
import { evaluateRequirements } from "@/domain/tasks/evaluate";
import { MAX_FILE_BYTES, validateFile } from "@/domain/files/validate";
const ctx = "ctx-jp-a-luna", ctx2 = "ctx-jp-b-luna";
const target = { contextId: ctx, ownerId: "user-gsg", assigneeId: "user-luna", coAssigneeIds: ["user-co"], productIds: ["product-serum"] };
const payload = () => ({ ...blankContent(), title: "G04 요청", description: "공개 설명 v1", internalOriginal: "내부 원문 보존", internalMemo: "내부 메모", deadline: { ...blankContent().deadline, value: "2026-10-10", responsibleUserId: "user-gsg" }, requirements: [{ ...blankRequirement("description"), label: "설명" }] });
for (const mode of ["mock", "sqlite"] as const) describe(`${mode} G04 actual task/file contract`, () => {
    let repo: RecordRepository, identity: IdentityService, tasks: TaskService, admin: string, brand: string, co: string, team: string;
    const directories: string[] = [];
    async function setup() {
        const clock = () => "2026-09-21T00:00:00.000Z";
        if (mode === "mock") repo = createMockRepository(clock);
        else { const db = openDatabase(":memory:", true); migrate(db); repo = createSqliteRepository(db, clock); }
        await seed(repo); identity = new IdentityService(repo, clock); tasks = new TaskService(identity);
        [admin, brand, co, team] = await Promise.all(["admin", "luna", "co", "team"].map(async u => (await identity.login(undefined, { email: `${u}@example.test`, password: DEMO_PASSWORD })).token));
    }
    async function create(p = payload()) { return (await tasks.create(admin, { targets: [target], content: p, category: "spot", idempotencyKey: randomUUID() })).ids[0]; }
    async function command(taskId: string, command: string, extra: Record<string, unknown> = {}, token = admin) { return tasks.command(token, taskId, { command, expectedRevision: (await repo.get("task", taskId))!.revision, idempotencyKey: randomUUID(), ...extra }); }
    async function publish(p = payload()) { const id = await create(p); await command(id, "publish"); return id; }
    afterEach(async () => { repo?.close(); await Promise.all(directories.splice(0).map(d => rm(d, { recursive: true, force: true }))); });
    it("AC-04-01/02 SA-12 drafts stay private; preview equals brand publication and filters original/milestone", async () => {
        await setup(); const c = payload(); c.milestones = [{ id: "external-print", kind: "printing_delivery", counterpart: "합성 외부 인쇄소", visibility: "internal", deadline: { ...c.deadline, certainty: "needs_confirmation", raw: "10/10 금요일 원문 충돌 보존" } }];
        const id = await create(c); await expect(tasks.detail(brand, id)).rejects.toMatchObject({ status: 404 });
        expect((await tasks.catalog(brand, ctx)).tasks.some(t => t.id === id)).toBe(false);
        const preview = await tasks.preview(admin, id); expect(preview.content).not.toHaveProperty("internalOriginal"); expect(preview.content.milestones).toEqual([]);
        await command(id, "publish"); const b = await tasks.detail(brand, id); expect(b.request).toEqual(preview.content); expect(b.draft).toBeNull(); expect((await tasks.detail(admin, id)).request!.milestones[0].deadline.raw).toContain("원문 충돌");
        const saved = { ...c, description: "미공개 초안" }; await command(id, "save", { content: saved }); expect((await tasks.detail(brand, id)).request!.description).toBe(c.description);
        expect((await tasks.detail(team, id)).canRespond).toBe(false); expect((await tasks.detail(co, id)).canRespond).toBe(true);
        await expect(command(id, "accept", {}, team)).rejects.toMatchObject({ status: 403 });
        const foreign = (await identity.login(undefined, { email: "wave@example.test", password: DEMO_PASSWORD })).token;
        await expect(tasks.detail(foreign, id)).rejects.toMatchObject({ status: 404 }); await expect(tasks.detail(admin, id, ctx2)).rejects.toMatchObject({ status: 404 });
    });
    it("AC-04-01/06 SA-07 project selection creates parallel independent work; dependency cycle and cross-project edge reject", async () => {
        await setup(); const p = await tasks.createProject(admin, { title: "합성 신규 입점", target, templateVersionIds: ["builtin-documents-v1", "builtin-pop-v1", "builtin-video-v1"], idempotencyKey: randomUUID() });
        const project = await tasks.project(admin, p.ids[0]); expect(project.tasks).toHaveLength(3); expect(project.data.dependencies).toEqual([]);
        await expect(tasks.project(brand, project.id)).rejects.toMatchObject({ status: 404 });
        await tasks.dependencies(admin, project.id, { expectedRevision: project.revision, dependencies: [{ before: p.ids[1], after: p.ids[2] }], idempotencyKey: randomUUID() });
        const revision = (await repo.get("project", project.id))!.revision;
        await expect(tasks.dependencies(admin, project.id, { expectedRevision: revision, dependencies: [{ before: p.ids[1], after: p.ids[2] }, { before: p.ids[2], after: p.ids[1] }], idempotencyKey: randomUUID() })).rejects.toMatchObject({ status: 422 });
        await expect(tasks.dependencies(admin, project.id, { expectedRevision: revision, dependencies: [{ before: p.ids[1], after: "task-pop" }], idempotencyKey: randomUUID() })).rejects.toMatchObject({ status: 422 });
        await command(p.ids[1], "publish"); expect((await tasks.project(brand, project.id)).tasks).toHaveLength(1);
        // G11 completion producer is not implemented: fixture proves project completion is independent.
        await repo.transaction(s => { const t = s.get("task", p.ids[1])!; s.update("task", t.id, t.revision, { ...t.data, status: "completed" }); });
        expect((await repo.get("project", project.id))!.data.status).toBe("active");
    });
    it("AC-04-04 SA-14 template revisions apply only selected tasks and retain immutable history", async () => {
        await setup(); const first = await publish(), second = await publish(); const original = (await tasks.detail(admin, first)).versions[0];
        const next = payload(); next.requirements.push({ ...blankRequirement("new-required", "file"), label: "새 필수 파일" });
        const template = (await tasks.saveTemplate(admin, { contextId: ctx, name: "개정 서류", previousId: "builtin-documents-v1", content: next, idempotencyKey: randomUUID() })).ids[0];
        const input = { contextId: ctx, versionId: template, targets: [{ id: first, expectedRevision: (await repo.get("task", first))!.revision }], idempotencyKey: randomUUID() };
        expect((await tasks.previewTemplate(admin, input)).targets[0].addedKeys).toEqual(["new-required"]);
        const before = (await repo.list("requestVersion")).length; await tasks.applyTemplate(admin, input); await tasks.applyTemplate(admin, input);
        expect(await repo.list("requestVersion")).toHaveLength(before + 1); expect((await tasks.detail(brand, first)).versions).toHaveLength(2); expect((await tasks.detail(brand, second)).versions).toHaveLength(1);
        expect((await tasks.detail(admin, first)).versions[1]).toEqual(original);
        await expect(repo.transaction(s => { const r = s.get("requestVersion", original.id)!; s.update("requestVersion", r.id, r.revision, r.data); })).rejects.toMatchObject({ code: "INVALID_RECORD" });
    });
    it("AC-04-04 prior-submission fixture preserves compatible values and identifies new/changed/conditional/product work", async () => {
        await setup(); const c = payload(); c.requirements = [{ ...blankRequirement("pick", "choice"), label: "참여", options: ["yes", "no"] }, { ...blankRequirement("per-product", "number"), label: "제품 수량", productIds: target.productIds, unit: "개" }, { ...blankRequirement("optional"), label: "선택 메모", required: false }];
        const id = await publish(c), old = (await tasks.detail(admin, id)).versions[0];
        await repo.transaction(s => s.create("priorSubmission", { id: "prior", contextId: ctx, data: { taskId: id, requestId: old.id, authorId: "user-luna", answers: [{ requirementKey: "pick", productId: null, value: "no", fileVersionIds: [] }, { requirementKey: "per-product", productId: "product-serum", value: 0, fileVersionIds: [] }] } }));
        c.requirements.push({ ...blankRequirement("conditional"), label: "참여 자료", condition: { key: "pick", equals: "yes" } }, { ...blankRequirement("added", "file"), label: "추가 파일" });
        c.requirements[1].specifications.push({ text: "수량 사람 확인", source: "합성 규격", version: "v2", severity: "required", check: "human" });
        await command(id, "save", { content: c }); await command(id, "publish");
        const states = (await tasks.detail(brand, id)).requirementStatus;
        expect(states.find(s => s.requirementKey === "pick")?.status).toBe("prior_received"); expect(states.find(s => s.requirementKey === "per-product")).toMatchObject({ status: "needs_reconfirmation", humanReviewPending: true, sourceRequestId: old.id }); expect(states.find(s => s.requirementKey === "conditional")?.status).toBe("not_applicable"); expect(states.find(s => s.requirementKey === "added")?.status).toBe("missing"); expect(states.find(s => s.requirementKey === "optional")?.status).toBe("optional");
        expect((await repo.get("priorSubmission", "prior"))!.data.answers[1].value).toBe(0);
    });
    it("AC-04-05 CR01/02 schedule applies only published content, persists decision/new version and preserves private draft", async () => {
        await setup(); const id = await publish(); const v1 = (await tasks.detail(brand, id)).versions[0];
        const draft = { ...payload(), description: "아직 공개하지 않을 설명", requirements: [{ ...blankRequirement("private-new"), label: "미공개 요건" }] };
        await command(id, "save", { content: draft }); await command(id, "schedule", { deadline: { ...payload().deadline, value: "2026-11-20" }, reason: "일정 협의" }, brand);
        const activity = (await tasks.detail(admin, id)).activities.find(a => a.data.kind === "schedule")!;
        await command(id, "schedule_decide", { activityId: activity.id, decision: "apply", reason: "GSG 일정 반영" });
        const b = await tasks.detail(brand, id), a = await tasks.detail(admin, id);
        expect(b.request!.description).toBe(v1.content.description); expect(b.request!.requirements).toEqual(v1.content.requirements); expect(b.request!.deadline.value).toBe("2026-11-20"); expect(JSON.stringify(b)).not.toContain("미공개 요건"); expect(a.draft).toEqual(draft);
        expect(a.activities.find(x => x.data.kind === "schedule_resolved")!.data).toMatchObject({ decision: "apply", requestId: v1.id, resultingRequestId: b.versions[0].id, respondsTo: activity.id });
        await expect(command(id, "schedule_decide", { activityId: activity.id, decision: "keep" })).rejects.toMatchObject({ status: 409 });
        await command(id, "schedule", { deadline: { ...payload().deadline, value: "2026-12-01" }, reason: "다음 협의" }, brand); const second = (await tasks.detail(admin, id)).activities.filter(a => a.data.kind === "schedule").at(-1)!;
        await command(id, "schedule_decide", { activityId: second.id, decision: "keep" }); expect((await tasks.detail(brand, id)).request!.deadline.value).toBe("2026-11-20"); expect((await tasks.detail(brand, id)).activities.at(-1)!.data.decision).toBe("keep");
    });
    it("AC-04-05 CR03 receipt retry creates acceptance/event once; CAS and injected failure roll back all writes", async () => {
        await setup(); const id = await publish(), revision = (await repo.get("task", id))!.revision; const input = { command: "accept", expectedRevision: revision, idempotencyKey: randomUUID() };
        await tasks.command(brand, id, input); await tasks.command(brand, id, input);
        await command(id, "accept", {}, brand);
        expect((await repo.list("taskActivity")).filter(a => a.data.kind === "accept")).toHaveLength(1); expect((await repo.list("domainEvent")).filter(e => e.data.eventType === "TASK_ACCEPTED")).toHaveLength(1);
        await expect(tasks.command(brand, id, { ...input, reason: "changed" })).rejects.toMatchObject({ status: 409 });
        await expect(tasks.command(admin, id, { command: "save", expectedRevision: revision, content: payload(), idempotencyKey: randomUUID() })).rejects.toMatchObject({ status: 409 });
        const before = await Promise.all([repo.list("task"), repo.list("requestVersion"), repo.list("audit"), repo.list("domainEvent"), repo.list("commandReceipt")]);
        const failing = new TaskService(identity, () => { throw new Error("injected G04 rollback"); });
        await expect(failing.command(admin, id, { command: "publish", expectedRevision: (await repo.get("task", id))!.revision, idempotencyKey: randomUUID() })).rejects.toThrow("injected G04 rollback");
        expect(await Promise.all([repo.list("task"), repo.list("requestVersion"), repo.list("audit"), repo.list("domainEvent"), repo.list("commandReceipt")])).toEqual(before);
    });
    it("SA-09 invalid/foreign/inactive assignees reject; stopped co-assignee marks work and history preserves both arrays", async () => {
        await setup(); for (const bad of ["user-wave", "user-suspended", "user-admin"]) await expect(tasks.create(admin, { targets: [{ ...target, assigneeId: bad }], content: payload(), category: "spot", idempotencyKey: randomUUID() })).rejects.toMatchObject({ status: 422 });
        const id = await publish(); await command(id, "assign", { assignment: { ownerId: "user-price", assigneeId: "user-luna", coAssigneeIds: ["user-team"] } });
        const history = (await tasks.detail(admin, id)).history.find(h => h.data.action === "task.reassigned")!;
        expect(history.data.before.coAssigneeIds).toEqual(["user-co"]); expect(history.data.after.coAssigneeIds).toEqual(["user-team"]);
        const u = (await repo.get("user", "user-team"))!; await identity.setUserStatus(admin, u.id, { status: "suspended", expectedRevision: u.revision });
        expect((await repo.get("task", id))!.data.assignmentNeedsAttention).toBe(true); await expect(command(id, "accept", {}, team)).rejects.toMatchObject({ status: 401 });
        await command(id, "assign", { assignment: { ownerId: "user-gsg", assigneeId: "user-luna", coAssigneeIds: [] } });
        expect((await repo.get("task", id))!.data).toMatchObject({ authorId: "user-admin", assignmentNeedsAttention: false });
    });
    it("AC-04-03 SA-08/13 multi-context clones and manual cycles/additional product tasks keep old state independent", async () => {
        await setup(); await repo.transaction(s => { s.create("membership", { id: "gsg-in-b", contextId: ctx2, data: { userId: "user-price", role: "operator", status: "active", scope: "B", internalPriceAccess: false, activatedAt: identity.clock(), suspendedAt: null } });
            for (const [userId, role] of [["user-gsg","operator"],["user-luna","brand"]] as const) s.create("membership",{id:`third-${userId}`,contextId:"ctx-sg-a-luna",data:{userId,role,status:"active",scope:"third synthetic fixture",internalPriceAccess:false,activatedAt:identity.clock(),suspendedAt:null}});
            s.create("product",{id:"product-third",contextId:"ctx-sg-a-luna",data:s.get("product","product-serum")!.data});
        });
        const c = payload(); c.requirements[0].productIds = ["product-serum"];
        const result = await tasks.create(admin, { targets: [target, { ...target, contextId: ctx2, ownerId: "user-price", coAssigneeIds: [], productIds: ["product-cream"] }, { ...target, contextId:"ctx-sg-a-luna", coAssigneeIds:[], productIds:["product-third"] }], content: c, category: "spot", idempotencyKey: randomUUID() });
        expect(new Set(result.ids).size).toBe(3); const independentBefore = await Promise.all(result.ids.slice(1).map(id=>repo.get("task",id)));
        const other = (await tasks.detail(admin, result.ids[1])).draft!; expect(other.deadline.responsibleUserId).toBe("user-price"); expect(other.requirements[0].productIds).toEqual(["product-cream"]);
        await command(result.ids[0], "publish"); await command(result.ids[0], "accept", {}, brand); const old = await repo.get("task", result.ids[0]);
        const copy = await command(result.ids[0], "duplicate", { cycle: { label: "10월 회차", start: "2026-10-01", end: "2026-10-31" } });
        expect(await repo.get("task", result.ids[0])).toEqual(old); expect((await repo.get("task", copy.ids[0]))!.data).toMatchObject({ status: "draft", currentRequestId: null, cycle: { sourceTaskId: result.ids[0] } });
        expect((await repo.get("task", result.ids[1]))!.data.status).toBe("draft");
        expect(await Promise.all(result.ids.slice(1).map(id=>repo.get("task",id)))).toEqual(independentBefore);
        await command(result.ids[0], "hold", { reason: "잠시 보류" }); await expect(command(result.ids[0], "accept", {}, brand)).rejects.toMatchObject({ status: 409 }); await command(result.ids[0], "cancel", { reason: "합의 취소" }); await command(result.ids[0], "resume", { reason: "명시 재개" });
        // SA-15: hold/cancel must preserve already accepted progress, not reset it to requested.
        expect((await repo.get("task", result.ids[0]))!.data.status).toBe("in_progress");
    });
    it("G04-V03 AC-04-02 A19 stored nested extensions never enter current/history/preview/draft/template/activity/project output", async () => {
        await setup(); const marker="V03_PRIVATE_STORED_EXTENSION";
        function poison<T>(value:T):T { if(Array.isArray(value))return value.map(poison) as T; if(value && typeof value==="object")return Object.assign(Object.fromEntries(Object.entries(value).map(([k,v])=>[k,poison(v)])),{privateExtension:{deep:marker}}) as T; return value; }
        const clean=payload(); clean.links=[{url:"https://example.test/guide",description:"공개 링크",contentFixed:false}];
        clean.requirements[0].specifications=[{text:"공개 규격",source:"공개 출처",version:"v1",severity:"recommended",check:"human"}];
        clean.milestones=[{id:"print",kind:"printing_delivery",counterpart:"공개 확인 상대",visibility:"public",deadline:{...clean.deadline,sourceVersion:"m1"}}];
        const c=Object.assign(poison(clean),{internalSupplyPrice:marker,unknownObject:{deep:marker}}); const id=await create(clean);
        await repo.transaction(s=>{s.create("requestVersion",{id:"v03-old",contextId:ctx,data:{taskId:id,sequence:1,previousId:null,templateVersionId:null,content:c,publishedBy:"user-admin",publishedAt:identity.clock(),changedKeys:["description",{private:marker}] as unknown as string[]}});const t=s.get("task",id)!;s.update("task",id,t.revision,{...t.data,draft:c,currentRequestId:"v03-old",visibility:"public",status:"requested"});
            s.create("templateVersion",{id:"v03-template",contextId:ctx,data:Object.assign({templateId:"v03-template",name:"공개 템플릿",sequence:1,previousId:null,content:c,createdBy:"user-admin",builtin:false},{privateExtension:marker})});
            s.create("taskActivity",{id:"v03-activity",contextId:ctx,data:Object.assign({taskId:id,requestId:"v03-old",userId:"user-luna",kind:"schedule" as const,at:identity.clock(),sequence:1,reason:"공개 조정 사유",proposedDeadline:poison(clean.deadline),respondsTo:null,decision:null,resultingRequestId:null},{privateExtension:marker})});
            s.create("project",{id:"v03-project",contextId:ctx,data:Object.assign({title:"공개 프로젝트",taskIds:[id,"task-onboarding"],dependencies:[Object.assign({before:id,after:"task-onboarding"},{privateExtension:marker})],status:"active" as const,createdBy:"user-admin"},{privateExtension:marker})});});
        await command(id,"publish");
        const before=await Promise.all([repo.get("task",id),repo.list("requestVersion"),repo.list("taskActivity"),repo.list("templateVersion"),repo.list("project")]);
        const b=await tasks.detail(brand,id), g=await tasks.detail(admin,id), preview=await tasks.preview(admin,id), catalog=await tasks.catalog(admin,ctx), project=await tasks.project(brand,"v03-project");
        const nonpriceToken=(await identity.login(undefined,{email:"operator@example.test",password:DEMO_PASSWORD})).token;
        const nonprice=await tasks.detail(nonpriceToken,id),nonpriceCatalog=await tasks.catalog(nonpriceToken,ctx);
        expect(JSON.stringify({b,g,preview,catalog,project,nonprice,nonpriceCatalog})).not.toContain(marker);
        expect(nonprice.draft!.internalOriginal).toBe(clean.internalOriginal);
        const {internalOriginal,internalMemo,...publicContent}=clean;
        expect(b.request).toEqual(publicContent);expect(b.versions[1].content).toEqual(publicContent);expect(b.versions[1].changedKeys).toEqual(["description"]);expect(preview.content).toEqual(publicContent);
        expect(g.draft).toEqual(clean);expect(g.request).toEqual(clean);expect(catalog.templates.find(t=>t.id==="v03-template")!.content).toEqual(clean);
        expect(b.activities[0].data.proposedDeadline).toEqual(clean.deadline);expect(b.activities[0].data.reason).toBe("공개 조정 사유");expect(project.data.dependencies).toEqual([{before:id,after:"task-onboarding"}]);
        expect(internalOriginal).toBe("내부 원문 보존");expect(internalMemo).toBe("내부 메모");
        expect(await Promise.all([repo.get("task",id),repo.list("requestVersion"),repo.list("taskActivity"),repo.list("templateVersion"),repo.list("project")])).toEqual(before);
        await expect(command(id,"save",{content:c})).rejects.toMatchObject({status:422});
    });
    it("G04-V02 AC-04-05 SA-15 requested/accepted nested pause restores progress without duplicate acceptance or state events", async () => {
        await setup(); const id = await publish();
        await expect(command(id, "resume", { reason: "not paused" })).rejects.toMatchObject({ status: 409 });
        await command(id, "hold", { reason: "requested hold" }); await command(id, "resume", { reason: "requested resume" });
        expect((await repo.get("task", id))!.data.status).toBe("requested");
        await command(id, "accept", {}, brand); const history = await repo.list("taskActivity"); const versions = await repo.list("requestVersion");
        const hold = { command: "hold", expectedRevision: (await repo.get("task", id))!.revision, reason: "accepted hold", idempotencyKey: randomUUID() };
        await tasks.command(admin, id, hold); const paused = await repo.get("task", id); const stateEvents = await repo.list("domainEvent");
        await tasks.command(admin, id, hold); await command(id, "hold", { reason: "same hold" });
        expect(await repo.get("task", id)).toEqual(paused); expect(await repo.list("domainEvent")).toEqual(stateEvents);
        await command(id, "cancel", { reason: "nested cancellation" }); await command(id, "hold", { reason: "nested hold" });
        expect((await repo.get("task", id))!.data.resumeStatus).toBe("in_progress");
        const before = await Promise.all([repo.list("task"), repo.list("audit"), repo.list("domainEvent"), repo.list("commandReceipt")]);
        const failing = new TaskService(identity, () => { throw new Error("state rollback"); });
        await expect(failing.command(admin, id, { command: "resume", reason: "failure", expectedRevision: (await repo.get("task", id))!.revision, idempotencyKey: randomUUID() })).rejects.toThrow("state rollback");
        expect(await Promise.all([repo.list("task"), repo.list("audit"), repo.list("domainEvent"), repo.list("commandReceipt")])).toEqual(before);
        await expect(tasks.command(admin, id, { ...hold, command: "resume", idempotencyKey: randomUUID() })).rejects.toMatchObject({ status: 409 });
        await expect(command(id, "resume", { reason: "brand forbidden" }, brand)).rejects.toMatchObject({ status: 403 });
        const resume = { command: "resume", reason: "restore", expectedRevision: (await repo.get("task", id))!.revision, idempotencyKey: randomUUID() };
        await tasks.command(admin, id, resume); const restored = await repo.get("task", id); await tasks.command(admin, id, resume);
        expect(await repo.get("task", id)).toEqual(restored); expect(restored!.data).toMatchObject({ status: "in_progress", resumeStatus: null });
        await command(id, "accept", {}, brand); expect((await repo.get("task", id))!.data.status).toBe("in_progress");
        expect(await repo.list("taskActivity")).toEqual(history); expect(await repo.list("requestVersion")).toEqual(versions);
        expect((await repo.list("domainEvent")).filter(e => e.data.eventType === "TASK_ACCEPTED")).toHaveLength(1);
    });
    it("G04-V02 SA-15 partial state and prior answers survive pause and new-public-version is not auto-accepted", async () => {
        await setup(); const id = await publish(); await command(id, "accept", {}, brand); const v1 = (await tasks.detail(admin,id)).versions[0];
        await repo.transaction(s => { const row=s.get("task",id)!; s.update("task",id,row.revision,{...row.data,status:"partial"}); s.create("priorSubmission",{id:"state-prior",contextId:ctx,data:{taskId:id,requestId:v1.id,authorId:"user-luna",answers:[{requirementKey:"description",productId:null,value:"previous partial answer",fileVersionIds:[]}]}}); });
        const prior=await repo.get("priorSubmission","state-prior"); await command(id,"hold",{reason:"partial hold"});
        await command(id,"save",{content:{...payload(),description:"new request version"}}); await command(id,"publish"); const v2=(await tasks.detail(admin,id)).versions[0];
        expect(v2.id).not.toBe(v1.id); await command(id,"cancel",{reason:"nested"}); await command(id,"resume",{reason:"restore partial"});
        expect((await repo.get("task",id))!.data.status).toBe("partial"); expect(await repo.get("priorSubmission","state-prior")).toEqual(prior);
        expect((await repo.list("taskActivity")).filter(a=>a.data.kind==="accept"&&a.data.requestId===v2.id)).toHaveLength(0);
        await command(id,"accept",{},brand); await command(id,"accept",{},brand); expect((await repo.get("task",id))!.data.status).toBe("partial");
        expect((await repo.list("taskActivity")).filter(a=>a.data.kind==="accept")).toHaveLength(2); expect((await repo.list("domainEvent")).filter(e=>e.data.eventType==="TASK_ACCEPTED")).toHaveLength(2);
    });
    it("G04-V02 legacy paused fallback uses current request acceptance only and repairs previously inconsistent requested state", async () => {
        await setup(); const id=await publish(); await command(id,"accept",{},brand);
        async function legacy(status: "on_hold" | "cancelled" | "requested") { await repo.transaction(s=>{const row=s.get("task",id)!; const data={...row.data,status}; delete data.resumeStatus; s.update("task",id,row.revision,data);}); }
        await legacy("on_hold"); await command(id,"resume",{reason:"legacy accepted"}); expect((await repo.get("task",id))!.data.status).toBe("in_progress");
        await legacy("requested"); const accepted=await repo.list("taskActivity"), events=await repo.list("domainEvent");
        await command(id,"accept",{},brand); expect((await repo.get("task",id))!.data.status).toBe("in_progress"); expect(await repo.list("taskActivity")).toEqual(accepted); expect(await repo.list("domainEvent")).toEqual(events);
        await command(id,"save",{content:{...payload(),description:"v2 without acceptance"}}); await command(id,"publish"); await legacy("cancelled"); await command(id,"resume",{reason:"legacy unaccepted latest"});
        expect((await repo.get("task",id))!.data.status).toBe("requested"); expect((await repo.list("taskActivity")).filter(a=>a.data.kind==="accept")).toHaveLength(1);
        await repo.transaction(s=>{const row=s.get("task",id)!;s.update("task",id,row.revision,{...row.data,status:"completed"});});
        await expect(command(id,"resume",{reason:"cannot invent completion"})).rejects.toMatchObject({status:409});
    });
    it("A04/A19 SA-04 exact reference bytes stay private before publish, survive revisions and revoke with membership", async () => {
        await setup(); const directory = await mkdtemp(path.join(os.tmpdir(), "g04-file-")); directories.push(directory); const files = new FileService(identity, directory);
        const id = await create(); const bytes = Buffer.from("%PDF-1.4\nsynthetic G04 reference\n%%EOF");
        const uploaded = await files.upload(admin, id, [{ name: "참고 원문.pdf", type: "application/pdf", bytes }], "public"); const fid = uploaded.files[0].id;
        await expect(files.download(brand, fid, id, "download")).rejects.toMatchObject({ status: 404 });
        const c = { ...payload(), referenceFileIds: [fid] }; await command(id, "save", { content: c }); const preview = await tasks.preview(admin, id); await command(id, "publish"); expect((await tasks.detail(brand, id)).request).toEqual(preview.content);
        expect((await files.download(brand, fid, id, "download")).bytes).toEqual(bytes); expect((await files.download(brand, fid, id, "preview")).metadata.preview).toBe(true);
        await command(id, "save", { content: payload() }); await command(id, "publish"); expect((await files.download(brand, fid, id, "original")).bytes).toEqual(bytes);
        const privateFile = (await files.upload(admin, id, [{ name: "내부.pdf", type: "application/pdf", bytes }], "internal")).files[0]; await expect(files.download(brand, privateFile.id, id, "download")).rejects.toMatchObject({ status: 404 });
        const m = (await repo.list("membership", ctx)).find(m => m.data.userId === "user-luna")!; await identity.setMembership(admin, ctx, m.id, { status: "suspended", expectedRevision: m.revision }); await expect(files.download(brand, fid, id, "download")).rejects.toMatchObject({ status: 404 });
        await writeFile(path.join(directory, fid), "tampered"); await expect(files.download(admin, fid, id, "download")).rejects.toMatchObject({ status: 503 });
    });
    it("A04 SA-04 partial-SA-19 upload failure leaves no metadata/orphan bytes; unsupported preview preserves original download", async () => {
        await setup(); const directory = await mkdtemp(path.join(os.tmpdir(), "g04-file-")); directories.push(directory); const id = await create(); const bad = new FileService(identity, directory, () => { throw new Error("file rollback"); });
        const fixture = { name: "원문.csv", type: "text/csv", bytes: Buffer.from("제품,수량\n합성,2") };
        await expect(bad.upload(admin, id, [fixture], "public")).rejects.toThrow("file rollback"); expect(await repo.list("fileVersion")).toEqual([]); expect(await readdir(directory)).toEqual([]);
        const files = new FileService(identity, directory), f = (await files.upload(admin, id, [fixture], "public")).files[0];
        await expect(files.download(admin, f.id, id, "preview")).rejects.toMatchObject({ status: 422 }); expect((await files.download(admin, f.id, id, "download")).bytes).toEqual(fixture.bytes);
        await expect(files.upload(admin, id, Array.from({ length: 11 }, () => fixture), "public")).rejects.toMatchObject({ status: 422 });
    });
});
describe("G04 declarative validation and evaluator boundaries", () => {
    it("SA-10/11 supports all eight types with explicit required/recommended auto/human rules", () => { const c = payload(); c.requirements = requirementTypes.map(type => ({ ...blankRequirement(`q-${type}`, type), label: type, options: type === "choice" ? ["yes", "no"] : [], specifications: [{ text: "규격", source: "합성 원문", version: "v1", severity: "recommended" as const, check: "human" as const }] })); expect(content(c).requirements.map(r => r.type)).toEqual(requirementTypes); });
    it("CR05 chained conditions ignore stale descendant answers and evaluate per product", () => { const c = payload(); c.requirements = [{ ...blankRequirement("a", "choice"), label: "a", options: ["yes", "no"] }, { ...blankRequirement("b", "choice"), label: "b", options: ["ship"], condition: { key: "a", equals: "yes" } }, { ...blankRequirement("c"), label: "c", condition: { key: "b", equals: "ship" } }]; content(c); const rows = evaluateRequirements(c, { taskId: "t", requestId: "r", authorId: "u", answers: [{ requirementKey: "a", productId: null, value: "no", fileVersionIds: [] }, { requirementKey: "b", productId: null, value: "ship", fileVersionIds: [] }] }, c); expect(rows.map(r => r.status)).toEqual(["prior_received", "not_applicable", "not_applicable"]); c.requirements[0].condition = { key: "b", equals: "ship" }; expect(() => content(c)).toThrow(); });
    it("CR06 rejects impossible date/date-time, preserves timezone/date-only precision and conflicting raw source", () => { for (const value of ["2026-02-30", "2026-13-01"]) expect(() => deadline({ ...payload().deadline, value })).toThrow(); for (const value of ["2026-02-30T09:00:00+09:00", "2026-10-01T09:00:00", "2026-10-01T24:00:00+09:00", "2026-10-01T09:61:00+09:00"]) expect(() => deadline({ ...payload().deadline, value, precision: "datetime" })).toThrow(); expect(deadline({ ...payload().deadline, value: "2026-10-01T09:00:00+09:00", precision: "datetime", raw: "10/1 수요일 원문" })).toMatchObject({ value: "2026-10-01T09:00:00+09:00", raw: "10/1 수요일 원문", timezone: "Asia/Seoul" }); });
    it("A04 partial-SA-19 file formats, bounded names/mime/size and signature checks reject traversal or disguised content", () => { const pdf = Buffer.from("%PDF-1.4\nsynthetic"); for (const [name, type, bytes] of [["../bad.pdf", "application/pdf", pdf], ["x.exe", "application/octet-stream", pdf], ["x.pdf", "image/png", pdf], ["x.pdf", "application/pdf", Buffer.from("fake")], ["x.pdf", "application/pdf", Buffer.alloc(MAX_FILE_BYTES + 1)]] as const) expect(() => validateFile(name, type, bytes)).toThrow(); const exact = Buffer.alloc(MAX_FILE_BYTES); pdf.copy(exact); expect(validateFile("limit.pdf", "application/pdf", exact).preview).toBe(true); });
});
