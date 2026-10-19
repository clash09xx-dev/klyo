const router=require('../middleware/safeRouter')();
const db=require('../db'),cards=require('../services/businessCards');
const {requireAuth,requireEditor}=require('../middleware/auth');
const {requirePaidAccess}=require('../middleware/billing');
router.use(requireAuth,requirePaidAccess,requireEditor);
router.post('/',async(req,res)=>{
 const {request_id}=req.body||{};
 if(typeof request_id!=='string'||!/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(request_id))throw cards.fail('A scan request ID is required.');
 const photo=cards.image(req.body.image),user=req.user,client=await db.pool.connect();let scan;
 try{
  await client.query('BEGIN');
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',['card-rate:'+user.id]);
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',['card-workspace-rate:'+user.workspace_id]);
  const previous=(await client.query('SELECT s.*,c.full_name FROM contact_card_scans s LEFT JOIN contacts c ON c.id=s.contact_id AND c.workspace_id=s.workspace_id WHERE s.workspace_id=$1 AND s.user_id=$2 AND s.request_id=$3',[user.workspace_id,user.id,request_id])).rows[0];
  if(previous){
   if(previous.image_hash!==photo.hash)throw cards.fail('Use a new request ID for a different photo.',409);
   if(previous.state==='done'&&previous.contact_id&&previous.full_name){await client.query('COMMIT');return res.json({contact:{id:previous.contact_id,full_name:previous.full_name},duplicate:true});}
   throw cards.fail(previous.state==='pending'?'This card is still being read. Please wait.':'Please choose the photo again.',409,previous.state==='pending'?'SCAN_PENDING':'SCAN_RETRY');
  }
  const rate=(await client.query("SELECT count(*) FILTER(WHERE created_at>now()-interval '1 minute') AS minute,count(*) AS day FROM contact_card_scans WHERE user_id=$1 AND created_at>now()-interval '1 day'",[user.id])).rows[0];
  const workspaceCount=(await client.query("SELECT count(*) FROM contact_card_scans WHERE workspace_id=$1 AND created_at>now()-interval '30 days'",[user.workspace_id])).rows[0].count;
  if(Number(rate.minute)>=6||Number(rate.day)>=50||Number(workspaceCount)>=500)throw cards.fail('Scanning limit reached. Please add the contact manually or try later.',429,'SCAN_LIMIT');
  scan=(await client.query('INSERT INTO contact_card_scans(workspace_id,user_id,request_id,image_hash) VALUES($1,$2,$3,$4) RETURNING id',[user.workspace_id,user.id,request_id,photo.hash])).rows[0];
  await client.query('COMMIT');
  const cached=(await client.query("SELECT c.* FROM contact_card_scans s JOIN contacts c ON c.id=s.contact_id AND c.workspace_id=s.workspace_id WHERE s.workspace_id=$1 AND s.image_hash=$2 AND s.state='done' LIMIT 1",[user.workspace_id,photo.hash])).rows[0];
  const extracted=cached?null:await cards.extract(photo.url);
  await client.query('BEGIN');
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',['contact-create:'+user.workspace_id]);
  let contact=(await client.query("SELECT c.* FROM contact_card_scans s JOIN contacts c ON c.id=s.contact_id AND c.workspace_id=s.workspace_id WHERE s.workspace_id=$1 AND s.image_hash=$2 AND s.state='done' LIMIT 1",[user.workspace_id,photo.hash])).rows[0],duplicate=!!contact;
  if(!contact){
   if(!extracted)throw cards.fail("The contact was removed. Please scan again.",409,"SCAN_RETRY");
   const draft=extracted.contact;
   if(!extracted.readable){await client.query("UPDATE contact_card_scans SET state='review' WHERE id=$1",[scan.id]);await client.query('COMMIT');return res.json({needs_review:true,draft,reason:'unclear'});}
   // Never overwrite an existing record. Shared switchboards require an identical name.
   contact=(await client.query(`SELECT * FROM contacts WHERE workspace_id=$1 AND (
    ($2<>'' AND lower(email)=lower($2)) OR
    ($3<>'' AND regexp_replace(coalesce(phone,''),'[^0-9]','','g')=$3 AND lower(full_name)=lower($4))) ORDER BY id LIMIT 1`,[user.workspace_id,draft.email,draft.phone.replace(/\D/g,''),[draft.first_name,draft.last_name].filter(Boolean).join(' ')])).rows[0];
   duplicate=!!contact;
   if(!contact){
    const required=(await require('../services/customFields').definitions(client,user.workspace_id,'contact')).some(d=>d.required);
    if(required){await client.query("UPDATE contact_card_scans SET state='review' WHERE id=$1",[scan.id]);await client.query('COMMIT');return res.json({needs_review:true,draft,reason:'required_fields'});}
    contact=await require('../services/contactCreation').createContact(user,{...draft,lead_source:'Business card',status:'lead'},client);
   }
  }
  await client.query("UPDATE contact_card_scans SET state='done',contact_id=$2 WHERE id=$1",[scan.id,contact.id]);
  await client.query('COMMIT');res.status(duplicate?200:201).json({contact,duplicate});
 }catch(e){
  await client.query('ROLLBACK');
  if(scan)await client.query("UPDATE contact_card_scans SET state='failed' WHERE id=$1 AND state='pending'",[scan.id]);
  if(e.code==='LIMIT_EXCEEDED')return res.status(403).json({error:e.message,code:e.code});
  if(e.status)return res.status(e.status).json({error:e.message,code:e.code});throw e;
 }finally{client.release();}
});
module.exports=router;
