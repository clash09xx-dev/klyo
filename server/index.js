// server/index.js
// ---------------------------------------------------------
// Klyo server. Serves the API under /api/* and the front-end
// (everything in /public) as static files — one Node process,
// ideal for Railway.
// ---------------------------------------------------------
require("dotenv").config();
const path = require("path");
const express = require("express");
const cors = require("cors");

if (!process.env.JWT_SECRET) {
  console.error(
    "\n[Klyo] Missing JWT_SECRET in your .env file. Copy .env.example to .env and set it before starting.\n"
  );
  process.exit(1);
}

const db = require("./db");
const authRoutes = require("./routes/auth");
const contactRoutes = require("./routes/contacts");
const offerRoutes = require("./routes/offers");
const statsRoutes = require("./routes/stats");
const billingRoutes = require("./routes/billing");
const integrationsRoutes = require("./routes/integrations");
const companiesRoutes = require("./routes/companies");
const productsRoutes = require("./routes/products");
const quotesRoutes = require("./routes/quotes");
const discountsRoutes = require("./routes/discounts");
const remindersRoutes = require("./routes/reminders");
const teamStatsRoutes = require("./routes/team-stats");
const platformRoutes = require("./routes/platform");
const trackingRoutes = require("./routes/tracking");
const historyRoutes = require("./routes/history");
const dealsRoutes = require("./routes/deals");
const tasksRoutes = require("./routes/tasks");
const calendarRoutes = require("./routes/calendar");
const clientsRoutes = require("./routes/clients");

const app = express();
app.use(cors());

// Stripe's webhook signature check needs the exact raw request bytes,
// so this one path must be excluded from JSON parsing below. Order
// matters: this has to be registered before express.json().
app.use("/api/billing/webhook", express.raw({ type: "application/json" }));
app.use(express.json({ limit: "1mb" }));

app.use("/api/auth", authRoutes);
app.use("/api/contacts", contactRoutes);
app.use("/api/offers", offerRoutes);
app.use("/api/stats", statsRoutes);
app.use("/api/billing", billingRoutes);
app.use("/api/integrations", integrationsRoutes);
app.use("/api/companies", companiesRoutes);
app.use("/api/products", productsRoutes);
app.use("/api/quotes", quotesRoutes);
app.use("/api/discounts", discountsRoutes);
app.use("/api/reminders", remindersRoutes);
app.use("/api/team-stats", teamStatsRoutes);
app.use("/api/platform", platformRoutes);
app.use("/api/history", historyRoutes);
app.use("/api/deals", dealsRoutes);
app.use("/api/tasks", tasksRoutes);
app.use("/api/calendar", calendarRoutes);
app.use("/api/clients", clientsRoutes);
app.use("/api", trackingRoutes);

app.get("/api/health", (req, res) => res.json({ ok: true }));

// --- Public quote view (no auth required) ---
const { renderQuoteHTML } = require("./services/quoteRenderer");
app.get("/q/:token", async (req, res) => {
  try {
    const db = require("./db");
    const result = await db.query(
      `SELECT q.*, c.full_name AS contact_name, c.email AS contact_email,
              co.name AS company_name, w.name AS workspace_name
       FROM quotes q
       JOIN contacts c ON c.id = q.contact_id
       LEFT JOIN companies co ON co.id = q.company_id
       JOIN workspaces w ON w.id = q.workspace_id
       WHERE q.public_token = $1`,
      [req.params.token]
    );
    if (!result.rows.length) return res.status(404).send("<h2>Quote not found or link has expired.</h2>");
    const quote = result.rows[0];

    const itemsResult = await db.query(
      "SELECT * FROM quote_line_items WHERE quote_id = $1 ORDER BY sort_order",
      [quote.id]
    );
    quote.line_items = itemsResult.rows;

    const html = renderQuoteHTML(quote, req.query.print === "1");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch (err) {
    console.error(err);
    res.status(500).send("Something went wrong.");
  }
});

// --- Front-end ---
const publicDir = path.join(__dirname, "..", "public");
app.use(express.static(publicDir));

// Legal pages — serve explicitly before the SPA catch-all
app.get("/terms",   (req, res) => res.sendFile(path.join(publicDir, "terms.html")));
app.get("/privacy", (req, res) => res.sendFile(path.join(publicDir, "privacy.html")));

// Anything that isn't an API call falls back to index.html so the
// single-page app can handle its own client-side navigation.
app.get(/^\/(?!api).*/, (req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

const PORT = process.env.PORT || 4000;

db.init()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`\n  Klyo is running → http://localhost:${PORT}\n`);
    });
    // Start WhatsApp task reminder scheduler
    require("./services/reminderCron").start();
  })
  .catch((err) => {
    console.error("\n[Klyo] Could not set up the database:", err.message, "\n");
    process.exit(1);
  });
