// server/routes/companies.js
const express = require("express");
const db = require("../db");
const { requireAuth, requireEditor } = require("../middleware/auth");
const { requirePaidAccess } = require("../middleware/billing");

const router = express.Router();
router.use(requireAuth);
router.use(requirePaidAccess);
const { invalid, optionalId, text } = require("../services/dealWorkspace");
const action = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (e) {
    if (!e.status) console.error("Company:", e.message);
    res
      .status(e.status || 500)
      .json({
        error: e.status ? e.message : "Could not load or save this company.",
      });
  }
};
async function saveCompany(user, id, input) {
  const name = text(input.name, 300, "company name", true),
    industry = text(input.industry || "", 300, "industry"),
    notes = text(input.notes || "", 20000, "notes");
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT id FROM workspaces WHERE id=$1 FOR UPDATE", [
      user.workspace_id,
    ]);
    const previous = id
      ? (
          await client.query(
            "SELECT * FROM companies WHERE id=$1 AND workspace_id=$2",
            [optionalId(id), user.workspace_id],
          )
        ).rows[0]
      : null;
    if (id && !previous) throw invalid("Company not found.", 404);
    const parent = Object.hasOwn(input, "parent_company_id")
      ? optionalId(input.parent_company_id)
      : previous?.parent_company_id || null;
    if (parent) {
      const ancestors = (
        await client.query(
          `WITH RECURSIVE ancestors AS (
        SELECT id,parent_company_id FROM companies WHERE id=$1 AND workspace_id=$2
        UNION SELECT c.id,c.parent_company_id FROM companies c JOIN ancestors a ON c.id=a.parent_company_id WHERE c.workspace_id=$2
      ) SELECT id FROM ancestors`,
          [parent, user.workspace_id],
        )
      ).rows;
      if (!ancestors.length)
        throw invalid("Parent company is not available in this workspace.");
      if (id && ancestors.some((c) => c.id === Number(id)))
        throw invalid(
          "A company cannot be its own parent or belong to one of its subsidiaries.",
        );
    }
    const company = id
      ? (
          await client.query(
            "UPDATE companies SET name=$1,industry=$2,notes=$3,parent_company_id=$4,updated_at=now() WHERE id=$5 AND workspace_id=$6 RETURNING *",
            [
              name,
              industry || null,
              notes || null,
              parent,
              id,
              user.workspace_id,
            ],
          )
        ).rows[0]
      : (
          await client.query(
            "INSERT INTO companies(workspace_id,name,industry,notes,parent_company_id) VALUES($1,$2,$3,$4,$5) RETURNING *",
            [user.workspace_id, name, industry || null, notes || null, parent],
          )
        ).rows[0];
    await client.query("COMMIT");
    return company;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

// GET /api/companies — list, with contact counts
router.get(
  "/",
  action(async (req, res) => {
    const { search } = req.query;
    let sql = `
    SELECT c.*, (SELECT name FROM companies p WHERE p.id=c.parent_company_id AND p.workspace_id=c.workspace_id) AS parent_company_name,
    (SELECT COUNT(*)::int FROM companies ch WHERE ch.parent_company_id=c.id AND ch.workspace_id=c.workspace_id) AS subsidiary_count, COUNT(ct.id) AS contact_count
    FROM companies c
    LEFT JOIN contacts ct ON ct.company_id = c.id AND ct.workspace_id=c.workspace_id
    WHERE c.workspace_id = $1
  `;
    const params = [req.user.workspace_id];
    if (search) {
      params.push(`%${search}%`);
      sql += ` AND c.name ILIKE $${params.length}`;
    }
    sql += ` GROUP BY c.id ORDER BY c.name`;

    const result = await db.query(sql, params);
    res.json({
      companies: result.rows.map((r) => ({
        ...r,
        contact_count: Number(r.contact_count),
      })),
    });
  }),
);

// GET /api/companies/export — download all companies as CSV
router.get(
  "/export",
  action(async (req, res) => {
    const result = await db.query(
      `SELECT c.name, c.industry, c.notes, (SELECT name FROM companies p WHERE p.id=c.parent_company_id AND p.workspace_id=c.workspace_id) AS parent_company_name, COUNT(ct.id) AS contact_count, c.created_at
     FROM companies c
     LEFT JOIN contacts ct ON ct.company_id = c.id AND ct.workspace_id=c.workspace_id
     WHERE c.workspace_id = $1
     GROUP BY c.id
     ORDER BY c.name`,
      [req.user.workspace_id],
    );

    const header = [
      "Company Name",
      "Parent Company",
      "Industry",
      "Contacts",
      "Notes",
      "Created At",
    ];
    const csvRows = [
      header,
      ...result.rows.map((r) =>
        [
          r.name,
          r.parent_company_name,
          r.industry,
          r.contact_count,
          r.notes,
          r.created_at ? new Date(r.created_at).toISOString() : "",
        ].map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`),
      ),
    ];

    res.setHeader("Content-Type", "text/csv");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="companies.csv"',
    );
    res.send(csvRows.map((r) => r.join(",")).join("\n"));
  }),
);

router.post(
  "/",
  requireEditor,
  action(async (req, res) => {
    res
      .status(201)
      .json({ company: await saveCompany(req.user, null, req.body || {}) });
  }),
);

// GET /api/companies/:id — detail + its contacts (decision-makers first)
router.get(
  "/:id",
  action(async (req, res) => {
    const companyResult = await db.query(
      "SELECT * FROM companies WHERE id = $1 AND workspace_id = $2",
      [req.params.id, req.user.workspace_id],
    );
    const company = companyResult.rows[0];
    if (!company) return res.status(404).json({ error: "Company not found." });

    const contactsResult = await db.query(
      `SELECT id, full_name, email, phone, title, is_decision_maker, status
     FROM contacts WHERE company_id = $1 AND workspace_id = $2
     ORDER BY is_decision_maker DESC, full_name`,
      [req.params.id, req.user.workspace_id],
    );

    const parent = company.parent_company_id
      ? (
          await db.query(
            "SELECT id,name FROM companies WHERE id=$1 AND workspace_id=$2",
            [company.parent_company_id, req.user.workspace_id],
          )
        ).rows[0]
      : null;
    const children = (
      await db.query(
        "SELECT id,name,industry FROM companies WHERE parent_company_id=$1 AND workspace_id=$2 ORDER BY name",
        [company.id, req.user.workspace_id],
      )
    ).rows;
    res.json({
      company,
      contacts: contactsResult.rows,
      parent: parent || null,
      children,
    });
  }),
);

router.put(
  "/:id",
  requireEditor,
  action(async (req, res) => {
    res.json({
      company: await saveCompany(req.user, req.params.id, req.body || {}),
    });
  }),
);
// Children and contacts survive deletion; their direct company link is detached.
router.delete(
  "/:id",
  requireEditor,
  action(async (req, res) => {
    const client = await db.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT id FROM workspaces WHERE id=$1 FOR UPDATE", [
        req.user.workspace_id,
      ]);
      const result = await client.query(
        "DELETE FROM companies WHERE id=$1 AND workspace_id=$2 RETURNING id",
        [optionalId(req.params.id), req.user.workspace_id],
      );
      if (!result.rows.length) throw invalid("Company not found.", 404);
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
    res.json({ ok: true });
  }),
);
module.exports = router;
