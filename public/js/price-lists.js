const KlyoPriceLists = (() => {
  const { esc, dialog } = KlyoDocumentTools;
  let lists = [],
    selected = null,
    quoteProducts = null;
  const fields = [
    [
      "name",
      "Product name",
      ["name", "product", "productname", "nazwa", "produkt"],
    ],
    ["sku", "SKU / product code", ["sku", "code", "kod", "productcode"]],
    [
      "unit_price",
      "Unit price",
      ["price", "unitprice", "netprice", "cena", "cenanetto"],
    ],
    ["currency", "Currency", ["currency", "waluta"]],
    ["description", "Description", ["description", "opis"]],
    ["unit_label", "Unit", ["unit", "jednostka"]],
    ["category", "Category", ["category", "kategoria"]],
    [
      "warranty_months",
      "Warranty (months)",
      ["warrantymonths", "gwarancjamiesiace"],
    ],
    [
      "service_interval_months",
      "Review interval (months)",
      ["serviceintervalmonths", "przegladmiesiace"],
    ],
  ];
  const normalize = (s) =>
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]/g, "");
  async function refresh() {
    lists = (await API.get("/price-lists")).price_lists;
    return lists;
  }
  function init() {
    document
      .getElementById("addProductViewBtn")
      .insertAdjacentHTML(
        "beforebegin",
        KlyoCopy.html("<button class=\"btn btn-ghost btn-sm\" id=\"priceListsBtn\">Price lists / Import</button>"),
      );
    document.getElementById("priceListsBtn").onclick = () =>
      manager().catch((e) => toast(e.message, "error"));
    document
      .getElementById("quoteItemsContainer")
      .insertAdjacentHTML(
        "beforebegin",
        KlyoCopy.html("<div class=\"price-list-select\"><label for=\"quotePriceList\">Price list</label><select id=\"quotePriceList\"><option value=\"\">Product catalogue</option></select><small>Prices are copied into this quote. Existing sent quotes stay unchanged.</small></div>"),
      );
    document.getElementById("quotePriceList").onchange = changeList;
  }
  async function manager() {
    await refresh();
    const d = dialog(
      KlyoCopy.text("Price lists"),
      `<p>${KlyoCopy.label("Import CSV or Excel, map your columns, then approve the rows. A product SKU identifies existing products; otherwise a unique product name is used.")}</p><div class="doc-actions"><button id="newPriceImport" class="btn btn-primary">${KlyoCopy.label("Import price list")}</button><button id="priceCSVExample" class="btn btn-ghost">${KlyoCopy.label("Download CSV example")}</button></div><div id="priceListRows"></div>`,
    );
    d.find("#priceCSVExample").onclick = () => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(
        new Blob(
          [
            "name,sku,unit_price,currency,unit_label,warranty_months\nTemperature sensor,SEN-01,1200,USD,piece,60\n",
          ],
          { type: "text/csv" },
        ),
      );
      a.download = "Klyo-price-list-example.csv";
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    };
    d.find("#newPriceImport").onclick = () =>
      importer(null, () => {
        d.close();
        manager().catch((e) => toast(e.message, "error"));
      });
    d.find("#priceListRows").innerHTML = lists.length
      ? `<table class="doc-table"><thead><tr><th>${KlyoCopy.label("Name")}</th><th>${KlyoCopy.label("Currency")}</th><th>${KlyoCopy.label("Products")}</th><th></th></tr></thead><tbody>${lists.map((l) => `<tr><td>${esc(l.name)}</td><td>${esc(l.currency)}</td><td>${l.item_count}</td><td><button class="btn btn-ghost btn-sm" data-update="${l.id}">${KlyoCopy.label("Update / view")}</button></td></tr>`).join("")}</tbody></table>`
      : KlyoCopy.html("<p>No price lists yet. Start by importing your supplier or customer price list.</p>");
    d.root.querySelectorAll("[data-update]").forEach(
      (b) =>
        (b.onclick = async () => {
          try {
            const list = lists.find((l) => String(l.id) === b.dataset.update),
              data = await API.get("/price-lists/" + list.id),
              v = dialog(
                list.name,
                `<p>${esc(list.currency)} · ${data.products.length} ${KlyoCopy.label("products")}</p><div class="doc-scroll"><table class="doc-table">${data.products.map((p) => `<tr><td>${esc(p.sku)}</td><td>${esc(p.name)}</td><td>${esc(p.unit_price)}</td></tr>`).join("")}</table></div><div class="doc-actions"><button class="btn btn-primary" id="reimportPrices">${KlyoCopy.label("Import updated prices")}</button><button class="btn btn-ghost" id="deletePriceList">${KlyoCopy.label("Delete price list")}</button></div><p>${KlyoCopy.label("Deleting a price list preserves products and the prices already saved in quotes.")}</p>`,
              );
            v.find("#reimportPrices").onclick = () =>
              importer(list, () => {
                v.close();
                d.close();
                manager().catch((e) => toast(e.message, "error"));
              });
            v.find("#deletePriceList").onclick = async () => {
              if (
                !confirm(
                  KlyoCopy.text("Delete this price list? Products and existing quote prices will be kept."),
                )
              )
                return;
              try {
                await API.del("/price-lists/" + list.id);
                v.close();
                d.close();
                await manager();
              } catch (e) {
                v.error(e);
              }
            };
          } catch (e) {
            d.error(e);
          }
        }),
    );
  }
  function parse(buffer, sheet) {
    return new Promise((resolve, reject) => {
      const w = new Worker("/js/price-list-worker.js"),
        timeout = setTimeout(() => {
          w.terminate();
          reject(
            new Error(
              "This spreadsheet took too long to read. Try a smaller CSV file.",
            ),
          );
        }, 20000);
      w.onmessage = (e) => {
        clearTimeout(timeout);
        w.terminate();
        e.data.error ? reject(new Error(e.data.error)) : resolve(e.data);
      };
      w.onerror = () => {
        clearTimeout(timeout);
        w.terminate();
        reject(new Error("Unable to read this spreadsheet."));
      };
      w.postMessage({ buffer, sheet });
    });
  }
  async function importer(list, onDone) {
    const d = dialog(
      list ? KlyoCopy.text("Update") + " · " + list.name : KlyoCopy.text("Import a price list"),
      `<p>${KlyoCopy.label("CSV or XLSX · up to 10 MB and 1,000 products. The first row contains column names.")}</p><div class="doc-actions"><input id="pricesFile" type="file" accept=".csv,.xlsx"><button class="btn btn-ghost" id="pricesSharePoint">${KlyoCopy.label("Choose from SharePoint")}</button></div><div class="doc-fields"><label>${KlyoCopy.label("Price-list name")}<input id="pricesName" maxlength="100" value="${esc(list?.name || "")}"></label><label>${KlyoCopy.label("Currency")}<select id="pricesCurrency">${[
        ...document.getElementById("workspaceCurrencySelect").options,
      ]
        .map((o) => o.value)
        .map(
          (c) =>
            `<option ${c === (list?.currency || workspaceDefaultCurrency) ? "selected" : ""}>${c}</option>`,
        )
        .join(
          "",
        )}</select></label></div><div id="pricesMapping"></div><div id="pricesPreview"></div>`,
      true,
    );
    let source = "",
      buffer,
      parsed,
      defs = [],
      loadVersion = 0,
      mappingVersion = 0;
    if (list) d.find("#pricesCurrency").disabled = true;
    d.find("#pricesCurrency").onchange = () => {
      d.find("#pricesPreview").innerHTML = "";
    };
    async function load(file) {
      const version = ++loadVersion;
      mappingVersion++;
      d.error("");
      d.find("#pricesPreview").innerHTML = "";
      d.find("#pricesMapping").textContent = KlyoCopy.text("Reading spreadsheet…");
      try {
        if (!/\.(csv|xlsx)$/i.test(file.name) || file.size > 10 * 1024 * 1024)
          throw new Error("Choose a CSV or XLSX file up to 10 MB.");
        const fileBuffer = await file.arrayBuffer(),
          fields =
            (await API.get("/custom-fields?entity=product")).fields || [];
        if (version !== loadVersion || !d.root.isConnected) return;
        source = file.name;
        buffer = fileBuffer;
        defs = fields;
        await mapping();
      } catch (e) {
        d.error(e);
      }
    }
    async function mapping(sheet) {
      const version = ++mappingVersion,
        result = await parse(buffer, sheet);
      if (version !== mappingVersion || !d.root.isConnected) return;
      parsed = result;
      d.find("#pricesPreview").innerHTML = "";
      d.find("#pricesMapping").innerHTML =
        `<label>${KlyoCopy.label("Worksheet")}<select id="pricesSheet">${parsed.sheets.map((s) => `<option ${s === parsed.sheet ? "selected" : ""}>${esc(s)}</option>`).join("")}</select></label><p>${parsed.rows.length} ${KlyoCopy.label("rows in")} ${esc(source)}${KlyoCopy.label(". Match each product field to a column.")}</p><div class="doc-mapping">${[...fields, ...defs.map((f) => ["custom:" + f.field_key, f.name + (f.required ? " *" : ""), [normalize(f.name)]])].map(([key, label, syn]) => `<label>${esc(key.startsWith("custom:") ? label : KlyoCopy.text(label))}<select data-price-map="${esc(key)}"><option value="">${KlyoCopy.text("Skip")}</option>${parsed.headers.map((h, i) => `<option value="${i}" ${syn.includes(normalize(h)) ? "selected" : ""}>${esc(h)}</option>`).join("")}</select></label>`).join("")}</div><div class="doc-actions"><button class="btn btn-primary" id="previewPrices">${KlyoCopy.label("Preview import")}</button></div>`;
      d.find("#pricesSheet").onchange = () =>
        mapping(d.find("#pricesSheet").value).catch(d.error);
      d.root.querySelectorAll("[data-price-map]").forEach(
        (el) =>
          (el.onchange = () => {
            d.find("#pricesPreview").innerHTML = "";
          }),
      );
      d.find("#previewPrices").onclick = preview;
    }
    function body() {
      const map = Object.fromEntries(
        [...d.root.querySelectorAll("[data-price-map]")]
          .filter((s) => s.value !== "")
          .map((s) => [s.dataset.priceMap, Number(s.value)]),
      );
      if (map.name === undefined || map.unit_price === undefined)
        throw new Error("Map product name and unit price.");
      return {
        list_id: list?.id || null,
        name: d.find("#pricesName").value.trim(),
        currency: d.find("#pricesCurrency").value,
        source_name: source,
        rows: parsed.rows.map((row) => {
          const out = { custom_fields: {} };
          for (const [key, col] of Object.entries(map)) {
            let v = row[col];
            if (key.startsWith("custom:")) {
              const f = defs.find((f) => f.field_key === key.slice(7));
              if (f.type === "number" && v !== "")
                v = Number(String(v).replace(",", "."));
              if (f.type === "checkbox")
                v = /^(true|yes|tak|1)$/i.test(String(v));
              out.custom_fields[key.slice(7)] = v;
            } else out[key] = v;
          }
          return out;
        }),
      };
    }
    async function preview() {
      d.error("");
      try {
        const data = body(),
          result = await API.post("/price-lists/preview", data);
        d.find("#pricesPreview").innerHTML =
          `<p>${result.valid} ${KlyoCopy.label("valid of")} ${result.rows.length}${KlyoCopy.label(". Select the rows to import. Rows with errors are excluded.")}</p><div class="doc-actions"><button class="btn btn-ghost" id="allPriceRows">${KlyoCopy.label("Select valid rows")}</button><button class="btn btn-ghost" id="noPriceRows">${KlyoCopy.label("Deselect all")}</button></div><div class="doc-scroll"><table class="doc-table"><thead><tr><th>${KlyoCopy.label("Import")}</th><th>${KlyoCopy.label("Product / SKU")}</th><th>${KlyoCopy.label("Price")}</th><th>${KlyoCopy.label("Result")}</th></tr></thead><tbody>${result.rows.map((r) => `<tr><td><input type="checkbox" data-price-row="${r.index}" ${r.error ? "disabled" : "checked"} aria-label="Import row ${r.index + 1}"></td><td>${esc(r.name)}<br>${esc(r.sku)}</td><td>${esc(r.unit_price ?? "—")} ${esc(r.currency || "")}</td><td>${esc(r.error || (r.action === "create" ? "Create product" : "Update list price"))}</td></tr>`).join("")}</tbody></table></div><label><input id="pricesUpdateCatalog" type="checkbox"> ${KlyoCopy.label("Also update the base prices of existing products")}</label><p>${KlyoCopy.label("By default, existing product base prices remain unchanged. New products include the mapped details. Existing product details stay unchanged. Importing does not remove products missing from the file.")}</p><button class="btn btn-primary" id="confirmPricesImport">${KlyoCopy.label("Import selected rows")}</button>`;
        d.find("#allPriceRows").onclick = () =>
          d.root
            .querySelectorAll("[data-price-row]:not(:disabled)")
            .forEach((b) => (b.checked = true));
        d.find("#noPriceRows").onclick = () =>
          d.root
            .querySelectorAll("[data-price-row]")
            .forEach((b) => (b.checked = false));
        d.find("#confirmPricesImport").onclick = async () => {
          try {
            const chosen = [
              ...d.root.querySelectorAll("[data-price-row]:checked"),
            ].map((b) => data.rows[Number(b.dataset.priceRow)]);
            if (!chosen.length)
              throw new Error("Choose at least one valid row.");
            data.name = d.find("#pricesName").value.trim();
            if (!data.name) throw new Error("Enter a price-list name.");
            d.find("#confirmPricesImport").disabled = true;
            const r = await API.post("/price-lists/import", {
              ...data,
              rows: chosen,
              update_catalog: d.find("#pricesUpdateCatalog").checked,
            });
            await loadProducts();
            if (currentView === "products") await loadProductsView();
            toast(KlyoCopy.format("Prices imported: {0} · new products: {1}", r.imported, r.created));
            d.close();
            onDone?.();
          } catch (e) {
            d.error(e);
            d.find("#confirmPricesImport").disabled = false;
          }
        };
      } catch (e) {
        d.error(e);
      }
    }
    d.find("#pricesFile").onchange = (e) => {
      if (e.target.files[0]) load(e.target.files[0]);
    };
    d.find("#pricesSharePoint").onclick = () =>
      KlyoFiles.pick(async (item) => {
        try {
          const r = await KlyoDocumentTools.binary(
            "/sharepoint/content?item_id=" + encodeURIComponent(item.id),
          );
          await load(new File([await r.blob()], item.name));
        } catch (e) {
          d.error(e);
        }
      }).catch(d.error);
  }
  async function openQuote(quote) {
    selected = quote?.price_list_id || null;
    quoteProducts = null;
    try {
      await refresh();
      const el = document.getElementById("quotePriceList");
      el.innerHTML =
        KlyoCopy.html("<option value=\"\">Product catalogue</option>") +
        lists
          .map(
            (l) =>
              `<option value="${l.id}">${esc(l.name)} · ${esc(l.currency)}</option>`,
          )
          .join("");
      el.value = selected || "";
      if (selected)
        quoteProducts = (await API.get("/price-lists/" + selected)).products;
    } catch (e) {
      selected = quote?.price_list_id || null;
      const el = document.getElementById("quotePriceList");
      if (selected) {
        el.innerHTML =
          KlyoCopy.html("<option value=\"\">Product catalogue</option><option value=\"") +
          Number(selected) +
          '">' + esc(KlyoCopy.text('Saved price list (temporarily unavailable)')) + '</option>';
        el.value = selected;
      }
      toast(
        KlyoCopy.text("Price lists could not be loaded. Saved quote prices are preserved.") + " " +
          e.message,
        "error",
      );
    }
  }
  async function changeList() {
    const el = document.getElementById("quotePriceList"),
      id = el.value;
    try {
      const data = id ? await API.get("/price-lists/" + id) : null,
        currency = data?.price_list.currency || els.quoteCurrencySelect.value,
        hasRows = currentQuoteLineItems.some(
          (i) => Number(i.unit_price) > 0 || i.description,
        );
      if (
        hasRows &&
        !confirm(
          KlyoCopy.text("Apply these prices to matching products in this draft? Custom items are kept."),
        )
      ) {
        el.value = selected || "";
        return;
      }
      if (
        hasRows &&
        currency !== els.quoteCurrencySelect.value &&
        currentQuoteLineItems.some(
          (i) =>
            !data.products.some((p) => String(p.id) === String(i.product_id)),
        )
      )
        throw new Error(
          "Remove custom items before changing to a different currency.",
        );
      selected = id || null;
      quoteProducts = data?.products || null;
      els.quoteCurrencySelect.value = currency;
      for (const item of currentQuoteLineItems) {
        const p = productsForQuote(products).find(
          (p) => String(p.id) === String(item.product_id),
        );
        if (p) item.unit_price = Number(p.unit_price);
      }
      renderQuoteLineItems();
    } catch (e) {
      el.value = selected || "";
      toast(e.message, "error");
    }
  }
  const productsForQuote = (all) => quoteProducts || all;
  function resetQuote() {
    selected = null;
    quoteProducts = null;
    document.getElementById("quotePriceList").value = "";
  }
  return {
    init,
    manager,
    openQuote,
    resetQuote,
    productsForQuote,
    collect: () => ({ price_list_id: selected }),
  };
})();
