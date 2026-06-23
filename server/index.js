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

app.get("/api/health", (req, res) => res.json({ ok: true }));

// --- Front-end ---
const publicDir = path.join(__dirname, "..", "public");
app.use(express.static(publicDir));

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
  })
  .catch((err) => {
    console.error("\n[Klyo] Could not set up the database:", err.message, "\n");
    process.exit(1);
  });
