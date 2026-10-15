const test = require("node:test"),
  assert = require("node:assert/strict");
const Q = require("../public/js/quote-core");
const { generateQuotePdf, safeName, documentFor } = require("../server/services/quotePdf");
const { renderQuoteHTML } = require("../server/services/quoteRenderer");
test("quote totals match rounded lines, discounts and optional tax", () => {
  const r = Q.computeTotals(
    [
      { quantity: 1, unit_price: 4500, discount_percent: 10 },
      { quantity: 2, unit_price: 150 },
    ],
    23,
  );
  assert.equal(r.subtotal, 4800);
  assert.equal(r.discountTotal, 450);
  assert.equal(r.net_total, 4350);
  assert.equal(r.tax_total, 1000.5);
  assert.equal(r.total, 5350.5);
  const fractional = Q.computeTotals(
    [
      { quantity: 0.33, unit_price: 0.05 },
      { quantity: 0.33, unit_price: 0.05 },
    ],
    23,
  );
  assert.equal(
    fractional.computed.reduce((s, i) => s + i.line_total, 0),
    fractional.net_total,
  );
  assert.equal(fractional.total, 0.05);
  for (const items of [
    [{ quantity: -1, unit_price: 50 }],
    [{ quantity: 1, unit_price: NaN }],
    [{ quantity: 1, unit_price: 1.234 }],
    [{ quantity: 0, unit_price: 50 }],
    [{ quantity: 1, unit_price: 50, discount_percent: 101 }],
    [],
  ])
    assert.throws(() => Q.computeTotals(items), { status: 400 });
  assert.throws(() => Q.computeTotals([{ quantity: 1, unit_price: 50 }], -1), {
    status: 400,
  });
});
test("PDF document settings reject invalid dates, markup colors and external logos", () => {
  for (const d of [
    { accent: "red;display:none" },
    { language: "xx" },
    { issued_on: "2026-02-30" },
    { valid_until: "2026-01-01", issued_on: "2026-02-01" },
    { logo_data_url: "https://example.test/logo.png" },
    { scope: "x".repeat(8001) },
  ])
    assert.throws(() => Q.normalizeDocument(d), { status: 400 });
  assert.equal(
    Q.normalizeDocument({ seller: { name: "Żółć Łódź" } }).seller.name,
    "Żółć Łódź",
  );
  assert.equal(
    Q.reference({ id: 42, created_at: new Date("2026-10-15T00:00:00Z") }),
    "OF-2026-00042",
  );
});
test("saved PDF parties preserve empty fields when linked contacts change", () => {
  const snapshot=Q.normalizeDocument({seller:{name:'Original'},buyer:{name:'Client',email:''}});
  const saved=documentFor({document:snapshot,contact_email:'new@example.test',workspace_name:'Renamed'});
  assert.equal(saved.buyer.email,'');assert.equal(saved.seller.name,'Original');
  assert.equal(documentFor({document:{},contact_email:'legacy@example.test'}).buyer.email,'legacy@example.test');
});
test("both PDF styles generate binary documents with embedded Unicode fonts and safe filenames", async () => {
  const totals = Q.computeTotals(
      [{ description: "Zażółć gęślą jaźń", quantity: 1, unit_price: 4500 }],
      23,
    ),
    quote = {
      id: 42,
      title: "Oferta dla klienta",
      created_at: "2026-10-15",
      currency: "PLN",
      ...totals,
      discount_total: totals.discountTotal,
      document: Q.normalizeDocument({
        language: "pl",
        seller: { name: "Firma" },
        buyer: { name: "Klient" },
      }),
    };
  for (const layout of ["studio", "executive"]) {
    quote.document.layout = layout;
    const buffer = await generateQuotePdf(quote, totals.computed);
    assert.equal(buffer.subarray(0, 5).toString(), "%PDF-");
    assert.ok(buffer.length > 10000);
    assert.match(buffer.toString("latin1"), /FontFile2/);
  }
  quote.document.reference = "../../abc\r\nname";
  assert.equal(safeName(quote).includes("/"), false);
  const html = renderQuoteHTML({
    ...quote,
    title: "<script>alert(1)</script>",
    line_items: totals.computed,
  });
  assert.ok(!html.includes("<script>alert(1)</script>"));
  assert.match(html, /application\/pdf|Pobierz PDF/);
});
test("Gmail MIME contains the PDF attachment and keeps Polish subject/body intact", async () => {
  const { buildGmailMessage } = require("../server/services/google");
  const raw = await buildGmailMessage(
    "client@example.test",
    "Oferta - Łódź",
    "Dzień dobry",
    [
      {
        filename: "Oferta-42.pdf",
        content: Buffer.from("%PDF-test"),
        contentType: "application/pdf",
      },
    ],
  );
  const text = raw.toString();
  assert.match(text, /Content-Type: multipart\/mixed/);
  assert.match(text, /application\/pdf/);
  assert.match(text, /Oferta-42\.pdf/);
  assert.match(text, /JVBERi10ZXN0/);
});
