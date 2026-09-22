// Explicit asynchronous counterpart of src/domain/ai-input/constraints.ts; source hash tracked in source-map.json.
import type { AsyncUnitOfWork as UnitOfWork } from '../types';
import { StoreError, type RecordKind, type RecordInput } from "@/domain/records";
const immutable: RecordKind[] = ['aiAsset', 'aiVersion', 'aiSnapshot'];
export async function aiRelations<K extends RecordKind>(s: UnitOfWork, kind: K, input: RecordInput<K>) {
    if (!['aiInput', 'aiRun', ...immutable].includes(kind))
        return;
    const bad = () => { throw new StoreError('INVALID_RECORD'); };
    const d = input.data as unknown as Record<string, unknown>;
    if (!input.contextId || !(await s.get('context', input.contextId)))
        bad();
    if (immutable.includes(kind) && (await s.get(kind, input.id)))
        bad();
    if (kind === 'aiInput' || kind === 'aiAsset') {
        if (!(await s.get('user', String(d.createdBy))) || !['context', 'staff'].includes(String(d.visibility)))
            bad();
        return;
    }
    if ((await s.get('aiInput', String(d.inputId)))?.contextId !== input.contextId)
        bad();
    if (kind === 'aiVersion') {
        if (!(await s.get('user', String(d.createdBy))) || !Number.isSafeInteger(d.sequence) || Number(d.sequence) < 1)
            bad();
        if ((await s.list('aiVersion', input.contextId!)).some(r => r.data.inputId === d.inputId && r.data.sequence === d.sequence))
            throw new StoreError('CONFLICT');
        if (d.previousId !== null && (await s.get('aiVersion', String(d.previousId)))?.data.inputId !== d.inputId)
            bad();
    }
    if (kind === 'aiRun' || kind === 'aiSnapshot') {
        if ((await s.get('aiVersion', String(d.versionId)))?.data.inputId !== d.inputId)
            bad();
    }
    if (kind === 'aiRun') {
        if (!['queued', 'reading', 'finished', 'unread', 'rejected', 'out_of_scope', 'failed'].includes(String(d.state)))
            bad();
        if ((await s.list('aiRun', input.contextId!)).some(r => r.id !== input.id && r.data.versionId === d.versionId && r.data.attempt === d.attempt))
            throw new StoreError('CONFLICT');
    }
    if (kind === 'aiSnapshot' && (await s.get('aiRun', String(d.runId)))?.data.versionId !== d.versionId)
        bad();
}
