import {test,expect,type Page,type TestInfo} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
import {seeded,open,tab,journeys,login,cmd,taskCommand} from '../fixtures/campaigns-ui';
journeys();
const title='G12_PUBLIC_REQUEST three independent menus';
const campaignTitle='G12_PUBLIC_CAMPAIGN_LABEL_WITH_SOURCE_VERSION_2026 세 메뉴 공개 조건';
async function geometry(page:Page,info:TestInfo,label:string){
    const configured=page.viewportSize()!;
    const metrics=await page.evaluate(()=>{
        const box=(element:Element)=>{const r=element.getBoundingClientRect();return {tag:element.tagName,text:(element.textContent??'').slice(0,160),left:r.left,right:r.right,width:r.width};};
        const visible=(e:Element)=>e.getClientRects().length>0;
        const root=document.querySelector('main')!;
        const controls=[...root.querySelectorAll('header,h1,h2,h3,form,fieldset,label,select,input,textarea,button,a')].filter(visible).map(box);
        const title=root.querySelector('h1')!,range=document.createRange();range.selectNodeContents(title);
        return {innerWidth,clientWidth:document.documentElement.clientWidth,scrollWidth:document.documentElement.scrollWidth,dpr:devicePixelRatio,controls,titleText:title.textContent,titleRanges:[...range.getClientRects()].map(r=>({left:r.left,right:r.right,width:r.width})),overflowPolicies:[...root.querySelectorAll('header,form')].map(e=>({tag:e.tagName,overflowX:getComputedStyle(e).overflowX}))};
    });
    const viewport=await page.screenshot({path:info.outputPath(label+'-viewport.png'),scale:'css'});
    const full=await page.screenshot({path:info.outputPath(label+'-full.png'),fullPage:true,scale:'css'});
    const png={scale:'css',viewportWidth:viewport.readUInt32BE(16),fullWidth:full.readUInt32BE(16),viewportHeight:viewport.readUInt32BE(20),fullHeight:full.readUInt32BE(20)};
    await writeFile(info.outputPath(label+'-geometry.json'),JSON.stringify({configured,...metrics,png},null,2));
    expect(metrics.titleText).toBe(title);
    expect(metrics.innerWidth).toBe(configured.width);
    expect(metrics.clientWidth).toBe(configured.width);
    expect(metrics.scrollWidth).toBeLessThanOrEqual(configured.width);
    expect(png.viewportWidth).toBe(configured.width);expect(png.fullWidth).toBe(configured.width);
    expect(metrics.controls.length).toBeGreaterThan(12);
    for(const r of [...metrics.controls,...metrics.titleRanges]){expect(r.left,JSON.stringify(r)).toBeGreaterThanOrEqual(-.5);expect(r.right,JSON.stringify(r)).toBeLessThanOrEqual(configured.width+.5);}
    expect(metrics.overflowPolicies.every(x=>!['hidden','clip'].includes(x.overflowX))).toBe(true);
}
test('G12 layout long accepted titles fit configured viewport with editable and public controls',async({page},info)=>{
    test.setTimeout(150000);const x=await seeded(page);
    await taskCommand(page,x.taskId,'save',{content:{...x.content,title}});await taskCommand(page,x.taskId,'publish');
    await cmd(page,x.id,'save',{draft:{...x.draft,title:campaignTitle}});await cmd(page,x.id,'publish');
    await open(page,x.taskId,x.id);await expect(page.getByRole('combobox',{name:'공개 행사 버전',exact:true})).toContainText(campaignTitle);
    await geometry(page,info,'gsg-public');await tab(page,'내부 초안');
    const input=page.getByRole('textbox',{name:'행사 제목',exact:true});await input.fill(campaignTitle+' · 작성 중');await input.press('Tab');await expect(input).toHaveValue(campaignTitle+' · 작성 중');
    await page.locator('details').filter({has:page.locator(':scope > summary').filter({hasText:'메뉴 1 ·'})}).first().evaluate(e=>(e as HTMLDetailsElement).open=true);
    await expect(page.getByRole('combobox',{name:'상품 1 공통정보 버전',exact:true}).first()).toBeVisible();await geometry(page,info,'gsg-edit');
    await tab(page,'참여·사실 기록');await expect(page.getByRole('combobox',{name:'실물 목적지·용도',exact:true})).toBeVisible();await geometry(page,info,'gsg-actions');
    await login(page,'luna@example.test');await open(page,x.taskId,x.id);await expect(page.getByRole('button',{name:'내부 초안',exact:true})).toHaveCount(0);await geometry(page,info,'brand-public');
    await tab(page,'참여·사실 기록');await expect(page.getByRole('combobox',{name:'제출한 자료 선택',exact:true}).first()).toBeVisible();const note=page.getByRole('textbox',{name:'참여 회신 메모',exact:true});await note.fill('모바일 입력 유지');await note.press('Tab');await expect(page.getByRole('button',{name:'참여 회신 저장',exact:true})).toBeFocused();await geometry(page,info,'brand-actions');
});
