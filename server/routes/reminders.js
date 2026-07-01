// server/routes/reminders.js
// ---------------------------------------------------------
// Surfaces purchases that are due (or overdue) for a recurring
// service — e.g. a product with a 12-month calibration interval
// purchased a year ago — and sends the reminder email. Building a
// fresh quote to go with the reminder reuses the normal quote
// builder (pre-filled from the frontend), rather than duplicating
// that logic here.
// ---------------------------------------------------------
const express = require("express");
const db = require("../db");
const { requireAuth } = require("../middleware/auth");
const { requirePaidAccess } = require("../middleware/billing");
const { sendOfferEmail } = require("../services/mailer");

const router = express.Router();
router.use(requireAuth);
router.use(requirePaidAccess);

// GET /api/reminders/due — anything due for service that hasn't been reminded yet
router.get("/due", async (req, res) => {
  const result = await db.query(
    `SELECT pu.*, c.full_name AS contact_name, c.email AS contact_email,
            p.name AS product_name, p.service_interval_months
     FROM purchases pu
     JOIN contacts c ON c.id = pu.contact_id
     LEFT JOIN products p ON p.id = pu.product_id
     WHERE pu.workspace_id = $1
       AND pu.next_service_due_at IS NOT NULL
       AND pu.next_service_due_at <= now()
       AND pu.reminder_sent_at IS NULL
     ORDER BY pu.next_service_due_at ASC`,
    [req.user.workspace_id]
  );
  res.json({ reminders: result.rows });
});

// POST /api/reminders/:purchaseId/send
router.post("/:purchaseId/send", async (req, res) => {
  const result = await db.query(
    `SELECT pu.*, c.full_name AS contact_name, c.email AS contact_email, p.name AS product_name
     FROM purchases pu
     JOIN contacts c ON c.id = pu.contact_id
     LEFT JOIN products p ON p.id = pu.product_id
     WHERE pu.id = $1 AND pu.workspace_id = $2`,
    [req.params.purchaseId, req.user.workspace_id]
  );
  const purchase = result.rows[0];
  if (!purchase) return res.status(404).json({ error: "Reminder not found." });
  if (!purchase.contact_email) return res.status(400).json({ error: "This contact has no email address on file." });

  const purchasedDate = new Date(purchase.purchased_at).toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const subject = `Time for your ${purchase.product_name || "service"} check-up`;
  const body = [
    `Hi ${purchase.contact_name.split(" ")[0]},`,
    "",
    `You purchased ${purchase.product_name || "this item"} from us back in ${purchasedDate}. As part of the regular maintenance schedule, it's now due for calibration and inspection.`,
    "",
    "Let us know a good time and we'll get it scheduled — happy to send over an updated quote if anything needs replacing.",
  ].join("\n");

  try {
    const wsResult = await db.query("SELECT gmail_refresh_token, smtp_host, smtp_port, smtp_user, smtp_pass, smtp_from_name, smtp_from_email, smtp_secure FROM workspaces WHERE id = $1", [req.user.workspace_id]);
    await sendOfferEmail(purchase.contact_email, subject, body, wsResult.rows[0]);

    await db.query("UPDATE purchases SET reminder_sent_at = now() WHERE id = $1", [purchase.id]);
    await db.query(
      "INSERT INTO activity_log (workspace_id, contact_id, user_id, type, description) VALUES ($1,$2,$3,$4,$5)",
      [req.user.workspace_id, purchase.contact_id, req.user.id, "reminder_sent", `${req.user.name} sent a maintenance reminder for ${purchase.product_name || "a purchase"}.`]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(502).json({ error: err.message || "Could not send the reminder right now." });
  }
});

module.exports = router;
