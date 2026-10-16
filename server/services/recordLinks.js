// All inherited document lookups remain inside the caller's active workspace.
// Parameters: $1 workspace, $2 requested entity kind, $3 requested record id.
function inheritingCondition(kind, alias = "f") {
  if (!/^[a-z][a-z_]*$/i.test(alias)) throw new Error("Invalid record alias.");
  const direct = `(${alias}.entity=$2 AND ${alias}.entity_id=$3)`,
    parts = [direct];
  if (kind === "company") {
    parts.push(
      `(${alias}.entity='contact' AND ${alias}.entity_id IN(SELECT id FROM contacts WHERE workspace_id=$1 AND company_id=$3))`,
    );
    for (const [entity, table] of [
      ["deal", "deals"],
      ["quote", "quotes"],
      ["project", "projects"],
      ["order", "sales_orders"],
    ])
      parts.push(
        `(${alias}.entity='${entity}' AND ${alias}.entity_id IN(SELECT r.id FROM ${table} r LEFT JOIN contacts c ON c.id=r.contact_id AND c.workspace_id=r.workspace_id WHERE r.workspace_id=$1 AND (r.company_id=$3 OR (r.company_id IS NULL AND c.company_id=$3))))`,
      );
  }
  if (kind === "contact")
    for (const [entity, table] of [
      ["deal", "deals"],
      ["quote", "quotes"],
      ["project", "projects"],
      ["order", "sales_orders"],
    ])
      parts.push(
        `(${alias}.entity='${entity}' AND ${alias}.entity_id IN(SELECT id FROM ${table} WHERE workspace_id=$1 AND contact_id=$3))`,
      );
  if (kind === "deal")
    for (const [entity, table] of [
      ["quote", "quotes"],
      ["project", "projects"],
      ["order", "sales_orders"],
    ])
      parts.push(
        `(${alias}.entity='${entity}' AND ${alias}.entity_id IN(SELECT id FROM ${table} WHERE workspace_id=$1 AND deal_id=$3))`,
      );
  if (kind === "project")
    parts.push(
      `(${alias}.entity='order' AND ${alias}.entity_id IN(SELECT id FROM sales_orders WHERE workspace_id=$1 AND project_id=$3))`,
    );
  return "(" + parts.join(" OR ") + ")";
}
module.exports = { inheritingCondition };
