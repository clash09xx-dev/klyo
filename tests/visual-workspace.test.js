const test = require("node:test"),
  assert = require("node:assert/strict"),
  Q = require("../public/js/quote-core"),
  P = require("../public/js/preferences-core");
const groups = [
  {
    id: "pc",
    name: "Complete computer",
    discount_type: "percent",
    discount_value: 5,
  },
  {
    id: "cpu-gpu",
    name: "CPU and GPU",
    parent_id: "pc",
    discount_type: "percent",
    discount_value: 10,
  },
];
const items = [
  { description: "Motherboard", quantity: 1, unit_price: 100, bundle_id: "pc" },
  { description: "RAM", quantity: 1, unit_price: 100, bundle_id: "pc" },
  {
    description: "CPU",
    quantity: 1,
    unit_price: 200,
    discount_percent: 10,
    bundle_id: "cpu-gpu",
    show_component_price: true,
  },
  { description: "GPU", quantity: 1, unit_price: 400, bundle_id: "cpu-gpu" },
];
test("nested discounts allocate cents once and selective disclosure never adds charges", () => {
  const t = Q.computeTotals(items, 23, {
    pricing_groups: groups,
    type: "percent",
    value: 10,
  });
  assert.equal(t.subtotal, 800);
  assert.equal(t.item_discount_total, 20);
  assert.equal(t.group_discount_total, 94.1);
  assert.equal(t.net_total, 617.31);
  assert.equal(t.total, 759.29);
  assert.equal(
    t.computed.reduce((n, i) => n + Math.round(i.line_total * 100), 0),
    68590,
  );
  assert.deepEqual(
    t.computed.map((i) => i.line_total),
    [95, 95, 153.9, 342],
  );
  const d = Q.normalizeDocument({ pricing_groups: groups });
  const shown = Q.presentItems(t.computed, d, "PLN");
  assert.equal(shown.length, 1);
  assert.equal(shown[0].line_total, 685.9);
  assert.match(shown[0].description, /CPU and GPU.*495.90/);
  assert.match(shown[0].description, /CPU.*153.90/);
  assert.match(shown[0].description, /Motherboard/);
  assert.doesNotMatch(shown[0].description, /95.00|342.00/);
  const hidden = Q.presentItems(
    t.computed,
    { ...d, pricing_mode: "total_only" },
    "PLN",
  )[0];
  assert.equal(hidden.hide_prices, true);
  assert.doesNotMatch(hidden.description, /153.90|495.90/);
  for (let n = 1; n < 70; n++) {
    const value = Q.computeTotals(
      Array.from({ length: n }, (_, i) => ({
        description: String(i),
        unit_price: 0.03,
        quantity: 1,
        bundle_id: "x",
      })),
      0,
      {
        pricing_groups: [
          {
            id: "x",
            name: "Rounding",
            discount_type: "percent",
            discount_value: 17,
          },
        ],
      },
    );
    assert.equal(
      value.computed.reduce((s, i) => s + Math.round(i.line_total * 100), 0),
      Math.round(value.net_total * 100),
    );
  }
});
test("invalid group structures, excess discounts and arbitrary dashboard content are rejected", () => {
  assert.throws(
    () =>
      Q.normalizeGroups([
        { id: "a", name: "A", parent_id: "b" },
        { id: "b", name: "B", parent_id: "a" },
      ]),
    /cycle/,
  );
  assert.throws(
    () => Q.normalizeGroups([{ id: "a", name: "A", parent_id: "missing" }]),
    /parent/,
  );
  assert.throws(
    () =>
      Q.computeTotals(items, 0, {
        pricing_groups: [
          {
            id: "pc",
            name: "PC",
            discount_type: "fixed",
            discount_value: 999999,
          },
        ],
      }),
    /cannot exceed/,
  );
  assert.throws(
    () => P.normalize({ layout: { dashboard: [{ id: "<script>" }] } }, true),
    /valid dashboard/,
  );
  assert.throws(
    () =>
      Q.computeTotals([
        {
          description: "Unsafe bundle",
          unit_price: 1,
          quantity: 1,
          bundle_id: 'bad"onclick=alert(1)',
        },
      ]),
    /bundle identifier/,
  );
  const original = P.defaults(),
    custom = P.normalize(
      {
        layout: {
          dashboard: [
            { id: "metrics", x: 0, y: 0, w: 6, h: 5 },
            { id: "wonlost", x: 0, y: 0, w: 6, h: 5 },
          ],
          sidebar_width: 300,
          nav_mode: "tiles",
        },
      },
      true,
    );
  assert.notDeepEqual(custom.layout.dashboard[0], custom.layout.dashboard[1]);
  assert.equal(custom.layout.nav_mode, "tiles");
  assert.equal(custom.layout.sidebar_width, 300);
  assert.equal(original.layout.dashboard.length, 13);
  assert.deepEqual(P.normalize(custom, true), custom);
  assert.throws(
    () => P.normalize({ layout: { sidebar_width: 400 } }, true),
    /navigation width/,
  );
});

test("Make It Yours preserves fine geometry and safe tilt while rejecting unsafe layout values", () => {
  const value = P.normalize(
    {
      layout: {
        dashboard_snap: "free",
        dashboard: [
          { id: "shortcut_deal", x: 1.37, y: 3.43, w: 3.5, h: 2.25, tilt: 3.5 },
        ],
      },
    },
    true,
  );
  assert.deepEqual(value.layout.dashboard[0], {
    id: "shortcut_deal",
    x: 1.37,
    y: 3.43,
    w: 3.5,
    h: 2.25,
    tilt: 3.5,
  });
  assert.deepEqual(P.normalize(value, true), value);
  for (const bad of [NaN, Infinity, 7, -7, "rotate(20deg)"])
    assert.throws(
      () =>
        P.normalize(
          { layout: { dashboard: [{ id: "metrics", tilt: bad }] } },
          true,
        ),
      /tilt/,
    );
  assert.throws(
    () => P.normalize({ layout: { dashboard_snap: "unsafe" } }, true),
    /snapping/,
  );
  const legacy = P.normalize(
    { layout: { dashboard: [{ id: "metrics", x: 0, y: 0, w: 12, h: 5 }] } },
    true,
  );
  assert.equal(legacy.layout.dashboard[0].tilt, 0);
  assert.equal(legacy.layout.dashboard_snap, "magnetic");
  const packed = P.packDashboard(
    [
      { id: "metrics", x: 0, y: 0, w: 6, h: 5 },
      { id: "goal", x: 0.25, y: 0.5, w: 6, h: 3 },
    ],
    "goal",
  );
  const [a, b] = packed;
  assert.ok(
    !(a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y),
  );
  assert.equal(b.x, 0.25);
  assert.equal(b.y, 0.5);
});

test("fine adjacent dashboard widgets do not drift because of decimal rounding", () => {
  const adjacent = [
    { id: "metrics", x: 0.1, y: 0, w: 2.2, h: 3 },
    { id: "goal", x: 2.3, y: 0, w: 2.2, h: 3 },
  ];
  assert.deepEqual(P.packDashboard(adjacent), adjacent);
});
