import type { Deadline, ScheduleContent } from '@/domain/scheduling/types';
import { certaintyLabels, kindLabels, type ScheduleHistoryEntry, type SchedulePresentation } from './presentation';
import s from './ui.module.css';
export function DeadlineFacts({ deadline, confirmationActorLabel }: { deadline: Deadline; confirmationActorLabel: string }) {
  return <dl className={s.meta}><dt>일정</dt><dd>{deadline.value === null ? '날짜 미정' : <time dateTime={deadline.value}>{deadline.value}</time>} <span className={s.badge} data-certainty={deadline.certainty}>{certaintyLabels[deadline.certainty]}</span></dd><dt>시간대·정밀도</dt><dd>{deadline.timezone} · {deadline.precision === 'date' ? '날짜만' : '날짜와 시각'}</dd><dt>확인 책임자</dt><dd>{confirmationActorLabel || '확인 필요'}</dd><dt>출처·확인 상대</dt><dd>{deadline.source || '출처 확인 필요'}{deadline.sourceVersion && ` · ${deadline.sourceVersion}`}</dd>{deadline.raw && <><dt>원문 날짜</dt><dd className={s.prose}>{deadline.raw}</dd></>}</dl>;
}
export function SourceFacts({ content }: { content: Pick<ScheduleContent, 'statements' | 'conflicts'> }) {
  return <div className={s.stack}>{content.statements.length > 0 && <ol className={s.plainList}>{content.statements.map((statement, index) => <li className={s.sub} key={statement.id}><strong>원문 {index + 1} · {statement.source}</strong><p className={s.hint}>{statement.version || '버전 미기재'} · {statement.locator || '위치 미기재'}</p><p className={s.prose}>{statement.raw}</p></li>)}</ol>}{content.conflicts.map((conflict, index) => <section className={conflict.state === 'unresolved' ? s.warning : s.note} key={conflict.id}><strong>충돌 {index + 1} · {conflict.state === 'unresolved' ? '미해소' : '해소 근거 기록'}</strong><p>{conflict.statementIds.map(id => { const n = content.statements.findIndex(x => x.id === id); return n < 0 ? '원문 확인 필요' : `원문 ${n + 1}`; }).join(' · ')}</p><p className={s.prose}>{conflict.resolution || '해소 근거가 아직 없습니다.'}</p></section>)}</div>;
}
export function ScheduleCard({ item }: { item: SchedulePresentation }) {
  const conflicting = item.content.conflicts.some(c => c.state === 'unresolved');
  return <article className={s.panel}><div className={s.row}><span className={s.badge}>{kindLabels[item.content.kind]}</span><span className={s.badge}>{item.content.visibility === 'internal' ? 'GSG 내부' : '컨텍스트 공개'}</span><span className={s.hint}>{item.activityLabel}</span></div>
    <h3 className={s.title}>{item.detailHref ? <a href={item.detailHref}>{item.content.title}</a> : item.content.title}</h3>
    <p>{item.taskHref ? <a className={s.link} href={item.taskHref}>{item.taskLabel}</a> : item.taskLabel}</p>
    <DeadlineFacts deadline={item.content.deadline} confirmationActorLabel={item.confirmationActorLabel}/>
    {conflicting && <p className={s.warning}>원문 일정이 충돌합니다. 출처와 해소 근거를 확인해 주세요.</p>}
    <dl className={s.meta}><dt>다음 행동</dt><dd>{item.nextAction || '현재 상태 확인'}</dd><dt>행동 담당</dt><dd>{item.actionOwnerLabels.length ? item.actionOwnerLabels.join(' · ') : '담당자 확인 필요'}<span className={s.blockHint}>{item.recipientPolicyLabel}</span></dd><dt>알림 기준</dt><dd>{item.reminderLabel}{item.calendar && <span className={s.blockHint}>기준일 {item.calendar.localToday} · {item.content.deadline.timezone}</span>}</dd></dl>
    <details className={s.details}><summary>출처·원문과 충돌 보기</summary><p>{item.sourceHref ? <a className={s.link} href={item.sourceHref}>{item.sourceLabel}</a> : item.sourceLabel}</p><SourceFacts content={item.content}/></details>
  </article>;
}
export type ScheduleViewState = { status: 'loading' } | { status: 'denied'; message: string } | { status: 'error'; message: string } | { status: 'ready'; groups: { key: string; label: string; items: SchedulePresentation[] }[]; emptyMessage: string };
/** Controller supplies authorized groups/order. No date inference, dependency scheduling, filtering or stale cache here. */
export function ScheduleTimeline({ state }: { state: ScheduleViewState }) {
  if (state.status === 'loading') return <p className={s.note} role="status">일정을 불러오는 중입니다.</p>;
  if (state.status === 'denied') return <section className={s.empty}><h2>일정을 볼 수 없습니다</h2><p>{state.message}</p></section>;
  if (state.status === 'error') return <p role="alert" className={s.error}>{state.message}</p>;
  if (!state.groups.some(g => g.items.length)) return <section className={s.empty}><h2>표시할 일정이 없습니다</h2><p>{state.emptyMessage}</p></section>;
  return <div className={s.stack}>{state.groups.filter(g => g.items.length).map(group => <section className={s.stack} key={group.key}><div className={s.groupHeading}><h2>{group.label}</h2>{group.items.length > 1 && <span className={s.hint}>병렬 일정 {group.items.length}건</span>}</div><div className={s.timeline}>{group.items.map(item => <ScheduleCard item={item} key={item.id}/>)}</div></section>)}</div>;
}
export function ScheduleHistory({ entries }: { entries: ScheduleHistoryEntry[] }) {
  return <section className={s.panel}><h2>일정 변경 이력</h2>{entries.length ? <ol className={s.plainList}>{entries.map(entry => <li key={entry.id}><details className={s.details}><summary>{entry.versionLabel} · {entry.changedAtLabel} · {entry.actorLabel}</summary><p>{entry.changeLabel}</p><h3 className={s.title}>{entry.content.title}</h3><DeadlineFacts deadline={entry.content.deadline} confirmationActorLabel={entry.confirmationActorLabel}/><SourceFacts content={entry.content}/></details></li>)}</ol> : <p>표시할 변경 이력이 없습니다.</p>}</section>;
}
