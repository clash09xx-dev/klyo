const db = require("../db"),
  M = require("../services/mfa"),
  S = require("../services/sharepoint"),
  { requireAuth } = require("../middleware/auth");
const router = require("../middleware/safeRouter")();
router.post("/resend", async (req, res) =>
  res.json(await M.resend(req.body.challenge)),
);
router.post("/verify", async (req, res) =>
  res.json(await M.check(req.body.challenge, req.body.code)),
);
router.get("/status", requireAuth, async (req, res) => {
  const u = (
    await db.query("SELECT mfa_enabled,mfa_phone FROM users WHERE id=$1", [
      req.account.id,
    ])
  ).rows[0];
  res.json({
    configured: M.configured(),
    required: true,
    enabled: u.mfa_enabled,
    phone: u.mfa_phone ? M.mask(S.decrypt(u.mfa_phone)) : null,
    recovery_codes: (
      await db.query(
        "SELECT count(*)::int AS n FROM mfa_recovery_codes WHERE user_id=$1 AND used_at IS NULL",
        [req.account.id],
      )
    ).rows[0].n,
  });
});
router.post("/enroll", requireAuth, async (req, res) => {
  const u = await M.fresh(req);
  if (u.mfa_enabled)
    throw Object.assign(
      new Error(
        "Disable existing SMS verification before changing the number.",
      ),
      { status: 409 },
    );
  res.json(await M.start(u, "enroll", M.phone(req.body.phone), req.ip));
});
router.post("/disable", requireAuth, async (req, res) =>
  res.status(403).json({ error: "SMS verification is required for every account and cannot be disabled." }),
);
router.post("/login-enroll", async (req, res) => {
  await M.limit("enrollment-ip:" + req.ip, 30, 3600);
  const u = await M.enrollmentUser(req.body.enrollment_token);
  res.json(await M.start(u, "login_enroll", M.phone(req.body.phone), req.ip));
});
router.post("/confirm", requireAuth, async (req, res) =>
  res.json(await M.check(req.body.challenge, req.body.code, req.account.id)),
);
module.exports = router;
