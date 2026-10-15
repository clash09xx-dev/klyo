// Additive: keep existing stages, deal values and links intact.
module.exports = async (pool) => {
  await pool.query(`
    ALTER TABLE companies ADD COLUMN IF NOT EXISTS parent_company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_company_parent ON companies(workspace_id,parent_company_id);
    CREATE TABLE IF NOT EXISTS sales_pipelines (
      id SERIAL PRIMARY KEY,
      workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
      is_default BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_pipeline_name ON sales_pipelines(workspace_id,lower(name));
    CREATE UNIQUE INDEX IF NOT EXISTS idx_pipeline_default ON sales_pipelines(workspace_id) WHERE is_default;
    ALTER TABLE pipeline_stages ADD COLUMN IF NOT EXISTS pipeline_id INTEGER REFERENCES sales_pipelines(id) ON DELETE NO ACTION;
    ALTER TABLE deals ADD COLUMN IF NOT EXISTS pipeline_id INTEGER REFERENCES sales_pipelines(id) ON DELETE NO ACTION;
    ALTER TABLE deal_events ADD COLUMN IF NOT EXISTS from_pipeline TEXT, ADD COLUMN IF NOT EXISTS to_pipeline TEXT;
    INSERT INTO sales_pipelines(workspace_id,name,is_default)
      SELECT id,'Sales',true FROM workspaces w WHERE NOT EXISTS(SELECT 1 FROM sales_pipelines p WHERE p.workspace_id=w.id AND p.is_default);
    UPDATE pipeline_stages s SET pipeline_id=p.id FROM sales_pipelines p WHERE p.workspace_id=s.workspace_id AND p.is_default AND s.pipeline_id IS NULL;
    UPDATE deals d SET pipeline_id=p.id FROM sales_pipelines p WHERE p.workspace_id=d.workspace_id AND p.is_default AND d.pipeline_id IS NULL;
    CREATE INDEX IF NOT EXISTS idx_deals_pipeline ON deals(workspace_id,pipeline_id);
    CREATE INDEX IF NOT EXISTS idx_stages_pipeline ON pipeline_stages(workspace_id,pipeline_id,sort_order);
  `);
};
