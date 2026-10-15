/* Shared quotation validation and monetary calculation: browser and server. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.KlyoQuoteCore = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const fail = (message) => {
    throw Object.assign(new Error(message), { status: 400 });
  };
  const text = (value, max = 1000) => {
    if (value == null) return "";
    if (typeof value !== "string" || value.length > max)
      fail(`Text must be under ${max} characters.`);
    return value
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
      .trim();
  };
  const date = (value) => {
    const s = text(value, 10);
    if (
      s &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(s) ||
        !Number.isFinite(Date.parse(s + "T12:00:00Z")) ||
        new Date(s + "T12:00:00Z").toISOString().slice(0, 10) !== s)
    )
      fail("Choose a valid date.");
    return s;
  };
  function normalizeDocument(value = {}) {
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      JSON.stringify(value).length > 450000
    )
      fail("Invalid PDF document settings.");
    const party = (v) => {
      v = v || {};
      return {
        name: text(v.name, 160),
        details: text(v.details, 1600),
        email: text(v.email, 254),
        phone: text(v.phone, 80),
        tax_id: text(v.tax_id, 80),
      };
    };
    const result = {
      version: 1,
      layout: value.layout || "studio",
      accent: value.accent || "#2455d6",
      language: value.language || "en",
      reference: text(value.reference, 60),
      issued_on: date(value.issued_on),
      valid_until: date(value.valid_until),
      seller: party(value.seller),
      buyer: party(value.buyer),
      scope: text(value.scope, 8000),
      payment: text(value.payment, 1500),
      delivery: text(value.delivery, 1500),
      terms: text(value.terms, 6000),
      footer: text(value.footer, 300),
      logo_data_url: text(value.logo_data_url, 400000),
    };
    if (!["studio", "executive"].includes(result.layout))
      fail("Choose a document style.");
    if (!["en", "pl"].includes(result.language))
      fail("Choose Polish or English for the PDF.");
    if (!/^#[a-f\d]{6}$/i.test(result.accent))
      fail("Choose a valid document accent color.");
    if (
      result.logo_data_url &&
      !/^data:image\/(png|jpeg);base64,[a-zA-Z\d+/]+={0,2}$/.test(
        result.logo_data_url,
      )
    )
      fail("Upload a PNG or JPEG logo.");
    if (
      result.issued_on &&
      result.valid_until &&
      result.valid_until < result.issued_on
    )
      fail("The valid-until date must not precede the issue date.");
    return result;
  }
  function defaultsDocument(workspace = {}, contact = {}, language = "en") {
    return normalizeDocument({
      ...workspace.quote_defaults,
      language:
        workspace.quote_defaults?.language || (language === "pl" ? "pl" : "en"),
      issued_on: new Date().toISOString().slice(0, 10),
      reference: "",
      valid_until: "",
      seller: {
        name: workspace.name || "",
        ...(workspace.quote_defaults?.seller || {}),
      },
      buyer: {
        name: contact.company_name || contact.full_name || "",
        details: contact.company_name ? contact.full_name || "" : "",
        email: contact.email || "",
        phone: contact.phone || "",
        tax_id: "",
      },
    });
  }
  function number(value, name, max) {
    if (
      (typeof value !== "number" && typeof value !== "string") ||
      value === "" ||
      !Number.isFinite(Number(value)) ||
      Number(value) < 0 ||
      Number(value) > max ||
      Math.abs(Number(value) * 100 - Math.round(Number(value) * 100)) > 0.0001
    )
      fail(`Enter a valid ${name} with up to two decimal places.`);
    return Number(value);
  }
  function computeTotals(items, taxRate = 0) {
    if (!Array.isArray(items) || !items.length || items.length > 150)
      fail("Add between 1 and 150 line items.");
    const tax = number(taxRate ?? 0, "tax rate", 100);
    let subtotalCents = 0,
      netCents = 0;
    const computed = items.map((item, i) => {
      if (!item || typeof item !== "object") fail("Invalid line item.");
      const quantity = number(item.quantity ?? 1, "quantity", 1000000);
      if (quantity <= 0) fail("Quantity must be greater than zero.");
      const unit_price = number(
          item.unit_price ?? 0,
          "unit price",
          9999999999.99,
        ),
        discount_percent = number(item.discount_percent ?? 0, "discount", 100);
      const gross = Math.round((quantity * unit_price + Number.EPSILON) * 100),
        line = Math.round((gross * (100 - discount_percent)) / 100);
      subtotalCents += gross;
      netCents += line;
      const product_id = item.product_id ? Number(item.product_id) : null;
      if (product_id && (!Number.isSafeInteger(product_id) || product_id < 1))
        fail("Invalid product.");
      return {
        product_id,
        description: text(item.description, 2000) || "Item",
        quantity,
        unit_price,
        discount_percent,
        line_total: line / 100,
        sort_order: i,
      };
    });
    const taxCents = Math.round((netCents * tax) / 100),
      totalCents = netCents + taxCents;
    if (
      !Number.isSafeInteger(totalCents) ||
      subtotalCents > 999999999999 ||
      totalCents > 999999999999
    )
      fail("The quote amount is too large.");
    return {
      computed,
      subtotal: subtotalCents / 100,
      discountTotal: (subtotalCents - netCents) / 100,
      net_total: netCents / 100,
      tax_rate: tax,
      tax_total: taxCents / 100,
      total: totalCents / 100,
    };
  }
  const dictionaries = {
    en: {
      quote: "Proposal",
      reference: "Reference",
      issued: "Issued",
      valid: "Valid until",
      from: "Prepared by",
      to: "Prepared for",
      scope: "Scope of work",
      items: "Your investment",
      description: "Description",
      qty: "Qty",
      price: "Unit price",
      discount: "Discount",
      amount: "Amount",
      subtotal: "Subtotal",
      net: "After discounts",
      tax: "Tax",
      total: "Total",
      payment: "Payment",
      delivery: "Delivery",
      terms: "Terms & notes",
      page: "Page",
      of: "of",
      taxId: "Tax ID",
      download: "Download PDF",
      print: "Print",
      draft: "Draft",
      sent: "Sent",
      accepted: "Accepted",
      declined: "Declined",
      continued: "continued",
      emailClosing:
        "Please review the proposal. Happy to answer any questions.",
    },
    pl: {
      quote: "Oferta",
      reference: "Numer oferty",
      issued: "Data wystawienia",
      valid: "Ważna do",
      from: "Przygotowana przez",
      to: "Przygotowana dla",
      scope: "Zakres współpracy",
      items: "Zakres i wycena",
      description: "Opis",
      qty: "Ilość",
      price: "Cena jedn.",
      discount: "Rabat",
      amount: "Wartość",
      subtotal: "Suma pozycji",
      net: "Po rabatach",
      tax: "Podatek",
      total: "Razem",
      payment: "Płatność",
      delivery: "Termin realizacji",
      terms: "Warunki i uwagi",
      page: "Strona",
      of: "z",
      taxId: "NIP / Tax ID",
      download: "Pobierz PDF",
      print: "Drukuj",
      draft: "Szkic",
      sent: "Wysłana",
      accepted: "Zaakceptowana",
      declined: "Odrzucona",
      continued: "ciąg dalszy",
      emailClosing:
        "Prosimy o zapoznanie się z ofertą. W razie pytań chętnie pomożemy.",
    },
  };
  const labels = (language) => dictionaries[language] || dictionaries.en;
  const money = (amount, currency = "USD", language = "en") =>
    new Intl.NumberFormat(language === "pl" ? "pl-PL" : "en-GB", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
      .format(Number(amount) || 0)
      .replace(/\u00a0/g, " ");
  const reference = (quote) =>
    quote.document?.reference ||
    `OF-${new Date(quote.created_at || Date.now()).getUTCFullYear()}-${String(quote.id).padStart(5, "0")}`;
  return {
    normalizeDocument,
    defaultsDocument,
    computeTotals,
    labels,
    money,
    reference,
    text,
  };
});
