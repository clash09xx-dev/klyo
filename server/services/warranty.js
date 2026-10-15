const { invalid, text, optionalId, validDate } = require("./dealWorkspace");
const today = (zone = "UTC") =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
const dateValue = (v) =>
  v instanceof Date
    ? [
        v.getFullYear(),
        String(v.getMonth() + 1).padStart(2, "0"),
        String(v.getDate()).padStart(2, "0"),
      ].join("-")
    : String(v).slice(0, 10);
function addMonths(date, months) {
  const d = new Date(validDate(date) + "T12:00:00Z"),
    day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + Number(months));
  const last = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0),
  ).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.toISOString().slice(0, 10);
}
function monthCount(v, required = false) {
  if (v == null || v === "") {
    if (required) throw invalid("Enter a warranty period.");
    return null;
  }
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 1200)
    throw invalid("Choose a period from 1 to 1200 months.");
  return n;
}
async function save(client, user, id, input) {
  const old = id
    ? (
        await client.query(
          "SELECT * FROM warranty_items WHERE id=$1 AND workspace_id=$2 FOR UPDATE",
          [optionalId(id), user.workspace_id],
        )
      ).rows[0]
    : null;
  if (id && !old) throw invalid("Warranty item not found.", 404);
  const b = { ...old, ...input },
    contactId = optionalId(b.contact_id),
    productId = optionalId(b.product_id);
  if (
    !contactId ||
    !(
      await client.query(
        "SELECT id FROM contacts WHERE id=$1 AND workspace_id=$2",
        [contactId, user.workspace_id],
      )
    ).rows.length
  )
    throw invalid("Choose a client in this workspace.");
  const product = productId
    ? (
        await client.query(
          "SELECT * FROM products WHERE id=$1 AND workspace_id=$2",
          [productId, user.workspace_id],
        )
      ).rows[0]
    : null;
  if (productId && !product)
    throw invalid("Product is not available in this workspace.");
  const purchased = validDate(
      dateValue(b.purchased_on || today(user.time_zone)),
    ),
    months = monthCount(b.warranty_months ?? product?.warranty_months, true),
    interval = monthCount(
      b.review_interval_months ?? product?.service_interval_months,
    );
  const end = addMonths(purchased, months);
  let next = Object.hasOwn(input, "next_review_on")
    ? validDate(input.next_review_on)
    : old?.next_review_on
      ? dateValue(old.next_review_on)
      : interval
        ? addMonths(purchased, interval)
        : null;
  if (next && next < purchased)
    throw invalid("A review cannot precede the purchase.");
  if (next && next > end) {
    if (Object.hasOwn(input, "next_review_on"))
      throw invalid("Choose a review date within the warranty period.");
    next = null;
  }
  const color = b.color || "#f59e0b";
  if (!/^#[a-f0-9]{6}$/i.test(color))
    throw invalid("Choose a valid notification colour.");
  const quantity = Number(b.quantity ?? 1);
  if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 1e6)
    throw invalid("Enter a valid quantity.");
  const status = b.status || "active";
  if (!["active", "closed"].includes(status))
    throw invalid("Choose a valid warranty status.");
  const values = {
    contact_id: contactId,
    product_id: productId,
    product_name: text(
      b.product_name || product?.name || old?.product_name,
      300,
      "product name",
      true,
    ),
    serial_number: text(b.serial_number || "", 300, "serial number"),
    quantity,
    purchased_on: purchased,
    warranty_months: months,
    warranty_until: end,
    review_interval_months: interval,
    next_review_on: next || null,
    color,
    notes: text(b.notes || "", 10000, "notes"),
    status,
  };
  const keys = Object.keys(values),
    params = Object.values(values);
  params.push(user.workspace_id);
  if (id) {
    params.push(id);
    return (
      await client.query(
        `UPDATE warranty_items SET ${keys.map((k, i) => k + "=$" + (i + 1)).join(",")},updated_at=now() WHERE workspace_id=$${params.length - 1} AND id=$${params.length} RETURNING *`,
        params,
      )
    ).rows[0];
  }
  return (
    await client.query(
      `INSERT INTO warranty_items(${keys.join(",")},workspace_id) VALUES(${params.map((_, i) => "$" + (i + 1)).join(",")}) RETURNING *`,
      params,
    )
  ).rows[0];
}
module.exports = { save, addMonths, today, monthCount, dateValue };
