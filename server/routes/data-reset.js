// server/routes/data-reset.js
// POST /api/settings/reset
// Deletes selected data categories for the caller's workspace.
// "Reset everything" requires the user's current password as proof of intent.

const express = require("express");
const bcrypt = require("bcrypt");
const db = require("../db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

// Map of reset-key → async function that deletes rows for a workspace
const DELETERS = {
  contacts: async (wid, client) => {
    // delete dependent rows first to avoid FK violations
    await client.query("DELETE FROM activity_logs   WHERE workspace_id = $1 AND contact_id IS NOT NULL", [wid]);
    await client.query("DELETE FROM quote_line_items WHERE quote_id IN (SELECT id FROM quotes WHERE workspace_id = $1)", [wid]);
    await client.query("DELETE FROM quotes           WHERE workspace_id = $1", [wid]);
    await client.query("DELETE FROM offers           WHERE workspace_id = $1", [wid]);
    await client.query("DELETE FROM tasks            WHERE workspace_id = $1 AND contact_id IS NOT NULL", [wid]);
    await client.query("DELETE FROM deals            WHERE workspace_id = $1 AND contact_id IS NOT NULL", [wid]);
    await client.query("DELETE FROM contacts         WHERE workspace_id = $1", [wid]);
  },
  companies: async (wid, client) => {
    // null-out company_id in contacts first so FK doesn't block
    await client.query("UPDATE contacts SET company_id = NULL WHERE workspace_id = $1", [wid]);
    await client.query("DELETE FROM companies WHERE workspace_id = $1", [wid]);
  },
  products: async (wid, client) => {
    await client.query("DELETE FROM products WHERE workspace_id = $1", [wid]);
  },
  quotes: async (wid, client) => {
    await client.query("DELETE FROM quote_line_items WHERE quote_id IN (SELECT id FROM quotes WHERE workspace_id = $1)", [wid]);
    await client.query("DELETE FROM quotes WHERE workspace_id = $1", [wid]);
  },
  deals: async (wid, client) => {
    await client.query("DELETE FROM deals WHERE workspace_id = $1", [wid]);
  },
  tasks: async (wid, client) => {
    await client.query("DELETE FROM tasks WHERE workspace_id = $1", [wid]);
  },
  calendar: async (wid, client) => {
    await client.query("DELETE FROM calendar_events WHERE workspace_id = $1", [wid]);
  },
  history: async (wid, client) => {
    await client.query("DELETE FROM activity_logs WHERE workspace_id = $1", [wid]);
  },
};

const VALID_KEYS = Object.keys(DELETERS);

// POST /api/settings/reset
router.post("/reset", requireAuth, async (req, res) => {
  const { items, password, reset_all } = req.body;
  const wid = req.user.workspace_id;

  // Validate items list
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "No items selected to reset." });
  }
  const invalid = items.filter((k) => !VALID_KEYS.includes(k));
  if (invalid.length) {
    return res.status(400).json({ error: `Unknown reset keys: ${invalid.join(", ")}` });
  }

  // If reset_all or items includes contacts, require password confirmation
  const needsPassword = reset_all || items.includes("contacts");
  if (needsPassword) {
    if (!password) {
      return res.status(403).json({ error: "Password required to reset contacts or all data." });
    }
    // look up the user's password hash
    const result = await db.query("SELECT password_hash FROM users WHERE id = $1", [req.user.id]);
    const user = result.rows[0];
    if (!user || !user.password_hash) {
      return res.status(403).json({ error: "Cannot verify password — account uses Google sign-in only. Set a password first in Settings." });
    }
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      return res.status(403).json({ error: "Incorrect password." });
    }
  }

  // Run all deleters in a single transaction
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    const keys = reset_all ? VALID_KEYS : items;
    for (const key of keys) {
      await DELETERS[key](wid, client);
    }
    await client.query("COMMIT");

    // Log the reset in activity (use a raw insert so it doesn't cascade-delete itself)
    try {
      await db.query(
        `INSERT INTO activity_logs (workspace_id, user_id, action_type, description)
         VALUES ($1, $2, 'data_reset', $3)`,
        [wid, req.user.id, `Reset: ${keys.join(", ")}`]
      );
    } catch { /* non-critical */ }

    res.json({ ok: true, reset: keys });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Data reset failed:", err.message);
    res.status(500).json({ error: "Reset failed. No data was deleted." });
  } finally {
    client.release();
  }
});

module.exports = router;
