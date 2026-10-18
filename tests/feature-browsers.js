// Run after installing Playwright browsers, with a disposable TEST_DATABASE_URL.
const { spawnSync } = require("node:child_process");
const path = require("node:path");
for (const suite of [
  "public-seo",
  "public-language",
  "interface-layouts",
  "language",
  "dashboard",
  "analytics",
  "commercial",
  "operations",
  "communications",
  "calendar-integrations",
  "icloud-calendar",
  "sales-completion",
  "visual-workspace",
]) {
  const result = spawnSync(
    process.execPath,
    [path.join(__dirname, suite + ".browser.js")],
    { stdio: "inherit", env: process.env },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
