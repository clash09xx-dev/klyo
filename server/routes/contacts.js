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
  const { search, status, theme, owner_id, company_id, tag } = req.query;

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
    sql += ` AND (c.full_name ILIKE $${i} OR c.email ILIKE $${i} OR c.phone ILIKE $${i} OR c.company ILIKE $${i} OR co.name ILIKE $${i} OR c.city ILIKE $${i} OR c.country ILIKE $${i})`;
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
  if (tag) {
    params.push(tag);
    sql += ` AND $${params.length} = ANY(c.tags)`;
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

// GET /api/contacts/tags — distinct tags used in this workspace
router.get("/tags", async (req, res) => {
  const result = await db.query(
    `SELECT DISTINCT unnest(tags) AS tag FROM contacts
     WHERE workspace_id = $1
     ORDER BY tag`,
    [req.user.workspace_id]
  );
  res.json({ tags: result.rows.map(r => r.tag) });
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
  const {
    first_name, last_name, full_name, email, phone, company, marketing_theme, status, notes,
    owner_id, company_id, title, is_decision_maker,
    tags, secondary_email, secondary_phone, website, linkedin, instagram, facebook, twitter,
    city, country, state, postal_code, address, customer_type, priority, lead_source,
    department, preferred_language, whatsapp, telegram, internal_notes,
  } = req.body || {};

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
  const normalizedTags = Array.isArray(tags) ? tags.map(t => String(t).trim()).filter(Boolean) : [];

  const result = await db.query(
    `INSERT INTO contacts (
       workspace_id, full_name, first_name, last_name, email, phone, company, marketing_theme, status, notes,
       owner_id, company_id, title, is_decision_maker,
       tags, secondary_email, secondary_phone, website, linkedin, instagram, facebook, twitter,
       city, country, state, postal_code, address, customer_type, priority, lead_source,
       department, preferred_language, whatsapp, telegram, internal_notes
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
       $11,$12,$13,$14,
       $15,$16,$17,$18,$19,$20,$21,$22,
       $23,$24,$25,$26,$27,$28,$29,$30,
       $31,$32,$33,$34,$35
     ) RETURNING *`,
    [
      req.user.workspace_id, derivedFullName, firstName||null, lastName||null,
      email?.trim()||null, phone?.trim()||null, company?.trim()||null,
      marketing_theme?.trim()||null, finalStatus, notes?.trim()||null,
      owner_id||req.user.id, company_id||null, title?.trim()||null, Boolean(is_decision_maker),
      normalizedTags,
      secondary_email?.trim()||null, secondary_phone?.trim()||null,
      website?.trim()||null, linkedin?.trim()||null, instagram?.trim()||null,
      facebook?.trim()||null, twitter?.trim()||null,
      city?.trim()||null, country?.trim()||null, state?.trim()||null,
      postal_code?.trim()||null, address?.trim()||null,
      customer_type?.trim()||null, priority?.trim()||"medium", lead_source?.trim()||null,
      department?.trim()||null, preferred_language?.trim()||null,
      whatsapp?.trim()||null, telegram?.trim()||null, internal_notes?.trim()||null,
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

  const {
    first_name, last_name, full_name, email, phone, company, marketing_theme, status, notes,
    owner_id, company_id, title, is_decision_maker,
    tags, secondary_email, secondary_phone, website, linkedin, instagram, facebook, twitter,
    city, country, state, postal_code, address, customer_type, priority, lead_source,
    department, preferred_language, whatsapp, telegram, internal_notes,
  } = req.body || {};

  const derivedFullName = buildFullName(first_name, last_name, full_name);
  if (!derivedFullName) {
    return res.status(400).json({ error: "First name is required." });
  }
  const finalStatus = VALID_STATUSES.includes(status) ? status : existing.status;
  const firstName = (first_name || "").trim() || derivedFullName.split(" ")[0];
  const lastName = (last_name || "").trim() || (derivedFullName.includes(" ") ? derivedFullName.split(" ").slice(1).join(" ") : null);
  const normalizedTags = Array.isArray(tags) ? tags.map(t => String(t).trim()).filter(Boolean) : (existing.tags || []);

  const updated = await db.query(
    `UPDATE contacts SET
       full_name=$1, first_name=$2, last_name=$3, email=$4, phone=$5, company=$6,
       marketing_theme=$7, status=$8, notes=$9, owner_id=$10, company_id=$11,
       title=$12, is_decision_maker=$13,
       tags=$14, secondary_email=$15, secondary_phone=$16, website=$17, linkedin=$18,
       instagram=$19, facebook=$20, twitter=$21,
       city=$22, country=$23, state=$24, postal_code=$25, address=$26,
       customer_type=$27, priority=$28, lead_source=$29,
       department=$30, preferred_language=$31, whatsapp=$32, telegram=$33, internal_notes=$34,
       updated_at=now()
     WHERE id=$35 RETURNING *`,
    [
      derivedFullName, firstName||null, lastName||null,
      email?.trim()||null, phone?.trim()||null, company?.trim()||null,
      marketing_theme?.trim()||null, finalStatus, notes?.trim()||null,
      owner_id||existing.owner_id, company_id||null,
      title?.trim()||null, Boolean(is_decision_maker),
      normalizedTags,
      secondary_email?.trim()||null, secondary_phone?.trim()||null,
      website?.trim()||null, linkedin?.trim()||null,
      instagram?.trim()||null, facebook?.trim()||null, twitter?.trim()||null,
      city?.trim()||null, country?.trim()||null, state?.trim()||null,
      postal_code?.trim()||null, address?.trim()||null,
      customer_type?.trim()||null, priority?.trim()||existing.priority||"medium",
      lead_source?.trim()||null,
      department?.trim()||null, preferred_language?.trim()||null,
      whatsapp?.trim()||null, telegram?.trim()||null, internal_notes?.trim()||null,
      req.params.id,
    ]
  );

  if (finalStatus !== existing.status) {
    await logActivity(req.user.workspace_id, req.params.id, req.user.id, "status_change",
      `${req.user.name} moved this contact from "${existing.status}" to "${finalStatus}".`);
  } else {
    await logActivity(req.user.workspace_id, req.params.id, req.user.id, "contact_updated",
      `${req.user.name} updated this contact's details.`);
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

// POST /api/contacts/import — bulk import from CSV/TSV text body
// Accepts column names from any major CRM — see COLUMN_ALIASES below.
// Processes up to 50 000 rows; uses batch inserts of 500 rows at a time.
router.post("/import", async (req, res) => {
  const { csv } = req.body || {};
  if (!csv || typeof csv !== "string") return res.status(400).json({ error: "Send { csv: '...' } in the request body." });

  const lines = csv.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return res.status(400).json({ error: "CSV must have a header row and at least one data row." });

  // Auto-detect delimiter: semicolon, tab, or comma
  const firstLine = lines[0];
  const delim = (firstLine.split(";").length > firstLine.split(",").length)
    ? ";"
    : (firstLine.split("\t").length > firstLine.split(",").length ? "\t" : ",");

  // Parse one CSV/TSV line respecting quoted fields
  function parseLine(line) {
    const result = [];
    let cur = "";
    let inQuote = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuote && line[i + 1] === '"') { cur += '"'; i++; }
        else inQuote = !inQuote;
        continue;
      }
      if (ch === delim && !inQuote) { result.push(cur.trim()); cur = ""; continue; }
      cur += ch;
    }
    result.push(cur.trim());
    return result;
  }

  // Transliterate diacritics → ASCII so Polish/DE/FR headers survive stripping
  function transliterate(str) {
    return str
      .replace(/[àáâãäå]/g, "a").replace(/[ą]/g, "a")
      .replace(/[èéêë]/g, "e").replace(/[ę]/g, "e")
      .replace(/[ìíîï]/g, "i")
      .replace(/[òóôõöø]/g, "o").replace(/[ó]/g, "o")
      .replace(/[ùúûü]/g, "u")
      .replace(/[ýÿ]/g, "y")
      .replace(/[ñń]/g, "n")
      .replace(/[çć]/g, "c")
      .replace(/[ß]/g, "ss")
      .replace(/[łl]/g, "l")
      .replace(/[śšş]/g, "s")
      .replace(/[źżžz]/g, "z")
      .replace(/[ð]/g, "d")
      .replace(/[þ]/g, "th");
  }

  const COLUMN_ALIASES = {
    // full name
    name: "full_name", contact: "full_name", contact_name: "full_name",
    full_name: "full_name", fullname: "full_name", display_name: "full_name",
    // first name
    first_name: "first_name", firstname: "first_name", given_name: "first_name", forename: "first_name",
    // last name
    last_name: "last_name", lastname: "last_name", surname: "last_name", family_name: "last_name",
    // email
    email: "email", email_address: "email", e_mail: "email", mail: "email", primary_email: "email",
    secondary_email: "secondary_email", email2: "secondary_email", other_email: "secondary_email",
    // phone
    phone: "phone", phone_number: "phone", mobile: "phone", mobile_phone: "phone",
    telephone: "phone", tel: "phone", cell: "phone", cell_phone: "phone", primary_phone: "phone",
    secondary_phone: "secondary_phone", phone2: "secondary_phone", other_phone: "secondary_phone",
    // company
    company: "company", company_name: "company", organization: "company", organisation: "company",
    account: "company", account_name: "company", employer: "company",
    // job
    title: "title", job_title: "title", position: "title", role: "title",
    department: "department", dept: "department",
    // notes
    notes: "notes", note: "notes", description: "notes", comments: "notes", comment: "notes",
    internal_notes: "internal_notes",
    // status
    status: "status", lead_status: "status", contact_status: "status", stage: "status", lifecycle_stage: "status",
    // tags
    tags: "tags", labels: "tags", tag: "tags", categories: "tags",
    // web / social
    website: "website", url: "website", web: "website", homepage: "website",
    linkedin: "linkedin", linkedin_url: "linkedin",
    twitter: "twitter", x_twitter: "twitter",
    facebook: "facebook", instagram: "instagram",
    // address
    city: "city", town: "city",
    country: "country",
    state: "state", province: "state", region: "state",
    postal_code: "postal_code", zip: "postal_code", zip_code: "postal_code", postcode: "postal_code",
    address: "address", street: "address", street_address: "address",
    // classification
    customer_type: "customer_type", type: "customer_type", contact_type: "customer_type",
    priority: "priority",
    lead_source: "lead_source", source: "lead_source",
    // language
    language: "preferred_language", preferred_language: "preferred_language",
    // messaging
    whatsapp: "whatsapp", whatsapp_number: "whatsapp",
    telegram: "telegram",

    // ----- Polish -----
    imie_i_nazwisko: "full_name", imie_nazwisko: "full_name", pelne_imie: "full_name",
    osoba: "full_name", kontakt: "full_name", nazwa_kontaktu: "full_name", klient: "full_name",
    imie: "first_name",
    nazwisko: "last_name",
    adres_email: "email", adres_e_mail: "email", e_mail_adres: "email", poczta: "email",
    email_dodatkowy: "secondary_email",
    telefon: "phone", numer_telefonu: "phone", telefon_komorkowy: "phone", komorka: "phone",
    nr_telefonu: "phone", tel_komorkowy: "phone",
    telefon_dodatkowy: "secondary_phone",
    firma: "company", organizacja: "company", przedsiebiorstwo: "company", pracodawca: "company",
    nazwa_firmy: "company",
    stanowisko: "title", tytul: "title", pozycja: "title",
    dzial: "department",
    notatki: "notes", notatka: "notes", uwagi: "notes", opis: "notes",
    etap: "status", faza: "status",
    tagi: "tags", kategorie: "tags", etykiety: "tags",
    strona: "website", strona_www: "website",
    miasto: "city", kraj: "country", stan: "state", kod_pocztowy: "postal_code",
    adres_ulica: "address",
    typ_klienta: "customer_type",
    priorytet: "priority",
    zrodlo: "lead_source", zrodlo_leada: "lead_source",
  };

  function normalizeHeader(h) {
    const key = transliterate(h.toLowerCase().trim())
      .replace(/\s+/g, "_")
      .replace(/[^a-z0-9_]/g, "")
      .replace(/_+/g, "_")
      .replace(/^_|_$/g, "");
    return COLUMN_ALIASES[key] || key;
  }

  const rawHeaders = parseLine(lines[0]);
  const fieldIndex = {};
  rawHeaders.forEach((h, i) => {
    const field = normalizeHeader(h);
    if (!(field in fieldIndex)) fieldIndex[field] = i;
  });

  const hasName = "full_name" in fieldIndex || "first_name" in fieldIndex || "last_name" in fieldIndex;
  if (!hasName && rawHeaders.length > 0) {
    return res.status(400).json({
      error: `No name column found. Detected: ${rawHeaders.join(", ")}. Expected: "Name", "First Name", "Last Name", "Imię", "Nazwisko".`,
      detected_headers: rawHeaders,
    });
  }

  const get = (row, field) => (fieldIndex[field] !== undefined ? (row[fieldIndex[field]] || "").trim() : "");

  const VALID_STATUSES_SET = new Set(["lead", "contacted", "negotiating", "customer", "lost"]);
  const VALID_PRIORITIES   = new Set(["low", "medium", "high"]);
  const VALID_TYPES        = new Set(["lead", "prospect", "customer", "partner", "supplier"]);

  let imported = 0;
  let skipped  = 0;
  const errors = [];

  // Batch inserts — 500 rows per INSERT statement for speed
  const BATCH = 500;
  const dataRows = lines.slice(1);

  for (let batchStart = 0; batchStart < dataRows.length; batchStart += BATCH) {
    const batchLines = dataRows.slice(batchStart, batchStart + BATCH);
    const values = [];
    const placeholders = [];
    let p = 1;

    for (let bi = 0; bi < batchLines.length; bi++) {
      const rowNum = batchStart + bi + 2; // human row number (1-based, skipping header)
      const row = parseLine(batchLines[bi]);
      if (row.every(c => !c)) continue;

      const firstName = get(row, "first_name");
      const lastName  = get(row, "last_name");
      const fullName  = get(row, "full_name") || [firstName, lastName].filter(Boolean).join(" ");

      if (!fullName) { skipped++; errors.push(`Row ${rowNum}: no name — skipped`); continue; }

      let status = get(row, "status").toLowerCase() || "lead";
      if (!VALID_STATUSES_SET.has(status)) status = "lead";

      let priority = get(row, "priority").toLowerCase() || "medium";
      if (!VALID_PRIORITIES.has(priority)) priority = "medium";

      let customerType = get(row, "customer_type").toLowerCase() || null;
      if (customerType && !VALID_TYPES.has(customerType)) customerType = null;

      // Tags: split on comma, semicolon, or pipe; trim each; dedupe
      const rawTags = get(row, "tags");
      const tags = rawTags
        ? [...new Set(rawTags.split(/[,;|]/).map(t => t.trim()).filter(Boolean))]
        : [];

      placeholders.push(`($${p},$${p+1},$${p+2},$${p+3},$${p+4},$${p+5},$${p+6},$${p+7},$${p+8},$${p+9},$${p+10},$${p+11},$${p+12},$${p+13},$${p+14},$${p+15},$${p+16},$${p+17},$${p+18},$${p+19},$${p+20},$${p+21},$${p+22})`);
      p += 23;

      values.push(
        req.user.workspace_id,          // 1
        fullName,                        // 2
        firstName || null,               // 3
        lastName  || null,               // 4
        get(row, "email")       || null, // 5
        get(row, "phone")       || null, // 6
        get(row, "company")     || null, // 7
        get(row, "notes")       || null, // 8
        status,                          // 9
        get(row, "title")       || null, // 10
        get(row, "secondary_email")  || null, // 11
        get(row, "secondary_phone")  || null, // 12
        get(row, "website")     || null, // 13
        get(row, "linkedin")    || null, // 14
        get(row, "city")        || null, // 15
        get(row, "country")     || null, // 16
        get(row, "state")       || null, // 17
        get(row, "postal_code") || null, // 18
        get(row, "address")     || null, // 19
        customerType,                    // 20
        priority,                        // 21
        get(row, "lead_source") || null, // 22
        tags,                            // 23  TEXT[]
      );
      imported++;
    }

    if (placeholders.length === 0) continue;

    try {
      await db.query(
        `INSERT INTO contacts (
          workspace_id, full_name, first_name, last_name, email, phone, company, notes, status,
          title, secondary_email, secondary_phone, website, linkedin,
          city, country, state, postal_code, address,
          customer_type, priority, lead_source, tags
        ) VALUES ${placeholders.join(",")}
        ON CONFLICT DO NOTHING`,
        values
      );
    } catch (err) {
      // If batch fails, fall back to row-by-row for this batch to count precise errors
      imported -= placeholders.length; // undo the pre-count
      for (let bi2 = 0; bi2 < batchLines.length; bi2++) {
        const rowNum = batchStart + bi2 + 2;
        const row = parseLine(batchLines[bi2]);
        if (row.every(c => !c)) continue;
        const firstName = get(row, "first_name");
        const lastName  = get(row, "last_name");
        const fullName  = get(row, "full_name") || [firstName, lastName].filter(Boolean).join(" ");
        if (!fullName) continue;
        try {
          let status = get(row, "status").toLowerCase() || "lead";
          if (!VALID_STATUSES_SET.has(status)) status = "lead";
          const rawTags = get(row, "tags");
          const tags = rawTags ? [...new Set(rawTags.split(/[,;|]/).map(t=>t.trim()).filter(Boolean))] : [];
          await db.query(
            `INSERT INTO contacts (workspace_id, full_name, first_name, last_name, email, phone, company, notes, status, title, tags)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
            [req.user.workspace_id, fullName, firstName||null, lastName||null,
             get(row,"email")||null, get(row,"phone")||null, get(row,"company")||null,
             get(row,"notes")||null, status, get(row,"title")||null, tags]
          );
          imported++;
        } catch (rowErr) {
          skipped++;
          errors.push(`Row ${rowNum}: ${rowErr.message}`);
        }
      }
    }
  }

  res.json({ imported, skipped, errors: errors.slice(0, 20) });
});

module.exports = router;
