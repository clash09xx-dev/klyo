const test=require('node:test'),assert=require('node:assert/strict'),jwt=require('jsonwebtoken');
test('mandatory SMS gates signup/password and Google users; Stripe gates Team and Personal; resets are single-use and revoke sessions', {skip:!process.env.TEST_DATABASE_URL},async()=>{
  const f=await require('./helpers/calendar-fixture')(),M=require('../server/services/mfa'),Mail=require('../server/services/accountEmail'),Stripe=require('../server/services/stripe');
  const originals={provider:M.provider,send:Mail.send,getClient:Stripe.getClient,getSubscription:Stripe.getSubscription,create:Stripe.createCheckoutSession};
  const messages=[];let sent=0,checkoutCalls=0;const remote=new Map();
  M.provider=async(path,body)=>path==='Verifications'?{sid:'VE'+ ++sent,status:'pending'}:{status:body.Code==='123456'?'approved':'pending'};
  Mail.send=async(...args)=>messages.push(args);
  process.env.RESEND_API_KEY='re_fixture';process.env.RESEND_FROM_EMAIL='Klyo <accounts@example.test>';
  process.env.TWILIO_ACCOUNT_SID='ACfixture';process.env.TWILIO_AUTH_TOKEN='fixture';process.env.TWILIO_VERIFY_SERVICE_SID='VA'+'a'.repeat(32);
  process.env.STRIPE_PRICE_ID_PLUS='price_plus';
  Stripe.getClient=()=>({checkout:{sessions:{retrieve:async id=>remote.get(id),expire:async id=>{remote.get(id).status='expired';}}}});
  Stripe.createCheckoutSession=async(w,price,tier,mode,success,cancel)=>{checkoutCalls++;assert.equal(w.onboarding_payment_required,true);assert.equal(w.trial_used,false);assert.equal(mode,'subscription');assert.match(success,/onboarding\?session_id=/);const r={id:'cs_test_'+checkoutCalls,url:'https://checkout.stripe.com/fixture',status:'open',mode:'subscription',metadata:{tier},client_reference_id:String(w.id)};remote.set(r.id,r);return r;};
  Stripe.getSubscription=async id=>({id,status:'trialing',trial_end:Math.floor(Date.now()/1000)+604800,current_period_end:Math.floor(Date.now()/1000)+604800,metadata:{workspace_id:String(wid)},items:{data:[{price:{id:'price_plus'}}]}});
  const call=async(path,body,token,method='POST')=>{const r=await fetch(f.base+'/api'+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body),redirect:'manual'});return{status:r.status,data:await r.json()};};
  let wid;
  try{
    const signup={name:'New owner',email:'new@example.test',password:'NewPassword2026!',workspace_name:'New workspace'};
    assert.equal((await call('/auth/register',signup)).status,400);
    const registered=await call('/auth/register',{...signup,phone:'+48123456789'});
    assert.equal(registered.status,201);assert.equal(registered.data.mfa_required,true);assert.equal(registered.data.token,undefined);assert.equal(sent,1);
    const user=(await f.db.query('SELECT * FROM users WHERE email=$1',[signup.email])).rows[0];wid=user.workspace_id;
    const forged=jwt.sign({id:user.id,workspace_id:wid,sms_verified:true},process.env.JWT_SECRET);
    assert.equal((await call('/contacts',undefined,forged,'GET')).status,401,'phone must be verified in database');
    const failed=await call('/mfa/verify',{challenge:registered.data.challenge,code:'999999'});assert.equal(failed.status,401);
    const verified=await call('/mfa/verify',{challenge:registered.data.challenge,code:'123456'});assert.equal(verified.status,200);assert.ok(verified.data.token);const token=verified.data.token;
    assert.equal((await call('/mfa/verify',{challenge:registered.data.challenge,code:'123456'})).status,401,'SMS challenge cannot be replayed');
    assert.equal((await call('/mfa/disable',{},token)).status,403);
    assert.equal((await call('/contacts',undefined,token,'GET')).status,402,'unpaid team blocked');
    const personal=await fetch(f.base+'/api/contacts',{headers:{Authorization:'Bearer '+token,'X-Klyo-Scope':'personal'}});assert.equal(personal.status,402,'Personal does not bypass signup paywall');
    assert.equal((await call('/billing/status',undefined,token,'GET')).data.checkout_required,true);
    const first=await call('/billing/onboarding/checkout',{tier:'plus'},token);assert.equal(first.status,200);
    assert.equal((await call('/billing/onboarding/checkout',{tier:'plus'},token)).status,200);assert.equal(checkoutCalls,1,'open checkout reused');
    assert.equal((await call('/billing/onboarding/complete',{session_id:'cs_test_1'},token)).status,409,'cancelled/incomplete checkout cannot unlock');
    const session=remote.get('cs_test_1');Object.assign(session,{status:'complete',payment_status:'no_payment_required',subscription:'sub_trial',customer:'cus_fixture'});
    assert.equal((await call('/billing/onboarding/complete',{session_id:session.id},f.token(0))).status,403,'another workspace cannot claim checkout');
    assert.equal((await call('/billing/onboarding/complete',{session_id:session.id},token)).status,200);
    assert.equal((await call('/billing/status',undefined,token,'GET')).data.checkout_required,false);
    assert.equal((await call('/contacts',undefined,token,'GET')).status,200);
    const w=(await f.db.query('SELECT * FROM workspaces WHERE id=$1',[wid])).rows[0];assert.equal(w.trial_used,true);assert.equal(w.stripe_subscription_id,'sub_trial');assert.ok(w.trial_ends_at);
    // A correct password only starts another SMS challenge; recovery codes cannot replace SMS.
    await f.db.query("UPDATE mfa_challenges SET sent_at=now()-interval '61 seconds' WHERE user_id=$1",[user.id]);
    const login=await call('/auth/login',{email:signup.email,password:signup.password});assert.equal(login.data.mfa_required,true);assert.equal(login.data.token,undefined);
    assert.equal((await call('/mfa/verify',{challenge:login.data.challenge,code:'ABCDEF1234567890ABCD'})).status,401);
    // Existing accounts including Google accounts receive an enrollment-only token.
    const google=(await f.db.query("INSERT INTO users(workspace_id,name,email,password_hash,google_id) VALUES($1,'Google','google@example.test',NULL,'google-id') RETURNING *",[wid])).rows[0];
    const enrollment=await M.login(google,'google-ip');assert.equal(enrollment.mfa_enrollment_required,true);
    assert.equal((await call('/contacts',undefined,enrollment.enrollment_token,'GET')).status,401);
    assert.equal((await call('/mfa/login-enroll',{enrollment_token:enrollment.enrollment_token,phone:'+48123456780'})).status,200);
    // Resend recovery never reveals whether an email exists.
    const known=await call('/auth/forgot-password',{email:signup.email}),unknown=await call('/auth/forgot-password',{email:'unknown@example.test'});
    assert.deepEqual(known,unknown);assert.equal(messages.length,1);
    const resetToken=messages[0][2].match(/reset_token=([a-f0-9]{64})/)[1];
    assert.equal((await call('/auth/reset-password',{token:resetToken,password:'ChangedPassword2026!'})).status,200);
    assert.equal((await call('/auth/reset-password',{token:resetToken,password:'OtherPassword2026!'})).status,400);
    assert.equal((await call('/auth/me',undefined,token,'GET')).status,401,'reset revokes all old sessions');
    assert.equal((await call('/mfa/verify',{challenge:login.data.challenge,code:'123456'})).status,401,'reset revokes pending sign-ins');
    assert.equal((await f.db.query('SELECT mfa_enabled FROM users WHERE id=$1',[user.id])).rows[0].mfa_enabled,true);
    // Enrollment persists when delivery is unavailable; access never silently falls back to password-only.
    await f.db.query("UPDATE mfa_challenges SET sent_at=now()-interval '61 seconds' WHERE user_id=$1",[user.id]);
    const saved=M.provider;M.provider=async()=>{throw new Error('offline');};
    const retry=await M.login((await f.db.query('SELECT * FROM users WHERE id=$1',[user.id])).rows[0],'new-ip');assert.equal(retry.mfa_required,true);assert.equal(retry.sms_sent,false);assert.equal(retry.token,undefined);M.provider=saved;
  }finally{M.provider=originals.provider;Mail.send=originals.send;Stripe.getClient=originals.getClient;Stripe.getSubscription=originals.getSubscription;Stripe.createCheckoutSession=originals.create;await f.close();}
});
