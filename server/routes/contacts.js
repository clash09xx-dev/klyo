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

// GET /api/contacts/export — download all contacts as CSV
router.get("/export", async (req, res) => {
  const result = await db.query(
    `SELECT c.first_name, c.last_name, c.full_name, c.email, c.phone, c.title,
            c.status, c.marketing_theme, c.notes, c.is_decision_maker,
            co.name AS company_name, u.name AS owner_name, c.created_at
     FROM contacts c
     LEFT JOIN companies co ON co.id = c.company_id
     LEFT JOIN users u ON u.id = c.owner_id
     WHERE c.workspace_id = $1
     ORDER BY c.last_name, c.first_name`,
    [req.user.workspace_id]
  );

  const header = ["First Name","Last Name","Full Name","Email","Phone","Title","Company","Status","Marketing Theme","Decision Maker","Owner","Notes","Created At"];
  const csvRows = [header, ...result.rows.map((r) => [
    r.first_name, r.last_name, r.full_name, r.email, r.phone, r.title,
    r.company_name, r.status, r.marketing_theme,
    r.is_decision_maker ? "Yes" : "No",
    r.owner_name, r.notes,
    r.created_at ? new Date(r.created_at).toISOString() : "",
  ].map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`))];

  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", 'attachment; filename="contacts.csv"');
  res.send(csvRows.map((r) => r.join(",")).join("\n"));
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

// Helper: derive full_name from first/last, or fall back to legacy full_name field
function buildFullName(first, last, fallback) {
  const f = (first || "").trim();
  const l = (last || "").trim();
  if (f || l) return [f, l].filter(Boolean).join(" ");
  return (fallback || "").trim();
}

// POST /api/contacts — create
router.post("/", async (req, res) => {
  const { first_name, last_name, full_name, email, phone, company, marketing_theme, status, notes, owner_id, company_id, title, is_decision_maker } =
    req.body || {};

  const derivedFullName = buildFullName(first_name, last_name, full_name);
  if (!derivedFullName) {
    return res.status(400).json({ error: "First name is required." });
  }

  try {
    await assertWithinLimit(req.user.workspace_id, "contacts");
  } catch (err) {
    if (err instanceof LimitExceededError) return res.status(403).json({ error: err.message, code: "LIMIT_EXCEEDED" });
    throw err;
  }

  const finalStatus = VALID_STATUSES.includes(status) ? status : "lead";
  const firstName = (first_name || "").trim() || derivedFullName.split(" ")[0];
  const lastName = (last_name || "").trim() || (derivedFullName.includes(" ") ? derivedFullName.split(" ").slice(1).join(" ") : null);

  const result = await db.query(
    `INSERT INTO contacts (workspace_id, full_name, first_name, last_name, email, phone, company, marketing_theme, status, notes, owner_id, company_id, title, is_decision_maker)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
    [
      req.user.workspace_id,
      derivedFullName,
      firstName || null,
      lastName || null,
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

  const { first_name, last_name, full_name, email, phone, company, marketing_theme, status, notes, owner_id, company_id, title, is_decision_maker } =
    req.body || {};

  const derivedFullName = buildFullName(first_name, last_name, full_name);
  if (!derivedFullName) {
    return res.status(400).json({ error: "First name is required." });
  }
  const finalStatus = VALID_STATUSES.includes(status) ? status : existing.status;
  const firstName = (first_name || "").trim() || derivedFullName.split(" ")[0];
  const lastName = (last_name || "").trim() || (derivedFullName.includes(" ") ? derivedFullName.split(" ").slice(1).join(" ") : null);

  const updated = await db.query(
    `UPDATE contacts SET full_name=$1, first_name=$2, last_name=$3, email=$4, phone=$5, company=$6, marketing_theme=$7, status=$8, notes=$9, owner_id=$10,
       company_id=$11, title=$12, is_decision_maker=$13, updated_at=now()
     WHERE id = $14 RETURNING *`,
    [
      derivedFullName,
      firstName || null,
      lastName || null,
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
    const wsResult = await db.query("SELECT ai_context FROM workspaces WHERE id = $1", [req.user.workspace_id]);
    const aiContext = wsResult.rows[0]?.ai_context || null;
    const draft = await generateOfferEmail(contact, instructions, req.user.name, aiContext);

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

// GET /api/contacts/:id/timeline — unified communication + activity timeline
router.get("/:id/timeline", async (req, res) => {
  const { id } = req.params;
  const wid = req.user.workspace_id;

  // Verify contact belongs to workspace
  const check = await db.query("SELECT id FROM contacts WHERE id = $1 AND workspace_id = $2", [id, wid]);
  if (!check.rows.length) return res.status(404).json({ error: "Contact not found." });

  // Activity log entries
  const acts = await db.query(
    `SELECT al.id, al.type, al.description, al.created_at, u.name AS actor
     FROM activity_log al
     LEFT JOIN users u ON u.id = al.user_id
     WHERE al.contact_id = $1 AND al.workspace_id = $2
     ORDER BY al.created_at DESC LIMIT 50`,
    [id, wid]
  );

  // Offers sent to this contact
  const offers = await db.query(
    `SELECT o.id, o.subject, o.status, o.sent_at, o.created_at, u.name AS actor
     FROM offers o
     LEFT JOIN users u ON u.id = o.created_by
     WHERE o.contact_id = $1 AND o.workspace_id = $2
     ORDER BY o.created_at DESC LIMIT 20`,
    [id, wid]
  );

  // Quotes for this contact
  const quotes = await db.query(
    `SELECT q.id, q.title, q.status, q.total, q.currency, q.sent_at, q.accepted_at, q.created_at, u.name AS actor
     FROM quotes q
     LEFT JOIN users u ON u.id = q.created_by
     WHERE q.contact_id = $1 AND q.workspace_id = $2
     ORDER BY q.created_at DESC LIMIT 20`,
    [id, wid]
  );

  // Deals linked to this contact
  const deals = await db.query(
    `SELECT d.id, d.title, d.status, d.value, d.currency, d.created_at, u.name AS actor
     FROM deals d
     LEFT JOIN users u ON u.id = d.assigned_to
     WHERE d.contact_id = $1 AND d.workspace_id = $2
     ORDER BY d.created_at DESC LIMIT 10`,
    [id, wid]
  );

  // Merge and sort all events by date descending
  const events = [
    ...acts.rows.map(r => ({ kind: "activity", date: r.created_at, actor: r.actor, type: r.type, description: r.description, ref_id: r.id })),
    ...offers.rows.map(r => ({ kind: "offer", date: r.sent_at || r.created_at, actor: r.actor, subject: r.subject, status: r.status, ref_id: r.id })),
    ...quotes.rows.map(r => ({ kind: "quote", date: r.sent_at || r.created_at, actor: r.actor, title: r.title, status: r.status, total: r.total, currency: r.currency, ref_id: r.id })),
    ...deals.rows.map(r => ({ kind: "deal", date: r.created_at, actor: r.actor, title: r.title, status: r.status, value: r.value, currency: r.currency, ref_id: r.id })),
  ].sort((a, b) => new Date(b.date) - new Date(a.date));

  res.json({ events });
});

// POST /api/contacts/import — bulk import from CSV text body
// Expects JSON: { csv: "...raw csv string..." }
// Columns (first row = headers, case-insensitive):
//   first_name, last_name, full_name, email, phone, company, status, notes, marketing_theme
router.post("/import", async (req, res) => {
  const { csv } = req.body || {};
  if (!csv || typeof csv !== "string") return res.status(400).json({ error: "Send { csv: '...' } in the request body." });

  const lines = csv.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return res.status(400).json({ error: "CSV must have a header row and at least one data row." });

  // Parse simple CSV (handles quoted fields with commas)
  function parseCSVLine(line) {
    const result = [];
    let cur = "";
    let inQuote = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { inQuote = !inQuote; continue; }
      if (ch === "," && !inQuote) { result.push(cur.trim()); cur = ""; continue; }
      cur += ch;
    }
    result.push(cur.trim());
    return result;
  }

  const headers = parseCSVLine(lines[0]).map(h => h.toLowerCase().replace(/\s+/g, "_"));
  const col = (name) => headers.indexOf(name);

  const VALID_STATUSES = ["lead", "contacted", "negotiating", "customer", "lost"];
  let imported = 0;
  let skipped  = 0;
  const errors = [];

  for (let i = 1; i < lines.length; i++) {
    const row = parseCSVLine(lines[i]);
    try {
      const firstName = col("first_name") >= 0 ? row[col("first_name")] || "" : "";
      const lastName  = col("last_name")  >= 0 ? row[col("last_name")]  || "" : "";
      let fullName    = col("full_name")  >= 0 ? row[col("full_name")]  || "" : "";
      if (!fullName) {
        fullName = [firstName, lastName].filter(Boolean).join(" ");
      }
      if (!fullName) { skipped++; errors.push(`Row ${i + 1}: no name — skipped`); continue; }

      const email  = col("email")  >= 0 ? row[col("email")]  || null : null;
      const phone  = col("phone")  >= 0 ? row[col("phone")]  || null : null;
      const company = col("company") >= 0 ? row[col("company")] || null : null;
      const notes  = col("notes")  >= 0 ? row[col("notes")]  || null : null;
      const theme  = col("marketing_theme") >= 0 ? row[col("marketing_theme")] || null : null;
      let status   = col("status") >= 0 ? row[col("status")] || "lead" : "lead";
      if (!VALID_STATUSES.includes(status)) status = "lead";

      await db.query(
        `INSERT INTO contacts (workspace_id, full_name, first_name, last_name, email, phone, company, notes, marketing_theme, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT DO NOTHING`,
        [req.user.workspace_id, fullName, firstName || null, lastName || null, email, phone, company, notes, theme, status]
      );
      imported++;
    } catch (err) {
      skipped++;
      errors.push(`Row ${i + 1}: ${err.message}`);
    }
  }

  res.json({ imported, skipped, errors: errors.slice(0, 10) });
});

module.exports = router;
