const crypto = require("crypto"),
  P = require("./pipelines"),
  { invalid, optionalId } = require("./dealWorkspace"),
  { getTier } = require("../config/tiers"),
  { isCurrentlyComped } = require("./limits");
const modes = ["everything", "products", "contacts", "companies"];
const tables = {
  company: "companies",
  product: "products",
  price_list: "price_lists",
  contact: "contacts",
  pipeline: "sales_pipelines",
  stage: "pipeline_stages",
  deal: "deals",
  quote: "quotes",
  offer: "offers",
  task: "tasks",
  calendar: "calendar_events",
  purchase: "purchases",
  warranty: "warranty_items",
  review: "warranty_reviews",
  discount: "customer_discounts",
  email_template: "email_templates",
  quote_template: "quote_templates",
  event: "deal_events",
  activity: "activity_log",
  field: "custom_field_definitions",
};
async function source(client, user) {
  const w = (
    await client.query(
      "SELECT id FROM workspaces WHERE id=$1 AND space_type='team'",
      [user.team_workspace_id],
    )
  ).rows[0];
  if (!user.is_personal || !w || w.id === user.workspace_id)
    throw invalid("Open Personal to copy from your current team.");
  return w.id;
}
function selection(body) {
  const mode = body.mode || "everything";
  if (!modes.includes(mode)) throw invalid("Choose what to copy.");
  const ids = body.ids == null ? null : body.ids;
  if (ids !== null && (!Array.isArray(ids) || !ids.length || ids.length > 2000))
    throw invalid("Choose at least one record, or copy all.");
  return { mode, ids: ids?.map(optionalId) };
}
async function preview(client, user, body) {
  const sid = await source(client, user),
    { mode, ids } = selection(body);
  const counts = {};
  for (const [kind, table] of Object.entries({
    companies: "companies",
    products: "products",
    contacts: "contacts",
    deals: "deals",
    quotes: "quotes",
    tasks: "tasks",
    warranty: "warranty_items",
  })) {
    const include = mode === "everything" || kind === mode;
    if (!include) continue;
    const params = [sid];
    let clause = "";
    if (ids && kind === mode) {
      params.push(ids);
      clause = " AND id=ANY($2::int[])";
    }
    counts[kind] = (
      await client.query(
        `SELECT COUNT(*)::int AS n FROM ${table} WHERE workspace_id=$1${clause}`,
        params,
      )
    ).rows[0].n;
  }
  return {
    counts,
    independent: true,
    drafts_only: true,
    credentials_copied: false,
  };
}
async function copy(pool, user, body) {
  const c = await pool.connect();
  try {
    await c.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
    const sid = await source(c, user),
      tid = user.workspace_id,
      { mode, ids } = selection(body);
    await c.query("SELECT id FROM workspaces WHERE id=$1 FOR UPDATE", [tid]);
    await P.ensure(c, tid);
    const rows = {};
    for (const [kind, table] of Object.entries(tables)) {
      rows[kind] = (
        await c.query(
          `SELECT * FROM ${table} WHERE workspace_id=$1` +
            (kind === "quote_template" ? " AND user_id=$2" : ""),
          kind === "quote_template" ? [sid, user.id] : [sid],
        )
      ).rows;
    }
    const pick = (kind) =>
      ids ? rows[kind].filter((r) => ids.includes(r.id)) : rows[kind];
    if (ids && mode !== "everything") {
      const kind = {
        products: "product",
        contacts: "contact",
        companies: "company",
      }[mode];
      if (pick(kind).length !== new Set(ids).size)
        throw invalid(
          "A selected record is no longer available in your team. Refresh and try again.",
        );
    }
    const selectedContacts = new Set(
      (mode === "everything" || mode === "contacts" ? pick("contact") : []).map(
        (r) => r.id,
      ),
    );
    const selectedCompanies = new Set(
      (mode === "everything"
        ? rows.company
        : mode === "companies"
          ? pick("company")
          : rows.company.filter((co) =>
              rows.contact.some(
                (ct) => selectedContacts.has(ct.id) && ct.company_id === co.id,
              ),
            )
      ).map((r) => r.id),
    );
    // Preserve parent paths of selected subsidiaries.
    let changed = true;
    while (changed) {
      changed = false;
      for (const co of rows.company)
        if (
          selectedCompanies.has(co.id) &&
          co.parent_company_id &&
          !selectedCompanies.has(co.parent_company_id)
        ) {
          selectedCompanies.add(co.parent_company_id);
          changed = true;
        }
    }
    const fresh = Object.fromEntries(
      Object.keys(tables).map((k) => [k, new Set()]),
    );
    const maps = Object.fromEntries(
        Object.keys(tables).map((k) => [k, new Map()]),
      ),
      counts = { created: 0, skipped: 0, by_entity: {} };
    async function clone(kind, row, overrides = {}) {
      const table = tables[kind];
      const old = (
        await c.query(
          "SELECT target_id FROM space_copies WHERE source_workspace_id=$1 AND target_workspace_id=$2 AND entity=$3 AND source_id=$4",
          [sid, tid, kind, row.id],
        )
      ).rows[0];
      if (
        old &&
        (
          await c.query(
            `SELECT id FROM ${table} WHERE id=$1 AND workspace_id=$2`,
            [old.target_id, tid],
          )
        ).rows.length
      ) {
        maps[kind].set(row.id, old.target_id);
        counts.skipped++;
        return old.target_id;
      }
      const data = { ...row, ...overrides, workspace_id: tid };
      delete data.id;
      // PG driver date-only values must keep their calendar date when inserted back.
      for (const [key, value] of Object.entries(data))
        if (
          value instanceof Date &&
          [
            "purchased_on",
            "warranty_until",
            "next_review_on",
            "performed_on",
            "due_date",
            "expected_close_date",
          ].includes(key)
        )
          data[key] = require("./warranty").dateValue(value);
      const keys = Object.keys(data),
        values = keys.map((k) => {
          const value = data[k];
          return value &&
            typeof value === "object" &&
            !(value instanceof Date) &&
            !Array.isArray(value)
            ? JSON.stringify(value)
            : value;
        });
      // JSON arrays are not PostgreSQL arrays for these columns.
      for (const key of ["options", "content", "document", "custom_fields"])
        if (key in data) values[keys.indexOf(key)] = JSON.stringify(data[key]);
      const id = (
        await c.query(
          `INSERT INTO ${table}(${keys.join(",")}) VALUES(${keys.map((_, i) => "$" + (i + 1)).join(",")}) RETURNING id`,
          values,
        )
      ).rows[0].id;
      await c.query(
        "INSERT INTO space_copies(source_workspace_id,target_workspace_id,entity,source_id,target_id,created_by) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(source_workspace_id,target_workspace_id,entity,source_id) DO UPDATE SET target_id=EXCLUDED.target_id",
        [sid, tid, kind, row.id, id, user.id],
      );
      maps[kind].set(row.id, id);
      fresh[kind].add(row.id);
      counts.created++;
      counts.by_entity[table] = (counts.by_entity[table] || 0) + 1;
      return id;
    }
    const keyMaps = { contact: {}, product: {} };
    for (const f of rows.field.filter(
      (f) =>
        mode === "everything" ||
        mode === (f.entity === "contact" ? "contacts" : "products"),
    )) {
      const existing = (
        await c.query(
          "SELECT * FROM custom_field_definitions WHERE workspace_id=$1 AND entity=$2 AND field_key=$3",
          [tid, f.entity, f.field_key],
        )
      ).rows[0];
      if (
        existing &&
        existing.type === f.type &&
        JSON.stringify(existing.options) === JSON.stringify(f.options)
      ) {
        keyMaps[f.entity][f.field_key] = existing.field_key;
        continue;
      }
      const newKey = existing ? crypto.randomUUID() : f.field_key;
      const id = await clone("field", f, { field_key: newKey });
      const target = (
        await c.query(
          "SELECT field_key FROM custom_field_definitions WHERE id=$1",
          [id],
        )
      ).rows[0];
      keyMaps[f.entity][f.field_key] = target.field_key;
    }
    const fields = (kind, values) =>
      Object.fromEntries(
        Object.entries(values || {}).map(([key, value]) => [
          keyMaps[kind][key] || key,
          value,
        ]),
      );
    async function company(id, seen = new Set()) {
      if (!id) return null;
      if (maps.company.has(id)) return maps.company.get(id);
      const row = rows.company.find((r) => r.id === id);
      if (!row) return null;
      if (seen.has(id))
        throw invalid("Fix the cyclic company group in Team before copying.");
      seen.add(id);
      const parent = await company(row.parent_company_id, seen);
      return clone("company", row, { parent_company_id: parent });
    }
    for (const id of selectedCompanies) await company(id);
    if (mode === "everything" || mode === "products")
      for (const r of pick("product"))
        await clone("product", r, {
          custom_fields: fields("product", r.custom_fields),
          sku:
            r.sku &&
            (
              await c.query(
                "SELECT id FROM products WHERE workspace_id=$1 AND lower(sku)=lower($2)",
                [tid, r.sku],
              )
            ).rows.length
              ? ""
              : r.sku,
        });
    if (mode === "everything" || mode === "products")
      for (const r of rows.price_list) {
        const items = (
          await c.query(
            "SELECT * FROM price_list_items WHERE price_list_id=$1",
            [r.id],
          )
        ).rows.filter((item) => maps.product.has(item.product_id));
        if (mode === "products" && !items.length) continue;
        let name = r.name;
        for (
          let i = 1;
          (
            await c.query(
              "SELECT id FROM price_lists WHERE workspace_id=$1 AND lower(name)=lower($2)",
              [tid, name],
            )
          ).rows.length;
          i++
        )
          name = r.name.slice(0, 80) + " · Team " + i;
        const listId = await clone("price_list", r, {
          name,
          created_by: user.id,
        });
        if (fresh.price_list.has(r.id))
          for (const item of items)
            await c.query(
              "INSERT INTO price_list_items(price_list_id,product_id,unit_price) VALUES($1,$2,$3)",
              [listId, maps.product.get(item.product_id), item.unit_price],
            );
      }
    // Preflight limits before inserting any clients. Everything rolls back on failure.
    if (selectedContacts.size) {
      const root = (
          await c.query("SELECT * FROM workspaces WHERE id=$1", [
            user.team_workspace_id,
          ])
        ).rows[0],
        tier = getTier(root.tier);
      if (
        root.plan === "active" &&
        !isCurrentlyComped(root) &&
        tier.maxContacts != null
      ) {
        const total = (
          await c.query(
            "SELECT COUNT(*)::int AS n FROM contacts WHERE workspace_id=$1 OR workspace_id IN(SELECT id FROM workspaces WHERE billing_workspace_id=$1)",
            [root.id],
          )
        ).rows[0].n;
        const already = (
          await c.query(
            "SELECT COUNT(*)::int AS n FROM space_copies sc JOIN contacts ct ON ct.id=sc.target_id AND ct.workspace_id=sc.target_workspace_id WHERE sc.source_workspace_id=$1 AND sc.target_workspace_id=$2 AND sc.entity='contact' AND sc.source_id=ANY($3::int[])",
            [sid, tid, [...selectedContacts]],
          )
        ).rows[0].n;
        if (total + selectedContacts.size - already > tier.maxContacts)
          throw invalid(
            "This copy exceeds your plan’s contact allowance. Choose fewer contacts or upgrade.",
            403,
          );
      }
    }
    for (const r of rows.contact.filter((r) => selectedContacts.has(r.id)))
      await clone("contact", r, {
        company_id: maps.company.get(r.company_id) || null,
        owner_id: user.id,
        custom_fields: fields("contact", r.custom_fields),
      });
    if (mode === "everything") {
      for (const r of rows.pipeline) {
        let name = r.name;
        for (
          let i = 1;
          (
            await c.query(
              "SELECT id FROM sales_pipelines WHERE workspace_id=$1 AND lower(name)=lower($2)",
              [tid, name],
            )
          ).rows.length;
          i++
        )
          name = r.name.slice(0, 80) + " · Team" + (i > 1 ? " " + i : "");
        await clone("pipeline", r, { name, is_default: false });
      }
      for (const r of rows.stage)
        await clone("stage", r, {
          pipeline_id: maps.pipeline.get(r.pipeline_id) || null,
        });
      for (const r of rows.deal)
        await clone("deal", r, {
          contact_id: maps.contact.get(r.contact_id) || null,
          company_id: maps.company.get(r.company_id) || null,
          product_id: maps.product.get(r.product_id) || null,
          pipeline_id: maps.pipeline.get(r.pipeline_id) || null,
          stage_id: maps.stage.get(r.stage_id) || null,
          assigned_to: user.id,
        });
      for (const r of rows.quote) {
        const qid = await clone("quote", r, {
          contact_id: maps.contact.get(r.contact_id),
          company_id: maps.company.get(r.company_id) || null,
          created_by: user.id,
          price_list_id: maps.price_list.get(r.price_list_id) || null,
          status: "draft",
          public_token: crypto.randomBytes(18).toString("hex"),
          sent_at: null,
          accepted_at: null,
        });
        // Repeated copies preserve all personal edits, including a previously edited line table.
        if (fresh.quote.has(r.id)) {
          for (const item of (
            await c.query(
              "SELECT * FROM quote_line_items WHERE quote_id=$1 ORDER BY sort_order,id",
              [r.id],
            )
          ).rows) {
            const d = {
              ...item,
              quote_id: qid,
              product_id: maps.product.get(item.product_id) || null,
            };
            delete d.id;
            const keys = Object.keys(d);
            await c.query(
              `INSERT INTO quote_line_items(${keys.join(",")}) VALUES(${keys.map((_, i) => "$" + (i + 1)).join(",")})`,
              Object.values(d),
            );
          }
          for (const rec of (
            await c.query(
              "SELECT contact_id FROM quote_recipients WHERE quote_id=$1",
              [r.id],
            )
          ).rows)
            if (maps.contact.has(rec.contact_id))
              await c.query(
                "INSERT INTO quote_recipients(quote_id,contact_id) VALUES($1,$2)",
                [qid, maps.contact.get(rec.contact_id)],
              );
        }
      }
      for (const r of rows.offer)
        await clone("offer", r, {
          contact_id: maps.contact.get(r.contact_id),
          created_by: user.id,
          status: "draft",
          sent_at: null,
          ai_generated: false,
        });
      for (const r of rows.task)
        await clone("task", r, {
          assigned_to: user.id,
          created_by: user.id,
          contact_id: maps.contact.get(r.contact_id) || null,
          company_id: maps.company.get(r.company_id) || null,
          deal_id: maps.deal.get(r.deal_id) || null,
        });
      for (const r of rows.calendar)
        await clone("calendar", r, {
          created_by: user.id,
          contact_id: maps.contact.get(r.contact_id) || null,
          company_id: maps.company.get(r.company_id) || null,
          deal_id: maps.deal.get(r.deal_id) || null,
          task_id: maps.task.get(r.task_id) || null,
        });
      for (const r of rows.purchase)
        await clone("purchase", r, {
          contact_id: maps.contact.get(r.contact_id),
          product_id: maps.product.get(r.product_id) || null,
          quote_id: maps.quote.get(r.quote_id) || null,
        });
      for (const r of rows.warranty)
        await clone("warranty", r, {
          contact_id: maps.contact.get(r.contact_id),
          product_id: maps.product.get(r.product_id) || null,
          quote_id: maps.quote.get(r.quote_id) || null,
        });
      for (const r of rows.review)
        await clone("review", r, {
          warranty_id: maps.warranty.get(r.warranty_id),
        });
      for (const r of rows.discount)
        await clone("discount", r, {
          contact_id: maps.contact.get(r.contact_id) || null,
          company_id: maps.company.get(r.company_id) || null,
          product_id: maps.product.get(r.product_id),
        });
      for (const r of rows.email_template)
        await clone("email_template", r, { created_by: user.id });
      for (const r of rows.quote_template) {
        const content = structuredClone(r.content);
        for (const item of content.line_items || [])
          item.product_id = maps.product.get(item.product_id) || null;
        let name = r.name;
        let i = 1;
        while (
          (
            await c.query(
              "SELECT id FROM quote_templates WHERE workspace_id=$1 AND user_id=$2 AND name=$3",
              [tid, user.id, name],
            )
          ).rows.length
        )
          name = r.name.slice(0, 80) + " · Team " + i++;
        await clone("quote_template", r, { user_id: user.id, name, content });
      }
      for (const r of rows.event)
        await clone("event", r, { deal_id: maps.deal.get(r.deal_id) });
      for (const r of rows.activity)
        await clone("activity", r, {
          contact_id: maps.contact.get(r.contact_id),
        });
    }
    await c.query("COMMIT");
    return counts;
  } catch (e) {
    await c.query("ROLLBACK");
    if (e.code === "40001")
      throw invalid("Your data changed while copying. Please try again.", 409);
    throw e;
  } finally {
    c.release();
  }
}
module.exports = { preview, copy, source, selection };
