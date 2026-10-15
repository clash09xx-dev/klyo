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
const dataResetRoutes = require("./routes/data-reset");

const app = express();
app.use(cors());

// Stripe's webhook signature check needs the exact raw request bytes,
// so this one path must be excluded from JSON parsing below. Order
// matters: this has to be registered before express.json().
app.use("/api/billing/webhook", express.raw({ type: "application/json" }));
app.use(express.json({ limit: "50mb" }));

app.use("/api/auth", authRoutes);
app.use("/api/contacts", contactRoutes);
app.use("/api/offers", offerRoutes);
app.use("/api/stats", statsRoutes);
app.use("/api/sales", require("./routes/sales"));
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
app.use("/api/pipelines", require("./routes/pipelines"));
for(const name of ["spaces","custom-fields","quote-templates","warranty"])app.use("/api/"+name,require("./routes/"+name));
app.use("/api/tasks", tasksRoutes);
app.use("/api/calendar", calendarRoutes);
app.use("/api/clients", clientsRoutes);
app.use("/api/settings", dataResetRoutes);
app.use("/api", trackingRoutes);

app.get("/api/health", (req, res) => res.json({ ok: true }));

// --- Public quote view (no auth required) ---
app.use('/q',require('./routes/publicQuotes'));

// --- Front-end ---
const publicDir = path.join(__dirname, "..", "public");
app.use(express.static(publicDir));

// Public pages — served explicitly so they are always accessible without login
app.get("/",        (req, res) => res.sendFile(path.join(publicDir, "index.html")));
app.get("/terms",   (req, res) => res.sendFile(path.join(publicDir, "terms.html")));
app.get("/privacy", (req, res) => res.sendFile(path.join(publicDir, "privacy.html")));
app.get("/customization",(req,res)=>res.sendFile(path.join(publicDir,"customization.html")));
app.get("/login",   (req, res) => res.sendFile(path.join(publicDir, "login.html")));
app.get("/signup",  (req, res) => res.sendFile(path.join(publicDir, "login.html")));

// CRM app — authenticated SPA served at /app (client-side auth guard in app.js)
app.get("/app",     (req, res) => res.sendFile(path.join(publicDir, "app.html")));
app.get(/^\/app\//, (req, res) => res.sendFile(path.join(publicDir, "app.html")));

// Anything else (old /index.html bookmarks etc.) → redirect to login
app.get(/^\/(?!api).*/, (req, res) => {
  res.redirect("/login");
});

const PORT = process.env.PORT || 4000;

db.init()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`\n  Klyo is running → http://localhost:${PORT}\n`);
    });
  })
  .catch((err) => {
    console.error("\n[Klyo] Could not set up the database:", err.message, "\n");
    process.exit(1);
  });
