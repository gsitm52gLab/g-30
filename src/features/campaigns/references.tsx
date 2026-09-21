'use client';
import Link from 'next/link';
import type { SubmittedReference } from '@/domain/campaigns/types';
import type { Controller } from './controller';
import type { CampaignDetail } from './model';
import s from './ui.module.css';
export function ReferencePicker({ c, value, onChange, requirementKey, kind }: {
    c: Controller;
    value: SubmittedReference | null;
    onChange: (x: SubmittedReference | null) => void;
    requirementKey?: string;
    kind?: string;
}) {
    const submissions = c.state.data?.detail?.submissions ?? [], sub = submissions.find(x => x.id === value?.submissionId);
    const choices = submissions.flatMap(v => v.answers.filter(a => !requirementKey || a.requirementKey === requirementKey).filter(a => !kind || kind === 'custom' || a.type === (kind === 'publication_url' ? 'link' : 'file')).map(a => ({ label: `제출 v${v.sequence} · 요청 v${v.request.sequence} · ${v.request.content.requirements.find(q => q.key === a.requirementKey)?.label ?? '이전 항목'} · ${a.productId ? v.products.find(p => p.productId === a.productId)?.common.name ?? '상품별' : '공통'}`, value: { taskId: v.taskId, requestId: v.requestId, submissionId: v.id, contentHash: v.contentHash, answer: { requirementKey: a.requirementKey, productId: a.productId }, fileVersionIds: a.type === 'file' ? a.input.fileVersionIds : a.type === 'physical_record' ? a.input.evidenceFileVersionIds : a.type === 'link' && a.input.fixedReference?.kind === 'file' ? [a.input.fixedReference.fileVersionId] : [], productUseIds: v.products.filter(p => !a.productId || p.productId === a.productId).map(p => p.id) } as SubmittedReference })));
    if (!requirementKey)
        for (const v of submissions)
            choices.push({ label: `제출 v${v.sequence} · 요청 v${v.request.sequence} · 제출 전체 첨부`, value: { taskId: v.taskId, requestId: v.requestId, submissionId: v.id, contentHash: v.contentHash, answer: null, fileVersionIds: v.content.artifacts.filter(x => x.answer === null).map(x => x.fileVersionId), productUseIds: v.products.map(p => p.id) } });
    const match = (x: SubmittedReference) => JSON.stringify([x.submissionId, x.answer]) === JSON.stringify([value?.submissionId, value?.answer]), index = choices.findIndex(x => match(x.value));
    return <fieldset className={s.sub}><legend>정확한 제출·답변 참조</legend><label className={s.field}>제출한 자료 선택<select value={index < 0 ? '' : String(index)} onChange={e => onChange(e.target.value === '' ? null : structuredClone(choices[Number(e.target.value)].value))}><option value="">실제 제출 선택</option>{choices.map((x, i) => <option value={i} key={i}>{x.label}</option>)}</select></label>{!choices.length && <p className={s.hint}>호환되는 실제 제출이 없습니다. 업무 화면에서 해당 답변·파일을 제출한 후 다시 확인하세요. 업로드만 한 파일은 선택할 수 없습니다.</p>}{value && sub && <><p>제출 v{sub.sequence} · {sub.submittedAt} · {sub.recorderLabel}</p>{choices[index]?.value.fileVersionIds.map(id => <label className={s.check} key={id}><input type="checkbox" checked={value.fileVersionIds.includes(id)} onChange={e => onChange({ ...value, fileVersionIds: e.target.checked ? [...value.fileVersionIds, id] : value.fileVersionIds.filter(x => x !== id) })}/>{sub.files.find(f => f.id === id)?.name ?? '제출 파일'} · 정확한 파일 버전</label>)}{choices[index]?.value.productUseIds.map(id => { const p = sub.products.find(x => x.id === id); return <label className={s.check} key={id}><input type="checkbox" checked={value.productUseIds.includes(id)} onChange={e => onChange({ ...value, productUseIds: e.target.checked ? [...value.productUseIds, id] : value.productUseIds.filter(x => x !== id) })}/>{p?.common.name} · 당시 상품 사용본</label>; })}<details><summary>고정한 버전·해시</summary><p className={s.hint}>{value.requestId}<br />{value.submissionId}<br />{value.contentHash}</p>{sub.products.filter(p => value.productUseIds.includes(p.id)).map(p => <p className={s.hint} key={p.id}>{p.common.name} · {p.productVersionId} · {p.contextProductVersionId}</p>)}</details></>}</fieldset>;
}
type Reference = CampaignDetail['progress'][number]['followups'][number]['facts'][number]['source'];
export function ReferenceView({ value }: {
    value: Reference;
}) { return <div className={s.sub}><Link href={value.taskUrl}>제출 v{value.submissionSequence} · 정확한 {value.answer ? '답변' : '제출'} 보기 ↗</Link>{value.files.map(f => <div className={s.file} key={f.id}><strong>{f.name}</strong><div className={s.actions}><a href={f.downloadUrl}>다운로드</a><a href={f.originalUrl}>원본</a>{f.previewUrl && <a href={f.previewUrl}>미리보기</a>}</div><p className={s.hint}>업로더·시각: 이 참조 응답에서 제공하지 않음 · 파일 {f.id}</p></div>)}{value.products.map(p => <details key={p.id}><summary>{p.common.name} · 제출 당시 상품</summary><p className={s.hint}>상품 버전 {p.productVersionId}<br />컨텍스트 버전 {p.contextProductVersionId}<br />내용 해시 {p.contentHash}</p></details>)}</div>; }
