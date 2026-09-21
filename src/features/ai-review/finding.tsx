import type { ReactNode } from 'react';
import type { Finding, VerifiedQuote } from '@/domain/ai-review/types';
import { EvidencePanels } from './evidence';
import { categoryLabels, riskLabels } from './labels';
import s from './ui.module.css';

const coverageLabels: Record<string, string> = { plain_text: '입력 텍스트', pdf_text_layer: 'PDF 텍스트 계층', ocr_partial: '이미지 문자 인식 일부 결과' };

export function OriginalQuote({ original }: { original: VerifiedQuote }) {
  const location = original.location;
  return <section className={s.section} aria-label="후보의 원문 위치">
    <h3>원문 구절·위치</h3>
    <blockquote className={s.quote} lang="ja">{original.quote}</blockquote>
    <p>{location.page !== null ? `PDF ${location.page}쪽` : location.imageIndex !== null ? `이미지 ${location.imageIndex + 1}` : '입력 텍스트'} · {coverageLabels[original.coverage] ?? original.coverage}</p>
    {original.locationGranularity === 'text_range' ? <p>원본 텍스트 범위 {location.sourceTextStart}–{location.sourceTextEnd} (UTF-16, 0부터 시작·끝 제외)</p> : original.locationGranularity === 'segment_box' ? <p className={s.notice}>인용을 포함하는 읽기 구간의 영역입니다. 인용문만의 정확한 테두리를 뜻하지 않습니다.</p> : <p className={s.notice}>페이지·읽기 구간 단위 위치입니다. 인용문만의 좌표는 확인되지 않았습니다.</p>}
    {location.box && <p className={s.meta}>구간 영역: x {location.box.x}, y {location.box.y}, 너비 {location.box.width}, 높이 {location.box.height} {location.box.unit}</p>}
    <p className={s.meta}>문자 인식 신뢰도: {original.segmentConfidence === null ? '제공되지 않음' : `${original.segmentConfidence.toFixed(1)} / 100`} · 후보 확신도와 별도</p>
    <details className={s.records}><summary>원문·읽기 기록 식별 정보</summary>
      <p>원본 {location.sourceId} / 버전 {location.versionId}</p><p>원본 해시 {original.sourceHash}</p>
      <p>읽기 결과 해시 {original.snapshotHash}</p><p>구간 {original.segmentId}</p>
      <p>구간 내 {original.start}–{original.end} / 읽기 결과 내 {original.textStart}–{original.textEnd} (UTF-16, 0부터 시작·끝 제외)</p>
    </details>
  </section>;
}

export function FindingCard({ finding, children }: { finding: Finding; children?: ReactNode }) {
  return <article className={s.panel} aria-label={`후보 ${finding.id}`}>
    <header className={s.heading}><h2>{finding.category} · {categoryLabels[finding.category]}</h2><span className={s.badge}>사람 검토 필요</span></header>
    <p className={s.meta}>후보 유형은 위법 판정 코드가 아닙니다.</p>
    <dl className={s.facts}>
      <div><dt>위험 수준</dt><dd>{riskLabels[finding.risk]}</dd></div>
      <div><dt>후보 확신도</dt><dd>{finding.confidence === null ? '제공되지 않음' : `${finding.confidence.toFixed(2)} / 1`}</dd></div>
      <div><dt>근거 위치 확인</dt><dd>{finding.evidenceStatus === 'confirmed_locator' ? '연결된 위치 확인됨' : '추가 확인 필요'}</dd></div>
      <div><dt>확인되지 않은 인용</dt><dd>{finding.unconfirmedCitationCount}건</dd></div>
    </dl>
    <p className={s.meta}>확신도는 분석 결과의 값이며, 평가셋으로 측정한 정확도나 법적 적합성의 확률이 아닙니다.</p>
    <OriginalQuote original={finding.original}/>
    <section className={s.section}><h3>후보 이유</h3><p className={s.body}>{finding.reason}</p></section>
    <section className={s.section}><h3>추가로 확인할 정보</h3>{finding.additionalInformation.length ? <ul>{finding.additionalInformation.map((item, index) => <li className={s.body} key={index}>{item}</li>)}</ul> : <p>결과에 별도 정보 요청이 없습니다. 사람 검토는 필요합니다.</p>}</section>
    <section className={s.section}><h3>참고 수정안</h3>{finding.suggestion === null ? <p>제공된 수정안 없음</p> : <p className={s.quote}>{finding.suggestion}</p>}<p className={s.meta}>원문 변경이나 브랜드 공개는 별도 작업입니다.</p></section>
    <EvidencePanels legalBasis={finding.legalBasis} supportingGuidance={finding.supportingGuidance}/>
    <details className={s.records}><summary>후보 식별 정보</summary><p>{finding.id}</p></details>
    {children}
  </article>;
}
