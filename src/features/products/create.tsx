"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ProductList } from "@/server/products/service";
import { blankCommon } from "@/domain/products/types";
import { useCommand } from "@/features/tasks/client";
import { CommonFields,Select } from "./fields";
import s from "@/features/tasks/ui.module.css";
export function CreateProduct({contexts,initialContext}:{contexts:ProductList['contexts'];initialContext:string}){const router=useRouter(),cmd=useCommand();const [contextId,setContext]=useState(initialContext),[common,setCommon]=useState(blankCommon()),[full,setFull]=useState(false);const context=contexts.find(c=>c.id===contextId);return <div className={s.stack}><Link className="back-link" href="/products">← 상품 목록</Link><header><p className="eyebrow">NEW PRODUCT</p><h1>상품 등록</h1><p>브랜드·상품명·제품 코드로 시작합니다. 모르는 정보는 비워 두세요.</p></header><form className={s.panel} onSubmit={e=>{e.preventDefault();if(context)void cmd.run<{ids:string[]}>("/api/products",{contextId,brandId:context.data.brandId,common},r=>router.push(`/products/${r.ids[0]}?context=${contextId}`),"상품을 등록했습니다.");}}><fieldset disabled={cmd.busy} style={{border:0,padding:0}}><Select label="등록 컨텍스트" value={contextId} onChange={setContext}>{contexts.map(c=><option value={c.id} key={c.id}>{c.data.country} / {c.data.retailer} / {c.data.brand}</option>)}</Select><p>브랜드: {context?.data.brand??'선택 필요'}</p><CommonFields value={common} onChange={setCommon} minimal={!full}/><div className={s.actions}><button className="button subtle" type="button" onClick={()=>setFull(!full)}>{full?'최소 항목 보기':'선택 정보도 입력'}</button><button className="button" disabled={!context} type="submit">{cmd.busy?'저장 중…':'상품 등록하기'}</button></div><p className={s.hint}>이미지·성분·포장 파일은 상품을 등록한 뒤 자료 영역에서 업로드할 수 있습니다.</p></fieldset>{cmd.error&&<p role="alert" className={s.error}>{cmd.error}</p>}</form></div>;}
