// server/middleware/auth.js
// ---------------------------------------------------------
// Protects routes by requiring a valid login token, sent as:
//   Authorization: Bearer <token>
// On success it attaches req.user = { id, name, email, role }
// ---------------------------------------------------------
const jwt = require("jsonwebtoken");

function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: "You're not signed in." });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = payload;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Your session has expired. Please sign in again." });
  }
}

// Role hierarchy: viewer < editor < member < admin
// "member" is treated as "editor" for legacy compatibility
const ROLE_LEVEL = { viewer: 0, editor: 1, member: 1, admin: 2 };

function requireRole(minRole) {
  return (req, res, next) => {
    const userLevel = ROLE_LEVEL[req.user?.role] ?? -1;
    const minLevel  = ROLE_LEVEL[minRole] ?? 99;
    if (userLevel < minLevel) {
      return res.status(403).json({ error: "You don't have permission to do that." });
    }
    next();
  };
}

const requireAdmin  = requireRole("admin");
const requireEditor = requireRole("editor"); // editors + members + admins

module.exports = { requireAuth, requireAdmin, requireEditor, requireRole, ROLE_LEVEL };
