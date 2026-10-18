const db = require('../db');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const M = require('./mfa');
const configured = () => Boolean(process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL);
async function send(to, subject, text) {
  if (!configured()) throw new Error('Account email is not configured.');
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
    headers: { Authorization: 'Bearer ' + process.env.RESEND_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: process.env.RESEND_FROM_EMAIL, to: [to], subject, text }),
  });
  if (!r.ok) throw new Error('Account email could not be delivered.');
  return r.json();
}
async function requestReset(email, ip, language) {
  await M.limit('password-reset-ip:' + ip, 15, 3600);
  if (typeof email !== 'string' || email.length > 254) return;
  const normalized = email.trim().toLowerCase();
  await M.limit('password-reset-email:' + normalized, 3, 900);
  const u = (await db.query('SELECT id,email,language FROM users WHERE email=$1', [normalized])).rows[0];
  if (!u) return;
  const token = crypto.randomBytes(32).toString('hex'), tokenHash = M.hash(token);
  // Multiple requests remain usable until one succeeds; a mail outage cannot invalidate the previous email.
  await db.query("INSERT INTO password_reset_tokens(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '20 minutes')", [tokenHash,u.id]);
  const link = (process.env.APP_URL || 'http://localhost:4000') + '/login#reset_token=' + token;
  const pl = (u.language || language) === 'pl';
  try {
    await module.exports.send(u.email,
      pl ? 'Zresetuj hasło do Klyo' : 'Reset your Klyo password',
      pl ? `Aby ustawić nowe hasło, otwórz link w ciągu 20 minut:\n\n${link}\n\nJeśli nie proszono o zmianę hasła, zignoruj tę wiadomość. Logowanie nadal wymaga kodu SMS.`
      : `Open this link within 20 minutes to choose a new password:\n\n${link}\n\nIf you did not request a password reset, ignore this email. Sign-in still requires an SMS code.`);
  } catch {
    await db.query('DELETE FROM password_reset_tokens WHERE token_hash=$1',[tokenHash]);
    console.error('Password reset email delivery failed. Check Resend configuration.');
  }
}
async function reset(token, password) {
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token) || typeof password !== 'string' || password.length < 8 || password.length > 128)
    throw Object.assign(new Error('Use a valid reset link and a password with 8–128 characters.'), {status:400});
  const c = await db.pool.connect();
  try {
    await c.query('BEGIN');
    const row = (await c.query('SELECT user_id FROM password_reset_tokens WHERE token_hash=$1', [M.hash(token)])).rows[0];
    if (!row) throw Object.assign(new Error('This reset link has expired or already been used.'),{status:400});
    // Serialize all resets for this account before checking/consuming any token.
    await c.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[row.user_id]);
    const claim = await c.query('UPDATE password_reset_tokens SET consumed_at=now() WHERE token_hash=$1 AND consumed_at IS NULL AND expires_at>now() RETURNING user_id',[M.hash(token)]);
    if (!claim.rows.length) throw Object.assign(new Error('This reset link has expired or already been used.'),{status:400});
    const passwordHash = await bcrypt.hash(password, 10);
    await c.query('UPDATE users SET password_hash=$1,mfa_version=mfa_version+1 WHERE id=$2',[passwordHash,row.user_id]);
    await c.query('UPDATE password_reset_tokens SET consumed_at=now() WHERE user_id=$1 AND consumed_at IS NULL',[row.user_id]);
    await c.query('UPDATE mfa_challenges SET consumed_at=now() WHERE user_id=$1 AND consumed_at IS NULL',[row.user_id]);
    await c.query('COMMIT');
  } catch(e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
}
module.exports = { configured, send, requestReset, reset };
