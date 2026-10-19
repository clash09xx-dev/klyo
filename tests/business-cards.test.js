const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('crypto');
const cards=require('../server/services/businessCards');
const photo=(s='one')=>'data:image/jpeg;base64,'+Buffer.concat([Buffer.from([255,216,255]),Buffer.alloc(32),Buffer.from(s)]).toString('base64');
test('card parser accepts only visible fields and valid contact channels',()=>{
 const r=cards.parse(JSON.stringify({is_business_card:true,clearly_readable:true,first_name:'Zoë',last_name:'Reed',email:'zoe@example.test',phone:'+44 (20) 1234 5678',website:'example.test',owner_id:999,custom_fields:{override:true}}));
 assert.equal(r.readable,true);assert.equal(r.contact.website,'https://example.test');assert.equal(r.contact.owner_id,undefined);assert.equal(r.contact.first_name,'Zoë');
 assert.equal(cards.parse(JSON.stringify({is_business_card:true,clearly_readable:true,first_name:'A',email:'bad',phone:'123'})).readable,false);
 assert.equal(cards.parse(JSON.stringify({is_business_card:false,clearly_readable:true,first_name:'A',email:'a@b.test'})).readable,false);
 assert.throws(()=>cards.parse('not JSON'),{code:'CARD_UNREADABLE'});
});
test('card images reject remote URLs, disguised files and oversized input',()=>{
 assert.ok(cards.image(photo()).hash);assert.throws(()=>cards.image('https://internal.invalid/photo'));
 assert.throws(()=>cards.image('data:image/jpeg;base64,'+Buffer.from('<svg>not an image</svg>').toString('base64')));
 assert.throws(()=>cards.image('a'.repeat(5600001)));
});
test('scanning creates contacts safely with retries, workspace isolation, quotas and validation',{skip:!process.env.TEST_DATABASE_URL},async()=>{
 const f=await require('./helpers/calendar-fixture')(),original=cards.extract;let calls=0;
 const sample={first_name:'Jane',last_name:'Reed',email:'jane@north.test',phone:'+442012345678',company:'Northline',title:'Director'};
 cards.extract=async()=>{calls++;return {contact:{...sample},readable:true};};
 const scan=async(s,u=0,scope='team',request_id=crypto.randomUUID())=>f.req('/business-cards','POST',{image:photo(s),request_id},u,scope);
 const age=()=>f.db.query("UPDATE contact_card_scans SET created_at=now()-interval '2 minutes'");
 try{
  let r=await scan('one');assert.equal(r.status,201,JSON.stringify(r));const id=r.data.contact.id;
  assert.equal(r.data.contact.company,'Northline');assert.equal(r.data.contact.owner_id,f.users[0].id);
  assert.equal((await f.req('/contacts/'+id)).data.contact.full_name,'Jane Reed');
  assert.equal((await f.db.query('SELECT count(*) FROM activity_log WHERE contact_id=$1',[id])).rows[0].count,'1');
  r=await scan('one');assert.equal(r.data.duplicate,true);assert.equal(calls,1,'same photo bypasses AI');
  const reqid=crypto.randomUUID();r=await scan('two',0,'team',reqid);assert.equal(r.data.contact.id,id);assert.equal(r.data.duplicate,true);
  const replay=await scan('two',0,'team',reqid);assert.equal(replay.data.contact.id,id);assert.equal(calls,2);
  assert.equal((await scan('different',0,'team',reqid)).status,409);
  assert.equal((await scan('one',2)).status,403,'viewers cannot scan');
  r=await scan('one',3);assert.equal(r.status,201);assert.notEqual(r.data.contact.id,id);
  r=await scan('one',0,'personal');assert.equal(r.status,201);assert.notEqual(r.data.contact.id,id);
  await age();
  cards.extract=async()=>({contact:{...sample,email:'other@north.test',first_name:'Other'},readable:true});
  r=await scan('shared-phone');assert.equal(r.status,201,'shared office number does not merge different people');
  cards.extract=async()=>({contact:{first_name:'Blurred'},readable:false});
  r=await scan('unclear');assert.equal(r.status,200);assert.equal(r.data.needs_review,true);assert.equal(r.data.reason,'unclear');
  await require('../server/services/customFields').save(f.db,f.w,null,{entity:'contact',name:'Region',type:'text',required:true});
  cards.extract=async()=>({contact:{...sample,email:'new@north.test',phone:'',first_name:'New'},readable:true});
  r=await scan('required');assert.equal(r.data.needs_review,true);assert.equal(r.data.reason,'required_fields');
  assert.equal((await f.req('/contacts','POST',{first_name:'Quick'})).status,400,'quick contact obeys custom fields');
  await f.db.query('UPDATE custom_field_definitions SET required=false WHERE workspace_id=$1',[f.w]);
  await age();
  let release;cards.extract=()=>new Promise(r=>{release=r;});
  const pendingId=crypto.randomUUID(),pending=scan('pending',0,'team',pendingId);
  for(let i=0;i<100&&!release;i++)await new Promise(r=>setTimeout(r,10));assert.ok(release);
  assert.equal((await scan('pending',0,'team',pendingId)).status,409);
  release({contact:{...sample,email:'race@north.test',phone:''},readable:true});assert.equal((await pending).status,201);
  cards.extract=async()=>({contact:{...sample,email:'race2@north.test',phone:''},readable:true});
  const concurrent=await Promise.all([scan('race1'),scan('race2')]);assert.deepEqual(concurrent.map(r=>r.status).sort(),[200,201]);assert.equal(concurrent[0].data.contact.id,concurrent[1].data.contact.id);
  await age();
  const before=(await f.req('/contacts')).data.contacts.length;
  cards.extract=async()=>{throw cards.fail('Unavailable',503,'SCANNER_UNAVAILABLE');};
  assert.equal((await scan('fail')).status,503);assert.equal((await f.req('/contacts')).data.contacts.length,before);
  assert.equal((await f.req('/business-cards','POST',{request_id:crypto.randomUUID(),image:'https://example.test'})).status,400);
  // Rate limits persist in the database across processes.
  await f.db.query("UPDATE contact_card_scans SET created_at=now() WHERE user_id=$1",[f.users[0].id]);
  assert.equal((await scan('over-quota')).status,429);
 }finally{cards.extract=original;await f.close();}
});
