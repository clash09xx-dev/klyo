// Run with Playwright available: node tests/dashboard.browser.js
// Uses synthetic API fixtures only; never connects to the production database.
const { chromium, webkit } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const publicDir = path.join(__dirname, '../public');
const screenshotDir = process.env.KLYO_QA_SCREENSHOTS;

async function run(engine, name) {
  const browser = await engine.launch({ headless: true, executablePath: process.env[`KLYO_${name.toUpperCase()}_PATH`] || undefined });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'pl-PL' });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    let failCompanies = false;
    let failContacts = false;
    let theme = 'blanc';
    let currency = 'USD';
    const contact = { id: 1, full_name: 'Example Client', email: 'client@example.test', status: 'customer', tags: ['sold'], owner_name: 'Demo', created_at: '2026-10-14' };
    const deal = { id: 1, title: 'Website project', value: '4500.00', currency, stage_id: 1, status: 'open', quantity: 1 };
    const deals = [deal,
      { ...deal, id: 2, title: 'Second website project', value: '2300.00' },
      { ...deal, id: 3, title: 'Branding project', stage_id: 2, value: '800.00' },
    ];
    const stages = [
      { id: 1, name: 'New', color: '#777777' },
      { id: 2, name: 'In progress', color: '#777777' },
      { id: 3, name: 'Proposal', color: '#777777' },
      { id: 4, name: 'Won', color: '#777777' },
    ];
    const product = { id: 1, name: 'Website', unit_price: '4500.00', currency, unit_label: 'project' };
    const quote = { id: 1, title: 'Draft quote', total: '4500.00', currency, status: 'draft', contact_id: 1, contact_name: contact.full_name };
    const user = { id: 1, name: 'Demo', email: 'demo@example.test', role: 'admin', has_seen_onboarding: true, terms_accepted_at: '2026-01-01', language: 'en' };
    await context.addInitScript(() => localStorage.setItem('klyo_token', 'local-fixture'));
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.hostname !== 'klyo.test') return route.abort();
      if (url.pathname.startsWith('/api/')) {
        const endpoint = url.pathname.slice(4);
        let data;
        let status = 200;
        if ((failCompanies && endpoint === '/companies') || (failContacts && endpoint === '/contacts')) {
          status = 500; data = { error: 'Fixture failure' };
        } else if (endpoint === '/auth/me') data = { user: { ...user, theme } };
        else if (endpoint === '/auth/team') data = { team: [user] };
        else if (endpoint === '/auth/workspace' || endpoint === '/auth/workspace/settings') data = { workspace: { id: 1, name: 'Demo', default_currency: currency } };
        else if (endpoint === '/auth/workspace/currency') {
          currency = route.request().postDataJSON().currency;
          deals.forEach(item => { item.currency = currency; });
          product.currency = quote.currency = currency;
          data = { currency };
        } else if (endpoint === '/billing/status') data = { is_comped: true };
        else if (endpoint === '/contacts/themes') data = { themes: [] };
        else if (endpoint === '/contacts/tags') data = { tags: ['sold'] };
        else if (endpoint === '/contacts') data = { contacts: [contact] };
        else if (endpoint === '/contacts/1') data = { contact, activity: [], offers: [], quotes: [quote] };
        else if (endpoint === '/contacts/1/timeline') data = { events: [] };
        else if (endpoint === '/stats') data = { total: 1, leads: 0, negotiating: 0, offersSent: 0, series: [0, 0, 1] };
        else if (endpoint === '/companies') data = { companies: [] };
        else if (endpoint === '/products') data = { products: [product] };
        else if (endpoint === '/deals/stages') data = { stages };
        else if (endpoint === '/deals') data = { deals };
        else if (/^\/deals\/\d+\/stage$/.test(endpoint) && route.request().method() === 'PATCH') {
          const item = deals.find(item => item.id === Number(endpoint.split('/')[2]));
          item.stage_id = route.request().postDataJSON().stage_id;
          data = { deal: item };
        } else if (endpoint === '/deals/1') data = { deal };
        else if (endpoint === '/quotes') data = { quotes: [quote] };
        else if (endpoint === '/quotes/1') data = { quote, lineItems: [{ description: 'Website', quantity: 1, line_total: 4500 }] };
        else { status = 404; data = { error: `Missing fixture: ${endpoint}` }; }
        return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
      }
      const file = path.join(publicDir, url.pathname === '/app' ? 'app.html' : url.pathname);
      const contentType = file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html';
      return route.fulfill({ contentType, body: fs.readFileSync(file) });
    });
    await page.goto('http://klyo.test/app');
    await page.waitForFunction(() => document.querySelectorAll('#contactsBody tr').length === 1);
    assert.equal(await page.locator('#statTotal').textContent(), '1');
    assert.equal(await page.locator('#filterOwner option').count(), 2);
    await page.reload();
    await page.waitForFunction(() => document.querySelectorAll('#contactsBody tr').length === 1);
    assert.equal(await page.locator('#statTotal').textContent(), '1');
    assert.deepEqual(errors, [], `${name}: boot must not throw`);

    // A failed auxiliary endpoint must not prevent contacts and stats loading.
    failCompanies = true;
    await page.reload();
    await page.waitForFunction(() => document.querySelectorAll('#contactsBody tr').length === 1);
    await page.waitForFunction(() => document.querySelector('.toast.error'));
    assert.equal(await page.locator('#statTotal').textContent(), '1');
    failCompanies = false;

    // A pipeline failure must be visible, rather than masquerading as an empty account.
    failContacts = true;
    await page.reload();
    await page.waitForFunction(() => document.querySelector('.toast.error'));
    failContacts = false;
    await page.reload();
    await page.waitForFunction(() => document.querySelectorAll('#contactsBody tr').length === 1);

    // Theme checks run against the real stylesheet and rendered contact panel.
    await page.locator('#contactsBody tr').click();
    await page.waitForFunction(() => !document.querySelector('#panelOverlay').classList.contains('hidden'));
    for (const selectedTheme of ['blanc', 'noir']) {
      await page.evaluate(value => applyTheme(value), selectedTheme);
      const colors = await page.evaluate(() => {
        const root = getComputedStyle(document.documentElement);
        return {
          expected: root.getPropertyValue('--on-accent').trim(),
          logo: getComputedStyle(document.querySelector('.brand-mark svg')).stroke,
          button: getComputedStyle(document.querySelector('.scan-btn')).color,
          composer: getComputedStyle(document.querySelector('.composer')).backgroundImage,
        };
      });
      const expected = selectedTheme === 'blanc' ? 'rgb(255, 255, 255)' : 'rgb(10, 10, 10)';
      assert.equal(colors.logo, expected);
      assert.equal(colors.button, expected);
      assert.ok(!colors.composer.includes('18, 26, 44'));
      if (screenshotDir) {
        fs.mkdirSync(screenshotDir, { recursive: true });
        await page.screenshot({ path: path.join(screenshotDir, `${name}-${selectedTheme}.png`), animations: 'disabled' });
      }
    }
    await page.evaluate(() => closePanel());
    await page.locator('[data-view="deals"]').click();
    await page.waitForFunction(() => document.querySelector('.deal-card-value'));
    assert.match(await page.locator('.deal-card-value').first().textContent(), /USD|\$/);
    // Stages remain side by side; cards stack vertically and drag/drop still works.
    const columns = await page.locator('.deals-column').evaluateAll(items => items.map(item => {
      const box = item.getBoundingClientRect(); return { x: box.x, y: box.y, width: box.width };
    }));
    assert.equal(columns.length, 4);
    assert.equal(columns[0].y, columns[1].y);
    assert.ok(columns[1].x > columns[0].x);
    const firstCards = await page.locator('.deals-column[data-stage-id="1"] .deal-card').evaluateAll(items => items.map(item => {
      const box = item.getBoundingClientRect(); return { x: box.x, y: box.y };
    }));
    assert.equal(firstCards[0].x, firstCards[1].x);
    assert.ok(firstCards[1].y > firstCards[0].y);
    if (screenshotDir) await page.screenshot({ path: path.join(screenshotDir, `${name}-deals.png`), animations: 'disabled' });
    await page.locator('.deal-card[data-id="2"]').dragTo(page.locator('.deals-column[data-stage-id="3"] .deals-column-body'));
    await page.waitForFunction(() => document.querySelector('.deals-column[data-stage-id="3"] .deal-card[data-id="2"]'));
    assert.equal(deals[1].stage_id, 3);
    await page.setViewportSize({ width: 760, height: 1000 });
    assert.equal(await page.locator('#dealsBoard').evaluate(board => board.scrollWidth > board.clientWidth), true);
    assert.equal(await page.locator('#dealsBoard').evaluate(board => getComputedStyle(board).overflowX), 'auto');
    await page.setViewportSize({ width: 1440, height: 1000 });
    // Call the actual settings save handler after choosing PLN.
    const settingsLoaded = page.waitForResponse('**/api/auth/workspace/settings');
    await page.locator('#appearanceBtn').click();
    await settingsLoaded;
    await page.selectOption('#workspaceCurrencySelect', 'PLN');
    await page.locator('#saveCurrencyBtn').click();
    await page.waitForFunction(() => workspaceDefaultCurrency === 'PLN' && !els.saveCurrencyBtn.disabled);
    await page.locator('#closeAppearanceBtn').click();
    assert.equal(await page.locator('#currencyError').textContent(), '');
    assert.match(await page.locator('.deal-card-value').first().textContent(), /zł|PLN/);
    assert.equal(deal.value, '4500.00');
    assert.equal(await page.evaluate(() => workspaceDefaultCurrency), 'PLN');
    await page.reload();
    await page.waitForFunction(() => document.querySelectorAll('#contactsBody tr').length === 1);
    await page.locator('[data-view="deals"]').click();
    await page.waitForFunction(() => document.querySelector('.deal-card-value'));
    assert.match(await page.locator('.deal-card-value').first().textContent(), /zł|PLN/);
    await page.evaluate(() => { openQuoteModal(); currentQuoteLineItems[0].unit_price = 4500; renderQuoteLineItems(); });
    assert.match(await page.locator('#quoteTotalValue').textContent(), /zł|PLN/);
    await page.selectOption('#quoteCurrencySelect', 'EUR');
    assert.match(await page.locator('#quoteTotalValue').textContent(), /€/);
    assert.deepEqual(errors, [], `${name}: all flows must be free of uncaught errors`);
    console.log(`${name}: PASS — reload, failed auxiliary request, visible pipeline error, currency persistence, quote currency, Blanc/Noir, vertical cards and drag/drop`);
  } finally { await browser.close(); }
}
(async () => { await run(chromium, 'chromium'); await run(webkit, 'webkit'); })().catch(error => { console.error(error); process.exitCode = 1; });
