import { randomUUID } from 'node:crypto';
import type { IdentityService } from '@/server/auth/service';
import type { AiContent } from '@/domain/ai-input/records';
import { AiInputService } from '@/server/ai-input/service';
import { AiReviewService } from '@/server/ai-review/service';
import { TaskService } from '@/server/tasks/service';
import { SubmissionService } from '@/server/submissions/service';
import { blankContent, blankRequirement } from '@/domain/tasks/types';
import { blankDraft } from '@/domain/submissions/types';
import { createCorpusRelease } from '@/domain/ai-review/corpus';
import { curatedRelease } from '@/domain/ai-review/curated';
import { sha256 } from '@/domain/ai-review/validate';
import { tokenFor } from '../policy';
export const ctx = 'ctx-jp-a-luna', staff = tokenFor('user-gsg'), admin = tokenFor('user-admin'), brand = tokenFor('user-luna');
export const claim = '合成契約検証用。絶対安全。根拠不明。';
export const inputContent = (text = claim): AiContent => ({ title: 'G16 합성 계약 입력', scope: { classification: 'general_cosmetic', language: 'ja', media: 'pop', use: '합성 매장 문안' }, kind: 'text', text, sources: [], selectedPages: [], submission: null, products: [] });
export async function readyInput(identity: IdentityService, directory: string, content = inputContent()) {
  const service = new AiInputService(identity, directory);
  const input = await service.create(brand, { contextId: ctx, visibility: 'context', content, idempotencyKey: randomUUID() });
  const extraction = await service.extract(brand, input.id, { versionId: input.version.id, expectedRunId: null, idempotencyKey: randomUUID() });
  const workspace = await new AiReviewService(identity, directory).workspace(staff, input.id, input.version.id);
  return { input, extraction, body: { inputVersionId: input.version.id, extractionRunId: extraction.runId, expectedRunId: null, corpusReleaseId: workspace.corpus.id, corpusManifestHash: workspace.corpus.manifestHash, engine: 'synthetic_demo', idempotencyKey: randomUUID() } };
}
export async function actualSubmission(identity: IdentityService) {
  const tasks = new TaskService(identity), content = blankContent(); content.title = 'G16 실제 제출 출처'; content.description = '일본어 합성 문안의 실제 제출'; content.deadline.responsibleUserId = 'user-gsg'; content.requirements = [{ ...blankRequirement('claim', 'long_text'), label: '일본어 문안' }];
  const taskId = (await tasks.create(admin, { targets: [{ contextId: ctx, ownerId: 'user-gsg', assigneeId: 'user-luna', coAssigneeIds: [], productIds: [] }], content, category: 'spot', idempotencyKey: randomUUID() })).ids[0];
  await tasks.command(admin, taskId, { command: 'publish', expectedRevision: 1, idempotencyKey: randomUUID() });
  const submissions = new SubmissionService(identity); let w = await submissions.workspace(brand, taskId);
  await submissions.draft(brand, taskId, { command: 'save', baseRequestId: w.request.id, expectedDraftRevision: 0, content: { ...blankDraft(), answers: [{ requestId: w.request.id, requirementKey: 'claim', productId: null, type: 'long_text', input: { text: claim } }] }, idempotencyKey: randomUUID() });
  w = await submissions.workspace(brand, taskId);
  const submissionId = (await submissions.submit(brand, taskId, { baseRequestId: w.request.id, expectedDraftRevision: w.draft!.revision, expectedTaskRevision: w.taskRevision, mode: 'full', idempotencyKey: randomUUID() })).ids[0];
  return { taskId, requestId: w.request.id, submissionId, productUseIds: [] };
}
/** A source-change fixture, not a new adopted legal revision. Never used by production seeding. */
export function revisedCorpus() {
  const c = curatedRelease(); c.id = 'synthetic-corpus-revision-2';
  const source = c.sources.find(s => s.sourceId === 'mhlw2017')!, previous = source.id; source.id += '-test2'; source.originalHash = sha256('synthetic source revision'); source.revision = 'SYNTHETIC_REVISION_NOT_LEGAL';
  for (const e of c.excerpts.filter(e => e.sourceVersionId === previous)) e.sourceVersionId = source.id;
  for (const t of c.translations.filter(t => t.sourceVersionId === previous)) { t.id += '-test2'; t.sourceVersionId = source.id; t.sourceHash = source.originalHash; }
  return createCorpusRelease(c);
}
