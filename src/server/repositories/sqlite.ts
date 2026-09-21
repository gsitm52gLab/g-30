import { checkRelations } from "@/domain/constraints";
import type Database from "better-sqlite3";
import { assertSynchronous, checkInput, jsonCopy, StoreError, systemClock, type Clock, type RecordDataMap, type RecordInput, type RecordKind, type RecordRepository, type StoredRecord, type UnitOfWork } from "@/domain/records";
interface Row {
    kind: RecordKind;
    id: string;
    context_id: string | null;
    data: string;
    revision: number;
    created_at: string;
    updated_at: string;
}
function decode<K extends RecordKind>(row: Row): StoredRecord<K> { return { kind: row.kind as K, id: row.id, contextId: row.context_id, data: JSON.parse(row.data), revision: row.revision, createdAt: row.created_at, updatedAt: row.updated_at }; }
export function createSqliteRepository(db: Database.Database, clock: Clock = systemClock): RecordRepository {
    try {
        db.prepare("SELECT id FROM records LIMIT 1").get();
    }
    catch {
        db.close();
        throw new StoreError("STORAGE_UNAVAILABLE");
    }
    const uow: UnitOfWork = {
        get<K extends RecordKind>(kind: K, id: string) { const row = db.prepare("SELECT * FROM records WHERE kind = ? AND id = ?").get(kind, id) as Row | undefined; return row ? decode<K>(row) : null; },
        list<K extends RecordKind>(kind: K, contextId?: string) {
            const rows = contextId === undefined ? db.prepare("SELECT * FROM records WHERE kind = ? ORDER BY id").all(kind) : db.prepare("SELECT * FROM records WHERE kind = ? AND context_id = ? ORDER BY id").all(kind, contextId);
            return (rows as Row[]).map(r => decode<K>(r));
        },
        create<K extends RecordKind>(kind: K, input: RecordInput<K>) {
            checkInput(input);
            checkRelations(uow, kind, input);
            const data = jsonCopy(input.data);
            const now = clock();
            const result = db.prepare("INSERT INTO records(kind,id,context_id,data,revision,created_at,updated_at) VALUES(?,?,?,?,1,?,?) ON CONFLICT(kind,id) DO NOTHING").run(kind, input.id, input.contextId, JSON.stringify(data), now, now);
            if (!result.changes)
                throw new StoreError("CONFLICT");
            return { kind, ...input, data, revision: 1, createdAt: now, updatedAt: now };
        },
        update<K extends RecordKind>(kind: K, id: string, expectedRevision: number, data: RecordDataMap[K]) {
            const old = uow.get(kind, id);
            if (!old)
                throw new StoreError("NOT_FOUND");
            checkInput({ id, contextId: old.contextId, data });
            checkRelations(uow, kind, { id, contextId: old.contextId, data });
            const copy = jsonCopy(data);
            const now = clock();
            const result = db.prepare("UPDATE records SET data = ?, revision = revision + 1, updated_at = ? WHERE kind = ? AND id = ? AND revision = ?").run(JSON.stringify(copy), now, kind, id, expectedRevision);
            if (!result.changes)
                throw new StoreError("CONFLICT");
            return { ...old, data: copy, revision: old.revision + 1, updatedAt: now };
        },
    };
    return { mode: "sqlite", get: async (kind, id) => uow.get(kind, id), list: async (kind, contextId) => uow.list(kind, contextId),
        async transaction<T>(operation: (store: UnitOfWork) => T): Promise<T> {
            return db.transaction(() => {
                let active = true;
                const guarded = new Proxy(uow, { get(target, prop: keyof UnitOfWork) { return (...args: unknown[]) => { if (!active)
                        throw new StoreError("ASYNC_TRANSACTION"); return Reflect.apply(target[prop], target, args); }; } });
                try {
                    return assertSynchronous(operation(guarded));
                }
                finally {
                    active = false;
                }
            }).immediate();
        }, close() { db.close(); },
    };
}
