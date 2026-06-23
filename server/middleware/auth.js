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

module.exports = { requireAuth };
