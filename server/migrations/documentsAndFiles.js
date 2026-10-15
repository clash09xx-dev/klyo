module.exports = async (pool) => {
  await pool.query(`
 ALTER TABLE products ADD COLUMN IF NOT EXISTS sku TEXT NOT NULL DEFAULT '';
 CREATE UNIQUE INDEX IF NOT EXISTS idx_product_sku ON products(workspace_id,lower(sku)) WHERE sku<>'';
 CREATE TABLE IF NOT EXISTS price_lists(id SERIAL PRIMARY KEY,workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,name TEXT NOT NULL,currency TEXT NOT NULL,source_name TEXT NOT NULL DEFAULT '',updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
 CREATE UNIQUE INDEX IF NOT EXISTS idx_price_list_name ON price_lists(workspace_id,lower(name));
 CREATE TABLE IF NOT EXISTS price_list_items(price_list_id INTEGER NOT NULL REFERENCES price_lists(id) ON DELETE CASCADE,product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,unit_price NUMERIC(12,2) NOT NULL CHECK(unit_price>=0),PRIMARY KEY(price_list_id,product_id));
 ALTER TABLE quotes ADD COLUMN IF NOT EXISTS price_list_id INTEGER REFERENCES price_lists(id) ON DELETE SET NULL;
 CREATE TABLE IF NOT EXISTS sharepoint_connections(workspace_id INTEGER PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,connected_by INTEGER REFERENCES users(id) ON DELETE SET NULL,account_id TEXT NOT NULL,account_name TEXT NOT NULL,token_cache TEXT NOT NULL,site_id TEXT,site_name TEXT,drive_id TEXT,drive_name TEXT,root_id TEXT,root_name TEXT,generation TEXT NOT NULL,connected_at TIMESTAMPTZ NOT NULL DEFAULT now());
 CREATE TABLE IF NOT EXISTS sharepoint_oauth_states(id TEXT PRIMARY KEY,workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,account_workspace_id INTEGER NOT NULL,verifier TEXT NOT NULL,expires_at TIMESTAMPTZ NOT NULL);
 CREATE TABLE IF NOT EXISTS workspace_files(id SERIAL PRIMARY KEY,workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,drive_id TEXT NOT NULL,item_id TEXT NOT NULL,name TEXT NOT NULL,size BIGINT NOT NULL,mime_type TEXT NOT NULL DEFAULT '',web_url TEXT NOT NULL DEFAULT '',entity TEXT,entity_id INTEGER,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),UNIQUE(workspace_id,drive_id,item_id));
 CREATE INDEX IF NOT EXISTS idx_workspace_files_record ON workspace_files(workspace_id,entity,entity_id);
 CREATE TABLE IF NOT EXISTS sharepoint_uploads(id TEXT PRIMARY KEY,workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,generation TEXT NOT NULL,upload_url TEXT NOT NULL,total_bytes BIGINT NOT NULL,uploaded_bytes BIGINT NOT NULL DEFAULT 0,name TEXT NOT NULL,parent_id TEXT NOT NULL,entity TEXT,entity_id INTEGER,expires_at TIMESTAMPTZ NOT NULL,completed_file_id INTEGER REFERENCES workspace_files(id) ON DELETE SET NULL);
 `);
};
