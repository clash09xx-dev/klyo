const db = require("../db");
const Q = require("../../public/js/quote-core");
async function getFullQuote(id, workspaceId, client = db) {
  const q = await client.query(
    `SELECT q.*,c.full_name AS contact_name,c.email AS contact_email,c.phone AS contact_phone,co.name AS company_name,w.name AS workspace_name FROM quotes q JOIN contacts c ON c.id=q.contact_id AND c.workspace_id=q.workspace_id LEFT JOIN companies co ON co.id=q.company_id AND co.workspace_id=q.workspace_id JOIN workspaces w ON w.id=q.workspace_id WHERE q.id=$1 AND q.workspace_id=$2`,
    [id, workspaceId],
  );
  if (!q.rows.length) return null;
  const items = await client.query(
    "SELECT * FROM quote_line_items WHERE quote_id=$1 ORDER BY sort_order,id",
    [id],
  );
  const recipients = await client.query(
    "SELECT c.id,c.full_name,c.email,c.title,c.is_decision_maker FROM quote_recipients qr JOIN contacts c ON c.id=qr.contact_id WHERE qr.quote_id=$1 AND c.workspace_id=$2",
    [id, workspaceId],
  );
  return {
    quote: q.rows[0],
    lineItems: items.rows,
    recipients: recipients.rows,
  };
}
async function getPublicQuote(token) {
  if (typeof token !== "string" || !/^\w{24,100}$/.test(token)) return null;
  const q = await db.query(
    "SELECT id,workspace_id FROM quotes WHERE public_token=$1",
    [token],
  );
  return q.rows.length
    ? getFullQuote(q.rows[0].id, q.rows[0].workspace_id)
    : null;
}
async function validateLinks(
  client,
  workspaceId,
  contactId,
  companyId,
  items,
  recipients,
) {
  if (
    !Number.isSafeInteger(Number(contactId)) ||
    Number(contactId) < 1 ||
    (companyId &&
      (!Number.isSafeInteger(Number(companyId)) || Number(companyId) < 1))
  )
    throw Object.assign(new Error("Invalid contact or company."), {
      status: 400,
    });
  const contact = await client.query(
    "SELECT c.*,co.name AS company_name FROM contacts c LEFT JOIN companies co ON co.id=c.company_id AND co.workspace_id=c.workspace_id WHERE c.id=$1 AND c.workspace_id=$2",
    [contactId, workspaceId],
  );
  if (!contact.rows.length)
    throw Object.assign(new Error("Contact not found."), { status: 404 });
  if (companyId) {
    const r = await client.query(
      "SELECT id FROM companies WHERE id=$1 AND workspace_id=$2",
      [companyId, workspaceId],
    );
    if (!r.rows.length)
      throw Object.assign(new Error("Company not found."), { status: 404 });
  }
  const productIds = [
    ...new Set(items.map((i) => i.product_id).filter(Boolean)),
  ];
  if (productIds.length) {
    const r = await client.query(
      "SELECT id FROM products WHERE workspace_id=$1 AND id=ANY($2::int[])",
      [workspaceId, productIds],
    );
    if (r.rows.length !== productIds.length)
      throw Object.assign(new Error("Product not found."), { status: 404 });
  }
  if (
    !Array.isArray(recipients) ||
    recipients.length > 100 ||
    recipients.some((id) => !Number.isSafeInteger(id) || id < 1) ||
    new Set(recipients).size !== recipients.length
  )
    throw Object.assign(new Error("Invalid quote recipients."), {
      status: 400,
    });
  if (recipients.length) {
    const r = await client.query(
      "SELECT id FROM contacts WHERE workspace_id=$1 AND id=ANY($2::int[])",
      [workspaceId, recipients],
    );
    if (r.rows.length !== recipients.length)
      throw Object.assign(new Error("Recipient not found."), { status: 404 });
  }
  return contact.rows[0];
}
async function replaceItems(client, id, items, recipients) {
  await client.query("DELETE FROM quote_line_items WHERE quote_id=$1", [id]);
  await client.query("DELETE FROM quote_recipients WHERE quote_id=$1", [id]);
  for (const i of items)
    await client.query(
      "INSERT INTO quote_line_items(quote_id,product_id,description,quantity,unit_price,discount_percent,line_total,sort_order) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
      [
        id,
        i.product_id,
        i.description,
        i.quantity,
        i.unit_price,
        i.discount_percent,
        i.line_total,
        i.sort_order,
      ],
    );
  for (const contact of recipients)
    await client.query(
      "INSERT INTO quote_recipients(quote_id,contact_id) VALUES($1,$2)",
      [id, contact],
    );
}
async function transaction(fn) {
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
module.exports = {
  getFullQuote,
  getPublicQuote,
  validateLinks,
  replaceItems,
  transaction,
};
