// Additive migration: existing deal amounts, stages and customer data are preserved.
module.exports = async function migrateSalesWorkspace(pool) {
  await pool.query(`
    ALTER TABLE deals ADD COLUMN IF NOT EXISTS stage_entered_at TIMESTAMPTZ;
    ALTER TABLE deals ALTER COLUMN stage_entered_at SET DEFAULT now();
    ALTER TABLE deals ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;
    ALTER TABLE deals ADD COLUMN IF NOT EXISTS lost_reason TEXT;
    CREATE TABLE IF NOT EXISTS deal_events (
      id SERIAL PRIMARY KEY,
      workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      deal_id INTEGER NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      event_type TEXT NOT NULL,
      from_stage TEXT, to_stage TEXT, from_status TEXT, to_status TEXT, reason TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_deal_events_history ON deal_events(workspace_id, deal_id, created_at);
    CREATE TABLE IF NOT EXISTS saved_deal_views (
      id SERIAL PRIMARY KEY,
      workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      filters JSONB NOT NULL DEFAULT '{}',
      UNIQUE(workspace_id, user_id, name)
    );
    CREATE TABLE IF NOT EXISTS email_templates (
      id SERIAL PRIMARY KEY,
      workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      name TEXT NOT NULL, subject TEXT NOT NULL, body TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_email_templates_workspace ON email_templates(workspace_id);
  `);
};
