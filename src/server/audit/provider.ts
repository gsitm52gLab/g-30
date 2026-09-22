import { asyncFilter } from "@/domain/async-collections";
import type { StoredRecord, UnitOfWork } from '@/domain/records';
import type { AuditItem } from '@/domain/audit/view';
import type { SearchDocument, SearchField } from '@/domain/search/types';
import { attemptData, outcomeData, planData, settingData } from '@/domain/ai-provider/parse';
import { reviewAccess } from '@/server/ai-review/access';
import { safely } from '@/server/ai-review/stored';
import type { analysisDetail } from '@/server/ai-review/read';
import { issueMessages } from '@/server/ai-provider/errors';
import { actor, corrupt, field, text, time, visible, type SearchAccess } from '@/server/search/safe';
import { auditDetail } from './stored';
type Provider = NonNullable<Awaited<ReturnType<typeof analysisDetail>>['provider']>;
/** Call only after the exact run's current original/reference ACL has passed. */
export async function validateProviderRelations(s: UnitOfWork, run: StoredRecord<'aiAnalysisRun'>) {
    if (run.data.engine !== 'provider')
        return;
    const row = (await s.get('aiProviderPlan', run.id));
    if (!row || row.contextId !== run.contextId)
        corrupt();
    const plan = safely(() => planData(row.data));
    if (plan.runId !== run.id || plan.model !== run.data.modelId || plan.promptVersion !== run.data.promptVersion)
        corrupt();
    const sequences = new Set<number>();
    for (const attempt of (await s.list('aiProviderAttempt', run.contextId!)).filter(a => a.data.runId === run.id)) {
        const d = safely(() => attemptData(attempt.data));
        if (sequences.has(d.sequence) || d.sequence > 3)
            corrupt();
        sequences.add(d.sequence);
        if (d.outcomeId === null) {
            if (d.phase === 'settled')
                corrupt();
            continue;
        }
        const outcome = (await s.get('aiProviderOutcome', d.outcomeId));
        if (!outcome || outcome.contextId !== run.contextId)
            corrupt();
        const o = safely(() => outcomeData(outcome.data, plan.model));
        if (o.runId !== run.id || o.attemptId !== attempt.id || d.phase !== 'settled')
            corrupt();
    }
}
/** Canonical provider DTO has already parsed all known scalars. Null is unknown, never zero. */
export function providerFields(provider: Provider): SearchField[] {
    const values = [field('실행 모델', provider.model)];
    for (const a of provider.attempts) {
        const prefix = `시도 ${a.sequence} · `;
        values.push(field(prefix + '기록 ID', a.id), field(prefix + '단계', a.phase), field(prefix + '의도 시각', a.intentAt), field(prefix + '전송 시각', a.dispatchedAt ?? '전송 기록 없음'), field(prefix + '종료 시각', a.endedAt ?? '종료 기록 없음'), field(prefix + '오류', a.issue ?? '오류 기록 없음'), field(prefix + '안내', a.message), field(prefix + '원격 결과', a.remoteOutcomeUnknown ? '불명확' : '불명확 표시 없음'), field(prefix + '스키마 검증', a.schemaValid ? '확인됨 · 법률 승인 아님' : '확인되지 않음'), field(prefix + '근거 확인', a.grounding));
        for (const [key, label] of Object.entries({ inputTokens: '입력 토큰', cachedTokens: '캐시 읽기 토큰', cacheWriteTokens: '캐시 쓰기 토큰', outputTokens: '출력 토큰', reasoningTokens: '추론 토큰', totalTokens: '전체 토큰' }) as [
            keyof NonNullable<typeof a.usage>,
            string
        ][]) {
            const value = a.usage?.[key];
            values.push(field(prefix + label, value === null || value === undefined ? '확인 불가' : String(value)));
        }
        values.push(field(prefix + '추정 비용 USD', a.cost?.amountUsd === null || a.cost?.amountUsd === undefined ? `확인 불가 · ${a.cost?.unavailableReason ?? '아직 결과 기록 없음'}` : String(a.cost.amountUsd)));
    }
    return values;
}
/** A setting is mutable; a finished event references an immutable outcome. Neither implies a receipt. */
export async function providerAuditItem(a: SearchAccess, row: StoredRecord<'audit'>, docs: SearchDocument[]): Promise<AuditItem | null | undefined> {
    const d = row.data;
    if (d.action !== 'ai.provider.settings' && d.action !== 'ai.provider.finished')
        return undefined;
    if (row.contextId !== a.contextId || !(await visible(async () => { (await reviewAccess(a.s, a.p, a.contextId, a.clock, d.action === 'ai.provider.settings')); return true; })))
        return null;
    const detail = d.detail ? auditDetail(d.detail) : null;
    const occurredAt = time(d.at);
    if (!occurredAt)
        corrupt();
    const label = d.action === 'ai.provider.settings' ? '외부 AI 사용 설정 변경' : '외부 AI 시도 종료';
    const item: AuditItem = { id: text(row.id, 160), contextId: row.contextId, action: d.action, label, occurredAt, actor: (await actor(a, d.actorId)), target: { id: text(d.targetId, 160), title: label, url: null }, operationId: detail?.operationId ?? null, receiptId: detail?.receiptId ?? null, eventIds: (await asyncFilter(detail?.references ?? [], async (r) => r.kind === 'domainEvent' && (await a.s.get('domainEvent', r.id))?.contextId === a.contextId)).map(r => r.id) ?? [], correlation: detail ? 'recorded' : 'legacy_unavailable', sourcePrecision: 'record_only', changes: [], versions: [], fields: [], notice: '저장된 작업 연결만 표시합니다. 실행·사용량·근거 확인은 법률 승인을 뜻하지 않습니다.' };
    if (d.action === 'ai.provider.settings') {
        const setting = (await a.s.get('aiProviderSetting', d.targetId));
        if (!setting || setting.contextId !== a.contextId)
            corrupt();
        safely(() => settingData(setting.data));
        if (typeof d.before.enabled !== 'boolean' || typeof d.after.enabled !== 'boolean')
            corrupt();
        item.changes = [{ label: '외부 AI 사용', before: d.before.enabled ? '사용' : '중지', after: d.after.enabled ? '사용' : '중지' }];
        item.fields = item.changes.map(c => field(c.label, `${c.before} → ${c.after}`));
        return item;
    }
    // Resolve the authorized exact run before inspecting its private outcome/attempt relations.
    const doc = docs.find(x => x.sourceKind === 'aiAnalysisRun' && x.sourceId === d.targetId);
    if (!doc)
        return null;
    const run = (await a.s.get('aiAnalysisRun', d.targetId));
    if (!run || run.contextId !== a.contextId || run.data.engine !== 'provider')
        corrupt();
    (await validateProviderRelations(a.s, run));
    const outcomeId = text(d.after.outcomeId, 160), outcome = (await a.s.get('aiProviderOutcome', outcomeId)), plan = (await a.s.get('aiProviderPlan', run.id))!;
    if (!outcome || outcome.contextId !== a.contextId)
        corrupt();
    const o = safely(() => outcomeData(outcome.data, safely(() => planData(plan.data)).model)), attempt = (await a.s.get('aiProviderAttempt', o.attemptId));
    if (!attempt || attempt.contextId !== a.contextId || o.runId !== run.id)
        corrupt();
    const attemptValue = safely(() => attemptData(attempt.data));
    if (attemptValue.runId !== run.id || attemptValue.outcomeId !== outcome.id || attemptValue.phase !== 'settled' || d.after.issue !== o.issue)
        corrupt();
    item.target = { id: run.id, title: doc.title, url: doc.historyUrl };
    item.sourcePrecision = 'exact';
    item.versions = [{ label: doc.title, kind: 'aiAnalysisRun', id: run.id, url: doc.historyUrl, role: 'source' }];
    item.fields = [field('결과 기록 ID', outcome.id), field('시도 기록 ID', attempt.id), field('시도 순서', String(attemptValue.sequence)), field('오류', o.issue ?? '오류 기록 없음'), field('안내', o.issue ? issueMessages[o.issue] : null), field('스키마 검증', o.schemaValid ? '확인됨 · 법률 승인 아님' : '확인되지 않음'), field('근거 확인', o.grounding), field('원격 결과', o.remoteOutcomeUnknown ? '불명확' : '불명확 표시 없음')];
    return item;
}
