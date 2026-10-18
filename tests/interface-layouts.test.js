const test = require("node:test"),
  assert = require("node:assert/strict"),
  P = require("../public/js/preferences-core");
test("four interface presets preserve records-related preferences, charts and colors", () => {
  const original = P.defaults("ocean");
  original.layout.hidden_nav = ["rfq"];
  original.layout.dashboard[0].tilt = 2;
  for (const key of Object.keys(P.INTERFACES)) {
    const chosen = P.normalize(P.useInterface(original, key), true);
    assert.equal(chosen.layout.ui.preset, key);
    assert.deepEqual(chosen.palette, original.palette);
    assert.deepEqual(chosen.layout.dashboard, original.layout.dashboard);
    assert.deepEqual(chosen.layout.hidden_nav, ["rfq"]);
    assert.equal(chosen.layout.ui.module_groups.rfq, "communication");
  }
  assert.equal(P.useInterface(original, "command").layout.sidebar, "top");
  assert.equal(original.layout.sidebar, "left");
});
test("page compositions, safe saved layouts and navigation groups normalize consistently", () => {
  const p = P.defaults();
  p.layout.ui.preset = "custom";
  p.layout.ui.base = "explorer";
  p.layout.ui.module_groups.rfq = "sales";
  p.layout.ui.section_names.sales = "Sales desk";
  p.layout.ui.quick_actions = ["new_deal", "integrations"];
  p.layout.ui.pages.pipeline = {
    order: ["toolbar", "records", "heading", "summary"],
    hidden: ["summary"],
    spans: { toolbar: 6, records: 12 },
  };
  const config = P.clone(p.layout);
  delete config.dashboard;
  p.layout.ui.saved = [
    { id: "layout-test", name: "Sales desk", configuration: config },
  ];
  const result = P.normalize(p, true);
  assert.equal(result.layout.ui.pages.pipeline.spans.toolbar, 6);
  assert.equal(result.layout.ui.saved[0].configuration.dashboard, undefined);
  assert.deepEqual(result.layout.ui.saved[0].configuration.ui.saved, []);
  assert.deepEqual(P.normalize(result, true), result);
  assert.equal(P.normalize({}, true).layout.ui.preset, "classic");
});
test("interface preferences reject invalid geometry, permissions, identifiers and oversized libraries", () => {
  for (const ui of [
    { preset: "injected" },
    { base: "script" },
    { icon_style: "<script>" },
    { corners: 1000 },
    { content_width: 200 },
    { section_order: ["sales", "sales"] },
    { module_groups: { rfq: "platform" } },
    { quick_actions: ["delete_everything"] },
    { pages: { platform: {} } },
    { pages: { pipeline: { hidden: ["records"] } } },
    { pages: { pipeline: { spans: { records: -2 } } } },
    {
      saved: Array.from({ length: 7 }, (_, i) => ({
        id: "layout-" + i,
        name: "x",
        configuration: {},
      })),
    },
    { saved: [{ id: "../../file", name: "x", configuration: {} }] },
  ])
    assert.throws(
      () => P.normalize({ layout: { ui } }, true),
      undefined,
      JSON.stringify(ui),
    );
  const result = P.normalize({
    is_platform_admin: true,
    layout: { ui: { module_groups: { platform: "sales" } } },
  });
  assert.equal(result.is_platform_admin, undefined);
  assert.equal(result.layout.ui.module_groups.platform, undefined);
});
