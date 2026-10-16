const P = require('./pipelines');
const { normalizeCurrency } = require('./workspaceCurrency');
function invalid(message, status = 400) { return Object.assign(new Error(message), { status }); }
function text(value, max, name, required = false) {
  if (typeof value !== 'string' || value.trim().length > max || (required && !value.trim())) throw invalid(`Invalid ${name}.`);
  return value.trim();
}
function optionalId(value) {
  if (value === '' || value == null) return null;
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw invalid('Invalid record ID.');
  return id;
}
function validDate(value) {
  if (!value) return null;
  if (value instanceof Date && Number.isFinite(value.getTime())) value = `${value.getFullYear()}-${String(value.getMonth()+1).padStart(2,'0')}-${String(value.getDate()).padStart(2,'0')}`;
  if (typeof value !== 'string') throw invalid('Invalid date.');
  const date = value.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) throw invalid('Invalid date.');
  return date;
}
function normalizeDeal(input, previous = {}) {
  const d = { ...previous, ...input };
  const status = d.status || 'open';
  if (!['open', 'won', 'lost'].includes(status)) throw invalid('Invalid deal status.');
  const value = d.value === '' || d.value == null ? null : Number(d.value);
  if (value !== null && (!Number.isFinite(value) || value < 0 || value > 999999999999)) throw invalid('Enter a valid deal value.');
  const quantity = Number(d.quantity ?? 1);
  if (!Number.isFinite(quantity) || quantity <= 0) throw invalid('Quantity must be greater than zero.');
  const probability=Number(d.probability??0);
  if(!Number.isFinite(probability)||probability<0||probability>100||Math.abs(probability*100-Math.round(probability*100))>.0001)throw invalid('Probability must be between 0 and 100, with up to two decimal places.');
  const currency = normalizeCurrency(d.currency || 'USD');
  if (!currency) throw invalid('Choose a supported currency.');
  const reason = status === 'lost' ? text(d.lost_reason || '', 1000, 'loss reason', previous.status !== 'lost' || Object.hasOwn(input,'lost_reason')) : null;
  return {
    title: text(d.title, 300, 'deal title', true),
    contact_id: optionalId(d.contact_id), company_id: optionalId(d.company_id), company_unit_id:optionalId(d.company_unit_id),
    pipeline_id: optionalId(d.pipeline_id), product_id: optionalId(d.product_id), stage_id: optionalId(d.stage_id), assigned_to: optionalId(d.assigned_to),
    probability, value, currency, quantity, expected_close_date: validDate(d.expected_close_date),
    notes: text(d.notes || '', 20000, 'notes'), status, lost_reason: reason,
  };
}
async function checkLinks(client, workspaceId, deal) {
  for (const [field, table] of Object.entries({ contact_id: 'contacts', company_id: 'companies', product_id: 'products', stage_id: 'pipeline_stages', assigned_to: 'users' })) {
    if (deal[field] == null) continue;
    if(field==='assigned_to'){if(!await require('./spaces').canLinkUser(client,deal[field],workspaceId))throw invalid('Owner is not available in this workspace.');continue;}
    const result = await client.query(`SELECT id FROM ${table} WHERE id=$1 AND workspace_id=$2`, [deal[field], workspaceId]);
    if (!result.rows.length) throw invalid('A linked record is not available in this workspace.');
  }
}
async function saveDeal(pool, user, id, input) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const firstPipeline = await P.ensure(client, user.workspace_id);
    let previous = {};
    if (id) {
      previous = (await client.query('SELECT * FROM deals WHERE id=$1 AND workspace_id=$2 FOR UPDATE', [optionalId(id), user.workspace_id])).rows[0];
      if (!previous || previous.deleted_at) throw invalid('Deal not found.', 404);
    } else {
      previous.currency = (await client.query('SELECT default_currency FROM workspaces WHERE id=$1', [user.workspace_id])).rows[0]?.default_currency;
    }
    const deal = normalizeDeal(input, previous);
    // Legacy clients may supply a stage without a pipeline. Infer it only for new deals.
    if (!deal.pipeline_id && deal.stage_id) deal.pipeline_id = (await client.query('SELECT pipeline_id FROM pipeline_stages WHERE id=$1 AND workspace_id=$2',[deal.stage_id,user.workspace_id])).rows[0]?.pipeline_id;
    deal.pipeline_id = deal.pipeline_id || firstPipeline.id;
    await P.selected(client,user.workspace_id,deal.pipeline_id);
    if (id && deal.pipeline_id !== previous.pipeline_id && !Object.hasOwn(input,'stage_id')) deal.stage_id = null;
    await checkLinks(client, user.workspace_id, deal);
    await require("./commercial").validateUnit(client,user.workspace_id,deal.company_unit_id,deal.company_id);
    if (deal.stage_id && !(await client.query('SELECT id FROM pipeline_stages WHERE id=$1 AND pipeline_id=$2 AND workspace_id=$3',[deal.stage_id,deal.pipeline_id,user.workspace_id])).rows.length) throw invalid('Choose a stage from this pipeline.');
    const fields = Object.keys(deal);
    const values = Object.values(deal);
    let result;
    const pipelineChanged = previous.pipeline_id !== deal.pipeline_id;
    const stageChanged = pipelineChanged || (previous.stage_id ?? null) !== deal.stage_id;
    const statusChanged = previous.status !== deal.status;
    if (id) {
      values.push(id, user.workspace_id);
      result = await client.query(`UPDATE deals SET ${fields.map((field, i) => `${field}=$${i + 1}`).join(', ')},
        stage_entered_at=${stageChanged ? 'now()' : 'stage_entered_at'},
        closed_at=${deal.status === 'open' ? 'NULL' : statusChanged ? 'now()' : 'closed_at'}, updated_at=now()
        WHERE id=$${values.length - 1} AND workspace_id=$${values.length} RETURNING *`, values);
    } else {
      values.push(user.workspace_id);
      result = await client.query(`INSERT INTO deals (${fields.join(', ')}, workspace_id, closed_at)
        VALUES (${values.map((_, i) => `$${i + 1}`).join(', ')}, ${deal.status === 'open' ? 'NULL' : 'now()'}) RETURNING *`, values);
    }
    const saved = result.rows[0];
    if (!id || stageChanged || statusChanged) {
      const pipelines = (await client.query('SELECT id,name FROM sales_pipelines WHERE workspace_id=$1',[user.workspace_id])).rows;
      const pipelineName = pipelineId => pipelines.find(p=>p.id===pipelineId)?.name || null;
      const stages = (await client.query('SELECT id, name FROM pipeline_stages WHERE workspace_id=$1', [user.workspace_id])).rows;
      const stageName = stageId => stages.find(stage => stage.id === stageId)?.name || null;
      await client.query(`INSERT INTO deal_events (workspace_id, deal_id, user_id, event_type, from_stage, to_stage, from_status, to_status, reason, from_pipeline, to_pipeline)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [user.workspace_id, saved.id, user.id, id ? 'changed' : 'created', stageName(previous.stage_id), stageName(deal.stage_id), previous.status || null, deal.status, deal.lost_reason, pipelineName(previous.pipeline_id), pipelineName(deal.pipeline_id)]);
    }
    await require('./commercial').syncDeal(client,user,saved);
    await client.query('COMMIT');
    return saved;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}
module.exports = { invalid, text, optionalId, validDate, normalizeDeal, saveDeal };
