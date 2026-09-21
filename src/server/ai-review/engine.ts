import type { ExtractionSnapshot } from '@/domain/ai-input/types';
import type { CorpusRelease } from '@/domain/ai-review/types';
import { REVIEW_SCHEMA } from '@/domain/ai-review/types';
export const SYNTHETIC_ENGINE = { engine: 'synthetic_demo' as const, modelId: 'gs-hale-synthetic-demo/1', promptVersion: 'synthetic-candidate-contract/1', providerCalled: false as const, label: '합성 데모 · 실제 모델 호출 및 법률 판단 아님' };
export const analysisLimits = { concurrent: 2, queued: 16, leaseMs: 90_000, retryFailures: 3 } as const;
export type AnalysisEngine = (snapshot: ExtractionSnapshot, corpus: CorpusRelease) => Promise<string>;
/** A deliberately small deterministic demonstrator, never represented as model/legal accuracy. */
export const syntheticAnalyze: AnalysisEngine = async (snapshot, corpus) => {
  const findings: unknown[] = [];
  for (const segment of snapshot.segments) {
    const rules = [
      { term: '絶対安全', category: 'YK-11', risk: 'high', excerpt: 'std4-3-5' },
      { term: 'シワ', category: 'YK-07', risk: 'medium', excerpt: 'handling2-1' },
      { term: 'No.1', category: 'YK-10', risk: 'unknown', excerpt: 'jcia-F8-2' },
      { term: '根拠不明', category: 'EV-01', risk: 'unknown', excerpt: null },
    ];
    for (const rule of rules) {
      const start = segment.text.indexOf(rule.term); if (start < 0 || findings.length >= 100) continue;
      const e = corpus.excerpts.find(e => e.id === rule.excerpt);
      findings.push({ category: rule.category, original: { segmentId: segment.id, start, end: start + rule.term.length, quote: rule.term }, risk: rule.risk, confidence: null,
        reason: '합성 데모 규칙으로 생성한 검토 후보입니다. 문맥과 관련 근거를 사람이 확인해야 합니다.', additionalInformation: ['실제 제품 효능, 표현 맥락, 이미지·각주 및 평가 자료 확인'], suggestion: null,
        citations: e ? [{ excerptId: e.id, sourceVersionId: e.sourceVersionId, locator: e.locator }] : [] });
    }
  }
  return JSON.stringify({ schemaVersion: REVIEW_SCHEMA, findings });
};
