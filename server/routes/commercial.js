const db = require("../db"),
  S = require("../services/commercial"),
  F = require("../services/customFields"),
  Q = require("../../public/js/quote-core");
const {
    invalid,
    text,
    optionalId,
    validDate,
  } = require("../services/dealWorkspace"),
  { normalizeCurrency } = require("../services/workspaceCurrency");
const { requireAuth, requireEditor } = require("../middleware/auth"),
  { requirePaidAccess } = require("../middleware/billing");
const router = require("../middleware/safeRouter")();
router.use(requireAuth, requirePaidAccess);
const transaction = require("../services/quoteStore").transaction;
const own = (req, res, next) =>
  S.owner(req.user)
    ? next()
    : res.status(403).json({
        error:
          "Only the workspace owner can change commercial permissions and purchase prices.",
      });
router.get("/access", async (req, res) => {
  const p = await S.permission(db, req.user);
  res.json({ can_view_margin: p.can_view_margin, owner: p.owner });
});
router.get("/permissions", own, async (req, res) =>
  res.json({
    permissions: (
      await db.query(
        `SELECT u.id,u.name,u.email,COALESCE(p.can_view_margin,false) AS can_view_margin,COALESCE(p.margin_factor,1) AS margin_factor FROM users u LEFT JOIN commercial_permissions p ON p.user_id=u.id AND p.workspace_id=$1 WHERE u.workspace_id=$2 AND ($3::int IS NULL OR u.id=$3) ORDER BY u.name`,
        [
          req.user.workspace_id,
          req.account?.workspace_id ||
            req.user.team_workspace_id ||
            req.user.workspace_id,
          req.user.is_personal ? req.user.id : null,
        ],
      )
    ).rows,
  }),
);
router.put("/permissions/:id", own, async (req, res) => {
  const uid = optionalId(req.params.id),
    factor = Number(req.body.margin_factor ?? 1);
  if (
    typeof req.body.can_view_margin !== "boolean" ||
    !Number.isFinite(factor) ||
    factor < 0 ||
    factor > 10 ||
    Math.abs(factor * 10000 - Math.round(factor * 10000)) > 0.001
  )
    throw invalid("Choose a margin factor between 0 and 10.");
  if (
    !(await require("../services/spaces").canLinkUser(
      db,
      uid,
      req.user.workspace_id,
    ))
  )
    throw invalid("User is not a member of this workspace.");
  await db.query(
    `INSERT INTO commercial_permissions(workspace_id,user_id,can_view_margin,margin_factor) VALUES($1,$2,$3,$4) ON CONFLICT(workspace_id,user_id) DO UPDATE SET can_view_margin=EXCLUDED.can_view_margin,margin_factor=EXCLUDED.margin_factor`,
    [req.user.workspace_id, uid, req.body.can_view_margin, factor],
  );
  res.json({ ok: true });
});
router.get("/purchase-prices", own, async (req, res) =>
  res.json({
    prices: (
      await db.query(
        "SELECT p.*,r.name,r.sku FROM product_purchase_prices p JOIN products r ON r.id=p.product_id AND r.workspace_id=p.workspace_id WHERE p.workspace_id=$1 ORDER BY r.name,p.currency",
        [req.user.workspace_id],
      )
    ).rows,
  }),
);
router.post("/purchase-prices/import", own, async (req, res) => {
  const rows = req.body.rows;
  if (!Array.isArray(rows) || !rows.length || rows.length > 1000)
    throw invalid("Import 1–1000 purchase prices at a time.");
  const currency = normalizeCurrency(req.body.currency);
  if (!currency) throw invalid("Choose a purchase-price currency.");
  let count = 0;
  await transaction(async (c) => {
    await c.query("SELECT id FROM workspaces WHERE id=$1 FOR UPDATE", [
      req.user.workspace_id,
    ]);
    const products = (
        await c.query(
          "SELECT id,name,sku FROM products WHERE workspace_id=$1",
          [req.user.workspace_id],
        )
      ).rows,
      seen = new Set();
    for (const row of rows) {
      if (!row || typeof row !== "object")
        throw invalid("Invalid purchase-price row.");
      const p = row.product_id
        ? products.find((p) => p.id === Number(row.product_id))
        : products.find(
            (p) =>
              row.sku &&
              p.sku.toLowerCase() === String(row.sku).trim().toLowerCase(),
          );
      if (!p)
        throw invalid("Every row must match an existing product by SKU or ID.");
      if (seen.has(p.id)) throw invalid("A product occurs more than once.");
      seen.add(p.id);
      const cost = require("../services/priceLists").price(row.unit_cost);
      await c.query(
        `INSERT INTO product_purchase_prices(workspace_id,product_id,currency,unit_cost,supplier) VALUES($1,$2,$3,$4,$5) ON CONFLICT(workspace_id,product_id,currency) DO UPDATE SET unit_cost=EXCLUDED.unit_cost,supplier=EXCLUDED.supplier,updated_at=now()`,
        [
          req.user.workspace_id,
          p.id,
          currency,
          cost,
          text(row.supplier || "", 300, "supplier"),
        ],
      );
      count++;
    }
  });
  res.json({ imported: count });
});
router.get("/quotes/:id/margins", async (req, res) =>
  res.json(await S.quoteMargin(db, req.user, optionalId(req.params.id))),
);
router.post("/margins/preview", async (req, res) => {
  const permission = await S.requireMargin(db, req.user),
    b = req.body,
    t = Q.computeTotals(b.line_items, b.tax_rate || 0, {
      type: b.discount_type,
      value: b.discount_value,
    }),
    currency = normalizeCurrency(b.currency);
  if (!currency) throw invalid("Choose a supported currency.");
  const ids = [...new Set(t.computed.map((i) => i.product_id).filter(Boolean))],
    products = (
      await db.query(
        "SELECT id FROM products WHERE workspace_id=$1 AND id=ANY($2::int[])",
        [req.user.workspace_id, ids],
      )
    ).rows;
  if (products.length !== ids.length) throw invalid("Product not found.", 404);
  const costs = (
      await db.query(
        "SELECT product_id,unit_cost FROM product_purchase_prices WHERE workspace_id=$1 AND currency=$2 AND product_id=ANY($3::int[])",
        [req.user.workspace_id, currency, ids],
      )
    ).rows,
    byId = new Map(costs.map((p) => [p.product_id, Number(p.unit_cost)])),
    sum = t.computed.reduce((s, i) => s + i.line_total, 0);
  let profit = 0,
    missing = 0;
  const rows = t.computed.map((i, index) => {
    const revenue =
        Math.round((sum ? (i.line_total / sum) * t.net_total : 0) * 100) / 100,
      cost = byId.get(i.product_id);
    if (cost === undefined) {
      missing++;
      return { index, description: i.description, revenue, cost_missing: true };
    }
    const p =
      Math.round(
        (revenue - cost * i.quantity) * Number(permission.margin_factor) * 100,
      ) / 100;
    profit += p;
    return {
      index,
      description: i.description,
      revenue,
      profit: p,
      cost_missing: false,
      ...(permission.owner ? { unit_cost: cost } : {}),
      margin_percent: revenue ? (p / revenue) * 100 : null,
      markup_percent: revenue - p > 0 ? (p / (revenue - p)) * 100 : null,
    };
  });
  res.json({
    rows,
    currency,
    revenue: t.net_total,
    missing_costs: missing,
    profit: missing ? null : Math.round(profit * 100) / 100,
    margin_percent:
      missing || !t.net_total ? null : (profit / t.net_total) * 100,
    markup_percent:
      missing || t.net_total - profit <= 0
        ? null
        : (profit / (t.net_total - profit)) * 100,
  });
});
router.get("/statuses", async (req, res) =>
  res.json({ statuses: await S.statuses(db, req.user.workspace_id) }),
);
router.post("/statuses", requireEditor, async (req, res) => {
  const b = req.body,
    color = b.color || "#64748b";
  if (
    !/^#[a-f0-9]{6}$/i.test(color) ||
    !["open", "won", "lost"].includes(b.outcome || "open")
  )
    throw invalid("Choose a valid color and outcome.");
  const count = Number(
    (
      await db.query(
        "SELECT count(*) FROM commercial_statuses WHERE workspace_id=$1",
        [req.user.workspace_id],
      )
    ).rows[0].count,
  );
  if (count >= 40) throw invalid("Use up to 40 register statuses.");
  res.status(201).json({
    status: (
      await db.query(
        "INSERT INTO commercial_statuses(workspace_id,name,color,outcome,paid,sort_order) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",
        [
          req.user.workspace_id,
          text(b.name, 100, "status name", true),
          color,
          b.outcome || "open",
          Boolean(b.paid),
          count,
        ],
      )
    ).rows[0],
  });
});
router.put("/statuses/:id", requireEditor, async (req, res) => {
  const old = await S.scoped(
      db,
      req.user.workspace_id,
      "commercial_statuses",
      req.params.id,
    ),
    b = { ...old, ...req.body };
  if (
    !/^#[a-f0-9]{6}$/i.test(b.color) ||
    !["open", "won", "lost"].includes(b.outcome)
  )
    throw invalid("Invalid color or outcome.");
  await transaction(async (c) => {
    await c.query("SELECT id FROM workspaces WHERE id=$1 FOR UPDATE", [
      req.user.workspace_id,
    ]);
    await c.query(
      "UPDATE commercial_statuses SET name=$1,color=$2,outcome=$3,paid=$4 WHERE id=$5 AND workspace_id=$6",
      [
        text(b.name, 100, "status name", true),
        b.color,
        b.outcome,
        Boolean(b.paid),
        old.id,
        req.user.workspace_id,
      ],
    );
    const changed = (
      await c.query(
        `SELECT d.* FROM deals d WHERE d.workspace_id=$2 AND d.deleted_at IS NULL AND d.status<>$3 AND EXISTS(SELECT 1 FROM commercial_cases r WHERE r.deal_id=d.id AND r.workspace_id=d.workspace_id AND r.status_id=$1) FOR UPDATE`,
        [old.id, req.user.workspace_id, b.outcome],
      )
    ).rows;
    for (const deal of changed) {
      const reason = "Commercial register status: " + b.name;
      await c.query(
        `UPDATE deals SET status=$1,closed_at=CASE WHEN $1='open' THEN NULL ELSE now() END,lost_reason=$2,updated_at=now() WHERE id=$3 AND workspace_id=$4 AND deleted_at IS NULL`,
        [
          b.outcome,
          b.outcome === "lost" ? reason : null,
          deal.id,
          req.user.workspace_id,
        ],
      );
      await c.query(
        `INSERT INTO deal_events(workspace_id,deal_id,user_id,event_type,from_status,to_status,reason)VALUES($1,$2,$3,'changed',$4,$5,$6)`,
        [
          req.user.workspace_id,
          deal.id,
          req.user.id,
          deal.status,
          b.outcome,
          reason,
        ],
      );
    }
  });
  res.json({ ok: true });
});
router.get("/cases", async (req, res) => {
  const { search, company_id, deal_id } = req.query,
    values = [req.user.workspace_id];
  let filter = "";
  for (const [key, val] of Object.entries({ company_id, deal_id }))
    if (val) {
      values.push(optionalId(val));
      filter += ` AND r.${key}=$${values.length}`;
    }
  if (search) {
    values.push("%" + text(search, 300, "search") + "%");
    filter += ` AND (r.number ILIKE $${values.length} OR r.title ILIKE $${values.length} OR co.name ILIKE $${values.length} OR ct.full_name ILIKE $${values.length})`;
  }
  res.json({
    cases: (
      await db.query(
        `SELECT r.*,ct.full_name AS contact_name,co.name AS company_name,u.name AS unit_name,s.name AS register_status,s.color AS status_color,s.paid,d.status AS deal_status,d.stage_id,p.name AS stage_name FROM commercial_cases r LEFT JOIN contacts ct ON ct.id=r.contact_id AND ct.workspace_id=r.workspace_id LEFT JOIN companies co ON co.id=r.company_id AND co.workspace_id=r.workspace_id LEFT JOIN company_units u ON u.id=r.company_unit_id AND u.workspace_id=r.workspace_id LEFT JOIN commercial_statuses s ON s.id=r.status_id AND s.workspace_id=r.workspace_id LEFT JOIN deals d ON d.id=r.deal_id AND d.workspace_id=r.workspace_id LEFT JOIN pipeline_stages p ON p.id=d.stage_id AND p.workspace_id=r.workspace_id WHERE r.workspace_id=$1${filter} ORDER BY r.updated_at DESC,r.id DESC LIMIT 3000`,
        values,
      )
    ).rows,
  });
});
async function saveCase(user, id, b) {
  return transaction(async (c) => {
    await c.query("SELECT id FROM workspaces WHERE id=$1 FOR UPDATE", [
      user.workspace_id,
    ]);
    const old = id
        ? await S.scoped(c, user.workspace_id, "commercial_cases", id)
        : {},
      contactId = Object.hasOwn(b, "contact_id")
        ? optionalId(b.contact_id)
        : old.contact_id,
      companyId = Object.hasOwn(b, "company_id")
        ? optionalId(b.company_id)
        : old.company_id;
    if (contactId) await S.scoped(c, user.workspace_id, "contacts", contactId);
    if (companyId) await S.scoped(c, user.workspace_id, "companies", companyId);
    if (
      old.quote_id &&
      Object.hasOwn(b, "value") &&
      S.money(b.value) !== Number(old.value)
    )
      throw invalid(
        "Change the amount in the linked offer or the final customer order. The register follows those documents.",
      );
    if (old.quote_id && b.currency && b.currency !== old.currency)
      throw invalid("Change the currency in the linked offer.");
    const unit = await S.validateUnit(
        c,
        user.workspace_id,
        Object.hasOwn(b, "company_unit_id")
          ? b.company_unit_id
          : old.company_unit_id,
        companyId,
      ),
      currency = normalizeCurrency(
        b.currency ||
          old.currency ||
          (
            await c.query(
              "SELECT default_currency FROM workspaces WHERE id=$1",
              [user.workspace_id],
            )
          ).rows[0].default_currency,
      );
    if (!currency) throw invalid("Choose a valid currency.");
    const title = text(b.title ?? old.title, 300, "case title", true),
      value = S.money(b.value ?? old.value);
    let dealId = optionalId(b.deal_id) || old.deal_id;
    if (dealId) await S.scoped(c, user.workspace_id, "deals", dealId);
    else
      dealId = (
        await S.createDeal(c, user, {
          ...b,
          title,
          contact_id: contactId,
          company_id: companyId,
          currency,
          value,
        })
      ).id;
    const ss = await S.statuses(c, user.workspace_id),
      status = await S.scoped(
        c,
        user.workspace_id,
        "commercial_statuses",
        b.status_id || old.status_id || ss[0].id,
      ),
      fields = {
        title,
        deal_id: dealId,
        company_id: companyId || null,
        contact_id: contactId || null,
        company_unit_id: unit,
        status_id: status.id,
        main_products: text(
          b.main_products ?? old.main_products ?? "",
          10000,
          "main products",
        ),
        value,
        currency,
        valid_until: validDate(b.valid_until ?? old.valid_until),
        payment_terms: text(
          b.payment_terms ?? old.payment_terms ?? "",
          1500,
          "payment terms",
        ),
        delivery_terms: text(
          b.delivery_terms ?? old.delivery_terms ?? "",
          1500,
          "delivery terms",
        ),
        notes: text(b.notes ?? old.notes ?? "", 20000, "notes"),
      };
    let row;
    if (id) {
      const keys = Object.keys(fields),
        vals = Object.values(fields);
      vals.push(id, user.workspace_id);
      row = (
        await c.query(
          `UPDATE commercial_cases SET ${keys.map((k, i) => `${k}=$${i + 1}`).join(",")},updated_at=now() WHERE id=$${vals.length - 1} AND workspace_id=$${vals.length} RETURNING *`,
          vals,
        )
      ).rows[0];
    } else {
      fields.workspace_id = user.workspace_id;
      fields.number = await S.nextNumber(c, user.workspace_id);
      fields.created_by = user.id;
      row = (
        await c.query(
          `INSERT INTO commercial_cases(${Object.keys(fields).join(",")}) VALUES(${Object.values(
            fields,
          )
            .map((_, i) => "$" + (i + 1))
            .join(",")}) RETURNING *`,
          Object.values(fields),
        )
      ).rows[0];
    }
    const before = await S.scoped(c, user.workspace_id, "deals", dealId);
    await c.query(
      `UPDATE deals SET title=$1,contact_id=$2,company_id=$3,company_unit_id=$4,value=$5,currency=$6,status=$7,lost_reason=CASE WHEN $7='lost' THEN COALESCE(NULLIF(lost_reason,''),'Commercial register marked lost') ELSE NULL END,closed_at=CASE WHEN $7='open' THEN NULL ELSE COALESCE(closed_at,now()) END,updated_at=now() WHERE id=$8 AND workspace_id=$9`,
      [
        title,
        contactId || null,
        companyId || null,
        unit,
        value,
        currency,
        status.outcome,
        dealId,
        user.workspace_id,
      ],
    );
    if (before.status !== status.outcome)
      await c.query(
        `INSERT INTO deal_events(workspace_id,deal_id,user_id,event_type,from_status,to_status,reason) VALUES($1,$2,$3,'changed',$4,$5,$6)`,
        [
          user.workspace_id,
          dealId,
          user.id,
          before.status,
          status.outcome,
          "Commercial register status: " + status.name,
        ],
      );
    if (row.quote_id) {
      const quote = await S.scoped(
        c,
        user.workspace_id,
        "quotes",
        row.quote_id,
      );
      if (quote.status === "draft")
        await c.query(
          `UPDATE quotes SET title=$1,contact_id=COALESCE($2,contact_id),company_id=$3,company_unit_id=$4,document=jsonb_set(jsonb_set(jsonb_set(document,'{payment}',to_jsonb($5::text)),'{delivery}',to_jsonb($6::text)),'{valid_until}',to_jsonb($7::text)),updated_at=now() WHERE id=$8`,
          [
            title,
            contactId || null,
            companyId || null,
            unit,
            fields.payment_terms,
            fields.delivery_terms,
            fields.valid_until || "",
            quote.id,
          ],
        );
    }
    return row;
  });
}
router.post("/cases", requireEditor, async (req, res) =>
  res
    .status(201)
    .json({ case: await saveCase(req.user, null, req.body || {}) }),
);
router.put("/cases/:id", requireEditor, async (req, res) =>
  res.json({
    case: await saveCase(req.user, optionalId(req.params.id), req.body || {}),
  }),
);
router.get("/companies/:id/details", async (req, res) => {
  const company = await S.scoped(
    db,
    req.user.workspace_id,
    "companies",
    req.params.id,
  );
  res.json({
    company,
    fields: await F.definitions(db, req.user.workspace_id, "company"),
    units: (
      await db.query(
        "SELECT * FROM company_units WHERE company_id=$1 AND workspace_id=$2 ORDER BY kind,name",
        [company.id, req.user.workspace_id],
      )
    ).rows,
  });
});
router.put("/companies/:id/details", requireEditor, async (req, res) => {
  const old = await S.scoped(
      db,
      req.user.workspace_id,
      "companies",
      req.params.id,
    ),
    b = req.body || {},
    fields = {};
  for (const [key, max] of Object.entries({
    tax_id: 80,
    registration_number: 100,
    website: 1000,
    address: 1000,
    postal_code: 50,
    city: 200,
    country: 100,
    phone: 100,
    email: 254,
  }))
    fields[key] = text(b[key] ?? old[key] ?? "", max, key);
  fields.custom_fields = JSON.stringify(
    await F.validate(
      db,
      req.user.workspace_id,
      "company",
      b.custom_fields,
      old.custom_fields,
    ),
  );
  const keys = Object.keys(fields),
    vals = Object.values(fields);
  vals.push(old.id, req.user.workspace_id);
  res.json({
    company: (
      await db.query(
        `UPDATE companies SET ${keys.map((k, i) => `${k}=$${i + 1}`).join(",")},updated_at=now() WHERE id=$${vals.length - 1} AND workspace_id=$${vals.length} RETURNING *`,
        vals,
      )
    ).rows[0],
  });
});
async function saveUnit(user, id, b) {
  return transaction(async (c) => {
    await c.query("SELECT id FROM workspaces WHERE id=$1 FOR UPDATE", [
      user.workspace_id,
    ]);
    const old = id
      ? (
          await c.query(
            "SELECT * FROM company_units WHERE id=$1 AND workspace_id=$2",
            [id, user.workspace_id],
          )
        ).rows[0]
      : null;
    if (id && !old) throw invalid("Department not found.", 404);
    const company = await S.scoped(
      c,
      user.workspace_id,
      "companies",
      b.company_id || old?.company_id,
    );
    if (old && old.company_id !== company.id)
      throw invalid(
        "A branch or department cannot be moved to a different company. Create a new unit instead.",
      );
    const kind = b.kind || old?.kind || "department",
      parent = Object.hasOwn(b, "parent_id")
        ? optionalId(b.parent_id)
        : old?.parent_id || null;
    if (!["branch", "department"].includes(kind))
      throw invalid("Choose a branch or department.");
    if (parent) {
      await S.validateUnit(c, user.workspace_id, parent, company.id);
      const ancestors = (
        await c.query(
          `WITH RECURSIVE a AS(SELECT id,parent_id FROM company_units WHERE id=$1 AND workspace_id=$2 UNION SELECT u.id,u.parent_id FROM company_units u JOIN a ON u.id=a.parent_id WHERE u.workspace_id=$2) SELECT id FROM a`,
          [parent, user.workspace_id],
        )
      ).rows;
      if (id && ancestors.some((a) => a.id === id))
        throw invalid("A department cannot be inside itself.");
    }
    const vals = [
      company.id,
      parent,
      kind,
      text(b.name ?? old?.name, 200, "department name", true),
      text(b.address ?? old?.address ?? "", 1000, "address"),
      text(b.notes ?? old?.notes ?? "", 5000, "notes"),
      user.workspace_id,
    ];
    return id
      ? (
          await c.query(
            "UPDATE company_units SET company_id=$1,parent_id=$2,kind=$3,name=$4,address=$5,notes=$6 WHERE workspace_id=$7 AND id=$8 RETURNING *",
            [...vals, id],
          )
        ).rows[0]
      : (
          await c.query(
            "INSERT INTO company_units(company_id,parent_id,kind,name,address,notes,workspace_id) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *",
            vals,
          )
        ).rows[0];
  });
}
router.post("/units", requireEditor, async (req, res) =>
  res
    .status(201)
    .json({ unit: await saveUnit(req.user, null, req.body || {}) }),
);
router.put("/units/:id", requireEditor, async (req, res) =>
  res.json({
    unit: await saveUnit(req.user, optionalId(req.params.id), req.body || {}),
  }),
);
router.delete("/units/:id", requireEditor, async (req, res) => {
  const r = await db.query(
    "DELETE FROM company_units WHERE id=$1 AND workspace_id=$2 RETURNING id",
    [optionalId(req.params.id), req.user.workspace_id],
  );
  if (!r.rows.length) throw invalid("Department not found.", 404);
  res.json({ ok: true });
});
router.get("/orders/:id/confirmation.pdf", async (req, res) => {
  const order = (
    await db.query(
      "SELECT o.*,w.name AS workspace_name,c.full_name AS contact_name,c.email AS contact_email,co.name AS company_name FROM sales_orders o JOIN workspaces w ON w.id=o.workspace_id LEFT JOIN contacts c ON c.id=o.contact_id AND c.workspace_id=o.workspace_id LEFT JOIN companies co ON co.id=o.company_id AND co.workspace_id=o.workspace_id WHERE o.id=$1 AND o.workspace_id=$2",
      [optionalId(req.params.id), req.user.workspace_id],
    )
  ).rows[0];
  if (!order || order.kind !== "customer")
    throw invalid("Customer order not found.", 404);
  const full = order.quote_id
      ? await require("../services/quoteStore").getFullQuote(
          order.quote_id,
          req.user.workspace_id,
        )
      : null,
    d = Q.normalizeDocument({
      ...full?.quote?.document,
      ...(order.customer_confirmation || {}),
      reference: order.number,
      issued_on: new Date(order.created_at).toISOString().slice(0, 10),
      valid_until: "",
      delivery: order.confirmed_delivery_date
        ? ((order.customer_confirmation?.language ||
            full?.quote?.document?.language) === "pl"
            ? "Potwierdzona dostawa: "
            : "Confirmed delivery: ") + validDate(order.confirmed_delivery_date)
        : full?.quote?.document?.delivery || "",
      footer: (
        (
          order.customer_confirmation?.footer ||
          full?.quote?.document?.footer ||
          ""
        ).slice(0, 240) +
        " · " +
        ((order.customer_confirmation?.language ||
          full?.quote?.document?.language) === "pl"
          ? "Ceny netto, bez VAT."
          : "Net prices, excluding VAT.")
      ).replace(/^ · /, ""),
      seller: order.customer_confirmation?.seller?.name
        ? order.customer_confirmation.seller
        : full?.quote?.document?.seller?.name
          ? full.quote.document.seller
          : { name: order.workspace_name },
      buyer: order.customer_confirmation?.buyer?.name
        ? order.customer_confirmation.buyer
        : {
            name: order.company_name || order.contact_name || "",
            email: order.contact_email || "",
          },
    });
  let items = Q.computeTotals(order.items || [], 0).computed;
  let totals = Q.computeTotals(items, 0);
  const negotiated = S.money(order.total ?? totals.total);
  if (negotiated > totals.total) {
    items.push({
      description:
        d.language === "pl"
          ? "Uzgodniona korekta ceny"
          : "Negotiated price adjustment",
      quantity: 1,
      unit_price: Math.round((negotiated - totals.total) * 100) / 100,
      discount_percent: 0,
    });
    totals = Q.computeTotals(items, 0);
    items = totals.computed;
  }
  const discount = Math.round((totals.total - negotiated) * 100) / 100;
  const quote = {
    ...order,
    ...totals,
    document_kind: "order_confirmation",
    title:
      (d.language === "pl"
        ? "Potwierdzenie zamówienia (ceny netto)"
        : "Order confirmation (net prices)") +
      " · " +
      order.title,
    document: d,
    subtotal: totals.subtotal,
    total: negotiated,
    discount_total: Math.round((totals.discountTotal + discount) * 100) / 100,
    tax_total: 0,
    status: "accepted",
  };
  res
    .set({
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="order-${String(order.id)}.pdf"`,
      "Cache-Control": "private, no-store",
    })
    .send(await require("../services/quotePdf").generateQuotePdf(quote, items));
});
router.use((e, req, res, next) => {
  if (e.code === "23505")
    return res
      .status(409)
      .json({ error: "This case number or status name is already in use." });
  next(e);
});
module.exports = router;
