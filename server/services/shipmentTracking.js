const db = require("../db"),
  S = require("./sharepoint"),
  D = require("./dealWorkspace");
async function refresh(user, id) {
  const order = (
    await db.query(
      "SELECT * FROM sales_orders WHERE workspace_id=$1 AND id=$2",
      [user.workspace_id, D.optionalId(id)],
    )
  ).rows[0];
  if (!order) throw D.invalid("Order not found.", 404);
  const carrier = String(order.logistics?.carrier || "")
      .trim()
      .toLowerCase(),
    number = D.text(
      order.logistics?.tracking_number || "",
      100,
      "tracking number",
      true,
    );
  if (carrier !== "dhl")
    throw D.invalid(
      "Live tracking is available for DHL. Other carriers use their tracking portal until an authorized API is configured.",
      409,
    );
  if (
    order.tracking_checked_at &&
    Date.now() - new Date(order.tracking_checked_at).getTime() < 300000
  )
    return {
      snapshot: order.tracking_snapshot,
      checked_at: order.tracking_checked_at,
      cached: true,
    };
  const conn = (
    await db.query(
      "SELECT api_key FROM tracking_connections WHERE workspace_id=$1",
      [user.workspace_id],
    )
  ).rows[0];
  if (!conn)
    throw D.invalid(
      "The workspace owner must connect a DHL Tracking API key first.",
      409,
    );
  const c = await db.pool.connect();
  let held = false;
  try {
    held = (
      await c.query("SELECT pg_try_advisory_lock(9187,$1) AS locked", [
        user.workspace_id,
      ])
    ).rows[0].locked;
    if (!held)
      throw D.invalid("Another shipment is updating. Try again shortly.", 409);
    const last = (
      await c.query(
        "SELECT updated_at FROM tracking_connections WHERE workspace_id=$1",
        [user.workspace_id],
      )
    ).rows[0];
    if (last && Date.now() - new Date(last.updated_at).getTime() < 5100)
      throw D.invalid("Wait a few seconds before the next DHL request.", 429);
    await c.query(
      "UPDATE tracking_connections SET updated_at=now() WHERE workspace_id=$1",
      [user.workspace_id],
    );
    const url = new URL("https://api-eu.dhl.com/track/shipments");
    url.searchParams.set("trackingNumber", number);
    const response = await fetch(url, {
      headers: { "DHL-API-Key": S.decrypt(conn.api_key) },
      redirect: "error",
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok)
      throw D.invalid(
        response.status === 429
          ? "DHL request limit reached. Try later."
          : "DHL could not find or authorize this shipment.",
        response.status === 429 ? 429 : 502,
      );
    const raw = await response.json(),
      shipment =
        raw.shipments?.find((s) => String(s.id) === number) ||
        raw.shipments?.[0];
    if (!shipment) throw D.invalid("No DHL tracking data was returned.", 404);
    const clean = (v) => String(v || "").slice(0, 1000),
      event = (e) => ({
        timestamp: clean(e?.timestamp),
        status: clean(e?.statusCode || e?.status),
        description: clean(e?.description),
        location: clean(e?.location?.address?.addressLocality),
      });
    const snapshot = {
      carrier: "dhl",
      tracking_number: number,
      status: event(shipment.status),
      estimated_delivery: clean(shipment.estimatedTimeOfDelivery),
      events: (shipment.events || []).slice(0, 100).map(event),
    };
    // Carrier delivery and customer acceptance are separate facts. Do not mark a signed acceptance or payment from tracking data.
    const saved = (
      await c.query(
        "UPDATE sales_orders SET tracking_snapshot=$1,tracking_checked_at=now() WHERE id=$2 AND workspace_id=$3 AND logistics->>'tracking_number'=$4 AND lower(logistics->>'carrier')=$5 RETURNING tracking_checked_at",
        [
          JSON.stringify(snapshot),
          order.id,
          user.workspace_id,
          number,
          carrier,
        ],
      )
    ).rows[0];
    if (!saved)
      throw D.invalid("Shipment details changed. Reload the order.", 409);
    return { snapshot, checked_at: saved.tracking_checked_at };
  } finally {
    if (held)
      await c
        .query("SELECT pg_advisory_unlock(9187,$1)", [user.workspace_id])
        .catch(() => {});
    c.release();
  }
}
module.exports = { refresh };
