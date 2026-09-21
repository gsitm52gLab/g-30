import {expect,type APIRequestContext,type Page,type TestInfo} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {ready,post,get,ctx,open,record} from './ai-review-ui-support';
import type {AiReviewWorkspace,AiReviewDetail} from '@/server/ai-review/contracts';
import type {AiContent} from '@/server/ai-input/contracts';
export {login,api,post,get,ctx,open,record,geometry,tracing,review,membership,form,captureRSC} from './ai-review-ui-support';
export const approved='合成テスト：肌を清潔に保ちます。実在の商品ではありません。';
export function fault(value:Record<string,unknown>){writeFileSync(process.env.G17_UI_CONTROL!,JSON.stringify(value));}
export function calls(){const p=process.env.G17_UI_CALLS!;return existsSync(p)?readFileSync(p,'utf8').trim().split('\n').filter(Boolean).map(x=>JSON.parse(x)):[];}
export async function fixture(r:APIRequestContext,title?:string,submission:AiContent['submission']=null){return ready(r,approved,{title:title??'G17 browser '+randomUUID().slice(0,6),submission});}
export async function workspace(r:APIRequestContext,id:string){return get<AiReviewWorkspace>(r,`/api/ai-review/inputs/${id}`);}
export async function openInput(page:Page,id:string){await page.goto(`/ai-review/inputs/${id}?context=${ctx}`);await expect(page.getByRole('button',{name:'합성 데모 분석 실행',exact:true})).toBeEnabled();}
export async function provider(page:Page,id:string){await openInput(page,id);await page.getByRole('combobox',{name:'분석 방식',exact:true}).selectOption('provider');await page.getByRole('button',{name:'OpenAI 분석 실행',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'분석 실행 기록을 확인했습니다.'})).toBeVisible();const w=await workspace(page.request,id);await open(page,w.runs[0].id);return get<AiReviewDetail>(page.request,`/api/ai-review/runs/${w.runs[0].id}`);}
export async function setting(r:APIRequestContext,id:string,enabled:boolean){const w=await workspace(r,id);return post(r,'/api/ai-review/settings',{contextId:ctx,enabled,expectedRevision:w.providerSettings.revision,idempotencyKey:randomUUID()});}
export async function capture(info:TestInfo,name:string,value:unknown){await record(info,name,value);}
