// server/routes/quotes.js
const express = require("express");
const db = require("../db");
const { requireAuth } = require("../middleware/auth");
const { requirePaidAccess } = require("../middleware/billing");
const { sendOfferEmail } = require("../services/mailer");

const router = express.Router();
router.use(requireAuth);
router.use(requirePaidAccess);

async function logActivity(workspaceId, contactId, userId, type, description) {
  await db.query(
    "INSERT INTO activity_log (workspace_id, contact_id, user_id, type, description) VALUES ($1, $2, $3, $4, $5)",
    [workspaceId, contactId, userId, type, description]
  );
}

// Recomputes line totals server-side so the numbers can't be tampered
// with from the browser, and returns the quote-level totals to match.
function computeTotals(lineItems) {
  let subtotal = 0;
  let total = 0;
  const computed = lineItems.map((item, i) => {
    const quantity = Number(item.quantity) || 0;
    const unitPrice = Number(item.unit_price) || 0;
    const discountPercent = Math.min(100, Math.max(0, Number(item.discount_percent) || 0));
    const gross = quantity * unitPrice;
    const lineTotal = gross * (1 - discountPercent / 100);
    subtotal += gross;
    total += lineTotal;
    return {
      product_id: item.product_id || null,
      description: (item.description || "").trim() || "Item",
      quantity,
      unit_price: unitPrice,
      discount_percent: discountPercent,
      line_total: Math.round(lineTotal * 100) / 100,
      sort_order: i,
    };
  });
  subtotal = Math.round(subtotal * 100) / 100;
  total = Math.round(total * 100) / 100;
  return { computed, subtotal, total, discountTotal: Math.round((subtotal - total) * 100) / 100 };
}

async function replaceLineItemsAndRecipients(quoteId, lineItems, recipientIds) {
  await db.query("DELETE FROM quote_line_items WHERE quote_id = $1", [quoteId]);
  await db.query("DELETE FROM quote_recipients WHERE quote_id = $1", [quoteId]);

  for (const item of lineItems) {
    await db.query(
      `INSERT INTO quote_line_items (quote_id, product_id, description, quantity, unit_price, discount_percent, line_total, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [quoteId, item.product_id, item.description, item.quantity, item.unit_price, item.discount_percent, item.line_total, item.sort_order]
    );
  }
  for (const contactId of recipientIds || []) {
    await db.query("INSERT INTO quote_recipients (quote_id, contact_id) VALUES ($1, $2)", [quoteId, contactId]);
  }
}

async function getFullQuote(id, workspaceId) {
  const quoteResult = await db.query(
    `SELECT q.*, c.full_name AS contact_name, c.email AS contact_email, co.name AS company_name
     FROM quotes q
     JOIN contacts c ON c.id = q.contact_id
     LEFT JOIN companies co ON co.id = q.company_id
     WHERE q.id = $1 AND q.workspace_id = $2`,
    [id, workspaceId]
  );
  const quote = quoteResult.rows[0];
  if (!quote) return null;

  const items = await db.query("SELECT * FROM quote_line_items WHERE quote_id = $1 ORDER BY sort_order", [id]);
  const recipients = await db.query(
    `SELECT c.id, c.full_name, c.email, c.title, c.is_decision_maker
     FROM quote_recipients qr JOIN contacts c ON c.id = qr.contact_id WHERE qr.quote_id = $1`,
    [id]
  );
  return { quote, lineItems: items.rows, recipients: recipients.rows };
}

// GET /api/quotes — list, optionally filtered to one contact or company
router.get("/", async (req, res) => {
  const { contact_id, company_id, status } = req.query;
  let sql = `
    SELECT q.*, c.full_name AS contact_name, co.name AS company_name
    FROM quotes q
    JOIN contacts c ON c.id = q.contact_id
    LEFT JOIN companies co ON co.id = q.company_id
    WHERE q.workspace_id = $1
  `;
  const params = [req.user.workspace_id];
  if (contact_id) { params.push(contact_id); sql += ` AND q.contact_id = $${params.length}`; }
  if (company_id) { params.push(company_id); sql += ` AND q.company_id = $${params.length}`; }
  if (status) { params.push(status); sql += ` AND q.status = $${params.length}`; }
  sql += ` ORDER BY q.updated_at DESC`;

  const result = await db.query(sql, params);
  res.json({ quotes: result.rows });
});

// POST /api/quotes — create a draft with line items + recipients in one go
router.post("/", async (req, res) => {
  const { contact_id, company_id, title, intro_message, line_items, recipient_ids } = req.body || {};
  if (!contact_id) return res.status(400).json({ error: "A quote needs a primary contact." });
  if (!Array.isArray(line_items) || !line_items.length) {
    return res.status(400).json({ error: "Add at least one line item." });
  }

  const contactCheck = await db.query("SELECT id FROM contacts WHERE id = $1 AND workspace_id = $2", [
    contact_id,
    req.user.workspace_id,
  ]);
  if (!contactCheck.rows.length) return res.status(404).json({ error: "Contact not found." });

  const { computed, subtotal, total, discountTotal } = computeTotals(line_items);

  const quoteResult = await db.query(
    `INSERT INTO quotes (workspace_id, contact_id, company_id, created_by, title, intro_message, subtotal, discount_total, total)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
    [
      req.user.workspace_id,
      contact_id,
      company_id || null,
      req.user.id,
      title?.trim() || "Quote",
      intro_message?.trim() || null,
      subtotal,
      discountTotal,
      total,
    ]
  );
  const quoteId = quoteResult.rows[0].id;
  await replaceLineItemsAndRecipients(quoteId, computed, recipient_ids);
  await logActivity(req.user.workspace_id, contact_id, req.user.id, "quote_created", `${req.user.name} created a quote ("${title || "Quote"}").`);

  const full = await getFullQuote(quoteId, req.user.workspace_id);
  res.status(201).json(full);
});

// GET /api/quotes/:id
router.get("/:id", async (req, res) => {
  const full = await getFullQuote(req.params.id, req.user.workspace_id);
  if (!full) return res.status(404).json({ error: "Quote not found." });
  res.json(full);
});

// PUT /api/quotes/:id — edit a draft (title, intro, line items, recipients)
router.put("/:id", async (req, res) => {
  const existing = await db.query("SELECT * FROM quotes WHERE id = $1 AND workspace_id = $2", [
    req.params.id,
    req.user.workspace_id,
  ]);
  const quote = existing.rows[0];
  if (!quote) return res.status(404).json({ error: "Quote not found." });
  if (quote.status !== "draft") return res.status(400).json({ error: "Only draft quotes can be edited." });

  const { title, intro_message, company_id, line_items, recipient_ids } = req.body || {};
  if (!Array.isArray(line_items) || !line_items.length) {
    return res.status(400).json({ error: "Add at least one line item." });
  }
  const { computed, subtotal, total, discountTotal } = computeTotals(line_items);

  await db.query(
    `UPDATE quotes SET title=$1, intro_message=$2, company_id=$3, subtotal=$4, discount_total=$5, total=$6, updated_at=now()
     WHERE id=$7`,
    [title?.trim() || "Quote", intro_message?.trim() || null, company_id || null, subtotal, discountTotal, total, req.params.id]
  );
  await replaceLineItemsAndRecipients(req.params.id, computed, recipient_ids);

  const full = await getFullQuote(req.params.id, req.user.workspace_id);
  res.json(full);
});

// DELETE /api/quotes/:id
router.delete("/:id", async (req, res) => {
  const existing = await db.query("SELECT id FROM quotes WHERE id = $1 AND workspace_id = $2", [
    req.params.id,
    req.user.workspace_id,
  ]);
  if (!existing.rows.length) return res.status(404).json({ error: "Quote not found." });
  await db.query("DELETE FROM quotes WHERE id = $1", [req.params.id]);
  res.json({ ok: true });
});

// Shared by both the preview route and the actual send, so what you
// approve in the preview is byte-for-byte what goes out.
function buildSendableEmail(full) {
  const { quote, lineItems, recipients } = full;
  const toList = recipients.length
    ? recipients.map((r) => r.email).filter(Boolean)
    : [quote.contact_email ? [quote.contact_email] : []].flat();
  const toNames = recipients.length ? recipients.map((r) => r.full_name) : [quote.contact_name];
  return {
    to: toList,
    toNames,
    subject: quote.title || "Your quote",
    body: renderQuoteEmailText(quote, lineItems, recipients),
  };
}

// GET /api/quotes/:id/preview — exactly what "Send" will send, before it sends
router.get("/:id/preview", async (req, res) => {
  const full = await getFullQuote(req.params.id, req.user.workspace_id);
  if (!full) return res.status(404).json({ error: "Quote not found." });

  const email = buildSendableEmail(full);
  if (!email.to.length) return res.status(400).json({ error: "No email address on file for this quote's recipients." });

  res.json(email);
});

// POST /api/quotes/:id/send — emails every addressed recipient (falls back
// to the primary contact if no specific decision-makers were picked)
router.post("/:id/send", async (req, res) => {
  const full = await getFullQuote(req.params.id, req.user.workspace_id);
  if (!full) return res.status(404).json({ error: "Quote not found." });
  const { quote } = full;

  const email = buildSendableEmail(full);
  if (!email.to.length) return res.status(400).json({ error: "No email address on file for this quote's recipients." });

  // The preview screen allows light edits to the subject/body before
  // confirming send — use those if provided, otherwise the original.
  const subject = (req.body && req.body.subject) || email.subject;
  const body = (req.body && req.body.body) || email.body;

  try {
    const wsResult = await db.query("SELECT gmail_refresh_token FROM workspaces WHERE id = $1", [req.user.workspace_id]);
    await sendOfferEmail(email.to.join(", "), subject, body, wsResult.rows[0]);

    await db.query("UPDATE quotes SET status='sent', sent_at=now() WHERE id=$1", [quote.id]);
    await logActivity(
      req.user.workspace_id,
      quote.contact_id,
      req.user.id,
      "quote_sent",
      `${req.user.name} sent the quote "${subject}" to ${email.to.join(", ")}.`
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(502).json({ error: err.message || "Could not send the quote right now." });
  }
});

// POST /api/quotes/:id/accept — marks it won, and creates purchase records
// (this is what feeds the automatic maintenance-reminder system later)
router.post("/:id/accept", async (req, res) => {
  const full = await getFullQuote(req.params.id, req.user.workspace_id);
  if (!full) return res.status(404).json({ error: "Quote not found." });
  const { quote, lineItems } = full;

  await db.query("UPDATE quotes SET status='accepted', accepted_at=now() WHERE id=$1", [quote.id]);

  for (const item of lineItems) {
    if (!item.product_id) continue; // one-off line items with no catalog product don't get tracked for service reminders
    const productResult = await db.query("SELECT service_interval_months FROM products WHERE id = $1", [item.product_id]);
    const months = productResult.rows[0]?.service_interval_months;
    const dueAt = months ? `now() + interval '${Number(months)} months'` : "NULL";

    await db.query(
      `INSERT INTO purchases (workspace_id, contact_id, product_id, quote_id, description, quantity, next_service_due_at)
       VALUES ($1, $2, $3, $4, $5, $6, ${dueAt})`,
      [req.user.workspace_id, quote.contact_id, item.product_id, quote.id, item.description, item.quantity]
    );
  }

  await logActivity(req.user.workspace_id, quote.contact_id, req.user.id, "quote_accepted", `${req.user.name} marked the quote "${quote.title}" as accepted.`);
  res.json({ ok: true });
});

// POST /api/quotes/:id/decline
router.post("/:id/decline", async (req, res) => {
  const existing = await db.query("SELECT * FROM quotes WHERE id = $1 AND workspace_id = $2", [
    req.params.id,
    req.user.workspace_id,
  ]);
  const quote = existing.rows[0];
  if (!quote) return res.status(404).json({ error: "Quote not found." });

  await db.query("UPDATE quotes SET status='declined' WHERE id=$1", [quote.id]);
  await logActivity(req.user.workspace_id, quote.contact_id, req.user.id, "quote_declined", `${req.user.name} marked the quote "${quote.title}" as declined.`);
  res.json({ ok: true });
});

// Plain-text rendering — chosen deliberately over an HTML table so this
// reuses the exact same send pipeline (Gmail/SMTP) with zero changes.
function renderQuoteEmailText(quote, lineItems, recipients) {
  const greetingName = recipients.length ? recipients.map((r) => r.full_name.split(" ")[0]).join(" / ") : "there";
  const lines = [];
  lines.push(`Hi ${greetingName},`, "");
  if (quote.intro_message) lines.push(quote.intro_message, "");
  lines.push("Here's the breakdown:", "");

  for (const item of lineItems) {
    const discountNote = item.discount_percent > 0 ? ` (${item.discount_percent}% off)` : "";
    lines.push(`- ${item.description}${discountNote} — qty ${item.quantity} x $${Number(item.unit_price).toFixed(2)} = $${Number(item.line_total).toFixed(2)}`);
  }
  lines.push("");
  if (Number(quote.discount_total) > 0) {
    lines.push(`Subtotal: $${Number(quote.subtotal).toFixed(2)}`, `Discount: -$${Number(quote.discount_total).toFixed(2)}`);
  }
  lines.push(`Total: $${Number(quote.total).toFixed(2)}`, "", "Happy to answer any questions — just reply to this email.");
  return lines.join("\n");
}

module.exports = router;
