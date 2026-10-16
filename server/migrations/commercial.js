// Commercial data remains scoped to the active Team or Personal workspace.
module.exports = async (pool) => {
  await pool.query(`
 ALTER TABLE companies ADD COLUMN IF NOT EXISTS custom_fields JSONB NOT NULL DEFAULT '{}', ADD COLUMN IF NOT EXISTS tax_id TEXT NOT NULL DEFAULT '', ADD COLUMN IF NOT EXISTS registration_number TEXT NOT NULL DEFAULT '', ADD COLUMN IF NOT EXISTS website TEXT NOT NULL DEFAULT '', ADD COLUMN IF NOT EXISTS address TEXT NOT NULL DEFAULT '', ADD COLUMN IF NOT EXISTS postal_code TEXT NOT NULL DEFAULT '', ADD COLUMN IF NOT EXISTS city TEXT NOT NULL DEFAULT '', ADD COLUMN IF NOT EXISTS country TEXT NOT NULL DEFAULT '', ADD COLUMN IF NOT EXISTS phone TEXT NOT NULL DEFAULT '', ADD COLUMN IF NOT EXISTS email TEXT NOT NULL DEFAULT '';
 ALTER TABLE custom_field_definitions DROP CONSTRAINT IF EXISTS custom_field_definitions_entity_check;
 ALTER TABLE custom_field_definitions ADD CONSTRAINT custom_field_definitions_entity_check CHECK(entity IN ('contact','product','company'));
 CREATE TABLE IF NOT EXISTS company_units(id SERIAL PRIMARY KEY,workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,parent_id INTEGER REFERENCES company_units(id) ON DELETE SET NULL,kind TEXT NOT NULL CHECK(kind IN('branch','department')),name TEXT NOT NULL,address TEXT NOT NULL DEFAULT '',notes TEXT NOT NULL DEFAULT '',created_at TIMESTAMPTZ NOT NULL DEFAULT now());
 CREATE INDEX IF NOT EXISTS company_units_company ON company_units(workspace_id,company_id);
 ALTER TABLE contacts ADD COLUMN IF NOT EXISTS company_unit_id INTEGER REFERENCES company_units(id) ON DELETE SET NULL;
 ALTER TABLE deals ADD COLUMN IF NOT EXISTS company_unit_id INTEGER REFERENCES company_units(id) ON DELETE SET NULL;
 ALTER TABLE quotes ADD COLUMN IF NOT EXISTS company_unit_id INTEGER REFERENCES company_units(id) ON DELETE SET NULL;
 ALTER TABLE products ADD COLUMN IF NOT EXISTS serial_required BOOLEAN NOT NULL DEFAULT false;
 CREATE TABLE IF NOT EXISTS commercial_permissions(workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,can_view_margin BOOLEAN NOT NULL DEFAULT false,margin_factor NUMERIC(6,4) NOT NULL DEFAULT 1 CHECK(margin_factor>=0 AND margin_factor<=10),PRIMARY KEY(workspace_id,user_id));
 CREATE TABLE IF NOT EXISTS product_purchase_prices(workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,currency TEXT NOT NULL,unit_cost NUMERIC(12,2) NOT NULL CHECK(unit_cost>=0),supplier TEXT NOT NULL DEFAULT '',updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),PRIMARY KEY(workspace_id,product_id,currency));
 ALTER TABLE quote_line_items ADD COLUMN IF NOT EXISTS bundle_id TEXT NOT NULL DEFAULT '', ADD COLUMN IF NOT EXISTS bundle_name TEXT NOT NULL DEFAULT '', ADD COLUMN IF NOT EXISTS sku TEXT NOT NULL DEFAULT '';
 CREATE TABLE IF NOT EXISTS quote_item_costs(item_id INTEGER PRIMARY KEY REFERENCES quote_line_items(id) ON DELETE CASCADE,workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,unit_cost NUMERIC(12,2),currency TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS commercial_statuses(id SERIAL PRIMARY KEY,workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,name TEXT NOT NULL,color TEXT NOT NULL DEFAULT '#64748b',outcome TEXT NOT NULL DEFAULT 'open' CHECK(outcome IN('open','won','lost')),paid BOOLEAN NOT NULL DEFAULT false,sort_order INTEGER NOT NULL DEFAULT 0,UNIQUE(workspace_id,name));
 CREATE TABLE IF NOT EXISTS commercial_cases(id SERIAL PRIMARY KEY,workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,number TEXT NOT NULL,title TEXT NOT NULL,deal_id INTEGER REFERENCES deals(id) ON DELETE SET NULL,quote_id INTEGER REFERENCES quotes(id) ON DELETE SET NULL,company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL,contact_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,company_unit_id INTEGER REFERENCES company_units(id) ON DELETE SET NULL,status_id INTEGER REFERENCES commercial_statuses(id) ON DELETE SET NULL,main_products TEXT NOT NULL DEFAULT '',value NUMERIC(14,2) NOT NULL DEFAULT 0,currency TEXT NOT NULL DEFAULT 'USD',valid_until DATE,payment_terms TEXT NOT NULL DEFAULT '',delivery_terms TEXT NOT NULL DEFAULT '',notes TEXT NOT NULL DEFAULT '',created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),UNIQUE(workspace_id,number));
 CREATE UNIQUE INDEX IF NOT EXISTS commercial_case_quote ON commercial_cases(quote_id) WHERE quote_id IS NOT NULL;
 CREATE INDEX IF NOT EXISTS commercial_case_deal ON commercial_cases(workspace_id,deal_id);
 ALTER TABLE quotes ADD COLUMN IF NOT EXISTS deal_id INTEGER REFERENCES deals(id) ON DELETE SET NULL, ADD COLUMN IF NOT EXISTS commercial_case_id INTEGER REFERENCES commercial_cases(id) ON DELETE SET NULL;
 DO $$ BEGIN IF to_regclass('sales_orders') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='sales_orders_case_id_fk' AND conrelid='sales_orders'::regclass) THEN ALTER TABLE sales_orders ADD CONSTRAINT sales_orders_case_id_fk FOREIGN KEY(case_id) REFERENCES commercial_cases(id) ON DELETE SET NULL; END IF; END $$;
 `);
  // Existing offers gain a register and matching opportunity atomically. Already
  // issued documents retain their exact reference, including historical duplicates.
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const legacy = (
      await client.query(
        "SELECT q.* FROM quotes q WHERE NOT EXISTS(SELECT 1 FROM commercial_cases c WHERE c.quote_id=q.id) ORDER BY q.workspace_id,q.id",
      )
    ).rows;
    const S = require("../services/commercial"),
      Q = require("../../public/js/quote-core");
    for (const q of legacy) {
      const wid = q.workspace_id,
        owner = (
          await client.query(
            "SELECT owner_user_id FROM workspaces WHERE id=$1 FOR UPDATE",
            [wid],
          )
        ).rows[0]?.owner_user_id,
        user = { id: q.created_by || owner || null, workspace_id: wid },
        ss = await S.statuses(client, wid),
        status =
          q.status === "accepted"
            ? "won"
            : q.status === "declined"
              ? "lost"
              : "open";
      const net =
          Math.round((Number(q.total) - Number(q.tax_total || 0)) * 100) / 100,
        ref = Q.reference(q);
      let number = ref;
      if (
        (
          await client.query(
            "SELECT id FROM commercial_cases WHERE workspace_id=$1 AND number=$2",
            [wid, number],
          )
        ).rows.length
      )
        number = await S.nextNumber(client, wid);
      const deal = q.deal_id
        ? (
            await client.query(
              "SELECT * FROM deals WHERE id=$1 AND workspace_id=$2 AND deleted_at IS NULL",
              [q.deal_id, wid],
            )
          ).rows[0]
        : null;
      const linked =
        deal || (await S.createDeal(client, user, { ...q, value: net }));
      if (!deal) {
        await client.query(
          "UPDATE deals SET status=$1,created_at=$2,closed_at=$3,lost_reason=$4 WHERE id=$5",
          [
            status,
            q.created_at,
            status === "open" ? null : q.accepted_at || q.updated_at,
            status === "lost" ? "Historical declined offer" : null,
            linked.id,
          ],
        );
        await client.query(
          "UPDATE deal_events SET created_at=$1,to_status=$2 WHERE deal_id=$3 AND workspace_id=$4",
          [q.created_at, status, linked.id, wid],
        );
      }
      const d = q.document || {},
        products = (
          await client.query(
            "SELECT description FROM quote_line_items WHERE quote_id=$1 ORDER BY sort_order,id",
            [q.id],
          )
        ).rows
          .map((i) => i.description)
          .join(", ")
          .slice(0, 10000);
      const row = (
        await client.query(
          `INSERT INTO commercial_cases(workspace_id,number,title,deal_id,quote_id,company_id,contact_id,status_id,main_products,value,currency,valid_until,payment_terms,delivery_terms,notes,created_by,created_at)VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING id`,
          [
            wid,
            number,
            q.title,
            linked.id,
            q.id,
            q.company_id,
            q.contact_id,
            ss.find((s) => s.outcome === (deal?.status || status) && !s.paid)
              ?.id || ss[0].id,
            products,
            net,
            q.currency,
            d.valid_until || null,
            d.payment || "",
            d.delivery || "",
            number !== ref ? "Historical PDF reference: " + ref : "",
            q.created_by,
            q.created_at,
          ],
        )
      ).rows[0];
      await client.query(
        "UPDATE quotes SET deal_id=$1,commercial_case_id=$2 WHERE id=$3",
        [linked.id, row.id, q.id],
      );
    }
    await client.query(
      "UPDATE quotes q SET commercial_case_id=c.id FROM commercial_cases c WHERE c.quote_id=q.id AND q.commercial_case_id IS NULL",
    );
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
};
