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

const publicSite = require("./services/publicSite");
const app = express();
app.use(publicSite.headers);
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
app.use("/api/analytics",require("./routes/analytics"));
for(const name of ["commercial","operations","communications"])app.use("/api/"+name,require("./routes/"+name));
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
for(const name of ["spaces","custom-fields","quote-templates","warranty","price-lists","sharepoint"])app.use("/api/"+name,require("./routes/"+name));
app.use("/api/tasks", tasksRoutes);
app.use("/api/calendar", calendarRoutes);
app.use("/api/calendar-integrations",require("./routes/calendar-integrations"));
app.use("/api/clients", clientsRoutes);
app.use("/api/settings", dataResetRoutes);
app.use("/api", trackingRoutes);
app.use("/api/deal-outcomes", require("./routes/deal-outcomes"));
app.use("/api/mfa", require("./routes/mfa"));

app.get("/api/health", (req, res) => res.json({ ok: true }));

// --- Public quote view (no auth required) ---
app.use('/q',require('./routes/publicQuotes'));

// --- Front-end ---
const publicDir = path.join(__dirname, "..", "public");
app.use(publicSite.compression);
app.use(publicSite.router);
app.use(express.static(publicDir, {
  setHeaders(res, file) {
    if (/\.woff2$/.test(file)) res.set("Cache-Control", "public, max-age=31536000, immutable");
  },
}));

// Public setup guides and authenticated app entry points.
app.get("/docs/calendar-setup",(req,res)=>res.sendFile(path.join(publicDir,"docs/calendar-setup.html")));
app.get("/docs/communications-setup",(req,res)=>res.sendFile(path.join(publicDir,"docs/communications-setup.html")));
app.get("/docs/sharepoint-setup",(req,res)=>res.sendFile(path.join(publicDir,"docs/sharepoint-setup.html")));

app.get("/login",   (req, res) => res.sendFile(path.join(publicDir, "login.html")));
app.get("/onboarding", (req, res) => res.sendFile(path.join(publicDir, "onboarding.html")));
app.get("/signup",  (req, res) => res.sendFile(path.join(publicDir, "login.html")));

// CRM app — authenticated SPA served at /app (client-side auth guard in app.js)
app.get("/app",     (req, res) => res.sendFile(path.join(publicDir, "app.html")));
app.get(/^\/app\//, (req, res) => res.sendFile(path.join(publicDir, "app.html")));

// Missing public pages must return a real 404, not the login page.
app.get(/^\/(?!api(?:\/|$)).*/, publicSite.notFound);

const PORT = process.env.PORT || 4000;

db.init()
  .then(() => {
    require("./services/communications").start();
    require("./services/icloudSync").start();
    app.listen(PORT, () => {
      console.log(`\n  Klyo is running → http://localhost:${PORT}\n`);
    });
  })
  .catch((err) => {
    console.error("\n[Klyo] Could not set up the database:", err.message, "\n");
    process.exit(1);
  });
