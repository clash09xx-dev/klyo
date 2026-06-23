// server/scripts/comp-workspace.js
// ---------------------------------------------------------
// Gives someone permanent free access, bypassing Stripe and the
// trial countdown entirely. Use this for accounts you never want
// to bill — e.g. your dad's business.
//
// Usage (after he's registered a normal account once):
//   node server/scripts/comp-workspace.js dad@example.com
// or:
//   npm run comp-workspace -- dad@example.com
// ---------------------------------------------------------
require("dotenv").config();
const db = require("../db");

async function main() {
  const email = process.argv[2];
  if (!email) {
    console.error("Usage: node server/scripts/comp-workspace.js <user-email>");
    process.exit(1);
  }

  const userResult = await db.query("SELECT id, name, workspace_id FROM users WHERE email = $1", [
    email.toLowerCase().trim(),
  ]);
  const user = userResult.rows[0];
  if (!user) {
    console.error(`No user found with email ${email}. They need to register a normal account first.`);
    process.exit(1);
  }

  await db.query("UPDATE workspaces SET is_comped = TRUE, tier = 'ultra' WHERE id = $1", [user.workspace_id]);
  console.log(`Done — ${user.name}'s workspace (id ${user.workspace_id}) now has unlimited Ultra access, free for life.`);
  await db.pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
