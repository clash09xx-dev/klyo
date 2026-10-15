const db = require("../db"),
  Q = require("../../public/js/quote-core"),
  S = require("../services/quoteStore"),
  { normalizeCurrency } = require("../services/workspaceCurrency"),
  { requireAuth, requireEditor } = require("../middleware/auth"),
  { requirePaidAccess } = require("../middleware/billing"),
  { invalid } = require("../services/dealWorkspace");
const router = require("../middleware/safeRouter")();
router.use(requireAuth, requirePaidAccess);
router.get("/", async (req, res) =>
  res.json({
    templates: (
      await db.query(
        "SELECT * FROM quote_templates WHERE workspace_id=$1 AND user_id=$2 ORDER BY name,id",
        [req.user.workspace_id, req.user.id],
      )
    ).rows,
  }),
);
router.post('/preview',requireEditor,async(req,res)=>{
 const b=req.body,d=Q.normalizeDocument(b.document),totals=Q.computeTotals(b.line_items,b.tax_rate||0,{type:b.discount_type,value:b.discount_value});
 const currency=normalizeCurrency(b.currency||'USD');if(!currency)throw invalid('Choose a supported currency.');
 const ids=[...new Set(totals.computed.map(i=>i.product_id).filter(Boolean))];if(ids.length&&(await db.query('SELECT id FROM products WHERE id=ANY($1::int[]) AND workspace_id=$2',[ids,req.user.workspace_id])).rows.length!==ids.length)throw invalid('A product is not available in this workspace.');
 const quote={id:0,title:Q.text(b.title,240),currency,document:d,...totals,discount_total:totals.discountTotal};const pdf=await require('../services/quotePdf').generateQuotePdf(quote,totals.computed);res.set({'Content-Type':'application/pdf','Content-Disposition':'inline; filename="Klyo-template-preview.pdf"','Cache-Control':'no-store'}).send(pdf);
});
async function save(req, id) {
  const name = Q.text(req.body.name, 100);
  if (!name) throw invalid("Name your template.");
  const b = req.body.content || {},
    d = Q.normalizeDocument(b.document || {});
  // Templates never remember a client's identity, quote reference or old dates.
  d.buyer = { name: "", details: "", email: "", phone: "", tax_id: "" };
  d.reference = "";
  d.issued_on = "";
  d.valid_until = "";
  const totals = Q.computeTotals(b.line_items, b.tax_rate || 0, {
    type: b.discount_type,
    value: b.discount_value,
  });
  const ids = totals.computed.map((i) => i.product_id).filter(Boolean);
  if (
    ids.length &&
    (
      await db.query(
        "SELECT id FROM products WHERE workspace_id=$1 AND id=ANY($2::int[])",
        [req.user.workspace_id, ids],
      )
    ).rows.length !== new Set(ids).size
  )
    throw invalid("A template product is not available in this workspace.");
  const currency = normalizeCurrency(b.currency || "USD");
  if (!currency) throw invalid("Choose a supported currency.");
  const content = {
    title: Q.text(b.title, 240),
    intro_message: Q.text(b.intro_message, 6000),
    document: d,
    currency,
    line_items: totals.computed,
    tax_rate: totals.tax_rate,
    discount_type: totals.discount_type,
    discount_value: totals.discount_value,
  };
  try {
    const r = id
      ? await db.query(
          "UPDATE quote_templates SET name=$1,content=$2,updated_at=now() WHERE id=$3 AND workspace_id=$4 AND user_id=$5 RETURNING *",
          [
            name,
            JSON.stringify(content),
            id,
            req.user.workspace_id,
            req.user.id,
          ],
        )
      : await db.query(
          "INSERT INTO quote_templates(workspace_id,user_id,name,content) VALUES($1,$2,$3,$4) RETURNING *",
          [req.user.workspace_id, req.user.id, name, JSON.stringify(content)],
        );
    if (!r.rows.length) throw invalid("Template not found.", 404);
    return r.rows[0];
  } catch (e) {
    if (e.code === "23505")
      throw invalid("A template with this name already exists.", 409);
    throw e;
  }
}
router.post("/", requireEditor, async (req, res) =>
  res.status(201).json({ template: await save(req) }),
);
router.put("/:id", requireEditor, async (req, res) =>
  res.json({ template: await save(req, req.params.id) }),
);
router.delete("/:id", requireEditor, async (req, res) => {
  if (
    !(
      await db.query(
        "DELETE FROM quote_templates WHERE id=$1 AND workspace_id=$2 AND user_id=$3 RETURNING id",
        [req.params.id, req.user.workspace_id, req.user.id],
      )
    ).rows.length
  )
    throw invalid("Template not found.", 404);
  res.json({ ok: true });
});
module.exports = router;
