import { StoreError, type RecordKind, type RecordInput, type SyncUnitOfWork as UnitOfWork } from '../records';
export function correctionRelations<K extends RecordKind>(s: UnitOfWork, kind: K, input: RecordInput<K>) {
    if (!kind.startsWith('correction')) return;
    const d = input.data as unknown as Record<string, unknown>;
    const existing=s.get(kind,input.id);
    if(kind==='correctionDraft'&&s.get('correctionDraft',input.id)?.data.publishedVersionId)throw new StoreError('INVALID_RECORD');
    if(existing&&'taskId' in existing.data&&'taskId' in d&&existing.data.taskId!==d.taskId)throw new StoreError('INVALID_RECORD');
    const immutable = ['correctionOpinionVersion','correctionBatch','correctionReflection','correctionResolution','correctionReview'].includes(kind);
    if (immutable && s.get(kind,input.id)) throw new StoreError('INVALID_RECORD');
    const taskId = kind === 'correctionOpinionVersion' ? (d.target as {taskId:string})?.taskId : d.taskId;
    if (typeof taskId !== 'string' || s.get('task',taskId)?.contextId !== input.contextId) throw new StoreError('INVALID_RECORD');
    const match = (k:RecordKind,id:unknown) => typeof id === 'string' && s.get(k,id)?.contextId === input.contextId;
    if (kind === 'correctionOpinionVersion' && !match('correctionOpinion',d.opinionId) || kind === 'correctionBatch' && !match('correctionDraft',d.draftId)) throw new StoreError('INVALID_RECORD');
    if (['correctionItemState','correctionReflection','correctionResolution'].includes(kind)) {
        if (!match('correctionBatch',d.batchVersionId)) throw new StoreError('INVALID_RECORD');
        const b=s.get('correctionBatch',d.batchVersionId as string)!;
        if(b.data.taskId!==taskId||!b.data.items.some(i=>i.key===d.itemKey))throw new StoreError('INVALID_RECORD');
    }
    if (kind==='correctionOpinionVersion' && s.list('correctionOpinionVersion').some(r=>r.id!==input.id&&r.data.opinionId===d.opinionId&&r.data.sequence===d.sequence) || kind==='correctionBatch'&&s.list('correctionBatch').some(r=>r.id!==input.id&&(r.data.taskId===taskId&&r.data.sequence===d.sequence||r.data.draftId===d.draftId)) || kind==='correctionItemState'&&s.list('correctionItemState').some(r=>r.id!==input.id&&r.data.batchVersionId===d.batchVersionId&&r.data.itemKey===d.itemKey)) throw new StoreError('CONFLICT');
}
