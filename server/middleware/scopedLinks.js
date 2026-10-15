const db = require("../db"),
  { optionalId, invalid } = require("../services/dealWorkspace"),
  { canLinkUser } = require("../services/spaces");
module.exports = async (req) => {
  if (
    !["POST", "PUT", "PATCH"].includes(req.method) ||
    !req.body ||
    typeof req.body !== "object"
  )
    return;
  const linked = {};
  for (const [field, table] of Object.entries({
    contact_id: "contacts",
    company_id: "companies",
    product_id: "products",
    deal_id: "deals",
    task_id: "tasks",
    owner_id: "users",
    assigned_to: "users",
  }))
    if (req.body[field] != null && req.body[field] !== "")
      (linked[table] ??= []).push(optionalId(req.body[field]));
  if (Array.isArray(req.body.recipient_ids))
    for (const id of req.body.recipient_ids)
      (linked.contacts ??= []).push(optionalId(id));
  if (Array.isArray(req.body.line_items))
    for (const item of req.body.line_items)
      if (item?.product_id)
        (linked.products ??= []).push(optionalId(item.product_id));
  for (const [table, list] of Object.entries(linked)) {
    const ids = [...new Set(list)];
    if (ids.length > 2000) throw invalid("Too many linked records.");
    let okay;
    if (table === "users") {
      okay = true;
      for (const id of ids)
        if (!(await canLinkUser(db, id, req.user.workspace_id))) okay = false;
    } else
      okay =
        (
          await db.query(
            `SELECT id FROM ${table} WHERE id=ANY($1::int[]) AND workspace_id=$2`,
            [ids, req.user.workspace_id],
          )
        ).rows.length === ids.length;
    if (!okay)
      throw invalid("A linked record is not available in this workspace.");
  }
};
