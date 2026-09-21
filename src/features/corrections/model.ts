import type { CorrectionCommand, CorrectionWorkspace, OpinionInput, BatchDraftInput, RecordReviewCommand, ReviewTarget, OpinionSource } from '@/server/corrections/contracts';
export type Workspace = CorrectionWorkspace;
export type Submission = Workspace['submissions'][number];
export type CommandInput = CorrectionCommand extends infer C ? C extends CorrectionCommand ? Omit<C, 'taskId'|'idempotencyKey'> : never : never;
export type ReviewForm = Omit<RecordReviewCommand,'taskId'|'idempotencyKey'>;
export type EditorState = {
 tab:'public'|'opinions'|'draft'|'reviews';
 opinionId:string|null; opinionRevision:number; opinion:OpinionInput|null;
 draftId:string|null; draftRevision:number; draft:BatchDraftInput;
 review:ReviewForm|null;
 actions:Record<string,Record<string,{selected:boolean;target:ReviewTarget;note:string;decision:'resolved'|'needs_confirmation'|'not_reflected';reason:string}>>;
};
export const blankSource=():OpinionSource=>({kind:'internal_review',reviewer:'',source:''});
export const blankBatch=():BatchDraftInput=>({title:'',summary:'',items:[],mode:'normal',pendingScopes:[],previousBatchVersionId:null});
export const blankEditors=():EditorState=>({tab:'public',opinionId:null,opinionRevision:0,opinion:null,draftId:null,draftRevision:0,draft:blankBatch(),review:null,actions:{}});
export function targetFor(w:Workspace,s:Submission):ReviewTarget{return {taskId:w.taskId,submissionId:s.id,requestId:s.requestId,submissionContentHash:s.contentHash,answer:null,fileVersionIds:[],productUseIds:[],location:{page:null,locator:''}};}
export function blankOpinion(target:ReviewTarget):OpinionInput{return {target,source:blankSource(),originalText:'',internalFileVersionIds:[],receivedOn:null,conflictingOpinionVersionIds:[]};}
export function blankReview(target:ReviewTarget):ReviewForm{return {target,source:blankSource(),scope:{medium:'',language:'',usePlace:'',productIds:[]},receivedOn:'',result:'needs_confirmation',rationale:'',evidenceFileVersionIds:[],previousReviewId:null};}
export const statusLabels={pending:'반영 대기',reflected:'브랜드 반영 제출',resolved:'GSG 해소 확인',needs_confirmation:'추가 확인 필요',not_reflected:'미반영 확인'};
export const resultLabels={no_changes_requested:'추가 수정 요청 없음',changes_requested:'수정 요청',needs_confirmation:'확인 필요',opinion_only:'참고 의견'};
export const issueLabels={correction:'수정',conflicting_opinions:'상충 의견',wrong_file:'잘못 보낸 파일',missing_content:'표시·내용 누락'};
export const priorityLabels={low:'낮음',normal:'보통',high:'높음',urgent:'긴급'};
