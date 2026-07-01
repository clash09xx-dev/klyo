// server/routes/offers.js
const express = require("express");
const db = require("../db");
const { requireAuth } = require("../middleware/auth");
const { requirePaidAccess } = require("../middleware/billing");
const { sendOfferEmail } = require("../services/mailer");

const router = express.Router();
router.use(requireAuth);
router.use(requirePaidAccess);

// PUT /api/offers/:id — edit a draft's subject/body before sending
router.put("/:id", async (req, res) => {
  const result = await db.query("SELECT * FROM offers WHERE id = $1 AND workspace_id = $2", [
    req.params.id,
    req.user.workspace_id,
  ]);
  const offer = result.rows[0];
  if (!offer) return res.status(404).json({ error: "Draft not found." });
  if (offer.status === "sent") {
    return res.status(400).json({ error: "This offer was already sent and can't be edited." });
  }

  const { subject, body } = req.body || {};
  const updated = await db.query("UPDATE offers SET subject = $1, body = $2 WHERE id = $3 RETURNING *", [
    subject ?? offer.subject,
    body ?? offer.body,
    req.params.id,
  ]);
  res.json({ offer: updated.rows[0] });
});

// POST /api/offers/:id/send — actually email the contact
router.post("/:id/send", async (req, res) => {
  const result = await db.query("SELECT * FROM offers WHERE id = $1 AND workspace_id = $2", [
    req.params.id,
    req.user.workspace_id,
  ]);
  const offer = result.rows[0];
  if (!offer) return res.status(404).json({ error: "Draft not found." });
  if (offer.status === "sent") {
    return res.status(400).json({ error: "This offer was already sent." });
  }

  const contactResult = await db.query("SELECT * FROM contacts WHERE id = $1 AND workspace_id = $2", [
    offer.contact_id,
    req.user.workspace_id,
  ]);
  const contact = contactResult.rows[0];
  if (!contact) return res.status(404).json({ error: "Contact not found." });

  const subject = (req.body && req.body.subject) ?? offer.subject;
  const body = (req.body && req.body.body) ?? offer.body;

  try {
    const wsResult = await db.query(
      "SELECT gmail_refresh_token, smtp_host, smtp_port, smtp_user, smtp_pass, smtp_from_name, smtp_from_email, smtp_secure FROM workspaces WHERE id = $1",
      [req.user.workspace_id]
    );
    await sendOfferEmail(contact.email, subject, body, wsResult.rows[0]);

    const updated = await db.query(
      "UPDATE offers SET subject = $1, body = $2, status = 'sent', sent_at = now() WHERE id = $3 RETURNING *",
      [subject, body, offer.id]
    );

    await db.query(
      "INSERT INTO activity_log (workspace_id, contact_id, user_id, type, description) VALUES ($1, $2, $3, $4, $5)",
      [req.user.workspace_id, contact.id, req.user.id, "offer_sent", `${req.user.name} sent the offer "${subject}" to ${contact.email}.`]
    );

    res.json({ offer: updated.rows[0] });
  } catch (err) {
    res.status(502).json({ error: err.message || "Could not send the email right now." });
  }
});

module.exports = router;
