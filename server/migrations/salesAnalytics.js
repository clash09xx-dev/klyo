module.exports = async (pool) =>
  pool.query(`
 ALTER TABLE deals ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
 ALTER TABLE deals ADD COLUMN IF NOT EXISTS probability NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK(probability>=0 AND probability<=100);
 CREATE TABLE IF NOT EXISTS sales_targets(id SERIAL PRIMARY KEY,workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,month DATE NOT NULL,currency TEXT NOT NULL,amount NUMERIC(16,2) NOT NULL CHECK(amount>=0),updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),CHECK(EXTRACT(DAY FROM month)=1));
 CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_targets_scope ON sales_targets(workspace_id,COALESCE(user_id,0),month,currency);
 CREATE INDEX IF NOT EXISTS idx_deals_report_closed ON deals(workspace_id,currency,closed_at);
 CREATE INDEX IF NOT EXISTS idx_deals_report_expected ON deals(workspace_id,currency,expected_close_date) WHERE status='open';
`);
