const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");
function runtime() {
  let lang = "en";
  const authored = { dataset: { uiCopy: "Save" }, textContent: "Save" };
  const record = { textContent: "Save" };
  const document = {
    addEventListener() {},
    querySelectorAll: (s) => (s === "[data-ui-copy]" ? [authored] : []),
  };
  const window = { addEventListener() {} };
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, "../public/js/ui-copy.js"), "utf8"),
    { window, document, KlyoI18n: { getLang: () => lang } },
  );
  return {
    copy: window.KlyoCopy,
    authored,
    record,
    setLang: (v) => (lang = v),
  };
}
test("only authored markers translate; customer values and unknown messages are preserved", () => {
  const r = runtime();
  r.setLang("pl");
  r.copy.apply();
  assert.equal(r.authored.textContent, "Zapisz");
  assert.equal(r.record.textContent, "Save");
  assert.equal(r.copy.text("Acme & Sons <custom>"), "Acme & Sons <custom>");
  r.setLang("en");
  r.copy.apply();
  assert.equal(r.authored.textContent, "Save");
  assert.equal(r.copy.text("Zapisz"), "Save");
});
test("HTML translation preserves open fragments, options and escaping", () => {
  const r = runtime();
  r.setLang("pl");
  assert.equal(r.copy.html('<button type="button">'), '<button type="button">');
  const option = r.copy.html('<option value="save">Save</option>');
  assert.equal(option, '<option value="save">Zapisz</option>');
  assert.match(
    r.copy.html("<button>Save</button>"),
    /data-ui-copy="Save">Zapisz/,
  );
  assert.equal(
    r.copy.escape('<img src=x onerror="bad">'),
    "&lt;img src=x onerror=&quot;bad&quot;&gt;",
  );
  assert.ok(!r.copy.label("<img src=x>").includes("<img"));
});

test("platform summary localizes fixed copy without rewriting account names", () => {
  const r = runtime();
  r.setLang("pl");
  assert.equal(r.copy.text("Complimentary"), "Bezpłatny dostęp");
  assert.equal(r.copy.text("No industry set"), "Nie określono branży");
  assert.equal(
    r.copy.format("Quote ({0})", "Acme & Sons"),
    "Oferta (Acme & Sons)",
  );
});
