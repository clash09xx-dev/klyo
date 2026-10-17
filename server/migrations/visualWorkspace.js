module.exports = async (pool) => {
  await pool.query(`
ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_phone TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_version INTEGER NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS mfa_challenges(token_hash TEXT PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,purpose TEXT NOT NULL,phone TEXT NOT NULL,provider_sid TEXT,version INTEGER NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,sent_at TIMESTAMPTZ,expires_at TIMESTAMPTZ NOT NULL,consumed_at TIMESTAMPTZ,created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS idx_mfa_challenge_user ON mfa_challenges(user_id,created_at);
CREATE TABLE IF NOT EXISTS mfa_recovery_codes(user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,code_hash TEXT NOT NULL,used_at TIMESTAMPTZ,PRIMARY KEY(user_id,code_hash));
CREATE TABLE IF NOT EXISTS auth_rate_limits(key TEXT PRIMARY KEY,hits INTEGER NOT NULL,expires_at TIMESTAMPTZ NOT NULL);
ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS pricing_groups JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE quote_line_items ADD COLUMN IF NOT EXISTS show_component_price BOOLEAN NOT NULL DEFAULT false;
`);
};
