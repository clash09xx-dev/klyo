// Run with Playwright available: node tests/dashboard.browser.js
// Uses synthetic API fixtures only; never connects to the production database.
const { chromium, webkit } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const Q=require('../public/js/quote-core');
const {generateQuotePdf}=require('../server/services/quotePdf');
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
    let preferences = {};
    let failPreferences = false;
    const contactQueries=[];
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
    let quoteDefaults={},quoteSentCount=0,lastQuoteSend=null;
    const quoteStore=new Map([[1,quote]]),quoteLines=new Map([[1,[{description:'Website',quantity:1,unit_price:4500,discount_percent:0,line_total:4500}]]]);
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
        } else if (endpoint === '/auth/me') data = { user: { ...user, theme, workspace_preferences:preferences } };
        else if(endpoint === '/auth/preferences' && route.request().method()==='PUT'){if(failPreferences){status=500;data={error:'Fixture save failed'};}else{preferences=route.request().postDataJSON();theme=preferences.palette.preset;data={preferences};}}
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
        else if (endpoint === '/contacts') {
          contactQueries.push(url.search);
          if(url.searchParams.get('search')==='slow'){await new Promise(resolve=>setTimeout(resolve,180));data={contacts:[{...contact,full_name:'Slow stale result'}]};}
          else if(url.searchParams.get('search')==='latest')data={contacts:[{...contact,full_name:'Latest result'}]};
          else data = { contacts: [contact] };
        }
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
        else if(endpoint==='/quotes/document-defaults'){if(route.request().method()==='PUT')quoteDefaults=route.request().postDataJSON();data={workspace:{name:'Demo Studio',quote_defaults:quoteDefaults},document:quoteDefaults};}
        else if(endpoint==='/quotes'&&route.request().method()==='POST'){
          const body=route.request().postDataJSON(),totals=Q.computeTotals(body.line_items,body.tax_rate),id=Math.max(...quoteStore.keys())+1;
          const saved={id,...body,...totals,discount_total:totals.discountTotal,status:'draft',public_token:'b'.repeat(36),created_at:'2026-10-15',updated_at:'2026-10-15T08:00:00.000Z',contact_name:contact.full_name,contact_email:contact.email};quoteStore.set(id,saved);quoteLines.set(id,totals.computed);data={quote:saved,lineItems:totals.computed,recipients:[]};
        }
        else if(/^\/quotes\/\d+\/pdf$/.test(endpoint)){const id=Number(endpoint.split('/')[2]),q=quoteStore.get(id);const pdf=await generateQuotePdf(q,quoteLines.get(id));return route.fulfill({status:200,contentType:'application/pdf',headers:{'Content-Disposition':`inline; filename="${Q.reference(q)}.pdf"`},body:pdf});}
        else if(/^\/quotes\/\d+\/preview$/.test(endpoint)){const q=quoteStore.get(Number(endpoint.split('/')[2]));data={to:[contact.email],toNames:[contact.full_name],subject:q.title,body:'Dzień dobry, w załączniku przesyłamy ofertę.',attachment:{filename:Q.reference(q)+'.pdf'},revision:q.updated_at};}
        else if(/^\/quotes\/\d+\/send$/.test(endpoint)){quoteSentCount++;lastQuoteSend=route.request().postDataJSON();quoteStore.get(Number(endpoint.split('/')[2])).status='sent';data={ok:true};}
        else if(/^\/quotes\/\d+\/duplicate$/.test(endpoint)){const original=quoteStore.get(Number(endpoint.split('/')[2])),id=Math.max(...quoteStore.keys())+1;const copy={...original,id,status:'draft',title:original.title+' (copy)',document:{...original.document,reference:''}};quoteStore.set(id,copy);quoteLines.set(id,quoteLines.get(original.id));data={quote:copy};}
        else if(/^\/quotes\/\d+$/.test(endpoint)){const id=Number(endpoint.split('/')[2]);if(route.request().method()==='PUT'){const body=route.request().postDataJSON(),totals=Q.computeTotals(body.line_items,body.tax_rate);Object.assign(quoteStore.get(id),body,totals,{discount_total:totals.discountTotal});quoteLines.set(id,totals.computed);}data={quote:quoteStore.get(id),lineItems:quoteLines.get(id),recipients:[]};}
        else if (endpoint === '/quotes') data = { quotes: [...quoteStore.values()] };
        else { status = 404; data = { error: `Missing fixture: ${endpoint}` }; }
        return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
      }
      const file = path.join(publicDir, url.pathname === '/app' ? 'app.html' : url.pathname === '/' ? 'index.html' : ['/login','/signup'].includes(url.pathname) ? 'login.html' : url.pathname);
      const contentType = file.endsWith('.png') ? 'image/png' : file.endsWith('.svg') ? 'image/svg+xml' : (file.endsWith('.js')||file.endsWith('.mjs')) ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html';
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
    contactQueries.length=0;
    await page.evaluate(async()=>{filters.search='slow';const slow=loadContacts();filters.search='latest';const fast=loadContacts();await Promise.all([slow,fast]);});
    assert.match(await page.locator('#contactsBody').textContent(),/Latest result/);
    assert.deepEqual(contactQueries.sort(),['?search=latest','?search=slow']);
    await page.evaluate(async()=>{filters.search='';await loadContacts();});


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
          expected: (()=>{const probe=document.createElement('span');probe.style.color=root.getPropertyValue('--on-accent');document.body.appendChild(probe);const color=getComputedStyle(probe).color;probe.remove();return color;})(),
          contrast:KlyoPreferences.contrast(root.getPropertyValue('--accent-1').trim(),root.getPropertyValue('--on-accent').trim()),
          logo: getComputedStyle(document.querySelector('.brand-mark svg')).stroke,
          button: getComputedStyle(document.querySelector('.scan-btn')).color,
          composer: getComputedStyle(document.querySelector('.composer')).backgroundImage,
        };
      });
      assert.equal(colors.logo,colors.expected);
      assert.equal(colors.button,colors.expected);
      assert.ok(colors.contrast>=4.5);
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
    await page.locator('[data-settings-tab=account]').click();
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
    // A saved personal workspace survives reload without granting Platform access.
    await page.locator('#appearanceBtn').click();
    await page.locator('[data-preset="custom"]').click();
    await page.locator('#hex-background').fill('#112233');
    await page.locator('#hex-surface').fill('#1c2d40');
    await page.locator('#hex-accent').fill('#82efb1');
    await page.selectOption('#pref-sidebar','right');
    await page.selectOption('#pref-density','comfortable');
    await page.selectOption('#pref-start_view','deals');
    await page.selectOption('#pref-summary_position','below');
    await page.selectOption('#pref-overview_layout','stacked');
    await page.locator('#prefList-nav [data-visible=calendar]').uncheck();
    await page.locator('#prefList-widgets [data-visible=losses]').uncheck();
    await page.locator('[data-layout=collapsed]').check();
    await page.locator('#prefList-nav [data-key="deals"] [data-move="-1"]').click();
    await page.locator('#prefList-nav li[data-key=tasks]').dragTo(page.locator('#prefList-nav li[data-key=pipeline]'));
    await page.locator('#prefList-columns [data-key="stage"] [data-move="-1"]').click();
    await page.locator('#prefList-columns [data-visible="tags"]').uncheck();
    await page.locator('#prefList-widgets [data-key="losses"] [data-move="-1"]').click();
    await page.locator('#savePreferencesBtn').click();
    await page.waitForFunction(()=>!document.querySelector('#savePreferencesBtn').disabled);
    assert.equal(preferences.palette.custom.background,'#112233');assert.equal(preferences.layout.sidebar,'right');
    await page.locator('#closeAppearanceBtn').click();
    await page.reload();
    await page.waitForFunction(()=>document.body.dataset.view==='deals');
    assert.equal(await page.evaluate(()=>document.body.dataset.sidebar),'right');
    assert.equal(await page.evaluate(()=>document.body.dataset.sidebarCollapsed),'true');
    assert.equal(await page.locator('#platformNavItem').isVisible(),false);
    assert.equal(await page.evaluate(()=>document.documentElement.style.getPropertyValue('--bg')),'#112233');
    const side=await page.locator('.sidebar').boundingBox();assert.ok(side.x>1200&&side.width<=70);
    if(name==='chromium'&&process.env.KLYO_PERSONAL_PREVIEW)await page.screenshot({path:path.join(process.env.KLYO_PERSONAL_PREVIEW,'personal-workspace.png'),animations:'disabled'});
    await page.locator('#appearanceBtn').click();
    if(name==='chromium'&&process.env.KLYO_PERSONAL_PREVIEW)await page.locator('.settings-modal').screenshot({path:path.join(process.env.KLYO_PERSONAL_PREVIEW,'personal-settings.png'),animations:'disabled'});
    if(screenshotDir)await page.screenshot({path:path.join(screenshotDir,`${name}-personal-settings.png`),animations:'disabled'});
    await page.setViewportSize({width:390,height:844});
    assert.ok(await page.locator('.settings-modal').evaluate(el=>el.scrollWidth<=el.clientWidth+1));
    assert.ok(await page.locator('#savePreferencesBtn').isVisible());
    if(screenshotDir)await page.screenshot({path:path.join(screenshotDir,`${name}-personal-settings-mobile.png`),animations:'disabled'});
    await page.setViewportSize({width:1440,height:1000});
    await page.locator('#closeAppearanceBtn').click();
    assert.equal(await page.locator('.nav-item[data-view=calendar]').isVisible(),false);
    assert.deepEqual(await page.locator('.personal-nav>.nav-item').evaluateAll(items=>items.map(el=>el.dataset.view)),preferences.layout.nav_order);
    await page.locator('.nav-item[data-view=overview]').click();
    await page.locator('#personalOverview').waitFor();
    assert.equal(await page.locator('#personalOverview').getAttribute('data-layout'),'stacked');
    assert.equal(await page.locator('#personalOverview [data-widget=losses]').isVisible(),false);
    assert.deepEqual(await page.locator('#personalOverview>[data-widget]').evaluateAll(items=>items.map(el=>el.dataset.widget)),preferences.layout.overview_order);
    await page.locator('.nav-item[data-view="pipeline"]').click();
    await page.locator('#contactsBody tr').first().waitFor();
    assert.equal(await page.locator('#contactsTable th[data-column="tags"]').isVisible(),false);
    assert.deepEqual(await page.locator('#contactsTable thead th').evaluateAll(items=>items.map(el=>el.dataset.column)),preferences.layout.contact_columns);
    const positions=await page.evaluate(()=>({table:document.querySelector('#pipelineView .table-card').getBoundingClientRect().top,summary:document.querySelector('#pipelineView .stat-grid').getBoundingClientRect().top}));assert.ok(positions.summary>positions.table);
    await page.locator('#appearanceBtn').click();
    failPreferences=true;
    await page.locator('#hex-background').fill('#441122');
    await page.locator('#savePreferencesBtn').click();
    await page.waitForFunction(()=>document.querySelector('#preferencesError').textContent.includes('Fixture save failed'));
    await page.locator('#closeAppearanceBtn').click();
    assert.equal(await page.evaluate(()=>document.documentElement.style.getPropertyValue('--bg')),'#112233');
    failPreferences=false;
    await page.locator('#appearanceBtn').click();
    await page.locator('#resetPreferencesBtn').click();
    await page.locator('#savePreferencesBtn').click();
    await page.waitForFunction(()=>!document.querySelector('#savePreferencesBtn').disabled);
    await page.locator('#closeAppearanceBtn').click();
    await page.reload();await page.waitForFunction(()=>document.querySelectorAll('#contactsBody tr').length===1);
    assert.equal(await page.evaluate(()=>document.body.dataset.sidebar),'left');
    assert.equal(await page.locator('#contactsTable th[data-column="tags"]').isVisible(),true);
    user.is_platform_admin=true;await page.reload();await page.locator('#contactsBody tr').first().waitFor();
    assert.equal(await page.locator('#platformNavItem').isVisible(),true);
    await page.locator('#appearanceBtn').click();assert.equal(await page.locator('#prefList-nav [data-key=platform]').count(),0);await page.locator('#closeAppearanceBtn').click();
    user.is_platform_admin=false;await page.reload();await page.locator('#contactsBody tr').first().waitFor();
    assert.equal(await page.locator('#platformNavItem').isVisible(),false);
    // Mixed light panels and dark canvas keep their text contrasts separate.
    await page.evaluate(()=>{const p=KlyoPreferences.defaults('custom').palette;p.custom.background='#000000';p.custom.surface='#ffffff';KlyoCustomize.applyLegacy('day');for(const[k,v]of Object.entries(KlyoPreferences.tokens(p)))document.documentElement.style.setProperty(k,v);});
    assert.equal(await page.locator('#contactsBody td').first().evaluate(el=>getComputedStyle(el).color),'rgb(17, 24, 39)');
    await page.reload();await page.locator('#contactsBody tr').first().waitFor();

    // Real PDF generation through fixture API: draft save, preview, download and approved attachment.
    await page.locator('.nav-item[data-view=quotes]').click();await page.locator('#addQuoteBtn').click();
    await page.locator('#quoteModalOverlay:not(.hidden)').waitFor();
    await page.selectOption('#quoteContactSelect','1');await page.locator('#quoteTitleInput').fill('Oferta strony internetowej');
    await page.selectOption('#doc-layout','executive');await page.selectOption('#doc-language','pl');
    await page.locator('#doc-reference').fill('OF-TEST-0042');await page.locator('#quoteTaxRate').fill('23');
    await page.locator('.line-desc-input').fill('Projekt i wdrożenie strony');await page.locator('.line-price-input').fill('4500');await page.locator('.line-discount-input').fill('10');
    await page.locator('.quote-document-details').first().locator('summary').click();
    await page.locator('#doc-seller-name').fill('Studio Testowe Łódź');
    await page.locator('.quote-document-details').last().locator('summary').click();const proposalTerms='Dwie rundy poprawek. Szczegóły do akceptacji. '.repeat(60).trim();await page.locator('#doc-terms').fill(proposalTerms);
    const logo=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=160;c.height=60;const x=c.getContext('2d');x.fillStyle='#2455d6';x.fillRect(0,0,160,60);x.fillStyle='white';x.font='bold 24px Arial';x.fillText('STUDIO',20,38);return c.toDataURL('image/png').split(',')[1];});
    await page.locator('#quoteLogoFile').setInputFiles({name:'studio.png',mimeType:'image/png',buffer:Buffer.from(logo,'base64')});try{await page.locator('#quoteLogoPreview:not([hidden])').waitFor();}catch(error){console.error('Logo error:',await page.locator('#quoteDesignError').textContent());throw error;}
    await page.locator('#saveQuoteDefaultsBtn').click();await page.waitForFunction(()=>!document.querySelector('#saveQuoteDefaultsBtn').disabled);
    assert.equal(quoteDefaults.seller.name,'Studio Testowe Łódź');
    await page.locator('#quoteSavePdfBtn').click();await page.waitForFunction(()=>document.querySelector('#quotePdfFrame').dataset.rendered==='true'&&!document.querySelector('#downloadPreviewPdfBtn').disabled);
    assert.equal(quoteSentCount,0);assert.match(await page.locator('#quotePdfFilename').textContent(),/OF-TEST-0042/);
    const savedQuote=[...quoteStore.values()].at(-1);assert.equal(savedQuote.total,4981.5);assert.equal(savedQuote.status,'draft');assert.equal(savedQuote.document.terms,proposalTerms);assert.match(savedQuote.document.logo_data_url,/^data:image\/png/);
    await page.locator('.pdf-next').click();await page.waitForFunction(()=>document.querySelector('#quotePdfFrame').dataset.page==='2'&&document.querySelector('#quotePdfFrame').dataset.rendered==='true');
    await page.locator('.pdf-prev').click();await page.waitForFunction(()=>document.querySelector('#quotePdfFrame').dataset.page==='1'&&document.querySelector('#quotePdfFrame').dataset.rendered==='true');
    await page.selectOption('.pdf-zoom','1.25');await page.waitForFunction(()=>document.querySelector('#quotePdfFrame').dataset.rendered==='true');
    const downloadPromise=page.waitForEvent('download');await page.locator('#downloadPreviewPdfBtn').click();const download=await downloadPromise;
    assert.equal(download.suggestedFilename(),'OF-TEST-0042.pdf');assert.equal(fs.readFileSync(await download.path()).subarray(0,5).toString(),'%PDF-');
    if(screenshotDir)await page.screenshot({path:path.join(screenshotDir,`${name}-pdf-preview.png`),animations:'disabled'});
    await page.locator('#closeQuotePdfBtn').click();
    await page.setViewportSize({width:390,height:844});assert.ok(await page.locator('.quote-modal').evaluate(el=>el.scrollWidth<=el.clientWidth+1));
    if(screenshotDir)await page.screenshot({path:path.join(screenshotDir,`${name}-pdf-builder-mobile.png`),animations:'disabled'});
    await page.setViewportSize({width:1440,height:1000});
    await page.locator('#quoteSendBtn').click();await page.locator('#quotePreviewOverlay:not(.hidden)').waitFor();
    assert.equal(await page.locator('#quoteAttachPdf').isChecked(),true);assert.match(await page.locator('#quoteAttachmentName').textContent(),/OF-TEST-0042/);assert.equal(quoteSentCount,0);
    await page.locator('#confirmSendQuoteBtn').click();await page.waitForFunction(()=>document.querySelector('#quotePreviewOverlay').classList.contains('hidden'));
    assert.equal(quoteSentCount,1);assert.equal(lastQuoteSend.attach_pdf,true);assert.ok(lastQuoteSend.revision);
    await page.locator(`#quotesBody tr[data-id="${savedQuote.id}"]`).click();await page.locator('#quoteDuplicateBtn').click();
    await page.waitForFunction(()=>document.querySelector('#quotePanelTitle').textContent.includes('(copy)'));
    assert.equal([...quoteStore.values()].at(-1).status,'draft');assert.equal(quoteSentCount,1);
    const copyId=[...quoteStore.values()].at(-1).id;
    await page.locator('#sendQuoteFromPanelBtn').click();await page.locator('#quotePreviewOverlay:not(.hidden)').waitFor();
    await page.locator('#backToEditQuoteBtn').click();await page.locator('#quoteModalOverlay:not(.hidden)').waitFor();
    assert.equal(await page.locator('#quoteId').inputValue(),String(copyId));assert.equal(quoteSentCount,1);
    await page.locator('#closeQuoteModalBtn').click();
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
    assert.equal(await page.locator('body').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(255, 255, 255)');
    await page.locator('#themeGallery .gallery-theme').first().waitFor();
    await page.locator('.demo-theme-tabs [data-demo-theme=day]').click();
    assert.equal(await page.locator('#workspaceDemo').evaluate(el=>el.style.getPropertyValue('--demo-bg')),'#edf1f7');
    await page.locator('#demoPosition').click();
    assert.equal(await page.locator('#workspaceDemo').getAttribute('data-position'),'right');
    await page.selectOption('#demoDensity','comfortable');
    assert.equal(await page.locator('#workspaceDemo').getAttribute('data-density'),'comfortable');
    await page.locator('#demoSwapColumns').click();
    assert.equal(await page.locator('.demo-table th').last().getAttribute('data-demo-column'),'company');
    await page.locator('#demoAccent').evaluate(el=>{el.value='#ff6655';el.dispatchEvent(new Event('input',{bubbles:true}));});
    assert.equal(await page.locator('#workspaceDemo').evaluate(el=>el.style.getPropertyValue('--demo-accent')),'#ff6655');
    await page.locator('#demoFocus').click();
    assert.equal(await page.locator('#demoFocus').getAttribute('aria-pressed'),'true');
    await page.locator('[data-email-lang=es]').click();
    assert.match(await page.locator('#emailBody').textContent(),/Hola/);
    await page.locator('[data-email-lang=en]').click();
    assert.match(await page.locator('#emailSubject').textContent(),/website/);
    await page.locator('[data-email-lang=pl]').click();
    assert.match(await page.locator('#emailBody').textContent(),/Dzień dobry/);
    await page.locator('#motionToggle').click();
    assert.equal(await page.locator('html').getAttribute('data-motion'),'off');
    for(const img of await page.locator('main img').all()){await img.scrollIntoViewIfNeeded();await img.evaluate(el=>el.complete&&el.naturalWidth>0?Promise.resolve():new Promise((resolve,reject)=>{el.onload=resolve;el.onerror=()=>reject(new Error('Missing image '+el.src));}));}
    await page.evaluate(()=>scrollTo(0,0));
    if (screenshotDir) await page.locator('.toast').evaluateAll(items=>items.forEach(item=>item.remove()));
    if (screenshotDir) await page.screenshot({ path: path.join(screenshotDir, `${name}-landing.png`), fullPage: true, animations: 'disabled' });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.locator('summary').first().click();
    if (screenshotDir) await page.locator('.toast').evaluateAll(items=>items.forEach(item=>item.remove()));
    await page.evaluate(()=>scrollTo(0,0));
    if (screenshotDir) await page.screenshot({ path: path.join(screenshotDir, `${name}-landing-mobile.png`), fullPage: true, animations: 'disabled' });
    await page.emulateMedia({reducedMotion:'reduce'});
    await page.reload();await page.locator('#themeGallery .gallery-theme').first().waitFor();
    assert.equal(await page.locator('html').getAttribute('data-motion'),'off');
    assert.equal(await page.locator('.personal-section').evaluate(el=>getComputedStyle(el).opacity),'1');
    assert.deepEqual(errors, []);
    console.log(`${name}: PASS — reload, failed auxiliary request, visible pipeline error, currency persistence, quote currency, Blanc/Noir, fitted stages, tasks, loss reasons, templates, saved views, personal colors and layout persistence/cancel/reset, menu/column/widget order and visibility, owner-only Platform, search races, PDF creation/download/approved attachment, white interactive landing desktop/mobile, reduced motion, no automatic sends`);
  } finally { await browser.close(); }
}
(async () => { if(!process.env.KLYO_BROWSER||process.env.KLYO_BROWSER==='chromium')await run(chromium, 'chromium');if(!process.env.KLYO_BROWSER||process.env.KLYO_BROWSER==='webkit')await run(webkit, 'webkit'); })().catch(error => { console.error(error); process.exitCode = 1; });
