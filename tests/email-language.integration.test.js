const test=require('node:test');
const assert=require('node:assert/strict');
// The model is stubbed: this test checks persisted drafts, language inputs and no send.
test('email instruction and saved fallback reach the generator without sending mail',{skip:!process.env.TEST_DATABASE_URL},async t=>{
 const {Pool}=require('pg'),express=require('express'),jwt=require('jsonwebtoken');
 const schema=`klyo_email_${process.pid}_${Date.now()}`,admin=new Pool({connectionString:process.env.TEST_DATABASE_URL,ssl:false});
 await admin.query(`CREATE SCHEMA ${schema}`);
 const url=new URL(process.env.TEST_DATABASE_URL);url.searchParams.set('options',`-c search_path=${schema}`);
 process.env.DATABASE_URL=url.toString();process.env.PGSSL='false';process.env.JWT_SECRET='isolated-email-test';
 const generatorPath=require.resolve('../server/services/openai');let calls=[];
 require.cache[generatorPath]={id:generatorPath,filename:generatorPath,loaded:true,exports:{generateOfferEmail:async(...args)=>{calls.push(args);return{subject:'Rozmowa o stronie',body:'Dzień dobry, kiedy możemy porozmawiać?'};}}};
 const db=require('../server/db');let server;
 try{
  await db.init();
    await db.query("ALTER TABLE users ALTER COLUMN mfa_enabled SET DEFAULT true");
  await db.query("INSERT INTO workspaces(id,name,invite_code,is_comped,ai_context) VALUES(1,'A','A',true,'English business reference'),(2,'B','B',true,'Other business')");
  await db.query("INSERT INTO users(id,workspace_id,name,email,password_hash,role,language) VALUES(1,1,'Sender','sender@example.test','fixture','admin','pl'),(2,1,'Viewer','viewer@example.test','fixture','viewer','en'),(3,2,'Other','other@example.test','fixture','admin','es')");
  await db.query("INSERT INTO contacts(id,workspace_id,full_name,notes) VALUES(1,1,'Customer','English reference note')");
  const app=express();app.use(express.json());app.use('/api/contacts',require('../server/routes/contacts'));
  server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  const base=`http://127.0.0.1:${server.address().port}/api/contacts/1/offers/generate`;
  async function request(body,id=1){const token=jwt.sign({ sms_verified: true,id,workspace_id:id===3?2:1,name:'Sender',role:id===2?'viewer':'admin'},process.env.JWT_SECRET);const r=await fetch(base,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(body)});return{status:r.status,data:await r.json()};}
  await t.test('Polish guidance stays intact and creates only an unsent draft',async()=>{
   const instruction='Napisz krótki email z pytaniem o termin rozmowy.';
   const result=await request({instructions:instruction});assert.equal(result.status,201,JSON.stringify(result.data));
   assert.equal(calls[0][1],instruction);assert.equal(calls[0][3],'English business reference');assert.equal(calls[0][4],'pl');
   const draft=(await db.query('SELECT * FROM offers')).rows[0];assert.equal(draft.status,'draft');assert.equal(draft.sent_at,null);assert.equal(draft.subject,'Rozmowa o stronie');
  });
  await t.test('empty guidance uses saved language and explicit output-language requests are preserved',async()=>{
   assert.equal((await request({instructions:''})).status,201);assert.equal(calls[1][4],'pl');
   assert.equal((await request({instructions:'Napisz ofertę po hiszpańsku.'})).status,201);assert.equal(calls[2][1],'Napisz ofertę po hiszpańsku.');
  });
  await t.test('viewer, another workspace and invalid guidance cannot invoke the model',async()=>{
   const before=calls.length;
   assert.equal((await request({instructions:'Hello'},2)).status,403);
   assert.equal((await request({instructions:'Hola'},3)).status,404);
   assert.equal((await request({instructions:{language:'en'}})).status,400);
   assert.equal((await request({instructions:'a'.repeat(12001)})).status,400);
   assert.equal(calls.length,before);
  });
 }finally{if(server)await new Promise(resolve=>server.close(resolve));await db.pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
});
