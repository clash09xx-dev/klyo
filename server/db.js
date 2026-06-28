// server/db.js
const crypto = require("crypto");
// ---------------------------------------------------------
// Postgres connection + schema. Klyo is multi-tenant: every
// business that signs up gets its own "workspace" row, and every
// user/contact/offer/activity entry belongs to exactly one
// workspace. Every query in the route files filters by
// workspace_id so one customer's data can never leak into
// another's.
//
// Set DATABASE_URL in your .env (Railway's Postgres add-on gives
// you this automatically as ${{Postgres.DATABASE_URL}}).
// ---------------------------------------------------------
const { Pool } = require("pg");

if (!process.env.DATABASE_URL) {
  console.error(
    "\n[Klyo] Missing DATABASE_URL in your .env file. Add a Postgres connection string before starting.\n"
  );
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSL === "false" ? false : { rejectUnauthorized: false },
});

// Small helper so route files can do `await db.query(sql, params)`
// instead of importing the pool directly everywhere.
function query(text, params) {
  return pool.query(text, params);
}

async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS workspaces (
      id                     SERIAL PRIMARY KEY,
      name                   TEXT NOT NULL,
      invite_code            TEXT NOT NULL UNIQUE,
      plan                   TEXT NOT NULL DEFAULT 'trial',
      tier                   TEXT NOT NULL DEFAULT 'personal',
      is_comped              BOOLEAN NOT NULL DEFAULT FALSE,
      trial_ends_at          TIMESTAMPTZ,
      stripe_customer_id     TEXT,
      stripe_subscription_id TEXT,
      created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS users (
      id                  SERIAL PRIMARY KEY,
      workspace_id        INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      name                TEXT NOT NULL,
      email               TEXT NOT NULL UNIQUE,
      password_hash       TEXT NOT NULL,
      role                TEXT NOT NULL DEFAULT 'member',
      theme               TEXT NOT NULL DEFAULT 'signal',
      has_seen_onboarding BOOLEAN NOT NULL DEFAULT FALSE,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS contacts (
      id              SERIAL PRIMARY KEY,
      workspace_id    INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      full_name       TEXT NOT NULL,
      email           TEXT,
      phone           TEXT,
      company         TEXT,
      marketing_theme TEXT,
      status          TEXT NOT NULL DEFAULT 'lead',
      notes           TEXT,
      owner_id        INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS offers (
      id           SERIAL PRIMARY KEY,
      workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      contact_id   INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
      created_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
      subject      TEXT NOT NULL DEFAULT '',
      body         TEXT NOT NULL DEFAULT '',
      ai_generated BOOLEAN NOT NULL DEFAULT FALSE,
      status       TEXT NOT NULL DEFAULT 'draft',
      sent_at      TIMESTAMPTZ,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS activity_log (
      id           SERIAL PRIMARY KEY,
      workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      contact_id   INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
      user_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
      type         TEXT NOT NULL,
      description  TEXT NOT NULL,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS companies (
      id           SERIAL PRIMARY KEY,
      workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      name         TEXT NOT NULL,
      industry     TEXT,
      notes        TEXT,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS products (
      id                      SERIAL PRIMARY KEY,
      workspace_id            INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      name                    TEXT NOT NULL,
      description             TEXT,
      unit_price              NUMERIC(12,2) NOT NULL DEFAULT 0,
      unit_label              TEXT NOT NULL DEFAULT 'unit',
      service_interval_months INTEGER,
      created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS quotes (
      id             SERIAL PRIMARY KEY,
      workspace_id   INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      contact_id     INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
      company_id     INTEGER REFERENCES companies(id) ON DELETE SET NULL,
      created_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
      title          TEXT NOT NULL DEFAULT '',
      intro_message  TEXT,
      status         TEXT NOT NULL DEFAULT 'draft',
      currency       TEXT NOT NULL DEFAULT 'USD',
      subtotal       NUMERIC(12,2) NOT NULL DEFAULT 0,
      discount_total NUMERIC(12,2) NOT NULL DEFAULT 0,
      total          NUMERIC(12,2) NOT NULL DEFAULT 0,
      sent_at        TIMESTAMPTZ,
      accepted_at    TIMESTAMPTZ,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS quote_line_items (
      id               SERIAL PRIMARY KEY,
      quote_id         INTEGER NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
      product_id       INTEGER REFERENCES products(id) ON DELETE SET NULL,
      description      TEXT NOT NULL,
      quantity         NUMERIC(12,2) NOT NULL DEFAULT 1,
      unit_price       NUMERIC(12,2) NOT NULL DEFAULT 0,
      discount_percent NUMERIC(5,2) NOT NULL DEFAULT 0,
      line_total       NUMERIC(12,2) NOT NULL DEFAULT 0,
      sort_order       INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS quote_recipients (
      id         SERIAL PRIMARY KEY,
      quote_id   INTEGER NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
      contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS customer_discounts (
      id               SERIAL PRIMARY KEY,
      workspace_id     INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      contact_id       INTEGER REFERENCES contacts(id) ON DELETE CASCADE,
      company_id       INTEGER REFERENCES companies(id) ON DELETE CASCADE,
      product_id       INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      discount_percent NUMERIC(5,2) NOT NULL DEFAULT 0,
      notes            TEXT,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT discount_has_a_target CHECK (contact_id IS NOT NULL OR company_id IS NOT NULL)
    );

    CREATE TABLE IF NOT EXISTS purchases (
      id                  SERIAL PRIMARY KEY,
      workspace_id        INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      contact_id          INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
      product_id          INTEGER REFERENCES products(id) ON DELETE SET NULL,
      quote_id            INTEGER REFERENCES quotes(id) ON DELETE SET NULL,
      description         TEXT NOT NULL,
      quantity            NUMERIC(12,2) NOT NULL DEFAULT 1,
      purchased_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
      next_service_due_at TIMESTAMPTZ,
      reminder_sent_at    TIMESTAMPTZ
    );

    CREATE INDEX IF NOT EXISTS idx_users_workspace ON users(workspace_id);
    CREATE INDEX IF NOT EXISTS idx_contacts_workspace ON contacts(workspace_id);
    CREATE INDEX IF NOT EXISTS idx_contacts_owner ON contacts(owner_id);
    CREATE INDEX IF NOT EXISTS idx_contacts_status ON contacts(workspace_id, status);
    CREATE INDEX IF NOT EXISTS idx_offers_workspace ON offers(workspace_id);
    CREATE INDEX IF NOT EXISTS idx_offers_contact ON offers(contact_id);
    CREATE INDEX IF NOT EXISTS idx_activity_workspace ON activity_log(workspace_id);
    CREATE INDEX IF NOT EXISTS idx_activity_contact ON activity_log(contact_id);
    CREATE INDEX IF NOT EXISTS idx_companies_workspace ON companies(workspace_id);
    CREATE INDEX IF NOT EXISTS idx_products_workspace ON products(workspace_id);
    CREATE INDEX IF NOT EXISTS idx_quotes_workspace ON quotes(workspace_id);
    CREATE INDEX IF NOT EXISTS idx_quotes_contact ON quotes(contact_id);
    CREATE INDEX IF NOT EXISTS idx_quote_items_quote ON quote_line_items(quote_id);
    CREATE INDEX IF NOT EXISTS idx_quote_recipients_quote ON quote_recipients(quote_id);
    CREATE INDEX IF NOT EXISTS idx_discounts_workspace ON customer_discounts(workspace_id);
    CREATE INDEX IF NOT EXISTS idx_purchases_workspace ON purchases(workspace_id);
    CREATE INDEX IF NOT EXISTS idx_purchases_due ON purchases(next_service_due_at);

    CREATE TABLE IF NOT EXISTS page_views (
      id         SERIAL PRIMARY KEY,
      path       TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_page_views_created ON page_views(created_at);
  `);

  // Safe to re-run: only adds columns that don't already exist yet, so
  // this covers both fresh installs and upgrading an existing database.
  await pool.query(`
    ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS tier TEXT NOT NULL DEFAULT 'personal';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS theme TEXT NOT NULL DEFAULT 'signal';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS has_seen_onboarding BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS gmail_email TEXT;
    ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS gmail_refresh_token TEXT;
    ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS gmail_connected_at TIMESTAMPTZ;
    ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS current_period_end TIMESTAMPTZ;
    ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS billing_mode TEXT;
    ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS comped_until TIMESTAMPTZ;
    ALTER TABLE contacts ADD COLUMN IF NOT EXISTS company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL;
    ALTER TABLE contacts ADD COLUMN IF NOT EXISTS title TEXT;
    ALTER TABLE contacts ADD COLUMN IF NOT EXISTS is_decision_maker BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS google_id TEXT UNIQUE;
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_contacts_company ON contacts(company_id);
  `);

  // Split full_name into first_name + last_name (safe to re-run)
  await pool.query(`
    ALTER TABLE contacts ADD COLUMN IF NOT EXISTS first_name TEXT;
    ALTER TABLE contacts ADD COLUMN IF NOT EXISTS last_name  TEXT;
  `);
  await pool.query(`
    UPDATE contacts
    SET
      first_name = CASE WHEN position(' ' IN full_name) > 0
                        THEN trim(split_part(full_name, ' ', 1))
                        ELSE trim(full_name) END,
      last_name  = CASE WHEN position(' ' IN full_name) > 0
                        THEN trim(substring(full_name FROM position(' ' IN full_name) + 1))
                        ELSE NULL END
    WHERE first_name IS NULL;
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_contacts_last_name ON contacts(workspace_id, last_name);
  `);

  // Workspace-level default currency
  await pool.query(`
    ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS default_currency TEXT NOT NULL DEFAULT 'USD';
  `);

  // Sales Opportunities (Deals) — pipeline stages + deal records
  await pool.query(`
    CREATE TABLE IF NOT EXISTS pipeline_stages (
      id           SERIAL PRIMARY KEY,
      workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      name         TEXT NOT NULL,
      color        TEXT NOT NULL DEFAULT '#6b7280',
      sort_order   INTEGER NOT NULL DEFAULT 0,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_pipeline_stages_workspace ON pipeline_stages(workspace_id, sort_order);

    CREATE TABLE IF NOT EXISTS deals (
      id                   SERIAL PRIMARY KEY,
      workspace_id         INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      title                TEXT NOT NULL,
      contact_id           INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
      company_id           INTEGER REFERENCES companies(id) ON DELETE SET NULL,
      product_id           INTEGER REFERENCES products(id) ON DELETE SET NULL,
      stage_id             INTEGER REFERENCES pipeline_stages(id) ON DELETE SET NULL,
      assigned_to          INTEGER REFERENCES users(id) ON DELETE SET NULL,
      value                NUMERIC(14,2),
      currency             TEXT NOT NULL DEFAULT 'USD',
      quantity             NUMERIC(12,2) NOT NULL DEFAULT 1,
      expected_close_date  DATE,
      notes                TEXT,
      status               TEXT NOT NULL DEFAULT 'open',
      created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_deals_workspace ON deals(workspace_id);
    CREATE INDEX IF NOT EXISTS idx_deals_stage ON deals(stage_id);
    CREATE INDEX IF NOT EXISTS idx_deals_contact ON deals(contact_id);
  `);

  // AI context field for workspace
  await pool.query(`ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS ai_context TEXT;`);

  // Products: category field
  await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS category TEXT;`);

  // Quotes: public shareable token for print/PDF view
  await pool.query(`ALTER TABLE quotes ADD COLUMN IF NOT EXISTS public_token TEXT UNIQUE;`);
  // Backfill existing quotes — generate tokens in Node.js to avoid requiring pgcrypto
  const unfilled = await pool.query(`SELECT id FROM quotes WHERE public_token IS NULL`);
  for (const row of unfilled.rows) {
    const token = crypto.randomBytes(18).toString("hex");
    await pool.query(`UPDATE quotes SET public_token = $1 WHERE id = $2`, [token, row.id]);
  }

  // Task assignment
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tasks (
      id           SERIAL PRIMARY KEY,
      workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      title        TEXT NOT NULL,
      description  TEXT,
      assigned_to  INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
      contact_id   INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
      company_id   INTEGER REFERENCES companies(id) ON DELETE SET NULL,
      deal_id      INTEGER REFERENCES deals(id) ON DELETE SET NULL,
      due_date     DATE,
      priority     TEXT NOT NULL DEFAULT 'medium',
      status       TEXT NOT NULL DEFAULT 'todo',
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_tasks_workspace   ON tasks(workspace_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_assigned_to ON tasks(assigned_to);
    CREATE INDEX IF NOT EXISTS idx_tasks_due_date    ON tasks(workspace_id, due_date);
  `);

  // Seed default pipeline stages for any workspace that has none
  await pool.query(
    `INSERT INTO pipeline_stages (workspace_id, name, color, sort_order)
     SELECT w.id, s.name, s.color, s.sort_order
     FROM workspaces w
     CROSS JOIN (VALUES
       ('Awareness',   '#6366f1', 0),
       ('Contacted',   '#3b82f6', 1),
       ('Offered',     '#f59e0b', 2),
       ('Followed Up', '#f97316', 3),
       ('Awaiting PO', '#10b981', 4)
     ) AS s(name, color, sort_order)
     WHERE NOT EXISTS (
       SELECT 1 FROM pipeline_stages p WHERE p.workspace_id = w.id
     )`
  );
}

module.exports = { pool, query, init };
