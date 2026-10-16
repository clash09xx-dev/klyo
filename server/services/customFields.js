const crypto = require("crypto");
const { invalid, text, validDate } = require("./dealWorkspace");
const types = ["text", "textarea", "number", "date", "select", "checkbox"];
function entity(value) {
  if (!["contact", "product", "company"].includes(value))
    throw invalid("Choose contacts, companies or products.");
  return value;
}
async function definitions(client, wid, kind, archived = false) {
  return (
    await client.query(
      "SELECT * FROM custom_field_definitions WHERE workspace_id=$1 AND entity=$2" +
        (archived ? "" : " AND NOT archived") +
        " ORDER BY sort_order,id",
      [wid, entity(kind)],
    )
  ).rows;
}
async function validate(client, wid, kind, input, previous = {}) {
  if (input === undefined) input = {};
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    JSON.stringify(input).length > 100000
  )
    throw invalid("Invalid custom fields.");
  const defs = await definitions(client, wid, kind, true),
    byKey = new Map(defs.map((d) => [d.field_key, d]));
  const result = { ...previous };
  for (const [key, value] of Object.entries(input)) {
    const d = byKey.get(key);
    if (!d)
      throw invalid(
        "A custom field is no longer available. Refresh and try again.",
      );
    if (d.archived) continue;
    const empty = value == null || value === "";
    if (empty) {
      if (d.required) throw invalid(`${d.name} is required.`);
      result[key] = null;
      continue;
    }
    if (d.type === "checkbox") {
      if (typeof value !== "boolean")
        throw invalid(`Choose a valid value for ${d.name}.`);
    } else if (d.type === "number") {
      if (
        typeof value !== "number" ||
        !Number.isFinite(value) ||
        Math.abs(value) > 1e12
      )
        throw invalid(`Enter a valid number for ${d.name}.`);
    } else if (d.type === "date") validDate(value);
    else {
      text(value, d.type === "textarea" ? 8000 : 1000, d.name);
      if (d.type === "select" && !d.options.includes(value))
        throw invalid(`Choose an available option for ${d.name}.`);
    }
    result[key] = typeof value === "string" ? value.trim() : value;
  }
  for (const d of defs.filter((d) => !d.archived && d.required))
    if (result[d.field_key] == null || result[d.field_key] === "")
      throw invalid(`${d.name} is required.`);
  return result;
}
async function save(client, wid, id, input) {
  const kind = entity(input.entity),
    name = text(input.name, 100, "field name", true),
    type = input.type;
  if (!types.includes(type)) throw invalid("Choose a supported field type.");
  const options =
    type === "select"
      ? Array.isArray(input.options)
        ? input.options.map((v) => text(v, 100, "option", true))
        : []
      : [];
  if (
    type === "select" &&
    (!options.length ||
      options.length > 40 ||
      new Set(options).size !== options.length)
  )
    throw invalid("Add 1–40 different options.");
  const all = await definitions(client, wid, kind, true),
    old = id ? all.find((d) => d.id === Number(id)) : null;
  if (id && !old) throw invalid("Field not found.", 404);
  if (old && old.type !== type)
    throw invalid(
      "Create a new field to change its type. Existing values are preserved.",
    );
  if (!old && all.filter((d) => !d.archived).length >= 200)
    throw invalid("You can have up to 200 active fields per record type.");
  if (
    old &&
    type === "select" &&
    old.options.some((v) => !options.includes(v))
  ) {
    const table = kind === "contact" ? "contacts" : kind === "company" ? "companies" : "products";
    if (
      (
        await client.query(
          `SELECT id FROM ${table} WHERE workspace_id=$1 AND custom_fields->>$2 IS NOT NULL AND NOT (custom_fields->>$2=ANY($3::text[])) LIMIT 1`,
          [wid, old.field_key, options],
        )
      ).rows.length
    )
      throw invalid(
        "An option in use cannot be removed. Rename the field or keep the option.",
      );
  }
  return id
    ? (
        await client.query(
          "UPDATE custom_field_definitions SET name=$1,options=$2,required=$3,archived=false WHERE id=$4 AND workspace_id=$5 RETURNING *",
          [name, JSON.stringify(options), Boolean(input.required), id, wid],
        )
      ).rows[0]
    : (
        await client.query(
          "INSERT INTO custom_field_definitions(workspace_id,entity,field_key,name,type,options,required,sort_order) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *",
          [
            wid,
            kind,
            crypto.randomUUID(),
            name,
            type,
            JSON.stringify(options),
            Boolean(input.required),
            all.length,
          ],
        )
      ).rows[0];
}
module.exports = { definitions, validate, save, entity };
