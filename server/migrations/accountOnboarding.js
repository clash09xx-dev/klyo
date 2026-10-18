module.exports = async (pool) => {
  await pool.query(`
    ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS onboarding_payment_required BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS trial_used BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS checkout_session_id TEXT;
    ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS checkout_tier TEXT;
    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL,
      consumed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS password_reset_user ON password_reset_tokens(user_id);
  `);
};
