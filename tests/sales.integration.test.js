const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {normalizeDeal,validDate}=require('../server/services/dealWorkspace');
test('deal validation rejects incomplete losses and invalid values',()=>{
  assert.throws(()=>normalizeDeal({title:'Example',status:'lost'}),/loss reason/);
  assert.throws(()=>normalizeDeal({title:'Example',value:-1}),/value/);
  assert.throws(()=>normalizeDeal({title:'Example',stage_id:'not-an-id'}),/record ID/);
  assert.throws(()=>validDate('2026-02-31'),/date/);
  assert.equal(normalizeDeal({title:' Example ',currency:'pln'}).currency,'PLN');
});
test('no messaging scheduler or WhatsApp integration is started',()=>{
  const source=fs.readFileSync(require.resolve('../server/index'),'utf8');
  assert.doesNotMatch(source,/reminderCron|whatsapp/i);
  assert.equal(fs.existsSync(require.resolve('../server/db').replace(/db\.js$/,'services/whatsapp.js')),false);
});
test('manual sales workspace: persistence, history, permissions and isolation', {skip:!process.env.TEST_DATABASE_URL}, async t=>{
  const {Pool}=require('pg');const express=require('express');const jwt=require('jsonwebtoken');
  const schema=`klyo_sales_${process.pid}_${Date.now()}`;
  const admin=new Pool({connectionString:process.env.TEST_DATABASE_URL,ssl:false});await admin.query(`CREATE SCHEMA ${schema}`);
  const url=new URL(process.env.TEST_DATABASE_URL);url.searchParams.set('options',`-c search_path=${schema}`);
  process.env.DATABASE_URL=url.toString();process.env.PGSSL='false';process.env.JWT_SECRET='test-only-sales-secret';
  const db=require('../server/db');let server;
  try{
    await db.init();await db.init();
    await db.query("INSERT INTO workspaces (id,name,invite_code,is_comped,default_currency) VALUES (1,'A','A',true,'PLN'),(2,'B','B',true,'EUR')");
    await db.query("INSERT INTO users (id,workspace_id,name,email,password_hash,role) VALUES (1,1,'Admin','a@example.test','fixture','admin'),(2,1,'Member','m@example.test','fixture','member'),(3,2,'Other','b@example.test','fixture','admin')");
    await db.query("INSERT INTO contacts (id,workspace_id,full_name,email) VALUES (1,1,'Client A','a@client.test'),(2,2,'Client B','b@client.test')");
    await db.query("SELECT setval(pg_get_serial_sequence('contacts','id'),2)");
    await db.query("INSERT INTO pipeline_stages (id,workspace_id,name,sort_order) VALUES (1,1,'Contacted',0),(2,1,'Proposal',1),(3,2,'Other stage',0)");
    const app=express();app.use(express.json());
    for(const name of ['deals','sales','offers','tasks','contacts','auth'])app.use('/api/'+name,require('../server/routes/'+name));
    server=await new Promise(resolve=>{const listener=app.listen(0,'127.0.0.1',()=>resolve(listener));});
    const base=`http://127.0.0.1:${server.address().port}/api`;
    async function request(path,method='GET',body,options={}){
      const workspace_id=options.workspace||1,id=options.id||(workspace_id===2?3:1),role=options.role||'admin';
      const token=jwt.sign({id,workspace_id,role,name:'Test user'},process.env.JWT_SECRET);
      const response=await fetch(base+path,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
      const raw=await response.text();let data;try{data=JSON.parse(raw);}catch{data=raw;}
      return{status:response.status,data};
    }
    let id;
    await t.test('new deals have stage history and validate all linked workspaces',async()=>{
      const result=await request('/deals','POST',{title:'Website',stage_id:1,contact_id:1,assigned_to:1,value:4500,expected_close_date:'2026-11-15'});
      assert.equal(result.status,201,JSON.stringify(result.data));id=result.data.deal.id;
      assert.equal(result.data.deal.currency,'PLN');assert.ok(result.data.deal.stage_entered_at);
      assert.equal((await request(`/deals/${id}/history`)).data.events[0].event_type,'created');
      assert.equal((await request(`/deals/${id}`,'PUT',{stage_id:3})).status,400);
      assert.equal((await request(`/deals/${id}`,'PUT',{contact_id:2})).status,400);
      assert.equal((await request(`/deals/${id}`,'GET',undefined,{workspace:2})).status,404);
      assert.equal((await request('/deals','POST',{title:'Blocked'},{role:'viewer'})).status,403);
    });
    await t.test('stage changes are recorded once and editing a note preserves time in stage',async()=>{
      await db.query("UPDATE deals SET stage_entered_at=now()-interval '8 days' WHERE id=$1",[id]);
      const before=(await request(`/deals/${id}`)).data.deal.stage_entered_at;
      const edit=await request(`/deals/${id}`,'PUT',{notes:'New context'});assert.equal(edit.status,200,JSON.stringify(edit.data));
      assert.equal(edit.data.deal.stage_entered_at,before);
      assert.equal((await request(`/deals/${id}/history`)).data.events.length,1);
      assert.equal((await request(`/deals/${id}/stage`,'PATCH',{stage_id:2})).status,200);
      const history=(await request(`/deals/${id}/history`)).data.events;
      assert.equal(history.length,2);assert.equal(history[0].from_stage,'Contacted');assert.equal(history[0].to_stage,'Proposal');
    });
    await t.test('next steps are manual tasks, support completion and respect workspace boundaries',async()=>{
      const created=await request(`/deals/${id}/next-step`,'POST',{title:'Review proposal',due_date:'2026-01-01'});
      assert.equal(created.status,201,JSON.stringify(created.data));const task=created.data.task;
      assert.equal(task.deal_id,id);assert.equal(task.assigned_to,1);assert.equal(task.contact_id,1);
      let deal=(await request(`/deals/${id}`)).data.deal;assert.equal(deal.next_task_id,task.id);assert.equal(deal.overdue_tasks,1);assert.equal(deal.next_task_due,'2026-01-01');
      assert.equal((await request(`/deals/${id}/next-step`,'POST',{title:'No',due_date:'2026-01-01'},{workspace:2})).status,404);
      assert.equal((await request(`/tasks/${task.id}/status`,'PATCH',{status:'done'},{role:'viewer'})).status,403);
      assert.equal((await request(`/tasks/${task.id}/status`,'PATCH',{status:'done'})).status,200);
      deal=(await request(`/deals/${id}`)).data.deal;assert.equal(deal.next_task_id,null);
      assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM tasks')).rows[0].n,1);
    });
    await t.test('loss reason is mandatory and summaries keep currencies separate',async()=>{
      assert.equal((await request(`/deals/${id}`,'PUT',{status:'lost'})).status,400);
      const lost=await request(`/deals/${id}`,'PUT',{status:'lost',lost_reason:'Budget postponed'});assert.equal(lost.status,200);assert.ok(lost.data.deal.closed_at);
      const won=await request('/deals','POST',{title:'Won project',value:2000,currency:'EUR',status:'won'});assert.equal(won.status,201);
      const summary=(await request('/sales/summary')).data;
      assert.ok(summary.totals.some(row=>row.currency==='PLN'&&row.status==='lost'&&row.value==='4500.00'));
      assert.ok(summary.totals.some(row=>row.currency==='EUR'&&row.status==='won'&&row.value==='2000.00'));
      assert.equal(summary.losses[0].reason,'Budget postponed');
      assert.equal((await request('/sales/summary','GET',undefined,{workspace:2})).data.totals.length,0);
      const reopened=await request(`/deals/${id}`,'PUT',{status:'open'});assert.equal(reopened.data.deal.closed_at,null);assert.equal(reopened.data.deal.lost_reason,null);
    });
    await t.test('saved views persist privately and templates remain workspace scoped',async()=>{
      const view=await request('/sales/views','POST',{name:'My overdue work',filters:{attention:'overdue',status:'open',sql:'ignored'}});
      assert.equal(view.status,201);assert.equal(view.data.view.filters.sql,undefined);
      assert.equal((await request('/sales/views')).data.views.length,1);
      assert.equal((await request('/sales/views','GET',undefined,{id:2,role:'member'})).data.views.length,0);
      assert.equal((await request(`/sales/views/${view.data.view.id}`,'DELETE',undefined,{id:2,role:'member'})).status,404);
      const template=await request('/sales/templates','POST',{name:'Introduction',subject:'Hi {first_name}',body:'A message from {sender}.'});
      assert.equal(template.status,201);assert.equal((await request('/sales/templates')).data.templates.length,1);
      assert.equal((await request('/sales/templates','GET',undefined,{workspace:2})).data.templates.length,0);
      assert.equal((await request(`/sales/templates/${template.data.template.id}`,'DELETE',undefined,{workspace:2})).status,404);
      assert.equal((await request('/sales/templates','POST',{name:'No',subject:'No',body:'No'},{role:'viewer'})).status,403);
    });
    await t.test('manual drafts never send and contact editing still persists correctly',async()=>{
      const draft=await request('/offers','POST',{contact_id:1,subject:'Proposal',body:'Please review.'});assert.equal(draft.status,201);assert.equal(draft.data.offer.status,'draft');assert.equal(draft.data.offer.ai_generated,false);assert.equal(draft.data.offer.sent_at,null);
      assert.equal((await request(`/offers/${draft.data.offer.id}`,'PUT',{subject:'Blocked'},{role:'viewer'})).status,403);
      assert.equal((await request(`/offers/${draft.data.offer.id}/send`,'POST',{}, {role:'viewer'})).status,403);
      const saved=await request(`/offers/${draft.data.offer.id}`,'PUT',{subject:'Saved manually',body:'A saved message.'});assert.equal(saved.status,200);assert.equal(saved.data.offer.status,'draft');assert.equal(saved.data.offer.sent_at,null);
      assert.equal((await request('/contacts/1')).data.offers[0].subject,'Saved manually');
      assert.equal((await request('/offers','POST',{contact_id:2,subject:'No',body:'No'})).status,404);
      const created=await request('/contacts','POST',{full_name:'New client',telegram:'example',internal_notes:'Private note'});assert.equal(created.status,201,JSON.stringify(created.data));
      const edit=await request(`/contacts/${created.data.contact.id}`,'PUT',{full_name:'Updated client',telegram:'updated',internal_notes:'Updated note'});assert.equal(edit.status,200,JSON.stringify(edit.data));assert.equal(edit.data.contact.telegram,'updated');assert.equal(edit.data.contact.internal_notes,'Updated note');
      assert.equal((await request('/auth/whatsapp-phone','PUT',{whatsapp_phone:'+48123456789'})).status,404);
    });
    await t.test('failed history insert rolls back the deal change',async()=>{
      await db.query("CREATE FUNCTION fail_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture failure'; END $$; CREATE TRIGGER fail_event BEFORE INSERT ON deal_events FOR EACH ROW EXECUTE FUNCTION fail_event()");
      const before=(await request(`/deals/${id}`)).data.deal;
      assert.equal((await request(`/deals/${id}/stage`,'PATCH',{stage_id:1})).status,500);
      assert.equal((await request(`/deals/${id}`)).data.deal.stage_id,before.stage_id);
    });
  }finally{
    if(server)await new Promise(resolve=>server.close(resolve));await db.pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();
  }
});
