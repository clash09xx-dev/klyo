const db = require("../db"),
  D = require("./dealWorkspace"),
  spaces = require("./spaces"),
  { normalizeCurrency } = require("./workspaceCurrency");
const fail = (m, s = 400) => {
  throw D.invalid(m, s);
};
const txt = (v, n = 2000) => {
  if (v == null) return "";
  if (typeof v !== "string" || v.length > n)
    fail("Text is too long or invalid.");
  return v.trim();
};
const num = (v, max = 999999999999) => {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n) || n < 0 || n > max)
    fail("Enter a valid non-negative number.");
  return Math.round(n * 100) / 100;
};
const choice = (v, a, f) => {
  v = v ?? f;
  if (!a.includes(v)) fail("Invalid status or type.");
  return v;
};
const id = D.optionalId,
  date = D.validDate;
function stamp(v) {
  if (!v) return null;
  if (v instanceof Date) v = v.toISOString();
  if (typeof v !== "string" || !Number.isFinite(Date.parse(v)))
    fail("Invalid date and time.");
  return new Date(v).toISOString();
}
function url(v) {
  v = txt(v, 2000);
  if (v && !/^https:\/\//i.test(v)) fail("Document links must use HTTPS.");
  return v;
}
async function link(c, w, table, value, allowDeleted = false) {
  const n = id(value);
  if (!n) return null;
  if (table === "users") {
    if (!(await spaces.canLinkUser(c, n, w)))
      fail("This person is not in your workspace.");
  } else if (
    !(
      await c.query(
        `SELECT id FROM ${table} WHERE id=$1 AND workspace_id=$2${table === "deals" && !allowDeleted ? " AND deleted_at IS NULL" : ""}`,
        [n, w],
      )
    ).rows.length
  )
    fail("A linked record is not in your workspace.");
  return n;
}
async function tx(fn) {
  const c = await db.pool.connect();
  try {
    await c.query("BEGIN");
    const r = await fn(c);
    await c.query("COMMIT");
    return r;
  } catch (e) {
    await c.query("ROLLBACK");
    if (e.code === "23505")
      throw D.invalid("This number or serial number is already in use.", 409);
    if (e.code === "23503")
      throw D.invalid("A linked record changed. Refresh and try again.", 409);
    throw e;
  } finally {
    c.release();
  }
}
async function row(c, t, w, n, lock = false) {
  const r = (
    await c.query(
      `SELECT * FROM ${t} WHERE id=$1 AND workspace_id=$2${lock ? " FOR UPDATE" : ""}`,
      [id(n), w],
    )
  ).rows[0];
  if (!r) fail("Record not found.", 404);
  return r;
}
async function save(c, t, w, n, data, user) {
  const f = Object.keys(data),
    v = Object.values(data);
  if (n) {
    v.push(id(n), w);
    return (
      await c.query(
        `UPDATE ${t} SET ${f.map((x, i) => `${x}=$${i + 1}`).join(",")},updated_at=now() WHERE id=$${v.length - 1} AND workspace_id=$${v.length} RETURNING *`,
        v,
      )
    ).rows[0];
  }
  v.push(w, user);
  return (
    await c.query(
      `INSERT INTO ${t}(${f.join(",")},workspace_id,created_by) VALUES(${v.map((_, i) => "$" + (i + 1))}) RETURNING *`,
      v,
    )
  ).rows[0];
}
async function project(user, n, b) {
  return tx(async (c) => {
    await c.query("SELECT id FROM workspaces WHERE id=$1 FOR UPDATE", [
      user.workspace_id,
    ]);
    const p = n ? await row(c, "projects", user.workspace_id, n, true) : {},
      d = { ...p, ...b };
    if (!d.currency)
      d.currency = (
        await c.query("SELECT default_currency FROM workspaces WHERE id=$1", [
          user.workspace_id,
        ])
      ).rows[0]?.default_currency;
    const data = {
      title: txt(d.title, 300),
      description: txt(d.description, 20000),
      kind: choice(
        d.kind,
        ["delivery", "service", "presentation", "internal"],
        "delivery",
      ),
      status: choice(
        d.status,
        ["planned", "active", "on_hold", "completed", "cancelled"],
        "planned",
      ),
      starts_on: date(d.starts_on),
      due_date: date(d.due_date),
      budget: num(d.budget),
      currency: normalizeCurrency(d.currency || "USD"),
      notes: txt(d.notes, 30000),
    };
    if (
      n &&
      data.currency !== p.currency &&
      (
        await c.query(
          "SELECT 1 FROM project_time_entries WHERE workspace_id=$1 AND project_id=$2 UNION ALL SELECT 1 FROM project_resources WHERE workspace_id=$1 AND project_id=$2 AND hourly_cost IS NOT NULL LIMIT 1",
          [user.workspace_id, p.id],
        )
      ).rows.length
    )
      fail(
        "Project currency cannot change after work or hourly costs have been recorded.",
      );
    if (!data.title || !data.currency)
      fail("Enter a project title and currency.");
    if (data.starts_on && data.due_date && data.starts_on > data.due_date)
      fail("Due date must follow the start date.");
    for (const [f, t] of Object.entries({
      deal_id: "deals",
      company_id: "companies",
      contact_id: "contacts",
      assigned_to: "users",
    }))
      data[f] = await link(
        c,
        user.workspace_id,
        t,
        d[f],
        f === "deal_id" && p.deal_id === id(d[f]),
      );
    if (!n && data.deal_id) {
      const existing = (
        await c.query(
          "SELECT * FROM projects WHERE workspace_id=$1 AND deal_id=$2 ORDER BY id LIMIT 1",
          [user.workspace_id, data.deal_id],
        )
      ).rows[0];
      if (existing) return existing;
    }
    return save(c, "projects", user.workspace_id, n, data, user.id);
  });
}
async function task(user, n, b) {
  return tx(async (c) => {
    await c.query("SELECT id FROM workspaces WHERE id=$1 FOR UPDATE", [
      user.workspace_id,
    ]);
    const p = n ? await row(c, "tasks", user.workspace_id, n, true) : {},
      d = { ...p, ...b },
      data = {
        title: txt(d.title, 300),
        description: txt(d.description, 20000),
        due_date: date(d.due_date),
        priority: choice(d.priority, ["low", "medium", "high"], "medium"),
        status: choice(d.status, ["todo", "in_progress", "done"], "todo"),
        urgent: d.urgent === true,
        important: d.important !== false,
        is_milestone: d.is_milestone === true,
        reminder_at: stamp(d.reminder_at),
      };
    if (!data.title) fail("Task title is required.");
    if ((!n || Object.hasOwn(b, "due_date")) && !data.due_date)
      fail("A task due date is required.");
    for (const [f, t] of Object.entries({
      assigned_to: "users",
      contact_id: "contacts",
      company_id: "companies",
      deal_id: "deals",
      project_id: "projects",
      parent_id: "tasks",
    }))
      data[f] = await link(
        c,
        user.workspace_id,
        t,
        d[f],
        f === "deal_id" && p.deal_id === id(d[f]),
      );
    if (data.parent_id) {
      let parent = await row(c, "tasks", user.workspace_id, data.parent_id);
      for (let depth = 0; parent; depth++) {
        if (depth > 30 || Number(parent.id) === Number(n))
          fail("Subtasks cannot form a cycle.");
        if (
          data.project_id &&
          parent.project_id &&
          data.project_id !== parent.project_id
        )
          fail("Subtask must belong to the parent project.");
        data.project_id = data.project_id || parent.project_id;
        parent = parent.parent_id
          ? await row(c, "tasks", user.workspace_id, parent.parent_id)
          : null;
      }
    }
    if (data.reminder_at !== stamp(p.reminder_at))
      data.reminder_dismissed_at = null;
    return save(c, "tasks", user.workspace_id, n, data, user.id);
  });
}
function nextCalibration(last, months) {
  if (!last) return null;
  const d = new Date(last + "T00:00:00Z"),
    day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const end = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0),
  ).getUTCDate();
  d.setUTCDate(Math.min(day, end));
  return d.toISOString().slice(0, 10);
}
async function calibrationTask(c, user, e) {
  if (!e.next_calibration || e.retired) return;
  const key = `equipment-calibration:${e.id}:${date(e.next_calibration)}`;
  await c.query(
    `UPDATE tasks SET status='done',updated_at=now() WHERE workspace_id=$1 AND source_key LIKE $2 AND source_key<>$3 AND status<>'done'`,
    [user.workspace_id, `equipment-calibration:${e.id}:%`, key],
  );
  await c.query(
    `INSERT INTO tasks(workspace_id,title,description,assigned_to,created_by,due_date,priority,urgent,important,reminder_at,source_key) VALUES($1,$2,$3,$4,$5,$6,'high',false,true,$6::date::timestamptz,$7) ON CONFLICT(workspace_id,source_key) WHERE source_key IS NOT NULL DO UPDATE SET assigned_to=EXCLUDED.assigned_to,title=EXCLUDED.title`,
    [
      user.workspace_id,
      `Calibrate ${e.name}`,
      `${e.manufacturer} ${e.model} · ${e.serial_number}`,
      e.assigned_to,
      user.id,
      e.next_calibration,
      key,
    ],
  );
}
async function equipment(user, n, b) {
  return tx(async (c) => {
    const p = n ? await row(c, "equipment", user.workspace_id, n, true) : {},
      d = { ...p, ...b },
      months = Number(d.calibration_months ?? 12);
    if (!Number.isInteger(months) || months < 0 || months > 120)
      fail("Calibration interval must be 0–120 months.");
    const last = date(d.last_calibration),
      data = {
        name: txt(d.name, 300),
        manufacturer: txt(d.manufacturer, 200),
        model: txt(d.model, 200),
        serial_number: txt(d.serial_number, 200),
        last_calibration: last,
        calibration_months: months,
        next_calibration: months ? nextCalibration(last, months) : null,
        technical_condition: choice(
          d.technical_condition,
          ["good", "needs_inspection", "damaged", "repair"],
          "good",
        ),
        inspection_photo: url(d.inspection_photo),
        notes: txt(d.notes, 10000),
        assigned_to: await link(c, user.workspace_id, "users", d.assigned_to),
        retired: d.retired === true,
      };
    if (!data.name) fail("Equipment name is required.");
    const e = await save(c, "equipment", user.workspace_id, n, data, user.id);
    await calibrationTask(c, user, e);
    return e;
  });
}
async function assignment(user, eid, b) {
  return tx(async (c) => {
    const e = await row(c, "equipment", user.workspace_id, eid, true);
    if (e.retired) fail("Retired equipment cannot be assigned.");
    const person = await link(c, user.workspace_id, "users", b.assigned_to);
    if (!person) fail("Choose the person taking the equipment.");
    const start = stamp(b.starts_at),
      end = stamp(b.ends_at);
    if (!start || !end || start >= end)
      fail("Choose a valid reservation period.");
    const conflict = await c.query(
      `SELECT id FROM equipment_assignments WHERE equipment_id=$1 AND workspace_id=$2 AND ((status='checked_out') OR (status='reserved' AND starts_at<$4 AND ends_at>$3))`,
      [e.id, user.workspace_id, start, end],
    );
    if (conflict.rows.length)
      fail(
        "Equipment is already checked out or reserved for this period.",
        409,
      );
    if (
      e.technical_condition === "damaged" ||
      e.technical_condition === "repair"
    )
      fail("This equipment needs repair before it can be used.");
    const projectId = await link(
        c,
        user.workspace_id,
        "projects",
        b.project_id,
      ),
      taskId = await link(c, user.workspace_id, "tasks", b.task_id),
      linkedTask = taskId
        ? await row(c, "tasks", user.workspace_id, taskId)
        : null;
    if (
      projectId &&
      linkedTask?.project_id &&
      projectId !== linkedTask.project_id
    )
      fail("Choose a task from the selected project.");
    return (
      await c.query(
        `INSERT INTO equipment_assignments(workspace_id,equipment_id,project_id,task_id,assigned_to,starts_at,ends_at,notes,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [
          user.workspace_id,
          e.id,
          projectId || linkedTask?.project_id || null,
          taskId,
          person,
          start,
          end,
          txt(b.notes, 10000),
          user.id,
        ],
      )
    ).rows[0];
  });
}
async function moveAssignment(user, n, b) {
  return tx(async (c) => {
    const found = await row(c, "equipment_assignments", user.workspace_id, n);
    await row(c, "equipment", user.workspace_id, found.equipment_id, true);
    const a = await row(c, "equipment_assignments", user.workspace_id, n, true),
      status = choice(b.status, ["checked_out", "returned", "cancelled"]);
    if (status === "checked_out" && a.status !== "reserved")
      fail("Only a reservation can be checked out.");
    if (status === "returned" && a.status !== "checked_out")
      fail("Only checked-out equipment can be returned.");
    if (status === "cancelled" && a.status !== "reserved")
      fail("Return checked-out equipment before cancelling.");
    if (status === "checked_out") {
      if (
        (
          await c.query(
            `SELECT id FROM equipment_assignments WHERE equipment_id=$1 AND status='checked_out' AND id<>$2`,
            [a.equipment_id, a.id],
          )
        ).rows.length
      )
        fail("This equipment is already checked out.", 409);
      const e = await row(c, "equipment", user.workspace_id, a.equipment_id);
      if (e.retired || ["damaged", "repair"].includes(e.technical_condition))
        fail("Equipment is not available.");
    }
    if (status === "returned" && b.technical_condition) {
      const condition = choice(b.technical_condition, [
        "good",
        "needs_inspection",
        "damaged",
        "repair",
      ]);
      await c.query(
        "UPDATE equipment SET technical_condition=$1,updated_at=now() WHERE id=$2 AND workspace_id=$3",
        [condition, a.equipment_id, user.workspace_id],
      );
    }
    const result = (
      await c.query(
        `UPDATE equipment_assignments SET status=$1,checked_out_at=CASE WHEN $1='checked_out' THEN now() ELSE checked_out_at END,returned_at=CASE WHEN $1='returned' THEN now() ELSE returned_at END,checkout_condition=CASE WHEN $1='checked_out' THEN $2 ELSE checkout_condition END,return_condition=CASE WHEN $1='returned' THEN $2 ELSE return_condition END WHERE id=$3 RETURNING *`,
        [status, txt(b.condition, 1000), a.id],
      )
    ).rows[0];
    return result;
  });
}
async function order(user, n, b) {
  return tx(async (c) => {
    await c.query("SELECT id FROM workspaces WHERE id=$1 FOR UPDATE", [
      user.workspace_id,
    ]);
    const p = n ? await row(c, "sales_orders", user.workspace_id, n, true) : {},
      d = { ...p, ...b };
    if (!n && d.quote_id) {
      const q = await row(c, "quotes", user.workspace_id, d.quote_id);
      d.pricing_groups = d.pricing_groups ?? q.document?.pricing_groups ?? [];
      d.title = d.title || q.title;
      d.currency = d.currency || q.currency;
      d.contact_id = d.contact_id || q.contact_id;
      d.company_id = d.company_id || q.company_id;
      d.case_id = d.case_id || q.commercial_case_id;
      d.total =
        d.total ??
        Math.round((Number(q.total) - Number(q.tax_total || 0)) * 100) / 100;
      if (!d.items)
        d.items = (
          await c.query(
            "SELECT * FROM quote_line_items WHERE quote_id=$1 ORDER BY sort_order,id",
            [q.id],
          )
        ).rows;
    }
    if (!n && d.deal_id) {
      const deal = await row(c, "deals", user.workspace_id, d.deal_id);
      if (deal.deleted_at || deal.status !== "won")
        fail(
          "Win the sales opportunity before creating its fulfillment order.",
        );
      d.title = d.title || deal.title;
      d.currency = d.currency || deal.currency;
      d.company_id = d.company_id || deal.company_id;
      d.contact_id = d.contact_id || deal.contact_id;
    }
    if (!d.currency)
      d.currency = (
        await c.query("SELECT default_currency FROM workspaces WHERE id=$1", [
          user.workspace_id,
        ])
      ).rows[0]?.default_currency;
    if (!d.case_id && d.deal_id)
      d.case_id = (
        await c.query(
          "SELECT id FROM commercial_cases WHERE workspace_id=$1 AND deal_id=$2 ORDER BY id DESC LIMIT 1",
          [user.workspace_id, id(d.deal_id)],
        )
      ).rows[0]?.id;
    const items = d.items ?? [];
    if (!Array.isArray(items) || items.length > 150)
      fail("An order can contain up to 150 items.");
    const clean = [];
    for (const item of items) {
      if (!item || typeof item !== "object") fail("Invalid order item.");
      const quantity = num(item.quantity ?? 1, 1000000);
      if (!quantity) fail("Item quantity must be greater than zero.");
      const price = num(item.unit_price);
      const serials = item.serial_numbers ?? [];
      if (!Array.isArray(serials) || serials.length > 10000)
        fail("Invalid serial numbers.");
      if (
        serials.length &&
        (!Number.isInteger(quantity) || serials.length !== quantity)
      )
        fail("Enter one serial number per unit when recording serial numbers.");
      clean.push({
        product_id: await link(
          c,
          user.workspace_id,
          "products",
          item.product_id,
        ),
        name: txt(item.name || item.product_name || item.description, 1000),
        description: txt(
          item.description || item.name || item.product_name,
          2000,
        ),
        sku: txt(item.sku, 100),
        bundle_id: txt(item.bundle_id, 80),
        bundle_name: txt(item.bundle_name, 200),
        show_component_price: item.show_component_price === true,
        discount_percent: num(item.discount_percent, 100),
        quantity,
        unit_price: price,
        serial_numbers: serials.map((s) => txt(s, 200)),
      });
    }
    const totals = require("../../public/js/quote-core").computeTotals(
      clean,
      0,
      { pricing_groups: d.pricing_groups || [] },
    );
    const logistics = d.logistics || {};
    if (typeof logistics !== "object" || Array.isArray(logistics))
      fail("Invalid logistics details.");
    const data = {
      title: txt(d.title, 300),
      number:
        txt(d.number, 60) ||
        `ORD-${new Date().getUTCFullYear()}-${require("crypto").randomBytes(5).toString("hex").toUpperCase()}`,
      kind: choice(d.kind, ["customer", "internal", "supplier"], "customer"),
      status: choice(
        d.status,
        [
          "draft",
          "confirmed",
          "ordered",
          "in_progress",
          "shipped",
          "delivered",
          "completed",
          "cancelled",
        ],
        "draft",
      ),
      supplier_name: txt(d.supplier_name, 300),
      currency: normalizeCurrency(d.currency || "USD"),
      items: JSON.stringify(clean),
      subtotal: totals.subtotal,
      total: num(
        Object.hasOwn(b, "total")
          ? b.total
          : !Object.hasOwn(b, "items") && d.total != null
            ? d.total
            : totals.total,
      ),
      pricing_groups: JSON.stringify(
        require("../../public/js/quote-core").normalizeGroups(
          d.pricing_groups || [],
          clean,
        ),
      ),
      confirmed_delivery_date: date(d.confirmed_delivery_date),
      logistics: JSON.stringify({
        carrier: txt(logistics.carrier, 100),
        tracking_number: txt(logistics.tracking_number, 200),
        delivery_address: txt(logistics.delivery_address, 2000),
        delivery_terms: txt(logistics.delivery_terms, 1000),
        shipping_date: date(logistics.shipping_date),
        notes: txt(logistics.notes, 3000),
      }),
      delivery_acknowledged_at: stamp(d.delivery_acknowledged_at),
      delivery_acknowledged_by: txt(d.delivery_acknowledged_by, 300),
      delivery_document_url: url(d.delivery_document_url),
      invoice_number: txt(d.invoice_number, 200),
      invoice_issued_at: date(d.invoice_issued_at),
      invoice_due_date: date(d.invoice_due_date),
      paid_at: stamp(d.paid_at),
      paid_amount: num(d.paid_amount),
      customer_confirmation: JSON.stringify(
        Object.hasOwn(b, "customer_confirmation")
          ? require("../../public/js/quote-core").normalizeDocument(
              b.customer_confirmation,
            )
          : p.customer_confirmation || {},
      ),
      notes: txt(d.notes, 20000),
    };
    if (!data.title || !data.currency)
      fail("Order title and currency are required.");
    if (data.paid_amount > data.total)
      fail("Payment cannot exceed the order total.");
    if (data.paid_at && data.paid_amount < data.total)
      fail("Enter the full paid amount before marking the invoice paid.");
    if (
      data.invoice_issued_at &&
      data.invoice_due_date &&
      data.invoice_due_date < data.invoice_issued_at
    )
      fail("Invoice due date must follow its issue date.");
    for (const [f, t] of Object.entries({
      project_id: "projects",
      deal_id: "deals",
      quote_id: "quotes",
      company_id: "companies",
      contact_id: "contacts",
    }))
      data[f] = await link(
        c,
        user.workspace_id,
        t,
        d[f],
        f === "deal_id" && p.deal_id === id(d[f]),
      );
    if (
      !n &&
      !data.project_id &&
      data.deal_id &&
      !Object.hasOwn(b, "project_id")
    )
      data.project_id =
        (
          await c.query(
            "SELECT id FROM projects WHERE workspace_id=$1 AND deal_id=$2 ORDER BY id LIMIT 1",
            [user.workspace_id, data.deal_id],
          )
        ).rows[0]?.id || null;
    if (
      n &&
      (p.logistics?.carrier !== logistics.carrier ||
        p.logistics?.tracking_number !== logistics.tracking_number)
    ) {
      data.tracking_snapshot = null;
      data.tracking_checked_at = null;
    }
    data.case_id = d.case_id
      ? await link(c, user.workspace_id, "commercial_cases", d.case_id)
      : null;
    if (
      data.kind === "customer" &&
      data.status !== "draft" &&
      data.status !== "cancelled"
    ) {
      if (!clean.length)
        fail("Add at least one customer order item before confirming.");
      const commercial = require("./commercial");
      if (commercial.validateOrderSerials)
        await commercial.validateOrderSerials(c, user.workspace_id, clean);
    }
    if (
      n &&
      (
        await c.query(
          "SELECT order_id FROM invoice_provider_links WHERE order_id=$1 AND workspace_id=$2",
          [id(n), user.workspace_id],
        )
      ).rows.length
    ) {
      const financial = (items) =>
        JSON.stringify(
          items.map((x) => [
            x.product_id ? Number(x.product_id) : null,
            x.name || x.description || "",
            x.description || x.name || "",
            Number(x.quantity),
            Number(x.unit_price),
            Number(x.discount_percent || 0),
            x.sku || "",
            x.bundle_id || "",
            x.bundle_name || "",
          ]),
        );
      if (
        financial(clean) !== financial(p.items) ||
        data.currency !== p.currency ||
        Number(data.total) !== Number(p.total) ||
        data.company_id !== p.company_id ||
        data.contact_id !== p.contact_id ||
        data.kind !== p.kind
      )
        fail(
          "This order is linked to an issued or pending invoice. Its prices, items, currency and buyer are locked; update logistics or reconcile the invoice instead.",
          409,
        );
    }
    const result = await save(
      c,
      "sales_orders",
      user.workspace_id,
      n,
      data,
      user.id,
    );
    await c.query(
      "DELETE FROM product_serial_allocations WHERE order_id=$1 AND workspace_id=$2",
      [result.id, user.workspace_id],
    );
    if (
      result.kind === "customer" &&
      !["draft", "cancelled"].includes(result.status)
    ) {
      for (const item of clean) {
        if (!item.product_id) continue;
        for (const serial of item.serial_numbers) {
          if (!serial) fail("Enter a valid serial number.");
          await c.query(
            "INSERT INTO product_serial_allocations(workspace_id,product_id,order_id,serial_number) VALUES($1,$2,$3,$4)",
            [user.workspace_id, item.product_id, result.id, serial],
          );
        }
      }
    }
    if (!n || p.status !== result.status)
      await c.query(
        "INSERT INTO order_events(workspace_id,order_id,user_id,event_type,description) VALUES($1,$2,$3,$4,$5)",
        [
          user.workspace_id,
          result.id,
          user.id,
          n ? "status" : "created",
          n ? `${p.status} → ${result.status}` : result.number,
        ],
      );
    await require("./commercial").syncOrder(c, user, result);
    return result;
  });
}
module.exports = {
  project,
  task,
  equipment,
  assignment,
  moveAssignment,
  order,
  calibrationTask,
  nextCalibration,
  tx,
  row,
  link,
  txt,
  url,
  stamp,
  id,
  date,
  fail,
};
