import type { Citation, CorpusEntry, CorpusSelection } from '@/domain/ai-review/types';
import { authorityLabels } from './labels';
import s from './ui.module.css';

/** Receives a server-validated, version-aligned entry; performs no source lookup or translation. */
export function CorpusEntryView({ entry }: { entry: CorpusEntry }) {
  const { source, excerpt, translation } = entry;
  return <article className={s.evidence} aria-label={`${source.title} · ${excerpt.locator}`}>
    <h4>{source.title}</h4>
    <p className={s.badge}>{authorityLabels[source.authority]}</p>
    <p className={s.body}>구속력·적용 설명: {source.bindingStatus}</p>
    <dl className={s.facts}>
      <div><dt>정확한 근거 위치</dt><dd>{excerpt.locator}</dd></div>
      <div><dt>원문 버전</dt><dd>{source.revision}</dd></div>
      <div><dt>시행일</dt><dd>{source.effectiveDate ?? '명시된 시행일 없음'}</dd></div>
      <div><dt>자료 확인 기준일</dt><dd>{source.inspectedAsOf}</dd></div>
      {excerpt.pdfPages !== null && <div><dt>PDF 페이지</dt><dd>{excerpt.pdfPages.join(', ') || '명시 없음'}</dd></div>}
      {excerpt.printedPages !== null && <div><dt>인쇄 쪽 번호</dt><dd>{excerpt.printedPages.join(', ') || '명시 없음'}</dd></div>}
    </dl>
    <p className={s.body}>적용 범위: {source.scope}</p>
    <p className={s.body}>실제 읽은 범위: {source.readScope}</p>
    <p><a href={source.url} target="_blank" rel="noopener noreferrer">{source.authority === 'industry_guidance' ? '업계 지침 원문' : '공식 원문'} 열기 (새 창)</a></p>
    <h5>일본어 원문 발췌</h5>
    <blockquote className={s.quote} lang="ja">{excerpt.japanese}</blockquote>
    {excerpt.contextNote && <p className={s.body}>문맥 설명: {excerpt.contextNote}</p>}
    <h5>한국어 비공식 번역</h5>
    {translation ? <>
      <p className={s.badge}>{translation.status === 'human_reviewed' ? '사람 검수 기록 있음' : '기계 번역 · 사람 검수 전'}</p>
      <p className={s.body} lang="ko">{translation.korean}</p>
      <p className={s.meta}>사전 정렬 번역 v{translation.version} · 공식 번역이나 외부 전문가의 법률 승인이 아닙니다.</p>
      {translation.status === 'human_reviewed' && <p className={s.meta}>검수자 {translation.reviewer} · 검수일 {translation.reviewedAt}</p>}
    </> : <p className={s.notice}>이 원문 버전에 정렬된 한국어 번역이 없습니다. 다른 버전의 번역으로 대체하지 않습니다.</p>}
    <details className={s.records}><summary>출처·버전 식별 정보</summary>
      <dl className={s.facts}>
        <div><dt>출처 ID</dt><dd>{source.sourceId}</dd></div>
        <div><dt>출처 버전 ID</dt><dd>{source.id}</dd></div>
        <div><dt>발췌 ID</dt><dd>{excerpt.id}</dd></div>
        <div><dt>원문 해시</dt><dd>{source.originalHash}</dd></div>
        <div><dt>일본어 발췌 해시</dt><dd>{excerpt.japaneseHash}</dd></div>
        <div><dt>원문 URL</dt><dd>{source.url}</dd></div>
        {translation && <><div><dt>번역 ID</dt><dd>{translation.id}</dd></div><div><dt>번역 해시</dt><dd>{translation.koreanHash}</dd></div></>}
      </dl>
    </details>
  </article>;
}

export function EvidencePanels({ legalBasis, supportingGuidance }: {
  legalBasis: Citation[]; supportingGuidance: Citation[];
}) {
  return <div className={s.stack}>
    <section className={s.section} aria-label="공식 법적 근거"><h3>공식 법적 근거</h3>
      <p className={s.meta}>법령·공식 통지의 해당 위치입니다. 후보의 위법 여부를 확정하지 않습니다.</p>
      {legalBasis.length ? <div className={s.stack}>{legalBasis.map((entry, i) => <CorpusEntryView key={`${entry.excerpt.id}:${i}`} entry={entry}/>)}</div> : <p className={s.notice}>확인된 공식 근거 위치가 없습니다. 사람의 추가 확인이 필요합니다.</p>}
    </section>
    <section className={s.section} aria-label="보조 지침"><h3>보조 지침</h3>
      <p className={s.meta}>업계 자율 지침입니다. 공식 법적 근거와 구속력·적용 범위를 구분해 확인해 주세요.</p>
      {supportingGuidance.length ? <div className={s.stack}>{supportingGuidance.map((entry, i) => <CorpusEntryView key={`${entry.excerpt.id}:${i}`} entry={entry}/>)}</div> : <p>연결된 보조 지침이 없습니다.</p>}
    </section>
  </div>;
}

/** Current selection only. Historical findings render their own immutable citations separately. */
export function CorpusSelectionView({ selection }: { selection: CorpusSelection }) {
  const official = selection.entries.filter(entry => entry.source.authority !== 'industry_guidance');
  const supporting = selection.entries.filter(entry => entry.source.authority === 'industry_guidance');
  return <section className={s.panel} aria-label="현재 선택된 근거 자료">
    <h2>현재 선택된 근거 자료</h2>
    <p>사용 가능한 발췌 {selection.entries.length}건 · 원문 개정으로 제외된 발췌 {selection.excludedStaleExcerptIds.length}건</p>
    {selection.excludedStaleExcerptIds.length > 0 && <p className={s.notice}>제외된 원문과 번역은 현행 근거로 사용하지 않습니다. 과거 실행의 당시 기록과 구분됩니다.</p>}
    {!selection.entries.length && <p className={s.notice}>사용할 근거가 없습니다. 근거 부족은 적법 확인이 아닙니다.</p>}
    <div className={s.stack}>
      <section aria-label="현재 공식 근거"><h3>공식 법적 근거</h3>{official.length ? official.map(entry => <CorpusEntryView key={entry.excerpt.id} entry={entry}/>) : <p>선택된 공식 근거 없음</p>}</section>
      <section aria-label="현재 보조 지침"><h3>보조 지침</h3>{supporting.length ? supporting.map(entry => <CorpusEntryView key={entry.excerpt.id} entry={entry}/>) : <p>선택된 보조 지침 없음</p>}</section>
    </div>
    <details className={s.records}><summary>근거 자료 묶음 기록</summary><p>공개 버전 {selection.releaseId}</p><p>묶음 해시 {selection.manifestHash}</p>
      {selection.excludedStaleExcerptIds.length > 0 && <><p>현행 선택에서 제외된 발췌 ID</p><ul>{selection.excludedStaleExcerptIds.map(id => <li key={id}>{id}</li>)}</ul></>}
    </details>
  </section>;
}
