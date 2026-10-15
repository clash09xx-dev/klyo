// These codes match the workspace currency picker.
const CURRENCIES = new Set([
  "USD", "EUR", "GBP", "PLN", "CHF", "CAD", "AUD", "JPY", "SEK", "NOK",
  "DKK", "CZK", "HUF", "RON", "BGN", "HRK", "INR", "BRL", "MXN", "SGD",
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
    // Updating the workspace first serializes simultaneous currency changes.
    const workspace = await client.query(
      "UPDATE workspaces SET default_currency = $1 WHERE id = $2 RETURNING id",
      [currency, workspaceId]
    );
    if (!workspace.rows.length) throw new Error("Workspace not found.");
    // Also repair legacy records when the selected default was already saved.
    // Numeric amounts are deliberately unchanged.
    await client.query("UPDATE deals SET currency = $1 WHERE workspace_id = $2", [currency, workspaceId]);
    await client.query("UPDATE products SET currency = $1 WHERE workspace_id = $2", [currency, workspaceId]);
    await client.query(
      "UPDATE quotes SET price_list_id = CASE WHEN currency = $1 THEN price_list_id ELSE NULL END, currency = $1 WHERE workspace_id = $2 AND status = 'draft' AND sent_at IS NULL",
      [currency, workspaceId]
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { normalizeCurrency, setWorkspaceCurrency };
