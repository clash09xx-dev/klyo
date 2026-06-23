// server/middleware/platformAdmin.js
// ---------------------------------------------------------
// A second, separate tier of "admin" above workspace admins —
// this is you, the person running Klyo itself, not a customer.
// Gated by email match against PLATFORM_ADMIN_EMAIL in .env,
// rather than anything stored per-workspace, since this person
// isn't a member of any one workspace's business.
// ---------------------------------------------------------
function requirePlatformAdmin(req, res, next) {
  const allowed = process.env.PLATFORM_ADMIN_EMAIL;
  if (!allowed || req.user.email.toLowerCase() !== allowed.toLowerCase()) {
    return res.status(403).json({ error: "Not authorized." });
  }
  next();
}

module.exports = { requirePlatformAdmin };
