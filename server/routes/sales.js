const express = require('express');
const db = require('../db');
const { requireAuth,requireEditor } = require('../middleware/auth');
const { requirePaidAccess } = require('../middleware/billing');
const { text, optionalId, invalid } = require('../services/dealWorkspace');
const router=express.Router();
router.use(requireAuth,requirePaidAccess);
const action = handler => async(req,res) => { try { await handler(req,res); } catch(error) {
  if (!error.status) console.error('Sales workspace:',error.message);
  res.status(error.status||500).json({error:error.status?error.message:'Could not load or save this item.'});
}};
router.get('/summary', action(async(req,res)=>{
  const wid=req.user.workspace_id;
  const [totals,stages,losses,tasks]=await Promise.all([
    db.query(`SELECT currency,status,COUNT(*)::int AS count,COALESCE(SUM(value),0) AS value FROM deals WHERE workspace_id=$1 AND deleted_at IS NULL GROUP BY currency,status ORDER BY currency,status`,[wid]),
    db.query(`SELECT s.id,s.name,s.color,p.name AS pipeline_name,COUNT(d.id)::int AS count,d.currency,COALESCE(SUM(d.value),0) AS value
      FROM pipeline_stages s LEFT JOIN sales_pipelines p ON p.id=s.pipeline_id AND p.workspace_id=s.workspace_id LEFT JOIN deals d ON d.stage_id=s.id AND d.workspace_id=s.workspace_id AND d.deleted_at IS NULL AND d.status='open'
      WHERE s.workspace_id=$1 GROUP BY s.id,p.name,d.currency ORDER BY p.name,s.sort_order,s.id`,[wid]),
    db.query(`SELECT COALESCE(NULLIF(lost_reason,''),'Not recorded') AS reason,COUNT(*)::int AS count FROM deals WHERE workspace_id=$1 AND deleted_at IS NULL AND status='lost' GROUP BY 1 ORDER BY count DESC LIMIT 10`,[wid]),
    db.query(`SELECT
      (SELECT COUNT(*)::int FROM tasks WHERE workspace_id=$1 AND status!='done' AND due_date<CURRENT_DATE) AS overdue,
      (SELECT COUNT(*)::int FROM deals d WHERE workspace_id=$1 AND deleted_at IS NULL AND status='open' AND NOT EXISTS (SELECT 1 FROM tasks t WHERE t.deal_id=d.id AND t.workspace_id=$1 AND t.status!='done')) AS without_next_step`,[wid]),
  ]);
  res.json({totals:totals.rows,stages:stages.rows,losses:losses.rows,...tasks.rows[0]});
}));
router.get('/views', action(async(req,res)=>{
  res.json({views:(await db.query('SELECT id,name,filters FROM saved_deal_views WHERE workspace_id=$1 AND user_id=$2 ORDER BY name',[req.user.workspace_id,req.user.id])).rows});
}));
router.post('/views', action(async(req,res)=>{
  const name=text(req.body.name,80,'view name',true);
  const filters={};
  for (const key of ['pipeline_id','stage_id','assigned_to','status','attention','search']) {
    if(req.body.filters?.[key] != null) filters[key]=String(req.body.filters[key]).slice(0,200);
  }
  if(!['','open','won','lost','all','deleted'].includes(filters.status||'')) throw invalid('Invalid status.');
  if(!['','today','overdue','no_next','stale'].includes(filters.attention||'')) throw invalid('Invalid activity filter.');
  const result=await db.query(`INSERT INTO saved_deal_views (workspace_id,user_id,name,filters) VALUES ($1,$2,$3,$4)
    ON CONFLICT (workspace_id,user_id,name) DO UPDATE SET filters=EXCLUDED.filters RETURNING *`,[req.user.workspace_id,req.user.id,name,JSON.stringify(filters)]);
  res.status(201).json({view:result.rows[0]});
}));
router.delete('/views/:id',action(async(req,res)=>{
  const result=await db.query('DELETE FROM saved_deal_views WHERE id=$1 AND workspace_id=$2 AND user_id=$3 RETURNING id',[optionalId(req.params.id),req.user.workspace_id,req.user.id]);
  if(!result.rows.length) throw invalid('View not found.',404);
  res.json({ok:true});
}));
router.get('/templates',action(async(req,res)=>{
  res.json({templates:(await db.query('SELECT id,name,subject,body FROM email_templates WHERE workspace_id=$1 ORDER BY name,id',[req.user.workspace_id])).rows});
}));
router.post('/templates',requireEditor,action(async(req,res)=>{
  const name=text(req.body.name,100,'template name',true);
  const subject=text(req.body.subject,500,'subject',true);
  const body=text(req.body.body,20000,'message',true);
  const result=await db.query('INSERT INTO email_templates (workspace_id,created_by,name,subject,body) VALUES ($1,$2,$3,$4,$5) RETURNING *',[req.user.workspace_id,req.user.id,name,subject,body]);
  res.status(201).json({template:result.rows[0]});
}));
router.delete('/templates/:id',requireEditor,action(async(req,res)=>{
  const result=await db.query('DELETE FROM email_templates WHERE id=$1 AND workspace_id=$2 RETURNING id',[optionalId(req.params.id),req.user.workspace_id]);
  if(!result.rows.length) throw invalid('Template not found.',404);
  res.json({ok:true});
}));
module.exports=router;
