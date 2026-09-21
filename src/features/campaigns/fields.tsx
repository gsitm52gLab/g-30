'use client';
import type { SourceText } from '@/domain/campaigns/types';
import type { Provider, DateInput } from '@/domain/submissions/types';
import type { Controller } from './controller';
import s from './ui.module.css';
export function Field({ label, value, onChange, multiline = false, required = false, type = 'text' }: {
    label: string;
    value: string;
    onChange: (v: string) => void;
    multiline?: boolean;
    required?: boolean;
    type?: string;
}) { return <label className={s.field}>{label}{multiline ? <textarea value={value} required={required} onChange={e => onChange(e.target.value)}/> : <input type={type} value={value} required={required} onChange={e => onChange(e.target.value)}/>}</label>; }
export const blankSource = (): SourceText => ({ source: '', sourceVersion: '', locator: '', language: '', originalText: '', translatedText: '', fileVersionIds: [] });
export function SourceEditor({ value, onChange, files }: {
    value: SourceText;
    onChange: (v: SourceText) => void;
    files: {
        id: string;
        name: string;
    }[];
}) { return <div className={s.stack}><div className={s.grid}>{(['source', 'sourceVersion', 'locator', 'language'] as const).map((key, i) => <Field key={key} label={['출처', '출처 버전', '페이지·위치', '원문 언어'][i]} value={value[key]} onChange={v => onChange({ ...value, [key]: v })}/>)}</div><Field label="원문 (GSG 내부)" multiline value={value.originalText} onChange={v => onChange({ ...value, originalText: v })}/><Field label="번역 (GSG 내부)" multiline value={value.translatedText} onChange={v => onChange({ ...value, translatedText: v })}/><fieldset className={s.sub}><legend>원문 파일 연결</legend>{files.length ? files.map(f => <label className={s.check} key={f.id}><input type="checkbox" checked={value.fileVersionIds.includes(f.id)} onChange={e => onChange({ ...value, fileVersionIds: e.target.checked ? [...value.fileVersionIds, f.id] : value.fileVersionIds.filter(x => x !== f.id) })}/>{f.name}</label>) : <p className={s.hint}>연결할 원문 파일이 없습니다. 아래 업로드 후 선택할 수 있습니다.</p>}</fieldset></div>; }
export function ProviderEditor({ label, value, onChange, c, external = true }: {
    label: string;
    value: Provider;
    onChange: (p: Provider) => void;
    c: Controller;
    external?: boolean;
}) { const d = c.state.data!; const members = d.task.canManage ? d.catalog.members : d.catalog.members.filter(m => m.id === d.catalog.userId); return <fieldset className={s.sub}><legend>{label}</legend><label className={s.field}>출처 구분<select value={value.kind} onChange={e => onChange(e.target.value === 'user' ? { kind: 'user', userId: d.catalog.userId } : { kind: 'external_source', label: '', source: '' })}><option value="user">현재 참여자</option>{external && <option value="external_source">외부 수행자·기관</option>}</select></label>{value.kind === 'user' ? <label className={s.field}>참여자<select required value={members.some(m => m.id === value.userId) ? value.userId : ''} onChange={e => onChange({ kind: 'user', userId: e.target.value })}><option value="" disabled>현재 컨텍스트 참여자 선택</option>{members.map(m => <option value={m.id} key={m.id}>{m.name}</option>)}</select></label> : <div className={s.grid}><Field label="외부 이름·기관" required value={value.label} onChange={label => onChange({ ...value, label })}/><Field label="외부 기록 출처" required value={value.source} onChange={source => onChange({ ...value, source })}/></div>}</fieldset>; }
export function ObservedEditor({ value, onChange }: {
    value: DateInput | null;
    onChange: (v: DateInput | null) => void;
}) { return <fieldset className={s.sub}><legend>실제 발생 일시</legend><label className={s.check}><input type="checkbox" checked={value === null} onChange={e => onChange(e.target.checked ? null : { value: '', precision: 'date', timezone: 'Asia/Seoul' })}/>일시 미확인</label>{value && <div className={s.grid}><label className={s.field}>정밀도<select value={value.precision} onChange={e => onChange({ ...value, precision: e.target.value as DateInput['precision'], value: '' })}><option value="date">날짜</option><option value="datetime">날짜·시각</option></select></label><Field label="발생 날짜·시각" type={value.precision === 'date' ? 'date' : 'text'} required value={value.value} onChange={v => onChange({ ...value, value: v })}/><Field label="시간대" required value={value.timezone} onChange={timezone => onChange({ ...value, timezone })}/></div>}</fieldset>; }
