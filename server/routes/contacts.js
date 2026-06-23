// server/routes/contacts.js
const express = require("express");
const db = require("../db");
const { requireAuth } = require("../middleware/auth");
const { requirePaidAccess } = require("../middleware/billing");
const { assertWithinLimit, LimitExceededError } = require("../services/limits");
const { generateOfferEmail } = require("../services/openai");

const router = express.Router();
router.use(requireAuth);
router.use(requirePaidAccess);

const VALID_STATUSES = ["lead", "contacted", "negotiating", "customer", "lost"];

async function logActivity(workspaceId, contactId, userId, type, description) {
  await db.query(
    "INSERT INTO activity_log (workspace_id, contact_id, user_id, type, description) VALUES ($1, $2, $3, $4, $5)",
    [workspaceId, contactId, userId, type, description]
  );
}

// GET /api/contacts — list, with optional search + filters (scoped to this workspace)
router.get("/", async (req, res) => {
  const { search, status, theme, owner_id, company_id } = req.query;

  let sql = `
    SELECT c.*, u.name AS owner_name, co.name AS company_name
    FROM contacts c
    LEFT JOIN users u ON u.id = c.owner_id
    LEFT JOIN companies co ON co.id = c.company_id
    WHERE c.workspace_id = $1
  `;
  const params = [req.user.workspace_id];

  if (search) {
    params.push(`%${search}%`);
    const i = params.length;
    sql += ` AND (c.full_name ILIKE $${i} OR c.email ILIKE $${i} OR c.phone ILIKE $${i} OR c.company ILIKE $${i} OR co.name ILIKE $${i})`;
  }
  if (status) {
    params.push(status);
    sql += ` AND c.status = $${params.length}`;
  }
  if (theme) {
    params.push(theme);
    sql += ` AND c.marketing_theme = $${params.length}`;
  }
  if (owner_id) {
    params.push(owner_id);
    sql += ` AND c.owner_id = $${params.length}`;
  }
  if (company_id) {
    params.push(company_id);
    sql += ` AND c.company_id = $${params.length}`;
  }
  sql += ` ORDER BY c.updated_at DESC`;

  const result = await db.query(sql, params);
  res.json({ contacts: result.rows });
});

// GET /api/contacts/themes — distinct marketing themes in this workspace
router.get("/themes", async (req, res) => {
  const result = await db.query(
    `SELECT DISTINCT marketing_theme FROM contacts
     WHERE workspace_id = $1 AND marketing_theme IS NOT NULL AND marketing_theme != ''
     ORDER BY marketing_theme`,
    [req.user.workspace_id]
  );
  res.json({ themes: result.rows.map((r) => r.marketing_theme) });
});

// POST /api/contacts — create
router.post("/", async (req, res) => {
  const { full_name, email, phone, company, marketing_theme, status, notes, owner_id, company_id, title, is_decision_maker } =
    req.body || {};

  if (!full_name || !full_name.trim()) {
    return res.status(400).json({ error: "Full name is required." });
  }

  try {
    await assertWithinLimit(req.user.workspace_id, "contacts");
  } catch (err) {
    if (err instanceof LimitExceededError) return res.status(403).json({ error: err.message, code: "LIMIT_EXCEEDED" });
    throw err;
  }

  const finalStatus = VALID_STATUSES.includes(status) ? status : "lead";

  const result = await db.query(
    `INSERT INTO contacts (workspace_id, full_name, email, phone, company, marketing_theme, status, notes, owner_id, company_id, title, is_decision_maker)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [
      req.user.workspace_id,
      full_name.trim(),
      email?.trim() || null,
      phone?.trim() || null,
      company?.trim() || null,
      marketing_theme?.trim() || null,
      finalStatus,
      notes?.trim() || null,
      owner_id || req.user.id,
      company_id || null,
      title?.trim() || null,
      Boolean(is_decision_maker),
    ]
  );

  const contact = result.rows[0];
  await logActivity(req.user.workspace_id, contact.id, req.user.id, "contact_created", `${req.user.name} added this contact.`);
  res.status(201).json({ contact });
});

// GET /api/contacts/:id — one contact, with activity + offers + quotes + purchases
router.get("/:id", async (req, res) => {
  const cResult = await db.query(
    `SELECT c.*, u.name AS owner_name, co.name AS company_name FROM contacts c
     LEFT JOIN users u ON u.id = c.owner_id
     LEFT JOIN companies co ON co.id = c.company_id
     WHERE c.id = $1 AND c.workspace_id = $2`,
    [req.params.id, req.user.workspace_id]
  );
  const contact = cResult.rows[0];
  if (!contact) return res.status(404).json({ error: "Contact not found." });

  const activity = await db.query(
    `SELECT a.*, u.name AS user_name FROM activity_log a LEFT JOIN users u ON u.id = a.user_id
     WHERE a.contact_id = $1 ORDER BY a.created_at DESC`,
    [contact.id]
  );
  const offers = await db.query(`SELECT * FROM offers WHERE contact_id = $1 ORDER BY created_at DESC`, [contact.id]);
  const quotes = await db.query(`SELECT * FROM quotes WHERE contact_id = $1 ORDER BY created_at DESC`, [contact.id]);
  const purchases = await db.query(
    `SELECT pu.*, p.name AS product_name FROM purchases pu LEFT JOIN products p ON p.id = pu.product_id
     WHERE pu.contact_id = $1 ORDER BY pu.purchased_at DESC`,
    [contact.id]
  );

  res.json({ contact, activity: activity.rows, offers: offers.rows, quotes: quotes.rows, purchases: purchases.rows });
});

// PUT /api/contacts/:id — update
router.put("/:id", async (req, res) => {
  const existingResult = await db.query("SELECT * FROM contacts WHERE id = $1 AND workspace_id = $2", [
    req.params.id,
    req.user.workspace_id,
  ]);
  const existing = existingResult.rows[0];
  if (!existing) return res.status(404).json({ error: "Contact not found." });

  const { full_name, email, phone, company, marketing_theme, status, notes, owner_id, company_id, title, is_decision_maker } =
    req.body || {};
  if (!full_name || !full_name.trim()) {
    return res.status(400).json({ error: "Full name is required." });
  }
  const finalStatus = VALID_STATUSES.includes(status) ? status : existing.status;

  const updated = await db.query(
    `UPDATE contacts SET full_name=$1, email=$2, phone=$3, company=$4, marketing_theme=$5, status=$6, notes=$7, owner_id=$8,
       company_id=$9, title=$10, is_decision_maker=$11, updated_at=now()
     WHERE id = $12 RETURNING *`,
    [
      full_name.trim(),
      email?.trim() || null,
      phone?.trim() || null,
      company?.trim() || null,
      marketing_theme?.trim() || null,
      finalStatus,
      notes?.trim() || null,
      owner_id || existing.owner_id,
      company_id || null,
      title?.trim() || null,
      Boolean(is_decision_maker),
      req.params.id,
    ]
  );

  if (finalStatus !== existing.status) {
    await logActivity(
      req.user.workspace_id,
      req.params.id,
      req.user.id,
      "status_change",
      `${req.user.name} moved this contact from "${existing.status}" to "${finalStatus}".`
    );
  } else {
    await logActivity(req.user.workspace_id, req.params.id, req.user.id, "contact_updated", `${req.user.name} updated this contact's details.`);
  }

  res.json({ contact: updated.rows[0] });
});

// DELETE /api/contacts/:id
router.delete("/:id", async (req, res) => {
  const existing = await db.query("SELECT id FROM contacts WHERE id = $1 AND workspace_id = $2", [
    req.params.id,
    req.user.workspace_id,
  ]);
  if (!existing.rows.length) return res.status(404).json({ error: "Contact not found." });

  await db.query("DELETE FROM contacts WHERE id = $1", [req.params.id]);
  res.json({ ok: true });
});

// POST /api/contacts/:id/offers/generate — draft an email with AI
router.post("/:id/offers/generate", async (req, res) => {
  const cResult = await db.query("SELECT * FROM contacts WHERE id = $1 AND workspace_id = $2", [
    req.params.id,
    req.user.workspace_id,
  ]);
  const contact = cResult.rows[0];
  if (!contact) return res.status(404).json({ error: "Contact not found." });

  try {
    await assertWithinLimit(req.user.workspace_id, "ai_drafts");
  } catch (err) {
    if (err instanceof LimitExceededError) return res.status(403).json({ error: err.message, code: "LIMIT_EXCEEDED" });
    throw err;
  }

  try {
    const { instructions } = req.body || {};
    const draft = await generateOfferEmail(contact, instructions, req.user.name);

    const result = await db.query(
      `INSERT INTO offers (workspace_id, contact_id, created_by, subject, body, ai_generated, status)
       VALUES ($1,$2,$3,$4,$5,TRUE,'draft') RETURNING *`,
      [req.user.workspace_id, contact.id, req.user.id, draft.subject, draft.body]
    );

    await logActivity(req.user.workspace_id, contact.id, req.user.id, "offer_drafted", `${req.user.name} drafted an offer with AI.`);

    res.status(201).json({ offer: result.rows[0] });
  } catch (err) {
    res.status(502).json({ error: err.message || "Could not generate a draft right now." });
  }
});

// POST /api/contacts/:id/activity — manually log a call, meeting, or note.
// This is what makes calls/meetings show up in employee KPI counts, since
// (unlike emails) they don't happen inside the app automatically.
router.post("/:id/activity", async (req, res) => {
  const VALID_TYPES = ["call_logged", "meeting_logged", "note_logged"];
  const contactCheck = await db.query("SELECT id FROM contacts WHERE id = $1 AND workspace_id = $2", [
    req.params.id,
    req.user.workspace_id,
  ]);
  if (!contactCheck.rows.length) return res.status(404).json({ error: "Contact not found." });

  const { type, description } = req.body || {};
  if (!VALID_TYPES.includes(type)) return res.status(400).json({ error: "Pick what kind of activity this was." });
  if (!description || !description.trim()) return res.status(400).json({ error: "Add a short description." });

  await logActivity(req.user.workspace_id, req.params.id, req.user.id, type, description.trim());
  res.status(201).json({ ok: true });
});

module.exports = router;
