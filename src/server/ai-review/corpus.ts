import type { UnitOfWork } from '@/domain/records';
import { readCorpusRelease } from '@/domain/ai-review/corpus';
import { curatedRelease } from '@/domain/ai-review/curated';
import { contentHash } from '@/domain/ai-review/validate';
import type { CorpusRelease } from '@/domain/ai-review/types';
import { fail } from '@/server/auth/errors';

export const corpusHeadId = 'ai-corpus-current';
export function loadCorpus(s: UnitOfWork, releaseId?: string): CorpusRelease {
  const selected = releaseId ?? s.get('aiCorpusHead', corpusHeadId)?.data.releaseId;
  const row = typeof selected === 'string' ? s.get('aiCorpusRelease', selected) : null;
  if (!row) fail('CORPUS_UNAVAILABLE', 503, '배포된 근거 자료가 없습니다. corpus 설치 상태를 확인해 주세요.');
  try { const result = readCorpusRelease(JSON.parse(row.data.payload)); if (result.id !== row.id || result.manifestHash !== row.data.manifestHash) throw Error('mismatch'); return result; }
  catch { return fail('CORPUS_INVALID', 503, '근거 자료의 무결성을 확인할 수 없습니다.'); }
}
/** Deployment-only operation; no browser endpoint calls this writer. */
export function publishCorpus(s: UnitOfWork, value: unknown, expectedReleaseId: string | null) {
  let next: CorpusRelease;
  try { next = readCorpusRelease(value); } catch { return fail('CORPUS_INVALID', 422, '근거 release와 정렬 해시를 확인해 주세요.'); }
  const head = s.get('aiCorpusHead', corpusHeadId);
  if ((head?.data.releaseId ?? null) !== expectedReleaseId) fail('CONFLICT', 409, '현행 corpus가 변경되었습니다. 현재 release를 확인해 주세요.');
  // Previously published source/translation version IDs cannot be reassigned to new content.
  for (const old of s.list('aiCorpusRelease')) {
    const previous = loadCorpus(s, old.id);
    if (old.id === next.id && previous.manifestHash !== next.manifestHash) fail('CORPUS_VERSION_CONFLICT', 409, '기존 release는 변경할 수 없습니다. 새 버전을 사용해 주세요.');
    for (const source of next.sources) { const existing = previous.sources.find(x => x.id === source.id); if (existing && contentHash(existing) !== contentHash(source)) fail('CORPUS_VERSION_CONFLICT', 409, '새 원문 버전 식별자가 필요합니다.'); }
    for (const translation of next.translations) { const existing = previous.translations.find(x => x.id === translation.id); if (existing && contentHash(existing) !== contentHash(translation)) fail('CORPUS_VERSION_CONFLICT', 409, '새 번역 버전 식별자가 필요합니다.'); }
    for (const excerpt of next.excerpts) { const existing = previous.excerpts.find(x => x.id === excerpt.id && x.sourceVersionId === excerpt.sourceVersionId); if (existing && contentHash(existing) !== contentHash(excerpt)) fail('CORPUS_VERSION_CONFLICT', 409, '새 발췌/원문 버전 식별자가 필요합니다.'); }
  }
  let inserted = 0, preserved = 0;
  if (!s.get('aiCorpusRelease', next.id)) { s.create('aiCorpusRelease', { id: next.id, contextId: null, data: { payload: JSON.stringify(next), manifestHash: next.manifestHash } }); inserted++; } else preserved++;
  if (!head) { s.create('aiCorpusHead', { id: corpusHeadId, contextId: null, data: { releaseId: next.id } }); inserted++; }
  else if (head.data.releaseId !== next.id) s.update('aiCorpusHead', head.id, head.revision, { releaseId: next.id });
  else preserved++;
  return { inserted, preserved, releaseId: next.id, manifestHash: next.manifestHash };
}
/** Only bootstrap an empty installation; preserve any operator-published head on later seeding. */
export function bootstrapCorpus(s: UnitOfWork) {
  if (s.get('aiCorpusHead', corpusHeadId)) { loadCorpus(s); return { inserted: 0, preserved: 2 }; }
  const result = publishCorpus(s, curatedRelease(), null); return { inserted: result.inserted, preserved: result.preserved };
}
