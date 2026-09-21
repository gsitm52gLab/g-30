'use client';
import { useState } from 'react';
import type { Provider, DateInput } from '@/domain/submissions/types';
import type { ExternalAxis, ExternalFactInput, SubmittedReference, PhysicalFactInput, MenuIdentity } from '@/domain/campaigns/types';
import type { Controller } from './controller';
import { axisLabels, axisValues, stateLabels, identityKey } from './model';
import { Field, ProviderEditor, ObservedEditor, SourceEditor, blankSource } from './fields';
import { ReferencePicker } from './references';
import s from './ui.module.css';
function base(c: Controller, revision: number) { const d = c.state.data!.detail!; return { contextId: d.contextId, taskId: d.taskId, campaignId: d.id, campaignVersionId: d.selected!.id, expectedRevision: revision, idempotencyKey: crypto.randomUUID() }; }
function Conflict({ c, revision, onChange }: {
    c: Controller;
    revision: number;
    onChange: (v: number) => void;
}) { const current = c.state.data!.detail!.revision; return current === revision ? null : <div className={s.notice}><p>작성 기준 {revision}, 현재 기준 {current}. 현재 공개 조건과 진행 이력을 비교하세요. 입력은 유지됩니다.</p><button type="button" className="button subtle" disabled={c.locked} onClick={() => onChange(current)}>현재 내용 확인 · 새 기준 채택</button></div>; }
export function Participation({ c }: {
    c: Controller;
}) { const d = c.state.data!.detail!, formKey = 'participation:' + d.selected!.id, latest = d.selections[0]; type Value = {
    revision: number;
    response: 'participate' | 'decline' | 'discuss';
    keys: string[];
    providedBy: Provider;
    note: string;
}; const v = c.form<Value>(formKey, { revision: d.revision, response: latest?.response ?? 'participate', keys: latest?.selectedMenus.map(identityKey) ?? [], providedBy: { kind: 'user', userId: d.actorId }, note: '' }), set = (x: Value) => c.setForm(formKey, x); return <section className={s.panel}><h2>참여 의사와 메뉴 선택</h2><p className={s.notice}>선택은 외부 신청이나 선정이 아닙니다. 이미 신청한 메뉴를 해제하거나 불참하면 자동 취소 대신 취소 협의로 남깁니다.</p><form className={s.stack} onSubmit={e => { e.preventDefault(); void c.execute({ ...base(c, v.revision), command: 'participate', response: v.response, selectedMenus: v.response === 'participate' ? d.selected!.menus.filter(m => v.keys.includes(identityKey(m.identity))).map(m => m.identity) : [], providedBy: v.providedBy, note: v.note }, formKey); }}><fieldset className={`${s.fieldset} ${s.stack}`} disabled={c.locked || !d.capabilities.respond}><label className={s.field}>참여 회신<select value={v.response} onChange={e => set({ ...v, response: e.target.value as Value['response'] })}><option value="participate">참여</option><option value="decline">불참</option><option value="discuss">추가 협의</option></select></label>{v.response === 'participate' && <fieldset className={s.sub}><legend>참여할 메뉴</legend>{d.selected!.menus.map(m => <label className={s.check} key={identityKey(m.identity)}><input type="checkbox" checked={v.keys.includes(identityKey(m.identity))} onChange={e => set({ ...v, keys: e.target.checked ? [...v.keys, identityKey(m.identity)] : v.keys.filter(x => x !== identityKey(m.identity)) })}/>{m.identity.menuNumber} · {m.identity.menuName}</label>)}</fieldset>}{d.capabilities.manage && <ProviderEditor c={c} label="회신 제공자" value={v.providedBy} onChange={providedBy => set({ ...v, providedBy })}/>}<Field label="참여 회신 메모" multiline value={v.note} onChange={note => set({ ...v, note })}/><button className="button">참여 회신 저장</button></fieldset></form><Conflict c={c} revision={v.revision} onChange={revision => set({ ...v, revision })}/>{!d.capabilities.respond && <p>현재 담당·공동담당만 현재 공개본에 회신할 수 있습니다.</p>}</section>; }
export function External({ c }: {
    c: Controller;
}) { const d = c.state.data!.detail!, [index, setIndex] = useState(0), m = d.selected!.menus[index] ?? d.selected!.menus[0]; const formKey = 'external:' + d.selected!.id + ':' + identityKey(m.identity); type Value = {
    revision: number;
    fact: ExternalFactInput;
}; const v = c.form<Value>(formKey, { revision: d.revision, fact: { axis: 'application', value: 'applied', requester: { kind: 'user', userId: d.actorId }, performedBy: { kind: 'external_source', label: '', source: '' }, occurredAt: null, source: blankSource(), note: '' } }), set = (x: Value) => c.setForm(formKey, x); return <section className={s.panel}><h2>외부 진행 사실 기록</h2><p className={s.hint}>한 번에 한 상태만 기록합니다. 외부 신청자·실제 수행자와 플랫폼 기록자를 구분합니다.</p><label className={s.field}>진행을 기록할 메뉴<select value={index} disabled={c.locked} onChange={e => setIndex(Number(e.target.value))}>{d.selected!.menus.map((m, i) => <option value={i} key={identityKey(m.identity)}>{m.identity.menuName}</option>)}</select></label><form className={s.stack} onSubmit={e => { e.preventDefault(); void c.execute({ ...base(c, v.revision), command: 'external', menu: m.identity, fact: v.fact }, formKey); }}><fieldset className={`${s.fieldset} ${s.stack}`} disabled={c.locked}><div className={s.grid}><label className={s.field}>변경할 진행 축<select value={v.fact.axis} onChange={e => { const axis = e.target.value as ExternalAxis; set({ ...v, fact: { ...v.fact, axis, value: axisValues[axis][0] } as ExternalFactInput }); }}>{Object.entries(axisLabels).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label><label className={s.field}>실제 확인 상태<select value={v.fact.value} onChange={e => set({ ...v, fact: { ...v.fact, value: e.target.value } as ExternalFactInput })}>{axisValues[v.fact.axis].map(k => <option value={k} key={k}>{stateLabels[k]}</option>)}</select></label></div><ProviderEditor c={c} label="외부 진행 요청자" value={v.fact.requester} onChange={requester => set({ ...v, fact: { ...v.fact, requester } })}/><ProviderEditor c={c} label="외부 실제 수행자" value={v.fact.performedBy} onChange={performedBy => set({ ...v, fact: { ...v.fact, performedBy } })}/><ObservedEditor value={v.fact.occurredAt} onChange={occurredAt => set({ ...v, fact: { ...v.fact, occurredAt } })}/><SourceEditor value={v.fact.source} files={c.state.data!.task.files} onChange={source => set({ ...v, fact: { ...v.fact, source } })}/><Field label="외부 진행 기록 메모" multiline value={v.fact.note} onChange={note => set({ ...v, fact: { ...v.fact, note } })}/><button className="button">이 진행 사실 저장</button></fieldset></form><Conflict c={c} revision={v.revision} onChange={revision => set({ ...v, revision })}/></section>; }
interface PhysicalEditor {
    revision: number;
    kind: 'tracking' | 'dispatch' | 'receipt';
    quantity: string;
    carrier: string;
    trackingNumber: string;
    trackingUrl: string;
    dispatchFactIds: string[];
    performedBy: Provider;
    occurredAt: DateInput | null;
    evidence: SubmittedReference | null;
    note: string;
}
export function Physical({ c }: {
    c: Controller;
}) { const d = c.state.data!.detail!, options = d.progress.flatMap(m => m.physical.map(p => ({ menu: m.menu, p }))), [index, setIndex] = useState(0), o = options[index] ?? options[0]; if (!o)
    return <section className={s.panel}><h2>실물 기록</h2><p>이 공개 버전에는 실물 요청이 없습니다.</p></section>; return <PhysicalForm key={identityKey(o.menu) + o.p.definition.key} c={c} options={options} index={index} setIndex={setIndex}/>; }
function PhysicalForm({ c, options, index, setIndex }: {
    c: Controller;
    options: {
        menu: MenuIdentity;
        p: NonNullable<NonNullable<Controller['state']['data']>['detail']>['progress'][number]['physical'][number];
    }[];
    index: number;
    setIndex: (n: number) => void;
}) {
    const d = c.state.data!.detail!, o = options[index] ?? options[0], formKey = 'physical:' + d.selected!.id + ':' + o.p.definition.key, v = c.form<PhysicalEditor>(formKey, { revision: d.revision, kind: 'tracking', quantity: '', carrier: '', trackingNumber: '', trackingUrl: '', dispatchFactIds: [], performedBy: { kind: 'user', userId: d.actorId }, occurredAt: null, evidence: null, note: '' }), set = (x: PhysicalEditor) => c.setForm(formKey, x);
    return <section className={s.panel}><h2>실물 발송·수령 개별 기록</h2><p className={s.notice}>촬영·배포 목적지별 사실입니다. PDF·송장 등록은 수령 확인이 아닙니다. 수량을 입력해도 납품 완료를 추론하지 않습니다.</p><label className={s.field}>실물 목적지·용도<select disabled={c.locked} value={index} onChange={e => setIndex(Number(e.target.value))}>{options.map((x, i) => <option key={i} value={i}>{x.menu.menuName} · {x.p.definition.purpose} · {x.p.definition.destination} · 요청 {x.p.definition.requestedQuantity ?? '미정'} {x.p.definition.unit}</option>)}</select></label><form className={s.stack} onSubmit={e => { e.preventDefault(); const common = { performedBy: v.performedBy, occurredAt: v.occurredAt, evidence: v.evidence ? [v.evidence] : [], note: v.note }; const fact: PhysicalFactInput = v.kind === 'tracking' ? { ...common, kind: 'tracking', carrier: v.carrier, trackingNumber: v.trackingNumber, trackingUrl: v.trackingUrl || null } : v.kind === 'dispatch' ? { ...common, kind: 'dispatch', quantity: v.quantity, unit: o.p.definition.unit, carrier: v.carrier, trackingNumber: v.trackingNumber } : { ...common, kind: 'receipt', quantity: v.quantity, unit: o.p.definition.unit, dispatchFactIds: v.dispatchFactIds }; void c.execute({ ...base(c, v.revision), command: 'physical', menu: o.menu, physicalKey: o.p.definition.key, fact }, formKey); }}><fieldset className={`${s.fieldset} ${s.stack}`} disabled={c.locked || !d.capabilities.recordPhysical}><label className={s.field}>실물 기록 종류<select value={v.kind} onChange={e => set({ ...v, kind: e.target.value as PhysicalEditor['kind'] })}><option value="tracking">송장 등록 (수령 아님)</option><option value="dispatch">발송 사실</option><option value="receipt">명시적 수령 관찰</option></select></label>{v.kind !== 'tracking' && <Field label={`실제 ${v.kind === 'dispatch' ? '발송' : '수령'} 수량 (${o.p.definition.unit})`} required value={v.quantity} onChange={quantity => set({ ...v, quantity })}/>} {v.kind !== 'receipt' ? <div className={s.grid}><Field label="택배사·운송사" required={v.kind === 'tracking'} value={v.carrier} onChange={carrier => set({ ...v, carrier })}/><Field label="송장 번호" required={v.kind === 'tracking'} value={v.trackingNumber} onChange={trackingNumber => set({ ...v, trackingNumber })}/>{v.kind === 'tracking' && <Field label="송장 조회 URL" value={v.trackingUrl} onChange={trackingUrl => set({ ...v, trackingUrl })}/>}</div> : <fieldset className={s.sub}><legend>수령이 참조하는 실제 발송</legend>{o.p.facts.filter(f => f.kind === 'dispatch').map(f => <label className={s.check} key={f.id}><input type="checkbox" checked={v.dispatchFactIds.includes(f.id)} onChange={e => set({ ...v, dispatchFactIds: e.target.checked ? [...v.dispatchFactIds, f.id] : v.dispatchFactIds.filter(x => x !== f.id) })}/>{f.kind === 'dispatch' ? `${f.quantity} ${f.unit} · ${f.carrier} ${f.trackingNumber}` : ''} · {f.occurredAt?.value ?? f.recordedAt}</label>)}</fieldset>}<ProviderEditor c={c} label={v.kind === 'receipt' ? '실제 수령 확인자' : '실제 발송·송장 제공자'} value={v.performedBy} onChange={performedBy => set({ ...v, performedBy })}/><ObservedEditor value={v.occurredAt} onChange={occurredAt => set({ ...v, occurredAt })}/><ReferencePicker c={c} value={v.evidence} onChange={evidence => set({ ...v, evidence })}/><Field label="실물 기록 메모" multiline value={v.note} onChange={note => set({ ...v, note })}/><button className="button">실물 사실 저장</button></fieldset></form><Conflict c={c} revision={v.revision} onChange={revision => set({ ...v, revision })}/></section>;
}
export function Followup({ c }: {
    c: Controller;
}) { const d = c.state.data!.detail!, options = d.selected!.menus.flatMap(m => m.followups.map(f => ({ menu: m, f }))), [index, setIndex] = useState(0), o = options[index] ?? options[0]; if (!o)
    return <section className={s.panel}><h2>후속 산출물 수령</h2><p>별도 후속 요청이 없습니다.</p></section>; return <FollowupForm key={o.f.key} c={c} options={options} index={index} setIndex={setIndex}/>; }
function FollowupForm({ c, options, index, setIndex }: {
    c: Controller;
    options: {
        menu: import('@/domain/campaigns/types').PublicMenu;
        f: import('@/domain/campaigns/types').FollowupRequirement;
    }[];
    index: number;
    setIndex: (n: number) => void;
}) { const d = c.state.data!.detail!, o = options[index] ?? options[0], formKey = 'followup:' + d.selected!.id + ':' + o.f.key; type Value = {
    revision: number;
    source: SubmittedReference | null;
    receivedBy: Provider;
    occurredAt: DateInput | null;
    note: string;
}; const v = c.form<Value>(formKey, { revision: d.revision, source: null, receivedBy: { kind: 'user', userId: d.actorId }, occurredAt: null, note: '' }), set = (x: Value) => c.setForm(formKey, x); return <section className={s.panel}><h2>후속 산출물 수령</h2><p className={s.hint}>실제 제출한 게시 URL·사진·성과 리포트 답변을 연결합니다. 원본 업로드만으로 수령 처리하지 않습니다.</p><label className={s.field}>수령할 후속 산출물<select disabled={c.locked} value={index} onChange={e => setIndex(Number(e.target.value))}>{options.map((x, i) => <option key={i} value={i}>{x.menu.identity.menuName} · {x.menu.request.requirements.find(q => q.key === x.f.requirementKey)?.label}</option>)}</select></label><form className={s.stack} onSubmit={e => { e.preventDefault(); if (v.source)
    void c.execute({ ...base(c, v.revision), command: 'followup', menu: o.menu.identity, followupKey: o.f.key, source: v.source, receivedBy: v.receivedBy, occurredAt: v.occurredAt, note: v.note }, formKey); }}><fieldset className={`${s.fieldset} ${s.stack}`} disabled={c.locked || !d.capabilities.recordFollowup}><ReferencePicker c={c} value={v.source} onChange={source => set({ ...v, source })} requirementKey={o.f.requirementKey} kind={o.f.kind}/><ProviderEditor c={c} label="후속 자료 수령자" value={v.receivedBy} onChange={receivedBy => set({ ...v, receivedBy })}/><ObservedEditor value={v.occurredAt} onChange={occurredAt => set({ ...v, occurredAt })}/><Field label="후속 자료 메모" multiline value={v.note} onChange={note => set({ ...v, note })}/><button className="button" disabled={!v.source}>이 제출 자료 수령 기록</button></fieldset></form><Conflict c={c} revision={v.revision} onChange={revision => set({ ...v, revision })}/></section>; }
