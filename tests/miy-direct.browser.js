const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{chromium,webkit}=require('playwright');
(async()=>{
const f=await require('./helpers/calendar-fixture')(),P=require('../public/js/preferences-core'),out=process.env.KLYO_QA_SCREENSHOTS||'/private/tmp/klyo-direct-qa';fs.mkdirSync(out,{recursive:true});
try{
for(const [name,engine,executablePath] of [['chromium',chromium,process.env.KLYO_CHROMIUM_PATH],['webkit',webkit,process.env.KLYO_WEBKIT_PATH]]){
 if(process.env.KLYO_BROWSER && name!==process.env.KLYO_BROWSER)continue;
 await f.req('/auth/preferences','PUT',P.defaults('day'));
 const browser=await engine.launch({headless:true,...(executablePath?{executablePath}:{})});
 try{
 const page=await browser.newPage({viewport:{width:1512,height:982}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route(/^https:\/\/(fonts\.googleapis|fonts\.gstatic)\./,r=>r.abort());
 await page.addInitScript(token=>localStorage.setItem('klyo_token',token),f.token(0));await page.goto(f.base+'/app');await page.waitForSelector('#miyEditInterface');await page.waitForSelector('.personal-nav');
 assert.equal(await page.locator('.personal-nav>.nav-item').first().getAttribute('data-view'),'overview');
 const move=async(locator,dx,dy,fx=.5,fy=.5)=>{await locator.scrollIntoViewIfNeeded();const b=await locator.boundingBox();assert.ok(b);await page.mouse.move(b.x+b.width*fx,b.y+b.height*fy);await page.mouse.down();await page.mouse.move(b.x+b.width*fx+dx,b.y+b.height*fy+dy,{steps:14});await page.waitForTimeout(120);await page.mouse.up();await page.waitForTimeout(250);};
 await page.locator('#miyEditInterface').click();await page.locator('#miyPanelSnap').selectOption('free');
 const summary=page.locator('#pipelineView>.stat-grid'),before=await summary.boundingBox();await move(summary,0,82);
 let after=await summary.boundingBox();assert.ok(after.y>before.y+40,'Summary is draggable from its center');assert.equal(await page.evaluate(()=>getSelection().toString()),'');
 const records=page.locator('#pipelineView>.table-card'),rb=await records.boundingBox();await move(records.locator('.miy-panel-resize'),-110,80);
 const resized=await records.boundingBox();assert.ok(resized.width<rb.width-60,'Main records have actual pointer resize');assert.ok(resized.height>rb.height+40);
 await page.locator('[data-editor-tab="shortcuts"]').click();const shelf=page.locator('[data-shortcut-drag="new_deal"]');await shelf.scrollIntoViewIfNeeded();
 const source=await shelf.boundingBox(),zone=await page.locator('[data-drop-zone="workspace"]').boundingBox();
 await page.mouse.move(source.x+source.width*.6,source.y+source.height*.5);await page.mouse.down();await page.mouse.move(zone.x+zone.width*.5,zone.y+zone.height*.5,{steps:20});

 assert.equal(await page.locator('[data-drop-zone="workspace"]').evaluate(n=>n.classList.contains('miy-drag-over')),true,'Green drop target while dragging');
 await page.mouse.up();await page.waitForTimeout(200);assert.equal(await page.locator('#miyQuickActions').getAttribute('data-position'),'workspace');assert.equal(await page.locator('[data-quick-action="new_deal"]').count(),1);
 await page.locator('.personal-nav [data-view="overview"]').click();await page.waitForSelector('#dashboardGrid [data-widget-id="goal"]');
 assert.equal(await page.evaluate(()=>KlyoDashboard.isEditing()),true,'Overview automatically editable in unified designer');
 await page.locator('[data-editor-tab="page"]').click();await page.locator('#organizerSnap').selectOption('free');
 const goal=page.locator('[data-widget-id="goal"]'),gb=await goal.boundingBox();await move(goal,0,75);const ga=await goal.boundingBox();assert.ok(ga.y>gb.y+40,'Target progress moves from the body');
 await move(goal.locator('.widget-resize'),-90,50);const gz=await goal.boundingBox();assert.ok(gz.width<ga.width-40,'Overview still supports smooth resize');
 await page.locator('[data-add-widget="trend"]').click();assert.equal(await page.locator('[data-widget-id="trend"]').isVisible(),true,'Existing chart catalog preserved');
 await page.screenshot({path:path.join(out,name+'-unified-overview.png'),fullPage:true});
 await page.locator('#miySave').click();await page.waitForSelector('#interfaceEditor',{state:'detached'});
 await page.reload();await page.waitForSelector('#miyEditInterface');
 const saved=await page.evaluate(()=>KlyoCustomize.getSaved());assert.ok(saved.layout.ui.pages.pipeline.positions.summary);assert.ok(saved.layout.dashboard.find(x=>x.id==='trend'));
 await page.evaluate(()=>switchView('pipeline'));await page.waitForSelector('#pipelineView:not(.hidden)');assert.ok(await page.locator('#pipelineView').evaluate(n=>n.classList.contains('miy-page-canvas')));
 // Every preset must fit at normal desktop and while the editor reserves its dock.
 for(const preset of ['command','explorer','classic','notebook']){
   await page.locator('#miyEditInterface').click();await page.locator('[data-editor-tab="structure"]').click();await page.locator('#interfaceEditor [data-interface-preset="'+preset+'"]').click();
   await page.waitForTimeout(200);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),preset+' editor fits viewport');
   await page.locator('#miySave').click();await page.waitForSelector('#interfaceEditor',{state:'detached'});
   await page.screenshot({path:path.join(out,name+'-'+preset+'.png'),fullPage:true});
   assert.ok(await page.locator('#appearanceBtn').isVisible());assert.ok(await page.locator('#signOutBtn').isVisible());assert.ok(await page.locator('.personal-nav [data-view="overview"]').isVisible());
   if(preset==='command'){
     for(const section of ['sales','delivery','work','communication','workspace']){
       const summary=page.locator('.personal-nav details[data-section="'+section+'"]>summary');if(await summary.isVisible()){
         await summary.click();const menu=summary.locator('..').locator('.nav-section-items');const b=await menu.boundingBox();assert.ok(b && b.x>=0 && b.x+b.width<=1513,'Command menu is not clipped');await summary.click();
       }
     }
   }
 }
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(out,name+'-mobile.png'),fullPage:true});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Mobile viewport fits');
 assert.deepEqual(errors,[]);console.log(name+': direct panel move/resize, shortcut drop, unified Overview, persisted layout, all preset bounds passed');
 }finally{await browser.close();}
}
}finally{await f.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
