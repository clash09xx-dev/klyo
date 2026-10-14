const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeCurrency, setWorkspaceCurrency } = require("../server/services/workspaceCurrency");

function fakePool(failAt) {
  const calls = [];
  let released = false;
  const client = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (failAt && sql.includes(failAt)) throw new Error("database failure");
      return { rows: [{ id: 7 }] };
    },
    release() { released = true; },
  };
  return { connect: async () => client, calls, get released() { return released; } };
}

test("currency accepts supported codes and rejects invalid input", () => {
  assert.equal(normalizeCurrency(" pln "), "PLN");
  for (const value of [null, undefined, {}, [], 123, "", "US", "ZZZ", "USD; DROP TABLE deals"])
    assert.equal(normalizeCurrency(value), null);
});

test("currency correction is atomic, scoped and does not change amounts or sent quotes", async () => {
  const pool = fakePool();
  await setWorkspaceCurrency(pool, 7, "PLN");
  assert.equal(pool.calls[0].sql, "BEGIN");
  assert.equal(pool.calls.at(-1).sql, "COMMIT");
  const writes = pool.calls.filter(call => call.sql.startsWith("UPDATE"));
  assert.equal(writes.length, 4);
  for (const { sql, params } of writes) {
    assert.deepEqual(params, ["PLN", 7]);
    assert.match(sql, /WHERE (workspace_id|id) = \$2/);
    assert.doesNotMatch(sql, /SET (value|unit_price|total|subtotal)/);
  }
  assert.match(writes.find(call => call.sql.includes("UPDATE quotes")).sql, /status = 'draft' AND sent_at IS NULL/);
  // Existing records must be repaired even if the default is already PLN.
  assert.doesNotMatch(writes.find(call => call.sql.includes("UPDATE deals")).sql, /AND currency/);
  assert.equal(pool.released, true);
});

test("a failed update rolls the entire currency change back and releases the connection", async () => {
  const pool = fakePool("UPDATE products");
  await assert.rejects(setWorkspaceCurrency(pool, 7, "PLN"), /database failure/);
  assert.equal(pool.calls.at(-1).sql, "ROLLBACK");
  assert.equal(pool.calls.some(call => call.sql === "COMMIT"), false);
  assert.equal(pool.released, true);
});
