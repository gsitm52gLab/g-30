import { projectProduct } from "@/server/policy/projection";
import { afterEach, describe, expect, it } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createMockRepository } from "@/server/repositories/mock";
import { createSqliteRepository } from "@/server/repositories/sqlite";
import { openDatabase, migrate } from "@/server/db/database";
import type { RecordRepository } from "@/domain/records";
import type { IdentityService } from "@/server/auth/service";
import { ProductService } from "@/server/products/service";
import { FileService } from "@/server/files/service";
import { TaskService } from "@/server/tasks/service";
import { captureProductUse } from "@/server/products/capture";
import { blankContent, blankRequirement } from "@/domain/tasks/types";
import { blankFileBinding } from "@/domain/products/types";
import { policyFixture, tokenFor, NOW } from "../fixtures/policy";
const A = "ctx-jp-a-luna", brand = tokenFor("user-luna"), admin = tokenFor("user-admin"), team = tokenFor("user-team"), marker = "G06_REPLAY_PRIVATE_CANARY";
for (const mode of ["mock", "sqlite"] as const)
    describe(`${mode} G06 contract review regressions`, () => {
        let repo: RecordRepository, identity: IdentityService, products: ProductService;
        const dirs: string[] = [];
        async function setup() { if (mode === "mock")
            repo = createMockRepository(() => NOW);
        else {
            const db = openDatabase(":memory:", true);
            migrate(db);
            repo = createSqliteRepository(db, () => NOW);
        } identity = await policyFixture(repo); products = new ProductService(identity); }
        afterEach(async () => { repo?.close(); await Promise.all(dirs.map(d => rm(d, { recursive: true, force: true }))); });
        it("explicit internal upload capability includes nonprice GSG and excludes brand without exposing a price capability", async () => {
        await setup();
        const gsg=await products.detail(tokenFor("user-gsg"),"product-serum",A),brandDetail=await products.detail(brand,"product-serum",A);
        expect(gsg.capabilities.uploadInternalFile).toBe(true);expect(gsg.capabilities.editInternalPrice).toBe(false);
        expect(brandDetail.capabilities.uploadInternalFile).toBe(false);
    });
    it("CR04 legacy product view carries the resolved context while the common record stays context-null", async () => {
        await setup();
        const detail=await products.detail(brand,"product-serum",A);
        await products.command(brand,"product-serum",{contextId:A,command:"link_context",targetContextId:"ctx-jp-b-luna",expectedCommonRevision:detail.commonRevision,idempotencyKey:randomUUID()});
        for(const contextId of [A,"ctx-jp-b-luna"]){
            const view=await repo.transaction(s=>projectProduct(s,identity.principal(s,brand),s.get("product","product-serum")!,()=>NOW,contextId));
            expect(view.contextId).toBe(contextId);
            expect(`/products/${view.id}?context=${view.contextId}`).toBe(`/products/product-serum?context=${contextId}`);
        }
        expect((await repo.get("product","product-serum"))!.contextId).toBeNull();
    });
    it("R1 rejects nonfinite/noninteger/nonpositive pagination rather than serializing null or silently changing request", async () => {
            await setup();
            for (const value of ["Infinity", "-Infinity", "NaN", "bad", "0", "-1", "1.5", "1e100", ""]) {
                await expect(products.list(brand, { page: value })).rejects.toMatchObject({ status: 422 });
                await expect(products.list(brand, { pageSize: value })).rejects.toMatchObject({ status: 422 });
            }
            expect((await products.list(brand, { page: "2", pageSize: "1" })).page).toBe(2);
            expect((await products.list(brand, { pageSize: "1000" })).pageSize).toBe(100);
        });
        it("R2 persisted receipt unknown/nested result extensions are excluded from idempotent response without mutating receipt", async () => {
            await setup();
            const d = await products.detail(brand, "product-serum", A), body = { contextId: A, command: "save_common", common: d.common, expectedCommonRevision: d.commonRevision, idempotencyKey: randomUUID() }, command = "product.product-serum.save_common";
            const key = createHash("sha256").update(`user-luna:${A}:${command}:${body.idempotencyKey}`).digest("hex"), bodyHash = createHash("sha256").update(JSON.stringify(body)).digest("hex");
            const receipt = await repo.transaction(s => s.create("commandReceipt", { id: randomUUID(), contextId: A, data: { key, actorId: "user-luna", command, bodyHash, result: { ids: ["product-serum", { private: marker }], extra: { private: marker } } as unknown as {
                        ids: string[];
                    } } }));
            const response = await products.command(brand, "product-serum", body);
            expect(response).toEqual({ ids: ["product-serum"] });
            expect(JSON.stringify(response)).not.toContain(marker);
            expect(await repo.get("commandReceipt", receipt.id)).toEqual(receipt);
        });
        it("R3 public task file must belong to a published request before cross-owner product bind/download/capture; own draft publication still works", async () => {
            await setup();
            const dir = await mkdtemp(path.join(os.tmpdir(), "gs-hale-g06-r3-"));
            dirs.push(dir);
            const files = new FileService(identity, dir), tasks = new TaskService(identity);
            const content = { ...blankContent(), title: "원본 공개 업무", description: "공개 파일 범위 검사", deadline: { ...blankContent().deadline, responsibleUserId: "user-gsg" }, requirements: [{ ...blankRequirement("text"), label: "자료 설명" }] };
            const tid = (await tasks.create(admin, { targets: [{ contextId: A, ownerId: "user-gsg", assigneeId: "user-luna", coAssigneeIds: [], productIds: ["product-serum"] }], content, category: "spot", idempotencyKey: randomUUID() })).ids[0];
            const taskCommand = async (command: string, extra: Record<string, unknown> = {}) => tasks.command(admin, tid, { command, expectedRevision: (await repo.get("task", tid))!.revision, idempotencyKey: randomUUID(), ...extra });
            await taskCommand("publish");
            const bytes = Buffer.from("%PDF-1.4\nG06 not yet published file\n%%EOF"), file = (await files.upload(admin, tid, [{ name: "pending.pdf", type: "application/pdf", bytes }], "public")).files[0];
            await expect(files.download(brand, file.id, tid, "download")).rejects.toMatchObject({ status: 404 });
            for (const token of [brand, team, admin]) {
                const d = await products.detail(token, "product-serum", A);
                expect(d.reusableFiles.map(f => f.id)).not.toContain(file.id);
                await expect(products.command(token, "product-serum", { contextId: A, command: "save_files", files: [blankFileBinding("unpublished", file.id)], expectedContextRevision: d.contextRevision, idempotencyKey: randomUUID() })).rejects.toMatchObject({ status: 422 });
            }
            // Stored prior malformed binding is a contract fixture, not a permitted producer.
            await repo.transaction(s => { const cp = s.list("contextProduct", A).find(r => r.data.productId === "product-serum")!, old = s.get("contextProductVersion", cp.data.currentVersionId!)!; const v = s.create("contextProductVersion", { id: randomUUID(), contextId: A, data: { ...old.data, sequence: old.data.sequence + 1, previousId: old.id, files: [blankFileBinding("unpublished", file.id)] } }); s.update("contextProduct", cp.id, cp.revision, { ...cp.data, currentVersionId: v.id }); });
            const d = await products.detail(brand, "product-serum", A);
            expect(d.files).toEqual([]);
            await expect(files.download(brand, file.id, { kind: "product", contextId: A, productId: "product-serum" }, "original")).rejects.toMatchObject({ status: 422 });
            await expect(repo.transaction(s => captureProductUse(s, identity.principal(s, brand), { contextId: A, productId: "product-serum", expectedCommonRevision: d.commonRevision, expectedContextRevision: d.contextRevision, bindingIds: ["unpublished"], retailPriceVersionId: null, asOfDate: "2026-09-21", ownerType: "prior_use_fixture", ownerId: "prior-r3", taskId: null, requestId: null }, () => NOW))).rejects.toMatchObject({ status: 422 });
            await taskCommand("save", { content: { ...content, referenceFileIds: [file.id] } });
            expect((await tasks.preview(admin, tid)).content.referenceFileIds).toEqual([file.id]);
            await taskCommand("publish");
            expect((await files.download(brand, file.id, { kind: "product", contextId: A, productId: "product-serum" }, "download")).bytes).toEqual(bytes);
            expect((await products.detail(brand, "product-serum", A)).files[0].file.id).toBe(file.id);
        });
    });
