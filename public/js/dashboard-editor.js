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
    outcomesRequest = null,
    resizeObserver = null,
    gesture = null,
    selectedId = null;
  const title = (id) => l(...names[id]);
  function beforeRender() {
    resizeObserver?.disconnect();
    if (gesture) finishGesture(true);
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
  const round = (n) => Math.round(n * 100) / 100;
  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
  function snap(n, px, free = false) {
    if (free || draft?.layout.dashboard_snap === "free") return round(n);
    const step = draft?.layout.dashboard_snap === "grid" ? 1 : 0.25,
      nearest = Math.round(n / step) * step;
    return round(
      draft?.layout.dashboard_snap === "grid" || Math.abs(nearest - n) * px <= 6
        ? nearest
        : n,
    );
  }
  function applyPosition(card, w) {
    if (grid.clientWidth < 40) return 0;
    const width = grid.clientWidth,
      pitch = (width + 12) / 12,
      cw = w.w * pitch - 12,
      ch = w.h * 64 - 12,
      angle = w.tilt || 0,
      r = (Math.abs(angle) * Math.PI) / 180;
    const bw = cw * Math.cos(r) + ch * Math.sin(r),
      bh = ch * Math.cos(r) + cw * Math.sin(r),
      scale = angle ? Math.min(1, (width - 4) / Math.max(1, bw)) : 1,
      dx = Math.max(0, (bw * scale - cw) / 2),
      dy = Math.max(0, (bh * scale - ch) / 2);
    const left = clamp(w.x * pitch, dx, Math.max(dx, width - cw - dx)),
      top = Math.max(w.y * 64, angle ? dy + 2 : 0);
    Object.assign(card.style, {
      left: left + "px",
      top: top + "px",
      width: cw + "px",
      height: ch + "px",
      transform: `rotate(${angle}deg) scale(${scale})`,
    });
    card.dataset.tilt = angle;
    return top + ch + dy + 8;
  }
  function arrange(preview) {
    if (!grid) return;
    const layout = (editing ? draft : KlyoCustomize.getSaved()).layout;
    let height = 180;
    for (const card of grid.querySelectorAll("[data-widget-id]")) {
      const w =
        preview?.id === card.dataset.widgetId
          ? preview
          : item(card.dataset.widgetId, layout);
      card.hidden = !w;
      card.classList.toggle(
        "widget-selected",
        editing && card.dataset.widgetId === selectedId,
      );
      if (w) height = Math.max(height, applyPosition(card, w));
    }
    grid.style.height = height + "px";
    const empty = grid.querySelector(".dashboard-empty");
    if (empty) empty.hidden = layout.dashboard.length > 0;
    refreshInspector(preview);
  }
  function refreshInspector(preview) {
    const panel = g("widgetInspector");
    if (!panel) return;
    const w =
      preview?.id === selectedId ? preview : item(selectedId, draft.layout);
    panel.hidden = !w;
    g("inspectorEmpty").hidden = !!w;
    if (!w) return;
    g("inspectorTitle").textContent = title(w.id);
    for (const [key, value] of Object.entries({
      x: round((w.x / 12) * 100),
      y: round(w.y * 64),
      w: round((w.w / 12) * 100),
      h: round(w.h * 64 - 12),
      tilt: w.tilt || 0,
    })) {
      const input = panel.querySelector(`[data-placement="${key}"]`);
      if (input && document.activeElement !== input) input.value = value;
    }
    g("widgetTiltValue").textContent = (w.tilt || 0) + "°";
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
    arrange();
    let observedWidth = grid.clientWidth,
      resizeFrame = null;
    const observedGrid = grid;
    resizeObserver = new ResizeObserver(() => {
      if (observedGrid.clientWidth !== observedWidth) {
        observedWidth = observedGrid.clientWidth;
        // Apply geometry in the next frame, outside ResizeObserver delivery.
        // This also coalesces width changes while the whole-app menu is resized.
        if (resizeFrame === null)
          resizeFrame = requestAnimationFrame(() => {
            resizeFrame = null;
            if (grid === observedGrid && grid.isConnected)
              arrange(gesture?.preview);
          });
      }
    });
    resizeObserver.observe(grid);
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
  function update(rebuild = false) {
    draft.layout.dashboard = P.packDashboard(draft.layout.dashboard);
    if (rebuild) {
      const r = report,
        q = query;
      beforeRender();
      if (r) reconcile(r, new URLSearchParams(q));
    } else arrange();
    if (editing) renderCatalog();
  }
  function adjust(id, change) {
    const w = item(id, draft.layout);
    if (!w) return;
    const next = { ...w, ...change };
    next.w = round(clamp(next.w, 2, 12));
    next.h = round(clamp(next.h, 2, 20));
    next.x = round(clamp(next.x, 0, 12 - next.w));
    next.y = round(clamp(next.y, 0, 220));
    next.tilt = round(clamp(next.tilt || 0, -6, 6));
    try {
      draft.layout.dashboard = P.packDashboard(
        draft.layout.dashboard.map((x) => (x.id === id ? next : x)),
        id,
      );
      update();
    } catch (e) {
      toast(e.message, "error");
      arrange();
    }
  }
  function gesturePreview(e) {
    const a = gesture,
      rect = grid.getBoundingClientRect(),
      pitch = (rect.width + 12) / 12;
    if (a.kind === "move")
      return {
        ...a.original,
        x: clamp(
          snap((e.clientX - rect.left - a.grabX) / pitch, pitch, e.altKey),
          0,
          12 - a.original.w,
        ),
        y: clamp(
          snap((e.clientY - rect.top - a.grabY) / 64, 64, e.altKey),
          0,
          220,
        ),
      };
    return {
      ...a.original,
      w: clamp(
        snap(a.original.w + (e.clientX - a.startX) / pitch, pitch, e.altKey),
        2,
        12 - a.original.x,
      ),
      h: clamp(
        snap(a.original.h + (e.clientY - a.startY) / 64, 64, e.altKey),
        2,
        20,
      ),
    };
  }
  function finishGesture(cancel = false) {
    if (!gesture) return;
    const a = gesture;
    gesture = null;
    cancelAnimationFrame(a.frame);
    a.controller.abort();
    a.card.classList.remove("widget-moving");
    try {
      a.handle.releasePointerCapture(a.pointerId);
    } catch {}
    if (!cancel && a.preview) adjust(a.original.id, a.preview);
    else arrange();
  }
  function startGesture(e, card, id, kind) {
    if (
      !editing ||
      e.button !== 0 ||
      matchMedia("(max-width:800px)").matches ||
      e.target.closest(".widget-organize")
    )
      return;
    e.preventDefault();
    selectedId = id;
    arrange();
    const rect = card.getBoundingClientRect(),
      original = { ...item(id, draft.layout) },
      controller = new AbortController(),
      handle = e.currentTarget;
    gesture = {
      card,
      handle,
      original,
      kind,
      controller,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      grabX: e.clientX - rect.left,
      grabY: e.clientY - rect.top,
      preview: original,
      last: e,
      frame: 0,
    };
    // Use the unrotated origin so grabbing a tilted header never jumps the card.
    const board = grid.getBoundingClientRect(),
      pitch = (board.width + 12) / 12;
    gesture.grabX = e.clientX - board.left - original.x * pitch;
    gesture.grabY = e.clientY - board.top - original.y * 64;
    card.classList.add("widget-moving");
    handle.setPointerCapture(e.pointerId);
    const tick = () => {
      if (!gesture) return;
      const a = gesture,
        ev = a.last;
      const edge = ev.clientY < 90 ? -1 : ev.clientY > innerHeight - 70 ? 1 : 0;
      if (edge) window.scrollBy(0, edge * 10);
      a.preview = gesturePreview(ev);
      arrange(a.preview);
      a.frame = requestAnimationFrame(tick);
    };
    gesture.frame = requestAnimationFrame(tick);
    window.addEventListener(
      "pointermove",
      (ev) => {
        if (gesture && ev.pointerId === gesture.pointerId) gesture.last = ev;
      },
      { signal: controller.signal },
    );
    window.addEventListener(
      "pointerup",
      (ev) => {
        if (gesture && ev.pointerId === gesture.pointerId) {
          gesture.preview = gesturePreview(ev);
          finishGesture();
        }
      },
      { signal: controller.signal },
    );
    window.addEventListener("pointercancel", () => finishGesture(true), {
      signal: controller.signal,
    });
  }
  function wireCard(card, id) {
    const header = card.querySelector("header");
    header.draggable = false;
    header.tabIndex = editing ? 0 : -1;
    header.setAttribute("aria-label", l("Move ", "Przesuń ") + title(id));
    header.onpointerdown = (e) => startGesture(e, card, id, "move");
    header.onkeydown = (e) => {
      if (
        !editing ||
        e.target !== header ||
        !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)
      )
        return;
      e.preventDefault();
      const w = item(id, draft.layout),
        step = e.altKey ? 0.01 : e.shiftKey ? 1 : 0.25;
      selectedId = id;
      adjust(
        id,
        {
          ArrowLeft: { x: w.x - step },
          ArrowRight: { x: w.x + step },
          ArrowUp: { y: w.y - step },
          ArrowDown: { y: w.y + step },
        }[e.key],
      );
    };
    header.onclick = (e) => {
      if (!editing) return;
      selectedId = id;
      const w = item(id, draft.layout);
      if (e.target.closest("[data-remove-widget]")) {
        draft.layout.dashboard = draft.layout.dashboard.filter(
          (x) => x.id !== id,
        );
        selectedId = null;
        update();
        return;
      }
      const size = e.target.closest("[data-size-widget]");
      if (size) adjust(id, { w: w.w + 0.5 * Number(size.dataset.sizeWidget) });
      const move = e.target.closest("[data-move-widget]");
      if (move)
        adjust(
          id,
          {
            left: { x: w.x - 0.25 },
            right: { x: w.x + 0.25 },
            up: { y: w.y - 0.25 },
            down: { y: w.y + 0.25 },
          }[move.dataset.moveWidget],
        );
      arrange();
    };
    const resize = card.querySelector(".widget-resize");
    resize.onpointerdown = (e) => startGesture(e, card, id, "resize");
    resize.onkeydown = (e) => {
      if (
        !editing ||
        !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)
      )
        return;
      e.preventDefault();
      selectedId = id;
      const w = item(id, draft.layout),
        step = e.altKey ? 0.01 : e.shiftKey ? 1 : 0.25;
      adjust(
        id,
        {
          ArrowLeft: { w: w.w - step },
          ArrowRight: { w: w.w + step },
          ArrowUp: { h: w.h - step },
          ArrowDown: { h: w.h + step },
        }[e.key],
      );
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
          snap(
            (e.clientX - rect.left) / ((rect.width + 12) / 12),
            (rect.width + 12) / 12,
            e.altKey,
          ),
          snap((e.clientY - rect.top) / 64, 64, e.altKey),
        );
      } else
        adjust(id, {
          x: snap(
            (e.clientX - rect.left) / ((rect.width + 12) / 12),
            (rect.width + 12) / 12,
            e.altKey,
          ),
          y: snap((e.clientY - rect.top) / 64, 64, e.altKey),
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
      tilt: 0,
      h: id.startsWith("shortcut") ? 2 : 6,
    });
    draft.layout.dashboard = P.packDashboard(draft.layout.dashboard, id);
    selectedId = id;
    update(true);
  }
  function exit() {
    finishGesture(true);
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
    selectedId = draft.layout.dashboard[0]?.id || null;
    editing = true;
    document.body.classList.add("dashboard-editing");
    switchView("overview");
    const bar = document.createElement("div");
    bar.id = "dashboardEditBar";
    bar.dataset.organizerControl = "";
    bar.innerHTML = `<div><strong class="miy-wordmark">Make It Yours</strong><span>${l("Drag smoothly. Resize, tilt and make room for your work. Your records stay unchanged.", "Przesuwaj płynnie. Zmieniaj rozmiary i obracaj elementy. Dane klientów pozostają bez zmian.")}</span></div><button id="dashboardSave" class="btn btn-primary">${l("Save layout", "Zapisz układ")}</button><button id="dashboardCancel" class="btn btn-ghost">${l("Cancel", "Anuluj")}</button>`;
    g("salesOverviewView").prepend(bar);
    const panel = document.createElement("aside");
    panel.id = "dashboardOrganizer";
    panel.dataset.organizerControl = "";
    panel.innerHTML = `<h2 class="miy-wordmark">Make It Yours</h2><p>${l("Click a feature or drag it onto the grid.", "Kliknij element lub przeciągnij go na siatkę.")}</p><label>${l("Placement", "Układanie")}<select id="organizerSnap"><option value="magnetic">${l("Magnetic guides", "Przyciąganie do prowadnic")}</option><option value="free">${l("Free placement", "Swobodne położenie")}</option><option value="grid">${l("Grid alignment", "Równa siatka")}</option></select></label><p class="miy-gesture-hint">${l("Drag a header. Hold Alt for free movement. Use arrow keys for small nudges.", "Przeciągnij nagłówek. Przytrzymaj Alt, aby wyłączyć przyciąganie. Strzałki przesuwają o mały krok.")}</p><p id="inspectorEmpty">${l("Select a feature to fine-tune it.", "Wybierz element, aby go dopasować.")}</p><fieldset id="widgetInspector"><legend id="inspectorTitle"></legend><details class="miy-fine-placement"><summary>${l("Fine placement", "Dokładne położenie")}</summary><div class="miy-placement-fields"><label>${l("Horizontal %", "Poziomo %")}<input data-placement="x" type="number" min="0" max="100" step=".1"></label><label>${l("Vertical px", "Pionowo px")}<input data-placement="y" type="number" min="0" max="14080" step="1"></label><label>${l("Width %", "Szerokość %")}<input data-placement="w" type="number" min="16.67" max="100" step=".1"></label><label>${l("Height px", "Wysokość px")}<input data-placement="h" type="number" min="116" max="1268" step="1"></label></div></details><label>${l("Tilt", "Nachylenie")} <output id="widgetTiltValue">0°</output><input data-placement="tilt" type="range" min="-6" max="6" step=".5"></label><button id="widgetStraighten" type="button" class="btn btn-ghost">${l("Straighten", "Wyprostuj")} ↺</button></fieldset><details class="miy-nav-options"><summary>${l("Navigation & menu", "Nawigacja i menu")}</summary><label>${l("Navigation width", "Szerokość menu")}<input id="organizerNavWidth" type="range" min="208" max="360" value="${draft.layout.sidebar_width}"></label><label>${l("Navigation layout", "Układ menu")}<select id="organizerNavMode"><option value="grouped">${l("Grouped sections", "Sekcje")}</option><option value="tiles">${l("Two-column tiles", "Kafelki w dwóch kolumnach")}</option><option value="list">${l("Simple list", "Lista")}</option></select></label><button class="btn btn-ghost" id="organizerReset">${l("Reset dashboard", "Przywróć dashboard")}</button><label>${l("Navigation position", "Położenie menu")}<select id="organizerNavSide"><option value="left">${l("Left", "Lewa strona")}</option><option value="right">${l("Right", "Prawa strona")}</option></select></label><label class="organizer-collapse"><input type="checkbox" id="organizerCollapsed">${l("Compact icon menu", "Kompaktowe menu z ikonami")}</label><details class="organizer-navigation"><summary>${l("Show, hide & order menu items", "Pokaż, ukryj i uporządkuj menu")}</summary><div id="dashboardNavModules"></div></details></details><h3>${l("Available features", "Dostępne elementy")}</h3><div id="widgetCatalog"></div><p id="dashboardEditorError" class="form-error" role="alert"></p>`;
    document.body.append(panel);
    g("widgetCatalog").after(g("organizerReset"));
    g("organizerSnap").value = draft.layout.dashboard_snap;
    g("organizerSnap").onchange = (e) => {
      draft.layout.dashboard_snap = e.target.value;
    };
    g("widgetInspector").oninput = (e) => {
      const key = e.target.dataset.placement,
        value = Number(e.target.value);
      if (!key || !Number.isFinite(value) || e.target.value === "") return;
      adjust(selectedId, {
        [key]:
          key === "x" || key === "w"
            ? round((value / 100) * 12)
            : key === "y"
              ? round(value / 64)
              : key === "h"
                ? round((value + 12) / 64)
                : value,
      });
    };
    g("widgetStraighten").onclick = () => adjust(selectedId, { tilt: 0 });
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
      update(true);
    };
    if (report) update(true);
    window.scrollTo({ top: 0, behavior: "instant" });
  }
  function init() {
    const settings = document.createElement("button");
    settings.id = "customizeDashboardBtn";
    settings.className = "btn miy-launch";
    settings.type = "button";
    settings.innerHTML = KlyoCopy.html(
      '<span class="miy-wordmark">Make It Yours</span>',
    );
    settings.setAttribute("aria-label", "Make It Yours");
    settings.onclick = () => KlyoInterface.open();
    settings.hidden = true;
    g("personalSettings").prepend(settings);
    const b = settings.cloneNode(true);
    b.id = "customizeDashboardQuick";
    b.hidden = false;
    b.onclick = () => KlyoInterface.open();
    g("analyticsDashboard").querySelector(".analytics-heading").append(b);
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
