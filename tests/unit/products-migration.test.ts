import { afterEach, describe, expect, it } from "vitest";
import { fixtures } from "@/data/fixtures";
import { migrateLegacyProducts, productMigrationDiagnostic } from "@/data/products/migrate";
import { createMockRepository } from "@/server/repositories/mock";
import { createSqliteRepository } from "@/server/repositories/sqlite";
import { migrate, openDatabase } from "@/server/db/database";
import type { RecordRepository, ProductData } from "@/domain/records";
const clock = () => "2026-09-21T00:00:00.000Z", ctx = "ctx-jp-a-luna", marker = "RAW_LEGACY_VALUE_MUST_NOT_LOG";
for (const mode of ["mock", "sqlite"] as const)
    describe(`${mode} bounded legacy migration diagnostic`, () => {
        let repo: RecordRepository;
        afterEach(() => repo?.close());
        async function setup() { if (mode === "mock")
            repo = createMockRepository(clock);
        else {
            const db = openDatabase(":memory:", true);
            migrate(db);
            repo = createSqliteRepository(db, clock);
        } await repo.transaction(s => { for (const f of fixtures)
            s.create(f.kind, f.input); }); }
        for (const [reason, data, contextId] of [
            ["missing_required_name", { name: "" }, ctx],
            ["missing_required_code", { code: "" }, ctx],
            ["missing_brand_context", {}, "unknown-legacy-context"],
            ["duplicate_context_code", { code: " demo-luna-001 " }, ctx],
        ] as const)
            it(`${reason} leaves all original rows and no partial migrated versions`, async () => {
                await setup();
                await repo.transaction(s => s.create("product", { id: "zz-invalid-legacy", contextId, data: { ...s.get("product", "product-serum")!.data, name: marker, code: "LEGACY-UNIQUE", privateRaw: marker, ...data } as ProductData }));
                const before = await repo.list("product"), tasks = await repo.list("task");
                const error = await repo.transaction(s => migrateLegacyProducts(s)).catch(e => e);
                expect(productMigrationDiagnostic(error)).toEqual({ module: "G06", productID: "zz-invalid-legacy", sourceContextID: contextId, reason });
                expect(JSON.stringify(productMigrationDiagnostic(error))).not.toContain(marker);
                expect(await repo.list("product")).toEqual(before);
                expect(await repo.list("task")).toEqual(tasks);
                expect(await repo.list("productMigration")).toEqual([]);
                expect(await repo.list("productVersion")).toEqual([]);
                expect(await repo.list("contextProduct")).toEqual([]);
                expect(await repo.list("contextProductVersion")).toEqual([]);
            });
    });
