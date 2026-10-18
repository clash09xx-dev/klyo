const test=require('node:test');const assert=require('node:assert/strict');
const P=require('../public/js/preferences-core');
test('personal workspace preferences persist per account, preserve permissions and validate input',{skip:!process.env.TEST_DATABASE_URL},async t=>{
 const {Pool}=require('pg'),express=require('express'),jwt=require('jsonwebtoken');
 const schema=`klyo_prefs_${process.pid}_${Date.now()}`,admin=new Pool({connectionString:process.env.TEST_DATABASE_URL,ssl:false});await admin.query(`CREATE SCHEMA ${schema}`);
 const url=new URL(process.env.TEST_DATABASE_URL);url.searchParams.set('options',`-c search_path=${schema}`);process.env.DATABASE_URL=url.toString();process.env.PGSSL='false';process.env.JWT_SECRET='isolated-preference-test';process.env.PLATFORM_ADMIN_EMAIL='owner@example.test';
 const db=require('../server/db');let server;
 try{
  await db.init();
    await db.query("ALTER TABLE users ALTER COLUMN mfa_enabled SET DEFAULT true");await db.init();
    await db.query("ALTER TABLE users ALTER COLUMN mfa_enabled SET DEFAULT true");
  await db.query("INSERT INTO workspaces(id,name,invite_code,is_comped) VALUES(1,'A','A',true),(2,'B','B',true)");
  await db.query("INSERT INTO users(id,workspace_id,name,email,password_hash,role,theme) VALUES(1,1,'Owner','owner@example.test','fixture','admin','blanc'),(2,1,'Viewer','viewer@example.test','fixture','viewer','noir'),(3,2,'Other','other@example.test','fixture','admin','blanc')");
  const app=express();app.use(express.json());app.use('/api/auth',require('../server/routes/auth'));app.use('/api/platform',require('../server/routes/platform'));
  server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});const base=`http://127.0.0.1:${server.address().port}/api`;
  async function req(route,method='GET',body,id=2,workspace_id=id===3?2:1){const token=jwt.sign({ sms_verified: true,id,workspace_id,email:id===1?'owner@example.test':id===2?'viewer@example.test':'other@example.test',role:id===2?'viewer':'admin'},process.env.JWT_SECRET);const r=await fetch(base+route,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return{status:r.status,data:await r.json()};}
  await t.test('legacy palettes migrate without changing other accounts',async()=>{assert.equal((await req('/auth/preferences')).data.preferences.palette.preset,'midnight');assert.equal((await req('/auth/preferences','GET',undefined,1)).data.preferences.palette.preset,'day');});
  await t.test('a viewer can save their own colors, positions and ordering',async()=>{
   const prefs=P.defaults('custom');prefs.palette.custom.background='#102030';prefs.layout.sidebar='right';prefs.layout.density='comfortable';prefs.layout.start_view='deals';prefs.layout.nav_order=['deals',...P.NAV.filter(k=>k!=='deals')];prefs.layout.hidden_nav=['calendar'];prefs.layout.contact_columns=['name','stage',...P.COLUMNS.filter(k=>!['name','stage'].includes(k))];prefs.layout.hidden_columns=['tags'];prefs.layout.summary_position='below';prefs.layout.overview_order=['losses','metrics','stages'];
   const r=await req('/auth/preferences','PUT',{...prefs,user_id:1,is_platform_admin:true});assert.equal(r.status,200,JSON.stringify(r.data));assert.deepEqual((await req('/auth/preferences')).data.preferences,prefs);
   const me=(await req('/auth/me')).data.user;assert.deepEqual(me.workspace_preferences,prefs);assert.equal(me.is_platform_admin,false);
   assert.deepEqual((await req('/auth/me','GET',undefined,1)).data.user.workspace_preferences,{});
   assert.equal((await req('/auth/me','GET',undefined,1)).data.user.is_platform_admin,true);
   assert.equal((await req('/platform/users')).status,403);assert.equal((await req('/platform/users','GET',undefined,3)).status,403);
  });
  await t.test('cross-workspace identity and invalid layouts cannot change settings',async()=>{
   assert.equal((await req('/auth/preferences','PUT',P.defaults(),2,2)).status,401);
   for(const invalid of [{palette:{custom:{background:'red;display:none'}}},{layout:{nav_order:['platform']}},{layout:{hidden_nav:P.NAV}},{layout:{hidden_columns:['name']}},{layout:{overview_order:['metrics','metrics']}}])assert.equal((await req('/auth/preferences','PUT',invalid)).status,400);
   assert.equal((await req('/auth/preferences')).data.preferences.layout.sidebar,'right');
   assert.equal((await req('/auth/preferences','GET',undefined,3)).data.preferences.layout.sidebar,'left');
  });
  await t.test('legacy theme endpoint stays compatible, and reset restores only the current account',async()=>{
   assert.equal((await req('/auth/theme','PUT',{theme:'blanc'})).status,200);assert.equal((await req('/auth/preferences')).data.preferences.palette.preset,'day');
   assert.equal((await req('/auth/preferences','PUT',P.defaults())).status,200);assert.deepEqual((await req('/auth/preferences')).data.preferences,P.defaults());
   assert.equal((await db.query('SELECT is_comped FROM workspaces WHERE id=1')).rows[0].is_comped,true);
  });
 }finally{if(server)await new Promise(resolve=>server.close(resolve));await db.pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
});
