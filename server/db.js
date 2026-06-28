// server/db.js
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
}

module.exports = { pool, query, init };
