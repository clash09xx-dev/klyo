const KlyoDealViews = (() => {
  const g = (id) => document.getElementById(id),
    h = KlyoDocumentTools.esc,
    pl = () => KlyoI18n.getLang() === "pl",
    l = (en, p) => (pl() ? p : en);
  let mode = "board",
    rows = [],
    selected = new Set();
  const key = () => `klyo_deal_view:${API.getUser()?.id}:${API.scope()}`;
  function init() {
    try {
      mode = localStorage.getItem(key()) === "table" ? "table" : "board";
    } catch {}
    g("dealStatusFilter").insertAdjacentHTML(
      "beforeend",
      KlyoCopy.html("<option value=\"deleted\">") + l("Deleted", "Usunięte") + "</option>",
    );
    g("dealsBoardWrap").insertAdjacentHTML(
      "beforebegin",
      `<div class="deal-view-toolbar"><div role="group" aria-label="${KlyoCopy.escape(KlyoCopy.text("Deal view"))}"><button type="button" id="dealsBoardMode" class="btn btn-ghost btn-sm">${l("Board", "Tablica")}</button><button type="button" id="dealsTableMode" class="btn btn-ghost btn-sm">${l("Table", "Tabela")}</button></div><button class="btn btn-ghost btn-sm" id="exportSelectedDeals">${l("Export selected", "Eksport zaznaczonych")}</button></div><div id="dealsTableView" class="table-card" hidden></div>`,
    );
    document.body.insertAdjacentHTML(
      "beforeend",
      `<div id="dealDropOutcomes" class="deal-outcomes" hidden><div data-deal-outcome="won">✓ ${l("Won", "Wygrane")}</div><div data-deal-outcome="lost">× ${l("Lost", "Przegrane")}</div><div data-deal-outcome="deleted">⌫ ${l("Move to trash", "Przenieś do kosza")}</div></div>`,
    );
    g("dealsBoardMode").onclick = () => setMode("board");
    g("dealsTableMode").onclick = () => setMode("table");
    g("exportSelectedDeals").onclick = exportSelected;
    document.addEventListener("dragstart", (e) => {
      if (e.target.closest(".deal-card") && API.getUser()?.role !== "viewer")
        g("dealDropOutcomes").hidden = false;
    });
    document.addEventListener(
      "dragend",
      () => (g("dealDropOutcomes").hidden = true),
    );
    for (const zone of g("dealDropOutcomes").children) {
      zone.ondragover = (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        zone.classList.add("over");
      };
      zone.ondragleave = () => zone.classList.remove("over");
      zone.ondrop = (e) => {
        e.preventDefault();
        zone.classList.remove("over");
        g("dealDropOutcomes").hidden = true;
        const id = e.dataTransfer.getData("dealId");
        if (id) outcome(id, zone.dataset.dealOutcome);
      };
    }
    setMode(mode);
  }
  function setMode(value) {
    mode = value === "table" ? "table" : "board";
    try {
      localStorage.setItem(key(), mode);
    } catch {}
    applyMode();
  }
  function applyMode() {
    const table = mode === "table" || g("dealStatusFilter").value === "deleted";
    g("dealsTableView").hidden = !table;
    g("dealsBoardWrap").classList.toggle("deal-board-hidden", table);
    g("dealsBoardMode").setAttribute("aria-pressed", String(!table));
    g("dealsTableMode").setAttribute("aria-pressed", String(table));
  }
  function render(items) {
    rows = items;
    selected = new Set(
      [...selected].filter((id) => rows.some((r) => String(r.id) === id)),
    );
    const deleted = g("dealStatusFilter").value === "deleted";
    g("dealsTableView").innerHTML =
      `<div class="deal-grid-scroll"><table><thead><tr><th><input type="checkbox" id="selectAllDeals" aria-label="${l("Select all visible deals", "Zaznacz widoczne sprawy")}"></th><th>${l("Deal", "Sprawa")}</th><th>${l("Company / Contact", "Firma / Osoba")}</th><th>${l("Stage", "Etap")}</th><th>${l("Owner", "Opiekun")}</th><th>${l("Value", "Wartość")}</th><th>%</th><th>${l("Weighted", "Ważona")}</th><th>${l("Expected close", "Planowane zamknięcie")}</th><th></th></tr></thead><tbody>${rows.map((d) => `<tr><td><input type="checkbox" data-select-deal="${d.id}" ${selected.has(String(d.id)) ? "checked" : ""} aria-label="${h(d.title)}"></td><td><button class="deal-table-link" data-open-deal="${d.id}" ${deleted ? "disabled" : ""}>${h(d.title)}</button></td><td>${h(d.company_name || "—")}<br><small>${h(d.contact_name || "")}</small></td><td>${h(d.stage_name || "—")}</td><td>${h(d.assigned_name || "—")}</td><td>${h(fmtMoney(d.value || 0, d.currency, 2))}</td><td>${Number(d.effective_probability ?? d.probability ?? 0)}</td><td>${h(fmtMoney(d.weighted_value ?? (Number(d.value || 0) * Number(d.probability || 0)) / 100, d.currency, 2))}</td><td>${h(d.expected_close_date?.slice(0, 10) || "—")}</td><td>${deleted && API.getUser()?.role !== "viewer" ? `<button type="button" class="btn btn-ghost btn-sm" data-restore-deal="${d.id}">${l("Restore", "Przywróć")}</button>` : ""}</td></tr>`).join("") || `<tr><td colspan="10">${l("No matching deals", "Brak pasujących spraw")}</td></tr>`}</tbody></table></div>`;
    g("dealsTableView")
      .querySelectorAll("[data-select-deal]")
      .forEach(
        (el) =>
          (el.onchange = () => {
            el.checked
              ? selected.add(el.dataset.selectDeal)
              : selected.delete(el.dataset.selectDeal);
            counts();
          }),
      );
    g("selectAllDeals").onchange = (e) => {
      selected = e.target.checked
        ? new Set(rows.map((r) => String(r.id)))
        : new Set();
      render(rows);
    };
    g("dealsTableView")
      .querySelectorAll("[data-open-deal]")
      .forEach((b) => (b.onclick = () => openDealPanel(b.dataset.openDeal)));
    g("dealsTableView")
      .querySelectorAll("[data-restore-deal]")
      .forEach(
        (b) =>
          (b.onclick = async () => {
            try {
              await API.post(
                "/deals/" + b.dataset.restoreDeal + "/restore",
                {},
              );
              await loadDeals();
              toast(l("Deal restored", "Sprawa przywrócona"));
            } catch (e) {
              toast(e.message, "error");
            }
          }),
      );
    counts();
    applyMode();
  }
  function counts() {
    g("exportSelectedDeals").disabled = !selected.size;
    g("exportSelectedDeals").textContent =
      l("Export selected", "Eksport zaznaczonych") +
      (selected.size ? " (" + selected.size + ")" : "");
    if (g("selectAllDeals")) {
      g("selectAllDeals").checked =
        rows.length > 0 && selected.size === rows.length;
      g("selectAllDeals").indeterminate =
        selected.size > 0 && selected.size < rows.length;
    }
  }
  async function outcome(id, status) {
    const deal = dealsCache.find((d) => String(d.id) === String(id));
    if (!deal) return;
    try {
      if (status === "deleted") {
        if (
          !confirm(
            l(
              "Move this deal to trash? You can restore it from Deleted.",
              "Przenieść sprawę do kosza? Można ją przywrócić w Usuniętych.",
            ),
          )
        )
          return;
        await API.del("/deals/" + id);
      } else if (status === "lost") {
        const d = KlyoDocumentTools.dialog(
          l("Lost deal", "Przegrana sprawa"),
          `<form id="lostDropForm"><label>${l("Reason", "Powód")}<input id="lostDropReason" required maxlength="1000"></label><button class="btn btn-primary">${l("Mark lost", "Oznacz jako przegraną")}</button></form>`,
        );
        d.find("#lostDropForm").onsubmit = async (e) => {
          e.preventDefault();
          try {
            await API.put("/deals/" + id, {
              status: "lost",
              lost_reason: d.find("#lostDropReason").value,
            });
            d.close();
            await loadDeals();
          } catch (e) {
            d.error(e);
          }
        };
        return;
      } else await API.put("/deals/" + id, { status });
      await loadDeals();
    } catch (e) {
      toast(e.message, "error");
    }
  }
  function exportSelected() {
    const list = rows.filter((r) => selected.has(String(r.id))),
      header = [
        "ID",
        "Deal",
        "Company",
        "Contact",
        "Pipeline",
        "Stage",
        "Owner",
        "Status",
        "Value",
        "Currency",
        "Probability %",
        "Weighted value",
        "Expected close",
      ],
      cell = (v) =>
        '"' +
        (/^[=+\-@\t\r]/.test(String(v ?? "")) ? "'" : "") +
        String(v ?? "").replace(/"/g, '""') +
        '"',
      csv = [
        header,
        ...list.map((d) => [
          d.id,
          d.title,
          d.company_name,
          d.contact_name,
          d.pipeline_name,
          d.stage_name,
          d.assigned_name,
          d.status,
          d.value,
          d.currency,
          d.effective_probability ?? d.probability ?? 0,
          d.weighted_value,
          d.expected_close_date?.slice(0, 10),
        ]),
      ]
        .map((r) => r.map(cell).join(","))
        .join("\r\n"),
      url = URL.createObjectURL(
        new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" }),
      ),
      a = document.createElement("a");
    a.href = url;
    a.download = "Klyo-selected-deals.csv";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return { init, render, setMode };
})();
