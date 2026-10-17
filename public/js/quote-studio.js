/* Proposal document controls and authenticated binary PDF preview. No email sends. */
const KlyoQuoteStudio = (() => {
  const Q = KlyoQuoteCore,
    g = (id) => document.getElementById(id),
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
      );
  let documentState = Q.normalizeDocument(),
    workspace = null,
    pdfUrl = null,
    pdfName = "offer.pdf",
    revision = null,
    viewer = null,
    previewVersion = 0;
  const words = {
    en: {
      design: "Proposal document",
      designHint: "Choose a style. Add your brand, scope and terms.",
      saveDefault: "Save as company default",
      defaultNote:
        "Company defaults apply to future quotes. Existing documents stay unchanged.",
      style: "Document style",
      language: "Document language",
      accent: "Brand accent",
      reference: "Reference (auto if empty)",
      issued: "Issue date",
      valid: "Valid until",
      tax: "Tax % (optional)",
      logo: "Company logo · PNG/JPEG",
      removeLogo: "Remove logo",
      parties: "Company & client details",
      seller: "Your company",
      buyer: "Client",
      name: "Name / company",
      details: "Address & details",
      email: "Email",
      phone: "Phone",
      tax_id: "Tax ID",
      scopeTerms: "Scope, payment & terms",
      scope: "Scope of work",
      payment: "Payment schedule / terms",
      delivery: "Delivery / timeline",
      terms: "Terms & notes",
      footer: "Document footer",
      download: "Download PDF",
      previewPdf: "Preview PDF",
      savePdf: "Save & preview PDF",
      duplicate: "Duplicate",
      attach: "Attach proposal PDF",
      mobilePdf:
        "If your browser cannot display the preview, download the PDF to open it.",
      savedDefault: "Default document design saved.",
      failed: "Could not prepare this PDF.",
      logoError: "Choose a PNG/JPEG logo under 5 MB.",
      copied: "Quote copied as a new draft.",
    },
    pl: {
      design: "Dokument oferty",
      designHint: "Wybierz styl. Dodaj markę, zakres prac i warunki.",
      saveDefault: "Zapisz jako domyślne firmy",
      defaultNote:
        "Domyślny wygląd dotyczy nowych ofert. Zapisane dokumenty pozostają bez zmian.",
      style: "Styl dokumentu",
      language: "Język dokumentu",
      accent: "Kolor marki",
      reference: "Numer oferty (puste = automatycznie)",
      issued: "Data wystawienia",
      valid: "Ważna do",
      tax: "Podatek % (opcjonalny)",
      logo: "Logo firmy · PNG/JPEG",
      removeLogo: "Usuń logo",
      parties: "Dane firmy i klienta",
      seller: "Twoja firma",
      buyer: "Klient",
      name: "Nazwa / firma",
      details: "Adres i dane",
      email: "Email",
      phone: "Telefon",
      tax_id: "NIP / Tax ID",
      scopeTerms: "Zakres, płatność i warunki",
      scope: "Zakres współpracy",
      payment: "Harmonogram i warunki płatności",
      delivery: "Termin realizacji",
      terms: "Warunki i uwagi",
      footer: "Stopka dokumentu",
      download: "Pobierz PDF",
      previewPdf: "Podgląd PDF",
      savePdf: "Zapisz i pokaż PDF",
      duplicate: "Kopiuj ofertę",
      attach: "Dołącz ofertę PDF",
      mobilePdf:
        "Jeśli przeglądarka nie wyświetla podglądu, pobierz PDF i otwórz go na urządzeniu.",
      savedDefault: "Zapisano domyślny wygląd ofert.",
      failed: "Nie udało się przygotować PDF.",
      logoError: "Wybierz logo PNG/JPEG o rozmiarze do 5 MB.",
      copied: "Skopiowano ofertę do nowego szkicu.",
    },
  };
  const language = () => (KlyoI18n.getLang() === "pl" ? "pl" : "en"),
    t = (k) => words[language()][k] || k;
  const field = (key, label, type = "text", max = 1000) =>
    `<label>${esc(label)}<input id="doc-${key.replace(".", "-")}" data-doc="${key}" type="${type}" ${type === "text" ? `maxlength="${max}"` : ""}></label>`;
  function labels() {
    document
      .querySelectorAll("[data-quote-label]")
      .forEach((el) => (el.textContent = t(el.dataset.quoteLabel)));
  }
  function render() {
    const party = (key) =>
      `<div><h4>${t(key)}</h4>${["name", "details", "email", "phone", "tax_id"].map((k) => (k === "details" ? `<label class="field">${t(k)}<textarea data-doc="${key}.${k}" maxlength="1600"></textarea></label>` : `<div class="field">${field(key + "." + k, t(k), "text", k === "name" ? 160 : k === "email" ? 254 : 80)}</div>`)).join("")}</div>`;
    g("quoteDocumentControls").innerHTML =
      `<div class="quote-document-design"><div class="quote-document-heading"><div><h3>${t("design")}</h3><p>${t("designHint")}</p></div><button type="button" class="btn btn-ghost btn-sm" id="saveQuoteDefaultsBtn" ${API.getUser()?.role === "admin" ? "" : "hidden"}>${t("saveDefault")}</button></div><div class="quote-design-fields"><label>${t("style")}<select data-doc="layout" id="doc-layout"><option value="studio">${KlyoCopy.text("Studio")}</option><option value="executive">${KlyoCopy.text("Executive")}</option><option value="canvas" ${documentState.canvas?"":"disabled"}>${KlyoCopy.text("Custom A4")}</option></select></label><label>${t("language")}<select data-doc="language" id="doc-language"><option value="pl">Polski</option><option value="en">English</option></select></label>${field("accent", t("accent"), "color")}${field("reference", t("reference"), "text", 60)}${field("issued_on", t("issued"), "date")}${field("valid_until", t("valid"), "date")}<label>${t("tax")}<input type="number" min="0" max="100" step="0.01" id="quoteTaxRate" value="0"></label></div><div class="quote-logo-control"><img id="quoteLogoPreview" alt="Company logo" hidden><label>${t("logo")} <input type="file" id="quoteLogoFile" accept="image/png,image/jpeg"></label><button type="button" class="btn btn-ghost btn-sm" id="removeQuoteLogo">${t("removeLogo")}</button></div><p class="quote-save-default-note">${t("defaultNote")}</p><div id="quoteDesignError" class="quote-design-error"></div></div><details class="quote-document-details"><summary>${t("parties")}</summary><div class="quote-party-grid">${party("seller")}${party("buyer")}</div></details><details class="quote-document-details"><summary>${t("scopeTerms")}</summary>${["scope", "payment", "delivery", "terms", "footer"].map((k) => `<div class="quote-wide-field"><label for="doc-${k}">${t(k)}</label><textarea id="doc-${k}" data-doc="${k}" maxlength="${{ scope: 8000, payment: 1500, delivery: 1500, terms: 6000, footer: 300 }[k]}"></textarea></div>`).join("")}</details>`;
    for (const el of g("quoteDocumentControls").querySelectorAll(
      "[data-doc]",
    )) {
      const [key, sub] = el.dataset.doc.split(".");
      el.value = sub ? documentState[key][sub] : documentState[key];
    }
    KlyoQuoteTemplates.renderDocument(documentState);
    logoPreview();
    labels();
  }
  function read() {
    const result = structuredClone(documentState);
    for (const el of g("quoteDocumentControls").querySelectorAll(
      "[data-doc]",
    )) {
      const [key, sub] = el.dataset.doc.split(".");
      if (sub) result[key][sub] = el.value;
      else result[key] = el.value;
    }
    if(typeof KlyoBundles!=="undefined")result.pricing_groups=KlyoBundles.groups();
    result.pricing_mode = typeof KlyoCommercial!=="undefined" ? KlyoCommercial.pricingMode() : result.pricing_mode;
    return Q.normalizeDocument(KlyoQuoteTemplates.readDocument(result));
  }
  async function open(quote = null, contact = {}) {
    try {
      workspace = (await API.get("/quotes/document-defaults")).workspace;
    } catch {
      workspace = workspace || {
        name: API.getUser()?.name || "",
        quote_defaults: {},
      };
    }
    documentState = Q.normalizeDocument({
      ...Q.defaultsDocument(workspace, contact, language()),
      ...(quote?.document || {}),
    });
    if (quote && !documentState.issued_on)
      documentState.issued_on = String(
        quote.created_at || new Date().toISOString(),
      ).slice(0, 10);
    render();
    if(typeof KlyoBundles!=="undefined")KlyoBundles.open(documentState.pricing_groups);
    await KlyoPriceLists.openQuote(quote);
    if(typeof KlyoCommercial!=="undefined")await KlyoCommercial.openQuote(quote);
    g("quoteTaxRate").value = Number(quote?.tax_rate) || 0;
    g("quoteDiscountType").value=quote?.discount_type||"none";g("quoteDiscountAmount").value=quote?.discount_value||0;
    try{await KlyoQuoteTemplates.open();}catch(e){g("quoteTemplateControls").textContent=e.message;}
  }
  function applyTemplate(content){if(typeof KlyoBundles!=="undefined")KlyoBundles.open(content.document?.pricing_groups||[]);const current=read();documentState=Q.normalizeDocument({...content.document,buyer:current.buyer,reference:current.reference,issued_on:new Date().toISOString().slice(0,10),valid_until:''});render();if(typeof KlyoCommercial!=="undefined")KlyoCommercial.setPricingMode(documentState.pricing_mode);g('quoteTaxRate').value=content.tax_rate||0;g('quoteDiscountType').value=content.discount_type||'none';g('quoteDiscountAmount').value=content.discount_value||0;}
  function collect() {
    documentState = read();
    return {
      ...KlyoPriceLists.collect(),
      ...(typeof KlyoCommercial!=="undefined"?KlyoCommercial.collectQuote():{}),
      discount_type:KlyoQuoteTemplates.discount().type,discount_value:KlyoQuoteTemplates.discount().value,
      document: documentState,
      tax_rate: Number(g("quoteTaxRate")?.value || 0),
    };
  }
  function contactChanged() {
    if (g("quoteModalOverlay").classList.contains("hidden")) return;
    const c = allContactsCache.find(
      (c) => String(c.id) === g("quoteContactSelect").value,
    );
    if (!c) return;
    const buyer = Q.defaultsDocument({}, c).buyer;
    for (const [k, v] of Object.entries(buyer)) {
      const el = g("quoteDocumentControls").querySelector(
        `[data-doc="buyer.${k}"]`,
      );
      if (el) el.value = v;
    }
  }
  function logoPreview() {
    const image = g("quoteLogoPreview");
    image.hidden = !documentState.logo_data_url;
    if (documentState.logo_data_url) image.src = documentState.logo_data_url;
    else image.removeAttribute("src");
  }
  async function loadLogo(file) {
    if (
      !file ||
      !["image/png", "image/jpeg"].includes(file.type) ||
      file.size > 5 * 1024 * 1024
    )
      throw new Error(t("logoError"));
    const source = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error(t("logoError")));
      reader.readAsDataURL(file);
    });
    const image = new Image();
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error(t("logoError")));
      image.src = source;
    });
    const scale = Math.min(1, 1000 / Math.max(image.width, image.height)),
      canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
    let encoded = canvas.toDataURL("image/png");
    if (encoded.length > 400000) {
      const context = canvas.getContext("2d");
      context.globalCompositeOperation = "destination-over";
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      encoded = canvas.toDataURL("image/jpeg", 0.82);
    }
    if (encoded.length > 400000) throw new Error(t("logoError"));
    documentState.logo_data_url = encoded;
    logoPreview();
  }
  async function fetchPdf(id) {
    const response = await fetch(
      `/api/quotes/${encodeURIComponent(id)}/pdf?inline=1`,
      { headers: API.headers() },
    );
    if (!response.ok) {
      let data = {};
      try {
        data = await response.json();
      } catch {}
      throw new Error(data.error || t("failed"));
    }
    const blob = await response.blob();
    if (!blob.type.includes("application/pdf")) throw new Error(t("failed"));
    const disposition = response.headers.get("Content-Disposition") || "";
    return {
      blob,
      filename: disposition.match(/filename="([^"]+)"/)?.[1] || "offer.pdf",
    };
  }
  function saveBlob(url, name) {
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
  async function download(id) {
    try {
      const result = await fetchPdf(id),
        url = URL.createObjectURL(result.blob);
      saveBlob(url, result.filename);
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch (error) {
      toast(error.message, "error");
    }
  }
  async function preview(id) {
    const version = ++previewVersion;
    g("quotePdfOverlay").classList.remove("hidden");
    g("quotePdfError").textContent = "";
    g("quotePdfFrame").replaceChildren();
    g("quotePdfFrame").dataset.rendered = "false";
    g("downloadPreviewPdfBtn").disabled = true;
    labels();
    try {
      const result = await fetchPdf(id);
      if (version !== previewVersion) return;
      if (pdfUrl) URL.revokeObjectURL(pdfUrl);
      pdfUrl = URL.createObjectURL(result.blob);
      pdfName = result.filename;
      g("quotePdfFilename").textContent = pdfName;
      g("downloadPreviewPdfBtn").disabled = false;
      const module = await import("/js/pdf-preview.mjs");
      if (version !== previewVersion) return;
      if (viewer) await viewer.destroy();
      const next = await module.showPdf(
        await result.blob.arrayBuffer(),
        g("quotePdfFrame"),
        language(),
      );
      if (version !== previewVersion) {
        await next.destroy();
        return;
      }
      viewer = next;
    } catch (error) {
      if (version === previewVersion)
        g("quotePdfError").textContent = error.message;
    }
  }
  function closePdf() {
    previewVersion++;
    g("quotePdfOverlay").classList.add("hidden");
    if (viewer) {
      viewer.destroy().catch(() => {});
      viewer = null;
    }
    g("quotePdfFrame").replaceChildren();
    if (pdfUrl) {
      URL.revokeObjectURL(pdfUrl);
      pdfUrl = null;
    }
  }
  function init() {
    for(const id of ["quoteDiscountType","quoteDiscountAmount"])g(id).addEventListener("input",recomputeQuoteTotals);
    labels();
    g("quoteSavePdfBtn").addEventListener("click", () => saveQuote("pdf"));
    g("quoteViewPdfBtn").addEventListener("click", () =>
      preview(g("quotePanelOverlay").dataset.quoteId),
    );
    g("quoteDownloadPdfBtn").addEventListener("click", () =>
      download(g("quotePanelOverlay").dataset.quoteId),
    );
    g("quoteEmailPdfPreview").addEventListener("click", () =>
      preview(quotePendingSendId),
    );
    g("quoteDuplicateBtn").addEventListener("click", async (event) => {
      event.currentTarget.disabled = true;
      try {
        const result = await API.post(
          `/quotes/${g("quotePanelOverlay").dataset.quoteId}/duplicate`,
          {},
        );
        closeQuotePanel();
        await openQuotePanel(result.quote.id);
        toast(t("copied"));
        loadQuotes();
      } catch (error) {
        toast(error.message, "error");
      } finally {
        g("quoteDuplicateBtn").disabled = false;
      }
    });
    g("closeQuotePdfBtn").addEventListener("click", closePdf);
    g("quotePdfOverlay").addEventListener("click", (event) => {
      if (event.target === g("quotePdfOverlay")) closePdf();
    });
    g("downloadPreviewPdfBtn").addEventListener("click", () => {
      if (pdfUrl) saveBlob(pdfUrl, pdfName);
    });
    g("quoteDocumentControls").addEventListener("change", async (event) => {
      if (event.target.id === "quoteLogoFile") {
        try {
          await loadLogo(event.target.files[0]);
          g("quoteDesignError").textContent = "";
        } catch (error) {
          g("quoteDesignError").textContent = error.message;
        } finally {
          event.target.value = "";
        }
      }
    });
    g("quoteDocumentControls").addEventListener("input", (event) => {
      if (event.target.id === "quoteTaxRate") recomputeQuoteTotals();
    });
    g("quoteDocumentControls").addEventListener("click", async (event) => {
      if (event.target.id === "removeQuoteLogo") {
        documentState.logo_data_url = "";
        logoPreview();
      }
      if (event.target.id === "saveQuoteDefaultsBtn") {
        event.target.disabled = true;
        try {
          const result = await API.put("/quotes/document-defaults", read());
          workspace = { ...workspace, quote_defaults: result.document };
          toast(t("savedDefault"));
        } catch (error) {
          g("quoteDesignError").textContent = error.message;
        } finally {
          event.target.disabled = false;
        }
      }
    });
    document.addEventListener("keydown", (event) => {
      if (
        event.key === "Escape" &&
        !g("quotePdfOverlay").classList.contains("hidden")
      )
        closePdf();
    });
    window.addEventListener("klyo:language", labels);
  }
  function emailPreview(email) {
    revision = email.revision;
    g("quoteAttachPdf").checked = true;
    g("quoteAttachmentName").textContent = email.attachment?.filename || "PDF";
  }
  function sendOptions() {
    return { attach_pdf: g("quoteAttachPdf").checked, revision };
  }
  return {
    init,
    open,
    collect,applyTemplate,
    applyCanvas(value){
      const tax=Number(g('quoteTaxRate')?.value||0),discount=KlyoQuoteTemplates.discount();
      documentState=Q.normalizeDocument(value);render();
      g('quoteTaxRate').value=tax;g('quoteDiscountType').value=discount.type;g('quoteDiscountAmount').value=discount.value;
      recomputeQuoteTotals();
    },
    contactChanged,
    preview,
    download,
    emailPreview,
    sendOptions,
  };
})();
