const assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),{chromium,webkit}=require('playwright');
(async()=>{
 const f=await require('./helpers/calendar-fixture')(),cards=require('../server/services/businessCards'),original=cards.extract;
 const out=process.env.KLYO_QA_SCREENSHOTS||'/private/tmp/klyo-mobile-qa';fs.mkdirSync(out,{recursive:true});
 let serial=0;cards.extract=async()=>({readable:true,contact:{first_name:'Maya',last_name:'Stone',email:'maya'+(++serial)+'@atlas.test',company:'Atlas Studio',phone:'',title:'Founder'}});
 try{
  await f.req('/contacts','POST',{first_name:'Oliver',last_name:'Chen',email:'oliver@north.test',phone:'+44 20 1234 5678',company:'Northline',status:'contacted'});
  for(const [name,engine,executablePath]of[['chromium',chromium,process.env.KLYO_CHROMIUM_PATH],['webkit',webkit,process.env.KLYO_WEBKIT_PATH]]){
   if(process.env.KLYO_BROWSER&&process.env.KLYO_BROWSER!==name)continue;
   await f.req('/auth/preferences','PUT',require('../public/js/preferences-core').defaults('day'));
   const browser=await engine.launch({headless:true,...(executablePath?{executablePath}:{})});
   try{
    const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:1});const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.route(/^https:\/\/(fonts\.googleapis|fonts\.gstatic)\./,r=>r.abort());
    await page.addInitScript(token=>localStorage.setItem('klyo_token',token),f.token(0));
    await page.goto(f.base+'/app');await page.waitForSelector('#mobileHud');await page.waitForSelector('#contactsTable tbody tr');
    await page.locator('#mobileHud [data-mobile-action="contacts"]').click();
    assert.ok(await page.locator('#contactsTable').innerText().then(t=>t.includes('Northline')));
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no horizontal page overflow');
    await page.screenshot({path:path.join(out,name+'-contacts.png'),fullPage:true});
    await page.locator('#mobileHud [data-mobile-action="add"]').click();
    await page.locator('#quickContactForm [name="first_name"]').fill('Alex');await page.locator('#quickContactForm [name="last_name"]').fill(name);
    await page.locator('#quickContactForm [name="email"]').fill(name+'@quick.test');await page.locator('#quickContactForm [name="company"]').fill('Fieldwork');
    await page.locator('#quickSave').click();await page.waitForSelector('[data-capture="open"]');assert.match(await page.locator('.capture-result-name').innerText(),/Alex/);
    await page.locator('[data-capture="open"]').click();await page.waitForSelector('#panelOverlay:not(.hidden)');
    assert.equal(await page.locator('#mobileHud').isVisible(),false,'HUD stays below dialogs');
    await page.locator('#panelOverlay [data-close-panel]').click();
    await page.locator('#mobileHud [data-mobile-action="add"]').click();await page.locator('[data-capture="scan"]').click();
    assert.equal(await page.locator('#cardCamera').getAttribute('capture'),'environment');
    const bytes=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=600;c.height=350;const x=c.getContext('2d');x.fillStyle='#f0f2f0';x.fillRect(0,0,600,350);x.fillStyle='#17211a';x.font='36px sans-serif';x.fillText('Maya Stone',50,100);x.font='20px sans-serif';x.fillText('Founder / Atlas Studio',50,150);x.fillText('maya@atlas.test',50,230);return c.toDataURL().split(',')[1];});
    await page.locator('#cardCamera').setInputFiles({name:'card.png',mimeType:'image/png',buffer:Buffer.from(bytes,'base64')});
    await page.waitForFunction(()=>!document.getElementById('cardRead').disabled);
    await page.screenshot({path:path.join(out,name+'-scanner.png')});
    await page.locator('#cardRead').click();await page.waitForSelector('[data-capture="open"]');assert.match(await page.locator('.capture-result-name').innerText(),/Maya/);
    await page.screenshot({path:path.join(out,name+'-saved.png')});
    await page.locator('[data-capture="again"]').click();await page.locator('#cardLibrary').setInputFiles({name:'same.png',mimeType:'image/png',buffer:Buffer.from(bytes,'base64')});await page.waitForFunction(()=>!document.getElementById('cardRead').disabled);await page.locator('#cardRead').click();await page.waitForSelector('[data-capture="open"]');assert.match(await page.locator('#captureBody h2').innerText(),/already/);
    await page.locator('[data-capture="close"]').click();
    // Required custom fields lead to a populated full form, never an incomplete save.
    await require('../server/services/customFields').save(f.db,f.w,null,{entity:'contact',name:'Region',type:'text',required:true});
    await page.locator('#mobileHud [data-mobile-action="add"]').click();await page.locator('[data-capture="scan"]').click();
    const reviewImage=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=400;c.height=250;const x=c.getContext('2d');x.fillStyle='#dfe5df';x.fillRect(0,0,400,250);return c.toDataURL().split(',')[1];});
    await page.locator('#cardLibrary').setInputFiles({name:'review.png',mimeType:'image/png',buffer:Buffer.from(reviewImage,'base64')});await page.waitForFunction(()=>!document.getElementById('cardRead').disabled);await page.locator('#cardRead').click();await page.waitForSelector('[data-capture="full"].capture-primary');await page.locator('[data-capture="full"].capture-primary').click();await page.waitForSelector('#contactModalOverlay:not(.hidden)');assert.equal(await page.locator('#contactId').inputValue(),'');assert.equal(await page.locator('#cFirstName').inputValue(),'Maya');assert.equal(await page.locator('#cCompanyText').inputValue(),'Atlas Studio');await page.evaluate(()=>closeContactModal());
    await f.db.query('UPDATE custom_field_definitions SET required=false WHERE workspace_id=$1',[f.w]);
    await page.evaluate(()=>KlyoI18n.setLang('pl',true));
    await page.locator('#mobileHud [data-mobile-action="add"]').click();assert.match(await page.locator('#captureHeading').innerText(),/Nowy kontakt/);await page.locator('[data-capture="full"]').click();await page.waitForSelector('#contactModalOverlay:not(.hidden)');assert.equal(await page.locator('#contactId').inputValue(),'');await page.evaluate(()=>closeContactModal());await page.evaluate(()=>KlyoI18n.setLang('en',true));
    await page.locator('#mobileHud [data-mobile-action="overview"]').click();await page.waitForFunction(()=>document.body.dataset.view==='overview');await page.screenshot({path:path.join(out,name+'-overview.png'),fullPage:true});
    await page.locator('#mobileHud [data-mobile-action="more"]').click();await page.waitForFunction(()=>document.querySelector('.sidebar').getBoundingClientRect().left>=-1);await page.locator('.mobile-nav-scrim').click({position:{x:370,y:250},force:true});
    for(const preset of ['classic','explorer','notebook','command']){
     const prefs=require('../public/js/preferences-core').defaults('day');prefs.layout.ui.base=preset;
     await f.req('/auth/preferences','PUT',prefs);await page.reload();await page.waitForSelector('#mobileHud');await page.waitForSelector('#contactsTable tbody tr');
     for(const width of [320,390,768]){await page.setViewportSize({width,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),name+' '+preset+' width '+width);}
    }
    await page.setViewportSize({width:1440,height:1000});assert.equal(await page.locator('#mobileHud').isVisible(),false,'desktop keeps normal navigation');
    assert.deepEqual(errors,[]);console.log(name+': mobile HUD, quick contact, photo scan, duplicate, drawer, four layouts and desktop passed');
   }finally{await browser.close();}
  }
 }finally{cards.extract=original;await f.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
