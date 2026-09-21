import {describe,it,expect} from 'vitest';
import {parseSubmissionReference,referenceHref,type SubmissionReference} from '@/features/submissions/reference';
const r:SubmissionReference={taskId:'task-one',contextId:'context-one',requestId:'request-old',submissionId:'submission-old',requirementKey:'중복 이름 & 원문',productId:null};
const query=()=>new URL(referenceHref(r),'http://localhost').searchParams;
describe('SA-21/28/29 D09 exact reference address',()=>{
 it('ordinary navigation does not enter reference mode',()=>expect(parseSubmissionReference(r.taskId,new URLSearchParams('context=context-one'))).toEqual({kind:'none'}));
 it('encoded common null and product address roundtrip without defaulting',()=>{expect(parseSubmissionReference(r.taskId,query())).toEqual({kind:'reference',value:r});const p={...r,productId:'product-two'};expect(parseSubmissionReference(p.taskId,new URL(referenceHref(p),'http://localhost').searchParams)).toEqual({kind:'reference',value:p});});
 for(const key of ['context','requestId','submissionId','requirementKey','productId']){
  it(`rejects missing ${key}`,()=>{const q=query();q.delete(key);expect(parseSubmissionReference(r.taskId,q)).toEqual({kind:'invalid'});});
  it(`rejects even identical duplicate ${key}`,()=>{const q=query();q.append(key,q.get(key)!);expect(parseSubmissionReference(r.taskId,q)).toEqual({kind:'invalid'});});
 }
 it('rejects control characters and blank required fields instead of coercing',()=>{for(const value of ['',' ','\u0000','\nrequest']){const q=query();q.set('requestId',value);expect(parseSubmissionReference(r.taskId,q)).toEqual({kind:'invalid'});}});
});
