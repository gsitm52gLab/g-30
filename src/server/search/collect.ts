import { asyncFlatMap, asyncMap } from "@/domain/async-collections";
import { AuthError } from '@/server/auth/errors';
import { StoreError } from '@/domain/records';
import { actor, field, text, strings } from './safe';
import { decide } from '@/server/policy/policy';
import { taskScope } from '@/server/policy/projection';
import type { SearchDocument, CurrentAssignee } from '@/domain/search/types';
import { corrupt } from './safe';
import { taskDocuments } from './tasks';
import { productDocuments } from './products';
import { submissionDocuments } from './submissions';
import { communicationDocuments } from './communications';
import { materialDocuments } from './materials';
import { correctionDocuments } from './corrections';
import { operationDocuments } from './operations';
import { personalDocuments } from './analysis';
import type { SearchAccess } from './safe';
async function currentAssignment(a: SearchAccess, d: SearchDocument): Promise<SearchDocument[]> {
    if (!d.taskId)
        return [d];
    const t = (await a.s.get('task', d.taskId));
    if (!t || t.contextId !== a.contextId || !(await decide(a.s, a.p, 'task.read', taskScope(t), a.clock)).allowed)
        return [];
    const entries: [
        string,
        CurrentAssignee['role']
    ][] = [[text(t.data.assigneeId, 160), 'primary_brand'], ...strings(t.data.coAssigneeIds ?? []).map(id => [id, 'co_brand'] as [
            string,
            'co_brand'
        ]), [text(t.data.ownerId, 160), 'gsg_owner']];
    const assignees = (await asyncMap(entries.filter(([id]) => !!id), async ([id, role]): Promise<CurrentAssignee> => { const current = (await actor(a, id)); return { id, label: current.label === '이전 작성자' ? '이전 담당자' : current.label, role, scope: 'current_related_task' }; }));
    const labels = { primary_brand: '주담당', co_brand: '공동 담당', gsg_owner: 'GSG 담당' };
    const fields = [...d.fields, ...assignees.map(x => field('현재 관련 업무 ' + labels[x.role], `${x.label} (${x.id})`))];
    return [{ ...d, assignees, fields }];
}
export async function collectDocuments(a: SearchAccess) {
    try {
        return (await asyncFlatMap([...(await taskDocuments(a)), ...(await productDocuments(a)), ...(await submissionDocuments(a)), ...(await communicationDocuments(a)), ...(await materialDocuments(a)), ...(await correctionDocuments(a)), ...(await operationDocuments(a)), ...(await personalDocuments(a))], async (d) => (await currentAssignment(a, d))));
    }
    catch (error) {
        if (error instanceof AuthError || error instanceof StoreError)
            throw error;
        return corrupt();
    }
}
