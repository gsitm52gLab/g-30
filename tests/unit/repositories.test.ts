import { afterEach, describe, expect, it } from "vitest";
import { createMockRepository } from "@/server/repositories/mock";
import { createSqliteRepository } from "@/server/repositories/sqlite";
import { migrate, openDatabase } from "@/server/db/database";
import { seed } from "@/server/db/seed";
import { fixtures } from "@/data/fixtures";
import { builtins } from "@/domain/tasks/templates";
import { StoreError, type RecordRepository, type UnitOfWork } from "@/domain/records";
const clock = () => "2026-09-21T01:00:00.000Z";
for (const mode of ["mock", "sqlite"] as const) {
    describe(`${mode} shared repository contract`, () => {
        let repository: RecordRepository;
        function create() { if (mode === "mock")
            repository = createMockRepository(clock);
        else {
            const db = openDatabase(":memory:", true);
            migrate(db);
            repository = createSqliteRepository(db, clock);
        } return repository; }
        afterEach(() => repository?.close());
        it("round-trips typed records and context filters with immutable copies", async () => {
            const repo = create();
            const record = await repo.transaction(s => s.create("checkpoint", { id: "one", contextId: "context-a", data: { value: "first" } }));
            record.data.value = "mutated outside";
            expect((await repo.get("checkpoint", "one"))?.data.value).toBe("first");
            expect(await repo.list("checkpoint", "context-b")).toEqual([]);
            expect(await repo.list("checkpoint", "context-a")).toHaveLength(1);
            expect((await repo.get("checkpoint", "one"))?.createdAt).toBe(clock());
        });
        it("rejects duplicates and stale revisions", async () => {
            const repo = create();
            const input = { id: "one", contextId: null, data: { value: "initial" } };
            await repo.transaction(s => s.create("checkpoint", input));
            await expect(repo.transaction(s => s.create("checkpoint", input))).rejects.toMatchObject({ code: "CONFLICT" });
            await repo.transaction(s => s.update("checkpoint", "one", 1, { value: "updated" }));
            await expect(repo.transaction(s => s.update("checkpoint", "one", 1, { value: "stale" }))).rejects.toMatchObject({ code: "CONFLICT" });
            expect((await repo.get("checkpoint", "one"))?.revision).toBe(2);
            expect((await repo.get("checkpoint", "one"))?.data.value).toBe("updated");
        });
        it("rolls back every write when an operation fails", async () => {
            const repo = create();
            await expect(repo.transaction(s => { s.create("checkpoint", { id: "one", contextId: null, data: { value: "should rollback" } }); throw new Error("synthetic failure"); })).rejects.toThrow("synthetic failure");
            expect(await repo.get("checkpoint", "one")).toBeNull();
        });
        it("rejects async transaction callbacks and blocks escaped writes", async () => {
            const repo = create();
            let escaped: UnitOfWork | undefined;
            await expect(repo.transaction(async (s) => { escaped = s; s.create("checkpoint", { id: "before-await", contextId: null, data: { value: "rollback" } }); await Promise.resolve(); s.create("checkpoint", { id: "after-await", contextId: null, data: { value: "must reject" } }); })).rejects.toMatchObject({ code: "ASYNC_TRANSACTION" });
            await Promise.resolve();
            expect(await repo.list("checkpoint")).toEqual([]);
            expect(() => escaped?.get("checkpoint", "one")).toThrow(StoreError);
        });
        it("seeds idempotently and preserves existing edits and extra records", async () => {
            const repo = create();
            expect((await seed(repo)).inserted).toBe(fixtures.length + builtins.length);
            await repo.transaction(s => { const task = s.get("task", "task-pop")!; s.update("task", task.id, task.revision, { ...task.data, title: "User edited title" }); s.create("checkpoint", { id: "extra", contextId: null, data: { value: "keep" } }); });
            expect(await seed(repo)).toEqual({ inserted: 0, preserved: fixtures.length + builtins.length, products: { migrated: 0 } });
            expect((await repo.get("task", "task-pop"))?.data.title).toBe("User edited title");
            expect(await repo.get("checkpoint", "extra")).not.toBeNull();
        });
        it("has explicit empty and invalid-record behavior", async () => {
            const repo = create();
            expect(await repo.list("task")).toEqual([]);
            expect(await repo.get("task", "unknown")).toBeNull();
            await expect(repo.transaction(s => s.create("checkpoint", { id: "", contextId: null, data: { value: "invalid" } }))).rejects.toMatchObject({ code: "INVALID_RECORD" });
            await expect(repo.transaction(s => s.update("checkpoint", "missing", 1, { value: "no" }))).rejects.toMatchObject({ code: "NOT_FOUND" });
        });
    });
}
describe("migration and persistence setup", () => {
    it("migrates an empty DB twice without losing writes", () => {
        const db = openDatabase(":memory:", true);
        try {
            expect(migrate(db)).toEqual({ applied: 10, total: 10 });
            db.prepare("INSERT INTO records VALUES ('checkpoint','preserved',NULL,'{}',1,'now','now')").run();
            expect(migrate(db)).toEqual({ applied: 0, total: 10 });
            expect(db.prepare("SELECT id FROM records").all()).toEqual([{ id: "preserved" }]);
        }
        finally {
            db.close();
        }
    });
    it("reports missing DB and missing migration as unavailable, never mock", () => {
        expect(() => openDatabase(`/this-path-is-not-created-by-tests/missing-${process.pid}.db`)).toThrow(StoreError);
        expect(() => createSqliteRepository(openDatabase(":memory:", true))).toThrow(StoreError);
    });
    it("gives mock and SQLite the exact same seeded domain shape", async () => {
        const mock = createMockRepository(clock);
        const db = openDatabase(":memory:", true);
        migrate(db);
        const sqlite = createSqliteRepository(db, clock);
        try {
            await seed(mock);
            await seed(sqlite);
            for (const kind of ["context", "user", "task", "product"] as const)
                expect(await sqlite.list(kind)).toEqual(await mock.list(kind));
        }
        finally {
            mock.close();
            sqlite.close();
        }
    });
});
