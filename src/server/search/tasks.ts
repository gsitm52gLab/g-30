import { asyncFlatMap } from "@/domain/async-collections";
import type { SearchDocument, SearchFile } from '@/domain/search/types';
import type { RequestContent } from '@/domain/tasks/types';
import { authorize, decide } from '@/server/policy/policy';
import { taskScope } from '@/server/policy/projection';
import { projectedRequest, projectedProject } from '@/server/tasks/projection';
import { canReferenceFile } from '@/server/files/access';
import { fileUrls } from '@/server/files/service';
import { document, field, fields, strings, text, number, visible, url, type SearchAccess } from './safe';
const requestLabels = { title: '제목', description: '요청 내용', purpose: '목적', output: '결과물', nextAction: '다음 할 일', productionResponsibility: '제작 책임', subtitleResponsibility: '자막 책임', originalResponsibility: '원본 책임', usePlace: '사용처' };
export async function taskFiles(a: SearchAccess, taskId: string, ids: string[]): Promise<SearchFile[]> {
    const t = (await a.s.get('task', taskId))!;
    return (await asyncFlatMap(ids, async (id) => {
        const f = (await a.s.get('fileVersion', id));
        if (!f)
            return [];
        const allowed = (await visible(async () => (await canReferenceFile(a.s, a.p, f, taskScope(t), a.clock))));
        if (!allowed)
            return [];
        return [{ id: f.id, name: text(f.data.originalName, 240), ...fileUrls(f, taskId) }];
    }));
}
function contentFields(c: RequestContent, internal: boolean) {
    const out = fields(c as unknown as Record<string, unknown>, requestLabels);
    if (internal)
        out.push(...fields(c as unknown as Record<string, unknown>, { internalOriginal: '내부 원문', internalMemo: '내부 메모' }));
    for (const r of c.requirements) {
        out.push(field('요청 항목', r.label), field('항목 설명', r.help));
        for (const spec of r.specifications)
            out.push(field('규격', spec.text), field('규격 출처', spec.source));
    }
    out.push(field('기한', c.deadline.value), field('기한 원문', c.deadline.raw));
    return out;
}
export async function taskDocuments(a: SearchAccess): Promise<SearchDocument[]> {
    const { s, p, clock, contextId } = a, docs: SearchDocument[] = [];
    for (const t of (await s.list('task', contextId))) {
        if (!(await decide(s, p, 'task.read', taskScope(t), clock)).allowed)
            continue;
        const internal = p.user.data.role === 'gsg', link = url(`/tasks/${t.id}`, contextId), v = t.data.currentRequestId ? (await s.get('requestVersion', t.data.currentRequestId)) : null;
        const current = v ? projectedRequest(v.data.content, internal, []) : null;
        if (v)
            contentFields(v.data.content, internal); // validate known original scalar fields before projection/matching
        const vals = current ? contentFields(current as RequestContent, internal) : [field('내용', t.data.description), field('다음 할 일', t.data.nextAction), ...strings(t.data.notes).map(n => field('공개 메모', n))];
        const fs = v ? (await taskFiles(a, t.id, strings(v.data.content.referenceFileIds))) : [];
        docs.push((await document(a, 'task', t, t.id, t.data.title, [...vals, ...fs.map(f => field('파일명', f.name))], link, { current: true, status: t.data.status, at: v?.data.publishedAt ?? t.createdAt, actor: v?.data.publishedBy ?? t.data.authorId, productIds: t.data.productIds, taskId: t.id, files: fs })));
        for (const r of (await s.list('requestVersion', contextId)).filter(r => r.data.taskId === t.id)) {
            number(r.data.sequence);
            const vals = contentFields(r.data.content, internal), safe = projectedRequest(r.data.content, internal, []), fs = (await taskFiles(a, t.id, strings(r.data.content.referenceFileIds)));
            void vals;
            docs.push((await document(a, 'task', r, t.id, safe.title, [...contentFields(safe as RequestContent, internal), ...fs.map(f => field('파일명', f.name))], link, { current: false, version: r.data.sequence, at: r.data.publishedAt, actor: r.data.publishedBy, taskId: t.id, files: fs, productIds: [...new Set(r.data.content.requirements.flatMap(q => strings(q.productIds)))] })));
        }
    }
    const tasks = new Set(docs.filter(d => d.sourceKind === 'task').map(d => d.sourceId));
    for (const r of (await s.list('taskActivity', contextId))) {
        if (!tasks.has(r.data.taskId))
            continue;
        const request = (await s.get('requestVersion', r.data.requestId));
        if (!request || request.data.taskId !== r.data.taskId)
            continue;
        docs.push((await document(a, 'task', r, r.data.taskId, request.data.content.title, [field('활동', r.data.kind), field('사유', r.data.reason), field('결정', r.data.decision), field('제안 기한', r.data.proposedDeadline?.value), field('원 요청 버전', r.data.requestId), field('반영 요청 버전', r.data.resultingRequestId)], url(`/tasks/${r.data.taskId}`, contextId), { current: false, version: r.data.sequence, at: r.data.at, actor: r.data.userId, taskId: r.data.taskId, status: r.data.kind, statusPrecision: 'historical' })));
    }
    for (const r of (await s.list('project', contextId))) {
        if (p.user.data.role !== 'gsg' && !r.data.taskIds.some(id => tasks.has(id)))
            continue;
        const d = projectedProject(r, tasks);
        docs.push((await document(a, 'project', r, r.id, text(r.data.title), [field('프로젝트', d.data.title)], url(`/projects/${r.id}`, contextId), { current: true, status: d.data.status, at: r.createdAt, actor: r.data.createdBy })));
    }
    if (p.user.data.role === 'gsg') {
        (await authorize(s, p, 'task.manage', { kind: 'task', id: contextId, contextId, visibility: 'public' }, clock));
        for (const r of (await s.list('templateVersion', contextId))) {
            docs.push((await document(a, 'template', r, r.data.templateId, r.data.name, contentFields(r.data.content, true), url('/tasks', contextId), { current: !(await s.list('templateVersion', contextId)).some(v => v.data.templateId === r.data.templateId && v.data.sequence > r.data.sequence), version: r.data.sequence, at: r.createdAt, actor: r.data.createdBy })));
        }
    }
    return docs;
}
