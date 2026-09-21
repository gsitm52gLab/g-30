import type { ExtractionSnapshot, ReadUnit } from '@/domain/ai-input/types';
import { issueLabel, stateLabel } from '@/features/ai-input/model';
import s from './ui.module.css';

function unitPosition(unit: Pick<ReadUnit, 'sourceId' | 'page' | 'imageIndex'>) {
  return `${unit.sourceId}${unit.page !== null ? ` · PDF ${unit.page}쪽` : unit.imageIndex !== null ? ` · 이미지 ${unit.imageIndex + 1}` : ' · 입력 텍스트'}`;
}

/** Shows the immutable extraction coverage; does not imply all selected units were read. */
export function ReadCoverage({ snapshot, sourceLabels = {} }: { snapshot: ExtractionSnapshot; sourceLabels?: Readonly<Record<string, string>> }) {
  const position = (unit: Pick<ReadUnit, 'sourceId' | 'page' | 'imageIndex'>) => unitPosition({...unit, sourceId: sourceLabels[unit.sourceId] ?? '저장된 원본'});
  return <section className={s.panel} aria-label="분석 대상의 실제 읽은 범위">
    <h2>선택 범위와 실제 읽은 범위</h2>
    <p>{stateLabel[snapshot.status]} · 읽지 못했거나 선택하지 않은 구간은 검토 결과에 포함되지 않습니다.</p>
    <dl className={s.facts}>{(['read', 'partial', 'unread', 'unselected'] as const).map(status => <div key={status}><dt>{stateLabel[status]}</dt><dd>{snapshot.units.filter(unit => unit.status === status).length}개 구간</dd></div>)}</dl>
    <section className={s.section}><h3>명시적으로 선택한 범위</h3>
      {snapshot.selected.length ? <ul>{snapshot.selected.map((selected, i) => <li key={`${selected.sourceId}:${i}`}>{sourceLabels[selected.sourceId] ?? '저장된 원본'} · {selected.pages !== null ? `PDF ${selected.pages.join(', ')}쪽` : selected.imageIndex !== null ? `이미지 ${selected.imageIndex + 1}` : '입력 텍스트'}</li>)}</ul> : <p>선택된 범위 없음</p>}
    </section>
    {snapshot.issues.length > 0 && <ul>{snapshot.issues.map(issue => <li key={issue}>{issueLabel[issue]}</li>)}</ul>}
    <div className={s.stack}>{snapshot.units.map((unit, index) => <article className={s.evidence} key={index} aria-label={position(unit)}>
      <h3>{position(unit)}</h3><p>{stateLabel[unit.status]} · {({ plain_text: '입력 텍스트', pdf_text_layer: 'PDF 텍스트 계층', ocr_partial: 'OCR 일부 읽기', none: '읽은 내용 없음' })[unit.coverage]}</p>
      {unit.status === 'partial' && <p className={s.notice}>일부 읽기 결과입니다. 이 구간 전체를 읽었다고 확인하지 않습니다.</p>}
      {unit.status === 'unselected' && <p>선택에서 제외되어 읽기를 수행하지 않았습니다.</p>}
      {unit.unread.map((unread, i) => <p key={i}>{issueLabel[unread.code]}{unread.confidence === null ? '' : ` · 문자 인식 신뢰도 ${unread.confidence.toFixed(1)} / 100`}{unread.location?.box ? ` · 구간 x ${unread.location.box.x}, y ${unread.location.box.y}, 너비 ${unread.location.box.width}, 높이 ${unread.location.box.height} ${unread.location.box.unit}` : ''}</p>)}
    </article>)}</div>
    <details className={s.records}><summary>읽기 범위 기록</summary><p>읽기 결과 해시 {snapshot.snapshotHash}</p><p>읽은 문자 {snapshot.characterCount} · 문자 위치 기준 UTF-16</p>{snapshot.sources.map(source => <p key={source.sourceId}>원본 {source.sourceId} / 버전 {source.versionId} / 해시 {source.sha256}</p>)}</details>
  </section>;
}
