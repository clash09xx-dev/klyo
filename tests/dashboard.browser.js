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
    const contact = { id: 1, full_name: 'Example Client', email: 'client@example.test', status: 'customer', tags: ['sold'], company_name:'Harbor Studio', phone:'+44 7700 900123', notes:'Interested in a website refresh. Prepare a proposal after the discovery call.', owner_name: 'Demo', created_at: '2026-10-14' };
    const deal = { id: 1, title: 'Website project', value: '4500.00', currency, stage_id: 1, status: 'open', quantity: 1, assigned_name:'Demo', contact_name:contact.full_name, stage_entered_at:new Date(Date.now()-3*86400000).toISOString() };
    const deals = [deal,
      { ...deal, id: 2, title: 'Second website project', value: '2300.00' },
      { ...deal, id: 3, title: 'Branding project', stage_id: 2, value: '800.00', next_task_id:3, next_task_title:'Review the proposal', next_task_due:'2026-10-19' },
      { ...deal, id: 4, title: 'Shop redesign', stage_id:6, value:'3200.00', status:'won' },
    ];
    const savedViews = [], emailTemplates = [], dealEvents = [], drafts = [];
    let draftCount = 0, sentCount = 0;
    const stages = [
      { id: 1, name: 'Contacted', color: '#777777' },
      { id: 2, name: 'Interested', color: '#777777' },
      { id: 3, name: 'Preview sent', color: '#777777' },
      { id: 4, name: 'Offer sent', color: '#777777' },
      { id: 5, name: 'Closing', color: '#777777' },
      { id: 6, name: 'Closed', color: '#777777' },
    ];
    const product = { id: 1, name: 'Website', unit_price: '4500.00', currency, unit_label: 'project' };
    const quote = { id: 1, title: 'Draft quote', total: '4500.00', currency, status: 'draft', contact_id: 1, contact_name: contact.full_name };
    const user = { id: 1, name: 'Demo', email: 'demo@example.test', role: 'admin', has_seen_onboarding: true, terms_accepted_at: '2026-01-01', language: 'en' };
    await context.addInitScript(() => { if(location.pathname === '/app') localStorage.setItem('klyo_token', 'local-fixture'); });
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
        else if (endpoint === '/sales/views' && route.request().method() === 'GET') data = { views: savedViews };
        else if (endpoint === '/sales/views' && route.request().method() === 'POST') { const view = { id: savedViews.length + 1, ...route.request().postDataJSON() }; savedViews.push(view); data = { view }; }
        else if (endpoint === '/sales/templates' && route.request().method() === 'GET') data = { templates: emailTemplates };
        else if (endpoint === '/sales/templates' && route.request().method() === 'POST') { const template = { id: emailTemplates.length + 1, ...route.request().postDataJSON() }; emailTemplates.push(template); data = { template }; }
        else if (endpoint === '/sales/summary') data = { totals: deals.map(d => ({ currency: d.currency, status: d.status, count: 1, value: d.value })), stages: stages.map(stage => ({ ...stage, count: deals.filter(d => d.stage_id === stage.id && d.status === 'open').length, currency, value: 0 })), losses: deals.filter(d => d.status === 'lost').map(d => ({ reason: d.lost_reason, count: 1 })), overdue: 0, without_next_step: 2 };
        else if (endpoint === '/offers' && route.request().method() === 'POST') { const offer={id:++draftCount,status:'draft',...route.request().postDataJSON()};drafts.unshift(offer);data={offer}; }
        else if (/^\/offers\/\d+$/.test(endpoint) && route.request().method() === 'PUT') { const offer=drafts.find(item=>String(item.id)===endpoint.split('/')[2]);Object.assign(offer,route.request().postDataJSON());data={offer}; }
        else if (/^\/offers\/\d+\/send$/.test(endpoint)) { sentCount++; data = {}; }
        else if (endpoint === '/deals/1/history') data = { events: dealEvents };
        else if (endpoint === '/deals/1/next-step') { const body = route.request().postDataJSON(); Object.assign(deal, { next_task_id: 1, next_task_title: body.title, next_task_due: body.due_date, overdue_tasks: 1 }); data = { task: { id: 1 } }; }
        else if (endpoint === '/tasks/1/status') { Object.assign(deal, { next_task_id: null, next_task_title: null, next_task_due: null, overdue_tasks: 0 }); data = { ok: true }; }
        else if (endpoint === '/deals/1' && route.request().method() === 'PUT') { Object.assign(deal, route.request().postDataJSON()); dealEvents.push({ id: 1, from_stage: 'Contacted', to_stage: 'Contacted', from_status: 'open', to_status: deal.status, reason: deal.lost_reason, created_at: new Date().toISOString(), user_name: 'Demo' }); data = { deal }; }
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
        else if (endpoint === '/contacts/1') data = { contact, activity: [], offers: drafts, quotes: [quote] };
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
        else if (endpoint === '/tasks') data = { tasks: [{ id: 1, title: 'Review the project proposal', status: 'todo', priority: 'medium', assigned_name: 'Demo', due_date: '2026-10-15', contact_name: contact.full_name }] };
        else if (endpoint === '/clients') data = { clients: [] };
        else if (endpoint === '/calendar') data = { events: [] };
        else if (endpoint === '/reminders/due') data = { reminders: [] };
        else if (endpoint === '/history') data = { entries: [], total: 0 };
        else if (endpoint === '/team-stats') data = { team: [] };
        else if (endpoint === '/quotes') data = { quotes: [quote] };
        else if (endpoint === '/quotes/1') data = { quote, lineItems: [{ description: 'Website', quantity: 1, line_total: 4500 }] };
        else { status = 404; data = { error: `Missing fixture: ${endpoint}` }; }
        return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
      }
      const file = path.join(publicDir, url.pathname === '/app' ? 'app.html' : url.pathname === '/' ? 'index.html' : ['/login','/signup'].includes(url.pathname) ? 'login.html' : url.pathname);
      const contentType = file.endsWith('.png') ? 'image/png' : file.endsWith('.svg') ? 'image/svg+xml' : file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html';
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

    assert.deepEqual(await page.locator('.nav .nav-item[data-view]').evaluateAll(items=>items.map(el=>el.dataset.view).sort()),['overview','pipeline','companies','quotes','reminders','tasks','deals','clients','products','calendar','history','team','platform'].sort());
    // The contact database is the primary work surface, with an inline summary rather than tiles.
    await page.evaluate(contact => {
      const samples = [contact,
        {id:2,full_name:'Maya Lewis',email:'maya@example.test',phone:'+44 7700 900245',company_name:'Eastfield Design',status:'lead',owner_name:'Demo',tags:['New enquiry']},
        {id:3,full_name:'Oliver Clark',email:'oliver@example.test',phone:'+44 7700 900316',company_name:'Clark & Co.',status:'negotiating',owner_name:'Demo',tags:['Proposal']},
        {id:4,full_name:'Sofia Martin',email:'sofia@example.test',phone:'+44 7700 900427',company_name:'Studio Martin',status:'contacted',owner_name:'Demo',tags:[]},
        {id:5,full_name:'James Wilson',email:'james@example.test',phone:'+44 7700 900538',company_name:'Northline',status:'customer',owner_name:'Demo',tags:['Website']},
      ];
      renderContacts(samples);els.statTotal.textContent='5';els.statLeads.textContent='1';els.statNegotiating.textContent='1';
    },contact);
    await page.setViewportSize({width:1440,height:900});
    assert.ok(await page.locator('#pipelineView .stat-card').first().evaluate(el=>el.getBoundingClientRect().height<40));
    assert.equal(await page.locator('#sparkTotal').isVisible(),false);
    assert.ok(await page.locator('#contactsBody tr').first().evaluate(el=>el.getBoundingClientRect().height<=60));
    if(screenshotDir)await page.screenshot({path:path.join(screenshotDir,`${name}-pipeline-compact.png`),animations:'disabled'});
    if(name==='chromium'&&process.env.KLYO_PREVIEW_DIR)await page.screenshot({path:path.join(process.env.KLYO_PREVIEW_DIR,'contacts-preview.png'),animations:'disabled'});
    await page.evaluate(contact=>{renderContacts([contact]);els.statTotal.textContent='1';els.statLeads.textContent='0';els.statNegotiating.textContent='0';},contact);
    await page.setViewportSize({width:1440,height:1000});
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
      assert.equal(colors.logo, 'rgb(36, 38, 43)');
      assert.equal(colors.button, expected);
      assert.ok(!colors.composer.includes('18, 26, 44'));
      if(name==='chromium'&&selectedTheme==='blanc'&&process.env.KLYO_PREVIEW_DIR)await page.locator('#panelOverlay .panel').screenshot({path:path.join(process.env.KLYO_PREVIEW_DIR,'contact-preview.png'),animations:'disabled'});
      if (screenshotDir) {
        fs.mkdirSync(screenshotDir, { recursive: true });
        await page.screenshot({ path: path.join(screenshotDir, `${name}-${selectedTheme}.png`), animations: 'disabled' });
      }
    }
    await page.evaluate(() => closePanel());
    await page.locator('.nav-item[data-view="deals"]').first().click();
    await page.waitForFunction(() => document.querySelector('.deal-card-value'));
    assert.match(await page.locator('.deal-card-value').first().textContent(), /USD|\$/);
    // Stages remain side by side; cards stack vertically and drag/drop still works.
    const columns = await page.locator('.deals-column').evaluateAll(items => items.map(item => {
      const box = item.getBoundingClientRect(); return { x: box.x, y: box.y, width: box.width };
    }));
    assert.equal(columns.length, 6);
    assert.equal(columns[0].y, columns[1].y);
    assert.ok(columns[1].x > columns[0].x);
    const firstCards = await page.locator('.deals-column[data-stage-id="1"] .deal-card').evaluateAll(items => items.map(item => {
      const box = item.getBoundingClientRect(); return { x: box.x, y: box.y };
    }));
    assert.equal(firstCards[0].x, firstCards[1].x);
    assert.ok(firstCards[1].y > firstCards[0].y);
    if (screenshotDir) await page.locator('.toast').evaluateAll(items=>items.forEach(item=>item.remove()));
    if (screenshotDir) await page.screenshot({ path: path.join(screenshotDir, `${name}-deals.png`), animations: 'disabled' });
    await page.locator('.deal-card[data-id="2"]').dragTo(page.locator('.deals-column[data-stage-id="3"] .deals-column-body'));
    await page.waitForFunction(() => document.querySelector('.deals-column[data-stage-id="3"] .deal-card[data-id="2"]'));
    assert.equal(deals[1].stage_id, 3);
    await page.locator('#dealAttentionFilter').selectOption('no_next');
    await page.locator('#saveDealViewBtn').click();
    await page.locator('#salesNameInput').fill('Needs a next step');
    await page.locator('#salesNameSubmit').click();
    await page.waitForFunction(() => document.querySelectorAll('#savedDealView option').length === 2);
    assert.equal(savedViews[0].filters.attention, 'no_next');
    await page.locator('#dealAttentionFilter').selectOption('');
    // Every stage fits horizontally and fills the available viewport height.
    for (const viewport of [
      { width: 1512, height: 836 }, { width: 1280, height: 800 },
      { width: 1920, height: 1080 }, { width: 760, height: 1000 },
    ]) {
      await page.setViewportSize(viewport);
      const layout = await page.locator('#dealsBoard').evaluate(board => {
        const box = board.getBoundingClientRect();
        return { width: board.clientWidth, scrollWidth: board.scrollWidth, bottom: box.bottom,
          columns: [...board.children].map(column => {
            const rect = column.getBoundingClientRect(); return { right: rect.right, bottom: rect.bottom };
          }), right: box.right };
      });
      assert.ok(layout.scrollWidth <= layout.width + 1, `${name}: all stages fit at ${viewport.width}`);
      assert.ok(Math.abs(layout.bottom - (viewport.height - 20)) < 2, `${name}: board reaches bottom of viewport`);
      assert.ok(layout.columns.every(column => column.right <= layout.right + 1));
      assert.ok(layout.columns.every(column => Math.abs(column.bottom - layout.bottom) < 2));
    }
    await page.setViewportSize({ width: 1512, height: 836 });
    await page.evaluate(() => applyTheme('blanc'));
    if (screenshotDir) await page.locator('.toast').evaluateAll(items=>items.forEach(item=>item.remove()));
    if (screenshotDir) await page.screenshot({ path: path.join(screenshotDir, `${name}-deals-fit-screen.png`), animations: 'disabled' });
    if (name === 'chromium' && process.env.KLYO_PRODUCT_PREVIEW) await page.screenshot({ path: process.env.KLYO_PRODUCT_PREVIEW, animations: 'disabled' });
    // Overflowing cards scroll inside their stage without growing the page.
    await page.evaluate(() => {
      for (let id = 100; id < 130; id++) dealsCache.push({ ...dealsCache[0], id, stage_id: 1, title: `Test project ${id}` });
      renderDealsBoard();
    });
    const body = page.locator('.deals-column[data-stage-id="1"] .deals-column-body');
    assert.equal(await body.evaluate(element => element.scrollHeight > element.clientHeight), true);
    await body.evaluate(element => { element.scrollTop = 300; });
    assert.ok(await body.evaluate(element => element.scrollTop > 0));
    assert.ok(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1));
    await page.evaluate(() => loadDeals());
    // Empty accounts retain their actionable empty state.
    await page.evaluate(() => { dealsCache = []; dealsStagesCache = []; renderDealsBoard(); });
    assert.equal(await page.locator('#dealsEmptyState').isVisible(), true);
    assert.equal(await page.locator('#dealsBoardWrap').isVisible(), false);
    await page.evaluate(() => loadDeals());
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
    await page.locator('.nav-item[data-view="deals"]').first().click();
    await page.waitForFunction(() => document.querySelector('.deal-card-value'));
    assert.match(await page.locator('.deal-card-value').first().textContent(), /zł|PLN/);
    // Manual tasks and loss reasons are persisted through the actual UI handlers.
    await page.locator('.deal-card[data-id="1"]').click();
    await page.locator('#nextStepTitle').fill('Review the brief');
    await page.locator('#nextStepDue').fill('2026-10-13');
    await page.locator('#nextStepSubmit').click();
    await page.waitForFunction(() => document.querySelector('#nextStepCurrent').textContent.includes('Review the brief'));
    assert.equal(await page.locator('.deal-card[data-id="1"] .is-overdue').count(), 1);
    await page.locator('#nextStepComplete').click();
    await page.waitForFunction(() => document.querySelector('#nextStepComplete').classList.contains('hidden'));
    await page.locator('#closeDealPanelBtn').click();
    await page.locator('.nav-item[data-view="pipeline"]').click();
    await page.locator('#contactsBody tr').click();
    assert.equal(await page.locator('body').innerText().then(text => /WhatsApp/i.test(text)), false);
    await page.locator('#writeManualBtn').click();
    await page.locator('#draftSubject').fill('Hello {first_name}');
    await page.locator('#draftBody').fill('Hi {first_name}, here is the proposal from {sender}.');
    await page.locator('#saveEmailTemplateBtn').click();
    await page.locator('#salesNameInput').fill('Proposal introduction');
    await page.locator('#salesNameSubmit').click();
    await page.waitForFunction(() => document.querySelectorAll('#emailTemplateSelect option').length === 2);
    await page.selectOption('#emailTemplateSelect', '1');
    await page.locator('#applyTemplateBtn').click();
    await page.waitForFunction(() => document.querySelector('#draftSubject').value === 'Hello Example');
    await page.locator('#saveManualDraftBtn').click();
    await page.waitForFunction(() => !document.querySelector('#saveManualDraftBtn').disabled);
    assert.equal(drafts[0].subject,'Hello Example');
    await page.evaluate(() => closePanel());
    await page.locator('#contactsBody tr').click();
    await page.waitForFunction(() => !document.querySelector('#panelOverlay').classList.contains('hidden') && currentPanelContactId === 1);
    assert.equal(await page.locator('#draftSubject').inputValue(),'Hello Example');
    assert.equal(sentCount, 0, 'No automatic emails are sent');
    await page.evaluate(() => closePanel());
    await page.locator('.nav-item[data-view="deals"]').click();
    await page.locator('.deal-card[data-id="1"]').click();
    await page.locator('#markDealLostBtn').click();
    await page.locator('#lossReasonInput').fill('Budget postponed');
    await page.locator('#lossReasonForm button[type="submit"], #lossReasonForm button:not([type])').click();
    await page.waitForFunction(() => document.querySelector('#lossReasonOverlay').classList.contains('hidden'));
    assert.equal(deal.status, 'lost');
    assert.equal(deal.lost_reason, 'Budget postponed');
    await page.locator('.nav-item[data-view="overview"]').click();
    await page.waitForFunction(() => document.querySelector('#salesLossReasons').textContent.includes('Budget postponed'));
    if (screenshotDir) await page.locator('.toast').evaluateAll(items=>items.forEach(item=>item.remove()));
    if (screenshotDir) await page.screenshot({ path: path.join(screenshotDir, `${name}-overview.png`), animations: 'disabled' });
    if(name==='chromium'&&process.env.KLYO_PREVIEW_DIR)await page.screenshot({path:path.join(process.env.KLYO_PREVIEW_DIR,'results-preview.png'),animations:'disabled'});
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('.mobile-menu-toggle').click();
    await page.locator('.nav-item[data-view="overview"]').click();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    if (screenshotDir) await page.locator('.toast').evaluateAll(items=>items.forEach(item=>item.remove()));
    if (screenshotDir) await page.screenshot({ path: path.join(screenshotDir, `${name}-overview-mobile.png`), animations: 'disabled' });
    await page.locator('.mobile-menu-toggle').click();
    await page.locator('.nav-item[data-view="pipeline"]').click();
    await page.locator('#contactsBody tr').first().waitFor();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    assert.ok(await page.locator('#pipelineView .table-card').evaluate(el=>el.scrollWidth>el.clientWidth));
    if(screenshotDir)await page.screenshot({path:path.join(screenshotDir,`${name}-pipeline-mobile.png`),animations:'disabled'});
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.evaluate(() => { openQuoteModal(); currentQuoteLineItems[0].unit_price = 4500; renderQuoteLineItems(); });
    assert.match(await page.locator('#quoteTotalValue').textContent(), /zł|PLN/);
    await page.selectOption('#quoteCurrencySelect', 'EUR');
    assert.match(await page.locator('#quoteTotalValue').textContent(), /€/);
    assert.deepEqual(errors, [], `${name}: all flows must be free of uncaught errors`);
    await page.evaluate(() => closeQuoteModal());
    for (const view of ['companies','tasks','quotes','products','calendar','history']) {
      await page.locator(`.nav-item[data-view="${view}"]`).click();
      await page.waitForFunction(view => {
        if(document.body.dataset.view !== view) return false;
        const selectors={companies:'#companiesEmptyState:not(.hidden)',tasks:'#tasksBody tr',quotes:'#quotesBody tr',products:'#productsBody tr',calendar:'#calendarGrid>div',history:'#historyEmptyState:not(.hidden)'};
        return !!document.querySelector(selectors[view]);
      }, view);
      await page.locator('.toast').evaluateAll(items=>items.forEach(item=>item.remove()));
      if (screenshotDir) await page.screenshot({path:path.join(screenshotDir,`${name}-${view}-refreshed.png`),animations:'disabled'});
    }
    await context.clearCookies();
    await page.evaluate(() => localStorage.removeItem('klyo_token'));
    await page.goto('http://klyo.test/login');
    await page.locator('#goLoginBtn').click();
    assert.ok(await page.evaluate(() => document.querySelector('.auth-card').getBoundingClientRect().bottom < document.querySelector('.auth-shell').lastElementChild.getBoundingClientRect().top));
    if (screenshotDir) await page.screenshot({path:path.join(screenshotDir,`${name}-login.png`),animations:'disabled'});
    await page.setViewportSize({width:390,height:844});
    await page.goto('http://klyo.test/signup');
    await page.locator('#signupScreen:not(.hidden)').waitFor();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    assert.ok(await page.locator('#termsCheckbox').evaluate(el=>el.getBoundingClientRect().width<30));
    if(screenshotDir)await page.screenshot({path:path.join(screenshotDir,`${name}-signup-mobile.png`),fullPage:true,animations:'disabled'});
    await page.setViewportSize({width:1440,height:1000});
    await page.goto('http://klyo.test/');
    await page.locator('h1').waitFor();
    if (screenshotDir) await page.locator('.toast').evaluateAll(items=>items.forEach(item=>item.remove()));
    if (screenshotDir) await page.screenshot({ path: path.join(screenshotDir, `${name}-landing.png`), fullPage: true, animations: 'disabled' });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.locator('summary').first().click();
    if (screenshotDir) await page.locator('.toast').evaluateAll(items=>items.forEach(item=>item.remove()));
    if (screenshotDir) await page.screenshot({ path: path.join(screenshotDir, `${name}-landing-mobile.png`), fullPage: true, animations: 'disabled' });
    assert.deepEqual(errors, []);
    console.log(`${name}: PASS — reload, failed auxiliary request, visible pipeline error, currency persistence, quote currency, Blanc/Noir, fitted stages, tasks, loss reasons, templates, saved views, overview, landing desktop/mobile, no automatic sends`);
  } finally { await browser.close(); }
}
(async () => { await run(chromium, 'chromium'); await run(webkit, 'webkit'); })().catch(error => { console.error(error); process.exitCode = 1; });
