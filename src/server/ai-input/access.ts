import { storedId, storedCount, storedHash } from './stored';
import type { Clock, StoredRecord, UnitOfWork } from '@/domain/records';
import type { AiContent, AiVisibility } from '@/domain/ai-input/records';
import { parseContent } from '@/domain/ai-input/validate';
import type { Principal } from '@/server/auth/service';
import { fail, unavailable } from '@/server/auth/errors';
import { authorize } from '@/server/policy/policy';
import { submissionTask } from '@/server/submissions/access';
import { taskScope } from '@/server/policy/projection';
import { canReferenceFile } from '@/server/files/access';
import { resolveProduct } from '@/server/products/access';
import { readProductUse } from '@/server/products/capture';
import { contentHash } from './extraction';
export async function contextAccess(s: UnitOfWork, p: Principal, contextId: string, clock: Clock, visibility: AiVisibility = 'context') {
    (await authorize(s, p, 'ai.input.read', { id: contextId, contextId, kind: 'ai_input', visibility: visibility === 'staff' ? 'internal' : 'public' }, clock));
}
export async function resolveInput(s: UnitOfWork, p: Principal, id: string, clock: Clock, edit = false) { const row = (await s.get('aiInput', id)); if (!row?.contextId)
    unavailable(); if (!['context', 'staff'].includes(row.data.visibility))
    fail('STORAGE_UNAVAILABLE', 503, '입력의 공개 범위를 확인할 수 없습니다.'); (await contextAccess(s, p, row.contextId, clock, row.data.visibility)); if (edit && row.data.createdBy !== p.user.id && p.user.data.role !== 'gsg')
    fail('FORBIDDEN', 403, '작성자 또는 GSG가 입력 버전을 변경할 수 있습니다.'); return row; }
export async function assetAccess(s: UnitOfWork, p: Principal, id: string, contextId: string, clock: Clock, visibility?: AiVisibility) { const row = (await s.get('aiAsset', id)); if (!row || row.contextId !== contextId)
    unavailable(); if (!['context', 'staff'].includes(row.data.visibility))
    fail('STORAGE_UNAVAILABLE', 503, '자료 공개 범위를 확인할 수 없습니다.'); (await contextAccess(s, p, contextId, clock, row.data.visibility)); if (visibility === 'context' && row.data.visibility === 'staff')
    fail('VALIDATION', 422, '내부 자료는 내부 입력에만 사용할 수 있습니다.'); return row; }
export async function contentAccess(s: UnitOfWork, p: Principal, contextId: string, c: AiContent, clock: Clock, visibility: AiVisibility) {
    (await contextAccess(s, p, contextId, clock, visibility));
    if (c.submission) {
        const a = c.submission, { task } = (await submissionTask(s, p, a.taskId, clock)), sub = (await s.get('submission', a.submissionId)), request = (await s.get('requestVersion', a.requestId));
        if (task.contextId !== contextId || sub?.contextId !== contextId || sub.data.taskId !== task.id || sub.data.requestId !== a.requestId || request?.data.taskId !== task.id)
            unavailable();
        for (const useId of a.productUseIds) {
            if (!sub.data.productUseIds.includes(useId))
                unavailable();
            const use = (await s.get('productUseSnapshot', useId));
            if (use?.data.ownerType !== 'submission' || use.data.ownerId !== sub.id || use.data.requestId !== a.requestId)
                unavailable();
            (await readProductUse(s, p, useId, clock));
        }
    }
    for (const ref of c.sources) {
        if (ref.kind === 'upload') {
            (await assetAccess(s, p, ref.assetId, contextId, clock, visibility));
        }
        else {
            if (!c.submission)
                unavailable();
            const sub = (await s.get('submission', c.submission.submissionId))!, file = (await s.get('fileVersion', ref.fileVersionId)), task = (await s.get('task', c.submission.taskId))!;
            if (!sub.data.fileVersionIds.includes(ref.fileVersionId) || !file || file.contextId !== contextId)
                unavailable();
            const frozen = sub.data.files.find(f => f.fileVersionId === file.id);
            if (!frozen || frozen.sha256 !== file.data.sha256)
                fail('STORAGE_UNAVAILABLE', 503, '원본 자료의 무결성을 확인할 수 없습니다.');
            (await canReferenceFile(s, p, file, taskScope(task), clock));
            if (visibility === 'context' && file.data.visibility !== 'public')
                fail('VALIDATION', 422, '내부 자료는 내부 입력에만 사용할 수 있습니다.');
        }
    }
    for (const ref of c.products) {
        const r = (await resolveProduct(s, p, contextId, ref.productId, clock)), common = (await s.get('productVersion', ref.productVersionId)), local = (await s.get('contextProductVersion', ref.contextProductVersionId));
        if (common?.data.productId !== r.product.id || local?.contextId !== contextId || local.data.contextProductId !== r.relation.id)
            unavailable();
    }
}
export function versionContent(row: StoredRecord<'aiVersion'>): AiContent { const d = row.data; storedId(d.inputId); storedCount(d.sequence); storedId(d.createdBy); storedHash(d.contentHash); if (d.previousId !== null)
    storedId(d.previousId); let c: AiContent; try {
    c = parseContent({ title: d.title, scope: d.scope, kind: d.kind, text: d.text, sources: d.sources, selectedPages: d.selectedPages, submission: d.submission, products: d.products });
}
catch {
    fail('STORAGE_UNAVAILABLE', 503, '저장된 입력을 확인할 수 없습니다.');
} if (contentHash(JSON.stringify(c)) !== d.contentHash)
    fail('STORAGE_UNAVAILABLE', 503, '입력 버전의 무결성을 확인할 수 없습니다.'); return c; }
export async function resolveVersion(s: UnitOfWork, p: Principal, inputId: string, versionId: string, clock: Clock, edit = false) { const input = (await resolveInput(s, p, inputId, clock, edit)), version = (await s.get('aiVersion', versionId)); if (!version || version.contextId !== input.contextId || version.data.inputId !== input.id)
    unavailable(); const content = versionContent(version); (await contentAccess(s, p, input.contextId!, content, clock, input.data.visibility)); return { input, version, content }; }
