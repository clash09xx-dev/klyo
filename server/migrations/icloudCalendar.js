module.exports = async (pool) => {
  await pool.query(`
ALTER TABLE calendar_connections DROP CONSTRAINT IF EXISTS calendar_connections_provider_check;
ALTER TABLE calendar_connections ADD CONSTRAINT calendar_connections_provider_check CHECK(provider IN('google','microsoft','icloud'));
ALTER TABLE calendar_connections ADD COLUMN IF NOT EXISTS auto_sync BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE calendar_connections ADD COLUMN IF NOT EXISTS last_sync_at TIMESTAMPTZ;
ALTER TABLE calendar_connections ADD COLUMN IF NOT EXISTS sync_error TEXT;
ALTER TABLE calendar_event_links ADD COLUMN IF NOT EXISTS sync_error TEXT;
CREATE INDEX IF NOT EXISTS idx_calendar_auto_sync ON calendar_connections(last_sync_at) WHERE auto_sync=true AND provider='icloud';
`);
};
