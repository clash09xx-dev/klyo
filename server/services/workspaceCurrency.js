// These codes match the workspace currency picker.
const CURRENCIES = new Set([
  "USD",
  "EUR",
  "GBP",
  "PLN",
  "CHF",
  "CAD",
  "AUD",
  "JPY",
  "SEK",
  "NOK",
  "DKK",
  "CZK",
  "HUF",
  "RON",
  "BGN",
  "HRK",
  "INR",
  "BRL",
  "MXN",
  "SGD",
]);
function normalizeCurrency(value) {
  if (typeof value !== "string") return null;
  const code = value.trim().toUpperCase();
  return CURRENCIES.has(code) ? code : null;
}

async function setWorkspaceCurrency(pool, workspaceId, currency) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // All CRM writes acquire the workspace before their document rows. Keep the
    // same order and wait for an in-flight invoice reservation or quote send.
    const workspace = await client.query(
      "UPDATE workspaces SET default_currency = $1 WHERE id = $2 RETURNING id",
      [currency, workspaceId],
    );
    if (!workspace.rows.length) throw new Error("Workspace not found.");
    await client.query(
      "SELECT id FROM sales_orders WHERE workspace_id=$1 ORDER BY id FOR UPDATE",
      [workspaceId],
    );
    await client.query(
      "SELECT id FROM quotes WHERE workspace_id=$1 ORDER BY id FOR UPDATE",
      [workspaceId],
    );
    await client.query(
      "CREATE TEMP TABLE klyo_currency_locks(kind TEXT NOT NULL,id INTEGER NOT NULL,PRIMARY KEY(kind,id)) ON COMMIT DROP",
    );
    // A sent proposal or committed order fixes the currency of its connected
    // case/opportunity/draft documents, even when legacy links are one-sided.
    // Protect the whole connected record set rather than changing one side.
    await client.query(
      `
      WITH RECURSIVE seeds(kind,id) AS (
        SELECT 'quote'::text,id FROM quotes WHERE workspace_id=$1 AND (status<>'draft' OR sent_at IS NOT NULL)
        UNION
        SELECT 'order'::text,o.id FROM sales_orders o WHERE o.workspace_id=$1 AND
          (o.status<>'draft' OR EXISTS(SELECT 1 FROM invoice_provider_links i WHERE i.order_id=o.id AND i.workspace_id=$1))
      ), edges(src,src_id,dst,dst_id) AS (
        SELECT 'quote'::text,q.id,'deal'::text,d.id FROM quotes q JOIN deals d ON d.id=q.deal_id AND d.workspace_id=$1 WHERE q.workspace_id=$1
        UNION SELECT 'quote',q.id,'case',c.id FROM quotes q JOIN commercial_cases c ON c.id=q.commercial_case_id AND c.workspace_id=$1 WHERE q.workspace_id=$1
        UNION SELECT 'case',c.id,'deal',d.id FROM commercial_cases c JOIN deals d ON d.id=c.deal_id AND d.workspace_id=$1 WHERE c.workspace_id=$1
        UNION SELECT 'case',c.id,'quote',q.id FROM commercial_cases c JOIN quotes q ON q.id=c.quote_id AND q.workspace_id=$1 WHERE c.workspace_id=$1
        UNION SELECT 'order',o.id,'deal',d.id FROM sales_orders o JOIN deals d ON d.id=o.deal_id AND d.workspace_id=$1 WHERE o.workspace_id=$1
        UNION SELECT 'order',o.id,'case',c.id FROM sales_orders o JOIN commercial_cases c ON c.id=o.case_id AND c.workspace_id=$1 WHERE o.workspace_id=$1
        UNION SELECT 'order',o.id,'quote',q.id FROM sales_orders o JOIN quotes q ON q.id=o.quote_id AND q.workspace_id=$1 WHERE o.workspace_id=$1
      ), undirected(src,src_id,dst,dst_id) AS (
        SELECT src,src_id,dst,dst_id FROM edges UNION SELECT dst,dst_id,src,src_id FROM edges
      ), locked(kind,id) AS (
        SELECT kind,id FROM seeds
        UNION SELECT e.dst,e.dst_id FROM locked l JOIN undirected e ON e.src=l.kind AND e.src_id=l.id
      ) INSERT INTO klyo_currency_locks(kind,id) SELECT kind,id FROM locked`,
      [workspaceId],
    );
    // Numeric amounts are deliberately unchanged: this corrects the selected
    // denomination; it is never an exchange-rate conversion.
    await client.query(
      "UPDATE deals SET currency = $1 WHERE workspace_id = $2 AND NOT EXISTS(SELECT 1 FROM klyo_currency_locks l WHERE l.kind='deal' AND l.id=deals.id)",
      [currency, workspaceId],
    );
    await client.query(
      "UPDATE products SET currency = $1 WHERE workspace_id = $2",
      [currency, workspaceId],
    );
    await client.query(
      "UPDATE quotes SET price_list_id = CASE WHEN currency = $1 THEN price_list_id ELSE NULL END, updated_at=CASE WHEN currency IS DISTINCT FROM $1 THEN now() ELSE updated_at END, currency = $1 WHERE workspace_id = $2 AND status = 'draft' AND sent_at IS NULL AND NOT EXISTS(SELECT 1 FROM klyo_currency_locks l WHERE l.kind='quote' AND l.id=quotes.id)",
      [currency, workspaceId],
    );
    await client.query(
      "UPDATE commercial_cases SET updated_at=CASE WHEN currency IS DISTINCT FROM $1 THEN now() ELSE updated_at END,currency = $1 WHERE workspace_id = $2 AND NOT EXISTS(SELECT 1 FROM klyo_currency_locks l WHERE l.kind='case' AND l.id=commercial_cases.id)",
      [currency, workspaceId],
    );
    await client.query(
      "UPDATE sales_orders SET updated_at=CASE WHEN currency IS DISTINCT FROM $1 THEN now() ELSE updated_at END,currency = $1 WHERE workspace_id = $2 AND status='draft' AND NOT EXISTS(SELECT 1 FROM klyo_currency_locks l WHERE l.kind='order' AND l.id=sales_orders.id)",
      [currency, workspaceId],
    );
    // Imported price lists and purchase-cost currencies remain source values.
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
module.exports = { normalizeCurrency, setWorkspaceCurrency };
