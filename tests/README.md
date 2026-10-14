# Regression checks

`npm test` runs the currency validation and transaction tests. To also run the API checks against PostgreSQL, set `TEST_DATABASE_URL` to a local disposable database:

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
