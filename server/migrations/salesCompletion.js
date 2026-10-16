module.exports = async (pool) => {
  await pool.query(`
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS auto_project_on_win BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE communication_connections ADD COLUMN IF NOT EXISTS mailbox TEXT NOT NULL DEFAULT '';
ALTER TABLE communication_connections DROP CONSTRAINT IF EXISTS communication_connections_workspace_id_user_id_provider_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_comm_mailbox_unique ON communication_connections(workspace_id,user_id,provider,mailbox);
ALTER TABLE deals ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT '';
ALTER TABLE projects ADD COLUMN IF NOT EXISTS auto_created BOOLEAN NOT NULL DEFAULT false;
CREATE UNIQUE INDEX IF NOT EXISTS idx_project_auto_deal ON projects(workspace_id,deal_id) WHERE auto_created AND deal_id IS NOT NULL;
ALTER TABLE project_resources ADD COLUMN IF NOT EXISTS hourly_cost NUMERIC(14,2);
ALTER TABLE project_time_entries ADD COLUMN IF NOT EXISTS hourly_cost NUMERIC(14,2);
CREATE TABLE IF NOT EXISTS project_expenses(id SERIAL PRIMARY KEY,workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,description TEXT NOT NULL,amount NUMERIC(14,2) NOT NULL CHECK(amount>=0),currency TEXT NOT NULL,spent_on DATE NOT NULL,created_by INTEGER REFERENCES users(id),created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS idx_project_expense_scope ON project_expenses(workspace_id,project_id);
CREATE TABLE IF NOT EXISTS analytics_benchmarks(workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,month DATE NOT NULL,currency TEXT NOT NULL,pipeline_goal NUMERIC(14,2),meeting_goal INTEGER,win_rate_goal NUMERIC(5,2),stale_days INTEGER NOT NULL DEFAULT 14,updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE UNIQUE INDEX IF NOT EXISTS idx_analytics_benchmark ON analytics_benchmarks(workspace_id,COALESCE(user_id,0),month,currency);
CREATE TABLE IF NOT EXISTS tracking_connections(workspace_id INTEGER PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,api_key TEXT NOT NULL,updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS tracking_snapshot JSONB;
ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS tracking_checked_at TIMESTAMPTZ;
CREATE OR REPLACE FUNCTION klyo_project_on_win() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
 IF current_setting('klyo.skip_auto_project',true)='on' THEN RETURN NEW; END IF;
 IF NEW.status<>'won' OR NEW.deleted_at IS NOT NULL THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' THEN IF OLD.status='won' THEN RETURN NEW; END IF; END IF;
 PERFORM id FROM workspaces WHERE id=NEW.workspace_id FOR UPDATE;
 IF (SELECT auto_project_on_win FROM workspaces WHERE id=NEW.workspace_id) AND NOT EXISTS(SELECT 1 FROM projects WHERE workspace_id=NEW.workspace_id AND deal_id=NEW.id) THEN
 INSERT INTO projects(workspace_id,title,kind,status,deal_id,company_id,contact_id,assigned_to,starts_on,budget,currency,auto_created)
 VALUES(NEW.workspace_id,NEW.title,'delivery','planned',NEW.id,NEW.company_id,NEW.contact_id,NEW.assigned_to,CURRENT_DATE,COALESCE(NEW.value,0),NEW.currency,true) ON CONFLICT DO NOTHING;
 END IF;
 RETURN NEW;
END $fn$;
DROP TRIGGER IF EXISTS klyo_project_on_win_trigger ON deals;
CREATE TRIGGER klyo_project_on_win_trigger AFTER INSERT OR UPDATE OF status ON deals FOR EACH ROW EXECUTE FUNCTION klyo_project_on_win();
`);
};
