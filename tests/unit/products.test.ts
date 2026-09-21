import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createMockRepository } from "@/server/repositories/mock";
import { createSqliteRepository } from "@/server/repositories/sqlite";
import { openDatabase, migrate } from "@/server/db/database";
import { seed } from "@/server/db/seed";
import { fixtures } from "@/data/fixtures";
import { migrateLegacyProducts } from "@/data/products/migrate";
import { policyFixture, tokenFor, NOW } from "../fixtures/policy";
import { ProductService } from "@/server/products/service";
import { captureProductUse, readProductUse } from "@/server/products/capture";
import { FileService } from "@/server/files/service";
import { TaskService } from "@/server/tasks/service";
import { blankCommon, blankContext, blankRetailPrice, blankInternalPrice, blankFileBinding } from "@/domain/products/types";
import { blankContent, blankRequirement } from "@/domain/tasks/types";
import type { RecordRepository } from "@/domain/records";
import type { IdentityService } from "@/server/auth/service";
const A = "ctx-jp-a-luna", B = "ctx-jp-b-luna", admin = tokenFor("user-admin"), brand = tokenFor("user-luna"), team = tokenFor("user-team"), gsg = tokenFor("user-gsg"), price = tokenFor("user-price"), foreign = tokenFor("user-wave");
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aS0cAAAAASUVORK5CYII=", "base64");
const uploadFile = { name: "synthetic.png", type: "image/png", bytes: png };
for (const mode of ["mock", "sqlite"] as const)
    describe(`${mode} G06 product contracts`, () => {
        let repo: RecordRepository, identity: IdentityService, products: ProductService;
        const directories: string[] = [];
        function repository() { if (mode === "mock")
            repo = createMockRepository(() => NOW);
        else {
            const db = openDatabase(":memory:", true);
            migrate(db);
            repo = createSqliteRepository(db, () => NOW);
        } return repo; }
        async function setup() { repository(); identity = await policyFixture(repo); products = new ProductService(identity); }
        async function create(code: string = randomUUID(), contextId = A, token = brand, common = { ...blankCommon(), name: "합성 상품", code }) { return (await products.create(token, { contextId, brandId: "brand-luna", common, idempotencyKey: randomUUID() })).ids[0]; }
        const detail = (pid: string, contextId = A, token = brand) => products.detail(token, pid, contextId);
        async function command(pid: string, command: string, extra: Record<string, unknown>, contextId = A, token = brand) { return products.command(token, pid, { contextId, command, idempotencyKey: randomUUID(), ...extra }); }
        async function upload(pid: string, token = brand, visibility: "public" | "internal" = "public") { const dir = await mkdtemp(path.join(os.tmpdir(), "gs-hale-g06-")); directories.push(dir); const fs = new FileService(identity, dir); return { fs, dir, file: (await fs.upload(token, { kind: "product", contextId: A, productId: pid }, [uploadFile], visibility)).files[0] }; }
        afterEach(async () => { repo?.close(); await Promise.all(directories.splice(0).map(d => rm(d, { recursive: true, force: true }))); });
        it("SA24 legacy migration preserves arbitrary edited IDs, unknown fields and original links; fault rolls back both adapters", async () => {
            repository();
            await repo.transaction(s => { for (const f of fixtures)
                s.create(f.kind, f.input); const old = s.get("product", "product-serum")!; s.update("product", old.id, old.revision, { ...old.data, name: "사전 수정", size: "30 g / refill unknown", custom: { preserve: "original" } } as typeof old.data); s.create("product", { id: "custom-before-migration", contextId: A, data: { ...old.data, code: "CUSTOM-001", name: "기존 사용자 상품" } }); });
            const old = await repo.list("product"), tasks = await repo.list("task");
            await expect(repo.transaction(s => migrateLegacyProducts(s, () => { throw new Error("migration fault"); }))).rejects.toThrow("migration fault");
            expect(await repo.list("product")).toEqual(old);
            expect(await repo.list("productMigration")).toEqual([]);
            expect(await repo.list("contextProduct")).toEqual([]);
            expect(await repo.transaction(s => migrateLegacyProducts(s))).toEqual({ migrated: 4 });
            expect(await repo.list("task")).toEqual(tasks);
            expect((await repo.get("product", "product-serum"))!.contextId).toBeNull();
            const provenance = (await repo.list("productMigration")).find(m => m.data.productId === "product-serum")!;
            expect(provenance.data.legacyData).toEqual(old.find(p => p.id === "product-serum")!.data);
            expect((await repo.list("productVersion")).find(v => v.data.productId === "product-serum")!.data.common.capacity).toEqual({ amount: null, unit: "", raw: "30 g / refill unknown" });
            expect((await seed(repo)).products.migrated).toBe(0);
            await expect(repo.transaction(s => { const p = s.get("product", "product-serum")!; s.update("product", p.id, p.revision, p.data, { legacyProductContextId: A }); })).rejects.toMatchObject({ code: "INVALID_RECORD" });
            await expect(repo.transaction(s => { const t = s.get("task", "task-pop")!; s.update("task", t.id, t.revision, t.data, { legacyProductContextId: A }); })).rejects.toMatchObject({ code: "INVALID_RECORD" });
        });
        it("AC06-01 SA23/24 minimum three values and every common/context field round-trip without generated unknown facts", async () => {
            await setup();
            const minimum = await products.create(brand, { contextId: A, brandId: "brand-luna", common: { name: "최소 상품", code: "TMP-0001", temporaryCode: true }, idempotencyKey: randomUUID() });
            const d = await detail(minimum.ids[0]);
            expect(d.common.temporaryCode).toBe(true);
            expect(d.common.ingredients.classification).toBeNull();
            expect(d.local.jan).toBe("");
            expect(d.local.launchDate.value).toBeNull();
            expect(d.materialCounts).toEqual({ connected: false, requested: null, missing: null, unconfirmed: null });
            const full = { ...blankCommon(), name: "수정 상품", code: "001-Ab-C", localNames: [{ language: "ja", name: "合成商品" }], category: "합성분류", capacity: { amount: "030.50", unit: "mL", raw: "30.50 mL" }, variants: { color: "색", scent: "향", other: "변형" }, description: "설명", usage: "사용법", originCountry: "원산지", manufacturer: "제조사", manufacturingDetails: "제조 정보", ingredients: { text: "합성 전성분 원문", language: "ko", submittedAt: "2026-09-21", classification: null }, packaging: { container: "용기", packaging: "포장", label: "라벨", box: "박스", itf: "0000123" } };
            await command(d.productId, "save_common", { common: full, expectedCommonRevision: d.commonRevision });
            const fields = { ...blankContext(), localName: "현지명", sku: "000-A", jan: "000012345", registrationStatus: "registered", salesStatus: "planned", launchDate: { value: "2027-01-02T10:30:00+09:00", precision: "datetime", certainty: "expected", timezone: "Asia/Tokyo", source: "합성 협의", raw: "원문 예정일" } };
            await command(d.productId, "save_context", { fields, expectedContextRevision: (await detail(d.productId)).contextRevision });
            const after = await detail(d.productId);
            expect(after.common).toEqual({ ...full, capacity: { ...full.capacity, amount: "30.5" } });
            expect(after.local).toEqual(fields);
            expect(after.commonHistory).toHaveLength(2);
            await expect(products.create(brand, { contextId: A, brandId: "brand-luna", common: { name: "중복", code: " 001-ab-c " }, idempotencyKey: randomUUID() })).rejects.toMatchObject({ status: 409 });
            await expect(command(d.productId, "save_common", { common: { ...after.common, brandId: "forged" }, expectedCommonRevision: after.commonRevision })).rejects.toMatchObject({ status: 422 });
        });
        it("AC06-02 common edits through one allowed relation leave other context data/private prices isolated and impact never enumerates hidden context", async () => {
            await setup();
            const pid = await create(), before = await detail(pid);
            await command(pid, "link_context", { targetContextId: B, expectedCommonRevision: before.commonRevision });
            const b = await detail(pid, B);
            await command(pid, "save_context", { fields: { ...b.local, sku: "B-001", jan: "0002", salesStatus: "selling" }, expectedContextRevision: b.contextRevision }, B);
            await command(pid, "save_context", { fields: { ...before.local, sku: "A-001", jan: "0001", salesStatus: "stopped" }, expectedContextRevision: before.contextRevision });
            const teamDetail = await detail(pid, A, team);
            expect(teamDetail.capabilities.editCommon).toBe(true);
            expect(teamDetail.visibleContexts.map(c => c.id)).toEqual([A]);
            expect(JSON.stringify(teamDetail)).not.toContain(B);
            const next = { ...teamDetail.common, name: "비담당자의 공통 수정" };
            const impact = await products.impact(team, pid, { contextId: A, common: next, expectedCommonRevision: teamDetail.commonRevision });
            expect(impact.visibleContexts.map(c => c.id)).toEqual([A]);
            expect(impact).not.toHaveProperty("total");
            expect(impact.changes.map(c => c.field)).toEqual(["name"]);
            await command(pid, "save_common", { common: next, expectedCommonRevision: teamDetail.commonRevision }, A, team);
            expect((await detail(pid, B)).common.name).toBe(next.name);
            expect((await detail(pid, B)).local.sku).toBe("B-001");
            await expect(detail(pid, B, team)).rejects.toMatchObject({ status: 404 });
            await expect(command(pid, "link_context", { targetContextId: "ctx-jp-a-wave", expectedCommonRevision: (await detail(pid)).commonRevision }, A, admin)).rejects.toMatchObject({ status: 404 });
            await expect(command(pid, "link_context", { targetContextId: B, expectedCommonRevision: (await detail(pid)).commonRevision })).rejects.toMatchObject({ code: "CONFLICT" });
        });
        it("AC06-04 independent retail/private revisions preserve zero/high decimal prices; current grants govern all private histories", async () => {
            await setup();
            const pid = await create();
            await command(pid, "save_retail", { price: { ...blankRetailPrice(), amount: "0", currency: "JPY", effectiveFrom: "2026-09-01", taxIncluded: "yes" }, expectedPriceRevision: 0 });
            await command(pid, "save_internal", { price: { ...blankInternalPrice(), supplyAmount: "9999999999999999999999999999.99", currency: "JPY", supplyRate: "0.4", rateUnit: "ratio", rateBasis: "소비자가 대비" }, expectedPriceRevision: 0 }, A, price);
            for (const actor of [brand, team, gsg]) {
                const d = await detail(pid, A, actor);
                expect(d).not.toHaveProperty("internal");
                expect(JSON.stringify(d)).not.toContain("999999999999");
                expect(JSON.stringify(await products.list(actor, { q: "999999999999" }))).not.toContain(pid);
            }
            const granted = await detail(pid, A, price);
            expect(granted.internal!.current!.fields.supplyRate).toBe("0.4");
            expect(granted.retail.current!.fields.amount).toBe("0");
            await expect(command(pid, "save_internal", { price: blankInternalPrice(), expectedPriceRevision: granted.internal!.revision }, A, gsg)).rejects.toMatchObject({ status: 404 });
            await repo.transaction(s => { const m = s.list("membership", A).find(x => x.data.userId === "user-price")!; s.update("membership", m.id, m.revision, { ...m.data, internalPriceAccess: false }); });
            expect(await detail(pid, A, price)).not.toHaveProperty("internal");
        });
        it("AC06-01 CAS/idempotency, concurrent duplicate and injected transaction failure preserve all or nothing", async () => {
            await setup();
            const pid = await create(), d = await detail(pid), input = { contextId: A, command: "save_common", common: { ...d.common, name: "한 번 저장" }, expectedCommonRevision: d.commonRevision, idempotencyKey: randomUUID() };
            expect(await products.command(brand, pid, input)).toEqual(await products.command(brand, pid, input));
            expect((await detail(pid)).commonHistory).toHaveLength(2);
            await expect(products.command(brand, pid, { ...input, common: { ...d.common, name: "다른 재시도" } })).rejects.toMatchObject({ status: 409 });
            await expect(products.command(brand, pid, { ...input, idempotencyKey: randomUUID() })).rejects.toMatchObject({ status: 409 });
            const duplicate = await Promise.allSettled([create("RACE-001"), create("race-001")]);
            expect(duplicate.filter(x => x.status === "fulfilled")).toHaveLength(1);
            const old = await detail(pid);
            const counts = await Promise.all([repo.list("productVersion"), repo.list("audit"), repo.list("domainEvent"), repo.list("commandReceipt")]);
            await expect(new ProductService(identity, () => { throw new Error("product fault"); }).command(brand, pid, { ...input, common: { ...old.common, name: "원복" }, expectedCommonRevision: old.commonRevision, idempotencyKey: randomUUID() })).rejects.toThrow("product fault");
            expect(await detail(pid)).toEqual(old);
            expect(await Promise.all([repo.list("productVersion"), repo.list("audit"), repo.list("domainEvent"), repo.list("commandReceipt")])).toEqual(counts);
        });
        it("SA24 code changes check hidden-context collisions atomically with neutral conflict", async () => {
            await setup();
            const pid = await create("SAFE-A");
            await command(pid, "link_context", { targetContextId: B, expectedCommonRevision: (await detail(pid)).commonRevision });
            await create("HIDDEN-CODE", B);
            const d = await detail(pid, A, team);
            const failure = await command(pid, "save_common", { common: { ...d.common, code: "hidden-code" }, expectedCommonRevision: d.commonRevision }, A, team).catch(e => e);
            expect(failure.status).toBe(409);
            expect(failure.message).not.toContain(B);
            expect(failure.message).not.toContain("HIDDEN-CODE");
            expect((await detail(pid)).common.code).toBe("SAFE-A");
        });
        it("SA27/28 independent product files use actual bytes and metadata; no cross-context automatic sharing; invisible bindings survive public edits", async () => {
            await setup();
            const pid = await create(), u = await upload(pid), d = await detail(pid), binding = { ...blankFileBinding("doc-one", u.file.id), purpose: "image", title: "합성 SDS 이미지", documentType: "SDS", issuer: "합성 발행사", issuedAt: "2026-09-01", signedAt: "2026-09-02", validityRaw: "원문 유효기간 미기재", productIds: [pid], language: "ja", media: "리플렛", usePlace: "합성 매장", source: "업로드 원문" };
            await command(pid, "save_files", { files: [binding], expectedContextRevision: d.contextRevision });
            expect((await detail(pid)).files[0]).toMatchObject(binding);
            expect((await u.fs.download(brand, u.file.id, { kind: "product", contextId: A, productId: pid }, "download")).bytes).toEqual(png);
            expect((await repo.get("fileVersion", u.file.id))!.data.taskId).toBeNull();
            await command(pid, "link_context", { targetContextId: B, expectedCommonRevision: d.commonRevision });
            expect((await detail(pid, B)).files).toEqual([]);
            expect((await detail(pid, B)).image).toBeNull();
            await expect(u.fs.download(brand, u.file.id, { kind: "product", contextId: B, productId: pid }, "download")).rejects.toMatchObject({ status: 404 });
            const privateFile = await upload(pid, admin, "internal");
            await command(pid, "save_files", { files: [binding, blankFileBinding("hidden", privateFile.file.id)], expectedContextRevision: (await detail(pid)).contextRevision }, A, admin);
            const publicD = await detail(pid);
            expect(publicD.files.map(f => f.id)).toEqual(["doc-one"]);
            expect(publicD.reusableFiles.map(f => f.id)).not.toContain(privateFile.file.id);
            await command(pid, "save_files", { files: [{ ...binding, title: "공개 수정" }], expectedContextRevision: publicD.contextRevision });
            expect((await detail(pid, A, admin)).files.map(f => f.id)).toEqual(["hidden", "doc-one"]);
            await command(pid, "save_context", { fields: { ...(await detail(pid)).local, sku: "SAME-CONTEXT" }, expectedContextRevision: (await detail(pid)).contextRevision });
            await repo.transaction(s => { const m = s.list("membership", A).find(m => m.data.userId === "user-luna")!; s.update("membership", m.id, m.revision, { ...m.data, status: "suspended" }); });
            await expect(u.fs.download(brand, u.file.id, { kind: "product", contextId: A, productId: pid }, "download")).rejects.toMatchObject({ status: 404 });
        });
        it("AC06-05 file uploader/time use immutable source for product and legacy task files, safe current labels and unchanged history", async () => {
            await setup();
            const pid = await create(), uploaded = await upload(pid, team), tasks = new TaskService(identity);
            const taskContent = { ...blankContent(), title: "이전 업무 자료", description: "합성 참고자료", requirements: [{ ...blankRequirement("text"), label: "자료" }], deadline: { ...blankContent().deadline, responsibleUserId: "user-gsg" } };
            const tid = (await tasks.create(admin, { targets: [{ contextId: A, ownerId: "user-gsg", assigneeId: "user-luna", coAssigneeIds: [], productIds: [pid] }], content: taskContent, category: "spot", idempotencyKey: randomUUID() })).ids[0];
            const taskFile = (await uploaded.fs.upload(gsg, tid, [uploadFile], "public")).files[0];
            const original = (await repo.get("fileVersion", taskFile.id))!;
            const legacyId = "legacy-task-file-provenance";
            await repo.transaction(s => { const { owner, ...legacyData } = original.data; void owner; s.create("fileVersion", { id: legacyId, contextId: A, data: legacyData }); });
            let task = await tasks.detail(admin, tid);
            await tasks.command(admin, tid, { command: "save", expectedRevision: task.task.revision, content: { ...taskContent, referenceFileIds: [legacyId] }, idempotencyKey: randomUUID() });
            task = await tasks.detail(admin, tid);
            await tasks.command(admin, tid, { command: "publish", expectedRevision: task.task.revision, idempotencyKey: randomUUID() });
            const binding = { ...blankFileBinding("uploader-product", uploaded.file.id), purpose: "image" as const };
            await command(pid, "save_files", { files: [binding, blankFileBinding("uploader-legacy", legacyId)], expectedContextRevision: (await detail(pid)).contextRevision });
            const raw = await repo.list("fileVersion"), productRow = raw.find(f => f.id === uploaded.file.id)!, legacyRow = raw.find(f => f.id === legacyId)!;
            let d = await detail(pid);
            expect(d.files[0].file).toMatchObject({ uploaderLabel: "브랜드 팀원", uploadedAt: productRow.createdAt });
            expect(d.files[1].file).toMatchObject({ uploaderLabel: (await repo.get("user", "user-gsg"))!.data.name, uploadedAt: legacyRow.createdAt });
            expect(d.image).toMatchObject({ uploaderLabel: "브랜드 팀원", uploadedAt: productRow.createdAt });
            expect(d.reusableFiles.find(f => f.id === legacyId)).toMatchObject({ uploaderLabel: (await repo.get("user", "user-gsg"))!.data.name, uploadedAt: legacyRow.createdAt });
            expect((await uploaded.fs.download(brand, legacyId, { kind: "product", contextId: A, productId: pid }, "original")).bytes).toEqual(png);
            await command(pid, "save_files", { files: d.files.map(f => ({ ...blankFileBinding(f.id, f.fileVersionId), title: "다른 편집자의 후속 메타 수정" })), expectedContextRevision: d.contextRevision });
            d = await detail(pid);
            expect(d.contextHistory.flatMap(h => h.files).filter(f => f.fileVersionId === uploaded.file.id).every(f => f.file.uploaderLabel === "브랜드 팀원" && f.file.uploadedAt === productRow.createdAt)).toBe(true);
            await repo.transaction(s => {
                const membership = s.list("membership", A).find(m => m.data.userId === "user-team")!;
                s.update("membership", membership.id, membership.revision, { ...membership.data, status: "suspended" });
                const user = s.get("user", "user-gsg")!;
                s.update("user", user.id, user.revision, { ...user.data, status: "suspended" });
            });
            d = await detail(pid);
            expect(d.files.every(f => f.file.uploaderLabel === "이전 업로더")).toBe(true);
            expect(d.contextHistory.flatMap(h => h.files).every(f => f.file.uploaderLabel === "이전 업로더")).toBe(true);
            expect(d.reusableFiles.filter(f => [uploaded.file.id, legacyId].includes(f.id)).every(f => f.uploaderLabel === "이전 업로더")).toBe(true);
            expect(d.files[0].file.uploadedAt).toBe(productRow.createdAt);
            for (const key of ["uploaderId", "email", "user", "membership", "storageKey"]) expect(Object.hasOwn(d.files[0].file, key)).toBe(false);
            expect(await repo.list("fileVersion")).toEqual(raw);
            await expect(detail(pid, A, team)).rejects.toMatchObject({ status: 404 });
        });
        it("D09 initial prior-use fixture keeps exact old common/context/price/file hashes after current update; future price requires explicit date", async () => {
            await setup();
            const pid = await create(), u = await upload(pid);
            await command(pid, "save_files", { files: [blankFileBinding("capture", u.file.id)], expectedContextRevision: (await detail(pid)).contextRevision });
            await command(pid, "save_retail", { price: { ...blankRetailPrice(), amount: "100", currency: "JPY", effectiveFrom: "2026-09-01", effectiveTo: "2026-09-30" }, expectedPriceRevision: 0 });
            const d = await detail(pid);
            const input = { contextId: A, productId: pid, expectedCommonRevision: d.commonRevision, expectedContextRevision: d.contextRevision, bindingIds: ["capture"], retailPriceVersionId: d.retail.current!.id, asOfDate: "2026-09-21", ownerType: "prior_use_fixture" as const, ownerId: "initial-use-fixture", taskId: null, requestId: null };
            const snap = await repo.transaction(s => captureProductUse(s, identity.principal(s, brand), input, () => NOW));
            await expect(repo.transaction(s => captureProductUse(s, identity.principal(s, brand), { ...input, asOfDate: "2027-01-01" }, () => NOW))).rejects.toMatchObject({ status: 422 });
            await command(pid, "save_common", { common: { ...d.common, name: "새 현재 이름" }, expectedCommonRevision: d.commonRevision });
            await command(pid, "save_context", { fields: { ...d.local, sku: "NEW" }, expectedContextRevision: d.contextRevision });
            await command(pid, "save_retail", { price: { ...blankRetailPrice(), amount: "200", currency: "JPY", effectiveFrom: "2027-01-01" }, expectedPriceRevision: d.retail.revision });
            expect(await repo.get("productUseSnapshot", snap.id)).toEqual(snap);
            const read = await repo.transaction(s => readProductUse(s, identity.principal(s, brand), snap.id, () => NOW));
            expect(read.common.name).toBe(d.common.name);
            expect(read.retailPrice!.amount).toBe("100");
            expect(read.files[0].sha256).toBe(u.file.sha256);
            expect(read.contentHash).toBe(snap.data.contentHash);
            expect(read).not.toHaveProperty("internalPriceVersionId");
            expect((await detail(pid)).uses[0]).toMatchObject({ id: snap.id, producer: "prior_use_fixture", contentHash: snap.data.contentHash });
            await expect(repo.transaction(s => s.update("productUseSnapshot", snap.id, snap.revision, snap.data))).rejects.toMatchObject({ code: "INVALID_RECORD" });
        });
        it("G04 bridge retains Product IDs, actual task link CAS and product file public request access", async () => {
            await setup();
            const pid = await create(), u = await upload(pid), tasks = new TaskService(identity);
            const content = { ...blankContent(), title: "상품 연결 업무", description: "합성 제품 참고파일 요청", requirements: [{ ...blankRequirement("description"), label: "설명" }], referenceFileIds: [u.file.id], deadline: { ...blankContent().deadline, responsibleUserId: "user-gsg" } };
            const tid = (await tasks.create(admin, { targets: [{ contextId: A, ownerId: "user-gsg", assigneeId: "user-luna", coAssigneeIds: [], productIds: [pid] }], content, category: "spot", idempotencyKey: randomUUID() })).ids[0];
            await tasks.command(admin, tid, { command: "publish", expectedRevision: (await repo.get("task", tid))!.revision, idempotencyKey: randomUUID() });
            expect((await tasks.detail(brand, tid)).task.data.productIds).toEqual([pid]);
            expect((await u.fs.download(brand, u.file.id, tid, "original")).bytes).toEqual(png);
            const second = await create();
            await expect(command(second, "link_task", { taskId: tid, expectedTaskRevision: (await repo.get("task", tid))!.revision })).rejects.toMatchObject({ status: 403 });
            await command(second, "link_task", { taskId: tid, expectedTaskRevision: (await repo.get("task", tid))!.revision }, A, admin);
            expect((await repo.get("task", tid))!.data.productIds).toEqual([pid, second]);
            expect((await tasks.catalog(brand, A)).products.map(p => p.id)).toContain("product-serum");
            expect((await repo.get("task", "task-onboarding"))!.data.productIds).toEqual(["product-serum"]);
            const current = await detail(pid);
            await command(pid, "archive", { expectedCommonRevision: current.commonRevision });
            expect((await detail(pid)).linkedTasks.map(t => t.id)).toContain(tid);
            expect((await detail(pid)).files).toHaveLength(0);
            expect((await u.fs.download(brand, u.file.id, tid, "original")).bytes).toEqual(png);
        });
        it("SA28 file IO failure removes staged bytes and metadata; stored nested canaries never enter recursive DTOs", async () => {
            await setup();
            const pid = await create();
            const dir = await mkdtemp(path.join(os.tmpdir(), "gs-hale-g06-fault-"));
            directories.push(dir);
            await expect(new FileService(identity, dir, () => { throw new Error("file fault"); }).upload(brand, { kind: "product", contextId: A, productId: pid }, [uploadFile], "public")).rejects.toThrow("file fault");
            expect(await readdir(dir)).toEqual([]);
            expect(await repo.list("fileVersion")).toHaveLength(0);
            await repo.transaction(s => { const p = s.get("product", pid)!, old = s.get("productVersion", p.data.currentVersionId!)!; const v = s.create("productVersion", { id: randomUUID(), contextId: null, data: { ...old.data, sequence: old.data.sequence + 1, previousId: old.id, common: { ...old.data.common, unknown: "G06_CANARY", capacity: { ...old.data.common.capacity, secret: "G06_CANARY" }, localNames: [{ language: "ko", name: "공개", secret: "G06_CANARY" }] } as unknown as typeof old.data.common } }); s.update("product", p.id, p.revision, { ...p.data, currentVersionId: v.id }); });
            for (const actor of [brand, admin]) {
                expect(JSON.stringify(await detail(pid, A, actor))).not.toContain("G06_CANARY");
                expect(JSON.stringify(await products.list(actor))).not.toContain("G06_CANARY");
            }
            expect((await products.list(brand, { q: "G06_CANARY" })).total).toBe(0);
            await expect(detail(pid, A, foreign)).rejects.toMatchObject({ status: 404 });
        });
    });
