/* Commercial register, customer structure and private margin tools. */
const KlyoCommercial = (() => {
  const g = (id) => document.getElementById(id),
    esc = (v) =>
      String(v ?? "").replace(
        /[&<>"']/g,
        (c) =>
          ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;",
          })[c],
      ),
    pl = () => KlyoI18n.getLang() === "pl",
    t = (en, pol) => (pl() ? pol : en);
  let rows = [],
    statuses = [],
    access = {},
    quote = null,
    snapshotSignature = null,
    pendingCase = null,
    timer = null,
    request = 0,
    modalVersion = 0;
  const money = (v, c) =>
      KlyoQuoteCore.money(v, c || "USD", pl() ? "pl" : "en"),
    pct = (v) => (v == null ? "—" : Number(v).toFixed(1) + "%");
  async function readSpreadsheet(buffer) {
    return new Promise((resolve, reject) => {
      const worker = new Worker("/js/price-list-worker.js");
      const timeout = setTimeout(() => {
        worker.terminate();
        reject(new Error("The spreadsheet took too long to read."));
      }, 10000);
      const finish = (data, error) => {
        clearTimeout(timeout);
        worker.terminate();
        if (error) reject(new Error(error));
        else resolve(data);
      };
      worker.onmessage = (e) => finish(e.data, e.data.error);
      worker.onerror = () => finish(null, "Could not read the spreadsheet.");
      worker.postMessage({ buffer }, [buffer]);
    });
  }
  const canEdit = () => API.getUser()?.role !== "viewer";
  function error(e) {
    if (typeof toast === "function") toast(e.message, "error");
  }
  function dialog(title, body, wide = false) {
    g("commercialDialog")?.remove();
    const el = document.createElement("div");
    el.id = "commercialDialog";
    el.className = "commercial-overlay";
    el.innerHTML = `<section class="commercial-dialog ${wide ? "commercial-wide" : ""}" role="dialog" aria-modal="true" aria-label="${esc(title)}"><header><h2>${esc(title)}</h2><button class="btn btn-ghost" data-close aria-label="Close">×</button></header><div class="commercial-dialog-body">${body}</div><p class="commercial-error" id="commercialError" role="alert"></p></section>`;
    document.body.append(el);
    el.querySelector("[data-close]").onclick = () => el.remove();
    el.addEventListener("click", (e) => {
      if (e.target === el) el.remove();
    });
    el.querySelector("input,select,button")?.focus();
    return el;
  }
  function f(key, label, value = "", type = "text") {
    return `<label>${esc(label)}<input name="${esc(key)}" type="${type}" value="${esc(value)}" ${type === "number" ? 'min="0" step="0.01"' : ""}></label>`;
  }
  const options = (items, selected, label = "name") =>
    items
      .map(
        (i) =>
          `<option value="${i.id}" ${Number(selected) === i.id ? "selected" : ""}>${esc(i[label])}</option>`,
      )
      .join("");
  async function onView() {
    try {
      g("commercialRows").innerHTML = "<tr><td>Loading…</td></tr>";
      const result = await API.get(
        "/commercial/cases?search=" +
          encodeURIComponent(g("commercialSearch").value),
      );
      rows = result.cases;
      access = await API.get("/commercial/access");
      g("commercialOwnerTools").hidden = !access.owner;
      g("commercialAdd").hidden = !canEdit();
      g("commercialStages").hidden = !canEdit();
      g("commercialRows").innerHTML = rows.length
        ? rows
            .map(
              (r) =>
                `<tr data-case-id="${r.id}" style="--case-color:${/^#[a-f\d]{6}$/i.test(r.status_color) ? r.status_color : r.deal_status === "won" ? "#16a34a" : r.deal_status === "lost" ? "#dc2626" : "#64748b"}"><td><input class="commercial-case-select" type="checkbox" aria-label="Select case" data-select-case="${r.id}"> <button class="commercial-link" data-edit-case="${r.id}">${esc(r.number)}</button></td><td><strong>${esc(r.title)}</strong><small>${esc(r.main_products)}</small></td><td>${esc(r.contact_name || "—")}<small>${esc(r.company_name || "")}${r.unit_name ? " · " + esc(r.unit_name) : ""}</small></td><td>${money(r.value, r.currency)}</td><td>${esc(String(r.valid_until || "").slice(0, 10) || "—")}</td><td><span class="commercial-status">${esc(r.register_status || r.deal_status || "Open")}</span><small>${esc(r.stage_name || "")}</small></td><td><div class="commercial-actions">${r.deal_id ? `<button class="btn btn-ghost btn-sm" data-case-deal="${r.deal_id}">${t("Deal", "Szansa")}</button>` : ""}${r.quote_id ? `<button class="btn btn-ghost btn-sm" data-case-quote="${r.quote_id}">${t("Offer", "Oferta")}</button>` : canEdit() ? `<button class="btn btn-sm" data-new-case-quote="${r.id}">${t("Create offer", "Utwórz ofertę")}</button>` : ""}</div></td></tr>`,
            )
            .join("")
        : `<tr><td colspan="7">${t("No commercial cases. Add a case or create an offer.", "Brak spraw. Dodaj sprawę lub utwórz ofertę.")}</td></tr>`;
    } catch (e) {
      g("commercialRows").innerHTML =
        `<tr><td colspan="7">${esc(e.message)}</td></tr>`;
    }
  }
  async function editCase(id) {
    try {
      const row = rows.find((r) => r.id === Number(id)) || {},
        [ss, cc, co, pp] = await Promise.all([
          API.get("/commercial/statuses"),
          API.get("/contacts?limit=10000"),
          API.get("/companies"),
          API.get("/pipelines"),
        ]);
      statuses = ss.statuses;
      const contacts = cc.contacts || [],
        companies = co.companies || [],
        pipelines = pp.pipelines || [];
      const el = dialog(
          t(
            id ? "Edit commercial case" : "New commercial case",
            id ? "Edytuj sprawę" : "Nowa sprawa",
          ),
          `<form id="commercialCaseForm"><p class="muted">${t("The case number is also the offer number. A linked sales opportunity is created automatically.", "Numer sprawy jest numerem oferty. Powiązana szansa sprzedaży powstaje automatycznie.")}</p><div class="commercial-grid">${f("number", t("Case number", "Numer sprawy"), row.number || t("Assigned on save", "Nadany po zapisie"))}${f("title", t("Subject", "Temat"), row.title)}<label>${t("Contact", "Osoba")}<select name="contact_id"><option value="">—</option>${options(contacts, row.contact_id, "full_name")}</select></label><label>${t("Company", "Firma")}<select name="company_id"><option value="">—</option>${options(companies, row.company_id)}</select></label><label>${t("Branch / department", "Oddział / dział")}<select name="company_unit_id"><option value="">—</option></select></label><label>${t("Register status", "Status rejestru")}<select name="status_id">${options(statuses, row.status_id)}</select></label>${f("value", t("Net value", "Wartość netto"), row.value || 0, "number")}${f("currency", t("Currency", "Waluta"), row.currency || (typeof workspaceDefaultCurrency !== "undefined" ? workspaceDefaultCurrency : "USD"))}${f("valid_until", t("Valid until", "Ważna do"), String(row.valid_until || "").slice(0, 10), "date")}${!id ? `<label>${t("Sales pipeline", "Lejek sprzedaży")}<select name="pipeline_id">${options(pipelines, null)}</select></label>` : ""}</div><label>${t("Main products / scope", "Główne produkty / zakres")}<textarea name="main_products">${esc(row.main_products || "")}</textarea></label><div class="commercial-grid">${f("payment_terms", t("Payment terms", "Warunki płatności"), row.payment_terms)}${f("delivery_terms", t("Delivery & logistics", "Logistyka i dostawa"), row.delivery_terms)}</div><label>${t("Notes", "Uwagi")}<textarea name="notes">${esc(row.notes || "")}</textarea></label><button class="btn" type="submit">${t("Save case", "Zapisz sprawę")}</button></form>`,
          true,
        ),
        form = g("commercialCaseForm");
      form.elements.number.disabled = true;
      if (!canEdit()) {
        form
          .querySelectorAll("input,select,textarea,button")
          .forEach((x) => (x.disabled = true));
        form.querySelector("[type=submit]").hidden = true;
      }
      if (row.quote_id) {
        form.elements.value.disabled = true;
        form.elements.currency.disabled = true;
        form.elements.value.title = t(
          "Edit prices in the linked offer or final customer order.",
          "Ceny edytuj w powiązanej ofercie lub zamówieniu klienta.",
        );
      }
      const units = async () => {
        const cid = form.elements.company_id.value;
        form.elements.company_unit_id.innerHTML = '<option value="">—</option>';
        if (cid) {
          const d = await API.get(`/commercial/companies/${cid}/details`);
          form.elements.company_unit_id.innerHTML += options(
            d.units,
            row.company_unit_id,
          );
        }
      };
      form.elements.company_id.onchange = () => units().catch(error);
      form.elements.contact_id.onchange = () => {
        const contact = contacts.find(
          (c) => c.id === Number(form.elements.contact_id.value),
        );
        if (contact?.company_id) {
          form.elements.company_id.value = contact.company_id;
          units().catch(error);
        }
      };
      await units();
      form.onsubmit = async (e) => {
        e.preventDefault();
        const button = form.querySelector("[type=submit]");
        button.disabled = true;
        try {
          const b = Object.fromEntries(new FormData(form));
          await API[id ? "put" : "post"](
            "/commercial/cases" + (id ? "/" + id : ""),
            b,
          );
          el.remove();
          await onView();
          if (typeof loadDeals === "function") loadDeals().catch(() => {});
        } catch (e) {
          g("commercialError").textContent = e.message;
        } finally {
          button.disabled = false;
        }
      };
    } catch (e) {
      error(e);
    }
  }
  async function createOffer(id) {
    if (!canEdit()) return;
    const row = rows.find((r) => r.id === Number(id));
    if (!row?.contact_id) {
      error(
        new Error(
          t(
            "Add a contact to the case before creating its offer.",
            "Dodaj osobę do sprawy przed utworzeniem oferty.",
          ),
        ),
      );
      return;
    }
    pendingCase = row;
    await openQuoteModal({ contactId: row.contact_id });
    g("quoteTitleInput").value = row.title;
    g("quoteCurrencySelect").value = row.currency;
    for (const [key, value] of Object.entries({
      reference: row.number,
      payment: row.payment_terms,
      delivery: row.delivery_terms,
      valid_until: String(row.valid_until || "").slice(0, 10),
    })) {
      const el = document.querySelector(`[data-doc="${key}"]`);
      if (el) el.value = value;
    }
  }
  async function configureStatuses() {
    if (!canEdit()) return;
    const ss = await API.get("/commercial/statuses");
    const el = dialog(
      t("Register stages", "Etapy rejestru"),
      `<p>${t("Choose colors and the matching sales outcome. Paid stages are shown in blue by default.", "Ustal kolory i odpowiadający wynik sprzedaży. Opłacone sprawy domyślnie mają kolor niebieski.")}</p><div id="commercialStatusRows">${ss.statuses.map((s) => `<form data-status="${s.id}" class="commercial-status-form">${f("name", "", s.name)}${f("color", "", s.color, "color")}<select name="outcome"><option value="open" ${s.outcome === "open" ? "selected" : ""}>Open</option><option value="won" ${s.outcome === "won" ? "selected" : ""}>Won</option><option value="lost" ${s.outcome === "lost" ? "selected" : ""}>Lost</option></select><label><input type="checkbox" name="paid" ${s.paid ? "checked" : ""}>${t("Paid", "Opłacona")}</label><button class="btn btn-sm">${t("Save", "Zapisz")}</button></form>`).join("")}</div><form id="commercialNewStatus" class="commercial-status-form">${f("name", t("New status", "Nowy status"))}${f("color", "", "#8b5cf6", "color")}<select name="outcome"><option>open</option><option>won</option><option>lost</option></select><button class="btn btn-sm">${t("Add", "Dodaj")}</button></form>`,
      true,
    );
    el.querySelectorAll("form").forEach(
      (form) =>
        (form.onsubmit = async (e) => {
          e.preventDefault();
          try {
            const b = Object.fromEntries(new FormData(form));
            b.paid = Boolean(form.elements.paid?.checked);
            await API[form.dataset.status ? "put" : "post"](
              "/commercial/statuses" +
                (form.dataset.status ? "/" + form.dataset.status : ""),
              b,
            );
            await onView();
            el.remove();
            await configureStatuses();
          } catch (e) {
            g("commercialError").textContent = e.message;
          }
        }),
    );
  }
  async function purchasePrices() {
    try {
      const [{ prices }, { products }] = await Promise.all([
        API.get("/commercial/purchase-prices"),
        API.get("/products"),
      ]);
      const el = dialog(
        t("Purchase price lists", "Cenniki zakupowe"),
        `<p>${t("Private purchase costs are never included in client documents. Import CSV/Excel columns: sku, unit_cost, supplier. Prices are matched to existing SKUs.", "Prywatne koszty zakupu nie trafiają do dokumentów klienta. Wgraj CSV/Excel z kolumnami: sku, unit_cost, supplier. Ceny są dopasowywane do istniejących SKU.")}</p><form id="purchaseImport"><div class="commercial-grid">${f("currency", t("Currency", "Waluta"), "PLN")}<label>${t("CSV / Excel file", "Plik CSV / Excel")}<input type="file" name="file" accept=".csv,.xlsx,.xls" required></label></div><button class="btn" type="submit">${t("Preview purchase prices", "Podgląd cen zakupowych")}</button></form><div id="purchasePreview"></div><hr><form id="purchaseManual"><div class="commercial-grid"><label>${t("Product", "Produkt")}<select name="product_id">${options(products, null)}</select></label>${f("unit_cost", t("Unit purchase cost", "Koszt zakupu jednostki"), 0, "number")}${f("currency", t("Currency", "Waluta"), "PLN")}${f("supplier", t("Supplier", "Dostawca"))}</div><button class="btn btn-sm">${t("Save purchase price", "Zapisz cenę zakupu")}</button></form><table><thead><tr><th>SKU</th><th>${t("Product", "Produkt")}</th><th>${t("Purchase cost", "Koszt zakupu")}</th><th>${t("Supplier", "Dostawca")}</th></tr></thead><tbody>${prices.map((p) => `<tr><td>${esc(p.sku)}</td><td>${esc(p.name)}</td><td>${money(p.unit_cost, p.currency)}</td><td>${esc(p.supplier)}</td></tr>`).join("")}</tbody></table>`,
        true,
      );
      g("purchaseManual").onsubmit = async (e) => {
        e.preventDefault();
        const b = Object.fromEntries(new FormData(e.currentTarget));
        try {
          await API.post("/commercial/purchase-prices/import", {
            currency: b.currency,
            rows: [b],
          });
          el.remove();
          await purchasePrices();
        } catch (e) {
          g("commercialError").textContent = e.message;
        }
      };
      g("purchaseImport").onsubmit = async (e) => {
        e.preventDefault();
        try {
          const file = e.currentTarget.elements.file.files[0];
          if (file.size > 10 * 1024 * 1024)
            throw new Error("Use a file below 10 MB.");
          const parsed = await readSpreadsheet(await file.arrayBuffer()),
            rows = parsed.rows.map((row) =>
              Object.fromEntries(
                parsed.headers.map((h, i) => [
                  String(h).toLowerCase().trim(),
                  row[i] ?? "",
                ]),
              ),
            );
          if (!rows.length || rows.length > 1000)
            throw new Error("Import 1–1000 rows.");
          const currency = g("purchaseImport").elements.currency.value,
            valid = rows.map((r) => {
              const p = products.find(
                (p) =>
                  String(p.sku).toLowerCase() ===
                  String(r.sku || "")
                    .trim()
                    .toLowerCase(),
              );
              return {
                ...r,
                product_id: p?.id,
                error: !p
                  ? "Unknown SKU"
                  : !Number.isFinite(
                        Number(String(r.unit_cost).replace(",", ".")),
                      )
                    ? "Invalid cost"
                    : "",
              };
            });
          g("purchasePreview").innerHTML =
            `<p>${rows.length} ${t("rows. Review before confirming.", "wierszy. Sprawdź przed zatwierdzeniem.")}</p><div class="commercial-scroll"><table><thead><tr><th>SKU</th><th>Cost</th><th>Supplier</th><th>Status</th></tr></thead><tbody>${valid.map((r) => `<tr><td>${esc(r.sku)}</td><td>${esc(r.unit_cost)}</td><td>${esc(r.supplier)}</td><td>${esc(r.error || "OK")}</td></tr>`).join("")}</tbody></table></div><button class="btn" id="confirmPurchaseImport" ${valid.some((r) => r.error) ? "disabled" : ""}>${t("Confirm import", "Potwierdź import")}</button>`;
          g("confirmPurchaseImport").onclick = async () => {
            try {
              await API.post("/commercial/purchase-prices/import", {
                currency,
                rows,
              });
              el.remove();
              await purchasePrices();
            } catch (e) {
              g("commercialError").textContent = e.message;
            }
          };
        } catch (e) {
          g("commercialError").textContent = e.message;
        }
      };
    } catch (e) {
      error(e);
    }
  }
  async function permissions() {
    try {
      const { permissions } = await API.get("/commercial/permissions"),
        el = dialog(
          t("Margin access", "Dostęp do marż"),
          `<p>${t("Only the workspace owner sees purchase costs. Grant margin access per teammate. The factor scales the profit shown to that employee; owner reports remain unchanged.", "Tylko właściciel widzi koszty zakupu. Nadaj dostęp do marż osobno każdej osobie. Współczynnik skaluje pokazywany pracownikowi zysk; raporty właściciela pozostają bez zmian.")}</p>${permissions.map((p) => `<form data-permission="${p.id}" class="commercial-permission-form"><strong>${esc(p.name)}<small>${esc(p.email)}</small></strong><label><input name="can_view_margin" type="checkbox" ${p.can_view_margin ? "checked" : ""}>${t("Can view margins", "Widzi marże")}</label>${f("margin_factor", t("Factor (0.5 = half)", "Współczynnik (0.5 = połowa)"), p.margin_factor, "number")}<button class="btn btn-sm">${t("Save", "Zapisz")}</button></form>`).join("")}`,
          true,
        );
      el.querySelectorAll("form").forEach(
        (form) =>
          (form.onsubmit = async (e) => {
            e.preventDefault();
            try {
              await API.put(
                "/commercial/permissions/" + form.dataset.permission,
                {
                  can_view_margin: form.elements.can_view_margin.checked,
                  margin_factor: Number(form.elements.margin_factor.value),
                },
              );
              g("commercialError").textContent = t("Saved.", "Zapisano.");
            } catch (e) {
              g("commercialError").textContent = e.message;
            }
          }),
      );
    } catch (e) {
      error(e);
    }
  }
  async function companyPanel(id) {
    try {
      const { company, units, fields } = await API.get(
        `/commercial/companies/${id}/details`,
      );
      const control = (d) =>
        d.type === "select"
          ? `<select data-custom="${esc(d.field_key)}"><option value="">—</option>${d.options.map((o) => `<option ${company.custom_fields[d.field_key] === o ? "selected" : ""}>${esc(o)}</option>`).join("")}</select>`
          : d.type === "textarea"
            ? `<textarea data-custom="${esc(d.field_key)}">${esc(company.custom_fields[d.field_key] || "")}</textarea>`
            : `<input data-custom="${esc(d.field_key)}" type="${d.type === "checkbox" ? "checkbox" : d.type === "number" ? "number" : d.type === "date" ? "date" : "text"}" ${d.type === "checkbox" ? (company.custom_fields[d.field_key] ? "checked" : "") : `value="${esc(company.custom_fields[d.field_key] ?? "")}"`}>`;
      const el = dialog(
        company.name,
        `<form id="companyCommercialForm"><div class="commercial-grid">${Object.entries(
          {
            tax_id: "Tax ID / NIP",
            registration_number: t(
              "Registration number",
              "Numer rejestracyjny",
            ),
            website: "Website",
            address: t("Address", "Adres"),
            postal_code: t("Postcode", "Kod pocztowy"),
            city: t("City", "Miasto"),
            country: t("Country", "Kraj"),
            phone: t("Phone", "Telefon"),
            email: "Email",
          },
        )
          .map(([k, l]) => f(k, l, company[k]))
          .join(
            "",
          )}${fields.map((d) => `<label>${esc(d.name)}${d.required ? " *" : ""}${control(d)}</label>`).join("")}</div><button class="btn btn-sm">${t("Save details", "Zapisz dane")}</button><button type="button" class="btn btn-ghost btn-sm" id="companyAddCustom">${t("Add custom field", "Dodaj własne pole")}</button></form><hr><h3>${t("Branches & departments", "Oddziały i działy")}</h3><div>${units.map((u) => `<div class="commercial-unit"><strong>${esc(u.name)}</strong><span>${esc(u.kind)}${u.parent_id ? " · " + esc(units.find((p) => p.id === u.parent_id)?.name || "") : ""}</span><button class="btn btn-ghost btn-sm" data-edit-unit="${u.id}">${t("Edit", "Edytuj")}</button><button class="btn btn-ghost btn-sm" data-delete-unit="${u.id}">${t("Remove", "Usuń")}</button></div>`).join("")}</div><button class="btn btn-sm" id="companyAddUnit">${t("Add branch / department", "Dodaj oddział / dział")}</button>`,
        true,
      );
      if (!canEdit()) {
        el.querySelectorAll("input,select,textarea").forEach(
          (x) => (x.disabled = true),
        );
        el.querySelectorAll(
          "#companyCommercialForm button,#companyAddUnit,[data-edit-unit],[data-delete-unit]",
        ).forEach((x) => (x.hidden = true));
      }
      g("companyCommercialForm").onsubmit = async (e) => {
        e.preventDefault();
        try {
          const b = Object.fromEntries(new FormData(e.currentTarget));
          b.custom_fields = {};
          e.currentTarget
            .querySelectorAll("[data-custom]")
            .forEach(
              (i) =>
                (b.custom_fields[i.dataset.custom] =
                  i.type === "checkbox"
                    ? i.checked
                    : i.type === "number" && i.value
                      ? Number(i.value)
                      : i.value),
            );
          await API.put(`/commercial/companies/${id}/details`, b);
          el.remove();
          await companyPanel(id);
        } catch (e) {
          g("commercialError").textContent = e.message;
        }
      };
      g("companyAddCustom").onclick = () => fieldForm(id);
      g("companyAddUnit").onclick = () => unitForm(id, units);
      el.querySelectorAll("[data-edit-unit]").forEach(
        (btn) =>
          (btn.onclick = () =>
            unitForm(
              id,
              units,
              units.find((u) => u.id === Number(btn.dataset.editUnit)),
            )),
      );
      el.querySelectorAll("[data-delete-unit]").forEach(
        (btn) =>
          (btn.onclick = async () => {
            if (
              !confirm(
                t(
                  "Remove this unit? Linked records will keep their company.",
                  "Usunąć jednostkę? Powiązane rekordy zachowają firmę.",
                ),
              )
            )
              return;
            try {
              await API.del("/commercial/units/" + btn.dataset.deleteUnit);
              el.remove();
              await companyPanel(id);
            } catch (e) {
              g("commercialError").textContent = e.message;
            }
          }),
      );
    } catch (e) {
      error(e);
    }
  }
  function fieldForm(companyId) {
    const el = dialog(
      t("New company field", "Nowe pole firmy"),
      `<form id="commercialFieldForm">${f("name", t("Field name", "Nazwa pola"))}<label>${t("Type", "Typ")}<select name="type"><option value="text">Text</option><option value="textarea">Long text</option><option value="number">Number</option><option value="date">Date</option><option value="select">Select</option><option value="checkbox">Checkbox</option></select></label><label>${t("Select options, one per line", "Opcje wyboru, jedna w wierszu")}<textarea name="options"></textarea></label><label><input type="checkbox" name="required">${t("Required", "Wymagane")}</label><button class="btn">${t("Add field", "Dodaj pole")}</button></form>`,
    );
    g("commercialFieldForm").onsubmit = async (e) => {
      e.preventDefault();
      const b = Object.fromEntries(new FormData(e.currentTarget));
      b.entity = "company";
      b.options = b.options
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
      b.required = e.currentTarget.elements.required.checked;
      try {
        await API.post("/custom-fields", b);
        el.remove();
        await companyPanel(companyId);
      } catch (e) {
        g("commercialError").textContent = e.message;
      }
    };
  }
  function unitForm(cid, units, unit = {}) {
    const el = dialog(
      t("Branch / department", "Oddział / dział"),
      `<form id="commercialUnitForm">${f("name", t("Name", "Nazwa"), unit.name)}<label>${t("Type", "Typ")}<select name="kind"><option value="branch" ${unit.kind === "branch" ? "selected" : ""}>${t("Branch", "Oddział")}</option><option value="department" ${unit.kind !== "branch" ? "selected" : ""}>${t("Department", "Dział")}</option></select></label><label>${t("Parent unit", "Jednostka nadrzędna")}<select name="parent_id"><option value="">—</option>${options(
        units.filter((u) => u.id !== unit.id),
        unit.parent_id,
      )}</select></label>${f("address", t("Address", "Adres"), unit.address)}<label>${t("Notes", "Uwagi")}<textarea name="notes">${esc(unit.notes || "")}</textarea></label><button class="btn">${t("Save", "Zapisz")}</button></form>`,
    );
    g("commercialUnitForm").onsubmit = async (e) => {
      e.preventDefault();
      try {
        await API[unit.id ? "put" : "post"](
          "/commercial/units" + (unit.id ? "/" + unit.id : ""),
          {
            ...Object.fromEntries(new FormData(e.currentTarget)),
            company_id: cid,
          },
        );
        el.remove();
        await companyPanel(cid);
      } catch (e) {
        g("commercialError").textContent = e.message;
      }
    };
  }
  async function openQuote(value) {
    quote = value;
    snapshotSignature = value
      ? signature({
          currency: value.currency,
          tax_rate: value.tax_rate,
          discount_type: value.discount_type,
          discount_value: value.discount_value,
        })
      : null;
    const active = pendingCase;
    pendingCase = null;
    if (!g("commercialQuoteControls")) {
      const box = document.createElement("div");
      box.id = "commercialQuoteControls";
      g("quoteDocumentControls").after(box);
    }
    let deals = [];
    try {
      const result = await API.get("/deals");
      deals = result.deals || [];
      access = await API.get("/commercial/access");
    } catch {
      access = {};
    }
    g("commercialQuoteControls").innerHTML =
      `<details class="commercial-quote-options"><summary>${t("Commercial settings & bundles", "Ustawienia handlowe i zestawy")}</summary><div class="commercial-grid"><label>${t("Linked sales opportunity", "Powiązana szansa sprzedaży")}<select id="commercialQuoteDeal"><option value="">${t("Create automatically", "Utwórz automatycznie")}</option>${options(deals, value?.deal_id || active?.deal_id, "title")}</select></label><label>${t("Client pricing", "Ceny dla klienta")}<select id="commercialPricingMode"><option value="itemized">${t("Itemized prices", "Ceny poszczególnych pozycji")}</option><option value="total_only">${t("Only the offer total", "Tylko cena całej oferty")}</option></select></label></div><input id="commercialCaseId" type="hidden" value="${esc(value?.commercial_case_id || active?.id || "")}"><p>${t("Select component rows below, then give the bundle a name. Descriptions and SKUs remain visible; only its combined price is shown to the client.", "Zaznacz pozycje poniżej i nazwij zestaw. Opisy i SKU pozostaną widoczne; klient zobaczy wspólną cenę zestawu.")}</p><div class="commercial-bundle-bar"><input id="commercialBundleName" placeholder="${t("e.g. Desktop computer", "np. Komputer stacjonarny")}"><button type="button" class="btn btn-sm" id="commercialBundleBtn">${t("Convert selected to bundle", "Zamień zaznaczone w zestaw")}</button><button type="button" class="btn btn-ghost btn-sm" id="commercialUnbundleBtn">${t("Ungroup selected", "Rozdziel zaznaczone")}</button></div></details>${access.can_view_margin ? `<details class="commercial-margins"><summary>${t("Internal margin analysis", "Wewnętrzna analiza marży")}</summary><p class="muted">${t("Internal only · never included in the customer PDF. Purchase costs are captured when the offer is saved.", "Tylko wewnętrznie · nigdy w PDF klienta. Koszty zakupu są zapisywane w momencie zapisania oferty.")}</p><p class="muted" id="commercialMarginSource"></p><div id="commercialMarginData"></div></details>` : ""}`;
    g("commercialPricingMode").value =
      value?.document?.pricing_mode || "itemized";
    await quoteUnit(value || active || {});
    g("commercialBundleBtn").onclick = () => bundle(false);
    g("commercialUnbundleBtn").onclick = () => bundle(true);
    g("commercialQuoteControls")
      .querySelector(".commercial-margins")
      ?.addEventListener("toggle", scheduleMargin);
    decorateRows();
    scheduleMargin();
  }
  async function openRecordUnit(kind, record = {}) {
    const companySelect = g(
      kind === "contact" ? "cCompanySelect" : "dealCompanySelect",
    );
    if (!companySelect) return;
    let wrap = g("commercialUnitWrap-" + kind);
    if (!wrap) {
      wrap = document.createElement("div");
      wrap.className = "field";
      wrap.id = "commercialUnitWrap-" + kind;
      companySelect.closest(".field")?.after(wrap);
    }
    wrap.innerHTML = `<label>${t("Branch / department", "Oddział / dział")}<select id="commercialUnit-${kind}"><option value="">—</option></select></label>`;
    let generation = 0;
    const load = async (selected) => {
      const version = ++generation,
        cid = companySelect.value,
        select = g("commercialUnit-" + kind);
      select.innerHTML = '<option value="">—</option>';
      if (!/^\d+$/.test(cid)) return;
      try {
        const d = await API.get(`/commercial/companies/${cid}/details`);
        if (version !== generation || !select.isConnected) return;
        select.innerHTML += options(d.units, selected);
      } catch (e) {
        error(e);
      }
    };
    if (companySelect._commercialUnitListener)
      companySelect.removeEventListener(
        "change",
        companySelect._commercialUnitListener,
      );
    companySelect._commercialUnitListener = () => load(null);
    companySelect.addEventListener(
      "change",
      companySelect._commercialUnitListener,
    );
    await load(record.company_unit_id);
  }
  function collectUnit(kind) {
    return Number(g("commercialUnit-" + kind)?.value) || null;
  }
  function collectQuote() {
    return {
      company_unit_id: collectUnit("quote"),
      commercial_case_id: Number(g("commercialCaseId")?.value) || null,
      deal_id: Number(g("commercialQuoteDeal")?.value) || null,
    };
  }
  function decorateRows() {
    if (!g("quoteItemsContainer")) return;
    g("quoteItemsContainer")
      .querySelectorAll(".quote-line-row")
      .forEach((row, i) => {
        if (row.querySelector(".commercial-bundle-check")) return;
        const label = document.createElement("label");
        label.className = "commercial-bundle-check";
        label.innerHTML = `<input type="checkbox" data-bundle-index="${i}" aria-label="${t("Select item for bundle", "Zaznacz pozycję do zestawu")}"/><small>${esc(currentQuoteLineItems[i]?.bundle_name || "")}</small>`;
        row.prepend(label);
      });
  }
  function bundle(remove) {
    try {
      const selected = [
        ...g("quoteItemsContainer").querySelectorAll(
          "[data-bundle-index]:checked",
        ),
      ].map((c) => Number(c.dataset.bundleIndex));
      if (!selected.length)
        throw new Error(
          t("Select at least one item.", "Zaznacz co najmniej jedną pozycję."),
        );
      const name = g("commercialBundleName").value.trim();
      if (!remove && !name)
        throw new Error(t("Name your bundle.", "Nazwij zestaw."));
      const id = remove ? "" : crypto.randomUUID();
      selected.forEach((i) => {
        currentQuoteLineItems[i].bundle_id = id;
        currentQuoteLineItems[i].bundle_name = remove ? "" : name;
      });
      renderQuoteLineItems();
      scheduleMargin();
    } catch (e) {
      error(e);
    }
  }
  async function quoteUnit(record = {}) {
    const area = g("commercialQuoteControls")?.querySelector(
      ".commercial-grid",
    );
    if (!area) return;
    g("commercialQuoteUnitWrap")?.remove();
    const wrap = document.createElement("label");
    wrap.id = "commercialQuoteUnitWrap";
    wrap.innerHTML = `${t("Branch / department", "Oddział / dział")}<select id="commercialUnit-quote"><option value="">—</option></select>`;
    area.append(wrap);
    const contact =
      typeof allContactsCache !== "undefined"
        ? allContactsCache.find(
            (c) => String(c.id) === g("quoteContactSelect")?.value,
          )
        : null;
    const cid = record.company_id || contact?.company_id;
    if (!cid) return;
    try {
      const d = await API.get(`/commercial/companies/${cid}/details`);
      if (wrap.isConnected)
        g("commercialUnit-quote").innerHTML += options(
          d.units,
          record.company_unit_id || contact?.company_unit_id,
        );
    } catch (e) {
      error(e);
    }
  }
  function scheduleMargin() {
    clearTimeout(timer);
    timer = setTimeout(margins, 350);
  }
  function signature(v = {}) {
    return JSON.stringify({
      items: currentQuoteLineItems.map((i) => [
        Number(i.product_id) || null,
        Number(i.quantity),
        Number(i.unit_price),
        Number(i.discount_percent) || 0,
      ]),
      currency: v.currency ?? g("quoteCurrencySelect")?.value,
      tax: Number(v.tax_rate ?? g("quoteTaxRate")?.value ?? 0),
      discount_type: v.discount_type ?? g("quoteDiscountType")?.value ?? "none",
      discount_value: Number(
        v.discount_value ?? g("quoteDiscountAmount")?.value ?? 0,
      ),
    });
  }
  async function margins() {
    const out = g("commercialMarginData");
    if (!out || !out.closest("details").open) return;
    const version = ++request;
    try {
      const saved = quote?.id && snapshotSignature === signature();
      if (g("commercialMarginSource"))
        g("commercialMarginSource").textContent = saved
          ? t(
              "Saved offer · original purchase-cost snapshot",
              "Zapisana oferta · oryginalny zapis kosztów zakupu",
            )
          : t(
              "Live draft preview · current purchase prices",
              "Podgląd zmian · aktualne ceny zakupu",
            );
      const d = saved
        ? await API.get("/commercial/quotes/" + quote.id + "/margins")
        : await API.post("/commercial/margins/preview", {
            line_items: currentQuoteLineItems,
            tax_rate: Number(g("quoteTaxRate")?.value || 0),
            discount_type: g("quoteDiscountType")?.value || "none",
            discount_value: Number(g("quoteDiscountAmount")?.value || 0),
            currency: g("quoteCurrencySelect").value,
          });
      if (version !== request) return;
      out.innerHTML = `<div class="commercial-margin-summary"><strong>${t("Profit", "Zysk")}: ${d.profit == null ? "—" : money(d.profit, d.currency)}</strong><span>${t("Margin", "Marża")}: ${pct(d.margin_percent)}</span><span>${t("Markup", "Narzut")}: ${pct(d.markup_percent)}</span></div>${d.missing_costs ? `<p>${t("Missing purchase cost for", "Brak kosztu zakupu dla")} ${d.missing_costs} ${t("items. Total margin cannot be calculated.", "pozycji. Nie można obliczyć marży całkowitej.")}</p>` : ""}<div class="commercial-scroll"><table><thead><tr><th>${t("Item", "Pozycja")}</th><th>${t("Net revenue after discounts", "Przychód netto po rabatach")}</th><th>${t("Profit", "Zysk")}</th><th>${t("Margin", "Marża")}</th><th>${t("Markup", "Narzut")}</th></tr></thead><tbody>${d.rows.map((r) => `<tr><td>${esc(r.description)}</td><td>${money(r.revenue, d.currency)}</td><td>${r.cost_missing ? "—" : money(r.profit, d.currency)}</td><td>${pct(r.margin_percent)}</td><td>${pct(r.markup_percent)}</td></tr>`).join("")}</tbody></table></div>`;
    } catch (e) {
      if (version === request) out.textContent = e.message;
    }
  }
  function init() {
    if (g("commercialView")) return;
    const view = document.createElement("section");
    view.id = "commercialView";
    view.className = "hidden";
    view.innerHTML = `<div class="commercial-toolbar"><div><h2>${t("Commercial register", "Rejestr handlowy")}</h2><p class="muted">${t("Cases, offers and sales opportunities in one register.", "Sprawy, oferty i szanse sprzedaży w jednym rejestrze.")}</p></div><button class="btn" id="commercialAdd">+ ${t("New case", "Nowa sprawa")}</button></div><div class="commercial-toolbar"><input id="commercialSearch" type="search" placeholder="${t("Search case, person or company", "Szukaj sprawy, osoby lub firmy")}"><button class="btn btn-ghost btn-sm" id="commercialStages">${t("Register stages", "Etapy rejestru")}</button><button class="btn btn-ghost btn-sm" id="commercialExport">${t("Export selected / all", "Eksportuj wybrane / wszystkie")}</button><span id="commercialOwnerTools" hidden><button class="btn btn-ghost btn-sm" id="commercialPurchase">${t("Purchase prices", "Ceny zakupu")}</button><button class="btn btn-ghost btn-sm" id="commercialPermissions">${t("Margin access", "Dostęp do marż")}</button></span></div><div class="commercial-scroll"><table class="commercial-table"><thead><tr><th>${t("Case / offer no.", "Nr sprawy / oferty")}</th><th>${t("Subject / products", "Temat / produkty")}</th><th>${t("Person / company", "Osoba / firma")}</th><th>${t("Net value", "Wartość netto")}</th><th>${t("Valid until", "Ważna do")}</th><th>${t("Status / pipeline stage", "Status / etap lejka")}</th><th></th></tr></thead><tbody id="commercialRows"></tbody></table></div>`;
    (
      g("companiesView")?.parentElement || g("salesOverviewView")?.parentElement
    ).append(view);
    g("commercialAdd").onclick = () => editCase();
    g("commercialSearch").oninput = () => {
      clearTimeout(timer);
      timer = setTimeout(onView, 250);
    };
    g("commercialStages").onclick = () => configureStatuses().catch(error);
    g("commercialPurchase").onclick = purchasePrices;
    g("commercialPermissions").onclick = permissions;
    g("commercialExport").onclick = () => {
      const selected = [
          ...view.querySelectorAll("[data-select-case]:checked"),
        ].map((r) => Number(r.dataset.selectCase)),
        list = selected.length
          ? rows.filter((r) => selected.includes(r.id))
          : rows,
        keys = [
          "number",
          "title",
          "contact_name",
          "company_name",
          "main_products",
          "value",
          "currency",
          "valid_until",
          "payment_terms",
          "delivery_terms",
          "register_status",
          "stage_name",
        ],
        csv =
          "\ufeff" +
          [keys, ...list.map((r) => keys.map((k) => String(r[k] ?? "")))]
            .map((r) =>
              r
                .map(
                  (v) =>
                    '"' +
                    String(v)
                      .replace(/^[=+@-]/, "'$&")
                      .replace(/"/g, '""') +
                    '"',
                )
                .join(","),
            )
            .join("\r\n"),
        url = URL.createObjectURL(
          new Blob([csv], { type: "text/csv;charset=utf-8" }),
        ),
        a = document.createElement("a");
      a.href = url;
      a.download = "commercial-register.csv";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
    view.addEventListener("click", async (e) => {
      const btn = e.target.closest("button");
      if (btn?.dataset.editCase) editCase(btn.dataset.editCase);
      if (btn?.dataset.caseQuote) openQuotePanel(Number(btn.dataset.caseQuote));
      if (btn?.dataset.caseDeal) openDealPanel(Number(btn.dataset.caseDeal));
      if (btn?.dataset.newCaseQuote) createOffer(btn.dataset.newCaseQuote);
      if (!btn && (e.ctrlKey || e.metaKey))
        e.target.closest("[data-case-id]")?.classList.toggle("selected");
    });
    const container = g("quoteItemsContainer");
    if (container)
      new MutationObserver(decorateRows).observe(container, {
        childList: true,
      });
    g("quoteModalOverlay")?.addEventListener("input", scheduleMargin);
    g("quoteModalOverlay")?.addEventListener("change", scheduleMargin);
    g("quoteContactSelect")?.addEventListener("change", () => quoteUnit());
    document.addEventListener(
      "keydown",
      (e) => {
        if (e.key === "Escape" && g("commercialDialog")) {
          e.stopImmediatePropagation();
          g("commercialDialog").remove();
        }
      },
      true,
    );
  }
  function attachCompanyButton(id) {
    const panel = g("companyPanelOverlay");
    if (!panel) return;
    let button = g("companyStructureBtn");
    if (!button) {
      button = document.createElement("button");
      button.id = "companyStructureBtn";
      button.className = "btn btn-ghost btn-sm";
      (
        panel.querySelector(".panel-header") ||
        panel.querySelector("h2")?.parentElement ||
        panel
      ).append(button);
    }
    button.textContent = t(
      "Company details & departments",
      "Dane firmy i działy",
    );
    button.onclick = () => companyPanel(id);
  }
  return {
    init,
    onView,
    openQuote,
    collectQuote,
    openRecordUnit,
    collectUnit,
    decorateRows,
    companyPanel,
    attachCompanyButton,
    setPricingMode(value) {
      if (g("commercialPricingMode"))
        g("commercialPricingMode").value = value || "itemized";
    },
    pricingMode: () =>
      g("commercialPricingMode")?.value ||
      quote?.document?.pricing_mode ||
      "itemized",
  };
})();
