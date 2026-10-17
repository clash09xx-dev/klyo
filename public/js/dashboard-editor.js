/* Bounded widgets, never user-provided HTML, scripts or arbitrary API paths. */
const KlyoDashboard = (() => {
  const P = KlyoPreferences,
    g = (id) => document.getElementById(id),
    h = KlyoDocumentTools.esc,
    l = (en, pl) => (KlyoI18n.getLang() === "pl" ? pl : en);
  const names = {
    metrics: ["Sales performance", "Wyniki sprzedaży"],
    goal: ["Target progress", "Realizacja planu"],
    scorecards: ["Benchmarks & targets", "Benchmarki i cele"],
    forecast: ["Forecast vs target", "Prognoza względem planu"],
    sources: ["Opportunity sources", "Źródła szans"],
    daily: ["Created vs closed", "Nowe i zamknięte"],
    closing: ["Closing soon", "Zamknięcie wkrótce"],
    risks: ["Pipeline health", "Stan lejka"],
    leaderboard: ["Team sales results", "Wyniki zespołu"],
    trend: ["Closed sales trend", "Trend zamkniętej sprzedaży"],
    stages: ["Pipeline by stage", "Lejek według etapów"],
    activity: ["Recorded team activity", "Aktywność zespołu"],
    alltime: ["All-time summary", "Podsumowanie całego okresu"],
    wonlost: ["Won & lost", "Wygrane i przegrane"],
    lossreasons: ["Loss reasons", "Powody przegranych"],
    valuebands: ["Closed deal value bands", "Przedziały wartości spraw"],
    aging: ["Age of open opportunities", "Wiek otwartych szans"],
    sourceconversion: ["Closed results by source", "Wyniki według źródeł"],
    tasks: ["My open tasks", "Moje otwarte zadania"],
    companies: ["Companies", "Firmy"],
    quotes: ["Recent quotes", "Ostatnie oferty"],
    shortcut_deal: ["New deal", "Nowy deal"],
    shortcut_contact: ["New contact", "Nowy kontakt"],
    shortcut_quote: ["New quote", "Nowa oferta"],
    shortcut_task: ["New task", "Nowe zadanie"],
  };
  let moved = [],
    editing = false,
    draft = null,
    report = null,
    query = "",
    generation = 0,
    drag = null,
    grid = null,
    outcomesRequest = null;
  const title = (id) => l(...names[id]);
  function beforeRender() {
    for (const { node, anchor } of moved)
      if (anchor.parentNode) {
        anchor.replaceWith(node);
      }
    moved = [];
    g("dashboardGrid")?.remove();
  }
  const selectors = () => ({
    metrics: g("analyticsMetrics"),
    goal: g("analyticsGoal"),
    scorecards: g("salesScorecardBlock"),
    forecast: g("salesForecast")?.closest("article"),
    sources: g("salesSources"),
    daily: g("salesDaily")?.closest("article"),
    closing: g("salesClosing"),
    risks: g("salesRisk"),
    leaderboard: g("salesLeaderboard"),
    trend: g("analyticsTrend")?.closest("article"),
    stages: g("analyticsStages")?.closest("article"),
    activity: g("analyticsActivity"),
    alltime: g("personalOverview"),
  });
  function item(id, layout) {
    return layout.dashboard.find((w) => w.id === id);
  }
  function applyPosition(card, w) {
    card.style.gridColumn = `${w.x + 1} / span ${w.w}`;
    card.style.gridRow = `${w.y + 1} / span ${w.h}`;
  }
  function reconcile(r, params) {
    report = r;
    query = String(params);
    outcomesRequest = null;
    if (!g("analyticsMetrics")) return;
    const layout = (editing ? draft : KlyoCustomize.getSaved()).layout;
    grid = document.createElement("div");
    grid.id = "dashboardGrid";
    grid.className = "dashboard-grid";
    g("analyticsDashboard").append(grid);
    const source = selectors();
    for (const id of P.DASHBOARD) {
      if ((id === "activity" || id === "leaderboard") && !r.can_manage)
        continue;
      const node = source[id],
        w = item(id, layout),
        card = document.createElement("section");
      card.className = "dashboard-widget";
      card.dataset.widgetId = id;
      card.hidden = !w;
      card.innerHTML = `<header data-organizer-control><strong>${h(title(id))}</strong><div class="widget-organize"><button type="button" data-move-widget="left" aria-label="${l("Move left", "Przesuń w lewo")}">←</button><button type="button" data-move-widget="up" aria-label="${l("Move up", "Przesuń w górę")}">↑</button><button type="button" data-move-widget="right" aria-label="${l("Move right", "Przesuń w prawo")}">→</button><button type="button" data-move-widget="down" aria-label="${l("Move down", "Przesuń w dół")}">↓</button><button type="button" data-size-widget="-1" aria-label="${l("Narrower", "Węższe")}">−</button><button type="button" data-size-widget="1" aria-label="${l("Wider", "Szersze")}">＋</button><button type="button" data-remove-widget aria-label="${l("Remove widget", "Usuń element")}">×</button></div></header><div class="dashboard-widget-body"></div><button type="button" class="widget-resize" data-organizer-control aria-label="${l("Resize widget", "Zmień rozmiar elementu")}">◢</button>`;
      if (w) applyPosition(card, w);
      grid.append(card);
      if (node) {
        const anchor = document.createComment("dashboard:" + id);
        node.before(anchor);
        moved.push({ node, anchor });
        card.querySelector(".dashboard-widget-body").append(node);
      } else if (!source[id] && w)
        customWidget(
          id,
          card.querySelector(".dashboard-widget-body"),
          r,
          ++generation,
        );
      wireCard(card, id);
    }
    const empty = document.createElement("p");
    empty.className = "dashboard-empty";
    empty.hidden = layout.dashboard.length > 0;
    empty.textContent = l(
      "Your dashboard is empty. Customize it to add a feature.",
      "Twój dashboard jest pusty. Włącz personalizację, aby dodać element.",
    );
    grid.append(empty);
    if (editing) renderCatalog();
  }
  async function customWidget(id, body, r) {
    const ticket = body;
    body.textContent = l("Loading…", "Ładowanie…");
    try {
      if (id.startsWith("shortcut_")) {
        const buttons = {
          shortcut_deal: "addDealBtn",
          shortcut_contact: "newContactBtn",
          shortcut_quote: "newQuoteBtn",
          shortcut_task: "opTaskAdd",
        };
        body.innerHTML = `<button class="dashboard-shortcut btn btn-primary">＋ ${h(title(id))}</button>`;
        body.querySelector("button").onclick = () => {
          if (id === "shortcut_contact") openContactModal();
          else if (id === "shortcut_quote") openQuoteModal();
          else if (id === "shortcut_task") {
            switchView("tasks");
            g("opNewTask")?.click();
          } else g("addDealBtn").click();
        };
        return;
      }
      if (["tasks", "companies", "quotes"].includes(id)) {
        const path = {
            tasks: "/operations/tasks",
            companies: "/companies",
            quotes: "/quotes",
          }[id],
          data = await API.get(path);
        if (!ticket.isConnected) return;
        const rows = (data[id] || [])
          .filter(
            (x) =>
              id !== "tasks" ||
              (x.status !== "done" &&
                (!x.assigned_to || x.assigned_to === API.getUser().id)),
          )
          .slice(0, 8);
        body.innerHTML =
          rows
            .map(
              (row) =>
                `<button class="dashboard-record" data-record-id="${row.id}"><strong>${h(row.title || row.name)}</strong><small>${h(row.due_date || row.currency || "")}</small></button>`,
            )
            .join("") || `<p>${l("No records yet.", "Brak danych.")}</p>`;
        body.querySelectorAll("[data-record-id]").forEach(
          (b) =>
            (b.onclick = () => {
              switchView(id);
              if (id === "companies")
                openCompanyPanel(Number(b.dataset.recordId));
              if (id === "quotes") openQuotePanel(Number(b.dataset.recordId));
            }),
        );
        return;
      }
      const data = await (outcomesRequest ||= API.get(
        "/deal-outcomes?" + query,
      ));
      if (!ticket.isConnected) return;
      if (id === "wonlost") {
        body.innerHTML =
          KlyoOutcomes.cards(data) + KlyoOutcomes.chart(data.trend);
        KlyoOutcomes.bind(body, data.filters);
      } else if (id === "lossreasons")
        body.innerHTML = KlyoOutcomes.bars(data.reasons);
      else if (id === "aging")
        body.innerHTML =
          `<p class="muted">${l("All currently open deals", "Wszystkie obecnie otwarte sprawy")}</p>` +
          KlyoOutcomes.bars(data.aging);
      else
        body.innerHTML = KlyoOutcomes.chart(
          id === "valuebands" ? data.bands : data.sources,
        );
    } catch (e) {
      if (ticket.isConnected) body.textContent = e.message;
    }
  }
  function update() {
    draft.layout.dashboard = P.packDashboard(draft.layout.dashboard);
    const r = report,
      q = query;
    beforeRender();
    if (r) reconcile(r, new URLSearchParams(q));
  }
  function adjust(id, change) {
    const w = draft.layout.dashboard.find((x) => x.id === id);
    if (!w) return;
    Object.assign(w, change);
    w.w = Math.max(3, Math.min(12, w.w));
    w.h = Math.max(2, Math.min(20, w.h));
    w.x = Math.max(0, Math.min(12 - w.w, w.x));
    w.y = Math.max(0, Math.min(220, w.y));
    draft.layout.dashboard = P.packDashboard(draft.layout.dashboard, id);
    update();
  }
  function wireCard(card, id) {
    const header = card.querySelector("header");
    header.draggable = true;
    header.ondragstart = (e) => {
      if (!editing) {
        e.preventDefault();
        return;
      }
      drag = id;
      e.dataTransfer.setData("text/plain", id);
      e.dataTransfer.effectAllowed = "move";
    };
    card.ondragover = (e) => {
      if (editing && drag) {
        e.preventDefault();
        card.classList.add("drop-target");
      }
    };
    card.ondragleave = () => card.classList.remove("drop-target");
    card.ondrop = (e) => {
      e.preventDefault();
      if (!editing || !drag) return;
      const target = draft.layout.dashboard.find((x) => x.id === id),
        moving = drag;
      drag = null;
      if (target) {
        if (item(moving, draft.layout))
          adjust(moving, { x: target.x, y: target.y });
        else add(moving, target.x, target.y);
      }
    };
    header.onclick = (e) => {
      if (!editing) return;
      const w = item(id, draft.layout);
      if (e.target.closest("[data-remove-widget]")) {
        draft.layout.dashboard = draft.layout.dashboard.filter(
          (x) => x.id !== id,
        );
        update();
      }
      const size = e.target.closest("[data-size-widget]");
      if (size) adjust(id, { w: w.w + 3 * Number(size.dataset.sizeWidget) });
      const move = e.target.closest("[data-move-widget]");
      if (move)
        adjust(
          id,
          {
            left: { x: w.x - 1 },
            right: { x: w.x + 1 },
            up: { y: w.y - 1 },
            down: { y: w.y + 1 },
          }[move.dataset.moveWidget],
        );
    };
    card.querySelector(".widget-resize").onkeydown = (e) => {
      if (
        !editing ||
        !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)
      )
        return;
      e.preventDefault();
      const w = item(id, draft.layout);
      adjust(
        id,
        e.key === "ArrowLeft"
          ? { w: w.w - 1 }
          : e.key === "ArrowRight"
            ? { w: w.w + 1 }
            : e.key === "ArrowUp"
              ? { h: w.h - 1 }
              : { h: w.h + 1 },
      );
    };
    card.querySelector(".widget-resize").onpointerdown = (e) => {
      if (!editing) return;
      e.preventDefault();
      const start = {
        x: e.clientX,
        y: e.clientY,
        w: { ...item(id, draft.layout) },
        width: grid.getBoundingClientRect().width,
      };
      const b = e.target;
      b.setPointerCapture(e.pointerId);
      b.onpointermove = (ev) => {
        const w = {
          ...start.w,
          w: Math.max(
            3,
            Math.min(
              12 - start.w.x,
              Math.round(
                start.w.w + (ev.clientX - start.x) / (start.width / 12),
              ),
            ),
          ),
          h: Math.max(
            2,
            Math.min(20, Math.round(start.w.h + (ev.clientY - start.y) / 64)),
          ),
        };
        applyPosition(card, w);
      };
      b.onpointerup = (ev) => {
        b.onpointermove = null;
        b.onpointerup = null;
        adjust(id, {
          w: Math.round(
            start.w.w + (ev.clientX - start.x) / (start.width / 12),
          ),
          h: Math.round(start.w.h + (ev.clientY - start.y) / 64),
        });
      };
    };
  }
  function renderCatalog() {
    const panel = g("dashboardOrganizer");
    if (!panel) return;
    panel.querySelector("#widgetCatalog").innerHTML =
      P.DASHBOARD.filter(
        (id) =>
          !item(id, draft.layout) &&
          (!["leaderboard", "activity"].includes(id) || report?.can_manage),
      )
        .map(
          (id) =>
            `<button type="button" class="widget-catalog-card" data-add-widget="${id}" draggable="true">＋ ${h(title(id))}</button>`,
        )
        .join("") ||
      `<p>${l("All features are on your dashboard.", "Wszystkie elementy są już na dashboardzie.")}</p>`;
    panel.querySelectorAll("[data-add-widget]").forEach((b) => {
      b.onclick = () => add(b.dataset.addWidget);
      b.ondragstart = (e) => {
        drag = b.dataset.addWidget;
        e.dataTransfer.setData("text/plain", drag);
      };
    });
    grid.ondragover = (e) => {
      if (editing && drag) e.preventDefault();
    };
    grid.ondrop = (e) => {
      if (!editing || !drag) return;
      e.preventDefault();
      const id = drag;
      drag = null;
      const rect = grid.getBoundingClientRect(),
        w = draft.layout.dashboard.find((x) => x.id === id);
      if (!w) {
        add(
          id,
          Math.floor(((e.clientX - rect.left) / rect.width) * 12),
          Math.floor((e.clientY - rect.top) / 64),
        );
      } else
        adjust(id, {
          x: Math.floor(((e.clientX - rect.left) / rect.width) * 12),
          y: Math.floor((e.clientY - rect.top) / 64),
        });
    };
  }
  function add(id, x = 0, y = 0) {
    if (!P.DASHBOARD.includes(id) || item(id, draft.layout)) return;
    draft.layout.dashboard.push({
      id,
      x: Math.min(6, x),
      y: Math.max(0, Math.min(220, y)),
      w: 6,
      h: id.startsWith("shortcut") ? 2 : 6,
    });
    draft.layout.dashboard = P.packDashboard(draft.layout.dashboard, id);
    update();
  }
  function exit() {
    editing = false;
    document.body.classList.remove("dashboard-editing");
    g("dashboardOrganizer")?.remove();
    g("dashboardEditBar")?.remove();
    const r = report,
      q = query;
    beforeRender();
    KlyoCustomize.preview(KlyoCustomize.getSaved());
    if (r) reconcile(r, new URLSearchParams(q));
  }
  function renderNavigation() {
    const box = g("dashboardNavModules");
    if (!box) return;
    const label = (id) =>
      document
        .querySelector(`.sidebar .nav-item[data-view="${id}"]`)
        ?.getAttribute("aria-label") || id;
    box.innerHTML = draft.layout.nav_order
      .map(
        (id, index) =>
          `<div class="organizer-nav-row"><label><input type="checkbox" data-nav-visible="${id}" ${draft.layout.hidden_nav.includes(id) ? "" : "checked"}>${h(label(id))}</label><button type="button" data-nav-move="${index}" data-step="-1" aria-label="${l("Move up", "Przesuń w górę")}" ${index === 0 ? "disabled" : ""}>↑</button><button type="button" data-nav-move="${index}" data-step="1" aria-label="${l("Move down", "Przesuń w dół")}" ${index === draft.layout.nav_order.length - 1 ? "disabled" : ""}>↓</button></div>`,
      )
      .join("");
    box.onchange = (e) => {
      const id = e.target.dataset.navVisible;
      if (!id) return;
      draft.layout.hidden_nav = draft.layout.hidden_nav.filter((x) => x !== id);
      if (!e.target.checked) draft.layout.hidden_nav.push(id);
      KlyoCustomize.preview(draft);
    };
    box.onclick = (e) => {
      const b = e.target.closest("[data-nav-move]");
      if (!b) return;
      const index = Number(b.dataset.navMove),
        next = index + Number(b.dataset.step);
      [draft.layout.nav_order[index], draft.layout.nav_order[next]] = [
        draft.layout.nav_order[next],
        draft.layout.nav_order[index],
      ];
      KlyoCustomize.preview(draft);
      renderNavigation();
    };
  }
  async function begin() {
    if (editing) return;
    closeAppearanceModal();
    draft = KlyoCustomize.getSaved();
    editing = true;
    document.body.classList.add("dashboard-editing");
    switchView("overview");
    const bar = document.createElement("div");
    bar.id = "dashboardEditBar";
    bar.dataset.organizerControl = "";
    bar.innerHTML = `<div><strong>${l("Customization mode", "Tryb personalizacji")}</strong><span>${l("Drag, resize, add or remove. Your records stay unchanged.", "Przeciągaj, zmieniaj rozmiar, dodawaj lub usuwaj elementy. Dane klientów pozostają bez zmian.")}</span></div><button id="dashboardSave" class="btn btn-primary">${l("Save layout", "Zapisz układ")}</button><button id="dashboardCancel" class="btn btn-ghost">${l("Cancel", "Anuluj")}</button>`;
    g("salesOverviewView").prepend(bar);
    const panel = document.createElement("aside");
    panel.id = "dashboardOrganizer";
    panel.dataset.organizerControl = "";
    panel.innerHTML = `<h2>${l("Add features", "Dodaj elementy")}</h2><p>${l("Click a feature or drag it onto the grid.", "Kliknij element lub przeciągnij go na siatkę.")}</p><label>${l("Navigation width", "Szerokość menu")}<input id="organizerNavWidth" type="range" min="208" max="360" value="${draft.layout.sidebar_width}"></label><label>${l("Navigation layout", "Układ menu")}<select id="organizerNavMode"><option value="grouped">${l("Grouped sections", "Sekcje")}</option><option value="tiles">${l("Two-column tiles", "Kafelki w dwóch kolumnach")}</option><option value="list">${l("Simple list", "Lista")}</option></select></label><button class="btn btn-ghost" id="organizerReset">${l("Reset dashboard", "Przywróć dashboard")}</button><label>${l("Navigation position", "Położenie menu")}<select id="organizerNavSide"><option value="left">${l("Left", "Lewa strona")}</option><option value="right">${l("Right", "Prawa strona")}</option></select></label><label class="organizer-collapse"><input type="checkbox" id="organizerCollapsed">${l("Compact icon menu", "Kompaktowe menu z ikonami")}</label><details class="organizer-navigation"><summary>${l("Show, hide & order menu items", "Pokaż, ukryj i uporządkuj menu")}</summary><div id="dashboardNavModules"></div></details><h3>${l("Available features", "Dostępne elementy")}</h3><div id="widgetCatalog"></div><p id="dashboardEditorError" class="form-error" role="alert"></p>`;
    document.body.append(panel);
    g("organizerNavMode").value = draft.layout.nav_mode;
    renderNavigation();
    g("organizerNavSide").value = draft.layout.sidebar;
    g("organizerCollapsed").checked = draft.layout.collapsed;
    g("organizerNavSide").onchange = (e) => {
      draft.layout.sidebar = e.target.value;
      KlyoCustomize.preview(draft);
    };
    g("organizerCollapsed").onchange = (e) => {
      draft.layout.collapsed = e.target.checked;
      KlyoCustomize.preview(draft);
    };
    g("dashboardCancel").onclick = exit;
    g("dashboardSave").onclick = async (e) => {
      e.target.disabled = true;
      try {
        await KlyoCustomize.save(P.normalize(draft, true));
        exit();
        toast(
          l(
            "Layout saved for your account.",
            "Układ zapisany dla Twojego konta.",
          ),
        );
      } catch (e) {
        g("dashboardEditorError").textContent = e.message;
      } finally {
        e.target.disabled = false;
      }
    };
    g("organizerNavWidth").oninput = (e) => {
      draft.layout.sidebar_width = Number(e.target.value);
      KlyoCustomize.preview(draft);
    };
    g("organizerNavMode").onchange = (e) => {
      draft.layout.nav_mode = e.target.value;
      KlyoCustomize.preview(draft);
    };
    g("organizerReset").onclick = () => {
      draft.layout.dashboard = P.defaultDashboard();
      update();
    };
    if (report) update();
    window.scrollTo({ top: 0, behavior: "instant" });
  }
  function init() {
    const settings = document.createElement("button");
    settings.id = "customizeDashboardBtn";
    settings.className = "btn btn-primary";
    settings.type = "button";
    settings.textContent = l("Customize dashboard", "Dostosuj dashboard");
    settings.onclick = begin;
    g("personalSettings").prepend(settings);
    const b = settings.cloneNode(true);
    b.id = "customizeDashboardQuick";
    b.onclick = begin;
    g("analyticsDashboard").querySelector(".analytics-heading").append(b);
    const nav = settings.cloneNode(true);
    nav.id = "customizeDashboardNav";
    nav.className = "btn btn-ghost";
    nav.textContent = l("✥ Customize workspace", "✥ Dostosuj przestrzeń");
    nav.onclick = begin;
    document.querySelector(".sidebar-foot").prepend(nav);
    document.addEventListener(
      "click",
      (e) => {
        if (editing && !e.target.closest("[data-organizer-control]")) {
          e.preventDefault();
          e.stopImmediatePropagation();
        }
      },
      true,
    );
    document.addEventListener(
      "keydown",
      (e) => {
        if (editing && e.key === "Escape") {
          e.preventDefault();
          e.stopImmediatePropagation();
          exit();
        }
      },
      true,
    );
  }
  return { init, begin, beforeRender, reconcile, isEditing: () => editing };
})();
