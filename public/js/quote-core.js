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
      JSON.stringify(value).length > 3000000
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
      pricing_mode: value.pricing_mode || "itemized",
      pricing_groups: normalizeGroups(value.pricing_groups || []),
      canvas: value.canvas
        ? (typeof module === "object" && module.exports
            ? require("./quote-canvas-core")
            : globalThis.KlyoCanvasCore
          ).normalize(value.canvas)
        : null,
      sections: value.sections || [
        "scope",
        "items",
        "payment",
        "delivery",
        "terms",
      ],
      headings: Object.fromEntries(
        Object.entries(value.headings || {})
          .filter(([k]) =>
            ["scope", "items", "payment", "delivery", "terms"].includes(k),
          )
          .map(([k, v]) => [k, text(v, 80)]),
      ),
      body_size: Number(value.body_size || 9.5),
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
    if (!["itemized", "total_only"].includes(result.pricing_mode))
      fail("Choose itemized prices or total-only pricing.");
    if (
      !Array.isArray(result.sections) ||
      !result.sections.includes("items") ||
      new Set(result.sections).size !== result.sections.length ||
      result.sections.some(
        (k) => !["scope", "items", "payment", "delivery", "terms"].includes(k),
      )
    )
      fail("Keep pricing in the document and choose valid sections.");
    if (
      !Number.isFinite(result.body_size) ||
      result.body_size < 8 ||
      result.body_size > 12
    )
      fail("Choose a body font size from 8 to 12 points.");
    if (!["studio", "executive", "canvas"].includes(result.layout))
      fail("Choose a document style.");
    if (result.layout === "canvas" && !result.canvas)
      fail("Create an A4 layout first.");
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
    if (
      result.layout === "canvas" &&
      !result.canvas.pages.some((p) =>
        p.elements.some(
          (e) =>
            ["items", "totals"].includes(e.type) ||
            (e.type === "field" && e.field === "total") ||
            (e.type === "text" && e.text.includes("{{total}}")),
        ),
      )
    )
      fail("Add pricing or a total-price field to your A4 design.");
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
  function computeTotals(items, taxRate = 0, discount = {}) {
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
        bundle_id: text(item.bundle_id, 80),
        bundle_name: text(item.bundle_name, 200),
        show_component_price: item.show_component_price === true,
        sku: text(item.sku, 100),
        description: text(item.description, 2000) || "Item",
        quantity,
        unit_price,
        discount_percent,
        line_total: line / 100,
        sort_order: i,
      };
    });
    const itemDiscountCents = subtotalCents - netCents;
    const groups = normalizeGroups(discount.pricing_groups || [], computed);
    const belongs = (item, id) => {
      let k = item.bundle_id;
      while (k) {
        if (k === id) return true;
        k = groups.find((g) => g.id === k)?.parent_id;
      }
      return false;
    };
    const apply = (g) => {
      groups.filter((child) => child.parent_id === g.id).forEach(apply);
      const indexes = computed
        .map((item, i) => (belongs(item, g.id) ? i : -1))
        .filter((i) => i >= 0);
      if (!indexes.length) return;
      const cents = indexes.map((i) =>
          Math.round(computed[i].line_total * 100),
        ),
        total = cents.reduce((a, b) => a + b, 0);
      const amount =
        g.discount_type === "percent"
          ? Math.round((total * g.discount_value) / 100)
          : g.discount_type === "fixed"
            ? Math.round(g.discount_value * 100)
            : 0;
      if (amount > total)
        fail(
          "A group discount cannot exceed its amount after component discounts.",
        );
      const allocations = cents.map((v, i) => ({
        i,
        raw: total ? amount * (v / total) : 0,
      }));
      let left = amount;
      for (const a of allocations) {
        a.value = Math.floor(a.raw);
        left -= a.value;
      }
      [...allocations]
        .sort((a, b) => b.raw - b.value - (a.raw - a.value) || a.i - b.i)
        .slice(0, left)
        .forEach((a) => a.value++);
      allocations.forEach((a) => {
        computed[indexes[a.i]].line_total = (cents[a.i] - a.value) / 100;
      });
    };
    groups.filter((g) => !g.parent_id).forEach(apply);
    const groupedCents = computed.reduce(
      (a, b) => a + Math.round(b.line_total * 100),
      0,
    );
    const groupDiscountCents = netCents - groupedCents;
    netCents = groupedCents;
    const discountType = discount.type || discount.discount_type || "none";
    if (!["none", "percent", "fixed"].includes(discountType))
      fail("Choose a valid quote discount type.");
    const discountValue = number(
      discount.value ?? discount.discount_value ?? 0,
      "quote discount",
      discountType === "percent" ? 100 : 9999999999.99,
    );
    const quoteDiscountCents =
      discountType === "none"
        ? 0
        : discountType === "percent"
          ? Math.round((netCents * discountValue) / 100)
          : Math.round(discountValue * 100);
    if (quoteDiscountCents > netCents)
      fail("The quote discount cannot exceed the amount after line discounts.");
    const lineDiscountTotal = (subtotalCents - netCents) / 100;
    netCents -= quoteDiscountCents;
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
      line_discount_total: lineDiscountTotal,
      item_discount_total: itemDiscountCents / 100,
      group_discount_total: groupDiscountCents / 100,
      pricing_groups: groups,
      discount_type: discountType,
      discount_value: discountType === "none" ? 0 : discountValue,
      quote_discount_total: quoteDiscountCents / 100,
      net_total: netCents / 100,
      tax_rate: tax,
      tax_total: taxCents / 100,
      total: totalCents / 100,
    };
  }
  function normalizeGroups(value = [], items = []) {
    if (!Array.isArray(value) || value.length > 75)
      fail("Use up to 75 pricing groups.");
    const groups = value.map((g) => {
      if (
        !g ||
        typeof g !== "object" ||
        Array.isArray(g) ||
        typeof g.id !== "string" ||
        !/^[-_a-zA-Z0-9]{1,80}$/.test(g.id)
      )
        fail("Invalid pricing group.");
      const type = g.discount_type || "none";
      if (!["none", "percent", "fixed"].includes(type))
        fail("Invalid group discount.");
      if (g.show_total !== undefined && typeof g.show_total !== "boolean")
        fail("Invalid group price visibility.");
      const name = text(g.name, 200);
      if (!name) fail("Give every group a name.");
      return {
        id: g.id,
        name,
        parent_id: text(g.parent_id, 80),
        discount_type: type,
        discount_value: number(
          g.discount_value ?? 0,
          "group discount",
          type === "percent" ? 100 : 9999999999.99,
        ),
        show_total: g.show_total !== false,
      };
    });
    for (const item of items) {
      if (item.bundle_id && !/^[-_a-zA-Z0-9]{1,80}$/.test(item.bundle_id))
        fail("Invalid bundle identifier.");
      if (item.bundle_id && !groups.some((g) => g.id === item.bundle_id))
        groups.push({
          id: item.bundle_id,
          name: item.bundle_name || "Bundle",
          parent_id: "",
          discount_type: "none",
          discount_value: 0,
          show_total: true,
        });
    }
    if (
      groups.length > 75 ||
      new Set(groups.map((g) => g.id)).size !== groups.length
    )
      fail("Pricing groups must have unique IDs.");
    for (const g of groups) {
      let p = g,
        seen = new Set();
      while (p) {
        if (seen.has(p.id) || seen.size >= 4)
          fail("Groups cannot form a cycle or exceed four levels.");
        seen.add(p.id);
        if (!p.parent_id) break;
        p = groups.find((x) => x.id === p.parent_id);
        if (!p) fail("Choose an existing parent group.");
      }
    }
    return groups;
  }
  // Disclosure rows are included in parent totals, never additional charge lines.
  function presentItems(items = [], document = {}, currency = "USD") {
    const groups = normalizeGroups(document.pricing_groups || [], items),
      pl = document.language === "pl",
      hide = document.pricing_mode === "total_only",
      out = [],
      seen = new Set();
    const descendants = (id) =>
      items.filter((item) => {
        let k = item.bundle_id;
        while (k) {
          if (k === id) return true;
          k = groups.find((g) => g.id === k)?.parent_id;
        }
        return false;
      });
    const total = (id) =>
      Math.round(
        descendants(id).reduce((n, i) => n + Number(i.line_total), 0) * 100,
      ) / 100;
    const discount = (g) =>
      !hide && g.discount_type !== "none"
        ? ` (${pl ? "rabat zestawu" : "group discount"} ${g.discount_type === "percent" ? g.discount_value + "%" : money(g.discount_value, currency, document.language)})`
        : "";
    const component = (i) =>
      `${Number(i.quantity)} × ${i.sku ? i.sku + " · " : ""}${i.description}`;
    const walk = (g, depth) => {
      const rows = [];
      for (const child of groups.filter((x) => x.parent_id === g.id))
        if (descendants(child.id).length) {
          rows.push(
            "  ".repeat(depth) +
              child.name +
              discount(child) +
              (!hide && child.show_total
                ? " — " +
                  money(total(child.id), currency, document.language) +
                  " (" +
                  (pl ? "w cenie zestawu" : "included") +
                  ")"
                : ""),
          );
          rows.push(...walk(child, depth + 1));
        }
      for (const i of items.filter((x) => x.bundle_id === g.id))
        rows.push(
          "  ".repeat(depth) +
            component(i) +
            (!hide && i.show_component_price
              ? " — " +
                money(i.line_total, currency, document.language) +
                " (" +
                (pl ? "w cenie zestawu" : "included") +
                ")"
              : ""),
        );
      return rows;
    };
    for (const i of items) {
      if (!i.bundle_id) {
        out.push({
          ...i,
          description: (i.sku ? i.sku + " · " : "") + i.description,
          hide_prices: hide,
        });
        continue;
      }
      let group = groups.find((g) => g.id === i.bundle_id);
      while (group.parent_id)
        group = groups.find((g) => g.id === group.parent_id);
      if (seen.has(group.id)) continue;
      seen.add(group.id);
      const components = walk(group, 0),
        amount = total(group.id);
      out.push({
        ...i,
        quantity: 1,
        unit_price: amount,
        line_total: amount,
        discount_percent: 0,
        components,
        hide_prices: hide || !group.show_total,
        description:
          group.name + discount(group) + "\n" + components.join("\n"),
      });
    }
    return out;
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
    presentItems,
    normalizeGroups,
    labels,
    money,
    reference,
    text,
  };
});
