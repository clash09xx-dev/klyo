// server/routes/tracking.js
// ---------------------------------------------------------
// A deliberately tiny, public (no login required) endpoint that
// records a page visit. This is the "simple counter" half of
// site analytics — approximate, not bot-filtered, just enough to
// see trends in your own Platform dashboard without needing to
// open a separate analytics site for a quick glance. For real
// traffic analysis (referrers, geography, bot filtering), that's
// what the Cloudflare Web Analytics script in the HTML is for —
// this just feeds your own dashboard.
// ---------------------------------------------------------
const express = require("express");
const db = require("../db");

const router = express.Router();

router.post("/track-view", async (req, res) => {
  const path = typeof req.body?.path === "string" ? req.body.path.slice(0, 200) : "/";
  try {
    await db.query("INSERT INTO page_views (path) VALUES ($1)", [path]);
  } catch {
    // Never let a tracking hiccup affect the visitor's actual page load.
  }
  res.status(204).end();
});

module.exports = router;
