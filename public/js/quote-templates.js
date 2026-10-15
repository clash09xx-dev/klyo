const KlyoQuoteTemplates = (() => {
  const g = (id) => document.getElementById(id),
    pl = () => KlyoI18n.getLang() === "pl",
    l = (en, pol) => (pl() ? pol : en),
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
      );
  let templates = [];
  async function open() {
    const { templates: list } = await API.get("/quote-templates");
    templates = list;
    g("quoteTemplateControls").innerHTML =
      `<div class="quote-template-picker"><label for="quoteTemplateSelect">${l("Your proposal templates", "Twoje szablony ofert")}</label><div><select id="quoteTemplateSelect"><option value="">${l("Choose a template", "Wybierz szablon")}</option>${list.map((t) => `<option value="${t.id}">${h(t.name)}</option>`).join("")}</select><button type="button" class="btn btn-ghost btn-sm" id="applyQuoteTemplate">${l("Use template", "Użyj szablonu")}</button></div><div><input id="quoteTemplateName" maxlength="100" placeholder="${l("Template name", "Nazwa szablonu")}" aria-label="Template name"><button type="button" class="btn btn-ghost btn-sm" id="saveQuoteTemplate">${l("Save as new", "Zapisz jako nowy")}</button><button type="button" class="btn btn-ghost btn-sm" id="updateQuoteTemplate">${l("Update template", "Zapisz zmiany szablonu")}</button><button type="button" class="btn btn-ghost btn-sm" id="deleteQuoteTemplate">${l("Delete", "Usuń")}</button></div><p class="muted">${l("Your templates are private. Save branding, sections, terms, items and discounts. Client details and old dates are never saved in a template.", "Twoje szablony są prywatne. Zapisz markę, sekcje, warunki, pozycje i rabaty. Dane klienta i stare daty nie są zapisywane w szablonie.")}</p><div id="quoteTemplateError" class="form-error"></div></div>`;
    g("quoteTemplateSelect").onchange = () => {
      const t = templates.find(
        (t) => t.id === Number(g("quoteTemplateSelect").value),
      );
      g("quoteTemplateName").value = t?.name || "";
    };
    g("applyQuoteTemplate").onclick = () => {
      const t = templates.find(
        (t) => t.id === Number(g("quoteTemplateSelect").value),
      );
      if (!t) return;
      try {
        const b = t.content;
        els.quoteTitleInput.value = b.title || "";
        els.quoteIntroInput.value = b.intro_message || "";
        els.quoteCurrencySelect.value = b.currency || workspaceDefaultCurrency;
        currentQuoteLineItems = structuredClone(b.line_items);
        KlyoQuoteStudio.applyTemplate(b);
        renderQuoteLineItems();
      } catch (e) {
        g("quoteTemplateError").textContent = e.message;
      }
    };
    const save = async (update) => {
      g("quoteTemplateError").textContent = "";
      const id = g("quoteTemplateSelect").value;
      if (update && !id) {
        g("quoteTemplateError").textContent = l(
          "Choose a template to update.",
          "Wybierz szablon do aktualizacji.",
        );
        return;
      }
      try {
        const content = {
            title: els.quoteTitleInput.value,
            intro_message: els.quoteIntroInput.value,
            currency: els.quoteCurrencySelect.value,
            line_items: currentQuoteLineItems,
            ...KlyoQuoteStudio.collect(),
          },
          body = { name: g("quoteTemplateName").value.trim(), content };
        const r = update
          ? await API.put("/quote-templates/" + id, body)
          : await API.post("/quote-templates", body);
        await open();
        g("quoteTemplateSelect").value = r.template.id;
        g("quoteTemplateName").value = r.template.name;
        toast(l("Template saved", "Szablon zapisany"));
      } catch (e) {
        g("quoteTemplateError").textContent = e.message;
      }
    };
    g("saveQuoteTemplate").onclick = () => save(false);
    g("updateQuoteTemplate").onclick = () => save(true);
    g("deleteQuoteTemplate").onclick = async () => {
      const id = g("quoteTemplateSelect").value;
      if (!id) return;
      if (
        !confirm(
          l(
            "Delete this template? Existing proposals stay unchanged.",
            "Usunąć szablon? Istniejące oferty pozostaną bez zmian.",
          ),
        )
      )
        return;
      try {
        await API.del("/quote-templates/" + id);
        await open();
      } catch (e) {
        g("quoteTemplateError").textContent = e.message;
      }
    };
  }
  function renderDocument(d) {
    const all = [
        ...d.sections,
        ...["scope", "items", "payment", "delivery", "terms"].filter(
          (k) => !d.sections.includes(k),
        ),
      ],
      L = KlyoQuoteCore.labels(pl() ? "pl" : "en");
    g("quoteDocumentControls").insertAdjacentHTML(
      "beforeend",
      `<details class="quote-document-details"><summary>${l("Build your document layout", "Ułóż własny dokument")}</summary><p class="muted">${l("Reorder sections, hide optional sections and write your own headings. Pricing always stays visible.", "Zmień kolejność sekcji, ukryj opcjonalne sekcje i wpisz własne nagłówki. Wycena pozostaje widoczna.")}</p><div id="quoteSectionOrder">${all.map((k) => `<div class="quote-section-row" data-section="${k}"><label><input type="checkbox" ${d.sections.includes(k) ? "checked" : ""} ${k === "items" ? "disabled" : ""}>${h(L[k])}</label><input type="text" data-section-heading maxlength="80" value="${h(d.headings[k] || "")}" placeholder="${h(L[k])}" aria-label="${h(L[k])} heading"><button type="button" class="btn btn-ghost btn-sm" data-section-move="-1" aria-label="Move section up">↑</button><button type="button" class="btn btn-ghost btn-sm" data-section-move="1" aria-label="Move section down">↓</button></div>`).join("")}</div><label for="quoteBodySize">${l("Body type size · points", "Rozmiar tekstu · punkty")}</label><input id="quoteBodySize" type="number" min="8" max="12" step="0.5" value="${d.body_size}"></details>`,
    );
    g("quoteSectionOrder")
      .querySelectorAll("[data-section-move]")
      .forEach(
        (b) =>
          (b.onclick = () => {
            const row = b.closest("[data-section]"),
              step = Number(b.dataset.sectionMove);
            if (step < 0 && row.previousElementSibling)
              row.parentNode.insertBefore(row, row.previousElementSibling);
            if (step > 0 && row.nextElementSibling)
              row.parentNode.insertBefore(row.nextElementSibling, row);
          }),
      );
  }
  function readDocument(d) {
    const rows = [...g("quoteSectionOrder").children];
    d.sections = rows
      .filter((r) => r.querySelector("input[type=checkbox]").checked)
      .map((r) => r.dataset.section);
    d.headings = Object.fromEntries(
      rows.map((r) => [
        r.dataset.section,
        r.querySelector("[data-section-heading]").value,
      ]),
    );
    d.body_size = Number(g("quoteBodySize").value);
    return d;
  }
  const discount = () => ({
    type: g("quoteDiscountType")?.value || "none",
    value: Number(g("quoteDiscountAmount")?.value || 0),
  });
  return { open, renderDocument, readDocument, discount };
})();
