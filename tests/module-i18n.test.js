const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");

test("new module labels have five languages and switching language touches only authored markers", () => {
  let lang = "en",
    listener;
  const record = { textContent: "Good" };
  const authored = {
    dataset: { moduleKey: "Commercial register" },
    textContent: "",
  };
  const window = {
    addEventListener(name, fn) {
      assert.equal(name, "klyo:language");
      listener = fn;
    },
  };
  const context = {
    window,
    KlyoI18n: { getLang: () => lang },
    document: {
      querySelectorAll(selector) {
        assert.equal(selector, "[data-module-key]");
        return [authored];
      },
    },
  };
  const src = fs.readFileSync(
    path.join(__dirname, "../public/js/module-i18n.js"),
    "utf8",
  );
  vm.runInNewContext(
    src.replace(
      "  function pick(en, pl) {",
      "  window.authoredLabels=data;\n  function pick(en, pl) {",
    ),
    context,
  );
  const labels = window.authoredLabels;
  assert.ok(Object.keys(labels).length > 650);
  for (const [key, translations] of Object.entries(labels)) {
    for (const code of ["pl", "es", "fr", "de"])
      assert.ok(
        typeof translations[code] === "string" && translations[code].trim(),
        key + ": " + code,
      );
  }
  for (const [code, expected] of [
    ["en", "Commercial register"],
    ["pl", "Rejestr handlowy"],
    ["es", "Registro comercial"],
    ["fr", "Registre commercial"],
    ["de", "Vertriebsregister"],
  ]) {
    lang = code;
    listener();
    assert.equal(authored.textContent, expected);
    assert.equal(record.textContent, "Good");
  }
  assert.match(
    window.KlyoModuleI18n.label('<img onerror="x">'),
    /&lt;img onerror=&quot;x&quot;&gt;/,
  );
  assert.ok(!window.KlyoModuleI18n.label("<script>").includes("<script>"));
});
