const KlyoBundles = (() => {
  let state = [];
  const Q = KlyoQuoteCore,
    l = (en, pl) => (KlyoI18n.getLang() === "pl" ? pl : en),
    h = KlyoDocumentTools.esc;
  const groups = () =>
    Q.normalizeGroups(
      state,
      typeof currentQuoteLineItems === "undefined" ? [] : currentQuoteLineItems,
    );
  function open(value = []) {
    state = structuredClone(value || []);
  }
  function mount() {
    const head = document.querySelector("#quoteModalOverlay .modal-head");
    if (!head) return;
    let b = document.getElementById("quoteGroupsToggle");
    if (!b) {
      b = document.createElement("button");
      b.id = "quoteGroupsToggle";
      b.type = "button";
      b.className = "btn btn-ghost btn-sm";
      head.append(b);
    }
    b.textContent = l("Groups & discounts", "Zestawy i rabaty");
    b.onclick = edit;
  }
  function edit() {
    const side = document.querySelector(".commercial-margins");
    if (side) side.open = false;
    let draft = structuredClone(groups()),
      items = structuredClone(currentQuoteLineItems);
    const d = KlyoDocumentTools.dialog(
      l(
        "Groups, discounts & visible prices",
        "Zestawy, rabaty i widoczne ceny",
      ),
      `<p>${l("Item discounts → sub-group discounts → parent discounts → whole-quote discount. Included component prices are explanatory and are never added twice.", "Rabaty pozycji → rabaty podzestawów → rabaty zestawów nadrzędnych → rabat całej oferty. Pokazane ceny komponentów są informacyjne i nie są dodawane drugi raz.")}</p><div class="group-create"><input id="newPricingGroupName" placeholder="${l("e.g. Complete computer", "np. Cały komputer")}"><button class="btn btn-primary" id="newPricingGroup">+ ${l("Add group", "Dodaj zestaw")}</button></div><div id="pricingGroupRows"></div><h3>${l("Components & price disclosure", "Komponenty i widoczność cen")}</h3><div id="pricingComponentRows"></div><p class="muted">${l("The PDF always lists every component. Turn on a component price or a sub-group total only where you want to disclose it. Total-only quote mode hides all component and group prices.", "PDF zawsze wymienia wszystkie komponenty. Włącz cenę komponentu lub sumę podzestawu tylko tam, gdzie chcesz ją ujawnić. Tryb „tylko suma oferty” ukrywa wszystkie ceny komponentów i zestawów.")}</p><div id="pricingGroupPreview" aria-live="polite"></div><button class="btn btn-primary" id="applyPricingGroups">${l("Apply to quote", "Zastosuj w ofercie")}</button>`,
      true,
    );
    const options = (selected, except = "") =>
      `<option value="">${l("No parent / standalone", "Bez nadrzędnego / osobno")}</option>` +
      draft
        .filter((g) => g.id !== except)
        .map(
          (g) =>
            `<option value="${g.id}" ${g.id === selected ? "selected" : ""}>${h(g.name)}</option>`,
        )
        .join("");
    function preview() {
      try {
        const t = Q.computeTotals(
          items,
          Number(document.getElementById("quoteTaxRate").value || 0),
          { ...KlyoQuoteTemplates.discount(), pricing_groups: draft },
        );
        d.find("#pricingGroupPreview").innerHTML =
          `<strong>${l("Quote total", "Suma oferty")}: ${h(fmtMoney(t.total, document.getElementById("quoteCurrencySelect").value, 2))}</strong> · ${l("Group discounts", "Rabaty zestawów")}: ${h(fmtMoney(t.group_discount_total, document.getElementById("quoteCurrencySelect").value, 2))}`;
        d.find(".doc-error").textContent = "";
      } catch (e) {
        d.error(e);
      }
    }
    function render() {
      d.find("#pricingGroupRows").innerHTML = draft
        .map(
          (g) =>
            `<section class="pricing-group-card" data-pricing-group="${g.id}"><label>${l("Group name", "Nazwa zestawu")}<input data-group-key="name" value="${h(g.name)}" maxlength="200"></label><label>${l("Parent group", "Zestaw nadrzędny")}<select data-group-key="parent_id">${options(g.parent_id, g.id)}</select></label><label>${l("Group discount", "Rabat zestawu")}<select data-group-key="discount_type"><option value="none">${l("None", "Brak")}</option><option value="percent">%</option><option value="fixed">${h(document.getElementById("quoteCurrencySelect").value)}</option></select></label><label>${l("Value", "Wartość")}<input data-group-key="discount_value" type="number" min="0" step="0.01" value="${g.discount_value}"></label><label class="group-checkbox"><input type="checkbox" data-group-key="show_total" ${g.show_total ? "checked" : ""}>${l("Show group total", "Pokaż sumę zestawu")}</label><button type="button" class="btn btn-ghost" data-delete-group="${g.id}">${l("Remove group", "Usuń zestaw")}</button></section>`,
        )
        .join("");
      draft.forEach((g) => {
        d.find(
          `[data-pricing-group="${g.id}"] [data-group-key=discount_type]`,
        ).value = g.discount_type;
      });
      d.find("#pricingComponentRows").innerHTML = items
        .map(
          (i, index) =>
            `<div class="pricing-component" data-pricing-item="${index}"><strong>${h(i.description || l("New item", "Nowa pozycja"))}</strong><label>${l("Group", "Zestaw")}<select data-item-key="bundle_id">${options(i.bundle_id)}</select></label><label class="group-checkbox"><input data-item-key="show_component_price" type="checkbox" ${i.show_component_price ? "checked" : ""}>${l("Show included price", "Pokaż cenę w zestawie")}</label></div>`,
        )
        .join("");
      preview();
    }
    d.find("#newPricingGroup").onclick = () => {
      const name = d.find("#newPricingGroupName").value.trim();
      if (!name) return;
      draft.push({
        id: crypto.randomUUID(),
        name,
        parent_id: "",
        discount_type: "none",
        discount_value: 0,
        show_total: true,
      });
      d.find("#newPricingGroupName").value = "";
      render();
    };
    d.body.addEventListener("change", (e) => {
      const g = e.target.closest("[data-pricing-group]"),
        i = e.target.closest("[data-pricing-item]");
      if (g) {
        const row = draft.find((x) => x.id === g.dataset.pricingGroup),
          key = e.target.dataset.groupKey;
        if (key)
          row[key] =
            e.target.type === "checkbox" ? e.target.checked : e.target.value;
      }
      if (i) {
        const key = e.target.dataset.itemKey;
        if (key)
          items[Number(i.dataset.pricingItem)][key] =
            e.target.type === "checkbox" ? e.target.checked : e.target.value;
      }
      preview();
    });
    d.body.addEventListener("click", (e) => {
      const b = e.target.closest("[data-delete-group]");
      if (!b) return;
      const g = draft.find((x) => x.id === b.dataset.deleteGroup);
      draft = draft.filter((x) => x !== g);
      draft.forEach((x) => {
        if (x.parent_id === g.id) x.parent_id = g.parent_id;
      });
      items.forEach((x) => {
        if (x.bundle_id === g.id) x.bundle_id = g.parent_id;
      });
      render();
    });
    d.find("#applyPricingGroups").onclick = () => {
      try {
        const normalized = Q.normalizeGroups(draft, items);
        Q.computeTotals(items, 0, { pricing_groups: normalized });
        state = normalized;
        items.forEach((i) => {
          i.bundle_name = state.find((g) => g.id === i.bundle_id)?.name || "";
        });
        currentQuoteLineItems = items;
        renderQuoteLineItems();
        recomputeQuoteTotals();
        document
          .getElementById("quoteForm")
          .dispatchEvent(new Event("input", { bubbles: true }));
        d.close();
      } catch (e) {
        d.error(e);
      }
    };
    render();
  }
  return { open, groups, mount, edit };
})();
