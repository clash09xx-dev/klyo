/* A4 editor: no HTML, scripts, remote images or arbitrary CSS enter saved templates. */
const KlyoQuoteDesigner = (() => {
  const C = KlyoCanvasCore,
    g = (id) => document.getElementById(id),
    h = (v) =>
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
    l = (en, pl) => (KlyoI18n.getLang() === "pl" ? pl : en);
  let previewVersion = 0,
    previousFocus;
  let design,
    page = 0,
    selected = null,
    zoom = 0.75,
    undo = [],
    redo = [],
    drag = null,
    pdfViewer = null,
    pdfUrl = null;
  const names = () => ({
    text: l("Text", "Tekst"),
    field: l("Automatic field", "Pole automatyczne"),
    image: l("Image / logo", "Obraz / logo"),
    rectangle: l("Rectangle", "Prostokąt"),
    line: l("Line", "Linia"),
    items: l("Product table", "Tabela produktów"),
    totals: l("Totals", "Podsumowanie"),
  });
  const fieldNames = () => ({
    title: l("Proposal title", "Tytuł oferty"),
    reference: l("Quote number", "Numer oferty"),
    issued_on: l("Issue date", "Data wystawienia"),
    valid_until: l("Valid until", "Ważność"),
    total: l("Total price", "Cena końcowa"),
    subtotal: l("Subtotal", "Suma pozycji"),
    discount_total: l("Discount", "Rabat"),
    tax_total: l("Tax", "Podatek"),
    currency: l("Currency", "Waluta"),
    page_number: l("Page number", "Numer strony"),
    page_count: l("Page count", "Liczba stron"),
    "buyer.name": l("Client name", "Nazwa klienta"),
    "buyer.email": l("Client email", "Email klienta"),
    "seller.name": l("Your company", "Twoja firma"),
  });
  const current = () => design.pages[page],
    element = () => current().elements.find((e) => e.id === selected);
  function remember() {
    undo.push(JSON.stringify(design));
    if (undo.length > 60) undo.shift();
    redo = [];
  }
  function restore(from, to) {
    if (!from.length) return;
    to.push(JSON.stringify(design));
    design = JSON.parse(from.pop());
    page = Math.min(page, design.pages.length - 1);
    selected = null;
    render();
  }
  function context() {
    let totals;
    try {
      totals = KlyoQuoteCore.computeTotals(
        currentQuoteLineItems,
        Number(g("quoteTaxRate").value),
        KlyoQuoteTemplates.discount(),
      );
    } catch {}
    const sample = !totals?.computed?.some((i) => Number(i.unit_price) > 0);
    if (sample)
      totals = KlyoQuoteCore.computeTotals(
        [
          {
            description: l("Example product", "Przykładowy produkt"),
            quantity: 2,
            unit_price: 1200,
          },
        ],
        0,
      );
    const d = KlyoQuoteStudio.collect().document;
    return {
      q: {
        title: els.quoteTitleInput.value || l("Your proposal", "Twoja oferta"),
        currency: els.quoteCurrencySelect.value || workspaceDefaultCurrency,
        ...totals,
        discount_total: totals.discountTotal,
      },
      d: {
        ...d,
        buyer: {
          ...d.buyer,
          name: d.buyer.name || l("Client name", "Nazwa klienta"),
        },
        reference: d.reference || "Q-2026-001",
      },
      sample,
    };
  }
  function add(type, image) {
    remember();
    const e = {
      id: "e_" + crypto.randomUUID(),
      type,
      x: 15,
      y: 30,
      w: type === "items" ? 180 : type === "totals" ? 80 : 70,
      h:
        type === "items"
          ? 90
          : type === "totals"
            ? 32
            : type === "line"
              ? 1
              : 20,
      font_size: type === "items" ? 9 : 12,
      color: "#172238",
      fill: type === "rectangle" ? "#edf1f6" : "",
      text: type === "text" ? l("Your text", "Twój tekst") : "",
      field: "buyer.name",
      image: image || "",
      align: "left",
      bold: false,
      visibility: type === "totals" ? "last" : "all",
    };
    if (
      type === "items" &&
      design.pages.some((p) => p.elements.some((e) => e.type === "items"))
    ) {
      g("designerError").textContent = l(
        "The template already contains a product table. Select it to move or resize it.",
        "Szablon zawiera już tabelę produktów. Zaznacz ją, aby ją przesunąć lub zmienić rozmiar.",
      );
      undo.pop();
      return;
    }
    current().elements.push(e);
    selected = e.id;
    render();
  }
  function nodeContent(e, ctx) {
    const money = (v) => KlyoQuoteCore.money(v, ctx.q.currency, ctx.d.language);
    if (e.type === "items")
      return `<table><thead><tr><th>${l("Description", "Opis")}</th><th>${l("Qty", "Ilość")}</th><th>${l("Price", "Cena")}</th><th>${l("Amount", "Wartość")}</th></tr></thead><tbody>${ctx.q.computed
        .slice(0, 4)
        .map(
          (i) =>
            `<tr><td>${h(i.description)}</td><td>${i.quantity}</td><td>${h(money(i.unit_price))}</td><td>${h(money(i.line_total))}</td></tr>`,
        )
        .join(
          "",
        )}</tbody></table><small>${l("More items continue on another A4 page.", "Więcej pozycji przechodzi na kolejną stronę A4.")}</small>`;
    if (e.type === "totals")
      return `<div class="designer-totals"><span>${l("Subtotal", "Suma pozycji")}<b>${h(money(ctx.q.subtotal))}</b></span>${ctx.q.discount_total ? `<span>${l("Discount", "Rabat")}<b>−${h(money(ctx.q.discount_total))}</b></span>` : ""}${ctx.q.tax_total ? `<span>${l("Tax", "Podatek")}<b>${h(money(ctx.q.tax_total))}</b></span>` : ""}<span><strong>${l("Total", "Razem")}</strong><b>${h(money(ctx.q.total))}</b></span></div>`;
    if (e.type === "image")
      return e.image || ctx.d.logo_data_url
        ? `<img alt="" src="${e.image || ctx.d.logo_data_url}">`
        : `<span class="designer-placeholder">${l("Upload an image or use the proposal logo", "Wgraj obraz lub użyj logo oferty")}</span>`;
    return h(C.resolve(e, ctx.q, ctx.d, money, page + 1, design.pages.length));
  }
  function render() {
    g("designerError").textContent = "";
    const ctx = context();
    g("designerPagePicker").innerHTML = design.pages
      .map(
        (_, i) =>
          `<option value="${i}">${l("Page", "Strona")} ${i + 1}</option>`,
      )
      .join("");
    g("designerPagePicker").value = page;
    g("designerSampleHint").textContent = ctx.sample
      ? l(
          "Preview with example prices. Actual quote values fill in automatically.",
          "Podgląd z przykładowymi cenami. Wartości oferty uzupełnią się automatycznie.",
        )
      : l(
          "Preview with current quote data.",
          "Podgląd z danymi bieżącej oferty.",
        );
    const sheet = g("designerSheet");
    sheet.style.background = current().background;
    sheet.innerHTML = current()
      .elements.map(
        (e) =>
          `<div class="designer-element ${e.id === selected ? "selected" : ""} is-${e.type}" tabindex="0" data-element="${e.id}" style="left:${e.x}mm;top:${e.y}mm;width:${e.w}mm;height:${e.h}mm;font-size:${e.font_size}pt;color:${e.color};background:${e.fill || "transparent"};font-weight:${e.bold ? 700 : 400};text-align:${e.align}">${nodeContent(e, ctx)}${e.id === selected ? '<i class="designer-resize" data-resize="1"></i>' : ""}</div>`,
      )
      .join("");
    sheet.querySelectorAll("[data-element]").forEach((el) => {
      el.onpointerdown = (ev) => startDrag(ev, el);
      el.onclick = (ev) => ev.stopPropagation();
    });
    g("designerLayers").innerHTML = [...current().elements]
      .reverse()
      .map(
        (e) =>
          `<button type="button" class="${e.id === selected ? "active" : ""}" data-layer="${e.id}">${h(names()[e.type])}${e.type === "field" ? " · " + h(fieldNames()[e.field] || e.field) : ""}</button>`,
      )
      .join("");
    g("designerLayers")
      .querySelectorAll("[data-layer]")
      .forEach(
        (b) =>
          (b.onclick = () => {
            selected = b.dataset.layer;
            render();
          }),
      );
    g("designerUndo").disabled = !undo.length;
    g("designerRedo").disabled = !redo.length;
    inspector();
    setZoom(zoom);
  }
  function setZoom(value) {
    zoom = Math.max(0.25, Math.min(1.5, Number(value)));
    g("designerSheet").style.transform = `scale(${zoom})`;
    g("designerSheetWrap").style.width = ((210 * 96) / 25.4) * zoom + "px";
    g("designerSheetWrap").style.height = ((297 * 96) / 25.4) * zoom + "px";
    g("designerZoom").value = String(Math.round(zoom * 100));
  }
  function inspector() {
    const e = element();
    g("designerInspector").innerHTML = e
      ? `<h3>${h(names()[e.type])}</h3><div class="designer-dimensions">${["x", "y", "w", "h"].map((k) => `<label>${{ x: "X", y: "Y", w: l("Width", "Szerokość"), h: l("Height", "Wysokość") }[k]} · mm<input data-property="${k}" type="number" min="0" step="0.1" value="${e[k]}"></label>`).join("")}</div>${e.type === "text" ? `<label>${l("Text", "Tekst")}<textarea data-property="text" rows="5" maxlength="8000">${h(e.text)}</textarea></label><p class="muted">${l("Use {{buyer.name}}, {{issued_on}} or other automatic fields in your text.", "Użyj {{buyer.name}}, {{issued_on}} lub innych pól automatycznych w tekście.")}</p>` : ""}${e.type === "field" ? `<label>${l("Content", "Zawartość")}<select data-property="field">${C.FIELDS.map((k) => `<option value="${k}" ${k === e.field ? "selected" : ""}>${h(fieldNames()[k] || k)}</option>`).join("")}</select></label>` : ""}${!["image", "rectangle", "line"].includes(e.type) ? `<label>${l("Text size · pt", "Rozmiar tekstu · pkt")}<input data-property="font_size" type="number" min="6" max="72" step="0.5" value="${e.font_size}"></label><label>${l("Alignment", "Wyrównanie")}<select data-property="align"><option value="left">${l("Left", "Do lewej")}</option><option value="center">${l("Centre", "Wyśrodkuj")}</option><option value="right">${l("Right", "Do prawej")}</option></select></label><label><input data-property="bold" type="checkbox" ${e.bold ? "checked" : ""}> ${l("Bold", "Pogrubienie")}</label>` : ""}<label>${l("Colour", "Kolor")}<input data-property="color" type="color" value="${e.color}"></label>${e.type === "rectangle" ? `<label>${l("Fill", "Wypełnienie")}<input data-property="fill" type="color" value="${e.fill || "#edf1f6"}"></label>` : ""}<label>${l("When table continues", "Gdy tabela przechodzi na kolejną stronę")}<select data-property="visibility"><option value="all">${l("Every continuation page", "Każda strona kontynuacji")}</option><option value="first">${l("First page only", "Tylko pierwsza")}</option><option value="last">${l("Last page only", "Tylko ostatnia")}</option></select></label><div class="designer-align"><button type="button" data-align="left">⇤</button><button type="button" data-align="center">↔</button><button type="button" data-align="right">⇥</button></div><div class="designer-align"><button type="button" id="designerDuplicate">${l("Duplicate", "Duplikuj")}</button><button type="button" id="designerFront">${l("Bring forward", "Na wierzch")}</button><button type="button" id="designerRemove">${l("Delete", "Usuń")}</button></div>`
      : `<h3>${l("Design your A4 page", "Zaprojektuj swoją stronę A4")}</h3><p>${l("Add an element on the left. Drag it anywhere, resize it using the corner or enter exact measurements.", "Dodaj element z lewej. Przeciągnij go w dowolne miejsce, zmień rozmiar narożnikiem lub wpisz dokładne wymiary.")}</p><label>${l("Page background", "Tło strony")}<input type="color" id="designerBackground" value="${current().background}"></label>`;
    if (!e) {
      g("designerBackground").onchange = (ev) => {
        remember();
        current().background = ev.target.value;
        render();
      };
      return;
    }
    for (const el of g("designerInspector").querySelectorAll(
      "[data-property]",
    )) {
      const k = el.dataset.property;
      if (el.tagName === "SELECT") el.value = e[k];
      el.onchange = () => {
        remember();
        const previous = structuredClone(e);
        e[k] =
          el.type === "checkbox"
            ? el.checked
            : el.type === "number"
              ? Number(el.value)
              : el.value;
        try {
          design = C.normalize(design);
          render();
        } catch (err) {
          Object.assign(e, previous);
          undo.pop();
          g("designerError").textContent = err.message;
        }
      };
    }
    g("designerInspector")
      .querySelectorAll("[data-align]")
      .forEach(
        (b) =>
          (b.onclick = () => {
            remember();
            e.x =
              b.dataset.align === "left"
                ? 15
                : b.dataset.align === "right"
                  ? 195 - e.w
                  : (210 - e.w) / 2;
            e.x = Math.max(0, Math.min(210 - e.w, e.x));
            render();
          }),
      );
    g("designerRemove").onclick = remove;
    g("designerDuplicate").onclick = () => {
      remember();
      const copy = structuredClone(e);
      copy.id = "e_" + crypto.randomUUID();
      if (copy.type === "items") {
        undo.pop();
        g("designerError").textContent = l(
          "Use one product table per template.",
          "Użyj jednej tabeli produktów w szablonie.",
        );
        return;
      }
      copy.x = Math.min(210 - copy.w, copy.x + 4);
      copy.y = Math.min(297 - copy.h, copy.y + 4);
      current().elements.push(copy);
      selected = copy.id;
      render();
    };
    g("designerFront").onclick = () => {
      remember();
      current().elements = current().elements.filter((v) => v.id !== e.id);
      current().elements.push(e);
      render();
    };
  }
  function remove() {
    if (!element()) return;
    remember();
    current().elements = current().elements.filter((e) => e.id !== selected);
    selected = null;
    render();
  }
  function startDrag(ev, el) {
    if (ev.button !== 0) return;
    ev.preventDefault();
    ev.stopPropagation();
    selected = el.dataset.element;
    const e = element(),
      resize = !!ev.target.closest("[data-resize]");
    remember();
    drag = {
      id: selected,
      x: ev.clientX,
      y: ev.clientY,
      start: structuredClone(e),
      resize,
    };
    el.setPointerCapture(ev.pointerId);
    el.classList.add("selected");
    el.onpointermove = (move) => {
      if (!drag) return;
      const scale = g("designerSheet").getBoundingClientRect().width / 210,
        dx = (move.clientX - drag.x) / scale,
        dy = (move.clientY - drag.y) / scale,
        snap = g("designerSnap").checked ? 2 : 0.1,
        round = (n) => Math.round(n / snap) * snap;
      if (resize) {
        e.w = Math.max(
          e.type === "items" ? 100 : e.type === "totals" ? 60 : 5,
          Math.min(210 - e.x, round(drag.start.w + dx)),
        );
        e.h = Math.max(
          e.type === "items" ? 30 : e.type === "totals" ? 25 : 2,
          Math.min(297 - e.y, round(drag.start.h + dy)),
        );
      } else {
        e.x = Math.max(0, Math.min(210 - e.w, round(drag.start.x + dx)));
        e.y = Math.max(0, Math.min(297 - e.h, round(drag.start.y + dy)));
      }
      el.style.left = e.x + "mm";
      el.style.top = e.y + "mm";
      el.style.width = e.w + "mm";
      el.style.height = e.h + "mm";
    };
    el.onpointerup = () => {
      drag = null;
      render();
    };
    el.onpointercancel = () => {
      drag = null;
      render();
    };
  }
  function apply() {
    const d = KlyoQuoteStudio.collect().document;
    d.layout = "canvas";
    d.canvas = C.normalize(design);
    KlyoQuoteStudio.applyCanvas(d);
  }
  async function save() {
    const button = g("designerSave");
    button.disabled = true;
    try {
      apply();
      const name = g("designerName").value.trim();
      if (!name)
        throw new Error(l("Name your template.", "Nazwij swój szablon."));
      const id = g("quoteTemplateSelect")?.value,
        oldName = g("quoteTemplateName")?.value,
        content = {
          title: els.quoteTitleInput.value,
          intro_message: els.quoteIntroInput.value,
          currency: els.quoteCurrencySelect.value,
          line_items: currentQuoteLineItems,
          ...KlyoQuoteStudio.collect(),
        },
        body = { name, content };
      const r =
        id && name === oldName
          ? await API.put("/quote-templates/" + id, body)
          : await API.post("/quote-templates", body);
      await KlyoQuoteTemplates.open();
      g("quoteTemplateSelect").value = r.template.id;
      g("quoteTemplateName").value = name;
      close();
      toast(l("Your A4 template is ready.", "Twój szablon A4 jest gotowy."));
    } catch (e) {
      g("designerError").textContent = e.message;
    } finally {
      button.disabled = false;
    }
  }
  async function preview() {
    const button = g("designerPreview"),
      version = ++previewVersion;
    button.disabled = true;
    try {
      const ctx = context(),
        document = { ...ctx.d, layout: "canvas", canvas: C.normalize(design) };
      const response = await fetch("/api/quote-templates/preview", {
        method: "POST",
        headers: API.headers({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          title: ctx.q.title,
          currency: ctx.q.currency,
          line_items: ctx.q.computed,
          tax_rate: ctx.q.tax_rate,
          discount_type: ctx.q.discount_type,
          discount_value: ctx.q.discount_value,
          document,
        }),
      });
      if (!response.ok) throw new Error((await response.json()).error);
      const data = await response.arrayBuffer();
      if (version !== previewVersion) return;
      g("designerPdfOverlay").hidden = false;
      const module = await import("/js/pdf-preview.mjs");
      if (version !== previewVersion) return;
      const rendered = await module.showPdf(
        data,
        g("designerPdfViewer"),
        KlyoI18n.getLang(),
      );
      if (version !== previewVersion) {
        await rendered.destroy();
        return;
      }
      pdfViewer = rendered;
      g("designerPdfClose").focus();
      pdfUrl = URL.createObjectURL(
        new Blob([data], { type: "application/pdf" }),
      );
      g("designerPdfDownload").href = pdfUrl;
    } catch (e) {
      g("designerError").textContent = e.message;
    } finally {
      button.disabled = false;
    }
  }
  async function closePdf() {
    previewVersion++;
    g("designerPdfOverlay").hidden = true;
    const oldViewer = pdfViewer,
      oldUrl = pdfUrl;
    pdfViewer = null;
    pdfUrl = null;
    if (oldUrl) URL.revokeObjectURL(oldUrl);
    await oldViewer?.destroy();
  }
  function close() {
    previewVersion++;
    closePdf().catch(() => {});
    g("quoteDesigner").hidden = true;
    previousFocus?.focus();
    selected = null;
  }
  function mount() {
    if (g("quoteDesigner")) return;
    document.addEventListener(
      "keydown",
      (ev) => {
        if (
          g("quoteDesigner") &&
          !g("quoteDesigner").hidden &&
          ev.key === "Tab"
        ) {
          const host = g("designerPdfOverlay").hidden
              ? g("quoteDesigner")
              : g("designerPdfOverlay"),
            items = [
              ...host.querySelectorAll(
                'button,input,textarea,select,a[href],[tabindex="0"]',
              ),
            ].filter((el) => !el.disabled && el.getClientRects().length),
            first = items[0],
            last = items.at(-1);
          if (ev.shiftKey && document.activeElement === first) {
            ev.preventDefault();
            last?.focus();
          } else if (!ev.shiftKey && document.activeElement === last) {
            ev.preventDefault();
            first?.focus();
          }
        }
        if (
          g("quoteDesigner") &&
          !g("quoteDesigner").hidden &&
          ev.key === "Escape"
        ) {
          ev.preventDefault();
          ev.stopImmediatePropagation();
          if (!g("designerPdfOverlay").hidden) closePdf();
          else close();
        }
      },
      true,
    );
    document.body.insertAdjacentHTML(
      "beforeend",
      `<section id="quoteDesigner" class="designer-overlay" role="dialog" aria-modal="true" aria-label="A4 template designer" hidden><div class="designer-header"><div><strong>${l("Create your own template", "Stwórz własny szablon")}</strong><span>A4 · 210 × 297 mm</span></div><input id="designerName" maxlength="100" placeholder="${l("Template name", "Nazwa szablonu")}" aria-label="Template name"><button type="button" id="designerPreview">${l("Preview PDF", "Podgląd PDF")}</button><button type="button" id="designerUse">${l("Use layout", "Użyj układu")}</button><button type="button" id="designerSave" class="designer-primary">${l("Save template", "Zapisz szablon")}</button><button type="button" id="designerClose" aria-label="Close">×</button></div><div class="designer-toolbar"><button type="button" id="designerUndo">↶ ${l("Undo", "Cofnij")}</button><button type="button" id="designerRedo">↷ ${l("Redo", "Ponów")}</button><select id="designerPagePicker" aria-label="Page"></select><button type="button" id="designerAddPage">+ ${l("Page", "Strona")}</button><button type="button" id="designerDeletePage">${l("Delete page", "Usuń stronę")}</button><label><input type="checkbox" id="designerSnap" checked> ${l("Snap to 2 mm grid", "Przyciągaj do siatki 2 mm")}</label><label>${l("Zoom", "Powiększenie")} <input type="number" id="designerZoom" min="25" max="150" step="5">%</label></div><div class="designer-workspace"><aside class="designer-tools"><h3>${l("Add an element", "Dodaj element")}</h3>${C.TYPES.map((type) => `<button type="button" data-add-element="${type}">+ ${h(names()[type])}</button>`).join("")}<input type="file" accept="image/png,image/jpeg" id="designerImageFile" hidden><button type="button" id="designerStarter">${l("Use a starter layout", "Użyj przykładowego układu")}</button><h3>${l("Layers", "Warstwy")}</h3><div id="designerLayers"></div></aside><div class="designer-viewport" id="designerViewport"><div id="designerSheetWrap"><div id="designerSheet"></div></div></div><aside class="designer-inspector" id="designerInspector"></aside></div><div class="designer-footer"><span id="designerSampleHint"></span><span id="designerError" role="alert"></span></div></section><section id="designerPdfOverlay" class="designer-pdf-overlay" role="dialog" aria-modal="true" hidden><div><a id="designerPdfDownload" download="Klyo-template-preview.pdf">${l("Download PDF", "Pobierz PDF")}</a><button type="button" id="designerPdfClose">${l("Back to editor", "Wróć do edytora")}</button></div><div id="designerPdfViewer" class="quote-pdf-viewer"></div></section>`,
    );
    g("designerClose").onclick = close;
    g("designerUndo").onclick = () => restore(undo, redo);
    g("designerRedo").onclick = () => restore(redo, undo);
    g("designerPreview").onclick = preview;
    g("designerSave").onclick = save;
    g("designerUse").onclick = () => {
      try {
        apply();
        close();
      } catch (e) {
        g("designerError").textContent = e.message;
      }
    };
    g("designerPdfClose").onclick = closePdf;
    g("designerPagePicker").onchange = (ev) => {
      page = Number(ev.target.value);
      selected = null;
      render();
    };
    g("designerAddPage").onclick = () => {
      if (design.pages.length >= 10) return;
      remember();
      design.pages.push({ background: "#ffffff", elements: [] });
      page = design.pages.length - 1;
      selected = null;
      render();
    };
    g("designerDeletePage").onclick = () => {
      if (design.pages.length === 1) return;
      if (
        !confirm(
          l(
            "Delete this page and its elements?",
            "Usunąć stronę i jej elementy?",
          ),
        )
      )
        return;
      remember();
      design.pages.splice(page, 1);
      page = Math.max(0, page - 1);
      selected = null;
      render();
    };
    g("designerZoom").onchange = (ev) => setZoom(Number(ev.target.value) / 100);
    g("designerSheet").onclick = (ev) => {
      if (ev.target === g("designerSheet")) {
        selected = null;
        render();
      }
    };
    g("designerStarter").onclick = () => {
      if (
        current().elements.length &&
        !confirm(
          l(
            "Replace the current design with a starter layout?",
            "Zastąpić projekt przykładowym układem?",
          ),
        )
      )
        return;
      remember();
      design = C.starter();
      page = 0;
      selected = null;
      render();
    };
    g("quoteDesigner")
      .querySelectorAll("[data-add-element]")
      .forEach(
        (b) =>
          (b.onclick = () =>
            b.dataset.addElement === "image"
              ? g("designerImageFile").click()
              : add(b.dataset.addElement)),
      );
    g("designerImageFile").onchange = async (ev) => {
      try {
        const file = ev.target.files[0];
        if (!file) return;
        if (file.size > 5 * 1024 * 1024)
          throw new Error(
            l("Use an image under 5 MB.", "Użyj obrazu do 5 MB."),
          );
        const url = URL.createObjectURL(file),
          img = new Image();
        try {
          await new Promise((ok, no) => {
            img.onload = ok;
            img.onerror = no;
            img.src = url;
          });
          const scale = Math.min(1, 1000 / Math.max(img.width, img.height)),
            canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.round(img.width * scale));
          canvas.height = Math.max(1, Math.round(img.height * scale));
          canvas
            .getContext("2d")
            .drawImage(img, 0, 0, canvas.width, canvas.height);
          let image = canvas.toDataURL("image/png");
          if (image.length > 400000)
            image = canvas.toDataURL("image/jpeg", 0.8);
          if (image.length > 400000)
            throw new Error(
              l("Use a smaller image.", "Użyj mniejszego obrazu."),
            );
          add("image", image);
        } finally {
          URL.revokeObjectURL(url);
        }
      } catch (e) {
        g("designerError").textContent =
          e.message || l("Unable to load image.", "Nie można wczytać obrazu.");
      }
      ev.target.value = "";
    };
    document.addEventListener("keydown", (ev) => {
      if (
        g("quoteDesigner").hidden ||
        !g("designerPdfOverlay").hidden ||
        /^(INPUT|TEXTAREA|SELECT)$/.test(ev.target.tagName)
      )
        return;
      if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "z") {
        ev.preventDefault();
        ev.shiftKey ? restore(redo, undo) : restore(undo, redo);
        return;
      }
      if (ev.key === "Delete" || ev.key === "Backspace") {
        ev.preventDefault();
        remove();
      }
      const e = element();
      if (
        e &&
        ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(ev.key)
      ) {
        ev.preventDefault();
        remember();
        const step = ev.shiftKey ? 10 : ev.altKey ? 0.1 : 1;
        e.x = Math.max(
          0,
          Math.min(
            210 - e.w,
            e.x +
              (ev.key === "ArrowRight"
                ? step
                : ev.key === "ArrowLeft"
                  ? -step
                  : 0),
          ),
        );
        e.y = Math.max(
          0,
          Math.min(
            297 - e.h,
            e.y +
              (ev.key === "ArrowDown"
                ? step
                : ev.key === "ArrowUp"
                  ? -step
                  : 0),
          ),
        );
        render();
      }
    });
  }
  function open(blank = false) {
    mount();
    const d = KlyoQuoteStudio.collect().document;
    design = blank
      ? { version: 1, pages: [{ background: "#ffffff", elements: [] }] }
      : d.canvas
        ? structuredClone(d.canvas)
        : C.starter();
    page = 0;
    selected = null;
    undo = [];
    redo = [];
    g("designerName").value = g("quoteTemplateName")?.value || "";
    previousFocus = document.activeElement;
    g("quoteDesigner").hidden = false;
    g("designerPreview").disabled = false;
    zoom = Math.min(
      1,
      (g("designerViewport").clientWidth - 60) / ((210 * 96) / 25.4),
    );
    render();
    g("designerName").focus();
  }
  return { open };
})();
