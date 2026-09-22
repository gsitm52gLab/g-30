import { checkRelations } from "@/domain/constraints";
import { assertSynchronous, updatedContext, checkInput, jsonCopy, StoreError, systemClock, type Clock, type RecordDataMap, type RecordInput, type RecordKind, type RecordRepository, type StoredRecord, type UnitOfWork } from "@/domain/records";
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
    return { mode: "mock", get: async (kind, id) => store.get(kind, id), list: async (kind, contextId) => store.list(kind, contextId),
        async transaction<T>(operation: (uow: UnitOfWork) => T): Promise<T> {
            const before = new Map(records);
            let active = true;
            const guarded = new Proxy(store, { get(target, prop: keyof UnitOfWork) { return (...args: unknown[]) => { if (!active)
                    throw new StoreError("ASYNC_TRANSACTION"); return Reflect.apply(target[prop], target, args); }; } });
            try {
                return assertSynchronous(operation(guarded));
            }
            catch (error) {
                records = before;
                throw error;
            }
            finally {
                active = false;
            }
        }, close() { records.clear(); },
    };
}
