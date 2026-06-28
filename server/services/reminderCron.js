// server/services/reminderCron.js
// Checks every minute for tasks whose reminder_at has passed and sends
// WhatsApp reminders to the assigned user (if they have a whatsapp_phone).

const db = require("../db");
const { sendWhatsApp } = require("./whatsapp");

async function runReminderCheck() {
  try {
    // Find tasks due for reminders that haven't been sent yet
    const result = await db.query(`
      SELECT t.id, t.title, t.description, t.due_date, t.reminder_at,
             u.name AS user_name, u.whatsapp_phone
      FROM tasks t
      JOIN users u ON u.id = t.assigned_to
      WHERE t.reminder_at IS NOT NULL
        AND t.reminder_at <= now()
        AND t.reminder_sent_at IS NULL
        AND t.status != 'done'
        AND u.whatsapp_phone IS NOT NULL
      LIMIT 50
    `);

    for (const task of result.rows) {
      const dueStr = task.due_date
        ? ` (due ${new Date(task.due_date).toLocaleDateString()})`
        : "";
      const msg = `🔔 Klyo reminder: "${task.title}"${dueStr}`;
      try {
        await sendWhatsApp(task.whatsapp_phone, msg);
        await db.query(
          "UPDATE tasks SET reminder_sent_at = now() WHERE id = $1",
          [task.id]
        );
      } catch (err) {
        console.error(`[ReminderCron] Failed to send reminder for task ${task.id}:`, err.message);
      }
    }
  } catch (err) {
    console.error("[ReminderCron] Error during reminder check:", err.message);
  }
}

function start() {
  // Run immediately, then every 60 seconds
  runReminderCheck();
  setInterval(runReminderCheck, 60 * 1000);
  console.log("[ReminderCron] Task reminder scheduler started.");
}

module.exports = { start };
