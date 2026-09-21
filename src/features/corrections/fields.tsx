'use client';
import { useEffect, useState, type ReactNode } from 'react';
import type { ReviewTarget, OpinionSource } from '@/server/corrections/contracts';
import type { SubmissionSnapshot } from '@/server/submissions/contracts';
import type { Workspace } from './model';
import type { Controller } from './controller';
import { request } from './client';
import { targetFor } from './model';
import { SnapshotView, SubmissionFile } from '@/features/submissions/views';
import s from './ui.module.css';
export function Field({ label, value, onChange, multiline = false, max = 5000, type = 'text', required = false }: {
    label: string;
    value: string;
    onChange: (v: string) => void;
    multiline?: boolean;
    max?: number;
    type?: string;
    required?: boolean;
}) { return <label className={s.field}>{label}{multiline ? <textarea value={value} onChange={e => onChange(e.target.value)} maxLength={max} required={required}/> : <input type={type} value={value} onChange={e => onChange(e.target.value)} maxLength={max} required={required}/>}</label>; }
export function Select({ label, value, onChange, children }: {
    label: string;
    value: string;
    onChange: (v: string) => void;
    children: ReactNode;
}) { return <label className={s.field}>{label}<select value={value} onChange={e => onChange(e.target.value)}>{children}</select></label>; }
export function Checks({ label, value, onChange, options }: {
    label: string;
    value: string[];
    onChange: (v: string[]) => void;
    options: {
        id: string;
        label: string;
    }[];
}) { return <fieldset className={s.checks}><legend>{label}</legend>{options.length ? options.map(o => <label key={o.id}><input type="checkbox" checked={value.includes(o.id)} onChange={e => onChange(e.target.checked ? [...value, o.id] : value.filter(v => v !== o.id))}/><span>{o.label}</span></label>) : <p className={s.hint}>선택할 기록이 없습니다.</p>}</fieldset>; }
export function SourceFields({ value: v, onChange }: {
    value: OpinionSource;
    onChange: (v: OpinionSource) => void;
}) { return <div className={s.stack}><Select label="의견 출처 유형" value={v.kind} onChange={kind => onChange(kind === 'external_opinion' ? { kind, agency: '', reviewer: v.kind === 'ai_candidate' ? '' : v.reviewer, source: v.source } : { kind: 'internal_review', reviewer: v.kind === 'ai_candidate' ? '' : v.reviewer, source: v.source })}><option value="internal_review">내부 검토</option><option value="external_opinion">외부 기관 의견</option></Select><p className={s.hint}>AI 후보는 실제 실행 연결 전입니다. 현재 기록할 수 없습니다.</p><div className={s.grid}>{v.kind === 'external_opinion' && <Field label="기관" value={v.agency} onChange={agency => onChange({ ...v, agency })} required max={200}/>} {v.kind !== 'ai_candidate' && <Field label="검토자" value={v.reviewer} onChange={reviewer => onChange({ ...v, reviewer })} required max={200}/>}<Field label="원문 출처" value={v.source} onChange={source => onChange({ ...v, source })} required max={2000}/></div></div>; }
export function TargetView({ value: t, w }: {
    value: ReviewTarget;
    w: Workspace;
}) { const sub = w.submissions.find(v => v.id === t.submissionId), a = sub?.answers.find(a => a.requirementKey === t.answer?.requirementKey && a.productId === t.answer.productId); return <div className={s.target}><strong>제출 v{sub?.sequence ?? '확인 필요'} · {a?.label ?? '제출 전체'}</strong><p>{t.location.page ? `${t.location.page}쪽 · ` : ''}{t.location.locator || '위치 설명 없음'}</p><p className={s.hint}>{sub?.submittedAt} · 파일 {t.fileVersionIds.length}개 · 당시 상품 사용본 {t.productUseIds.length}개</p><details><summary>정확한 대상 식별 정보</summary><p className={s.mono}>제출 {t.submissionId}<br />요청 {t.requestId}<br />내용 해시 {t.submissionContentHash}<br />파일 {t.fileVersionIds.join(', ') || '없음'}<br />상품 사용본 {t.productUseIds.join(', ') || '없음'}</p></details></div>; }
export function TargetPicker({ w, value: t, onChange, guarded, minSequence = 0, answerLocked = false }: {
    w: Workspace;
    value: ReviewTarget;
    onChange: (v: ReviewTarget) => void;
    guarded: Controller['guarded'];
    minSequence?: number;
    answerLocked?: boolean;
}) {
    const [snapshot, setSnapshot] = useState<SubmissionSnapshot | null>(null), [loading, setLoading] = useState(false);
    useEffect(() => { let mounted = true; Promise.resolve().then(() => { if (mounted) {
        setLoading(true);
        setSnapshot(null);
    } }); void guarded(() => request<SubmissionSnapshot>(`/api/submissions/${encodeURIComponent(t.submissionId)}`)).then(v => { if (mounted) {
        setSnapshot(v);
        setLoading(false);
    } }); return () => { mounted = false; }; }, [t.submissionId, guarded]);
    const selected = w.submissions.find(v => v.id === t.submissionId), answer = snapshot?.answers.find(a => a.requirementKey === t.answer?.requirementKey && a.productId === t.answer.productId);
    let answerFileIds: string[] = [];
    if (answer?.type === 'file')
        answerFileIds = answer.input.fileVersionIds;
    if (answer?.type === 'link' && answer.input.fixedReference?.kind === 'file')
        answerFileIds = [answer.input.fixedReference.fileVersionId];
    if (t.answer && snapshot)
        answerFileIds.push(...snapshot.content.artifacts.filter(a => a.answer?.requirementKey === t.answer!.requirementKey && a.answer?.productId === t.answer!.productId).map(a => a.fileVersionId));
    const products = (selected?.products ?? []).filter(p => !t.answer?.productId || p.productId === t.answer.productId), productFiles = products.filter(p => t.productUseIds.includes(p.id)).flatMap(p => p.files.map(f => f.fileVersionId));
    const files = (selected?.files ?? []).filter(f => !t.answer || answerFileIds.includes(f.id) || productFiles.includes(f.id));
    return <fieldset className={s.target}><legend>정확한 제출 대상</legend><Select label="대상 제출 버전" value={t.submissionId} onChange={id => { const next = w.submissions.find(s => s.id === id); if (next)
        onChange({ ...targetFor(w, next), answer: answerLocked ? t.answer : null, location: t.location }); }}>{w.submissions.filter(v => v.sequence > minSequence).map(v => <option key={v.id} value={v.id}>제출 v{v.sequence} · {v.submittedAt}</option>)}</Select><p className={s.hint}>요청 {selected?.requestId} · 해시 {selected?.contentHash}</p><Select label="대상 답변 항목" value={t.answer ? JSON.stringify(t.answer) : ''} onChange={v => { if (!answerLocked)
        onChange({ ...t, answer: v ? JSON.parse(v) : null, fileVersionIds: [], productUseIds: [] }); }}>{!answerLocked && <option value="">제출 전체</option>}{(selected?.answers ?? []).filter(a => !answerLocked || a.requirementKey === t.answer?.requirementKey && a.productId === t.answer.productId).map(a => <option key={JSON.stringify([a.requirementKey, a.productId])} value={JSON.stringify({ requirementKey: a.requirementKey, productId: a.productId })}>{a.label} · {a.productId ? selected?.products.find(p => p.productId === a.productId)?.common.name ?? '상품별' : '공통'}</option>)}{answerLocked && !t.answer && <option value="">제출 전체</option>}</Select>
 <Checks label="당시 상품 사용본" value={t.productUseIds} onChange={productUseIds => onChange({ ...t, productUseIds, fileVersionIds: [] })} options={products.map(p => ({ id: p.id, label: `${p.common.name} · 상품 버전 ${p.productVersionId} · 사용본 ${p.id}` }))}/><Checks label="정확한 파일 버전" value={t.fileVersionIds} onChange={fileVersionIds => onChange({ ...t, fileVersionIds })} options={files.map(f => ({ id: f.id, label: `${f.name} · ${f.id}` }))}/><div className={s.grid}><Field label="페이지" value={t.location.page ?? ''} max={100} onChange={page => onChange({ ...t, location: { ...t.location, page: page || null } })}/><Field label="위치 설명" value={t.location.locator} max={2000} onChange={locator => onChange({ ...t, location: { ...t.location, locator } })}/></div>{files.filter(f => t.fileVersionIds.includes(f.id)).map(f => <SubmissionFile key={f.id} file={f}/>)}
 <details><summary>대상 제출 원문과 당시 상품 확인</summary>{loading ? <p>제출 원문 조회 중…</p> : snapshot ? <SnapshotView value={snapshot}/> : <p role="status">제출 원문을 확인하지 못했습니다. 최신 기록 재조회를 이용해 주세요.</p>}</details></fieldset>;
}
