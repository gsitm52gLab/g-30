import { StoreError, type UnitOfWork, type RecordKind, type RecordInput } from "../records";
export function taskRelations<K extends RecordKind>(s: UnitOfWork, kind: K, input: RecordInput<K>) {
    const immutable: RecordKind[] = ["requestVersion", "templateVersion", "taskActivity", "priorSubmission", "domainEvent", "commandReceipt", "fileVersion"];
    if (immutable.includes(kind) && s.get(kind, input.id)) throw new StoreError("INVALID_RECORD");
    if (["requestVersion", "taskActivity", "priorSubmission"].includes(kind)) {
        const d = input.data as { taskId: string };
        const task = s.get("task", d.taskId);
        if (!task || task.contextId !== input.contextId) throw new StoreError("INVALID_RECORD");
    }
    if (kind === "fileVersion") {
        const d = input.data as import("./types").FileVersionData;
        if (d.submissionUpload && (!d.taskId || s.get("requestVersion", d.submissionUpload.requestId)?.data.taskId !== d.taskId)) throw new StoreError("INVALID_RECORD");
        if (d.submissionUpload && s.list("fileVersion").some(f => f.id !== input.id && f.data.submissionUpload?.key === d.submissionUpload!.key)) throw new StoreError("CONFLICT");
        if (d.owner?.kind === "notice") {
            if (d.taskId !== null || d.submissionUpload || s.get("notice",d.owner.noticeId)?.contextId !== input.contextId) throw new StoreError("INVALID_RECORD");
        } else if (d.owner?.kind === "product") {
            const cp = s.get("contextProduct", d.owner.contextProductId);
            if (d.taskId !== null || !cp || cp.contextId !== input.contextId || cp.data.productId !== d.owner.productId) throw new StoreError("INVALID_RECORD");
        } else {
            const task = d.taskId ? s.get("task", d.taskId) : null;
            if (!task || task.contextId !== input.contextId || d.owner && (d.owner.kind !== "task" || d.owner.taskId !== d.taskId)) throw new StoreError("INVALID_RECORD");
        }
    }
    if (kind === "requestVersion") {
        const d = input.data as import("./types").RequestVersionData;
        if (s.list("requestVersion").some(r => r.data.taskId === d.taskId && r.data.sequence === d.sequence)) throw new StoreError("CONFLICT");
        if (d.previousId && s.get("requestVersion", d.previousId)?.data.taskId !== d.taskId) throw new StoreError("INVALID_RECORD");
        if(d.source){const x=d.source,v=s.get('campaignVersion',x.campaignVersionId),base=s.get('requestVersion',x.originalRequestId),selection=x.selectionVersionId?s.get('campaignSelection',x.selectionVersionId):null,fact=x.sourceFactId?s.get('campaignExternalFact',x.sourceFactId):null;
            if(x.kind!=='campaign_selection'||!v||v.contextId!==input.contextId||v.data.taskId!==d.taskId||v.data.campaignId!==x.campaignId||v.data.requestId!==base?.id||base.data.taskId!==d.taskId||d.publishedBy!==x.actorId||!s.get('user',x.actorId)||x.noMaterials!==(d.content.requirements.length===0)||x.selectionVersionId&&selection?.data.campaignVersionId!==v.id||x.sourceFactId&&fact?.data.campaignVersionId!==v.id)throw new StoreError('INVALID_RECORD');
        }
    }
    if (kind === "templateVersion") {
        const d = input.data as import("./types").TemplateVersionData;
        if (s.list("templateVersion").some(r => r.contextId === input.contextId && r.data.templateId === d.templateId && r.data.sequence === d.sequence)) throw new StoreError("CONFLICT");
    }
    if (kind === "taskActivity" || kind === "priorSubmission") {
        const d = input.data as { taskId: string; requestId: string };
        if (s.get("requestVersion", d.requestId)?.data.taskId !== d.taskId) throw new StoreError("INVALID_RECORD");
    }
    if (kind === "task") {
        const d = input.data as import("../records").TaskData;
        if (d.resumeStatus != null && (!["requested", "in_progress", "partial", "submitted"].includes(d.resumeStatus) || !["on_hold", "cancelled"].includes(d.status))) throw new StoreError("INVALID_RECORD");
        if (d.schemaVersion === 2 && (d.projectId && s.get("project", d.projectId)?.contextId !== input.contextId || d.currentRequestId && s.get("requestVersion", d.currentRequestId)?.data.taskId !== input.id)) throw new StoreError("INVALID_RECORD");
    }
    if (kind === "commandReceipt") {
        const d = input.data as { key: string };
        if (s.list("commandReceipt").some(r => r.data.key === d.key && r.id !== input.id)) throw new StoreError("CONFLICT");
    }
}
