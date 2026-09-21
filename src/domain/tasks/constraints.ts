import { StoreError, type UnitOfWork, type RecordKind, type RecordInput } from "../records";
export function taskRelations<K extends RecordKind>(s: UnitOfWork, kind: K, input: RecordInput<K>) {
    const immutable: RecordKind[] = ["requestVersion", "templateVersion", "taskActivity", "priorSubmission", "domainEvent", "commandReceipt", "fileVersion"];
    if (immutable.includes(kind) && s.get(kind, input.id)) throw new StoreError("INVALID_RECORD");
    if (["requestVersion", "taskActivity", "priorSubmission", "fileVersion"].includes(kind)) {
        const d = input.data as { taskId: string };
        const task = s.get("task", d.taskId);
        if (!task || task.contextId !== input.contextId) throw new StoreError("INVALID_RECORD");
    }
    if (kind === "commandReceipt") {
        const d = input.data as { key: string };
        if (s.list("commandReceipt").some(r => r.data.key === d.key && r.id !== input.id)) throw new StoreError("CONFLICT");
    }
}
