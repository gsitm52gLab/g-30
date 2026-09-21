'use client';
import type { CampaignProduct, MenuDraft } from '@/domain/campaigns/types';
import type { Controller } from './controller';
import { Field } from './fields';
import { equalValues } from './model';
import s from './ui.module.css';
export function MenuProducts({ value, onChange, c }: {
    value: MenuDraft;
    onChange: (m: MenuDraft) => void;
    c: Controller;
}) {
    const d = c.state.data!;
    const replace = (p: CampaignProduct, i: number, next: CampaignProduct) => onChange({ ...value, products: value.products.map((x, j) => i === j ? next : x), physical: value.physical.map(x => equalValues(x.product, p) ? { ...x, product: next } : x) });
    const options = d.products.map(p => ({ label: `${p.common.name} · 현재 공개 정보`, value: { productId: p.productId, productVersionId: p.commonVersionId, contextProductVersionId: p.contextVersionId, productUseId: null, sampleVariant: '' } as CampaignProduct }));
    for (const sub of d.detail?.submissions ?? [])
        for (const p of sub.products)
            options.push({ label: `${p.common.name} · 제출 v${sub.sequence} 당시 상품`, value: { productId: p.productId, productVersionId: p.productVersionId, contextProductVersionId: p.contextProductVersionId, productUseId: p.id, sampleVariant: '' } });
    return <fieldset className={s.sub}><legend>메뉴 상품·정확한 버전</legend><p className={s.hint}>현재 정보와 실제 제출 당시 사용본을 구분합니다. 과거 제출은 다시 캡처하지 않습니다.</p>{value.products.map((p, i) => <div className={s.sub} key={i}><p>{d.catalog.products.find(x => x.id === p.productId)?.name ?? '연결 상품'} · {p.productUseId ? '제출 당시 사용본' : '상품 버전 고정'}</p><details><summary>버전 정보</summary><p className={s.hint}>{p.productVersionId}<br />{p.contextProductVersionId}</p></details>{!p.productUseId && <div className={s.grid}><label className={s.field}>상품 {i + 1} 공통정보 버전<select value={p.productVersionId} onChange={e => replace(p, i, { ...p, productVersionId: e.target.value })}>{d.products.find(x => x.productId === p.productId)?.commonHistory.map(v => <option key={v.id} value={v.id}>v{v.sequence} · {v.common.name}</option>)}</select></label><label className={s.field}>상품 {i + 1} 컨텍스트정보 버전<select value={p.contextProductVersionId} onChange={e => replace(p, i, { ...p, contextProductVersionId: e.target.value })}>{d.products.find(x => x.productId === p.productId)?.contextHistory.map(v => <option key={v.id} value={v.id}>v{v.sequence}</option>)}</select></label></div>}<Field label={`상품 ${i + 1} 샘플 변형`} value={p.sampleVariant} onChange={sampleVariant => { replace(p, i, { ...p, sampleVariant }); }}/><button type="button" className="button subtle" onClick={() => onChange({ ...value, products: value.products.filter((_, j) => j !== i) })}>상품 선택 제거</button></div>)}<label className={s.field}>추가할 상품 버전<select value="" onChange={e => { if (e.target.value === '')
        return; const item = options[Number(e.target.value)]; onChange({ ...value, products: [...value.products, structuredClone(item.value)] }); }}><option value="">상품 선택</option>{options.map((o, i) => <option value={i} key={i}>{o.label}</option>)}</select></label>{!options.length && <p>업무에 연결된 상품이 없습니다. 업무·상품 화면에서 연결해 주세요.</p>}</fieldset>;
}
