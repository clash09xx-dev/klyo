module.exports = async (pool) => {
  await pool.query(`
ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS location TEXT NOT NULL DEFAULT '';
ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS time_zone TEXT NOT NULL DEFAULT 'UTC';
ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS start_date DATE;
ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS end_date DATE;
CREATE TABLE IF NOT EXISTS calendar_connections(id SERIAL PRIMARY KEY,workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,provider TEXT NOT NULL CHECK(provider IN('google','microsoft')),credentials TEXT NOT NULL,account_id TEXT NOT NULL,account_name TEXT NOT NULL,calendar_id TEXT,calendar_name TEXT,can_write BOOLEAN NOT NULL DEFAULT false,generation TEXT NOT NULL,last_read_at TIMESTAMPTZ,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),UNIQUE(workspace_id,user_id,provider));
CREATE TABLE IF NOT EXISTS calendar_oauth_states(id TEXT PRIMARY KEY,workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,account_workspace_id INTEGER NOT NULL,provider TEXT NOT NULL,verifier TEXT NOT NULL,expires_at TIMESTAMPTZ NOT NULL);
CREATE TABLE IF NOT EXISTS calendar_event_links(id SERIAL PRIMARY KEY,workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,connection_id INTEGER NOT NULL REFERENCES calendar_connections(id) ON DELETE CASCADE,event_id INTEGER REFERENCES calendar_events(id) ON DELETE SET NULL,account_id TEXT NOT NULL,calendar_id TEXT NOT NULL,external_id TEXT,operation_id TEXT NOT NULL,kind TEXT NOT NULL CHECK(kind IN('published','copied')),status TEXT NOT NULL DEFAULT 'pending',etag TEXT,local_hash TEXT,reserved_hash TEXT,request_payload JSONB,web_url TEXT NOT NULL DEFAULT '',synced_at TIMESTAMPTZ,UNIQUE(connection_id,calendar_id,account_id,external_id));
CREATE UNIQUE INDEX IF NOT EXISTS idx_calendar_link_local ON calendar_event_links(connection_id,calendar_id,account_id,event_id) WHERE event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_calendar_connection_owner ON calendar_connections(workspace_id,user_id);
`);
};
