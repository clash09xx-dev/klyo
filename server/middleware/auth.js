const jwt = require("jsonwebtoken");
const db = require("../db");
const S = require("../services/spaces");
const ROLE_LEVEL = { viewer: 0, editor: 1, member: 1, admin: 2 };
async function requireAuth(req, res, next) {
  if (req.authResolved) return next();
  const header = req.headers.authorization || "",
    token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "You're not signed in." });
  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return res
      .status(401)
      .json({ error: "Your session has expired. Please sign in again." });
  }
  try {
    const user = await S.account(payload.id);
    if (!user) return res.status(401).json({ error: "Account not found." });
    if (payload.purpose || (payload.mfa_version || 0) !== (user.mfa_version || 0)) return res.status(401).json({error:"Security settings changed. Sign in again.",code:"MFA_SESSION_CHANGED"});
    if (!user.mfa_enabled || !payload.sms_verified)
      return res.status(401).json({ error: "SMS verification is required. Sign in again.", code: "SMS_REQUIRED" });
    req.authToken = payload;
    // The database is authoritative. Old tokens cannot retain a removed role or team.
    if (payload.workspace_id !== user.workspace_id)
      return res
        .status(401)
        .json({
          error: "Your team access changed. Sign in again.",
          code: "SESSION_CHANGED",
        });
    const primary = await S.ensureTeamOwner(user.workspace_id);
    if (!primary)
      return res.status(401).json({ error: "Workspace not found." });
    const requested = req.headers["x-klyo-scope"] || "team";
    if (!["team", "personal"].includes(requested))
      return res.status(400).json({ error: "Choose Team or Personal." });
    let wid = user.workspace_id,
      personal = primary.space_type === "personal";
    if (requested === "personal") {
      const p = await S.personalSpace(user);
      wid = p.id;
      personal = true;
    }
    let zone = req.headers["x-klyo-timezone"] || "UTC";
    try {
      new Intl.DateTimeFormat("en", { timeZone: zone });
    } catch {
      zone = "UTC";
    }
    req.account = user;
    req.user = {
      ...user,
      workspace_id: wid,
      time_zone: zone,
      team_workspace_id: user.workspace_id,
      role: personal ? "admin" : user.role,
      is_personal: personal,
      scope: personal ? "personal" : "team",
      is_team_owner: !personal && primary.owner_user_id === user.id,
      owns_team:
        primary.space_type === "team" && primary.owner_user_id === user.id,
      billing_workspace_id:
        primary.space_type === "team"
          ? user.workspace_id
          : primary.billing_workspace_id || user.workspace_id,
    };
    req.authResolved = true;
    // No payloads or credentials are written to team audit logs.
    res.on("finish", () => {
      if (
        !personal &&
        ["POST", "PUT", "PATCH", "DELETE"].includes(req.method) &&
        res.statusCode < 400
      ) {
        db.query(
          "INSERT INTO team_audit_log(workspace_id,user_id,action,resource) VALUES($1,$2,$3,$4)",
          [
            wid,
            user.id,
            req.method,
            String(req.originalUrl || req.url)
              .split("?")[0]
              .slice(0, 300),
          ],
        ).catch((e) => console.error("Audit:", e.message));
      }
    });
    next();
  } catch (e) {
    console.error("Session validation:", e.message);
    res
      .status(503)
      .json({ error: "Could not verify access. Please try again." });
  }
}
function requireRole(minRole) {
  return (req, res, next) => {
    if ((ROLE_LEVEL[req.user?.role] ?? -1) < (ROLE_LEVEL[minRole] ?? 99))
      return res
        .status(403)
        .json({ error: "You don't have permission to do that." });
    next();
  };
}
function requireTeamOwner(req, res, next) {
  if (!req.user?.is_team_owner)
    return res
      .status(403)
      .json({
        error:
          "Only the team owner can manage invitations, roles and team audit.",
      });
  next();
}
const requireAdmin = requireRole("admin"),
  requireEditor = requireRole("editor");
module.exports = {
  requireAuth,
  requireAdmin,
  requireEditor,
  requireTeamOwner,
  requireRole,
  ROLE_LEVEL,
};
