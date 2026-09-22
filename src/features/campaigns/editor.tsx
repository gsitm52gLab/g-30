'use client';
import Link from 'next/link';
import type { CampaignDraft, MenuDraft } from '@/domain/campaigns/types';
import type { Controller } from './controller';
import { Field } from './fields';
import { MenuSources } from './menu-sources';
import { MenuProducts } from './menu-products';
import { MenuRequirements, requestFromCurrent } from './menu-requirements';
import { MenuConditions } from './menu-conditions';
import { MenuDeliverables } from './menu-deliverables';
import { taskHref, equalValues } from './model';
import { PublicMenus } from './public-view';
import s from './ui.module.css';
export interface CampaignEditorValue {
    campaignId: string | null;
    revision: number;
    draft: CampaignDraft;
}
export function Editor({ c }: {
    c: Controller;
}) {
    const d = c.state.data!, detail = d.detail, formKey = 'draft:' + (detail?.id ?? 'new'), editor = c.form<CampaignEditorValue>(formKey, { campaignId: detail?.id ?? null, revision: detail?.revision ?? 0, draft: detail?.staff?.draft ?? { title: '', menus: [] } }), set = (v: CampaignEditorValue) => c.setForm(formKey, v), draft = editor.draft, update = (v: CampaignDraft) => set({ ...editor, draft: v });
    const changed = !equalValues(draft, detail?.staff?.draft), catalogs = d.catalogs?.items.flatMap(x => x.versions) ?? [];
    function add() { const request = requestFromCurrent(c); if (!request)
        return; const menu: MenuDraft = { identity: { catalogVersionId: catalogs[0]?.id ?? '', menuKey: crypto.randomUUID(), menuName: '', menuNumber: '' }, sourceStatements: [], conflicts: [], conditions: { state: 'needs_confirmation', sourceStatementIds: [], publicExplanation: '', cost: { amount: null, currency: null, taxIncluded: 'unknown' }, discount: '', points: '', cancellationTerms: '', schedules: [] }, templateVersionId: null, request, products: [], physical: [], followups: [] }; update({ ...draft, menus: [...draft.menus, menu] }); }
    if (!d.task.request)
        return <section className={s.panel}><h2>먼저 업무 요청을 공개해 주세요</h2><p>행사 메뉴는 승인된 실제 업무의 요청 항목과 연결합니다.</p><Link className="button" href={taskHref(d.task.task.id, d.task.task.contextId!)}>업무 요청 편집·공개</Link></section>;
    return <div className={s.stack}><section className={s.panel}><h2>행사 내부 초안</h2><p className={s.notice}>현재 업무의 실제 요청 항목을 메뉴별로 연결합니다. 이 초안의 원문·출처는 GSG 내부이며, 브랜드 공개 조건은 따로 작성합니다.</p>{!catalogs.length && <p role="note">카탈로그 탭에서 원문 버전을 먼저 등록하세요.</p>}<form className={s.stack} onSubmit={e => { e.preventDefault(); void c.execute({ command: 'save', contextId: d.task.task.contextId!, taskId: d.task.task.id, campaignId: editor.campaignId, expectedRevision: editor.revision, draft, idempotencyKey: crypto.randomUUID() }, formKey); }}><fieldset disabled={c.locked} className={`${s.fieldset} ${s.stack}`}><Field label="행사 제목" required value={draft.title} onChange={title => update({ ...draft, title })}/>{draft.menus.map((menu, i) => { const change = (m: MenuDraft) => update({ ...draft, menus: draft.menus.map((x, j) => j === i ? m : x) }); return <details className={s.sub} key={menu.identity.menuKey} open><summary>메뉴 {i + 1} · {menu.identity.menuName || '이름 입력'}</summary><div className={s.stack}><MenuSources value={menu} onChange={change} c={c}/><MenuConditions value={menu} onChange={change} c={c}/><MenuProducts value={menu} onChange={change} c={c}/><MenuRequirements value={menu} onChange={change} c={c}/><MenuDeliverables value={menu} onChange={change} c={c}/><button className="button subtle" type="button" onClick={() => update({ ...draft, menus: draft.menus.filter((_, j) => j !== i) })}>이 메뉴 제거</button></div></details>; })}<div className={s.actions}><button className="button subtle" type="button" disabled={!catalogs.length || draft.menus.length >= 20} onClick={add}>메뉴 추가</button><button className="button">행사 초안 저장</button><button type="button" className="button subtle" disabled={!detail || changed || editor.revision !== detail.revision} onClick={() => void c.preview()}>저장한 행사 공개 미리보기</button></div></fieldset></form>{detail && editor.revision !== detail.revision && <div className={s.notice}><p>현재 서버 저장 버전 {detail.revision}, 작성 기준 {editor.revision}. 작성값을 유지했습니다. 최신 초안과 비교한 뒤 기준 버전을 명시적으로 선택하세요.</p><details><summary>최신 저장 초안과 비교</summary><p>{detail.staff?.draft?.title}</p>{detail.staff?.draft?.menus.map(m => <p key={m.identity.menuKey}>{m.identity.menuName} · {m.conditions.publicExplanation}</p>)}</details><button type="button" className="button subtle" disabled={c.locked} onClick={() => set({ ...editor, revision: detail.revision })}>작성값 유지 · 최신 기준으로 저장 준비</button><button type="button" className="button subtle" disabled={c.locked} onClick={() => c.clearForm(formKey)}>내 입력을 버리고 최신 초안 사용</button></div>}</section>{c.state.preview && detail && <section className={s.panel}><h2>브랜드 공개 미리보기</h2><p className={s.notice}>서버가 반환한 공개 내용입니다. 공개는 현재 요청 범위를 새 버전으로 만듭니다. 기존 답변 초안은 자동 전환하지 않습니다.</p><h3>{c.state.preview.value.title}</h3><PublicMenus menus={c.state.preview.value.menus} c={c}/><button className="button" disabled={c.locked || changed || c.state.preview.revision !== detail.revision || editor.revision !== detail.revision} onClick={() => void c.execute({ command: 'publish', contextId: detail.contextId, taskId: detail.taskId, campaignId: detail.id, expectedRevision: c.state.preview!.revision, idempotencyKey: crypto.randomUUID() }, formKey)}>이 행사 조건 공개하기</button></section>}</div>;
}
