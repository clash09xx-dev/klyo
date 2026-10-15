const F = require("./customFields"),
  { invalid, text, optionalId } = require("./dealWorkspace"),
  { normalizeCurrency } = require("./workspaceCurrency");
function price(value) {
  let s = String(value ?? "")
    .trim()
    .replace(/[\s\u00a0\u202f]/g, "");
  if (s.includes(",") && s.includes(".")) {
    const decimal = s.lastIndexOf(",") > s.lastIndexOf(".") ? "," : ".";
    s = s.replace(decimal === "," ? /\./g : /,/g, "").replace(",", ".");
  } else if (s.includes(","))
    s = /^\d{1,3}(,\d{3})+$/.test(s)
      ? s.replace(/,/g, "")
      : s.replace(",", ".");
  const n = Number(s);
  if (
    !/^\d+(?:\.\d{1,2})?$/.test(s) ||
    !Number.isFinite(n) ||
    n < 0 ||
    n > 9999999999.99 ||
    Math.abs(n * 100 - Math.round(n * 100)) > 0.0001
  )
    throw invalid("Enter a valid price with up to two decimal places.");
  return Math.round(n * 100) / 100;
}
async function preview(client, wid, body) {
  const currency = normalizeCurrency(body.currency);
  if (!currency) throw invalid("Choose a supported price-list currency.");
  if (!Array.isArray(body.rows) || !body.rows.length || body.rows.length > 1000)
    throw invalid("Import 1–1000 rows at a time.");
  const defs = await F.definitions(client, wid, "product", true),
    fieldClient = { query: async () => ({ rows: defs }) };
  const existing = (
      await client.query("SELECT * FROM products WHERE workspace_id=$1", [wid])
    ).rows,
    seen = new Set(),
    matchedIds = new Set();
  const rows = [];
  for (let index = 0; index < body.rows.length; index++) {
    const input = body.rows[index];
    try {
      if (!input || typeof input !== "object" || Array.isArray(input))
        throw invalid("Each row must contain product fields.");
      const name = text(input.name, 300, "product name", true),
        sku = text(input.sku || "", 100, "SKU"),
        key = (sku ? "sku:" : "name:") + (sku || name).toLowerCase();
      if (seen.has(key))
        throw invalid("This product occurs more than once in the file.");
      seen.add(key);
      const matches = existing.filter((p) =>
        sku
          ? p.sku.toLowerCase() === sku.toLowerCase()
          : p.name.toLowerCase() === name.toLowerCase(),
      );
      if (matches.length > 1)
        throw invalid("This name matches several products. Add a unique SKU.");
      const old = matches[0];
      if (old && matchedIds.has(old.id))
        throw invalid("This product occurs more than once in the file.");
      if (old) matchedIds.add(old.id);
      const rowCurrency = input.currency
        ? normalizeCurrency(input.currency)
        : currency;
      if (rowCurrency !== currency)
        throw invalid(
          "This row uses a different currency from the selected price list.",
        );
      const months = (v) => {
        if (v == null || v === "") return null;
        const n = Number(v);
        if (!Number.isInteger(n) || n < 1 || n > 1200)
          throw invalid("Warranty and review intervals must be 1–1200 months.");
        return n;
      };
      const fields = await F.validate(
        fieldClient,
        wid,
        "product",
        input.custom_fields || {},
        old?.custom_fields || {},
      );
      rows.push({
        index,
        name,
        sku,
        unit_price: price(input.unit_price),
        description: text(input.description || "", 10000, "description"),
        unit_label: text(input.unit_label || "unit", 100, "unit"),
        category: text(input.category || "", 200, "category"),
        currency,
        warranty_months: months(input.warranty_months),
        service_interval_months: months(input.service_interval_months),
        custom_fields: fields,
        product_id: old?.id || null,
        action: old ? "price" : "create",
        error: null,
      });
    } catch (e) {
      if (!e.status) throw e;
      rows.push({
        index,
        name: String(input?.name || "").slice(0, 300),
        error: e.message,
      });
    }
  }
  return { rows, valid: rows.filter((r) => !r.error).length, currency };
}
async function importRows(pool, user, body) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT id FROM workspaces WHERE id=$1 FOR UPDATE", [
      user.workspace_id,
    ]);
    const checked = await preview(client, user.workspace_id, body);
    if (checked.valid !== body.rows.length)
      throw invalid("Fix or exclude invalid rows before importing.");
    const name = text(body.name, 100, "price-list name", true),
      source = text(body.source_name || "", 300, "source file");
    let list;
    if (body.list_id) {
      list = (
        await client.query(
          "SELECT * FROM price_lists WHERE id=$1 AND workspace_id=$2 FOR UPDATE",
          [optionalId(body.list_id), user.workspace_id],
        )
      ).rows[0];
      if (!list) throw invalid("Price list not found.", 404);
      if (list.currency !== checked.currency)
        throw invalid("Use the same currency as the existing price list.");
      await client.query(
        "UPDATE price_lists SET name=$1,source_name=$2,updated_at=now() WHERE id=$3",
        [name, source, list.id],
      );
    } else
      list = (
        await client.query(
          "INSERT INTO price_lists(workspace_id,created_by,name,currency,source_name) VALUES($1,$2,$3,$4,$5) RETURNING *",
          [user.workspace_id, user.id, name, checked.currency, source],
        )
      ).rows[0];
    let created = 0;
    for (const row of checked.rows) {
      let id = row.product_id;
      if (!id) {
        id = (
          await client.query(
            "INSERT INTO products(workspace_id,name,sku,unit_price,currency,description,unit_label,category,warranty_months,service_interval_months,custom_fields) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id",
            [
              user.workspace_id,
              row.name,
              row.sku,
              row.unit_price,
              row.currency,
              row.description,
              row.unit_label,
              row.category,
              row.warranty_months,
              row.service_interval_months,
              JSON.stringify(row.custom_fields),
            ],
          )
        ).rows[0].id;
        created++;
      } else if (body.update_catalog === true)
        await client.query(
          "UPDATE products SET unit_price=$1,currency=$2 WHERE id=$3 AND workspace_id=$4",
          [row.unit_price, row.currency, id, user.workspace_id],
        );
      await client.query(
        "INSERT INTO price_list_items(price_list_id,product_id,unit_price) VALUES($1,$2,$3) ON CONFLICT(price_list_id,product_id) DO UPDATE SET unit_price=EXCLUDED.unit_price",
        [list.id, id, row.unit_price],
      );
    }
    await client.query("COMMIT");
    return { list, imported: checked.valid, created };
  } catch (e) {
    await client.query("ROLLBACK");
    if (e.code === "23505")
      throw invalid(
        "This price-list name or SKU already exists. Refresh and try again.",
        409,
      );
    throw e;
  } finally {
    client.release();
  }
}
module.exports = { price, preview, importRows };
