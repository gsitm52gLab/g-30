import type { RecordKind, StoredRecord } from "@/domain/records";
import type { Deadline, RequestContent, Requirement, CampaignRequestSource } from "@/domain/tasks/types";
import { requirementTypes } from "@/domain/tasks/types";
import type { evaluateRequirements } from "@/domain/tasks/evaluate";

const text = (value: unknown) => typeof value === "string" ? value : "";
const nullableText = (value: unknown) => typeof value === "string" ? value : null;
const number = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : 0;
export const stringList = (value: unknown): string[] => Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
const objects = <T>(value: readonly T[] | undefined): T[] => Array.isArray(value) ? value.filter(v => v !== null && typeof v === "object" && !Array.isArray(v)) : [];
function option<T extends string>(value: unknown, choices: readonly T[], fallback: T): T { return typeof value === "string" && choices.includes(value as T) ? value as T : fallback; }
export function recordMetadata<K extends RecordKind>(row: StoredRecord<K>) {
    return { kind: row.kind, id: text(row.id), contextId: nullableText(row.contextId), revision: number(row.revision), createdAt: text(row.createdAt), updatedAt: text(row.updatedAt) };
}
export function projectedDeadline(d: Deadline): Deadline {
    return { value: nullableText(d.value), precision: option(d.precision,["date","datetime"],"date"), timezone: text(d.timezone),
        certainty: option(d.certainty,["confirmed","requested","expected","needs_confirmation"],"needs_confirmation"),
        source: text(d.source), sourceVersion: text(d.sourceVersion), responsibleUserId: text(d.responsibleUserId), raw: text(d.raw) };
}
function requirement(q: Requirement): Requirement {
    return { key:text(q.key), label:text(q.label), type:option(q.type,requirementTypes,"long_text"), required:q.required===true,
        help:text(q.help), unit:text(q.unit), options:stringList(q.options), productIds:stringList(q.productIds),
        condition:q.condition ? {key:text(q.condition.key),equals:text(q.condition.equals)} : null,
        specifications:objects(q.specifications).map(s=>({text:text(s.text),source:text(s.source),version:text(s.version),
            severity:option(s.severity,["required","recommended"],"required"),check:option(s.check,["auto","human"],"human")})) };
}
export type PublicRequestContent = Omit<RequestContent,"internalOriginal"|"internalMemo">;
export function projectedRequest(c: RequestContent, internal: true, fileIds: string[]): RequestContent;
export function projectedRequest(c: RequestContent, internal: false, fileIds: string[]): PublicRequestContent;
export function projectedRequest(c: RequestContent, internal: boolean, fileIds: string[]): PublicRequestContent & Partial<Pick<RequestContent,"internalOriginal"|"internalMemo">>;
export function projectedRequest(c: RequestContent, internal: boolean, fileIds: string[]) {
    const publicContent: PublicRequestContent = { title:text(c.title),description:text(c.description),purpose:text(c.purpose),output:text(c.output),
        productionResponsibility:text(c.productionResponsibility),subtitleResponsibility:text(c.subtitleResponsibility),originalResponsibility:text(c.originalResponsibility),usePlace:text(c.usePlace),nextAction:text(c.nextAction),
        deadline:projectedDeadline(c.deadline),requirements:objects(c.requirements).map(requirement),referenceFileIds:stringList(fileIds),
        milestones:objects(c.milestones).filter(m=>internal||m.visibility==="public").map(m=>({id:text(m.id),kind:option(m.kind,["application","review","printing_delivery","publication_use"],"review"),deadline:projectedDeadline(m.deadline),counterpart:text(m.counterpart),visibility:option(m.visibility,["public","internal"],"internal")})),
        links:objects(c.links).map(l=>({url:text(l.url),description:text(l.description),contentFixed:false})) };
    // Spreading a freshly constructed safe DTO is intentional; no stored payload is spread.
    return internal ? {...publicContent,internalOriginal:text(c.internalOriginal),internalMemo:text(c.internalMemo)} : publicContent;
}
export function projectedVersion(row: StoredRecord<"requestVersion">, content: ReturnType<typeof projectedRequest>, source:CampaignRequestSource|null=null) {
    const v=row.data;return {id:text(row.id),sequence:number(v.sequence),publishedBy:text(v.publishedBy),publishedAt:text(v.publishedAt),changedKeys:stringList(v.changedKeys),content,source};
}
export function projectedActivity(row: StoredRecord<"taskActivity">) {
    const a=row.data;
    return {...recordMetadata(row),data:{taskId:text(a.taskId),requestId:text(a.requestId),userId:text(a.userId),kind:option(a.kind,["read","accept","schedule","schedule_resolved"],"read"),at:text(a.at),sequence:number(a.sequence),reason:text(a.reason),
        proposedDeadline:a.proposedDeadline?projectedDeadline(a.proposedDeadline):null,respondsTo:nullableText(a.respondsTo),decision:a.decision==="apply"||a.decision==="keep"?a.decision:null,resultingRequestId:nullableText(a.resultingRequestId)}};
}
export function projectedTemplate(row: StoredRecord<"templateVersion">, content: RequestContent) {
    const t=row.data;
    return {id:text(row.id),templateId:text(t.templateId),name:text(t.name),sequence:number(t.sequence),previousId:nullableText(t.previousId),content,createdBy:text(t.createdBy),builtin:t.builtin===true};
}
export function projectedProject(row: StoredRecord<"project">, visible: Set<string>) {
    const d=row.data;
    return {...recordMetadata(row),data:{title:text(d.title),status:option(d.status,["active","completed"],"active"),createdBy:text(d.createdBy),taskIds:stringList(d.taskIds).filter(id=>visible.has(id)),dependencies:objects(d.dependencies).filter(e=>visible.has(e.before)&&visible.has(e.after)).map(e=>({before:text(e.before),after:text(e.after)}))}};
}
export function projectedRequirementStatus(r: ReturnType<typeof evaluateRequirements>[number]) {
    return {requirementKey:text(r.requirementKey),productId:nullableText(r.productId),label:text(r.label),status:option(r.status === "invalid" ? "needs_reconfirmation" : r.status === "received" ? "prior_received" : r.status,["not_applicable","needs_reconfirmation","prior_received","missing","optional"],"missing"),humanReviewPending:r.humanReviewPending===true,sourceRequestId:nullableText(r.sourceRequestId)};
}
