const test = require('node:test');
const assert = require('node:assert/strict');

// Opt in with a disposable PostgreSQL connection. Fixtures live in their own schema.
test('currency API persists values, isolates workspaces and rolls back failures in PostgreSQL', {
  skip: !process.env.TEST_DATABASE_URL,
}, async t => {
  const { Pool } = require('pg');
  const schema = `klyo_qa_${process.pid}_${Date.now()}`;
  const admin = new Pool({ connectionString: process.env.TEST_DATABASE_URL, ssl: false });
  await admin.query(`CREATE SCHEMA ${schema}`);
  const url = new URL(process.env.TEST_DATABASE_URL);
  url.searchParams.set('options', `-c search_path=${schema}`);
  process.env.DATABASE_URL = url.toString();
  process.env.PGSSL = 'false';
  process.env.JWT_SECRET = 'test-only-secret';
  const db = require('../server/db');
  let server;
  try {
    await db.init();
    await db.query("INSERT INTO workspaces (id, name, invite_code, is_comped) VALUES (1, 'Fixture A', 'TESTA', true), (2, 'Fixture B', 'TESTB', true)");
    await db.query("INSERT INTO users (id, workspace_id, name, email, role, password_hash) VALUES (1, 1, 'Admin', 'a@example.test', 'admin', 'fixture')");
    await db.query("INSERT INTO contacts (id, workspace_id, full_name, email) VALUES (1, 1, 'Client A', 'client@example.test'), (2, 2, 'Client B', 'b@example.test')");
    await db.query("INSERT INTO deals (workspace_id, title, value, currency) VALUES (1, 'Existing deal', 4500, 'USD'), (2, 'Other deal', 500, 'USD')");
    await db.query("INSERT INTO products (workspace_id, name, unit_price) VALUES (1, 'Website', 4500), (2, 'Other product', 500)");
    await db.query("INSERT INTO quotes (workspace_id, contact_id, title, total, status, sent_at) VALUES (1,1,'Draft',4500,'draft',NULL), (1,1,'Sent',4500,'sent',now()), (2,2,'Other draft',500,'draft',NULL)");
    const express = require('express');
    const jwt = require('jsonwebtoken');
    const app = express();
    app.use(express.json());
    app.use('/api/auth', require('../server/routes/auth'));
    app.use('/api/quotes', require('../server/routes/quotes'));
    app.use('/api/deals', require('../server/routes/deals'));
    app.use('/api/products', require('../server/routes/products'));
    server = await new Promise(resolve => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
    const base = `http://127.0.0.1:${server.address().port}`;
    const token = role => jwt.sign({ id: 1, workspace_id: 1, name: 'Admin', role }, process.env.JWT_SECRET);
    async function request(endpoint, method = 'GET', body, role = 'admin') {
      const response = await fetch(base + '/api' + endpoint, {
        method, headers: { 'Content-Type': 'application/json', ...(role ? { Authorization: `Bearer ${token(role)}` } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: response.status, data: await response.json() };
    }

    await t.test('only authenticated admins can change to supported currencies', async () => {
      assert.equal((await request('/auth/workspace/currency', 'PUT', { currency: 'PLN' }, null)).status, 401);
      assert.equal((await request('/auth/workspace/currency', 'PUT', { currency: 'PLN' }, 'member')).status, 403);
      for (const currency of [{}, '', 'ZZZ']) assert.equal((await request('/auth/workspace/currency', 'PUT', { currency })).status, 400);
      assert.equal((await request('/auth/workspace/settings')).data.workspace.default_currency, 'USD');
    });
    await t.test('existing 4500 USD becomes 4500 PLN and other workspaces and sent quotes stay intact', async () => {
      assert.equal((await request('/auth/workspace/currency', 'PUT', { currency: ' pln ' })).status, 200);
      assert.equal((await request('/auth/workspace/settings')).data.workspace.default_currency, 'PLN');
      assert.deepEqual((await db.query('SELECT workspace_id, value, currency FROM deals ORDER BY workspace_id')).rows,
        [{ workspace_id: 1, value: '4500.00', currency: 'PLN' }, { workspace_id: 2, value: '500.00', currency: 'USD' }]);
      assert.deepEqual((await db.query('SELECT workspace_id, unit_price, currency FROM products ORDER BY workspace_id')).rows,
        [{ workspace_id: 1, unit_price: '4500.00', currency: 'PLN' }, { workspace_id: 2, unit_price: '500.00', currency: 'USD' }]);
      assert.deepEqual((await db.query('SELECT title, total, currency FROM quotes ORDER BY id')).rows,
        [{ title: 'Draft', total: '4500.00', currency: 'PLN' }, { title: 'Sent', total: '4500.00', currency: 'USD' }, { title: 'Other draft', total: '500.00', currency: 'USD' }]);
      // Correct records left behind by the old default-only implementation.
      await db.query("UPDATE deals SET currency='USD' WHERE workspace_id=1");
      await request('/auth/workspace/currency', 'PUT', { currency: 'PLN' });
      assert.equal((await db.query('SELECT currency FROM deals WHERE workspace_id=1')).rows[0].currency, 'PLN');
    });
    await t.test('new deals and products use the workspace currency and retain it on edits', async () => {
      const created = await request('/deals', 'POST', { title: 'New deal', value: 4500 });
      assert.equal(created.status, 201);
      assert.equal(created.data.deal.currency, 'PLN');
      const edited = await request(`/deals/${created.data.deal.id}`, 'PUT', { title: 'Updated deal', value: 4500 });
      assert.equal(edited.data.deal.currency, 'PLN');
      const product = await request('/products', 'POST', { name: 'New product', unit_price: 4500 });
      assert.equal(product.status, 201);
      assert.equal(product.data.product.currency, 'PLN');
      const updated = await request(`/products/${product.data.product.id}`, 'PUT', { name: 'Updated product', unit_price: 4500 });
      assert.equal(updated.data.product.currency, 'PLN');
    });
    await t.test('new quotes honor default currency, explicit currency and draft edits', async () => {
      const body = { contact_id: 1, title: 'New quote', line_items: [{ description: 'Website', quantity: 1, unit_price: 4500 }] };
      const created = await request('/quotes', 'POST', body);
      assert.equal(created.status, 201);
      assert.equal(created.data.quote.currency, 'PLN');
      assert.equal(created.data.quote.total, '4500.00');
      const edited = await request(`/quotes/${created.data.quote.id}`, 'PUT', { ...body, currency: 'EUR' });
      assert.equal(edited.data.quote.currency, 'EUR');
      assert.equal(edited.data.quote.total, '4500.00');
      const explicit = await request('/quotes', 'POST', { ...body, currency: 'GBP' });
      assert.equal(explicit.data.quote.currency, 'GBP');
      const preview = await request(`/quotes/${created.data.quote.id}/preview`);
      assert.match(preview.data.body, /€4,500\.00/);
      assert.doesNotMatch(preview.data.body, /\$/);
      assert.equal((await request('/quotes', 'POST', { ...body, currency: 'ZZZ' })).status, 400);
    });
    await t.test('a database failure restores default and all record currencies', async () => {
      await db.query(`CREATE FUNCTION reject_currency() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture failure'; END $$;
        CREATE TRIGGER reject_currency BEFORE UPDATE ON products FOR EACH ROW EXECUTE FUNCTION reject_currency()`);
      assert.equal((await request('/auth/workspace/currency', 'PUT', { currency: 'EUR' })).status, 500);
      assert.equal((await request('/auth/workspace/settings')).data.workspace.default_currency, 'PLN');
      assert.equal((await db.query('SELECT currency FROM deals WHERE workspace_id=1')).rows[0].currency, 'PLN');
    });
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    await db.pool.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  }
});
