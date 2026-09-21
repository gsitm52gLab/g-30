'use client';
import type { ScheduleContent } from '@/domain/scheduling/types';
import s from './ui.module.css';
type SourceFields = Pick<ScheduleContent, 'statements' | 'conflicts'>;
export function SourcesEditor({ value, onChange, disabled = false }: { value: SourceFields; onChange: (value: SourceFields) => void; disabled?: boolean }) {
  const update = (id: string, patch: Partial<SourceFields['statements'][number]>) => onChange({ ...value, statements: value.statements.map(x => x.id === id ? { ...x, ...patch } : x) });
  const changeConflict = (id: string, patch: Partial<SourceFields['conflicts'][number]>) => onChange({ ...value, conflicts: value.conflicts.map(x => x.id === id ? { ...x, ...patch } : x) });
  return <fieldset className={s.fieldset} disabled={disabled}><legend>출처 원문과 충돌</legend>
    <p className={s.hint}>서로 다른 원문은 각각 남겨 주세요. 충돌을 기록한 것만으로 날짜가 확정되지는 않습니다.</p>
    <div className={s.stack}>{value.statements.map((item, index) => <fieldset className={s.sub} key={item.id}><legend>출처 원문 {index + 1}</legend>
      <div className={s.grid}>
        <label className={`${s.field} ${s.wide}`}>원문<textarea required maxLength={4000} value={item.raw} onChange={e => update(item.id, { raw: e.target.value })}/></label>
        <label className={s.field}>출처·확인 상대<input required maxLength={1000} value={item.source} onChange={e => update(item.id, { source: e.target.value })}/></label>
        <label className={s.field}>원문 버전<input maxLength={200} value={item.version} onChange={e => update(item.id, { version: e.target.value })}/></label>
        <label className={`${s.field} ${s.wide}`}>원문 위치<input maxLength={500} value={item.locator} placeholder="문서 3쪽, 이메일 날짜·문단 등" onChange={e => update(item.id, { locator: e.target.value })}/></label>
      </div><div className={s.actions}><button type="button" className="button subtle" disabled={value.conflicts.some(x => x.statementIds.includes(item.id))} onClick={() => onChange({ ...value, statements: value.statements.filter(x => x.id !== item.id) })}>원문 {index + 1} 삭제</button>{value.conflicts.some(x => x.statementIds.includes(item.id)) && <span className={s.hint}>삭제하려면 아래 충돌 연결에서 먼저 해제해 주세요.</span>}</div>
    </fieldset>)}</div>
    <div className={s.actions}><button type="button" className="button subtle" disabled={value.statements.length >= 40} onClick={() => onChange({ ...value, statements: [...value.statements, { id: crypto.randomUUID(), raw: '', source: '', version: '', locator: '' }] })}>출처 원문 추가</button></div>
    {value.conflicts.map((conflict, index) => <fieldset className={s.sub} key={conflict.id}><legend>일정 충돌 {index + 1}</legend>
      <p className={s.hint}>서로 충돌하는 원문을 둘 이상 선택해 주세요.</p>
      {value.statements.map((item, n) => <label className={s.check} key={item.id}><input type="checkbox" checked={conflict.statementIds.includes(item.id)} onChange={e => changeConflict(conflict.id, { statementIds: e.target.checked ? [...conflict.statementIds, item.id] : conflict.statementIds.filter(id => id !== item.id) })}/><span>원문 {n + 1} · {item.source || '출처 입력 필요'} {item.version}</span></label>)}
      {conflict.statementIds.length < 2 && <p className={s.warning}>연결된 원문이 둘 미만입니다. 저장 전에 원문을 선택해 주세요.</p>}
      <div className={s.grid}><label className={s.field}>충돌 확인 상태<select value={conflict.state} onChange={e => changeConflict(conflict.id, { state: e.target.value as typeof conflict.state })}><option value="unresolved">미해소</option><option value="resolved">해소 근거 기록</option></select></label>
        <label className={`${s.field} ${s.wide}`}>해소 근거·남은 확인<textarea maxLength={2000} required={conflict.state === 'resolved'} value={conflict.resolution} onChange={e => changeConflict(conflict.id, { resolution: e.target.value })}/></label></div>
      <button type="button" className="button subtle" onClick={() => onChange({ ...value, conflicts: value.conflicts.filter(x => x.id !== conflict.id) })}>충돌 {index + 1} 삭제</button>
    </fieldset>)}
    <div className={s.actions}><button type="button" className="button subtle" disabled={value.statements.length < 2 || value.conflicts.length >= 20} onClick={() => onChange({ ...value, conflicts: [...value.conflicts, { id: crypto.randomUUID(), statementIds: [], state: 'unresolved', resolution: '' }] })}>원문 충돌 추가</button>{value.statements.length < 2 && <span className={s.hint}>원문이 둘 이상 있어야 충돌을 연결할 수 있습니다.</span>}</div>
  </fieldset>;
}
