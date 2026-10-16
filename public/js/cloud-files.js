const KlyoCloudFiles = (() => {
  const { esc, dialog, binary, size } = KlyoDocumentTools;
  let filter = null;
  function init() {
    document
      .getElementById("filesView")
      .insertAdjacentHTML(
        "beforeend",
        '<section id="cloudProviderArea" class="cloud-file-list"></section>',
      );
    const bar =
      document.querySelector("#pipelineView .contact-toolbar") ||
      document.querySelector("#productsView .view-toolbar") ||
      document.querySelector("#productsView .toolbar");
    const target = bar || document.getElementById("productsView");
    target.insertAdjacentHTML(
      "afterbegin",
      `<button id="apolloOpen" class="btn btn-ghost">${KlyoModuleI18n.label("Apollo.io import")}</button>`,
    );
    document.getElementById("apolloOpen").onclick = () =>
      apollo().catch((e) => toast(e.message, "error"));
  }
  async function refresh() {
    const s = await KlyoCommunications.getStatus(),
      area = document.getElementById("cloudProviderArea");
    if (!area) return;
    area.innerHTML = `<div class="comm-toolbar"><h2>${KlyoModuleI18n.label("Connected cloud storage")}</h2><a href="/docs/communications-setup" target="_blank">${KlyoModuleI18n.label("Connection setup guide")}</a></div><div class="cloud-status-grid">${[
      "google_drive",
      "dropbox",
    ]
      .map((p) => {
        const c = s.connections.find((c) => c.provider === p),
          configured = s.providers.find((x) => x.provider === p)?.configured;
        return `<div><h3>${p === "google_drive" ? "Google Drive" : "Dropbox"}</h3><p>${c ? esc(c.root_name || KlyoModuleI18n.pick("Choose a folder")) : configured ? KlyoModuleI18n.pick("Ready to connect") : KlyoModuleI18n.pick("Administrator setup required")}</p>${s.can_manage ? `<button class="btn btn-ghost btn-sm" data-cloud-connect="${p}" ${configured ? "" : "disabled"}>${c ? KlyoModuleI18n.pick("Reconnect") : KlyoModuleI18n.pick("Connect")}</button>${c ? `<button class="btn btn-ghost btn-sm" data-cloud-setup="${c.id}">${KlyoModuleI18n.label("Choose CRM folder")}</button><button class="btn btn-ghost btn-sm" data-cloud-disconnect="${c.id}">${KlyoModuleI18n.label("Disconnect")}</button>` : ""}` : ""}${c?.root_id ? `<button class="btn btn-ghost btn-sm" data-cloud-browse="${c.id}">${KlyoModuleI18n.label("Link existing file")}</button><button class="btn btn-primary btn-sm" data-cloud-upload="${c.id}">${KlyoModuleI18n.label("Upload · up to 20 MB")}</button>` : ""}</div>`;
      })
      .join("")}</div><div id="cloudFileRows"></div>`;
    for (const b of area.querySelectorAll("[data-cloud-connect]"))
      b.onclick = run(() => KlyoCommunications.connect(b.dataset.cloudConnect));
    for (const b of area.querySelectorAll("[data-cloud-setup]"))
      b.onclick = run(() => setup(Number(b.dataset.cloudSetup)));
    for (const b of area.querySelectorAll("[data-cloud-disconnect]"))
      b.onclick = run(async () => {
        if (
          confirm(
            "Disconnect storage? Original cloud files remain; CRM links from this connection are removed.",
          )
        ) {
          await API.del(
            "/communications/connections/" + b.dataset.cloudDisconnect,
          );
          await refresh();
        }
      });
    for (const b of area.querySelectorAll("[data-cloud-browse]"))
      b.onclick = run(() => pick(Number(b.dataset.cloudBrowse)));
    for (const b of area.querySelectorAll("[data-cloud-upload]"))
      b.onclick = () => {
        const input = document.createElement("input");
        input.type = "file";
        input.multiple = true;
        input.onchange = () =>
          upload(Number(b.dataset.cloudUpload), [...input.files]).catch((e) =>
            toast(e.message, "error"),
          );
        input.click();
      };
    await listFiles();
  }
  const run = (fn) => async () => {
    try {
      await fn();
    } catch (e) {
      toast(e.message, "error");
    }
  };
  async function setup(id) {
    const d = dialog(
      KlyoModuleI18n.pick("Choose a CRM folder"),
      `<p>${KlyoModuleI18n.label("Only files inside this folder can be linked or downloaded through this workspace.")}</p><div class="comm-toolbar"><button class="btn btn-ghost" id="cloudBack">${KlyoModuleI18n.label("Back")}</button><span id="cloudPath">${KlyoModuleI18n.label("Storage root")}</span><button class="btn btn-primary" id="cloudSelect" disabled>${KlyoModuleI18n.label("Use this folder")}</button></div><div class="cloud-browse" id="cloudFolders"></div><button class="btn btn-ghost" id="cloudMore" hidden>${KlyoModuleI18n.label("Load more")}</button>`,
    );
    let stack = [],
      cursor = null;
    async function load(more = false) {
      const current = stack.at(-1),
        r = await API.get(
          "/communications/cloud/" +
            id +
            "/setup?folder_id=" +
            encodeURIComponent(current?.id || "root") +
            (more && cursor ? "&cursor=" + encodeURIComponent(cursor) : ""),
        );
      if (!more) d.find("#cloudFolders").innerHTML = "";
      d.find("#cloudFolders").insertAdjacentHTML(
        "beforeend",
        r.items
          .map(
            (f) =>
              `<button class="btn btn-ghost" data-cloud-folder="${esc(f.id)}">▸ ${esc(f.name)}</button>`,
          )
          .join("") ||
          `<p>${KlyoModuleI18n.label("No subfolders. Create a CRM folder in your storage provider if needed.")}</p>`,
      );
      cursor = r.cursor;
      d.find("#cloudMore").hidden = !cursor;
      d.find("#cloudPath").textContent =
        stack.map((x) => x.name).join(" / ") ||
        KlyoModuleI18n.pick("Storage root");
      d.find("#cloudBack").disabled = !stack.length;
      d.find("#cloudSelect").disabled = !stack.length;
      d.root.querySelectorAll("[data-cloud-folder]").forEach(
        (b) =>
          (b.onclick = async () => {
            stack.push({
              id: b.dataset.cloudFolder,
              name: b.textContent.slice(2),
            });
            await load().catch(d.error);
          }),
      );
    }
    d.find("#cloudBack").onclick = async () => {
      stack.pop();
      await load().catch(d.error);
    };
    d.find("#cloudMore").onclick = () => load(true).catch(d.error);
    d.find("#cloudSelect").onclick = async () => {
      try {
        await API.put("/communications/cloud/" + id + "/root", {
          folder_id: stack.at(-1).id,
        });
        d.close();
        await refresh();
      } catch (e) {
        d.error(e);
      }
    };
    await load();
  }
  async function pick(id) {
    const s = await KlyoCommunications.getStatus(),
      conn = s.connections.find((c) => c.id === id),
      d = dialog(
        KlyoModuleI18n.pick("Link a cloud file"),
        `<div class="comm-toolbar"><button class="btn btn-ghost" id="cloudBrowseBack">${KlyoModuleI18n.label("Back")}</button><span id="cloudBrowsePath"></span></div><div class="cloud-browse" id="cloudBrowseRows"></div><button class="btn btn-ghost" id="cloudBrowseMore" hidden>${KlyoModuleI18n.label("Load more")}</button>`,
      );
    let stack = [{ id: conn.root_id, name: conn.root_name }],
      cursor = null;
    async function load(more = false) {
      const r = await API.get(
        "/communications/cloud/" +
          id +
          "/children?folder_id=" +
          encodeURIComponent(stack.at(-1).id) +
          (more && cursor ? "&cursor=" + encodeURIComponent(cursor) : ""),
      );
      if (!more) d.find("#cloudBrowseRows").innerHTML = "";
      for (const f of r.items) {
        const b = document.createElement("button");
        b.className = "btn btn-ghost";
        b.textContent =
          (f.folder ? "▸ " : "📄 ") +
          f.name +
          (f.folder ? "" : " · " + size(f.size));
        b.onclick = async () => {
          try {
            if (f.folder) {
              stack.push(f);
              await load();
            } else
              KlyoCommunications.chooseRecord(async (record) => {
                await API.post("/communications/cloud/" + id + "/link", {
                  item_id: f.id,
                  ...record,
                });
                d.close();
                await listFiles();
                toast(KlyoModuleI18n.pick("File linked"));
              });
          } catch (e) {
            d.error(e);
          }
        };
        d.find("#cloudBrowseRows").append(b);
      }
      cursor = r.cursor;
      d.find("#cloudBrowseMore").hidden = !cursor;
      d.find("#cloudBrowseBack").disabled = stack.length === 1;
      d.find("#cloudBrowsePath").textContent = stack
        .map((x) => x.name)
        .join(" / ");
    }
    d.find("#cloudBrowseBack").onclick = async () => {
      stack.pop();
      await load().catch(d.error);
    };
    d.find("#cloudBrowseMore").onclick = () => load(true).catch(d.error);
    await load();
  }
  async function upload(id, files) {
    if (files.some((f) => f.size > 20 * 1024 * 1024))
      throw new Error(KlyoModuleI18n.pick("Choose files up to 20 MB each."));
    const d = dialog(
      KlyoModuleI18n.pick("Upload cloud files"),
      `<p>${KlyoModuleI18n.label("Files are uploaded to the selected CRM root folder.")}</p><p id="cloudUploadProgress"></p><button class="btn btn-primary" id="cloudUploadGeneral">${KlyoModuleI18n.label("Upload to workspace")}</button><button class="btn btn-ghost" id="cloudUploadRecord">${KlyoModuleI18n.label("Choose linked CRM record")}</button>`,
    );
    let busy = false;
    async function perform(record = {}) {
      if (busy) return;
      busy = true;
      try {
        d.find("#cloudUploadGeneral").disabled = true;
        d.find("#cloudUploadRecord").disabled = true;
        for (let i = 0; i < files.length; i++) {
          const f = files[i];
          d.find("#cloudUploadProgress").textContent =
            `${i + 1}/${files.length}: ${f.name}`;
          const query = new URLSearchParams({ name: f.name, ...record });
          await binary("/communications/cloud/" + id + "/upload?" + query, {
            method: "POST",
            headers: { "Content-Type": "application/octet-stream" },
            body: f,
          });
        }
        d.close();
        await listFiles();
        toast(KlyoModuleI18n.pick("Files uploaded"));
      } catch (e) {
        d.error(e);
        busy = false;
        d.find("#cloudUploadGeneral").disabled = false;
        d.find("#cloudUploadRecord").disabled = false;
      }
    }
    d.find("#cloudUploadGeneral").onclick = () => perform();
    d.find("#cloudUploadRecord").onclick = () =>
      KlyoCommunications.chooseRecord(perform);
  }
  async function listFiles() {
    const r = await API.get(
        "/communications/cloud/files" +
          (filter
            ? "?entity=" +
              encodeURIComponent(filter.entity) +
              "&entity_id=" +
              filter.entity_id
            : ""),
      ),
      target = document.getElementById("cloudFileRows");
    if (!target) return;
    target.innerHTML = `<h3>${KlyoModuleI18n.label("Google Drive & Dropbox documents")}</h3>${r.files.length ? `<div class="doc-scroll table-card"><table class="doc-table"><thead><tr><th>${KlyoModuleI18n.label("Document")}</th><th>${KlyoModuleI18n.label("Provider")}</th><th>${KlyoModuleI18n.label("Record")}</th><th>${KlyoModuleI18n.label("Size")}</th><th></th></tr></thead><tbody>${r.files.map((f) => `<tr><td>${esc(f.name)}</td><td>${f.provider === "google_drive" ? "Google Drive" : "Dropbox"}</td><td>${esc(f.entity || KlyoModuleI18n.pick("Workspace"))}${f.entity_id ? " #" + f.entity_id : ""}</td><td>${size(f.size)}</td><td><button class="btn btn-ghost btn-sm" data-cloud-download="${f.id}" ${Number(f.size) > 20 * 1024 * 1024 ? "disabled" : ""}>${KlyoModuleI18n.label("Download")}</button><button class="btn btn-ghost btn-sm" data-cloud-unlink="${f.id}">${KlyoModuleI18n.label("Unlink")}</button></td></tr>`).join("")}</tbody></table></div>` : `<p class="comm-notice">${KlyoModuleI18n.label("Link or upload a file from a connected cloud provider.")}</p>`}`;
    target
      .querySelectorAll("[data-cloud-download]")
      .forEach(
        (b) =>
          (b.onclick = run(() =>
            KlyoCommunications.download(
              "/communications/cloud/files/" +
                b.dataset.cloudDownload +
                "/download",
              r.files.find((x) => String(x.id) === b.dataset.cloudDownload)
                .name,
            ),
          )),
      );
    target.querySelectorAll("[data-cloud-unlink]").forEach(
      (b) =>
        (b.onclick = run(async () => {
          if (
            confirm(
              KlyoModuleI18n.pick(
                "Remove the CRM link? Original cloud file stays in storage.",
              ),
            )
          ) {
            await API.del(
              "/communications/cloud/files/" + b.dataset.cloudUnlink,
            );
            await listFiles();
          }
        })),
    );
  }
  async function apollo() {
    const s = await KlyoCommunications.getStatus(),
      d = dialog(
        KlyoModuleI18n.pick("Apollo.io contact import"),
        `<p>${KlyoModuleI18n.label("Search Apollo, select people and import verified contact details. Enrichment may consume your Apollo credits; nothing is imported without confirmation.")}</p>${s.can_manage ? `<label>${KlyoModuleI18n.label("Apollo API key")}<input id="apolloKey" type="password" autocomplete="off" placeholder="Enter key to connect or replace"></label><button id="apolloConnect" class="btn btn-ghost">${KlyoModuleI18n.label("Save API key")}</button><button id="apolloDisconnect" class="btn btn-ghost">${KlyoModuleI18n.label("Disconnect Apollo")}</button>` : ""}<p id="apolloState">${s.apollo_connected ? KlyoModuleI18n.pick("Apollo is connected.") : KlyoModuleI18n.pick("No Apollo API key connected.")}</p><div class="apollo-search"><label>${KlyoModuleI18n.label("Job title")}<input id="apolloTitle" placeholder="${KlyoModuleI18n.pick("Sales director")}"></label><label>${KlyoModuleI18n.label("Company domain")}<input id="apolloDomain" placeholder="${KlyoModuleI18n.pick("example.com")}"></label><label>${KlyoModuleI18n.label("Keywords")}<input id="apolloKeywords"></label></div><button id="apolloSearch" class="btn btn-primary" ${s.apollo_connected ? "" : "disabled"}>${KlyoModuleI18n.label("Search people")}</button><div id="apolloResults"></div>`,
        true,
      );
    d.find("#apolloConnect")?.addEventListener("click", async () => {
      try {
        await API.put("/communications/apollo", {
          api_key: d.find("#apolloKey").value,
        });
        d.find("#apolloKey").value = "";
        d.find("#apolloState").textContent = KlyoModuleI18n.pick(
          "Apollo is connected.",
        );
        d.find("#apolloSearch").disabled = false;
      } catch (e) {
        d.error(e);
      }
    });
    d.find("#apolloDisconnect")?.addEventListener("click", async () => {
      try {
        await API.del("/communications/apollo");
        d.find("#apolloState").textContent = KlyoModuleI18n.pick(
          "Apollo disconnected.",
        );
        d.find("#apolloSearch").disabled = true;
      } catch (e) {
        d.error(e);
      }
    });
    d.find("#apolloSearch").onclick = async () => {
      try {
        const r = await API.post("/communications/apollo/search", {
          title: d.find("#apolloTitle").value,
          domain: d.find("#apolloDomain").value,
          keywords: d.find("#apolloKeywords").value,
        });
        d.find("#apolloResults").innerHTML =
          `<p>${r.total} matches · showing up to 25. Select up to 10.</p><div class="cloud-browse">${r.people.map((p) => `<label><input type="checkbox" name="apolloPerson" value="${esc(p.id)}"> ${esc([p.first_name, p.last_name].filter(Boolean).join(" "))} · ${esc(p.title || "")} · ${esc(p.company || "")}${p.has_email ? "" : " · No email indicated"}</label>`).join("")}</div><label><input type="checkbox" id="apolloCredits"> ${KlyoModuleI18n.label("I authorize enrichment for selected people using my Apollo credits.")}</label><button class="btn btn-primary" id="apolloImport">${KlyoModuleI18n.label("Import selected contacts")}</button>`;
        d.find("#apolloImport").onclick = async () => {
          try {
            const ids = [
              ...d.root.querySelectorAll("[name=apolloPerson]:checked"),
            ].map((x) => x.value);
            const result = await API.post("/communications/apollo/import", {
              ids,
              confirm_credits: d.find("#apolloCredits").checked,
            });
            d.find("#apolloResults").textContent =
              `Imported: ${result.imported}. Already present or unavailable: ${result.skipped}.`;
            toast(KlyoModuleI18n.pick("Apollo import completed"));
          } catch (e) {
            d.error(e);
          }
        };
      } catch (e) {
        d.error(e);
      }
    };
  }

  async function openInvoice(orderId) {
    const s = await API.get("/communications/status"),
      can = s.can_manage;
    let config = { connected: false };
    if (can) config = await API.get("/communications/invoice-provider");
    const today = new Date().toISOString().slice(0, 10),
      d = dialog(
        KlyoModuleI18n.pick("Fakturownia · order invoice"),
        `<p>${KlyoModuleI18n.label("Review the invoice before issuing it. Issuing creates a document in Fakturownia. No invoice email is sent.")}</p>${can ? `<details ${config.connected ? "" : "open"}><summary>${KlyoModuleI18n.label("Provider connection")}</summary><label>${KlyoModuleI18n.label("Account subdomain")}<input id="invoiceDomain" value="${esc(config.subdomain || "")}" placeholder="${KlyoModuleI18n.pick("your-account")}"></label><label>${KlyoModuleI18n.label("API token")}<input type="password" autocomplete="off" id="invoiceToken"></label><button class="btn btn-ghost" id="invoiceConfigure">${KlyoModuleI18n.label("Save provider connection")}</button></details>` : ""}<div class="apollo-search"><label>${KlyoModuleI18n.label("Buyer name")}<input id="invoiceBuyer"></label><label>${KlyoModuleI18n.label("Buyer tax ID")}<input id="invoiceBuyerTax"></label><label>${KlyoModuleI18n.label("Tax rate (%)")}<input type="number" min="0" max="100" id="invoiceTax" value="0"></label><label>${KlyoModuleI18n.label("Issue date")}<input type="date" id="invoiceIssueDate" value="${today}"></label><label>${KlyoModuleI18n.label("Payment due")}<input type="date" id="invoicePaymentDate" value="${today}"></label></div><button class="btn btn-ghost" id="invoicePreview">${KlyoModuleI18n.label("Preview invoice")}</button><div id="invoicePreviewRows"></div>${can ? `<label><input type="checkbox" id="invoiceConfirm"> ${KlyoModuleI18n.label("I reviewed the buyer, dates, currency, tax and item prices and authorize invoice issuance.")}</label><button class="btn btn-primary" id="invoiceIssue" disabled>${KlyoModuleI18n.label("Issue invoice")}</button><button class="btn btn-ghost" id="invoiceSync">${KlyoModuleI18n.label("Refresh invoice and payment status")}</button><details><summary>${KlyoModuleI18n.label("Reconcile an interrupted issuance")}</summary><p>${KlyoModuleI18n.label("Check Fakturownia for the external order ID shown in the error. Enter that invoice ID to reconnect it without creating a duplicate.")}</p><input id="invoiceReconcileId" placeholder="Fakturownia invoice ID"><button class="btn btn-ghost" id="invoiceReconcile">${KlyoModuleI18n.label("Link matching invoice")}</button></details>` : ""}<div id="invoiceStatus"></div>`,
        true,
      );
    let previewBody = null,
      previewToken = null;
    const body = () => ({
      buyer_name: d.find("#invoiceBuyer").value,
      buyer_tax_no: d.find("#invoiceBuyerTax").value,
      tax_rate: Number(d.find("#invoiceTax").value),
      issue_date: d.find("#invoiceIssueDate").value,
      payment_to: d.find("#invoicePaymentDate").value,
    });
    d.find("#invoiceConfigure")?.addEventListener("click", async () => {
      try {
        await API.put("/communications/invoice-provider", {
          subdomain: d.find("#invoiceDomain").value,
          api_token: d.find("#invoiceToken").value,
        });
        d.find("#invoiceToken").value = "";
        d.find("#invoiceStatus").textContent = KlyoModuleI18n.pick(
          "Fakturownia connected.",
        );
      } catch (e) {
        d.error(e);
      }
    });
    const show = (r) => {
      d.find("#invoiceStatus").innerHTML =
        `<p>${esc(r.number || r.status || KlyoModuleI18n.pick("Invoice created"))} · ${esc(r.status || "issued")}${r.paid !== undefined ? " · Paid " + esc(r.paid) + " " + esc(r.currency || "") : ""}</p>${r.url ? `<a href="${esc(r.url)}" rel="noopener noreferrer" target="_blank">${KlyoModuleI18n.label("Open in Fakturownia")}</a>` : ""}${r.needs_reconciliation ? `<p>${KlyoModuleI18n.pick("Reconcile external order ID:")} ` + esc(r.external_ref) + "</p>" : ""}`;
    };
    d.find("#invoicePreview").onclick = async () => {
      try {
        const b = body(),
          r = await API.post(
            "/communications/invoice-provider/orders/" + orderId + "/preview",
            b,
          );
        previewBody = b;
        previewToken = r.preview_token;
        const p = r.invoice;
        d.find("#invoicePreviewRows").innerHTML =
          `<p><strong>${esc(p.buyer_name)}</strong> · ${esc(p.buyer_tax_no)} · ${esc(p.currency)} · Payment due ${esc(p.payment_to)}</p><table class="doc-table"><thead><tr><th>${KlyoModuleI18n.label("Item")}</th><th>${KlyoModuleI18n.label("Qty")}</th><th>${KlyoModuleI18n.label("Net unit price")}</th><th>${KlyoModuleI18n.label("Net line total")}</th><th>${KlyoModuleI18n.label("Tax %")}</th></tr></thead><tbody>${p.positions.map((x) => `<tr><td>${esc(x.name)}</td><td>${esc(x.quantity)}</td><td>${esc(x.total_price_net != null ? (Number(x.total_price_net) / Number(x.quantity)).toFixed(6) : x.price_net)}</td><td>${esc(x.total_price_net || "")}</td><td>${esc(x.tax)}</td></tr>`).join("")}</tbody></table><p>${KlyoModuleI18n.pick("External ID:")} ${esc(p.oid)}. Order amount: ${esc(r.order_total)} ${esc(p.currency)}. Invoice tax is added to the order net item prices.</p>`;
        if (d.find("#invoiceIssue")) d.find("#invoiceIssue").disabled = false;
      } catch (e) {
        d.error(e);
      }
    };
    d.find("#invoiceIssue")?.addEventListener("click", async () => {
      try {
        if (
          !previewBody ||
          JSON.stringify(previewBody) !== JSON.stringify(body())
        )
          throw new Error(
            KlyoModuleI18n.pick(
              "Preview again after changing invoice details.",
            ),
          );
        if (!d.find("#invoiceConfirm").checked)
          throw new Error(
            KlyoModuleI18n.pick("Review and authorize issuance first."),
          );
        d.find("#invoiceIssue").disabled = true;
        show(
          await API.post(
            "/communications/invoice-provider/orders/" + orderId + "/issue",
            {
              ...previewBody,
              preview_token: previewToken,
              confirm_issue: true,
            },
          ),
        );
      } catch (e) {
        d.error(e);
      }
    });
    d.find("#invoiceSync")?.addEventListener("click", async () => {
      try {
        show(
          await API.post(
            "/communications/invoice-provider/orders/" + orderId + "/sync",
            {},
          ),
        );
      } catch (e) {
        d.error(e);
      }
    });
    d.find("#invoiceReconcile")?.addEventListener("click", async () => {
      try {
        show(
          await API.post(
            "/communications/invoice-provider/orders/" + orderId + "/reconcile",
            { provider_id: d.find("#invoiceReconcileId").value },
          ),
        );
      } catch (e) {
        d.error(e);
      }
    });
  }
  return {
    openInvoice,
    init,
    onView(view) {
      return view === "files" ? refresh() : Promise.resolve();
    },
    refresh,
    apollo,
    setFilter(value) {
      filter = value;
      return listFiles();
    },
  };
})();
