const db = require("../db"),
  Q = require("../../public/js/quote-core"),
  P = require("./pipelines");
const { invalid, text, optionalId, validDate } = require("./dealWorkspace");
const { normalizeCurrency } = require("./workspaceCurrency");
const money = (v) => {
  const n = Number(v ?? 0);
  if (
    !Number.isFinite(n) ||
    n < 0 ||
    n > 9999999999.99 ||
    Math.abs(n * 100 - Math.round(n * 100)) > 0.0001
  )
    throw invalid("Enter a non-negative amount with up to two decimal places.");
  return n;
};
const owner = (u) => Boolean(u.is_personal || u.is_team_owner);
async function permission(client, user) {
  if (owner(user))
    return { can_view_margin: true, margin_factor: 1, owner: true };
  const p = (
    await client.query(
      "SELECT can_view_margin,margin_factor FROM commercial_permissions WHERE workspace_id=$1 AND user_id=$2",
      [user.workspace_id, user.id],
    )
  ).rows[0];
  return {
    ...(p || { can_view_margin: false, margin_factor: 1 }),
    owner: false,
  };
}
async function requireMargin(client, user) {
  const p = await permission(client, user);
  if (!p.can_view_margin)
    throw invalid("Your team owner has not granted access to margins.", 403);
  return p;
}
async function scoped(client, wid, table, id) {
  const allowed = [
    "companies",
    "contacts",
    "deals",
    "quotes",
    "products",
    "commercial_cases",
    "commercial_statuses",
  ];
  if (!allowed.includes(table)) throw invalid("Invalid record.");
  const r = (
    await client.query(
      `SELECT * FROM ${table} WHERE workspace_id=$1 AND id=$2${table === "deals" ? " AND deleted_at IS NULL" : ""}`,
      [wid, optionalId(id)],
    )
  ).rows[0];
  if (!r) throw invalid("Record not found in this workspace.", 404);
  return r;
}
async function validateUnit(client, wid, id, companyId) {
  if (!id) return null;
  const row = (
    await client.query(
      "SELECT * FROM company_units WHERE id=$1 AND workspace_id=$2",
      [optionalId(id), wid],
    )
  ).rows[0];
  if (!row || row.company_id !== Number(companyId))
    throw invalid("Choose a department or branch of this company.");
  return row.id;
}
async function statuses(client, wid) {
  await client.query(
    `INSERT INTO commercial_statuses(workspace_id,name,color,outcome,paid,sort_order) VALUES($1,'Open','#64748b','open',false,0),($1,'Won','#16a34a','won',false,1),($1,'In progress','#d97706','won',false,2),($1,'Won & paid','#2563eb','won',true,3),($1,'Lost','#dc2626','lost',false,4) ON CONFLICT(workspace_id,name) DO NOTHING`,
    [wid],
  );
  return (
    await client.query(
      "SELECT * FROM commercial_statuses WHERE workspace_id=$1 ORDER BY sort_order,id",
      [wid],
    )
  ).rows;
}
async function nextNumber(client, wid) {
  await client.query("SELECT id FROM workspaces WHERE id=$1 FOR UPDATE", [wid]);
  const year = new Date().getUTCFullYear(),
    prefix = `OF-${year}-`;
  const n =
    (
      await client.query(
        "SELECT number FROM commercial_cases WHERE workspace_id=$1 AND number LIKE $2",
        [wid, prefix + "%"],
      )
    ).rows.reduce((n, r) => {
      const a = r.number.slice(prefix.length);
      return /^\d+$/.test(a) ? Math.max(n, Number(a)) : n;
    }, 0) + 1;
  return prefix + String(n).padStart(5, "0");
}
async function createDeal(client, user, b) {
  const pipeline = await P.ensure(client, user.workspace_id),
    pid = optionalId(b.pipeline_id) || pipeline.id;
  await P.selected(client, user.workspace_id, pid);
  const sid =
    optionalId(b.stage_id) ||
    (
      await client.query(
        "SELECT id FROM pipeline_stages WHERE workspace_id=$1 AND pipeline_id=$2 ORDER BY sort_order,id LIMIT 1",
        [user.workspace_id, pid],
      )
    ).rows[0]?.id ||
    null;
  if (
    sid &&
    !(
      await client.query(
        "SELECT id FROM pipeline_stages WHERE id=$1 AND pipeline_id=$2 AND workspace_id=$3",
        [sid, pid, user.workspace_id],
      )
    ).rows.length
  )
    throw invalid("Choose a stage from the selected pipeline.");
  const deal = (
    await client.query(
      `INSERT INTO deals(workspace_id,title,contact_id,company_id,pipeline_id,stage_id,value,currency,status,assigned_to) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'open',$9) RETURNING *`,
      [
        user.workspace_id,
        b.title,
        b.contact_id || null,
        b.company_id || null,
        pid,
        sid,
        b.value || 0,
        b.currency,
        user.id,
      ],
    )
  ).rows[0];
  await client.query(
    `INSERT INTO deal_events(workspace_id,deal_id,user_id,event_type,to_status,to_pipeline) VALUES($1,$2,$3,'created','open',$4)`,
    [
      user.workspace_id,
      deal.id,
      user.id,
      (await P.selected(client, user.workspace_id, pid)).name,
    ],
  );
  return deal;
}
async function syncQuote(client, user, quote, items, input = {}) {
  const net =
    Math.round((Number(quote.total) - Number(quote.tax_total || 0)) * 100) /
    100;
  let current = (
    await client.query(
      "SELECT * FROM commercial_cases WHERE quote_id=$1 AND workspace_id=$2 FOR UPDATE",
      [quote.id, user.workspace_id],
    )
  ).rows[0];
  let c;
  if (input.commercial_case_id) {
    c = await scoped(
      client,
      user.workspace_id,
      "commercial_cases",
      input.commercial_case_id,
    );
    if (c.quote_id && c.quote_id !== quote.id)
      throw invalid(
        "This commercial case already has an offer. Duplicate the case to prepare another.",
      );
    if (current && current.id !== c.id)
      throw invalid("This offer is already linked to another case.");
    current = c;
  }
  let dealId = Object.hasOwn(input, "deal_id")
    ? optionalId(input.deal_id)
    : current?.deal_id || quote.deal_id;
  if (dealId) {
    const d = await scoped(client, user.workspace_id, "deals", dealId);
    if (d.contact_id && d.contact_id !== quote.contact_id)
      throw invalid("Choose a deal for this offer contact.");
  } else dealId = (await createDeal(client, user, { ...quote, value: net })).id;
  const d = quote.document || {},
    unit = await validateUnit(
      client,
      user.workspace_id,
      Object.hasOwn(input, "company_unit_id")
        ? input.company_unit_id
        : current?.company_unit_id,
      quote.company_id,
    );
  if (!current) {
    const ss = await statuses(client, user.workspace_id);
    current = (
      await client.query(
        `INSERT INTO commercial_cases(workspace_id,number,title,deal_id,quote_id,company_id,contact_id,company_unit_id,status_id,main_products,value,currency,valid_until,payment_terms,delivery_terms,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
        [
          user.workspace_id,
          d.reference || (await nextNumber(client, user.workspace_id)),
          quote.title,
          dealId,
          quote.id,
          quote.company_id,
          quote.contact_id,
          unit,
          ss[0].id,
          items
            .map((i) => i.description)
            .join(", ")
            .slice(0, 10000),
          net,
          quote.currency,
          validDate(d.valid_until),
          d.payment || "",
          d.delivery || "",
          user.id,
        ],
      )
    ).rows[0];
  } else
    current = (
      await client.query(
        `UPDATE commercial_cases SET title=$1,deal_id=$2,quote_id=$3,company_id=$4,contact_id=$5,company_unit_id=$6,main_products=$7,value=$8,currency=$9,valid_until=$10,payment_terms=$11,delivery_terms=$12,updated_at=now() WHERE id=$13 AND workspace_id=$14 RETURNING *`,
        [
          quote.title,
          dealId,
          quote.id,
          quote.company_id,
          quote.contact_id,
          unit,
          items
            .map((i) => i.description)
            .join(", ")
            .slice(0, 10000),
          net,
          quote.currency,
          validDate(d.valid_until),
          d.payment || "",
          d.delivery || "",
          current.id,
          user.workspace_id,
        ],
      )
    ).rows[0];
  if (
    quote.status === "draft" &&
    input.document?.reference &&
    input.document.reference !== current.number
  ) {
    const reference = Q.text(input.document.reference, 60);
    current = (
      await client.query(
        "UPDATE commercial_cases SET number=$1 WHERE id=$2 AND workspace_id=$3 RETURNING *",
        [reference, current.id, user.workspace_id],
      )
    ).rows[0];
  }
  // New drafts share their case number. Existing sent PDF references stay immutable.
  await client.query(
    `UPDATE quotes SET commercial_case_id=$1,deal_id=$2,company_unit_id=$3,document=jsonb_set(document,'{reference}',to_jsonb($4::text)) WHERE id=$5 AND workspace_id=$6 AND status='draft'`,
    [current.id, dealId, unit, current.number, quote.id, user.workspace_id],
  );
  await client.query(
    "UPDATE deals SET title=$1,value=$2,currency=$3,contact_id=$4,company_id=$5,company_unit_id=$6,updated_at=now() WHERE id=$7 AND workspace_id=$8",
    [
      quote.title,
      net,
      quote.currency,
      quote.contact_id,
      quote.company_id,
      unit,
      dealId,
      user.workspace_id,
    ],
  );
  return current;
}
async function snapshotCosts(client, user, quoteId, currency) {
  await client.query(
    `INSERT INTO quote_item_costs(item_id,workspace_id,unit_cost,currency) SELECT i.id,$1,p.unit_cost,$3 FROM quote_line_items i LEFT JOIN product_purchase_prices p ON p.workspace_id=$1 AND p.product_id=i.product_id AND p.currency=$3 WHERE i.quote_id=$2 ON CONFLICT(item_id) DO UPDATE SET unit_cost=EXCLUDED.unit_cost,currency=EXCLUDED.currency`,
    [user.workspace_id, quoteId, currency],
  );
}
async function quoteMargin(client, user, id) {
  const perm = await requireMargin(client, user),
    full = await require("./quoteStore").getFullQuote(
      id,
      user.workspace_id,
      client,
    );
  if (!full) throw invalid("Quote not found.", 404);
  const costs = (
    await client.query(
      "SELECT c.item_id,c.unit_cost FROM quote_item_costs c JOIN quote_line_items i ON i.id=c.item_id WHERE i.quote_id=$1 AND c.workspace_id=$2 AND c.currency=$3",
      [id, user.workspace_id, full.quote.currency],
    )
  ).rows;
  const byId = new Map(costs.map((c) => [c.item_id, c.unit_cost])),
    sum = full.lineItems.reduce((s, i) => s + Number(i.line_total), 0),
    net = Number(full.quote.total) - Number(full.quote.tax_total || 0),
    ratio = sum ? net / sum : 0,
    factor = Number(perm.margin_factor);
  let revenue = 0,
    displayProfit = 0,
    missing = 0;
  const rows = full.lineItems.map((i) => {
    const cost = byId.get(i.id),
      rev = Math.round(Number(i.line_total) * ratio * 100) / 100;
    revenue += rev;
    if (cost == null) {
      missing++;
      return {
        item_id: i.id,
        description: i.description,
        revenue: rev,
        cost_missing: true,
        profit: null,
        margin_percent: null,
        markup_percent: null,
      };
    }
    const profit =
      Math.round((rev - Number(cost) * Number(i.quantity)) * factor * 100) /
      100;
    displayProfit += profit;
    const adjustedCost = rev - profit;
    return {
      item_id: i.id,
      description: i.description,
      revenue: rev,
      cost_missing: false,
      ...(perm.owner ? { unit_cost: Number(cost) } : {}),
      profit,
      margin_percent: rev ? (profit / rev) * 100 : null,
      markup_percent: adjustedCost > 0 ? (profit / adjustedCost) * 100 : null,
    };
  });
  const adjusted = revenue - displayProfit;
  return {
    can_view_margin: true,
    owner: perm.owner,
    ...(perm.owner ? { margin_factor: factor } : {}),
    currency: full.quote.currency,
    rows,
    missing_costs: missing,
    revenue: net,
    profit: missing ? null : Math.round(displayProfit * 100) / 100,
    margin_percent: missing || !net ? null : (displayProfit / net) * 100,
    markup_percent:
      missing || adjusted <= 0 ? null : (displayProfit / adjusted) * 100,
  };
}
async function validateOrderSerials(client, wid, items) {
  if (!Array.isArray(items) || items.length > 150)
    throw invalid("Add valid order items.");
  const ids = [
    ...new Set(items.map((i) => optionalId(i.product_id)).filter(Boolean)),
  ];
  if (!ids.length) return;
  const products = (
    await client.query(
      "SELECT id,serial_required,name FROM products WHERE workspace_id=$1 AND id=ANY($2::int[])",
      [wid, ids],
    )
  ).rows;
  if (products.length !== ids.length)
    throw invalid("An order product is not available in this workspace.");
  const seen = new Set();
  for (const item of items) {
    const product = products.find((p) => p.id === Number(item.product_id));
    if (!product?.serial_required) continue;
    const serials = item.serial_numbers;
    if (
      !Number.isInteger(Number(item.quantity)) ||
      !Array.isArray(serials) ||
      serials.length !== Number(item.quantity)
    )
      throw invalid(`Enter one serial number per unit of ${product.name}.`);
    for (const value of serials) {
      const serial = text(value, 160, "serial number", true),
        key = serial.toLowerCase();
      if (seen.has(key))
        throw invalid("Each serial number in an order must be unique.");
      seen.add(key);
    }
  }
}
async function syncDeal(client, user, deal) {
  const all = await statuses(client, user.workspace_id),
    status = all.find((s) => s.outcome === deal.status && !s.paid);
  await client.query(
    `UPDATE commercial_cases c SET title=$1,contact_id=$2,company_id=$3,value=$4,currency=$5,status_id=CASE WHEN (SELECT outcome FROM commercial_statuses WHERE id=c.status_id)=$6 THEN c.status_id ELSE $7 END,updated_at=now() WHERE c.deal_id=$8 AND c.workspace_id=$9`,
    [
      deal.title,
      deal.contact_id,
      deal.company_id,
      deal.value || 0,
      deal.currency,
      deal.status,
      status?.id || null,
      deal.id,
      user.workspace_id,
    ],
  );
}
async function syncOrder(client, user, order) {
  if (order.kind !== "customer") return;
  const found = (
    await client.query(
      "SELECT * FROM commercial_cases WHERE workspace_id=$1 AND (id=$2 OR quote_id=$3 OR deal_id=$4) ORDER BY CASE WHEN id=$2 THEN 0 WHEN quote_id=$3 THEN 1 ELSE 2 END LIMIT 1",
      [
        user.workspace_id,
        order.case_id || null,
        order.quote_id || null,
        order.deal_id || null,
      ],
    )
  ).rows[0];
  if (!found) return;
  const all = await statuses(client, user.workspace_id),
    paid =
      Number(order.total) > 0 &&
      Number(order.paid_amount) >= Number(order.total),
    inProgress = ["in_progress", "shipped", "delivered", "completed"].includes(
      order.status,
    ),
    cancelled = order.status === "cancelled";
  if (!paid && !inProgress && !cancelled && ["draft"].includes(order.status))
    return;
  const status = paid
    ? all.find((s) => s.paid && s.outcome === "won")
    : cancelled
      ? all.find((s) => s.outcome === "lost")
      : inProgress
        ? all.find(
            (s) =>
              s.outcome === "won" &&
              !s.paid &&
              /progress|realizacji/i.test(s.name),
          ) || all.find((s) => s.outcome === "won" && !s.paid)
        : all.find((s) => s.outcome === "won" && !s.paid);
  if (!status) return;
  await client.query(
    "UPDATE commercial_cases SET status_id=$1,value=$4,currency=$5,updated_at=now() WHERE id=$2 AND workspace_id=$3",
    [status.id, found.id, user.workspace_id, order.total, order.currency],
  );
  if (found.deal_id) {
    const deal = (
      await client.query(
        "SELECT * FROM deals WHERE id=$1 AND workspace_id=$2",
        [found.deal_id, user.workspace_id],
      )
    ).rows[0];
    if (!deal) return;
    await client.query(
      "UPDATE deals SET value=$1,currency=$2,updated_at=now() WHERE id=$3 AND workspace_id=$4",
      [order.total, order.currency, deal.id, user.workspace_id],
    );
    if (deal.status !== status.outcome) {
      await client.query(
        "UPDATE deals SET status=$1,closed_at=COALESCE(closed_at,now()),updated_at=now() WHERE id=$2 AND workspace_id=$3",
        [status.outcome, deal.id, user.workspace_id],
      );
      await client.query(
        "INSERT INTO deal_events(workspace_id,deal_id,user_id,event_type,from_status,to_status,reason)VALUES($1,$2,$3,'changed',$4,$5,$6)",
        [
          user.workspace_id,
          deal.id,
          user.id,
          deal.status,
          status.outcome,
          "Customer order " + order.number,
        ],
      );
    }
  }
}
async function syncQuoteOutcome(client, user, quote, outcome) {
  const record = (
    await client.query(
      "SELECT c.*,s.outcome AS current_outcome FROM commercial_cases c LEFT JOIN commercial_statuses s ON s.id=c.status_id AND s.workspace_id=c.workspace_id WHERE c.quote_id=$1 AND c.workspace_id=$2",
      [quote.id, user.workspace_id],
    )
  ).rows[0];
  if (!record) return;
  const all = await statuses(client, user.workspace_id),
    status = all.find((s) => s.outcome === outcome && !s.paid);
  if (!status) return;
  if (record.current_outcome !== outcome)
    await client.query(
      "UPDATE commercial_cases SET status_id=$1,updated_at=now() WHERE id=$2 AND workspace_id=$3",
      [status.id, record.id, user.workspace_id],
    );
  if (record.deal_id) {
    const deal = (
      await client.query(
        "SELECT * FROM deals WHERE id=$1 AND workspace_id=$2 AND deleted_at IS NULL",
        [record.deal_id, user.workspace_id],
      )
    ).rows[0];
    if (deal && deal.status !== outcome) {
      await client.query(
        "UPDATE deals SET status=$1,lost_reason=$2,closed_at=now(),updated_at=now() WHERE id=$3 AND workspace_id=$4",
        [
          outcome,
          outcome === "lost" ? "Offer declined" : null,
          deal.id,
          user.workspace_id,
        ],
      );
      await client.query(
        "INSERT INTO deal_events(workspace_id,deal_id,user_id,event_type,from_status,to_status,reason)VALUES($1,$2,$3,'changed',$4,$5,$6)",
        [
          user.workspace_id,
          deal.id,
          user.id,
          deal.status,
          outcome,
          "Offer " + Q.reference(quote),
        ],
      );
    }
  }
}
module.exports = {
  syncQuoteOutcome,
  syncOrder,
  syncDeal,
  owner,
  permission,
  requireMargin,
  scoped,
  validateUnit,
  statuses,
  nextNumber,
  createDeal,
  syncQuote,
  snapshotCosts,
  quoteMargin,
  validateOrderSerials,
  money,
};
