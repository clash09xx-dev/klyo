# Regression checks

`npm test` runs validation, language-prompt and transaction tests. To also run the API checks against PostgreSQL, set `TEST_DATABASE_URL` to a local disposable database:

```sh
TEST_DATABASE_URL=postgresql://localhost/klyo_test npm test
```

The integration test creates and drops a unique schema containing synthetic data. It checks admin permissions, existing deal/product/draft currency corrections, unchanged numeric amounts, isolation between two workspaces, preservation of sent quotes, new record defaults, quote edits/email previews, and transaction rollback after a database failure. It does not load `.env` or send email.

Browser checks require Playwright and its Chromium/WebKit browsers. They use synthetic HTTP fixtures and the real dashboard HTML, JavaScript and CSS:

```sh
npm install --no-save --package-lock=false playwright
npx playwright install chromium webkit
npm run test:browser
```

They check first load and reload, failed auxiliary requests, visible pipeline load errors, settings currency changes, persistence across reload, quote currency totals, Blanc/Noir contrast, vertical deal cards, all stages fitting the viewport width, full-height columns, internal card scrolling and empty-state recovery and drag/drop between stages. Optional environment variables: `KLYO_QA_SCREENSHOTS` saves screenshots; `KLYO_CHROMIUM_PATH` and `KLYO_WEBKIT_PATH` select existing browser executables.

Changing the workspace currency relabels all existing deals and products and all never-sent draft quotes. It does not apply exchange rates. Previously sent quotes keep their original currency. Saving the same currency again repairs older records left behind by the previous default-only implementation.

Personal-workspace checks cover per-user persistence, legacy theme migration, menu and column order, custom colors, strict validation, cross-account isolation and owner-only Platform access. AI route tests use a stubbed generator: they check original instructions, saved fallback language, role/workspace boundaries and persisted unsent drafts; they do not call a paid model or evaluate its generated language.

Browser checks also cover personal layout after reload, failed saves and Cancel/Reset, right and collapsed navigation, column visibility, palette contrast, out-of-order search responses, owner/nonowner Platform visibility, the interactive landing preview, sample email languages, mobile overflow and reduced motion. Set `KLYO_PERSONAL_PREVIEW` to an existing output directory to generate the two synthetic product screenshots used on the landing.

Proposal PDF tests cover cent rounding, optional tax, Unicode fonts, both styles, safe document inputs, PNG/JPEG branding, authenticated/private exports and capability share links, defaults, duplication, draft immutability, viewer/workspace boundaries and transactional rollback. Email providers are stubbed; no real recipient receives a test message. Concurrent approval checks ensure only one request can send a draft. The preview uses vendored PDF.js, loaded only when opened; browser checks verify actual canvas rendering, page controls, zoom, logo upload, PDF download and explicit attachment approval.
