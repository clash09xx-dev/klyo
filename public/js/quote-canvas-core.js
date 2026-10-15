/* Bounded A4 geometry shared by the designer and the PDF renderer. Units: mm. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.KlyoCanvasCore = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const fail = (m) => {
    throw Object.assign(new Error(m), { status: 400 });
  };
  const TYPES = [
    "text",
    "field",
    "image",
    "rectangle",
    "line",
    "items",
    "totals",
  ];
  const FIELDS = [
    "title",
    "reference",
    "issued_on",
    "valid_until",
    "seller.name",
    "seller.details",
    "seller.email",
    "seller.phone",
    "seller.tax_id",
    "buyer.name",
    "buyer.details",
    "buyer.email",
    "buyer.phone",
    "buyer.tax_id",
    "scope",
    "payment",
    "delivery",
    "terms",
    "footer",
    "total",
    "subtotal",
    "discount_total",
    "tax_total",
    "currency",
    "page_number",
    "page_count",
  ];
  const clean = (v, max) => {
    if (v == null) return "";
    if (typeof v !== "string" || v.length > max)
      fail("An element contains too much text.");
    return v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
  };
  const number = (v, min, max, name) => {
    const n = Number(v);
    if (!Number.isFinite(n) || n < min || n > max)
      fail("Invalid " + name + ".");
    return Math.round(n * 100) / 100;
  };
  const color = (v, fallback) => {
    v = v || fallback;
    if (!/^#[a-f\d]{6}$/i.test(v)) fail("Choose a valid colour.");
    return v;
  };
  function normalize(value) {
    if (
      !value ||
      typeof value !== "object" ||
      JSON.stringify(value).length > 2500000 ||
      !Array.isArray(value.pages) ||
      !value.pages.length ||
      value.pages.length > 10
    )
      fail("Use 1–10 A4 pages with up to 100 elements on each page.");
    const ids = new Set();
    let tables = 0;
    return {
      version: 1,
      pages: value.pages.map((page) => {
        if (
          !page ||
          typeof page !== "object" ||
          !Array.isArray(page.elements) ||
          page.elements.length > 100
        )
          fail("A page can contain up to 100 elements.");
        return {
          background: color(page.background, "#ffffff"),
          elements: page.elements.map((e) => {
            if (!e || !TYPES.includes(e.type))
              fail("Unsupported document element.");
            const id = clean(e.id, 60);
            if (!/^[a-zA-Z0-9_-]+$/.test(id) || ids.has(id))
              fail("Use unique element identifiers.");
            ids.add(id);
            const x = number(e.x, 0, 209, "horizontal position"),
              y = number(e.y, 0, 296, "vertical position"),
              w = number(e.w, 1, 210 - x, "width"),
              h = number(e.h, 1, 297 - y, "height");
            const out = {
              id,
              type: e.type,
              x,
              y,
              w,
              h,
              text: clean(e.text, 8000),
              field: clean(e.field, 50),
              font_size: number(e.font_size ?? 12, 6, 72, "font size"),
              color: color(e.color, "#172238"),
              fill: e.fill ? color(e.fill) : "",
              bold: !!e.bold,
              align: e.align || "left",
              visibility: e.visibility || "all",
              image: clean(e.image, 400000),
            };
            if (
              !["left", "center", "right"].includes(out.align) ||
              !["all", "first", "last"].includes(out.visibility)
            )
              fail("Invalid text alignment or page visibility.");
            if (out.type === "field" && !FIELDS.includes(out.field))
              fail("Choose an available automatic field.");
            if (
              out.image &&
              !/^data:image\/(png|jpeg);base64,[a-zA-Z\d+/]+={0,2}$/.test(
                out.image,
              )
            )
              fail("Use a PNG or JPEG image.");
            if (out.type === "items") {
              if (++tables > 1 || w < 100 || h < 30)
                fail(
                  "Use one pricing table, at least 100 × 30 mm. Overflow continues on another A4 page.",
                );
              out.font_size = Math.min(out.font_size, 12);
            }
            if (out.type === "totals" && (w < 60 || h < 25))
              fail("Allow at least 60 × 25 mm for the totals.");
            return out;
          }),
        };
      }),
    };
  }
  function field(key, q, d, money, page = 1, count = 1) {
    if (key === "page_number") return String(page);
    if (key === "page_count") return String(count);
    if (["total", "subtotal", "discount_total", "tax_total"].includes(key))
      return money(q[key] || 0);
    if (key === "title" || key === "currency") return q[key] || "";
    return key.split(".").reduce((v, k) => v?.[k], d) || "";
  }
  function resolve(e, q, d, money, page, count) {
    if (e.type === "field")
      return String(field(e.field, q, d, money, page, count));
    return e.text.replace(/\{\{([a-z_.]+)\}\}/g, (full, key) =>
      FIELDS.includes(key)
        ? String(field(key, q, d, money, page, count))
        : full,
    );
  }
  function starter() {
    return normalize({
      pages: [
        {
          elements: [
            {
              id: "brand",
              type: "field",
              field: "seller.name",
              x: 15,
              y: 15,
              w: 130,
              h: 12,
              font_size: 20,
              bold: true,
            },
            {
              id: "rule",
              type: "rectangle",
              x: 15,
              y: 33,
              w: 180,
              h: 1,
              fill: "#2563eb",
            },
            {
              id: "heading",
              type: "field",
              field: "title",
              x: 15,
              y: 42,
              w: 180,
              h: 24,
              font_size: 25,
              bold: true,
            },
            {
              id: "client",
              type: "text",
              text: "Prepared for\n{{buyer.name}}\n{{buyer.email}}",
              x: 15,
              y: 76,
              w: 105,
              h: 24,
              font_size: 11,
            },
            {
              id: "date",
              type: "text",
              text: "Reference: {{reference}}\nDate: {{issued_on}}",
              x: 133,
              y: 76,
              w: 62,
              h: 24,
              font_size: 10,
            },
            {
              id: "pricing",
              type: "items",
              x: 15,
              y: 110,
              w: 180,
              h: 93,
              font_size: 9,
            },
            {
              id: "sum",
              type: "totals",
              x: 115,
              y: 211,
              w: 80,
              h: 32,
              font_size: 10,
              visibility: "last",
            },
            {
              id: "terms",
              type: "field",
              field: "terms",
              x: 15,
              y: 250,
              w: 180,
              h: 25,
              font_size: 9,
              visibility: "last",
            },
            {
              id: "page",
              type: "text",
              text: "{{seller.name}} · {{page_number}} / {{page_count}}",
              x: 15,
              y: 284,
              w: 180,
              h: 6,
              font_size: 8,
              color: "#667085",
            },
          ],
        },
      ],
    });
  }
  return { normalize, resolve, starter, TYPES, FIELDS };
});
