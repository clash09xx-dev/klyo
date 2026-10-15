// Local-only sample exports. Requires Playwright from the authoring environment.
// Never connects to a customer database, account, email service or payment provider.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const express = require('express');
const { chromium } = require('playwright');
const Q = require('../public/js/quote-core');
const P = require('../public/js/preferences-core');
const { generateQuotePdf } = require('../server/services/quotePdf');
const root = path.join(__dirname, '..');
const images = path.join(root, 'public/images');

async function proposal() {
  const totals = Q.computeTotals([
    { description: 'Website design\nFive responsive pages; two design review rounds.', quantity: 1, unit_price: 2400, discount_percent: 10 },
    { description: 'Development & launch\nCMS, contact forms, analytics and launch checks.', quantity: 1, unit_price: 3600 },
    { description: 'Team handover\nLive training and a practical editing guide.', quantity: 2, unit_price: 150 },
  ], 0, { type: 'fixed', value: 60 });
  const document = Q.normalizeDocument({
    language: 'en', layout: 'studio', accent: '#345b32', body_size: 9,
    seller: { name: 'Northline Studio', details: 'London, United Kingdom', email: 'hello@northline.example' },
    buyer: { name: 'Harbor Supply', details: 'Alex Morgan · Bristol, United Kingdom', email: 'alex@harbor.example' },
    reference: 'Q-SAMPLE-001', issued_on: '2026-10-15', valid_until: '2026-10-29',
    payment: '50% on approval; 50% before launch. Invoices are payable within 14 days.',
    delivery: 'Four weeks from receipt of approved content and the initial payment.',
    terms: 'Delivery: Four weeks after content approval and initial payment.\nPayment: 50% on approval, 50% before launch; invoices due within 14 days.\nIncludes two design review rounds and 30 days of defect support. Hosting, copywriting and ongoing maintenance are excluded. Additional work requires written approval.',
    sections: ['items', 'terms'],
    headings: {terms:'Project details & terms'},
    footer: 'Northline Studio · Illustrative sample only · Not a live offer',
  });
  const quote = {
    id: 1, title: 'Website design & launch', currency: 'USD', created_at: '2026-10-15',
    intro_message: '',
    ...totals, discount_total: totals.discountTotal, document,
  };
  assert.equal(quote.total, 6000);
  fs.writeFileSync(path.join(root, 'public/examples/klyo-proposal.pdf'), await generateQuotePdf(quote, totals.computed));
  console.log('English sample proposal exported by the actual Klyo PDF renderer.');
}

async function screenshots() {
  const preferences = P.defaults('custom');
  Object.assign(preferences.palette.custom, { background: '#101c25', surface: '#192a35', accent: '#a6e7ba', sidebar: '#0c151d' });
  Object.assign(preferences.layout, { sidebar: 'right', density: 'standard', start_view: 'deals', collapsed: false });
  const user = { id: 1, workspace_id: 1, scope: 'team', name: 'Maya Lewis', email: 'maya@northline.example', role: 'admin', language: 'en', theme: 'custom', has_seen_onboarding: true, terms_accepted_at: '2026-10-01', workspace_preferences: preferences, is_team_owner: true, can_manage_billing: true };
  const team = [user, { id: 2, name: 'Oliver Clark', email: 'oliver@northline.example', role: 'member' }];
  const stages = ['New enquiry', 'Discovery', 'Proposal', 'Negotiation', 'Won'].map((name, i) => ({ id: i + 1, pipeline_id: 1, name, color: ['#a7b7cf', '#79b9ff', '#c7b1fa', '#f3c980', '#9bdeb4'][i], sort_order: i }));
  const contacts = ['Alex Morgan', 'Sofia Martin', 'James Wilson', 'Emma Reed', 'Lucas Bennett', 'Amelia Brooks'].map((full_name, i) => ({ id: i + 1, full_name, company_name: ['Harbor Supply', 'Studio Martin', 'Westfield Group', 'Oak & Field', 'Atlas Works', 'Goodwell'][i], email: 'hello@client-' + (i + 1) + '.example', status: i === 4 ? 'customer' : 'lead', tags: [], owner_name: team[i % 2].name }));
  const deals = [
    ['Website redesign', 6000, 3, 0, 'Review proposal with Alex', '2026-10-16'],
    ['Brand identity', 4200, 2, 1, 'Discovery workshop', '2026-10-19'],
    ['Quarterly support', 1800, 1, 2, 'Introductory call', '2026-10-16'],
    ['Online shop', 8500, 4, 3, 'Confirm project scope', '2026-10-20'],
    ['Content migration', 2400, 5, 4, null, null],
    ['Product photography', 3200, 3, 5, 'Present creative direction', '2026-10-21'],
  ].map(([title, value, stage_id, contact, next_task_title, next_task_due], i) => ({ id: i + 1, pipeline_id: 1, title, value, currency: 'USD', stage_id, contact_id: contact + 1, contact_name: contacts[contact].full_name, company_name: contacts[contact].company_name, status: stage_id === 5 ? 'won' : 'open', quantity: 1, assigned_to: i % 2 + 1, assigned_name: team[i % 2].name, next_task_id: next_task_title ? i + 1 : null, next_task_title, next_task_due, overdue_tasks: 0, stage_entered_at: '2026-10-14T12:00:00Z' }));
  const pipelines = [{ id: 1, name: 'Design & digital', description: 'Brand, website and digital projects, from first enquiry to signed proposal.', is_default: true, deal_count: deals.length }];
  const { TIERS, TIER_ORDER } = require('../server/config/tiers');
  const data = {
    '/auth/me': { user }, '/auth/preferences': { preferences }, '/auth/team': { team },
    '/auth/workspace': { workspace: { id: 1, name: 'Northline Studio', default_currency: 'USD' } },
    '/auth/workspace/settings': { workspace: { id: 1, name: 'Northline Studio', default_currency: 'USD' } },
    '/auth/workspace/ai-context': { ai_context: '' },
    '/spaces': { active: 'team', team: { id: 1, name: 'Northline Studio', owner_user_id: 1 }, personal: { id: 2, name: 'Maya’s private workspace' }, is_team_owner: true },
    '/warranty/notifications': { items: [], count: 0 }, '/custom-fields': { fields: [] },
    '/billing/status': { active: true, plan: 'active', tier: 'plus', is_comped: true },
    '/billing/tiers': { tiers: TIER_ORDER.map(key => ({ key, ...TIERS[key] })), extraSeatPrice: 5 },
    '/integrations/mail/status': { smtp: { configured: false }, gmail: { connected: false } },
    '/companies': { companies: contacts.map(c => ({ id: c.id, name: c.company_name })) },
    '/products': { products: [] }, '/contacts': { contacts }, '/contacts/themes': { themes: [] }, '/contacts/tags': { tags: [] },
    '/stats': { total: contacts.length, leads: 5, negotiating: 1, offersSent: 3, series: [1, 2, 3, 4, 5, 6] },
    '/pipelines': { pipelines }, '/deals': { deals }, '/deals/stages': { stages },
    '/sales/views': { views: [] }, '/sales/templates': { templates: [] },
  };
  const app = express();
  const unexpected = [];
  app.use('/api', (req, res) => {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Read-only sample workspace.' });
    const payload = data[req.path];
    if (!payload) { unexpected.push(req.path); return res.status(404).json({ error: 'Missing sample fixture.' }); }
    res.json(payload);
  });
  app.use(express.static(path.join(root, 'public')));
  app.get('/app', (_, res) => res.sendFile(path.join(root, 'public/app.html')));
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const browser = await chromium.launch({ headless: true, executablePath: process.env.KLYO_CHROMIUM_PATH || undefined });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 820 }, deviceScaleFactor: 2, locale: 'en-GB', timezoneId: 'Europe/London', reducedMotion: 'reduce' });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
    await context.addInitScript(({ user }) => { localStorage.setItem('klyo_token', 'local-sample-only'); localStorage.setItem('klyo_user', JSON.stringify(user)); }, { user });
    await page.goto('http://127.0.0.1:' + server.address().port + '/app');
    await page.locator('.deal-card').first().waitFor();
    await page.locator('#salesPipelineSelect option').first().waitFor({ state: 'attached' });
    await page.evaluate(() => document.fonts.ready);
    assert.equal(await page.locator('.deal-card').count(), deals.length);
    assert.equal(await page.locator('.toast').count(), 0);
    await page.screenshot({ path: path.join(images, 'personal-workspace.png'), animations: 'disabled' });
    await page.setViewportSize({ width: 1280, height: 1120 });
    await page.locator('#appearanceBtn').click();
    await page.locator('#appearanceModalOverlay:not(.hidden)').waitFor();
    await page.locator('[data-preset=custom][aria-pressed=true]').waitFor();
    await page.locator('.settings-modal').screenshot({ path: path.join(images, 'personal-settings.png'), animations: 'disabled' });
    assert.deepEqual(errors, []);
    assert.deepEqual(unexpected, []);
    console.log('Fresh 2× CRM screenshots captured with fictional English sample data.');
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}

(async () => {
  if (!process.argv.includes('--screenshots-only')) await proposal();
  if (!process.argv.includes('--pdf-only')) await screenshots();
})().catch(error => { console.error(error); process.exitCode = 1; });
