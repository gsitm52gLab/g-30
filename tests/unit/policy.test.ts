import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { RecordRepository, UnitOfWork } from "@/domain/records";
import { StoreError } from "@/domain/records";
import { createMockRepository } from "@/server/repositories/mock";
import { createSqliteRepository } from "@/server/repositories/sqlite";
import { openDatabase, migrate } from "@/server/db/database";
import { IdentityService } from "@/server/auth/service";
import { authorize, decide, visiblePage } from "@/server/policy/policy";
import { contextResource, type Action, type ResourceScope } from "@/server/policy/types";
import { projectTask, projectProduct, projectChannel, projectAudit, sessionUser, memberIdentity, taskScope } from "@/server/policy/projection";
import { policyFixture, principal, tokenFor, actors, contexts, CONTEXT, NOW, marker } from "../fixtures/policy";

for (const mode of ["mock", "sqlite"] as const) describe(`G02 ${mode}`, () => {
    let repo: RecordRepository;
    let service: IdentityService;
    let directory: string;
    let filename: string;
    const clock = () => NOW;
    const resource = (kind: ResourceScope["kind"], contextId = CONTEXT): ResourceScope => ({ id: "fixture-resource", kind, contextId, visibility: "public" });
    beforeEach(async () => {
        directory = mkdtempSync(path.join(tmpdir(), "hale-policy-"));
        filename = path.join(directory, "policy.db");
        if (mode === "mock") repo = createMockRepository(clock);
        else { const db = openDatabase(filename, true); migrate(db); repo = createSqliteRepository(db, clock); }
        service = await policyFixture(repo);
    });
    afterEach(() => { repo.close(); rmSync(directory, { recursive: true, force: true }); });

    it("T01/T08: all 11 actors × six contexts are scoped, including non-active accounts", async () => {
        const expected: Record<string, string[]> = {
            "user-admin": contexts, "user-selected-admin": [CONTEXT], "user-gsg": [CONTEXT], "user-price": [CONTEXT],
            "user-luna": [CONTEXT, "ctx-jp-b-luna"], "user-wave": ["ctx-jp-a-wave"], "user-co": [CONTEXT], "user-team": [CONTEXT], "user-none": [],
        };
        await repo.transaction(s => {
            for (const actor of actors) for (const context of contexts) {
                if (!(actor in expected)) expect(() => principal(service, s, actor)).toThrow();
                else {
                    const p = principal(service, s, actor);
                    const inScope = expected[actor].includes(context);
                    expect(decide(s, p, "context.read", contextResource(context), clock).allowed).toBe(inScope);
                    expect(decide(s, p, "product.edit", resource("product", context), clock).allowed).toBe(inScope);
                    expect(decide(s, p, "task.manage", resource("task", context), clock).allowed).toBe(inScope && ["user-admin", "user-selected-admin", "user-gsg", "user-price"].includes(actor));
                    expect(decide(s, p, "membership.manage", resource("membership", context), clock).allowed).toBe(inScope && ["user-admin", "user-selected-admin"].includes(actor));
                }
            }
        });
    });

    it("T02/T18: explicit current lead/co assignment, historical author and contributor do not grant writes", async () => {
        await repo.transaction(s => {
            const task = s.get("task", "task-onboarding")!;
            const assigned = { ...taskScope(task), coAssigneeUserIds: ["user-co"] };
            for (const user of ["user-luna", "user-co", "user-team"]) {
                const p = principal(service, s, user);
                expect(decide(s, p, "task.read", assigned, clock).allowed).toBe(true);
                expect(decide(s, p, "submission.write", assigned, clock).allowed).toBe(user !== "user-team");
                expect(decide(s, p, "task.complete", assigned, clock).allowed).toBe(false);
            }
            const unresolved = { ...assigned, unresolvedCount: 3, externalWait: true, aiStatus: "failed" };
            expect(decide(s, principal(service, s, "user-gsg"), "task.complete", unresolved, clock).allowed).toBe(true);
            expect(decide(s, principal(service, s, "user-luna"), "submission.write", { ...assigned, assigneeUserId: "user-co", coAssigneeUserIds: [] }, clock).allowed).toBe(false);
        });
    });

    it("SA03: non-assigned brand product edits and independent inquiry remain separate actions", async () => {
        await repo.transaction(s => {
            const p = principal(service, s, "user-team");
            expect(decide(s, p, "product.edit", resource("product"), clock).allowed).toBe(true);
            expect(decide(s, p, "inquiry.create", resource("inquiry"), clock).allowed).toBe(true);
            expect(decide(s, p, "task.manage", resource("task"), clock).allowed).toBe(false);
        });
    });

    it("T03: forged principal role/price flags, unknown action/kind/visibility cannot grant access", async () => {
        await repo.transaction(s => {
            const real = principal(service, s, "user-team");
            const fake = { ...real, user: { ...real.user, data: { ...real.user.data, role: "gsg" as const, adminGrant: { scope: "all" as const, contextIds: [], internalPriceAccess: true } } } };
            expect(decide(s, fake, "membership.manage", resource("membership"), clock).allowed).toBe(false);
            expect(decide(s, fake, "price.read", resource("product"), clock).allowed).toBe(false);
            expect(decide(s, real, "constructor" as Action, resource("task"), clock).allowed).toBe(false);
            expect(decide(s, real, "task.read", resource("product"), clock).allowed).toBe(false);
            expect(decide(s, real, "task.read", { ...resource("task"), visibility: "unknown" as "public" }, clock).allowed).toBe(false);
        });
    });

    it("T04/T05: projected task and product omit nested unknown fields and enforce explicit price grant", async () => {
        await repo.transaction(s => {
            for (const user of ["user-luna", "user-gsg", "user-price", "user-selected-admin", "user-admin"]) {
                const p = principal(service, s, user);
                const task = projectTask(s, p, s.get("task", "task-onboarding")!, clock);
                const product = projectProduct(s, p, s.get("product", "product-serum")!, clock);
                expect(JSON.stringify(task)).not.toContain("privateNested");
                expect(JSON.stringify(task)).not.toContain("unknownField");
                expect(task.data.notes).toHaveLength(2);
                expect(JSON.stringify(task).includes(marker)).toBe(user !== "user-luna");
                expect(Object.hasOwn(product.data, "internalSupplyPrice")).toBe(["user-price", "user-admin"].includes(user));
                expect(JSON.stringify(product)).not.toContain("privateNested");
            }
            expect(() => projectTask(s, principal(service, s, "user-wave"), s.get("task", "task-onboarding")!, clock)).toThrow();
        });
    });

    it("D01 regression/T20: peer grants and unknown audit payloads never pass allowlists", async () => {
        await repo.transaction(s => {
            const user = s.get("user", "user-admin")!;
            user.data.adminGrant = { ...user.data.adminGrant!, nested: { secret: marker } } as typeof user.data.adminGrant;
            expect(memberIdentity(user)).not.toHaveProperty("adminGrant");
            expect(JSON.stringify(sessionUser(user))).not.toContain(marker);
            const audit = s.create("audit", { id: "audit-projection", contextId: CONTEXT, data: { actorId: "user-admin", action: "membership.changed", targetId: "x", at: NOW,
                before: { scope: { nested: marker }, internalSupplyPrice: marker }, after: { status: "suspended", internalPriceAccess: false, tokenHash: marker } } });
            expect(projectAudit(audit).data.after).toEqual({ status: "suspended", internalPriceAccess: false });
            expect(JSON.stringify(projectAudit(audit))).not.toContain(marker);
        });
    });

    it("T06: original/preview/download need both source and reference scopes; internal stays private", async () => {
        await repo.transaction(s => {
            const p = principal(service, s, "user-team");
            const file = { ...resource("file"), originalScope: resource("task"), referenceScope: resource("task") };
            for (const action of ["file.original", "file.preview", "file.download"] as const) {
                expect(decide(s, p, action, file, clock).allowed).toBe(true);
                for (const changed of [{ originalScope: undefined }, { originalScope: resource("task", "ctx-jp-b-luna") },
                    { referenceScope: resource("task", "ctx-jp-a-wave") }, { originalScope: { ...resource("task"), visibility: "internal" as const } }]) {
                    expect(decide(s, p, action, { ...file, ...changed }, clock).allowed).toBe(false);
                }
                expect(decide(s, principal(service, s, "user-none"), action, file, clock).allowed).toBe(false);
            }
        });
    });

    it("T09: projection precedes keyword matching/count/order/page across future channels", async () => {
        await repo.transaction(s => {
            const p = principal(service, s, "user-team");
            const rows = [{ ...resource("search"), id: "public" }, { ...resource("search", "ctx-jp-a-wave"), id: "secret" }];
            const page = (term: string) => visiblePage(rows, scope => decide(s, p, "search.read", scope, clock).allowed
                ? projectChannel(s, p, "search.read", scope, { title: "public title", internalMemo: marker, unknown: { value: marker } }, clock) : null,
            { matches: row => JSON.stringify(row).includes(term), compare: (a, b) => a.id.localeCompare(b.id), offset: 0, limit: 1 });
            expect(page("public").total).toBe(1);
            expect(page(marker)).toEqual({ total: 0, items: [] });
            for (const [action, kind] of [["export.read", "export"], ["ai.input.read", "ai_input"], ["ai.result.read", "ai_result"], ["notification.read", "notification"]] as const) {
                const dto = projectChannel(s, p, action, { ...resource(kind), recipientUserId: p.user.id }, { title: "public", internalOriginal: marker, internalSupplyPrice: marker }, clock);
                expect(JSON.stringify(dto)).not.toContain(marker);
            }
            expect(decide(s, p, "notification.read", { ...resource("notification"), recipientUserId: "user-luna" }, clock).allowed).toBe(false);
            expect(decide(s, p, "ai.result.read", { ...resource("ai_result"), sourceScopes: [resource("ai_input", "ctx-jp-a-wave")] }, clock).allowed).toBe(false);
            const priceFile = { ...resource("file"), originalScope: { ...resource("product"), requiresInternalPrice: true }, referenceScope: resource("task") };
            expect(decide(s, principal(service, s, "user-gsg"), "file.download", priceFile, clock).allowed).toBe(false);
            expect(decide(s, principal(service, s, "user-price"), "file.download", priceFile, clock).allowed).toBe(true);
        });
    });

    it("T07/T16: reused principal re-reads price and membership changes in the same UoW", async () => {
        const saved = await repo.transaction(s => principal(service, s, "user-price"));
        const admin = tokenFor("user-admin");
        let member = (await repo.get("membership", `member-user-price-${CONTEXT}`))!;
        await service.setMembership(admin, CONTEXT, member.id, { expectedRevision: member.revision, status: "active", internalPriceAccess: false });
        await repo.transaction(s => expect(decide(s, saved, "price.read", resource("product"), clock).allowed).toBe(false));
        member = (await repo.get("membership", member.id))!;
        await service.setMembership(admin, CONTEXT, member.id, { expectedRevision: member.revision, status: "suspended" });
        const before = await repo.get("task", "task-onboarding");
        await expect(repo.transaction(s => {
            authorize(s, saved, "task.manage", resource("task"), clock);
            s.update("task", before!.id, before!.revision, { ...before!.data, title: "must not commit" });
        })).rejects.toMatchObject({ status: 404 });
        expect(await repo.get("task", "task-onboarding")).toEqual(before);
    });

    it("T11/T16: suspended account and old authVersion/session cannot be restored by stale principal", async () => {
        const saved = await repo.transaction(s => principal(service, s, "user-luna"));
        await service.setUserStatus(tokenFor("user-admin"), "user-luna", { expectedRevision: saved.user.revision, status: "suspended" });
        const stopped = (await repo.get("user", "user-luna"))!;
        await service.setUserStatus(tokenFor("user-admin"), "user-luna", { expectedRevision: stopped.revision, status: "active" });
        await repo.transaction(s => expect(decide(s, saved, "task.read", resource("task"), clock)).toEqual({ allowed: false, status: 401 }));
        await expect(service.me(tokenFor("user-luna"))).rejects.toMatchObject({ status: 401 });
    });

    it("T11: expiry and authVersion invalidation fail closed", async () => {
        await repo.transaction(s => {
            const p = principal(service, s, "user-team");
            expect(decide(s, p, "task.read", resource("task"), () => "2026-09-23T00:00:00.000Z").allowed).toBe(false);
            const u = s.get("user", p.user.id)!;
            s.update("user", u.id, u.revision, { ...u.data, authVersion: 2 });
            expect(decide(s, p, "task.read", resource("task"), clock).allowed).toBe(false);
        });
    });

    it("T17: failing permission store propagates failure instead of allowing or returning empty admin", async () => {
        await repo.transaction(s => {
            const p = principal(service, s, "user-team");
            const broken = { ...s, get: () => { throw new StoreError("STORAGE_UNAVAILABLE"); } } as UnitOfWork;
            expect(() => decide(broken, p, "task.read", resource("task"), clock)).toThrow("STORAGE_UNAVAILABLE");
        });
    });

    it("T01: absent and forbidden resources have the same non-revealing 404", async () => {
        const errors = await Promise.all(["ctx-jp-a-wave", "missing-context"].map(c => service.members(tokenFor("user-luna"), c).catch(e => ({ code: e.code, status: e.status, message: e.message }))));
        expect(errors[0]).toEqual(errors[1]);
        expect(errors[0]).toMatchObject({ status: 404 });
    });

    it("T04/T20: current member service excludes cross-context global audits and peer grants", async () => {
        await repo.transaction(s => {
            s.create("membership", { id: "peer-admin", contextId: CONTEXT, data: { userId: "user-admin", role: "operator", status: "active", scope: "fixture", internalPriceAccess: false, activatedAt: NOW, suspendedAt: null } });
            s.create("audit", { id: "unknown-global", contextId: null, data: { actorId: "user-admin", targetId: "user-admin", action: marker, before: { secret: marker }, after: {}, at: NOW } });
        });
        const members = await service.members(tokenFor("user-selected-admin"), CONTEXT);
        expect(members.members.find(m => m.user.id === "user-admin")?.user).not.toHaveProperty("adminGrant");
        expect(members.history.some(a => a.id === "unknown-global")).toBe(false);
        expect(JSON.stringify(members)).not.toContain("internalSupplyPrice");
        expect((await service.me(tokenFor("user-admin"))).user.adminGrant?.scope).toBe("all");
    });
});
