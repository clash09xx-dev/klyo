// End-to-end UI against real Express routes and isolated PostgreSQL. No real email, AI or Stripe calls.
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  { Pool } = require("pg"),
  express = require("express"),
  jwt = require("jsonwebtoken"),
  { chromium, webkit } = require("playwright");
const publicDir = path.join(__dirname, "../public"),
  out =
    process.env.KLYO_QA_SCREENSHOTS || path.join(__dirname, "../../qa-custom");
(async () => {
  if (!process.env.TEST_DATABASE_URL)
    throw new Error(
      "Set TEST_DATABASE_URL to the disposable PostgreSQL instance.",
    );
  fs.mkdirSync(out, { recursive: true });
  const schema = `klyo_ui_${process.pid}_${Date.now()}`,
    admin = new Pool({
      connectionString: process.env.TEST_DATABASE_URL,
      ssl: false,
    });
  await admin.query(`CREATE SCHEMA ${schema}`);
  const url = new URL(process.env.TEST_DATABASE_URL);
  url.searchParams.set("options", `-c search_path=${schema}`);
  process.env.DATABASE_URL = url.toString();
  process.env.PGSSL = "false";
  process.env.JWT_SECRET = "local-real-ui-test";
  process.env.STRIPE_SECRET_KEY = "";
  process.env.PLATFORM_ADMIN_EMAIL = "platform-owner@example.test";
  const mailer = require.resolve("../server/services/mailer");
  require.cache[mailer] = {
    id: mailer,
    filename: mailer,
    loaded: true,
    exports: {
      sendOfferEmail: async () => {
        throw new Error("Unexpected email send during browser QA");
      },
    },
  };
  const db = require("../server/db");
  let server;
  try {
    await db.init();
    const app = express();
    app.use(express.json({ limit: "50mb" }));
    for (const name of [
      "auth",
      "spaces",
      "contacts",
      "companies",
      "products",
      "deals",
      "pipelines",
      "sales",
      "quotes",
      "quote-templates",
      "price-lists",
      "sharepoint",
      "custom-fields",
      "warranty",
      "tasks",
      "calendar",
      "history",
      "team-stats",
      "billing",
      "offers",
      "reminders",
      "clients",
      "stats",
      "discounts",
      "integrations",
      "platform",
    ])
      app.use("/api/" + name, require("../server/routes/" + name));
    app.use("/q", require("../server/routes/publicQuotes"));
    app.use(express.static(publicDir));
    app.get("/app", (req, res) =>
      res.sendFile(path.join(publicDir, "app.html")),
    );
    app.get("/customization", (req, res) =>
      res.sendFile(path.join(publicDir, "customization.html")),
    );
    app.get(["/signup", "/login"], (req, res) =>
      res.sendFile(path.join(publicDir, "login.html")),
    );
    server = await new Promise((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    const base = `http://127.0.0.1:${server.address().port}`;
    for (const [name, engine] of [
      ["chromium", chromium],
      ["webkit", webkit],
    ]) {
      if (process.env.KLYO_BROWSER && process.env.KLYO_BROWSER !== name)
        continue;
      const ws = (
        await db.query(
          "INSERT INTO workspaces(name,invite_code,is_comped,default_currency) VALUES($1,$2,true,'PLN') RETURNING *",
          ["Northline Systems", "UI-" + name],
        )
      ).rows[0];
      const user = (
        await db.query(
          "INSERT INTO users(workspace_id,name,email,password_hash,role,language,has_seen_onboarding,terms_accepted_at) VALUES($1,'Demo owner',$2,'fixture','admin','en',true,now()) RETURNING *",
          [ws.id, "owner-" + name + "@example.test"],
        )
      ).rows[0];
      await db.query("UPDATE workspaces SET owner_user_id=$1 WHERE id=$2", [
        user.id,
        ws.id,
      ]);
      const token = jwt.sign(
          {
            id: user.id,
            workspace_id: ws.id,
            name: user.name,
            email: user.email,
            role: user.role,
          },
          process.env.JWT_SECRET,
        ),
        browser = await engine.launch({
          headless: true,
          executablePath:
            process.env["KLYO_" + name.toUpperCase() + "_PATH"] || undefined,
        });
      try {
        const context = await browser.newContext({
            viewport: { width: 1440, height: 1000 },
            deviceScaleFactor: 2,
            locale: "en-GB",
            timezoneId: "Europe/Warsaw",
          }),
          page = await context.newPage(),
          errors = [];
        page.on("dialog", (d) => d.accept());
        page.on("pageerror", (e) => {
          errors.push(e.message);
          console.error("Browser error:", e.message);
        });
        await context.addInitScript(
          ({ token, user }) => {
            if (!localStorage.getItem("klyo_token")) {
              localStorage.setItem("klyo_token", token);
              localStorage.setItem("klyo_user", JSON.stringify(user));
            }
          },
          { token, user },
        );
        await page.goto(base + "/app");
        await page.locator("#emptyState:not(.hidden)").waitFor();
        // Import CSV through the real mapping/preview/commit UI.
        await page.locator('[data-view="products"]').click();
        await page.locator("#priceListsBtn").click();
        await page.locator("#newPriceImport").click();
        await page.locator("#pricesName").fill("Sensor distributor");
        await page.locator("#pricesFile").setInputFiles({
          name: "sensor-prices.csv",
          mimeType: "text/csv",
          buffer: Buffer.from(
            "Product name,SKU,Unit price,Currency\nTemperature sensor,SEN-01,1200,PLN\nInstallation,INS-01,300,PLN\n",
          ),
        });
        await page.locator('[data-price-map="name"]').waitFor();
        await page.locator("#previewPrices").click();
        await page.locator("#confirmPricesImport").waitFor();
        assert.equal(await page.locator("[data-price-row]:checked").count(), 2);
        await page.locator("#pricesCurrency").selectOption("USD");
        assert.equal(await page.locator("#confirmPricesImport").count(), 0);
        await page.locator("#pricesCurrency").selectOption("PLN");
        await page.locator("#previewPrices").click();
        await page.locator("#confirmPricesImport").waitFor();
        await page.locator("#pricesName").fill("Sensor distributor");
        await page.locator("#confirmPricesImport").click();
        await page.locator("#pricesMapping").waitFor({ state: "detached" });
        await page.locator(".doc-overlay header button").click();
        assert.match(
          await page.locator("#productsBody").innerText(),
          /Temperature sensor/,
        );
        // Create a client and a quote, then select the imported list.
        const client = await page.evaluate(
          async () =>
            (
              await API.post("/contacts", {
                full_name: "Eastfield Engineering",
                email: "procurement@example.test",
              })
            ).contact,
        );
        await page.evaluate(async () => {
          await loadAllContactsCache();
          await openQuoteModal(null);
        });
        await page
          .locator("#quoteContactSelect")
          .selectOption(String(client.id));
        await page.locator("#quoteContactSelect").dispatchEvent("change");
        await page
          .locator("#quoteTitleInput")
          .fill("Sensor supply and installation");
        const list = (
          await db.query("SELECT id FROM price_lists WHERE workspace_id=$1", [
            ws.id,
          ])
        ).rows[0];
        await page.locator("#quotePriceList").selectOption(String(list.id));
        await page.waitForFunction(
          () =>
            document.querySelectorAll(".line-product-select option").length ===
            3,
        );
        const product = (
          await db.query(
            "SELECT id FROM products WHERE workspace_id=$1 AND sku='SEN-01'",
            [ws.id],
          )
        ).rows[0];
        await page
          .locator(".line-product-select")
          .selectOption(String(product.id));
        assert.equal(
          Number(await page.locator(".line-price-input").inputValue()),
          1200,
        );
        await page.locator("#quoteTaxRate").fill("23");
        await page.locator("#quoteDiscountType").selectOption("percent");
        await page.locator("#quoteDiscountAmount").fill("10");
        await page.locator("#createOwnTemplate").click();
        await page.locator("#quoteDesigner:not([hidden])").waitFor();
        assert.equal(await page.locator(".designer-element").count(), 0);
        await page.locator('[data-add-element="field"]').click();
        await page
          .locator('[data-property="field"]')
          .selectOption("buyer.name");
        await page.locator('[data-property="x"]').fill("22");
        await page.locator('[data-property="x"]').dispatchEvent("change");
        assert.match(
          await page.locator(".designer-element").getAttribute("style"),
          /left:22mm/,
        );
        const box = await page.locator(".designer-element").boundingBox();
        await page.mouse.move(box.x + 20, box.y + 20);
        await page.mouse.down();
        await page.mouse.move(box.x + 65, box.y + 40, { steps: 8 });
        await page.mouse.up();
        assert.notEqual(
          await page.locator('[data-property="x"]').inputValue(),
          "22",
        );
        await page.locator("#designerUndo").click();
        await page.locator("#designerStarter").click();
        // A starter is optional. It is now freely editable just like the blank sheet.
        await page.locator("#designerName").fill("Sensor proposal — A4");
        await page.locator('[data-layer="heading"]').click();
        await page.locator('[data-property="color"]').fill("#244e85");
        await page.locator('[data-property="color"]').dispatchEvent("change");
        await page.locator("#designerZoom").fill("65");
        await page.locator("#designerZoom").dispatchEvent("change");
        await page.screenshot({
          path: path.join(out, name + "-a4-designer.png"),
        });
        await page.locator("#designerPreview").click();
        await page
          .locator("#designerPdfViewer canvas")
          .first()
          .waitFor({ timeout: 20000 });
        assert.equal(
          await page.locator("#designerPdfViewer canvas").count(),
          1,
        );
        await page.screenshot({
          path: path.join(out, name + "-a4-preview.png"),
        });
        await page.locator("#designerPdfClose").click();
        await page.locator("#designerSave").click();
        await page.locator("#quoteDesigner").waitFor({ state: "hidden" });
        const saved = (
          await db.query(
            "SELECT content FROM quote_templates WHERE workspace_id=$1",
            [ws.id],
          )
        ).rows[0].content;
        assert.equal(saved.document.layout, "canvas");
        assert.equal(saved.tax_rate, 23);
        assert.equal(saved.discount_type, "percent");
        assert.equal(saved.discount_value, 10);
        assert.equal(await page.locator("#quoteTaxRate").inputValue(), "23");
        assert.match(
          await page.locator("#quoteTotalValue").innerText(),
          /1,328.40/,
        );
        assert.equal(
          saved.document.canvas.pages[0].elements.find(
            (e) => e.id === "heading",
          ).color,
          "#244e85",
        );
        const actualQuote = await page.evaluate(
          async () =>
            (
              await API.post("/quotes", {
                contact_id: document.getElementById("quoteContactSelect").value,
                title: document.getElementById("quoteTitleInput").value,
                currency: document.getElementById("quoteCurrencySelect").value,
                line_items: currentQuoteLineItems,
                ...KlyoQuoteStudio.collect(),
              })
            ).quote,
        );
        const publicContext = await browser.newContext({
            viewport: { width: 390, height: 844 },
          }),
          publicPage = await publicContext.newPage();
        try {
          await publicPage.goto(base + "/q/" + actualQuote.public_token);
          await publicPage.waitForFunction(
            () =>
              document.querySelector("#publicQuoteViewer")?.dataset.rendered ===
              "true",
          );
          assert.equal(
            await publicPage.locator(".pdf-page-label").textContent(),
            "Page 1 / 1",
          );
          assert.ok(
            await publicPage.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth + 1,
            ),
          );
          const inline = await publicPage.request.get(
            base + "/q/" + actualQuote.public_token + "/pdf?inline=1",
          );
          assert.match(inline.headers()["content-disposition"], /^inline;/);
          await publicPage.screenshot({
            path: path.join(out, name + "-public-custom-pdf-mobile.png"),
          });
        } finally {
          await publicContext.close();
        }
        await page.locator("#editOwnLayout").click();
        assert.equal(await page.locator(".designer-element").count(), 9);
        await page.keyboard.press("Escape");
        assert.equal(
          await page
            .locator("#quoteModalOverlay")
            .evaluate((el) => el.classList.contains("hidden")),
          false,
        );
        await page.evaluate(() => closeQuoteModal());
        // An unconfigured Microsoft app explains the required owner setup without showing fake connectivity.
        await page.locator('[data-view="files"]').click();
        await page.locator("#filesSettings").click();
        assert.match(
          await page.locator(".doc-content").innerText(),
          /Entra app registration/,
        );
        assert.equal(
          await page
            .locator('.doc-content a[href="/docs/sharepoint-setup"]')
            .count(),
          1,
        );
        await page.locator(".doc-overlay header button").click();
        await page.screenshot({
          path: path.join(out, name + "-files-setup.png"),
        });
        // Exercise the connected Files UI with simulated Microsoft responses only.
        const SP = require("../server/services/sharepoint"),
          originalGraph = SP.graph,
          originalFetch = global.fetch;
        const root = { id: "root-" + name, name: "CRM", folder: {} },
          fileNode = {
            id: "manual-" + name,
            name: "Product manual.pdf",
            size: 12,
            file: { mimeType: "application/pdf" },
            parentReference: { driveId: "drive-" + name, id: root.id },
            webUrl: "https://example.sharepoint.com/manual.pdf",
          };
        await db.query(
          "INSERT INTO sharepoint_connections(workspace_id,connected_by,account_id,account_name,token_cache,drive_id,root_id,root_name,generation) VALUES($1,$2,'mock','demo@example.test',$3,$4,$5,'CRM','g1')",
          [ws.id, user.id, SP.encrypt("mock-cache"), "drive-" + name, root.id],
        );
        SP.graph = async (wid, route) => {
          if (route.includes("createUploadSession"))
            return {
              uploadUrl: "https://example.sharepoint.com/upload-test",
              expirationDateTime: new Date(Date.now() + 600000).toISOString(),
            };
          if (route.includes("/children")) return { value: [fileNode] };
          return route.includes("/items/" + root.id) ? root : fileNode;
        };
        global.fetch = async (url, opts) =>
          String(url) === "https://example.sharepoint.com/upload-test"
            ? new Response(
                JSON.stringify({
                  ...fileNode,
                  id: "uploaded-" + name,
                  name: "Offer.pdf",
                }),
                {
                  status: 201,
                  headers: { "Content-Type": "application/json" },
                },
              )
            : originalFetch(url, opts);
        try {
          await page.evaluate(() => KlyoFiles.refresh());
          await page.locator("#filesLink").click();
          await page.locator("#fileRecordType").selectOption("contact");
          await page
            .locator("#fileRecordId option")
            .nth(1)
            .waitFor({ state: "attached" });
          await page.locator("#fileRecordId").selectOption(String(client.id));
          await page.locator("#fileRecordContinue").click();
          await page.locator("[data-picker-item]").click();
          await page.waitForFunction(() =>
            document
              .querySelector("#filesRows")
              .textContent.includes("Product manual.pdf"),
          );
          await page.locator("#filesUpload").click();
          await page.locator("#fileRecordContinue").click();
          await page.locator("#filesInput").setInputFiles({
            name: "Offer.pdf",
            mimeType: "application/pdf",
            buffer: Buffer.alloc(12),
          });
          await page.waitForFunction(() =>
            document
              .querySelector("#filesRows")
              .textContent.includes("Offer.pdf"),
          );
          assert.equal(
            (
              await db.query(
                "SELECT count(*)::int n FROM workspace_files WHERE workspace_id=$1",
                [ws.id],
              )
            ).rows[0].n,
            2,
          );
          await page.screenshot({
            path: path.join(out, name + "-files-connected.png"),
          });
        } finally {
          SP.graph = originalGraph;
          global.fetch = originalFetch;
        }
        // Verify XLSX parsing and worksheet selection with the same isolated importer.
        await page.locator('[data-view="products"]').click();
        await page.locator("#priceListsBtn").click();
        await page.locator("#newPriceImport").click();
        const X = require("../public/vendor/sheetjs/xlsx-0.20.3.min.js"),
          book = X.utils.book_new();
        X.utils.book_append_sheet(
          book,
          X.utils.aoa_to_sheet([
            ["Name", "Price"],
            ["Service", 450],
          ]),
          "Services",
        );
        await page.locator("#pricesFile").setInputFiles({
          name: "services.xlsx",
          mimeType:
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          buffer: Buffer.from(
            X.write(book, { type: "array", bookType: "xlsx" }),
          ),
        });
        await page.locator("#pricesSheet").waitFor();
        assert.equal(
          await page.locator("#pricesSheet").inputValue(),
          "Services",
        );
        await page.locator("#previewPrices").click();
        await page.locator("#confirmPricesImport").waitFor();
        assert.equal(await page.locator("[data-price-row]:checked").count(), 1);
        assert.deepEqual(errors, []);
        console.log(
          name +
            ": CSV/XLSX imports, quote price selection, blank A4 drag/save/reopen/PDF preview, and SharePoint setup passed",
        );
      } catch (e) {
        const p = browser.contexts()[0]?.pages()[0];
        if (p) {
          await p
            .screenshot({
              path: path.join(out, `${name}-failure.png`),
              fullPage: true,
            })
            .catch(() => {});
          console.error(
            "UI at failure:",
            (await p.locator("body").innerText()).slice(-1800),
          );
        }
        throw e;
      } finally {
        await browser.close();
      }
    }
  } finally {
    if (server) await new Promise((r) => server.close(r));
    await new Promise((r) => setTimeout(r, 20));
    await db.pool.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
