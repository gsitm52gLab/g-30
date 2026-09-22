import { createAsyncLocalRepository } from './async-local';
import { checkRelations } from "@/domain/constraints";
import { updatedContext, checkInput, jsonCopy, StoreError, systemClock, type Clock, type RecordDataMap, type RecordInput, type RecordKind, type RecordRepository, type StoredRecord, type SyncUnitOfWork as UnitOfWork } from "@/domain/records";
export function createMockRepository(clock: Clock = systemClock): RecordRepository {
    let records = new Map<string, StoredRecord>();
    const key = (kind: RecordKind, id: string) => `${kind}:${id}`;
    const store: UnitOfWork = {
        get<K extends RecordKind>(kind: K, id: string) { return jsonCopy((records.get(key(kind, id)) as StoredRecord<K> | undefined) ?? null); },
        list<K extends RecordKind>(kind: K, contextId?: string) {
            return jsonCopy([...records.values()].filter(r => r.kind === kind && (contextId === undefined || r.contextId === contextId)).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0) as StoredRecord<K>[]);
        },
        create<K extends RecordKind>(kind: K, input: RecordInput<K>) {
            checkInput(input);
            checkRelations(store, kind, input);
            if (records.has(key(kind, input.id)))
                throw new StoreError("CONFLICT");
            const now = clock();
            const record: StoredRecord<K> = { kind, ...jsonCopy(input), revision: 1, createdAt: now, updatedAt: now };
            records.set(key(kind, input.id), record);
            return jsonCopy(record);
        },
        update<K extends RecordKind>(kind: K, id: string, expectedRevision: number, data: RecordDataMap[K], migration?: { legacyProductContextId: string }) {
            const current = store.get(kind, id);
            if (!current)
                throw new StoreError("NOT_FOUND");
            if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1 || current.revision >= Number.MAX_SAFE_INTEGER) throw new StoreError("INVALID_RECORD");
            if (current.revision !== expectedRevision)
                throw new StoreError("CONFLICT");
            const contextId = updatedContext(current, data, migration);
            checkInput({ id, contextId, data });
            checkRelations(store, kind, { id, contextId, data });
            const record = { ...current, contextId, data: jsonCopy(data), revision: current.revision + 1, updatedAt: clock() };
            records.set(key(kind, id), record);
            return jsonCopy(record);
        },
    };
    let before = records;
    return createAsyncLocalRepository('mock', store, {
        begin() { before = new Map(records); }, commit() {}, rollback() { records = before; }, close() { records.clear(); },
    });
}
