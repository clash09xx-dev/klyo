// Quotation workspace: validated drafts, branded PDF documents and manual email delivery.
const express = require("express"),
  crypto = require("crypto");
const db = require("../db");
const {
  requireAuth,
  requireEditor,
  requireAdmin,
} = require("../middleware/auth");
const { requirePaidAccess } = require("../middleware/billing");
const { sendOfferEmail } = require("../services/mailer");
const { normalizeCurrency } = require("../services/workspaceCurrency");
const Q = require("../../public/js/quote-core");
const S = require("../services/quoteStore");
const {
  generateQuotePdf,
  safeName,
  documentFor,
} = require("../services/quotePdf");
const router = express.Router();
router.use(requireAuth, requirePaidAccess);
router.use((req, res, next) =>
  req.method === "GET" ? next() : requireEditor(req, res, next),
);
const run = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res)).catch(next);
router.param("id", (req, res, next, value) => {
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)))
    return res.status(404).json({ error: "Quote not found." });
  next();
});
const fail = (message, status = 400) => {
  throw Object.assign(new Error(message), { status });
};
const logActivity = (client, workspace, contact, user, type, description) =>
  client.query(
    "INSERT INTO activity_log(workspace_id,contact_id,user_id,type,description) VALUES($1,$2,$3,$4,$5)",
    [workspace, contact, user, type, description],
  );
router.get(
  "/document-defaults",
  run(async (req, res) => {
    const r = await db.query(
      "SELECT name,quote_defaults FROM workspaces WHERE id=$1",
      [req.user.workspace_id],
    );
    if (!r.rows.length) fail("Workspace not found.", 404);
    res.json({ workspace: r.rows[0] });
  }),
);
router.put(
  "/document-defaults",
  requireAdmin,
  run(async (req, res) => {
    const d = Q.normalizeDocument(req.body);
    d.buyer = { name: "", details: "", email: "", phone: "", tax_id: "" };
    d.reference = "";
    d.issued_on = "";
    d.valid_until = "";
    d.scope = "";
    await db.query("UPDATE workspaces SET quote_defaults=$1 WHERE id=$2", [
      JSON.stringify(d),
      req.user.workspace_id,
    ]);
    res.json({ document: d });
  }),
);
// GET /api/quotes — list, optionally filtered to one contact or company
router.get("/", async (req, res) => {
  const { contact_id, company_id, status } = req.query;
  let sql = `
    SELECT q.id,q.title,q.status,q.total,q.currency,q.updated_at,q.created_at,q.contact_id,q.company_id,q.tax_rate,q.tax_total,c.full_name AS contact_name,co.name AS company_name
    FROM quotes q
    JOIN contacts c ON c.id = q.contact_id
    LEFT JOIN companies co ON co.id = q.company_id AND co.workspace_id=q.workspace_id
    WHERE q.workspace_id = $1
  `;
  const params = [req.user.workspace_id];
  if (contact_id) {
    params.push(contact_id);
    sql += ` AND q.contact_id = $${params.length}`;
  }
  if (company_id) {
    params.push(company_id);
    sql += ` AND q.company_id = $${params.length}`;
  }
  if (status) {
    params.push(status);
    sql += ` AND q.status = $${params.length}`;
  }
  sql += ` ORDER BY q.updated_at DESC`;

  const result = await db.query(sql, params);
  res.json({ quotes: result.rows });
});

async function saveDraft(req, id) {
  return S.transaction(async (client) => {
    const existing = id
      ? (
          await client.query(
            "SELECT * FROM quotes WHERE id=$1 AND workspace_id=$2 FOR UPDATE",
            [id, req.user.workspace_id],
          )
        ).rows[0]
      : null;
    if (id && !existing) fail("Quote not found.", 404);
    if (existing && existing.status !== "draft")
      fail("Only draft quotes can be edited.");
    const b = req.body || {},
      contactId = Number(b.contact_id || existing?.contact_id),
      companyId = b.company_id || null;
    const totals = Q.computeTotals(
        b.line_items,
        b.tax_rate ?? existing?.tax_rate ?? 0,
        {type:b.discount_type??existing?.discount_type??'none',value:b.discount_value??existing?.discount_value??0},
      ),
      recipients = b.recipient_ids || [];
    const contact = await S.validateLinks(
      client,
      req.user.workspace_id,
      contactId,
      companyId,
      totals.computed,
      recipients,
    );
    const workspace = (
      await client.query(
        "SELECT name,default_currency,quote_defaults FROM workspaces WHERE id=$1",
        [req.user.workspace_id],
      )
    ).rows[0];
    const currency = normalizeCurrency(
      b.currency ?? existing?.currency ?? workspace.default_currency ?? "USD",
    );
    if (!currency) fail("Choose a supported currency.");
    const d = Q.normalizeDocument({
      ...Q.defaultsDocument(workspace, contact, b.document?.language),
      ...(existing?.document || {}),
      ...(b.document || {}),
    });
    const title = Q.text(b.title, 240) || Q.labels(d.language).quote,
      intro = Q.text(b.intro_message, 6000);
    if (id) {
      await client.query(
        "UPDATE quotes SET title=$1,intro_message=$2,contact_id=$3,company_id=$4,subtotal=$5,discount_total=$6,total=$7,currency=$8,document=$9,tax_rate=$10,tax_total=$11,updated_at=now() WHERE id=$12",
        [
          title,
          intro || null,
          contactId,
          companyId,
          totals.subtotal,
          totals.discountTotal,
          totals.total,
          currency,
          JSON.stringify(d),
          totals.tax_rate,
          totals.tax_total,
          id,
        ],
      );
    } else {
      const r = await client.query(
        "INSERT INTO quotes(workspace_id,contact_id,company_id,created_by,title,intro_message,subtotal,discount_total,total,currency,document,tax_rate,tax_total,public_token) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id",
        [
          req.user.workspace_id,
          contactId,
          companyId,
          req.user.id,
          title,
          intro || null,
          totals.subtotal,
          totals.discountTotal,
          totals.total,
          currency,
          JSON.stringify(d),
          totals.tax_rate,
          totals.tax_total,
          crypto.randomBytes(18).toString("hex"),
        ],
      );
      id = r.rows[0].id;
    }
    await client.query('UPDATE quotes SET discount_type=$1,discount_value=$2,quote_discount_total=$3 WHERE id=$4 AND workspace_id=$5',[totals.discount_type,totals.discount_value,totals.quote_discount_total,id,req.user.workspace_id]);
    await S.replaceItems(client, id, totals.computed, recipients);
    await logActivity(
      client,
      req.user.workspace_id,
      contactId,
      req.user.id,
      existing ? "quote_updated" : "quote_created",
      `${req.user.name} ${existing ? "updated" : "created"} the quote "${title}".`,
    );
    return S.getFullQuote(id, req.user.workspace_id, client);
  });
}
router.post(
  "/",
  run(async (req, res) => res.status(201).json(await saveDraft(req))),
);
router.get(
  "/:id",
  run(async (req, res) => {
    const full = await S.getFullQuote(req.params.id, req.user.workspace_id);
    if (!full) fail("Quote not found.", 404);
    res.json(full);
  }),
);
router.put(
  "/:id",
  run(async (req, res) => res.json(await saveDraft(req, req.params.id))),
);
router.delete(
  "/:id",
  run(async (req, res) => {
    const r = await db.query(
      "DELETE FROM quotes WHERE id=$1 AND workspace_id=$2 RETURNING id",
      [req.params.id, req.user.workspace_id],
    );
    if (!r.rows.length) fail("Quote not found.", 404);
    res.json({ ok: true });
  }),
);
router.get(
  "/:id/pdf",
  run(async (req, res) => {
    const full = await S.getFullQuote(req.params.id, req.user.workspace_id);
    if (!full) fail("Quote not found.", 404);
    const pdf = await generateQuotePdf(full.quote, full.lineItems);
    res
      .set({
        "Content-Type": "application/pdf",
        "Content-Disposition": `${req.query.inline === "1" ? "inline" : "attachment"}; filename="${safeName(full.quote)}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      })
      .send(pdf);
  }),
);
router.post(
  "/:id/duplicate",
  run(async (req, res) => {
    const original = await S.getFullQuote(req.params.id, req.user.workspace_id);
    if (!original) fail("Quote not found.", 404);
    const d = documentFor(original.quote);
    d.reference = "";
    d.issued_on = new Date().toISOString().slice(0, 10);
    d.valid_until = "";
    req.body = {
      ...original.quote,
      title:
        Q.text(String(original.quote.title || "").slice(0, 230), 230) +
        " (copy)",
      line_items: original.lineItems,
      recipient_ids: original.recipients.map((r) => r.id),
      document: d,
    };
    res.status(201).json(await saveDraft(req));
  }),
);
function buildSendableEmail(full) {
  const { quote, lineItems, recipients } = full,
    d = documentFor(quote),
    L = Q.labels(d.language),
    money = (v) => Q.money(v, quote.currency, d.language);
  const lines = [
    d.language === "pl" ? "Dzień dobry," : "Hello,",
    "",
    quote.intro_message || "",
    ...lineItems.map(
      (i) =>
        `${i.description}: ${i.quantity} x ${money(i.unit_price)}${Number(i.discount_percent) ? ` (-${i.discount_percent}%)` : ""} = ${money(i.line_total)}`,
    ),
    "",
  ];
  if (Number(quote.discount_total) > 0)
    lines.push(`${L.discount}: -${money(quote.discount_total)}`);
  if (Number(quote.tax_rate) > 0)
    lines.push(
      `${L.tax} (${Number(quote.tax_rate)}%): ${money(quote.tax_total)}`,
    );
  lines.push(`${L.total}: ${money(quote.total)}`, "", L.emailClosing);
  return {
    to: recipients.length
      ? recipients.map((r) => r.email).filter(Boolean)
      : quote.contact_email
        ? [quote.contact_email]
        : [],
    toNames: recipients.length
      ? recipients.map((r) => r.full_name)
      : [quote.contact_name],
    subject: quote.title || L.quote,
    body: lines.filter((v) => v !== undefined).join("\n"),
    attachment: { filename: safeName(quote) },
    revision: quote.updated_at,
  };
}
router.get(
  "/:id/preview",
  run(async (req, res) => {
    const full = await S.getFullQuote(req.params.id, req.user.workspace_id);
    if (!full) fail("Quote not found.", 404);
    const email = buildSendableEmail(full);
    if (!email.to.length)
      fail("No email address on file for this quote’s recipients.");
    res.json(email);
  }),
);
router.post(
  "/:id/send",
  run(async (req, res) => {
    await S.transaction(async (client) => {
      const locked = await client.query(
        "SELECT id FROM quotes WHERE id=$1 AND workspace_id=$2 FOR UPDATE",
        [req.params.id, req.user.workspace_id],
      );
      if (!locked.rows.length) fail("Quote not found.", 404);
      const full = await S.getFullQuote(
        req.params.id,
        req.user.workspace_id,
        client,
      );
      if (!full) fail("Quote not found.", 404);
      const { quote } = full;
      if (quote.status !== "draft")
        fail(
          "This quote has already been sent. Duplicate it to prepare a new version.",
        );
      if (
        req.body?.revision &&
        new Date(req.body.revision).getTime() !==
          new Date(quote.updated_at).getTime()
      )
        fail(
          "The quote changed after preview. Open a fresh preview before sending.",
          409,
        );
      const email = buildSendableEmail(full);
      if (!email.to.length)
        fail("No email address on file for this quote’s recipients.");
      const subject = Q.text(req.body?.subject ?? email.subject, 500),
        body = Q.text(req.body?.body ?? email.body, 30000);
      if (!subject || !body) fail("Enter an email subject and body.");
      const attachments =
        req.body?.attach_pdf === false
          ? []
          : [
              {
                filename: safeName(quote),
                content: await generateQuotePdf(quote, full.lineItems),
                contentType: "application/pdf",
              },
            ];
      const ws = await client.query(
        "SELECT gmail_refresh_token,smtp_host,smtp_port,smtp_user,smtp_pass,smtp_from_name,smtp_from_email,smtp_secure FROM workspaces WHERE id=$1",
        [req.user.workspace_id],
      );
      try {
        await sendOfferEmail(
          email.to.join(", "),
          subject,
          body,
          ws.rows[0],
          attachments,
        );
      } catch (error) {
        fail(error.message || "Could not send this quote.", 502);
      }
      await client.query(
        "UPDATE quotes SET status='sent',sent_at=now(),updated_at=now() WHERE id=$1",
        [quote.id],
      );
      await logActivity(
        client,
        req.user.workspace_id,
        quote.contact_id,
        req.user.id,
        "quote_sent",
        `${req.user.name} sent the quote "${subject}".`,
      );
    });
    res.json({ ok: true });
  }),
);
router.post(
  "/:id/accept",
  run(async (req, res) => {
    await S.transaction(async (client) => {
      const q = (
        await client.query(
          "SELECT * FROM quotes WHERE id=$1 AND workspace_id=$2 FOR UPDATE",
          [req.params.id, req.user.workspace_id],
        )
      ).rows[0];
      if (!q) fail("Quote not found.", 404);
      if (q.status !== "sent")
        fail("Only a sent quote can be marked accepted.");
      await client.query(
        "UPDATE quotes SET status='accepted',accepted_at=now(),updated_at=now() WHERE id=$1",
        [q.id],
      );
      const items = await client.query(
        "SELECT i.*,p.service_interval_months,p.warranty_months,p.name AS product_name FROM quote_line_items i JOIN products p ON p.id=i.product_id WHERE i.quote_id=$1 AND p.workspace_id=$2",
        [q.id, req.user.workspace_id],
      );
      for (const i of items.rows)
        await client.query(
          "INSERT INTO purchases(workspace_id,contact_id,product_id,quote_id,description,quantity,next_service_due_at) VALUES($1,$2,$3,$4,$5,$6,CASE WHEN $7::int>0 THEN now()+make_interval(months=>$7::int) ELSE NULL END)",
          [
            req.user.workspace_id,
            q.contact_id,
            i.product_id,
            q.id,
            i.description,
            i.quantity,
            i.service_interval_months || 0,
          ],
        );
      for(const i of items.rows.filter(i=>Number(i.warranty_months)>0)){
        const item=await require('../services/warranty').save(client,req.user,null,{contact_id:q.contact_id,product_id:i.product_id,product_name:i.product_name,quantity:i.quantity,warranty_months:i.warranty_months,review_interval_months:i.service_interval_months});
        await client.query('UPDATE warranty_items SET quote_id=$1 WHERE id=$2',[q.id,item.id]);
      }
      await logActivity(
        client,
        req.user.workspace_id,
        q.contact_id,
        req.user.id,
        "quote_accepted",
        `${req.user.name} marked the quote "${q.title}" accepted.`,
      );
    });
    res.json({ ok: true });
  }),
);
router.post(
  "/:id/decline",
  run(async (req, res) => {
    const q = await db.query(
      "UPDATE quotes SET status='declined',updated_at=now() WHERE id=$1 AND workspace_id=$2 AND status='sent' RETURNING contact_id,title",
      [req.params.id, req.user.workspace_id],
    );
    if (!q.rows.length)
      fail("Only a sent quote in this workspace can be declined.");
    await logActivity(
      db,
      req.user.workspace_id,
      q.rows[0].contact_id,
      req.user.id,
      "quote_declined",
      `${req.user.name} marked the quote declined.`,
    );
    res.json({ ok: true });
  }),
);
router.use((error, req, res, next) => {
  if (!error.status) console.error("Quote operation failed:", error.message);
  res
    .status(error.status || 500)
    .json({
      error: error.status
        ? error.message
        : "Could not complete the quote operation.",
    });
});
module.exports = router;
