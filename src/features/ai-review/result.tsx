import type { AnalysisIdentity, ValidatedResult } from '@/domain/ai-review/types';
import { FindingCard } from './finding';
import { limitationLabels, quarantineLabels, resultLabels } from './labels';
import s from './ui.module.css';

export function AnalysisIdentityView({ identity, providerCalled = false }: { identity: AnalysisIdentity; providerCalled?: boolean }) {
  return <section className={s.panel} aria-label="분석 실행 기준">
    <h2>분석 실행 기준</h2>
    <p className={s.notice}>{identity.engine === 'synthetic_demo' ? '합성 데모 결과입니다. 실제 외부 모델 호출이나 법률 정확도 평가가 아닙니다.' : providerCalled ? '외부 모델 호출 기록이 있는 결과입니다. 사람 검토와 별도로 확인해 주세요.' : '외부 모델이 선택된 실행입니다. 실제 호출 기록은 확인되지 않았습니다.'}</p>
    <dl className={s.facts}><div><dt>모델 식별자</dt><dd>{identity.modelId}</dd></div><div><dt>프롬프트 버전</dt><dd>{identity.promptVersion}</dd></div><div><dt>근거 자료 공개 버전</dt><dd>{identity.corpusReleaseId}</dd></div></dl>
    <details className={s.records}><summary>입력·추출·근거 버전 식별 정보</summary>
      <dl className={s.facts}>
        <div><dt>입력 ID</dt><dd>{identity.inputId}</dd></div><div><dt>입력 버전 ID</dt><dd>{identity.inputVersionId}</dd></div>
        <div><dt>읽기 실행 ID</dt><dd>{identity.extractionRunId}</dd></div><div><dt>읽기 결과 ID</dt><dd>{identity.extractionSnapshotId}</dd></div>
        <div><dt>읽기 결과 해시</dt><dd>{identity.snapshotHash}</dd></div><div><dt>근거 묶음 해시</dt><dd>{identity.corpusManifestHash}</dd></div>
      </dl>
    </details>
  </section>;
}

/** Summary can be composed with FindingCard children when the caller binds persisted human reviews. */
export function AnalysisResultSummary({ result }: { result: ValidatedResult }) {
  const unresolved = result.findings.reduce((count, finding) => count + finding.unconfirmedCitationCount, 0);
  return <section className={s.panel} aria-label="분석 결과 요약">
    <h2>{resultLabels[result.status]}</h2>
    <p className={s.notice}>후보가 0개여도 적법 확인이 아닙니다. 결과는 사람 검토가 필요하며 외부 전문가의 법률 승인을 뜻하지 않습니다.</p>
    <dl className={s.facts}><div><dt>표시 가능한 후보</dt><dd>{result.findings.length}건</dd></div><div><dt>확인 실패로 분리된 후보</dt><dd>{result.quarantined.length}건</dd></div><div><dt>표시된 후보의 미확인 인용</dt><dd>{unresolved}건</dd></div></dl>
    {result.status === 'out_of_scope' && <p>지원 범위 밖의 입력입니다. 검토 완료나 정상 결과로 처리하지 않습니다.</p>}
    {result.status === 'unread' && <p>원문을 읽은 범위가 확인되지 않았습니다. 원문 읽기 결과를 확인해 주세요.</p>}
    {result.status === 'unconfirmed' && <p>검증되지 않은 후보·인용 또는 근거 부족이 있습니다. 문제없음으로 해석하지 않습니다.</p>}
    {result.limitations.length > 0 && <ul>{result.limitations.map(limit => <li key={limit}>{limitationLabels[limit]}</li>)}</ul>}
    {result.quarantined.length > 0 && <section className={s.section} aria-label="확인 실패 후보"><h3>확인 실패로 분리된 후보</h3><ul>{result.quarantined.map((item, i) => <li key={`${item.index}:${i}`}>원 결과 {item.index + 1}번째 항목 · {quarantineLabels[item.issue]}</li>)}</ul><p className={s.meta}>검증되지 않은 원문·위치·근거를 만들어 표시하지 않습니다.</p></section>}
    <details className={s.records}><summary>결과 버전·해시</summary><p>결과 형식 {result.schemaVersion}</p><p>원 결과 해시 {result.rawHash}</p><p>입력 읽기 결과 해시 {result.inputSnapshotHash}</p><p>근거 공개 버전 {result.corpusReleaseId}</p><p>근거 묶음 해시 {result.corpusManifestHash}</p></details>
  </section>;
}

export function AnalysisResultView({ result }: { result: ValidatedResult }) {
  return <div className={s.stack}><AnalysisResultSummary result={result}/>{result.findings.map(finding => <FindingCard key={finding.id} finding={finding}/>)}</div>;
}
