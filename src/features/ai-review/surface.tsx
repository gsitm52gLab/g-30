"use client";
import Link from 'next/link';
import {useState} from 'react';
import type {AiReviewCorpus,AiReviewDetail,AiReviewWorkspace,HumanReviewCommand} from '@/server/ai-review/contracts';
import {useReview,type ReviewController} from './controller';
import {corpusHref,decisions,inputHref,issueLabels,runHref,runLabels,type Selection,type View} from './model';
import {AnalysisIdentityView,AnalysisResultSummary} from './result';
import {FindingCard} from './finding';
import {CorpusEntryView} from './evidence';
import {ReadCoverage} from './coverage';
import {HumanReviewEditor} from './review-editor';
import s from './ui.module.css';
export function ReviewSurface({initial,actorId,selection}:{initial:View;actorId:string;selection:Selection}){
 const c=useReview(initial,actorId,selection),v=c.state.view,pending=c.state.recovery.pending;
 return <div className={s.stack}><header><p className="eyebrow">GSG 내부 · 근거와 사람 판단을 함께</p><h1>AI 근거·사람 검토</h1><p>문제 후보를 확인하고 사람의 판단과 사유를 기록합니다.</p></header>
 <nav className={s.links} aria-label="AI 검토 메뉴"><Link href={`/ai-input?context=${selection.contextId}`}>입력·읽기 목록</Link><Link href={`/ai-review?context=${selection.contextId}`}>분석 목록</Link><Link href={corpusHref(selection.contextId)}>현행 근거 자료</Link></nav>
 {c.state.error&&<p className={s.error} role="alert">{c.state.error}</p>}{c.state.message&&<p className={s.notice} role="status">{c.state.message}</p>}
 {!c.state.ready&&!c.state.denied&&<p role="status">현재 권한과 저장본을 확인하는 중입니다.</p>}
 <div className={s.actions}><button type="button" disabled={c.state.denied} onClick={()=>void c.refresh()}>현재 저장본 새로 확인</button>{pending&&<button type="button" disabled={c.state.busy||!c.state.ready} onClick={()=>void c.execute()}>{pending.receipt?'저장 결과 다시 조회':'같은 요청으로 다시 확인'}</button>}</div>
 {pending&&<p className={s.notice}>이 요청의 저장 여부를 확인 중입니다. 작성 내용과 요청 식별자를 유지하며 새 요청을 만들지 않습니다.</p>}
 {c.state.conflict&&<p className={s.notice}>다른 저장 또는 원본 변경과 충돌했습니다. 현재 저장본을 새로 확인한 뒤, 작성값을 유지할 기준을 명시적으로 선택해 주세요.</p>}
 {c.state.denied&&<p>다시 로그인하거나 허용된 컨텍스트로 이동해 주세요.</p>}
 {v?.kind==='list'&&<><h2>분석할 입력 {v.data.total}건</h2>{!v.data.items.length&&<section className={s.panel}><h3>분석할 입력이 없습니다</h3><p>먼저 허용된 입력을 저장하고 원문 읽기를 실행해 주세요.</p></section>}{v.data.items.map(item=><article className={s.panel} key={item.inputId}><h2><Link href={inputHref(selection.contextId,item.inputId,item.inputVersionId)}>{item.title}</Link></h2><p>현재 입력 v{item.sequence}</p>{item.latestRun?<p>최근 분석 · {runLabels[item.latestRun.state]} · <Link href={runHref(selection.contextId,item.latestRun.id)}>해당 실행 확인</Link></p>:<p>아직 분석하지 않았습니다. 읽기 완료와 분석 완료는 별도입니다.</p>}</article>)}</>}
 {v?.kind==='input'&&<Workspace c={c} data={v.data}/>}
 {v?.kind==='run'&&<Run c={c} data={v.data}/>}
 {v?.kind==='corpus'&&<Corpus data={v.data} contextId={selection.contextId}/>}
 </div>;
}
function Workspace({c,data:w}:{c:ReviewController;data:AiReviewWorkspace}){
 const [chosen,setChosen]=useState(w.extractionOptions[0]?.id??'');
 const extraction=w.extractionOptions.some(x=>x.id===chosen)?chosen:'',last=w.runs[0];
 return <><section className={s.panel}><h2>{w.title}</h2><p>입력 v{w.inputSequence} · {w.inputIsCurrent?'현재 입력 버전':'과거 입력 버전'}</p><p><Link href={`/ai-input/${w.inputId}?context=${w.contextId}&version=${w.inputVersionId}`}>이 입력의 원문·읽기 결과 확인</Link></p><p className={s.notice}>명시적인 합성 데모 분석입니다. 실제 외부 모델을 호출하거나 법률 적합성을 판정하지 않습니다.</p>
 <label className={s.field}>분석에 사용할 읽기 결과<select value={extraction} disabled={c.locked} onChange={e=>setChosen(e.target.value)}><option value="">읽기 결과 선택</option>{w.extractionOptions.map(x=><option key={x.id} value={x.id}>{x.attempt}차 읽기 · {x.id}</option>)}</select></label>
 {!w.extractionOptions.length&&<p>이 정확한 입력 버전의 완료된 읽기 결과가 없습니다. 입력 화면에서 먼저 읽기를 실행해 주세요.</p>}
 <p>분석 엔진: {w.availableEngines.map(x=>x.label).join(', ')}</p><p><Link href={corpusHref(w.contextId,w.corpus.id)}>적용할 근거 자료 · {w.corpus.asOf}</Link></p>
 <div className={s.actions}><button type="button" disabled={c.locked||!w.capabilities.start||!extraction||last?.state==='running'} onClick={()=>c.start(w,extraction)}>{last?.state==='queued'?'대기 합성 분석 이어가기':last?'새 합성 데모 분석 실행':'합성 데모 분석 실행'}</button></div>
 <p className={s.meta}>후보를 생성해도 원문·업무 완료·브랜드 공개는 자동 변경하지 않습니다.</p></section>
 <section className={s.panel} aria-label="분석 실행 이력"><h2>이 입력 버전의 분석 이력</h2>{!w.runs.length&&<p>저장된 분석 실행 없음</p>}{w.runs.map(run=><article className={s.evidence} key={run.id}><h3><Link href={runHref(w.contextId,run.id)}>{run.attempt}차 분석 · {runLabels[run.state]}</Link></h3><p>생성 {run.createdAt}</p>{run.issue&&<p>{issueLabels[run.issue]??run.issue}</p>}<p>외부 모델 호출 {run.providerCalled?'기록 있음':'없음'}</p></article>)}</section></>;
}
function Run({c,data:d}:{c:ReviewController;data:AiReviewDetail}){
 const result=d.result;
 const labels=Object.fromEntries(d.snapshot.sources.map((source,index)=>[source.sourceId,d.snapshot.kind==='text'?d.inputTitle:`${d.inputTitle} · 원본 ${index+1}`]));
 return <><section className={s.panel} aria-label="분석 실행"><h2>{d.inputTitle} · {d.attempt}차 분석</h2><p>{runLabels[d.state]} · 입력 v{d.inputSequence} · {d.inputIsCurrent?'현재 입력':'과거 입력'}</p><p>{d.engineLabel} · 외부 모델 호출 {d.providerCalled?'기록 있음':'없음'}</p>{d.issue&&<p className={s.notice}>{issueLabels[d.issue]??d.issue}</p>}{d.state==='queued'&&<p>아직 분석하지 않은 대기 상태입니다. 입력의 분석 화면에서 명시적으로 이어갈 수 있습니다.</p>}{d.state==='running'&&<p>분석 중입니다. 저장본을 새로 확인해 주세요.</p>}{['failed','interrupted'].includes(d.state)&&<p>정상 결과나 후보 0건이 아닙니다. 원인과 현재 원본을 확인해 주세요.</p>}<div className={s.links}><Link href={d.inputUrl}>정확한 입력·읽기 원문</Link><Link href={inputHref(d.contextId,d.inputId,d.inputVersionId)}>이 입력의 분석 실행·이력</Link><Link href={corpusHref(d.contextId,d.corpusReleaseId)}>실행 당시 근거 자료</Link></div>
 {!d.corpusIsCurrent&&<p className={s.notice}>과거 근거 버전의 실행입니다. 당시 결과는 보존되며 현행 근거로 바뀌지 않습니다.</p>}
 {result&&result.staleExcerptIds.length>0&&<p className={s.notice}>원문 개정으로 현행 검색에서 제외된 발췌 {result.staleExcerptIds.length}건이 이 실행에 있습니다. 당시 인용·번역과 현재성을 구분해 주세요.</p>}
 </section><ReadCoverage snapshot={d.snapshot} sourceLabels={labels}/>
 {result&&<><AnalysisIdentityView identity={d} providerCalled={d.providerCalled}/><AnalysisResultSummary result={result}/>{result.findings.map(finding=><FindingCard key={finding.id} finding={finding}><ReviewFinding c={c} data={d} finding={finding}/></FindingCard>)}<details className={`${s.panel} ${s.records}`}><summary>분석 결과 보존 기록</summary><p>결과 ID {result.id}</p><p>결과 해시 {result.resultHash}</p><p>생성 {result.createdAt}</p>{d.capabilities.readRaw&&<a href={result.rawUrl} target="_blank" rel="noopener noreferrer">GSG 내부 원 결과 JSON 보기 (새 창)</a>}</details></>}
 </>;
}
type DetailFinding=NonNullable<AiReviewDetail['result']>['findings'][number];
function ReviewFinding({c,data:d,finding:f}:{c:ReviewController;data:AiReviewDetail;finding:DetailFinding}){
 const command:HumanReviewCommand=c.state.recovery.reviews[f.id]??{findingId:f.id,expectedRevision:f.review.revision,decision:'accept',reason:'',editedSuggestion:null};
 const stale=command.expectedRevision!==f.review.revision,opinion=c.state.recovery.opinions[f.id]??{targetIndex:0,text:f.review.current?.editedSuggestion??f.reason};
 const target=f.correctionTargets[opinion.targetIndex],accepted=!!f.review.current&&f.review.current.decision!=='reject';
 return <section className={s.section} aria-label="사람 판단과 후속 의견"><h3>저장된 사람 판단</h3>{f.review.current?<p>{decisions[f.review.current.decision]} · {f.review.current.reviewedByLabel} · {f.review.current.reviewedAt}</p>:<p>아직 사람 판단이 기록되지 않았습니다.</p>}<p className={s.meta}>사람 검토 기록은 외부 전문가 승인과 별개입니다.</p>
 {f.review.history.length>0&&<details className={s.records}><summary>사람 검토 이력 {f.review.history.length}건</summary>{f.review.history.map(h=><article className={s.evidence} key={h.id}><h4>{h.sequence}차 · {decisions[h.decision]}</h4><p className={s.body}>{h.reason}</p>{h.editedSuggestion&&<p className={s.quote}>{h.editedSuggestion}</p>}<p>{h.reviewedByLabel} · {h.reviewedAt}</p><p>기록 {h.id}</p></article>)}</details>}
 {stale&&<><p className={s.notice}>작성 기준과 현재 검토가 다릅니다. 현재 이력을 확인한 뒤 작성값을 새 기준으로 유지할 수 있습니다.</p><div className={s.actions}><button disabled={c.locked} onClick={()=>c.editReview({...command,expectedRevision:f.review.revision})}>최신 검토 기준으로 작성값 유지</button></div></>}
 <HumanReviewEditor command={command} suggestedText={f.suggestion} onCommandChange={c.editReview} onSubmit={cmd=>c.review(d,cmd)} busy={c.state.busy} disabledReason={c.locked?'현재 권한·처리 결과를 먼저 확인해 주세요.':stale?'현재 검토와 작성 기준을 먼저 비교해 주세요.':!d.capabilities.review?'이 실행은 사람 검토 기록 대상이 아닙니다.':undefined}/>
 <section className={s.evidence} aria-label="수정 취합으로 연결"><h3>정확한 제출에 내부 의견 남기기</h3>{!f.correctionTargets.length?<p>이 후보 원문과 일치하는 실제 제출 대상이 없습니다. 단순 업무·상품 연결만으로 제출 답변을 만들지 않습니다.</p>:<><p>후보를 수락·수정한 뒤 사용자가 명시적으로 내부 의견을 저장합니다. 브랜드 공개는 별도입니다.</p><label className={s.field}>실제 제출 대상<select disabled={c.locked} value={opinion.targetIndex} onChange={e=>c.editOpinion(f.id,{...opinion,targetIndex:Number(e.target.value)})}>{f.correctionTargets.map((t,i)=><option key={i} value={i}>{t.answer?`답변 ${t.answer.requirementKey}`:t.fileVersionIds.length?'제출 파일':'제출 본문'} · {t.submissionId}</option>)}</select></label><label className={s.field}>내부 의견 원문<textarea rows={4} maxLength={20000} disabled={c.locked} value={opinion.text} onChange={e=>c.editOpinion(f.id,{...opinion,text:e.target.value})}/></label>{target&&<><p className={s.meta}>정확한 요청 {target.requestId} · 제출 {target.submissionId} · {target.location.locator}</p><div className={s.actions}><button disabled={c.locked||!accepted||!opinion.text.trim()} onClick={()=>void c.execute({kind:'opinion',url:'/api/corrections',body:{command:'save_opinion',taskId:target.taskId,opinionId:null,expectedRevision:0,opinion:{target,source:{kind:'ai_candidate',runId:d.id,findingId:f.id,source:'AI 합성 데모 후보'},originalText:opinion.text,internalFileVersionIds:[],receivedOn:null,conflictingOpinionVersionIds:[]},idempotencyKey:crypto.randomUUID()},receipt:null})}>이 후보로 내부 의견 저장</button><Link href={`/tasks/${target.taskId}/corrections?context=${d.contextId}`}>수정 취합·공개 화면 열기</Link></div></>}</>}
 </section></section>;
}
function Corpus({data,contextId}:{data:AiReviewCorpus;contextId:string}){
 const r=data.release,entries=r.excerpts.map(excerpt=>({excerpt,source:r.sources.find(source=>source.id===excerpt.sourceVersionId)!,translation:r.translations.find(t=>t.excerptId===excerpt.id&&t.sourceVersionId===excerpt.sourceVersionId)??null}));
 return <section className={s.panel} aria-label="근거 자료 공개 버전"><h2>근거 자료 · {r.asOf}</h2><p>{data.isCurrent?'현행 공개 버전':'과거 공개 버전 · 당시 원문·번역 보존'}</p><p className={s.notice}>배포자가 관리하는 읽기 전용 자료입니다. 비공식 한국어 번역의 검수 상태와 문서별 실제 읽은 범위를 확인해 주세요.</p>{!data.isCurrent&&<Link href={corpusHref(contextId,data.currentReleaseId)}>현행 근거 자료로 이동</Link>}{(['legal','guidance'] as const).map(kind=><section className={s.section} key={kind} aria-label={kind==='legal'?'공식 법적 근거':'보조 지침'}><h3>{kind==='legal'?'공식 법적 근거':'보조 지침'}</h3>{entries.filter(e=>(e.source.authority==='industry_guidance')===(kind==='guidance')).map(entry=><CorpusEntryView key={entry.excerpt.id} entry={entry}/>)}</section>)}<details className={s.records}><summary>근거 공개 기록</summary><p>공개 버전 {r.id}</p><p>묶음 해시 {r.manifestHash}</p></details></section>;
}
