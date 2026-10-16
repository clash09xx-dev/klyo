const assert = require("node:assert/strict"),
  path = require("node:path"),
  { chromium, webkit } = require("playwright");
(async () => {
  for (const [name, engine, executablePath] of [
    ["chromium", chromium, process.env.KLYO_CHROMIUM_PATH],
    ["webkit", webkit, process.env.KLYO_WEBKIT_PATH],
  ]) {
    if (process.env.KLYO_BROWSER && process.env.KLYO_BROWSER !== name) continue;
    const browser = await engine.launch({
      headless: true,
      ...(executablePath ? { executablePath } : {}),
    });
    try {
      const page = await browser.newPage({
          viewport: { width: 1440, height: 1000 },
        }),
        errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.setContent(
        '<!doctype html><html><head></head><body><nav class="nav"><a data-view="history">History</a></nav><section id="productsView"><div class="view-toolbar"></div></section><section id="filesView"></section></body></html>',
      );
      await page
        .addStyleTag({ path: path.resolve("public/css/styles.css") })
        .catch(() => {});
      await page.addStyleTag({
        path: path.resolve("public/css/communications.css"),
      });
      await page.evaluate(() => {
        window.fixtureCalls = [];
        window.API = {
          scope: () => "team",
          setScope: () => {},
          getUser: () => ({ role: "admin" }),
          headers: () => ({}),
          get: async (p) => {
            fixtureCalls.push(["GET", p]);
            if (p === "/communications/status")
              return {
                can_manage: true,
                apollo_connected: false,
                providers: [
                  { provider: "microsoft_mail", configured: false },
                  { provider: "google_drive", configured: false },
                  { provider: "dropbox", configured: false },
                ],
                connections: [
                  {
                    id: 1,
                    provider: "microsoft_mail",
                    account_name: "owner@example.test",
                  },
                ],
              };
            if (p.startsWith("/communications/mail?"))
              return {
                messages: [
                  {
                    id: 1,
                    subject: "RFQ — sensor calibration",
                    sender_name: "Jane Buyer",
                    sender_email: "jane@example.test",
                    received_at: "2026-10-17T09:00:00Z",
                    shared: true,
                    has_attachments: true,
                  },
                ],
              };
            if (p === "/communications/mail/1")
              return {
                message: {
                  id: 1,
                  subject: "RFQ — sensor calibration",
                  sender_name: "Jane",
                  sender_email: "jane@example.test",
                  received_at: "2026-10-17T09:00:00Z",
                  recipients: ["owner@example.test"],
                  body_text:
                    "<img src=x onerror=alert(1)> Need sensor calibration.",
                  has_attachments: true,
                },
                links: [{ entity: "deal", entity_id: 1 }],
                attachments: [],
              };
            if (p === "/communications/rfq")
              return {
                requests: [
                  {
                    id: 1,
                    message_id: 1,
                    subject: "RFQ — sensor calibration",
                    sender_email: "jane@example.test",
                    assignee_name: "Owner",
                    due_at: new Date(Date.now() - 3600000).toISOString(),
                    status: "new",
                    deal_id: 1,
                    task_id: 1,
                  },
                ],
              };
            if (p === "/communications/cloud/files") return { files: [] };
            if (p === "/communications/invoice-provider")
              return { connected: true, subdomain: "fixture-account" };
            throw Error("Unhandled GET " + p);
          },
          post: async (p, b) => {
            fixtureCalls.push(["POST", p, b]);
            if (p.endsWith("/attachments/sync"))
              return {
                attachments: [{ id: 1, name: "specification.pdf", size: 1000 }],
              };
            if (p.includes("/invoice-provider/") && p.endsWith("/preview"))
              return {
                invoice: {
                  buyer_name: "Buyer Co",
                  buyer_tax_no: "123",
                  currency: "PLN",
                  payment_to: "2026-10-30",
                  positions: [
                    { name: "Sensor", quantity: 2, price_net: 1000, tax: 23 },
                  ],
                  oid: "klyo-1-1",
                },
                order_total: 2000,
              };
            throw Error("Unhandled POST " + p);
          },
          patch: async (p, b) => {
            fixtureCalls.push(["PATCH", p, b]);
            return {};
          },
        };
        window.toast = (m, t) => {
          window.lastToast = m;
        };
      });
      await page.addScriptTag({
        path: path.resolve("public/js/module-i18n.js"),
      });
      await page.addScriptTag({
        path: path.resolve("public/js/document-tools.js"),
      });
      await page.addScriptTag({
        path: path.resolve("public/js/communications.js"),
      });
      await page.addScriptTag({
        path: path.resolve("public/js/cloud-files.js"),
      });
      await page.evaluate(async () => {
        KlyoCommunications.init();
        KlyoCloudFiles.init();
        await KlyoCommunications.onView("inbox");
      });
      assert.equal(await page.locator("[data-view=inbox]").count(), 1);
      await page.locator('[data-message="1"]').click();
      await page.locator('[aria-label="RFQ — sensor calibration"]').waitFor();
      assert.equal(await page.locator(".comm-message-body img").count(), 0);
      assert.match(
        await page.locator(".comm-message-body").textContent(),
        /onerror/,
      );
      await page.locator("#mailAttachments").click();
      await page.locator('[data-download-attachment="1"]').waitFor();
      await page.keyboard.press("Escape");
      await page.evaluate(() => KlyoCommunications.onView("rfq"));
      await page.locator(".comm-overdue").waitFor();
      assert.match(
        await page.locator(".comm-overdue").textContent(),
        /Overdue/,
      );
      await page.evaluate(() => KlyoCloudFiles.onView("files"));
      assert.equal(
        await page.locator("[data-cloud-connect]:disabled").count(),
        2,
      );
      await page.locator("#apolloOpen").click();
      await page.locator('[aria-label="Apollo.io contact import"]').waitFor();
      assert.equal(await page.locator("#apolloSearch").isDisabled(), true);
      await page.keyboard.press("Escape");
      await page.evaluate(() => KlyoCloudFiles.openInvoice(1));
      await page.locator("#invoicePreview").click();
      await page.locator("#invoicePreviewRows").getByText("Buyer Co").waitFor();
      await page.locator("#invoiceIssue").click();
      assert.match(await page.locator(".doc-error").textContent(), /authorize/);
      await page.keyboard.press("Escape");
      await page.setViewportSize({ width: 390, height: 844 });
      await page.evaluate(() => KlyoCommunications.onView("inbox"));
      await page.locator('[data-message="1"]').click();
      assert.equal(
        await page
          .locator(".doc-dialog")
          .evaluate((e) => e.getBoundingClientRect().width <= innerWidth),
        true,
      );
      assert.deepEqual(errors, []);
      console.log(
        name +
          ": inbox, escaped email, attachments, RFQ SLA, cloud setup, Apollo, invoice preview confirmation and mobile dialog passed",
      );
    } finally {
      await browser.close();
    }
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
