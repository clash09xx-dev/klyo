module.exports=async(db)=>{
 await db.query(`CREATE TABLE IF NOT EXISTS contact_card_scans(
 id BIGSERIAL PRIMARY KEY,
 workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 request_id UUID NOT NULL,
 image_hash TEXT NOT NULL,
 state TEXT NOT NULL DEFAULT 'pending',
 contact_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(workspace_id,user_id,request_id));
 CREATE INDEX IF NOT EXISTS contact_card_scans_rate ON contact_card_scans(user_id,created_at);
 CREATE INDEX IF NOT EXISTS contact_card_scans_image ON contact_card_scans(workspace_id,image_hash);`);
};
