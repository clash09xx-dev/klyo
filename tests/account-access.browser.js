const assert=require('node:assert/strict'),{chromium,webkit}=require('playwright'),path=require('node:path'),fs=require('node:fs');
(async()=>{
 const f=await require('./helpers/calendar-fixture')(),M=require('../server/services/mfa'),Mail=require('../server/services/accountEmail'),Stripe=require('../server/services/stripe');
 const originals={provider:M.provider,send:Mail.send,create:Stripe.createCheckoutSession,get:Stripe.getClient,subscription:Stripe.getSubscription};
 const out='/private/tmp/klyo-access-qa';fs.mkdirSync(out,{recursive:true});let sms=0,sessions=new Map(),mails=[];
 process.env.RESEND_API_KEY='re_fixture';process.env.RESEND_FROM_EMAIL='Klyo <accounts@example.test>';
 process.env.TWILIO_ACCOUNT_SID='ACfixture';process.env.TWILIO_AUTH_TOKEN='fixture';process.env.TWILIO_VERIFY_SERVICE_SID='VA'+'a'.repeat(32);process.env.STRIPE_PRICE_ID_PLUS='price_plus';
 M.provider=async(p,b)=>p==='Verifications'?{sid:'VE'+ ++sms,status:'pending'}:{status:b.Code==='123456'?'approved':'pending'};Mail.send=async(...args)=>mails.push(args);
 Stripe.createCheckoutSession=async(w,price,tier,mode,success,cancel)=>{const session={id:'cs_test_browser_'+w.id,url:f.base+'/onboarding?session_id=cs_test_browser_'+w.id,status:'complete',mode:'subscription',payment_status:'no_payment_required',subscription:'sub_browser_'+w.id,customer:'cus_browser',client_reference_id:String(w.id),metadata:{tier}};sessions.set(session.id,session);return session;};
 Stripe.getClient=()=>({checkout:{sessions:{retrieve:async id=>sessions.get(id)}}});
 Stripe.getSubscription=async id=>({id,status:'trialing',trial_end:Math.floor(Date.now()/1000)+604800,current_period_end:Math.floor(Date.now()/1000)+604800,metadata:{workspace_id:id.split('_').at(-1)},items:{data:[{price:{id:'price_plus'}}]}});
 try{
 for(const [name,engine,executablePath] of [['chromium',chromium,process.env.KLYO_CHROMIUM_PATH],['webkit',webkit,process.env.KLYO_WEBKIT_PATH]]){
 const browser=await engine.launch({headless:true,...(executablePath?{executablePath}:{})});
 try{
 const page=await browser.newPage({viewport:{width:1280,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route(/^https:\/\/(fonts\.googleapis|fonts\.gstatic)\./,r=>r.abort());
 const email='browser-'+name+'@example.test';await page.goto(f.base+'/signup');await page.waitForSelector('#signupScreen:not(.hidden)');
 await page.locator('#signupName').fill('Browser owner');await page.locator('#signupWorkspace').fill('Browser workspace');await page.locator('#signupEmail').fill(email);await page.locator('#signupPassword').fill('BrowserPassword2026!');await page.locator('#signupPhone').fill('+48123456789');await page.locator('#signupForm input[type="checkbox"]').check();
 await page.locator('#signupSubmitBtn').click();await page.waitForSelector('#mfaCode');assert.equal(await page.evaluate(()=>API.token()),null,'No session before signup SMS');
 await page.locator('#mfaCode').fill('999999');await page.locator('#mfaLogin form button').click();await page.waitForFunction(()=>document.querySelector('#mfaLogin [role=alert]').textContent.length>0);
 await page.locator('#mfaCode').fill('123456');await page.locator('#mfaLogin form button').click();await page.waitForURL('**/onboarding');await page.waitForSelector('.plan button');
 assert.equal(await page.locator('.plan').count(),4);await page.screenshot({path:path.join(out,name+'-choose-plan.png'),fullPage:true});
 await page.locator('.plan').filter({has:page.getByRole('heading',{name:'Plus',exact:true})}).locator('button').click();await page.waitForURL('**/app');await page.waitForSelector('#miyEditInterface');await page.waitForLoadState('networkidle');
 const u=(await f.db.query('SELECT * FROM users WHERE email=$1',[email])).rows[0];await f.db.query('UPDATE users SET has_seen_onboarding=true,terms_accepted_at=now() WHERE id=$1',[u.id]);
 await page.evaluate(()=>API.clearToken());await page.goto(f.base+'/login');await page.locator('#goLoginBtn').click();await page.locator('#loginEmail').fill(email);await page.locator('#loginPassword').fill('BrowserPassword2026!');await f.db.query("UPDATE mfa_challenges SET sent_at=now()-interval '61 seconds' WHERE user_id=$1",[u.id]);
 const before=sms;await page.locator('#loginSubmitBtn').click();await page.waitForSelector('#mfaCode');assert.equal(sms,before+1,'Login sends SMS automatically');await page.screenshot({path:path.join(out,name+'-required-sms.png')});
 await page.locator('#mfaCode').fill('123456');await page.locator('#mfaLogin form button').click();await page.waitForURL('**/app');await page.waitForLoadState('networkidle');
 await page.evaluate(()=>API.clearToken());await page.goto(f.base+'/login');await page.locator('#goLoginBtn').click();await page.locator('#forgotPasswordBtn').click();await page.locator('#resetEmail').fill(email);await page.locator('#accountRecovery form button').click();await page.waitForFunction(()=>document.querySelector('#accountRecovery [role=status]').textContent.length>0);assert.ok(mails.length);
 const token=mails.at(-1)[2].match(/reset_token=([a-f0-9]{64})/)[1];await page.goto(f.base+'/login#reset_token='+token);await page.waitForSelector('#newResetPassword');assert.equal(await page.evaluate(()=>location.hash),'','Reset token removed from URL');
 await page.locator('#newResetPassword').fill('UpdatedBrowser2026!');await page.locator('#confirmResetPassword').fill('UpdatedBrowser2026!');await page.locator('#accountRecovery form button').click();await page.waitForFunction(()=>!document.querySelector('#accountRecovery form'));await page.screenshot({path:path.join(out,name+'-password-updated.png')});
 // Existing password and Google users must enroll rather than receive a CRM session.
 await page.goto(f.base+'/login#enrollment_token='+encodeURIComponent(M.enrollment(f.users[0]).enrollment_token));await page.waitForSelector('#enrollmentPhone');assert.equal(await page.evaluate(()=>API.token()),null);
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(out,name+'-phone-enrollment-mobile.png'),fullPage:true});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 assert.deepEqual(errors,[]);console.log(name+': signup SMS, plan paywall, automatic login SMS, Resend recovery and enrollment/mobile passed');
 }finally{await browser.close();}
 }
 }finally{M.provider=originals.provider;Mail.send=originals.send;Stripe.createCheckoutSession=originals.create;Stripe.getClient=originals.get;Stripe.getSubscription=originals.subscription;await f.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
