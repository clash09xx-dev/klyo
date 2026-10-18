const test=require('node:test'),assert=require('node:assert/strict'),jwt=require('jsonwebtoken');
test('SMS verification: restricted enrollment, attempts, expiry, resend cooldown, concurrent replay, mandatory setting and session binding',{skip:!process.env.TEST_DATABASE_URL},async()=>{
 const f=await require('./helpers/calendar-fixture')(),M=require('../server/services/mfa'),S=require('../server/services/sharepoint'),original=M.provider;let calls=0;
 const call=async(p,b,token)=>{const r=await fetch(f.base+'/api'+p,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(b)});return{status:r.status,data:await r.json()};};
 try{
 process.env.TWILIO_ACCOUNT_SID='ACfixture';process.env.TWILIO_AUTH_TOKEN='fixture';process.env.TWILIO_VERIFY_SERVICE_SID='VA'+'f'.repeat(32);
 M.provider=async(p,b)=>p==='Verifications'?{sid:'VE'+ ++calls,status:'pending'}:{status:b.Code==='123456'?'approved':'pending'};
 await f.db.query('UPDATE users SET mfa_enabled=false WHERE id=$1',[f.users[0].id]);
 const u=(await f.db.query('SELECT * FROM users WHERE id=$1',[f.users[0].id])).rows[0],enrollment=await M.login(u,'ip');
 assert.equal(enrollment.mfa_enrollment_required,true);assert.equal(enrollment.token,undefined);
 const expired=jwt.sign({id:u.id,purpose:'mfa_enrollment',version:0},process.env.JWT_SECRET,{expiresIn:-1});
 assert.equal((await call('/mfa/login-enroll',{enrollment_token:expired,phone:'+48123456789'})).status,401);
 const challenge=await call('/mfa/login-enroll',{enrollment_token:enrollment.enrollment_token,phone:'+48123456789'});assert.equal(challenge.status,200);
 assert.equal((await call('/mfa/resend',{challenge:challenge.data.challenge})).status,429);
 assert.equal((await call('/mfa/verify',{challenge:challenge.data.challenge,code:'wrong'})).status,401);
 assert.equal((await call('/mfa/confirm',{challenge:challenge.data.challenge,code:'123456'},f.token(1))).status,401,'another user cannot confirm enrollment');
 const successes=await Promise.all([1,2].map(()=>call('/mfa/verify',{challenge:challenge.data.challenge,code:'123456'})));assert.deepEqual(successes.map(x=>x.status).sort(),[200,401]);
 const token=successes.find(x=>x.status===200).data.token;
 assert.equal((await call('/mfa/disable',{},token)).status,403);
 const stored=(await f.db.query('SELECT * FROM users WHERE id=$1',[u.id])).rows[0];assert.ok(stored.mfa_enabled);assert.ok(!stored.mfa_phone.includes('+48123456789'));assert.equal(S.decrypt(stored.mfa_phone),'+48123456789');
 assert.equal(jwt.verify(token,process.env.JWT_SECRET).sms_verified,true);
 await f.db.query("UPDATE mfa_challenges SET sent_at=now()-interval '61 seconds'");
 const login=await M.login(stored,'ip');assert.equal(login.sms_sent,true);assert.equal(login.token,undefined);
 await f.db.query("UPDATE mfa_challenges SET sent_at=now()-interval '61 seconds' WHERE token_hash=$1",[M.hash(login.challenge)]);
 assert.equal((await call('/mfa/resend',{challenge:login.challenge})).status,200);assert.equal((await call('/mfa/resend',{challenge:login.challenge})).status,429);
 for(let n=0;n<5;n++)assert.equal((await call('/mfa/verify',{challenge:login.challenge,code:'999999'})).status,401);
 assert.equal((await call('/mfa/verify',{challenge:login.challenge,code:'123456'})).status,401,'five wrong attempts permanently consume challenge capacity');
 await f.db.query("UPDATE mfa_challenges SET sent_at=now()-interval '61 seconds'");
 const next=await M.login(stored,'next-ip');await f.db.query("UPDATE mfa_challenges SET expires_at=now()-interval '1 second' WHERE token_hash=$1",[M.hash(next.challenge)]);
 assert.equal((await call('/mfa/verify',{challenge:next.challenge,code:'123456'})).status,401);
 }finally{M.provider=original;await f.close();}
});
