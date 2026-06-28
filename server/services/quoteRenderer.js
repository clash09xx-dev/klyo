// server/services/quoteRenderer.js
// Generates a self-contained, print-ready HTML page for a quote.
// Used by the public /q/:token route — no auth required.

function esc(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmt(amount, currency) {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency || "USD",
      minimumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${currency || ""} ${Number(amount).toFixed(2)}`;
  }
}

function fmtDate(d) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

function statusBadge(status) {
  const map = {
    draft:    { color: "#6b7280", label: "Draft" },
    sent:     { color: "#3b82f6", label: "Sent" },
    accepted: { color: "#10b981", label: "Accepted" },
    declined: { color: "#ef4444", label: "Declined" },
  };
  const s = map[status] || map.draft;
  return `<span style="display:inline-block; padding:3px 10px; border-radius:99px; background:${s.color}22; color:${s.color}; font-size:12px; font-weight:600; border:1px solid ${s.color}44;">${s.label}</span>`;
}

function renderQuoteHTML(quote, autoPrint = false) {
  const currency = quote.currency || "USD";
  const items = quote.line_items || [];

  const lineRows = items.map(item => `
    <tr>
      <td>${esc(item.description)}</td>
      <td class="num">${Number(item.quantity).toFixed(2)}</td>
      <td class="num">${fmt(item.unit_price, currency)}</td>
      <td class="num">${Number(item.discount_percent) > 0 ? `${Number(item.discount_percent).toFixed(1)}%` : "—"}</td>
      <td class="num bold">${fmt(item.line_total, currency)}</td>
    </tr>`).join("");

  const discountRow = Number(quote.discount_total) > 0
    ? `<tr class="subtotal-row"><td colspan="4" class="right muted">Discounts</td><td class="num muted">−${fmt(quote.discount_total, currency)}</td></tr>`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${esc(quote.title || "Quote")} · ${esc(quote.workspace_name)}</title>
<meta name="robots" content="noindex" />
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: "Inter", sans-serif; font-size: 14px; line-height: 1.6; color: #111827; background: #f9fafb; }
  .page { max-width: 800px; margin: 40px auto; background: #fff; border-radius: 12px; box-shadow: 0 2px 16px rgba(0,0,0,.08); overflow: hidden; }
  .header { padding: 36px 48px 28px; border-bottom: 2px solid #f3f4f6; display: flex; justify-content: space-between; align-items: flex-start; }
  .brand { font-size: 22px; font-weight: 700; color: #111; }
  .header-right { text-align: right; }
  .quote-title { font-size: 20px; font-weight: 700; margin-bottom: 4px; }
  .meta { font-size: 12.5px; color: #6b7280; }
  .body { padding: 32px 48px; }
  .section { margin-bottom: 28px; }
  .section-label { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .06em; color: #9ca3af; margin-bottom: 8px; }
  .to-block { font-size: 15px; font-weight: 600; }
  .to-block .email { font-size: 13px; font-weight: 400; color: #6b7280; }
  .intro { background: #f9fafb; border-left: 3px solid #6366f1; padding: 14px 18px; border-radius: 0 8px 8px 0; font-size: 14px; color: #374151; white-space: pre-wrap; }
  table { width: 100%; border-collapse: collapse; font-size: 13.5px; }
  th { text-align: left; padding: 8px 12px; background: #f9fafb; font-size: 11px; text-transform: uppercase; letter-spacing: .05em; color: #9ca3af; border-bottom: 2px solid #f3f4f6; }
  td { padding: 10px 12px; border-bottom: 1px solid #f3f4f6; vertical-align: top; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .right { text-align: right; }
  .muted { color: #9ca3af; }
  .bold { font-weight: 600; }
  .subtotal-row td { border-bottom: none; padding-top: 4px; padding-bottom: 4px; }
  .total-row td { border-top: 2px solid #111827; font-size: 16px; font-weight: 700; padding-top: 12px; }
  .footer { padding: 24px 48px; background: #f9fafb; border-top: 1px solid #f3f4f6; display: flex; justify-content: space-between; align-items: center; }
  .footer .muted { font-size: 12px; color: #9ca3af; }
  .print-btn { display: inline-flex; align-items: center; gap: 6px; padding: 9px 18px; background: #111827; color: #fff; border: none; border-radius: 7px; font-size: 13px; font-weight: 600; cursor: pointer; }
  @media print {
    body { background: #fff; }
    .page { box-shadow: none; border-radius: 0; margin: 0; max-width: 100%; }
    .print-btn, .no-print { display: none !important; }
    .footer { background: #fff; }
  }
</style>
${autoPrint ? "<script>window.addEventListener('load', () => { setTimeout(() => window.print(), 400); });</script>" : ""}
</head>
<body>
<div class="page">
  <div class="header">
    <div>
      <div class="brand">${esc(quote.workspace_name)}</div>
      <div class="meta" style="margin-top:4px;">Quote · ${fmtDate(quote.created_at)}</div>
      <div style="margin-top:8px;">${statusBadge(quote.status)}</div>
    </div>
    <div class="header-right">
      <div class="quote-title">${esc(quote.title || "Quote")}</div>
      ${quote.sent_at ? `<div class="meta">Sent ${fmtDate(quote.sent_at)}</div>` : ""}
      ${quote.accepted_at ? `<div class="meta" style="color:#10b981;">Accepted ${fmtDate(quote.accepted_at)}</div>` : ""}
    </div>
  </div>

  <div class="body">
    <div class="section">
      <div class="section-label">Prepared for</div>
      <div class="to-block">
        ${esc(quote.contact_name)}
        ${quote.company_name ? `<span class="muted"> · ${esc(quote.company_name)}</span>` : ""}
        ${quote.contact_email ? `<div class="email">${esc(quote.contact_email)}</div>` : ""}
      </div>
    </div>

    ${quote.intro_message ? `
    <div class="section">
      <div class="section-label">Message</div>
      <div class="intro">${esc(quote.intro_message)}</div>
    </div>` : ""}

    <div class="section">
      <table>
        <thead>
          <tr>
            <th style="width:40%;">Description</th>
            <th class="num">Qty</th>
            <th class="num">Unit price</th>
            <th class="num">Discount</th>
            <th class="num">Total</th>
          </tr>
        </thead>
        <tbody>
          ${lineRows}
          <tr class="subtotal-row"><td colspan="4" class="right muted">Subtotal</td><td class="num muted">${fmt(quote.subtotal, currency)}</td></tr>
          ${discountRow}
          <tr class="total-row"><td colspan="4" class="right">Total</td><td class="num">${fmt(quote.total, currency)}</td></tr>
        </tbody>
      </table>
    </div>
  </div>

  <div class="footer">
    <span class="muted">Generated by Klyo · klyolabs.com</span>
    <button class="print-btn no-print" onclick="window.print()">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
      Print / Save PDF
    </button>
  </div>
</div>
</body>
</html>`;
}

module.exports = { renderQuoteHTML };
