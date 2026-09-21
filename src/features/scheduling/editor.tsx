'use client';
import { useId } from 'react';
import type { Deadline, ScheduleContent } from '@/domain/scheduling/types';
import { scheduleKinds } from '@/domain/scheduling/types';
import { certaintyLabels, kindLabels, type DateTimeFields, type SelectOption } from './presentation';
import { SourcesEditor } from './sources-editor';
import s from './ui.module.css';
interface Props {
    value: ScheduleContent;
    onChange: (value: ScheduleContent) => void;
    /** Kept by the controller, including incomplete input. Never infer a timezone offset from the browser. */
    dateTime: DateTimeFields;
    onDateTimeChange: (value: DateTimeFields) => void;
    tasks: SelectOption[];
    responsibleOptions: SelectOption[];
    responsibilityHelp: string;
    responsibilityLabel?: string;
    disabled?: boolean;
    taskLocked?: boolean;
    canSelectInternal: boolean;
    error?: string | null;
}
export function ScheduleEditor({ value, onChange, dateTime, onDateTimeChange, tasks, responsibleOptions, responsibilityHelp, responsibilityLabel = "일정 확인 책임자", disabled = false, taskLocked = false, canSelectInternal, error }: Props) {
    const id = useId(), d = value.deadline;
    const set = <K extends keyof ScheduleContent>(key: K, next: ScheduleContent[K]) => onChange({ ...value, [key]: next });
    const deadline = <K extends keyof Deadline>(key: K, next: Deadline[K]) => set('deadline', { ...d, [key]: next });
    return <fieldset className={s.editor} disabled={disabled} aria-describedby={error ? `${id}-error` : undefined}><legend>일정 정보</legend>
    {error && <p id={`${id}-error`} role="alert" className={s.error}>{error}</p>}
    <div className={s.grid}>
      <label className={`${s.field} ${s.wide}`}>일정 제목<input required maxLength={200} value={value.title} onChange={e => set('title', e.target.value)}/></label>
      <label className={s.field}>연결 업무<select required disabled={taskLocked} value={value.taskId} onChange={e => set('taskId', e.target.value)}><option value="">업무 선택</option>{value.taskId && !tasks.some(t => t.id === value.taskId) && <option value={value.taskId} disabled>이전 업무 · 현재 접근 확인 필요</option>}{tasks.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}</select></label>
      <label className={s.field}>일정 종류<select value={value.kind} onChange={e => set('kind', e.target.value as ScheduleContent['kind'])}>{scheduleKinds.map(kind => <option value={kind} key={kind}>{kindLabels[kind]}</option>)}</select></label>
      <label className={s.field}>공개 범위<select disabled={!canSelectInternal} value={value.visibility} onChange={e => set('visibility', e.target.value as ScheduleContent['visibility'])}><option value="public">컨텍스트 공개</option>{(canSelectInternal || value.visibility === 'internal') && <option value="internal">GSG 내부</option>}</select></label>
      <label className={s.field}>{responsibilityLabel}<select required value={d.responsibleUserId} onChange={e => deadline('responsibleUserId', e.target.value)}><option value="">책임자 선택</option>{d.responsibleUserId && !responsibleOptions.some(a => a.id === d.responsibleUserId) && <option value={d.responsibleUserId} disabled>이전 책임자 · 현재 허용 목록 확인 필요</option>}{responsibleOptions.map(a => <option key={a.id} value={a.id}>{a.label}</option>)}</select></label>
      <p className={`${s.hint} ${s.wide}`}>{responsibilityHelp}</p>
    </div>
    <fieldset className={s.sub}><legend>날짜와 확정 수준</legend><div className={s.grid}>
      <label className={s.check}><input type="checkbox" checked={d.value === null} onChange={e => deadline('value', e.target.checked ? null : '')}/>날짜 미정</label>
      <label className={s.field}>날짜 정밀도<select value={d.precision} onChange={e => set('deadline', { ...d, precision: e.target.value as Deadline['precision'], value: d.value === null ? null : '' })}><option value="date">날짜만</option><option value="datetime">날짜와 시각</option></select><span className={s.hint}>정밀도를 바꾸면 날짜를 다시 입력해 주세요.</span></label>
      {d.value !== null && (d.precision === 'date' ? <label className={s.field}>날짜<input type="date" required value={d.value} onChange={e => deadline('value', e.target.value)}/></label> : <><label className={s.field}>현지 날짜와 시각<input type="datetime-local" step="1" required value={dateTime.local} onChange={e => onDateTimeChange({ ...dateTime, local: e.target.value })}/></label><label className={s.field}>원문의 UTC 오프셋<input required value={dateTime.offset} onChange={e => onDateTimeChange({ ...dateTime, offset: e.target.value })} placeholder="+09:00 또는 Z" pattern="Z|[+-][0-9]{2}:[0-9]{2}" maxLength={6}/><span className={s.hint}>서머타임 중복 시각은 명시한 오프셋으로 구분합니다.</span></label></>)}
      <label className={s.field}>IANA 시간대<input required value={d.timezone} onChange={e => deadline('timezone', e.target.value)} placeholder="Asia/Tokyo" maxLength={100}/></label>
      <label className={s.field}>확정 수준<select value={d.certainty} onChange={e => deadline('certainty', e.target.value as Deadline['certainty'])}>{Object.entries(certaintyLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <label className={s.field}>일정 출처·확인 상대<input value={d.source} onChange={e => deadline('source', e.target.value)} maxLength={1000}/></label>
      <label className={s.field}>출처 버전<input value={d.sourceVersion} onChange={e => deadline('sourceVersion', e.target.value)} maxLength={200}/></label>
      <label className={`${s.field} ${s.wide}`}>원문 날짜·확인 내용<textarea value={d.raw} onChange={e => deadline('raw', e.target.value)} maxLength={2000}/></label>
    </div></fieldset>
    <SourcesEditor value={value} onChange={patch => onChange({ ...value, ...patch })}/>
  </fieldset>;
}
