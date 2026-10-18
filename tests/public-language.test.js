const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path");
const Site = require("../server/services/publicSite"),
  Language = require("../server/services/publicLanguage");
test("every visible string and accessibility label in the shared marketing pages has Polish copy", () => {
  for (const p of Site.pages.filter((p) => p.file)) {
    const missing = [];
    Language.localize(
      fs.readFileSync(path.join(__dirname, "../public", p.file), "utf8"),
      Site.pages,
      (s) => missing.push(s),
    );
    assert.deepEqual(missing, [], p.key);
    const en = Site.render(p, "en"),
      pl = Site.render(p, "pl");
    const assets = (html) =>
      [...html.matchAll(/(?:src|srcset)="([^"]+)"/g)].map((m) => m[1]);
    assert.deepEqual(
      assets(pl),
      assets(en),
      p.key + ": same product images, styles and scripts",
    );
    assert.equal(
      (en.match(/<section\b/g) || []).length,
      (pl.match(/<section\b/g) || []).length,
      p.key,
    );
  }
});
test("public translation preserves tags, demo selectors and scripts while escaping copy and localizing links", () => {
  const source =
    '<body><a class="link" href="/features#quotes" aria-label="Features"> Features </a><input placeholder="Enter a value"><script>const label="Features";</script><p>Clark &amp; Co.</p></body>';
  const result = Language.localize(source, Site.pages);
  assert.match(
    result,
    /href="\/pl\/funkcje#quotes" aria-label="Funkcje"> Funkcje /,
  );
  assert.match(result, /placeholder="Wpisz wartość"/);
  assert.match(result, /<script>const label="Features";<\/script>/);
  assert.match(result, /Clark &amp; Co\./);
  assert.ok(
    Object.values(Language.runtime).every((v) => typeof v === "string"),
  );
});
