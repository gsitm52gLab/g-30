import type { UnitOfWork,StoredRecord } from '@/domain/records';
import type { CampaignState,PublicMenu } from '@/domain/campaigns/types';
import { menuIdentityKey } from '@/domain/campaigns/types';
import { activeMenuObligations,withParticipation,withExternalFact } from '@/domain/campaigns/validate';
import * as safe from './stored';
export const initialState=():CampaignState=>({response:'pending',application:'not_applied',selection:'pending',preparation:'not_started',execution:'not_started',resultReceipt:'not_received',cancellation:'none'});
/** Historical sequence bounds keep the generated request tied to the exact decision. */
export function storedMenuState(s:UnitOfWork,v:StoredRecord<'campaignVersion'>,menu:PublicMenu,through=Number.MAX_SAFE_INTEGER){
 const selections=s.list('campaignSelection',v.contextId!).filter(r=>r.data.campaignVersionId===v.id&&r.data.sequence<=through).sort((a,b)=>a.data.sequence-b.data.sequence);
 for(const r of selections){if(!['participate','decline','discuss'].includes(r.data.response)||!Array.isArray(r.data.selectedMenus))safe.corrupt();r.data.selectedMenus.forEach(safe.identity);}
 const facts=s.list('campaignExternalFact',v.contextId!).filter(r=>r.data.campaignVersionId===v.id&&r.data.sequence<=through&&menuIdentityKey(safe.identity(r.data.menu))===menuIdentityKey(menu.identity));
 const events=[...selections.map(r=>({sequence:safe.integer(r.data.sequence,1),selection:r,fact:null})),...facts.map(r=>({sequence:safe.integer(r.data.sequence,1),selection:null,fact:safe.external(r.data)}))].sort((a,b)=>a.sequence-b.sequence);
 let state=initialState();for(const e of events){if(!e.selection){state=withExternalFact(state,e.fact!);continue;}const includes=e.selection.data.selectedMenus.some(m=>menuIdentityKey(m)===menuIdentityKey(menu.identity));state=withParticipation(state,e.selection.data.response);if(e.selection.data.response==='participate'&&!includes)state={...state,response:'pending',cancellation:['applied','withdrawal_requested'].includes(state.application)&&state.cancellation!=='cancelled'?'discussion':state.cancellation};}
 const selection=selections.at(-1)??null, selected=selection?.data.selectedMenus.filter(m=>menuIdentityKey(m)===menuIdentityKey(menu.identity))??[];
 const active=activeMenuObligations([menu],selected,state).length===1;
 const previouslySelected=selections.some(r=>r.data.response==='participate'&&r.data.selectedMenus.some(m=>menuIdentityKey(m)===menuIdentityKey(menu.identity)));
 const retainedForCancellationReview=!active&&previouslySelected&&['applied','withdrawal_requested'].includes(state.application)&&state.cancellation!=='cancelled'&&state.selection!=='not_selected';
 return {state,selection,active,retainedForCancellationReview};
}
