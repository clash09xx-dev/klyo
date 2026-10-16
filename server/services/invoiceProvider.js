const crypto = require("crypto"),
  db = require("../db"),
  C = require("./communications"),
  S = require("./sharepoint"),
  Q = require("../../public/js/quote-core"),
  { invalid, text, optionalId, validDate } = require("./dealWorkspace");
async function connection(w) {
  const c = (
    await db.query(
      "SELECT * FROM invoice_provider_connections WHERE workspace_id=$1",
      [w],
    )
  ).rows[0];
  if (!c) throw invalid("Configure Fakturownia first.", 409);
  if (!/^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$/.test(c.subdomain))
    throw invalid("Invalid Fakturownia account.", 409);
  return c;
}
async function api(conn, path, body) {
  if (!/^\/invoices(?:\/[0-9]+)?\.json(?:\?.*)?$/.test(path))
    throw invalid("Invalid invoice route.");
  const url = new URL("https://" + conn.subdomain + ".fakturownia.pl" + path),
    key = S.decrypt(conn.api_token);
  if (!body) url.searchParams.set("api_token", key);
  return (
    await C.request(
      url.href,
      body
        ? {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ api_token: key, ...body }),
          }
        : {},
    )
  ).json();
}
function cents(value) {
  if (
    !["string", "number"].includes(typeof value) ||
    (typeof value === "string" && !value.trim())
  )
    throw invalid("Invalid invoice amount.");
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 999999999999)
    throw invalid("Invalid invoice amount.");
  return BigInt(Math.round(n * 100));
}
function allocate(items, total, tax) {
  const computed = Q.computeTotals(items, 0).computed,
    target = cents(total),
    weights = computed.map((x) => cents(x.line_total)),
    sum = weights.reduce((a, b) => a + b, 0n);
  if (!computed.length) throw invalid("Add order items first.");
  if (sum === 0n && target !== 0n)
    throw invalid(
      "Cannot distribute a nonzero negotiated total over zero-price items.",
    );
  const rows = weights.map((weight, i) => ({
    i,
    net: sum ? (target * weight) / sum : 0n,
    remainder: sum ? (target * weight) % sum : 0n,
  }));
  let remaining = target - rows.reduce((a, b) => a + b.net, 0n);
  const ranked = [...rows].sort((a, b) =>
    a.remainder === b.remainder
      ? a.i - b.i
      : a.remainder > b.remainder
        ? -1
        : 1,
  );
  for (let i = 0; remaining > 0n; i++, remaining--)
    ranked[i % ranked.length].net++;
  if (rows.reduce((a, b) => a + b.net, 0n) !== target)
    throw invalid("Invoice line totals do not match the order.");
  return rows.map((r, i) => ({
    name: String(items[i].name || items[i].description || "Item").slice(
      0,
      1000,
    ),
    description: String(items[i].description || "").slice(0, 2000),
    code: String(items[i].sku || "").slice(0, 100),
    quantity: Number(computed[i].quantity),
    tax,
    total_price_net: (Number(r.net) / 100).toFixed(2),
  }));
}
function fingerprint(invoice) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(invoice))
    .digest("hex");
}
async function preview(user, id, input, client = db, lock = false) {
  const order = (
    await client.query(
      "SELECT * FROM sales_orders WHERE id=$1 AND workspace_id=$2" +
        (lock ? " FOR UPDATE" : ""),
      [optionalId(id), user.workspace_id],
    )
  ).rows[0];
  if (!order) throw invalid("Order not found.", 404);
  if (order.kind !== "customer")
    throw invalid("Create customer invoices from customer orders.");
  if (order.status === "cancelled")
    throw invalid("Do not invoice a cancelled order.");
  const buyer =
    (order.company_id
      ? (
          await client.query(
            "SELECT name FROM companies WHERE id=$1 AND workspace_id=$2",
            [order.company_id, user.workspace_id],
          )
        ).rows[0]?.name
      : null) ||
    (order.contact_id
      ? (
          await client.query(
            "SELECT full_name FROM contacts WHERE id=$1 AND workspace_id=$2",
            [order.contact_id, user.workspace_id],
          )
        ).rows[0]?.full_name
      : null);
  const tax = Number(input.tax_rate);
  if (!Number.isFinite(tax) || tax < 0 || tax > 100)
    throw invalid("Choose the invoice tax percentage.");
  const today = new Date().toISOString().slice(0, 10),
    invoice = {
      kind: "vat",
      issue_date: validDate(input.issue_date) || today,
      sell_date: validDate(input.sell_date) || today,
      payment_to: validDate(input.payment_to) || today,
      currency: order.currency,
      buyer_name: text(
        input.buyer_name || buyer || "",
        300,
        "buyer name",
        true,
      ),
      buyer_tax_no: text(input.buyer_tax_no || "", 100, "buyer tax ID"),
      oid: "klyo-" + user.workspace_id + "-" + order.id,
      description: "CRM order " + order.number,
      calculating_strategy: {
        position: "default",
        sum: "keep_net",
        invoice_form_price_kind: "net",
      },
      positions: allocate(order.items, order.total, tax),
    };
  if (invoice.payment_to < invoice.issue_date)
    throw invalid("Payment deadline must follow issue date.");
  return { order, invoice, preview_token: fingerprint(invoice) };
}
async function create(user, id, input) {
  if (input.confirm_issue !== true)
    throw invalid("Confirm issuance after reviewing the invoice.");
  const conn = await connection(user.workspace_id),
    client = await db.pool.connect();
  let p;
  try {
    await client.query("BEGIN");
    p = await preview(user, id, input, client, true);
    if (input.preview_token !== p.preview_token)
      throw invalid(
        "Order or invoice details changed. Preview the invoice again before issuing.",
        409,
      );
    const reserved = (
      await client.query(
        "INSERT INTO invoice_provider_links(order_id,workspace_id,external_ref,provider_subdomain) VALUES($1,$2,$3,$4) ON CONFLICT(order_id) DO NOTHING RETURNING *",
        [p.order.id, user.workspace_id, p.invoice.oid, conn.subdomain],
      )
    ).rows[0];
    if (!reserved)
      throw invalid(
        "An invoice was already created or may be pending. Refresh status or reconcile the provider invoice ID instead of issuing it again.",
        409,
      );
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
  let result;
  try {
    result = await module.exports.api(conn, "/invoices.json", {
      invoice: p.invoice,
    });
  } catch {
    await db.query(
      "UPDATE invoice_provider_links SET status='needs_reconciliation' WHERE order_id=$1",
      [p.order.id],
    );
    throw invalid(
      "Provider outcome is uncertain. Check Fakturownia for external ID " +
        p.invoice.oid +
        " and link its invoice ID before retrying.",
      409,
    );
  }
  if (!result?.id || !/^[0-9]+$/.test(String(result.id)))
    throw invalid(
      "The invoice provider returned an invalid response. Reconcile the invoice in Fakturownia.",
      502,
    );
  await db.query(
    "UPDATE invoice_provider_links SET provider_id=$1,status='needs_reconciliation' WHERE order_id=$2",
    [String(result.id), p.order.id],
  );
  if (
    result.price_net == null ||
    cents(result.price_net) !== cents(p.order.total) ||
    result.currency !== p.order.currency
  )
    throw invalid(
      "Provider invoice total or currency differs from the reviewed order. Review it in Fakturownia before continuing.",
      409,
    );
  const tx = await db.pool.connect();
  try {
    await tx.query("BEGIN");
    await tx.query("SELECT id FROM workspaces WHERE id=$1 FOR UPDATE", [
      user.workspace_id,
    ]);
    await tx.query(
      "SELECT id FROM sales_orders WHERE id=$1 AND workspace_id=$2 FOR UPDATE",
      [p.order.id, user.workspace_id],
    );
    await tx.query(
      "UPDATE invoice_provider_links SET status='issued' WHERE order_id=$1",
      [p.order.id],
    );
    const order = (
      await tx.query(
        "UPDATE sales_orders SET invoice_number=$1,invoice_issued_at=$2,invoice_due_date=$3,updated_at=now() WHERE id=$4 AND workspace_id=$5 RETURNING *",
        [
          String(result.number || result.id).slice(0, 200),
          p.invoice.issue_date,
          p.invoice.payment_to,
          p.order.id,
          user.workspace_id,
        ],
      )
    ).rows[0];
    await require("./commercial").syncOrder(tx, user, order);
    await tx.query("COMMIT");
  } catch (e) {
    await tx.query("ROLLBACK");
    throw e;
  } finally {
    tx.release();
  }
  return {
    provider_id: String(result.id),
    number: result.number,
    url: "https://" + conn.subdomain + ".fakturownia.pl/invoices/" + result.id,
  };
}
async function status(user, id) {
  const c = await connection(user.workspace_id),
    link = (
      await db.query(
        "SELECT * FROM invoice_provider_links WHERE order_id=$1 AND workspace_id=$2",
        [optionalId(id), user.workspace_id],
      )
    ).rows[0];
  if (!link) throw invalid("No provider invoice linked to this order.", 404);
  if (link.provider_subdomain !== c.subdomain)
    throw invalid(
      "Reconnect the original Fakturownia account for this invoice.",
      409,
    );
  if (!link.provider_id)
    return {
      status: link.status,
      external_ref: link.external_ref,
      needs_reconciliation: true,
    };
  const r = await module.exports.api(
      c,
      "/invoices/" + link.provider_id + ".json",
    ),
    paid = Number(r.paid || 0),
    gross = Number(r.price_gross);
  if (
    !Number.isFinite(paid) ||
    paid < 0 ||
    !Number.isFinite(gross) ||
    gross < 0
  )
    throw invalid("Provider returned invalid payment data.", 502);
  const tx = await db.pool.connect();
  let allocated;
  try {
    await tx.query("BEGIN");
    await tx.query("SELECT id FROM workspaces WHERE id=$1 FOR UPDATE", [
      user.workspace_id,
    ]);
    const order = (
      await tx.query(
        "SELECT * FROM sales_orders WHERE id=$1 AND workspace_id=$2 FOR UPDATE",
        [link.order_id, user.workspace_id],
      )
    ).rows[0];
    if (!order) throw invalid("Order not found.", 404);
    if (
      r.currency !== order.currency ||
      r.price_net == null ||
      cents(r.price_net) !== cents(order.total)
    )
      throw invalid(
        "Provider invoice net amount or currency differs from the order. Reconcile it before syncing payments.",
        409,
      );
    allocated =
      gross > 0
        ? Math.round(Number(order.total) * Math.min(1, paid / gross) * 100) /
          100
        : r.status === "paid"
          ? Number(order.total)
          : 0;
    await tx.query(
      "UPDATE invoice_provider_links SET provider_payment=$1,status='issued' WHERE order_id=$2",
      [
        JSON.stringify({
          number: r.number,
          status: r.status,
          currency: r.currency,
          paid,
          gross,
        }),
        link.order_id,
      ],
    );
    const updated = (
      await tx.query(
        "UPDATE sales_orders SET invoice_number=$1,paid_amount=$2,paid_at=CASE WHEN $3='paid' AND $2 >= total THEN COALESCE(paid_at,now()) ELSE NULL END,updated_at=now() WHERE id=$4 AND workspace_id=$5 RETURNING *",
        [
          String(r.number || link.provider_id).slice(0, 200),
          allocated,
          String(r.status || ""),
          link.order_id,
          user.workspace_id,
        ],
      )
    ).rows[0];
    await require("./commercial").syncOrder(tx, user, updated);
    await tx.query("COMMIT");
  } catch (e) {
    await tx.query("ROLLBACK");
    throw e;
  } finally {
    tx.release();
  }
  return {
    provider_id: link.provider_id,
    number: r.number,
    status: r.status,
    paid,
    order_paid_net: allocated,
    currency: r.currency,
    url:
      "https://" + c.subdomain + ".fakturownia.pl/invoices/" + link.provider_id,
    external_ref: link.external_ref,
  };
}
module.exports = { connection, api, cents, allocate, preview, create, status };
