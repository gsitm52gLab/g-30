import { asyncFlatMap } from "@/domain/async-collections";
import type { SearchDocument } from '@/domain/search/types';
import { snapshotDTO } from '@/server/submissions/read';
import { document, field, strings, visible, url, text, type SearchAccess } from './safe';
export async function submissionDocuments(a: SearchAccess): Promise<SearchDocument[]> {
    const { s, p, clock, contextId } = a;
    return (await asyncFlatMap((await s.list('submission', contextId)), async (v) => {
        const d = (await visible(async () => (await snapshotDTO(s, p, v, clock))));
        if (!d)
            return [];
        const values = [field('제출 메모', d.content.narrative), field('자료 제공자', d.providedBy.label), field('입력자', d.recorderLabel)];
        for (const x of d.answers) {
            values.push(field('요청 항목', d.request.content.requirements.find(q => q.key === x.requirementKey)?.label ?? x.requirementKey));
            switch (x.type) {
                case 'short_text':
                case 'long_text':
                    values.push(field('답변', x.input.text));
                    break;
                case 'number':
                    values.push(field('수치', x.input.value));
                    break;
                case 'date':
                    values.push(field('날짜', x.input.value));
                    break;
                case 'choice':
                    values.push(...strings(x.input.selected).map(v => field('선택', v)));
                    break;
                case 'link':
                    values.push(field('링크', x.input.url), field('설명', x.input.description));
                    break;
                case 'physical_record':
                    values.push(field('실물 기록', x.input.summary), field('출처', x.input.source), ...x.input.items.flatMap(i => [field('수량', i.quantity), field('단위', i.unit)]));
                    break;
                case 'file': break;
            }
        }
        const fs = d.files.map(f => ({ id: f.id, name: text(f.name), downloadUrl: f.downloadUrl, previewUrl: f.previewUrl }));
        values.push(...fs.map(f => field('파일명', f.name)));
        return [(await document(a, 'submission', v, d.taskId, d.request.content.title, values, url(`/tasks/${d.taskId}`, contextId), { current: !(await s.list('submission', contextId)).some(r => r.data.taskId === d.taskId && r.data.sequence > v.data.sequence), version: d.sequence, actor: d.recordedBy, at: d.submittedAt, status: d.mode, statusPrecision: 'historical', taskId: d.taskId, productIds: d.products.map(p => p.productId), files: fs }))];
    }));
}
