/* Whole-application layouts. Preferences change presentation, never access rights. */
const KlyoInterface = (() => {
  const P = KlyoPreferences,
    g = (id) => document.getElementById(id),
    h = (v) => KlyoDocumentTools.esc(v);
  const l = (en, pl) => (KlyoI18n.getLang() === "pl" ? pl : en);
  const titles = {
    classic: ["Classic", "Klasyczny"],
    explorer: ["Explorer", "Eksplorator"],
    notebook: ["Notebook", "Notatnik"],
    command: ["Command", "Centrum pracy"],
  };
  const descriptions = {
    classic: [
      "The familiar sidebar. Everything in its place.",
      "Znane menu boczne. Wszystko na swoim miejscu.",
    ],
    explorer: [
      "An icon rail and expandable work sections.",
      "Pasek ikon i rozwijane sekcje pracy.",
    ],
    notebook: [
      "A quiet document-style workspace with a page list.",
      "Spokojna przestrzeń z listą stron.",
    ],
    command: [
      "Top navigation. A wide, focused work surface.",
      "Menu u góry. Szeroki obszar roboczy.",
    ],
  };
  const groupNames = {
    sales: ["Sales", "Sprzedaż"],
    delivery: ["Delivery", "Realizacja"],
    work: ["Work & calendar", "Zadania i terminy"],
    communication: ["Communication & files", "Komunikacja i pliki"],
    workspace: ["Workspace", "Przestrzeń"],
  };
  const actionNames = {
    new_deal: ["New deal", "Nowy deal"],
    new_contact: ["New contact", "Nowy kontakt"],
    new_quote: ["New quote", "Nowa oferta"],
    new_task: ["New task", "Nowe zadanie"],
    new_company: ["New company", "Nowa firma"],
    integrations: ["Integrations", "Integracje"],
    calendar: ["Calendar", "Kalendarz"],
  };
  const partNames = {
    heading: ["Page heading", "Nagłówek strony"],
    summary: ["Summary", "Podsumowanie"],
    toolbar: ["Search & actions", "Wyszukiwanie i akcje"],
    records: ["Main work area", "Główny obszar pracy"],
    insights: ["Insights", "Statystyki"],
    invites: ["Invitations", "Zaproszenia"],
    connections: ["Connections", "Połączenia"],
    cloud: ["Cloud files", "Pliki w chmurze"],
    pipelines: ["Sales pipelines", "Lejki sprzedaży"],
    tabs: ["Result tabs", "Zakładki wyników"],
    saved: ["Saved views", "Zapisane widoki"],
  };
  let editing = false,
    draft = null,
    applied = null,
    initialized = false,
    selectedGroup = "sales",
    dragged = null,
    observer,
    timer,
    returnFocus = null,
    history = [],
    future = [],
    canvasCancel = null;
  const navName = (key) => {
    const name = KlyoI18n.t("nav." + key);
    return name === "nav." + key
      ? {
          commercial: l("Commercial register", "Rejestr handlowy"),
          rfq: l("RFQ register", "Rejestr zapytań"),
          equipment: l("Equipment", "Wyposażenie"),
        }[key] || key
      : name;
  };
  const name = (k) => l(...(titles[k] || titles.classic));
  const button = (text, attrs = "", cls = "btn btn-ghost btn-sm") =>
    `<button ${/\btype=/.test(attrs) ? "" : 'type="button"'} class="${cls}" ${attrs}>${h(text)}</button>`;
  function presetCards() {
    return Object.keys(P.INTERFACES)
      .map(
        (key) =>
          `<button type="button" class="miy-layout-card" data-interface-preset="${key}" aria-pressed="${(draft || KlyoCustomize.getSaved()).layout.ui.preset === key}"><span class="miy-layout-mini" data-mini="${key}"><i></i><b></b><em></em><small></small></span><strong>${h(name(key))}</strong><span>${h(l(...descriptions[key]))}</span></button>`,
      )
      .join("");
  }
  function init() {
    initialized = true;
    const calendarBoard = document.createElement("div");
    calendarBoard.id = "calendarBoardBlock";
    g("calendarDayHeader").before(calendarBoard);
    calendarBoard.append(g("calendarDayHeader"), g("calendarGrid"));
    const advanced = document.createElement("details");
    advanced.id = "miyAdvancedSettings";
    const summary = document.createElement("summary");
    summary.textContent = l(
      "Advanced display settings · columns & summaries",
      "Zaawansowane ustawienia widoku · kolumny i podsumowania",
    );
    advanced.append(summary);
    const layoutControls = g("layoutControls"),
      hint = layoutControls.nextElementSibling,
      lists = g("personalSettings").querySelector(".preference-lists");
    layoutControls.before(advanced);
    advanced.append(layoutControls, hint, lists);
    g("personalSettings").insertAdjacentHTML(
      "afterbegin",
      `<section id="interfaceSettingsIntro" class="miy-settings-intro"><div><span class="miy-eyebrow">${l("THE WHOLE WORKSPACE", "CAŁA TWOJA PRZESTRZEŃ")}</span><h3 class="miy-wordmark">Make It Yours</h3><p>${l("Start with a layout, then shape every working page. Your colleagues keep their own view.", "Zacznij od układu i dostosuj strony robocze. Współpracownicy zachowają własny widok.")}</p></div><div class="miy-layout-presets">${presetCards()}</div><div class="miy-settings-actions">${button(l("Create my own layout", "Stwórz własny układ"), 'id="createInterfaceLayout"', "btn btn-primary")}${button(l("Edit overview widgets", "Edytuj elementy podsumowania"), 'id="editOverviewWidgets"')}</div></section>`,
    );
    g("createInterfaceLayout").onclick = () => open();
    g("editOverviewWidgets").onclick = () => {
      closeAppearanceModal();
      open();
      switchView("overview");
    };
    g("interfaceSettingsIntro").addEventListener("click", (e) => {
      const card = e.target.closest("[data-interface-preset]");
      if (card) open(card.dataset.interfacePreset);
    });
    const tools = document.createElement("div");
    tools.id = "miyShellTools";
    tools.innerHTML = `<button type="button" id="miyModuleDirectory" class="miy-shell-button" aria-haspopup="dialog"></button><button type="button" id="miyEditInterface" class="miy-shell-button miy-wordmark" aria-label="Make It Yours">Make It Yours</button>`;
    document.querySelector(".topbar").append(tools);
    g("miyModuleDirectory").onclick = directory;
    g("miyEditInterface").onclick = () => open();
    document.addEventListener(
      "click",
      (e) => {
        if (!editing) return;
        const safe = e.target.closest(
          "#interfaceEditor,.miy-page-part,.dashboard-widget,.miy-drop-zone,.miy-region-grip,.miy-region-zone,.sidebar,.miy-layout-strip",
        );
        if (safe) return;
        if (e.target.closest(".shell,.overlay")) {
          e.preventDefault();
          e.stopImmediatePropagation();
        }
      },
      true,
    );
    document.addEventListener(
      "keydown",
      (e) => {
        if (
          editing &&
          e.key === "Escape" &&
          !e.target.closest(".doc-overlay")
        ) {
          e.preventDefault();
          e.stopImmediatePropagation();
          cancel();
        }
      },
      true,
    );
    window.addEventListener("klyo:view", () => {
      setTimeout(() => {
        selectedGroup =
          applied?.ui.module_groups[document.body.dataset.view] ||
          selectedGroup;
        railUpdate();
        applyCurrentPage();
        if (editing) renderPageControls();
      }, 0);
    });
    window.addEventListener("klyo:language", () => {
      apply(KlyoCustomize.getSaved().layout);
      if (editing) render();
      refreshIntro();
    });
    observer = new MutationObserver((records) => {
      if (
        records.some((r) =>
          r.target.matches?.('.content > section,.content > div[id$="View"]'),
        )
      ) {
        clearTimeout(timer);
        timer = setTimeout(() => {
          applyCurrentPage();
          if (editing) renderPageControls();
        }, 60);
      }
    });
    observer.observe(document.querySelector(".content"), {
      childList: true,
      subtree: true,
    });
    apply(KlyoCustomize.getSaved().layout);
  }
  function refreshIntro() {
    if (g("interfaceSettingsIntro"))
      g("interfaceSettingsIntro").querySelector(
        ".miy-layout-presets",
      ).innerHTML = presetCards();
  }
  function apply(layout) {
    applied = P.clone(layout);
    const ui = layout.ui || P.interfaceDefaults(),
      base = ui.preset === "custom" ? ui.base : ui.preset;
    document.body.dataset.interface = base;
    document.body.dataset.interfacePreset = ui.preset;
    document.body.dataset.iconStyle = ui.icon_style;
    document.body.dataset.interfaceFont = ui.font;
    document.body.dataset.headerPosition = ui.header_position;
    document.body.dataset.toolbarAlign = ui.toolbar_align;
    document.body.style.setProperty("--miy-corners", ui.corners + "px");
    document.body.style.setProperty(
      "--miy-work-width",
      ui.content_width ? ui.content_width + "px" : "none",
    );
    if (!initialized) return;
    g("miyModuleDirectory").textContent = l("All tools", "Wszystkie narzędzia");
    g("miyModuleDirectory").title = l(
      "Open any tool, including hidden modules",
      "Otwórz narzędzie, także ukryte w menu",
    );
    document
      .querySelectorAll(".personal-nav .nav-item[data-view]")
      .forEach((node) => {
        if (!node.querySelector(".miy-letter")) {
          const mark = document.createElement("i");
          mark.className = "miy-letter";
          mark.setAttribute("aria-hidden", "true");
          node.prepend(mark);
        }
        node.querySelector(".miy-letter").textContent = navName(
          node.dataset.view,
        )
          .slice(0, 2)
          .toUpperCase();
      });
    rail(layout);
    quick(layout);
    applyCurrentPage();
    refreshIntro();
  }
  function rail(layout) {
    let rail = g("miyNavigationRail");
    if (!rail) {
      rail = document.createElement("div");
      rail.id = "miyNavigationRail";
      rail.setAttribute("role", "group");
      document.querySelector(".sidebar .nav").before(rail);
    }
    rail.setAttribute("aria-label", l("Work sections", "Sekcje pracy"));
    const groups = layout.ui.section_order.filter((key) =>
      layout.nav_order.some(
        (id) =>
          layout.ui.module_groups[id] === key &&
          !layout.hidden_nav.includes(id) &&
          !(id === "team" && API.scope() === "personal"),
      ),
    );
    const currentGroup = layout.ui.module_groups[document.body.dataset.view];
    if (!groups.includes(selectedGroup))
      selectedGroup = currentGroup || groups[0];
    const paths = {
      sales: "M4 18V9h4v9m4 0V4h4v14m4 0V12",
      delivery: "M3 7h18v14H3z M3 7l3-4h5l3 4",
      work: "M4 5h16v16H4z M4 10h16 M8 3v4 M16 3v4",
      communication: "M3 5h18v14H3z M3 5l9 7 9-7",
      workspace: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
    };
    rail.innerHTML = groups
      .map(
        (key) =>
          `<button type="button" data-rail-section="${key}" title="${h(layout.ui.section_names[key] || l(...groupNames[key]))}" aria-label="${h(layout.ui.section_names[key] || l(...groupNames[key]))}" aria-pressed="${selectedGroup === key}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="${paths[key]}"/></svg><span>${h(layout.ui.section_names[key] || l(...groupNames[key]))}</span></button>`,
      )
      .join("");
    rail.querySelectorAll("button").forEach(
      (b) =>
        (b.onclick = () => {
          selectedGroup = b.dataset.railSection;
          const d = document.querySelector(
            `.personal-nav [data-section="${selectedGroup}"]`,
          );
          if (d) d.open = true;
          railUpdate();
        }),
    );
    railUpdate();
  }
  function railUpdate() {
    document
      .querySelectorAll(".personal-nav details")
      .forEach((d) =>
        d.classList.toggle(
          "miy-other-section",
          d.dataset.section !== selectedGroup,
        ),
      );
    g("miyNavigationRail")
      ?.querySelectorAll("[data-rail-section]")
      .forEach((b) =>
        b.setAttribute(
          "aria-pressed",
          String(b.dataset.railSection === selectedGroup),
        ),
      );
  }
  function quick(layout) {
    let bar = g("miyQuickActions");
    if (!bar) {
      bar = document.createElement("div");
      bar.id = "miyQuickActions";
      bar.setAttribute("role", "group");
    }
    bar.setAttribute("aria-label", l("My shortcuts", "Moje skróty"));
    bar.dataset.position = layout.ui.quick_position;
    const destination =
      layout.ui.quick_position === "workspace"
        ? document.querySelector(".content")
        : layout.ui.quick_position === "rail"
          ? document.querySelector(".sidebar-foot")
          : document.querySelector(".topbar");
    if (bar.parentNode !== destination) destination.prepend(bar);
    bar.hidden = !layout.ui.quick_actions.length;
    bar.innerHTML = layout.ui.quick_actions
      .map((key) =>
        button(
          l(...actionNames[key]),
          `data-quick-action="${key}" ${API.getUser()?.role === "viewer" && key.startsWith("new_") ? "disabled" : ""}`,
        ),
      )
      .join("");
    bar
      .querySelectorAll("[data-quick-action]")
      .forEach((b) => (b.onclick = () => act(b.dataset.quickAction)));
  }
  async function act(key) {
    try {
      if (editing) return;
      const action = {
        new_deal: () => {
          switchView("deals");
          g("addDealBtn").click();
        },
        new_contact: () => {
          switchView("pipeline");
          g("addContactBtn").click();
        },
        new_quote: () => {
          switchView("quotes");
          g("addQuoteBtn").click();
        },
        new_task: () => {
          switchView("tasks");
          g("opNewTask").click();
        },
        new_company: () => {
          switchView("companies");
          g("addCompanyBtn").click();
        },
        calendar: () => switchView("calendar"),
        integrations: () => KlyoIntegrations.open(),
      };
      await action[key]?.();
    } catch (e) {
      toast(e.message, "error");
    }
  }
  function parts(view = document.body.dataset.view) {
    const root = pageRoot(view);
    if (!root) return [];
    return Object.entries(P.PAGE_PARTS[view] || {})
      .map(([id, selector]) => ({
        id,
        node: [...root.children].find((n) => n.matches(selector)),
      }))
      .filter((x) => x.node);
  }
  function dashboardChanged(widgets, mobile, snap) {
    change(p => {
      p.layout.dashboard = widgets;
      p.layout.ui.mobile = mobile;
      p.layout.dashboard_snap = snap;
    });
  }
  function applyCurrentPage() {
    if (!applied) return;
    const view = document.body.dataset.view,
      root = pageRoot(view);
    if (editing) KlyoDashboard.embed(draft, dashboardChanged);
    if (!root) return;
    const config = applied.ui.pages[view],
      items = parts(view);
    // CSS ordering preserves all record nodes and their existing handlers.
    root.classList.toggle("miy-page-arranged", Boolean(config));
    root.classList.toggle(
      "miy-page-organizing",
      editing && Boolean(items.length),
    );
    for (const [index, item] of items.entries()) {
      item.node.classList.toggle(
        "miy-panel-hidden",
        Boolean(config?.hidden.includes(item.id)),
      );
      item.node.classList.add("miy-page-part");
      item.node.dataset.miyPart = item.id;
      item.node.style.setProperty(
        "--miy-part-order",
        config ? config.order.indexOf(item.id) : index,
      );
      item.node.style.setProperty(
        "--miy-part-span",
        config?.spans[item.id] || 12,
      );
      let tools = item.node.querySelector(":scope > .miy-part-tools");
      if (editing && !tools) {
        tools = document.createElement("div");
        tools.className = "miy-part-tools";
        tools.innerHTML = `<button type="button" draggable="true" data-part-grip="${item.id}" aria-label="${h(l("Drag panel", "Przeciągnij panel"))}">⠿ ${h(l(...partNames[item.id]))}</button>${button("↑", `data-part-move="${item.id}" data-step="-1" aria-label="${h(l("Move up", "Przesuń w górę"))}"`)}${button("↓", `data-part-move="${item.id}" data-step="1" aria-label="${h(l("Move down", "Przesuń w dół"))}"`)}${button("↔︎", `data-part-size="${item.id}" aria-label="${h(l("Toggle half or full width", "Zmień szerokość panelu"))}"`)}${item.id !== "records" ? button("×", `data-part-hide="${item.id}" aria-label="${h(l("Hide panel", "Ukryj panel"))}"`) : ""}`;
        item.node.prepend(tools);
        tools.onclick = (e) => {
          const b = e.target.closest("button");
          if (!b) return;
          change((p) => {
            const c = pageConfig(p, view);
            if (b.dataset.partMove)
              move(c.order, b.dataset.partMove, Number(b.dataset.step));
            if (b.dataset.partSize)
              c.spans[item.id] = c.spans[item.id] === 6 ? 12 : 6;
            if (b.dataset.partHide) c.hidden.push(item.id);
          });
        };
        tools.addEventListener("dragstart", (e) => {
          if (e.target.dataset.partGrip) {
            dragged = { kind: "part", key: item.id };
            e.dataTransfer.setData("text/plain", item.id);
          }
        });
        item.node.addEventListener("dragover", (e) => {
          if (editing && dragged?.kind === "part") e.preventDefault();
        });
        item.node.addEventListener("drop", (e) => {
          if (!editing || dragged?.kind !== "part") return;
          e.preventDefault();
          const id = dragged.key;
          change((p) => reorder(pageConfig(p, view).order, id, item.id));
          dragged = null;
        });
      }
      if (!editing) tools?.remove();
      item.node.onpointerdown = editing ? e=>startPanelGesture(e,item,view) : null;
      let resize=item.node.querySelector(":scope > .miy-panel-resize");
      if(editing && !resize){resize=document.createElement("button");resize.type="button";resize.className="miy-panel-resize";resize.setAttribute("aria-label",l("Resize panel","Zmień rozmiar panelu"));resize.textContent="◢";item.node.append(resize);}
      if(resize)resize.onpointerdown=e=>startPanelGesture(e,item,view,"resize");
      if(!editing)resize?.remove();
    }
    const mobile = applied.ui.mobile.pages[view];
    root.classList.toggle('miy-mobile-arranged', Boolean(mobile));
    for (const {id, node} of items) {
      node.style.setProperty('--miy-mobile-order', (mobile?.order || config?.order || items.map(x=>x.id)).indexOf(id));
      node.style.setProperty('--miy-mobile-height', mobile?.heights[id] ? mobile.heights[id] + 'px' : 'auto');
    }
    positionPanels(root,config,items);
  }
  function pageConfig(p, view) {
    return (p.layout.ui.pages[view] ||= {
      order: Object.keys(P.PAGE_PARTS[view]),
      hidden: [],
      spans: Object.fromEntries(
        Object.keys(P.PAGE_PARTS[view]).map((k) => [k, 12]),
      ),
    });
  }
  function move(list, key, step) {
    const from = list.indexOf(key),
      to = from + step;
    if (from < 0 || to < 0 || to >= list.length) return;
    list.splice(from, 1);
    list.splice(to, 0, key);
  }
  function reorder(list, key, before) {
    if (key === before) return;
    const from = list.indexOf(key);
    if (from < 0) return;
    list.splice(from, 1);
    list.splice(list.indexOf(before), 0, key);
  }
  function change(fn) {
    history.push(P.clone(draft));
    if (history.length > 40) history.shift();
    future = [];
    fn(draft);
    draft.layout.ui.preset = "custom";
    preview();
    renderDynamic();
  }
  function preview() {
    draft = P.normalize(draft, true);
    KlyoCustomize.preview(draft);
    if (editing) KlyoDashboard.embed(draft, dashboardChanged);
  }
  function open(preset) {
    if (KlyoDashboard.isEditing() && !editing) {
      toast(
        l(
          "Finish editing your overview first.",
          "Najpierw zakończ edycję podsumowania.",
        ),
        "error",
      );
      return;
    }
    if (editing) return;
    returnFocus = document.activeElement;
    // Preserve palette changes already previewed in Settings when entering the editor.
    draft = g("appearanceModalOverlay").classList.contains("hidden")
      ? KlyoCustomize.getSaved()
      : KlyoCustomize.getDraft();
    if (preset) draft = P.useInterface(draft, preset);
    g("appearanceModalOverlay").classList.add("hidden");
    editing = true;
    document.body.dataset.mobileNav = 'closed';
    history = [];
    future = [];
    document.body.classList.add("interface-editing");
    const dock = document.createElement("aside");
    dock.id = "interfaceEditor";
    dock.setAttribute("aria-label", "Make It Yours");
    dock.dataset.collapsed = String(matchMedia('(max-width:980px)').matches);
    document.body.append(dock);
    KlyoDashboard.embed(draft, dashboardChanged);
    render();
    preview();
    regionTools();
    g("interfaceEditor").querySelector('[data-editor-tab="page"]').click();
    g(matchMedia("(max-width:980px)").matches ? "miyMobileToggle" : "miyCancel").focus({preventScroll:true});
  }
  function render() {
    g("interfaceEditor").innerHTML =
      `<header><div><span class="miy-eyebrow">${l("WORKSPACE DESIGNER", "EDYTOR PRZESTRZENI")}</span><h2 class="miy-wordmark">Make It Yours</h2></div>${button(l("Controls", "Opcje"), 'id="miyMobileToggle" aria-expanded="false"', 'btn btn-ghost btn-sm')}${button("×", `id="miyCancel" aria-label="${h(l("Cancel editing", "Anuluj edycję"))}"`)}</header><p class="miy-editor-note">${l("Arrange the actual app. Outlined regions are editable; record editing is paused.", "Układasz prawdziwą aplikację. Obramowane obszary możesz zmieniać; edycja danych jest wstrzymana.")}</p><nav class="miy-editor-tabs" aria-label="${l("Editor sections", "Sekcje edytora")}">${[
        ["structure", "Layout", "Układ"],
        ["modules", "Tools", "Narzędzia"],
        ["page", "This page", "Ta strona"],
        ["shortcuts", "Shortcuts", "Skróty"],
      ]
        .map(([id, en, pl], i) =>
          button(
            l(en, pl),
            `data-editor-tab="${id}" aria-pressed="${i === 0}"`,
          ),
        )
        .join(
          "",
        )}</nav><div class="miy-editor-scroll"><section data-editor-panel="structure"><h3>${l("Start with a layout", "Zacznij od układu")}</h3><div class="miy-layout-presets">${presetCards()}</div><div id="miyStructureControls"></div><div class="miy-saved-layouts"><h3>${l("My saved layouts", "Moje zapisane układy")}</h3><div id="miySavedList"></div><form id="miySaveNamed"><label>${l("Layout name", "Nazwa układu")}<input name="name" required maxlength="48" placeholder="${l("My sales desk", "Moje biurko sprzedaży")}"></label>${button(l("Save as my layout", "Zapisz jako mój układ"), 'type="submit" id="miySaveNamedBtn"')}</form></div></section><section data-editor-panel="modules" hidden><h3>${l("Choose your tools", "Wybierz narzędzia")}</h3><p>${l("Hide tools without deleting data. Drag within a section or choose another section.", "Ukrywaj narzędzia bez usuwania danych. Przeciągaj pozycje lub wybierz dla nich inną sekcję.")}</p><input id="miyModuleSearch" type="search" placeholder="${l("Find a tool", "Znajdź narzędzie")}"><div id="miyModules"></div>${button(l("Show all tools", "Pokaż wszystkie narzędzia"), 'id="miyShowAll"')}</section><section data-editor-panel="page" hidden><label>${l("Page to arrange", "Strona do ułożenia")}<select id="miyPageSelect">${P.NAV.filter(
        (k) => !(API.scope() === "personal" && k === "team"),
      )
        .map(
          (k) =>
            `<option value="${k}" ${k === document.body.dataset.view ? "selected" : ""}>${h(navName(k))}</option>`,
        )
        .join(
          "",
        )}</select></label><div id="miyPageControls"></div></section><section data-editor-panel="shortcuts" hidden><h3>${l("Actions where you need them", "Akcje pod ręką")}</h3><p>${l("Drag a shortcut into a highlighted zone, or select its position below.", "Przeciągnij skrót do podświetlonego obszaru lub wybierz położenie poniżej.")}</p><div id="miyShortcutControls"></div><div id="miyShortcutShelf"></div></section></div><div id="miyEditorError" role="alert"></div><footer>${button("↶", `id="miyUndo" aria-label="${l("Undo", "Cofnij")}"`)}${button("↷", `id="miyRedo" aria-label="${l("Redo", "Ponów")}"`)}${button(l("Reset", "Przywróć"), 'id="miyReset"')}${button(l("Cancel", "Anuluj"), 'id="miyCancelBottom"')}${button(l("Save layout", "Zapisz układ"), 'id="miySave"', "btn btn-primary")}</footer>`;
    g("miyMobileToggle").onclick = () => {
      const dock = g('interfaceEditor'), collapsed = dock.dataset.collapsed !== 'true';
      dock.dataset.collapsed = String(collapsed);
      g('miyMobileToggle').setAttribute('aria-expanded', String(!collapsed));
      g('miyMobileToggle').textContent = collapsed ? l('Controls', 'Opcje') : l('Back to canvas', 'Wróć do układu');
    };
    g("miyCancel").onclick = g("miyCancelBottom").onclick = cancel;
    g("miySave").onclick = save;
    g("miyUndo").onclick = () => {
      if (history.length) {
        future.push(draft);
        draft = history.pop();
        preview();
        renderDynamic();
      }
    };
    g("miyRedo").onclick = () => {
      if (future.length) {
        history.push(draft);
        draft = future.pop();
        preview();
        renderDynamic();
      }
    };
    g("miyReset").onclick = () =>
      change((p) => {
        const next = P.useInterface(p, "classic");
        next.layout.ui = { ...P.interfaceDefaults(), saved: p.layout.ui.saved };
        Object.assign(p.layout, next.layout);
      });
    g("interfaceEditor")
      .querySelectorAll("[data-editor-tab]")
      .forEach(
        (b) =>
          (b.onclick = () => {
            g("interfaceEditor")
              .querySelectorAll("[data-editor-tab]")
              .forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
            g("interfaceEditor")
              .querySelectorAll("[data-editor-panel]")
              .forEach(
                (x) =>
                  (x.hidden = x.dataset.editorPanel !== b.dataset.editorTab),
              );
            if (b.dataset.editorTab === "page") renderPageControls();
          }),
      );
    g("interfaceEditor")
      .querySelectorAll("[data-interface-preset]")
      .forEach(
        (b) =>
          (b.onclick = () => {
            history.push(P.clone(draft));
            future = [];
            draft = P.useInterface(draft, b.dataset.interfacePreset);
            preview();
            renderDynamic();
          }),
      );
    g("miySaveNamed").onsubmit = (e) => {
      e.preventDefault();
      if (draft.layout.ui.saved.length >= 6) {
        error(
          l(
            "You can save six layouts. Remove one first.",
            "Możesz zapisać sześć układów. Najpierw usuń jeden.",
          ),
        );
        return;
      }
      const title = e.target.elements.name.value.trim();
      if (!title) return;
      change((p) => {
        const configuration = P.clone(p.layout);
        delete configuration.dashboard;
        configuration.ui.saved = [];
        p.layout.ui.saved.push({
          id: "layout-" + crypto.randomUUID(),
          name: title,
          configuration,
        });
      });
      e.target.reset();
    };
    g("miyShowAll").onclick = () => change((p) => (p.layout.hidden_nav = []));
    g("miyModuleSearch").oninput = filterModules;
    g("miyPageSelect").onchange = (e) => {
      switchView(e.target.value);
      renderPageControls();
      if (matchMedia('(max-width:980px)').matches && g('interfaceEditor').dataset.collapsed !== 'true') g('miyMobileToggle').click();
    };
    renderDynamic();
    dropZones();
  }
  const select = (key, title, values, current) =>
    `<label>${h(title)}<select data-interface-control="${key}">${values.map(([v, en, pl]) => `<option value="${v}" ${String(current) === String(v) ? "selected" : ""}>${h(l(en, pl || en))}</option>`).join("")}</select></label>`;
  function renderDynamic() {
    const focused = document.activeElement;
    const focusKey = focused?.closest("#interfaceEditor")
      ? [...focused.attributes].find(
          (a) => a.name.startsWith("data-") && a.name !== "data-ui-copy",
        )
      : null;
    const ui = draft.layout.ui;
    g("miyStructureControls").innerHTML =
      select(
        "sidebar",
        l("Navigation position", "Położenie menu"),
        [
          ["left", "Left", "Po lewej"],
          ["right", "Right", "Po prawej"],
          ["top", "Top", "U góry"],
        ],
        draft.layout.sidebar,
      ) +
      select(
        "nav_mode",
        l("Navigation structure", "Struktura menu"),
        [
          ["grouped", "Expandable sections", "Rozwijane sekcje"],
          ["list", "Page list", "Lista stron"],
          ["tiles", "Two-column tiles", "Kafelki w dwóch kolumnach"],
        ],
        draft.layout.nav_mode,
      ) +
      `<label>${l("Navigation width", "Szerokość menu")} <output>${draft.layout.sidebar_width}px</output><input type="range" min="208" max="360" step="4" value="${draft.layout.sidebar_width}" data-interface-control="sidebar_width"></label>` +
      select(
        "icon_style",
        l("Icon style", "Styl ikon"),
        [
          ["line", "Outline", "Konturowe"],
          ["duotone", "Color tiles", "Kolorowe kafelki"],
          ["letters", "Initials", "Inicjały"],
          ["solid", "Bold", "Wyraziste"],
        ],
        ui.icon_style,
      ) +
      select(
        "font",
        l("Typography", "Typografia"),
        [
          ["inter", "Inter"],
          ["grotesk", "Space Grotesk"],
          ["mono", "JetBrains Mono"],
        ],
        ui.font,
      ) +
      select(
        "density",
        l("Density", "Gęstość"),
        [
          ["compact", "Compact", "Kompaktowa"],
          ["standard", "Standard", "Standardowa"],
          ["comfortable", "Comfortable", "Przestronna"],
        ],
        draft.layout.density,
      ) +
      select(
        "header_position",
        l("Page actions", "Akcje strony"),
        [
          ["top", "Top", "U góry"],
          ["bottom", "Bottom", "Na dole"],
        ],
        ui.header_position,
      ) +
      select(
        "toolbar_align",
        l("Action alignment", "Wyrównanie akcji"),
        [
          ["right", "Right", "Do prawej"],
          ["left", "Left", "Do lewej"],
        ],
        ui.toolbar_align,
      ) +
      select(
        "start_view",
        l("Start page", "Strona początkowa"),
        P.NAV.map((k) => [k, navName(k)]),
        draft.layout.start_view,
      ) +
      `<label>${l("Panel corners", "Zaokrąglenie paneli")} <output>${ui.corners}px</output><input type="range" min="0" max="20" value="${ui.corners}" data-interface-control="corners"></label>` +
      select(
        "content_width",
        l("Work surface width", "Szerokość obszaru pracy"),
        [
          [0, "Fill screen", "Cały ekran"],
          [960, "960 px"],
          [1200, "1200 px"],
          [1440, "1440 px"],
          [1800, "1800 px"],
        ],
        ui.content_width,
      ) +
      `<label class="miy-check"><input type="checkbox" data-interface-control="collapsed" ${draft.layout.collapsed ? "checked" : ""}>${l("Icons-only navigation", "Menu z samymi ikonami")}</label><p>${l("Colors and contact columns remain available in Settings → Make It Yours.", "Kolory i kolumny kontaktów nadal zmienisz w Ustawienia → Make It Yours.")}</p>`;
    bindControls(g("miyStructureControls"));
    renderModules();
    renderPageControls();
    g("miyShortcutControls").innerHTML = select(
      "quick_position",
      l("Shortcut position", "Położenie skrótów"),
      [
        ["header", "Page header", "Nagłówek strony"],
        ["workspace", "Above the work area", "Nad obszarem pracy"],
        ["rail", "Navigation footer", "Stopka menu"],
      ],
      ui.quick_position,
    );
    bindControls(g("miyShortcutControls"));
    g("miyShortcutShelf").innerHTML = P.ACTIONS.map(
      (key) =>
        `<label class="miy-shortcut-card" draggable="true" data-shortcut-drag="${key}"><input type="checkbox" data-shortcut="${key}" ${ui.quick_actions.includes(key) ? "checked" : ""}>＋ ${h(l(...actionNames[key]))}</label>`,
    ).join("");
    g("miyShortcutShelf").onchange = (e) => {
      const key = e.target.dataset.shortcut;
      if (key)
        change(
          (p) =>
            (p.layout.ui.quick_actions = e.target.checked
              ? [...p.layout.ui.quick_actions, key]
              : p.layout.ui.quick_actions.filter((x) => x !== key)),
        );
    };
    g("miyShortcutShelf").onpointerdown = (e) => {
      const card=e.target.closest("[data-shortcut-drag]");
      if(card && !e.target.matches("input")) startShortcutGesture(e,card);
    };
    g("miyShortcutShelf").ondragstart = (e) => {
      const item = e.target.closest("[data-shortcut-drag]");
      if (item) {
        dragged = { kind: "shortcut", key: item.dataset.shortcutDrag };
        e.dataTransfer.setData("text/plain", item.dataset.shortcutDrag);
      }
    };
    g("miySavedList").innerHTML = ui.saved.length
      ? ui.saved
          .map(
            (item) =>
              `<div class="miy-saved-row"><span>${h(item.name)}</span>${button(l("Load", "Wczytaj"), `data-load-layout="${item.id}"`)}${button("×", `data-delete-layout="${item.id}" aria-label="${h(l("Delete saved layout", "Usuń zapisany układ"))}"`)}</div>`,
          )
          .join("")
      : `<p>${l("Save this arrangement to reuse it later.", "Zapisz układ, aby użyć go ponownie.")}</p>`;
    g("miySavedList").onclick = (e) => {
      const b = e.target.closest("button");
      if (b?.dataset.deleteLayout)
        change(
          (p) =>
            (p.layout.ui.saved = p.layout.ui.saved.filter(
              (x) => x.id !== b.dataset.deleteLayout,
            )),
        );
      if (b?.dataset.loadLayout)
        change((p) => {
          const item = p.layout.ui.saved.find(
              (x) => x.id === b.dataset.loadLayout,
            ),
            saved = p.layout.ui.saved,
            dashboard = p.layout.dashboard;
          if (item) {
            p.layout = { ...P.clone(item.configuration), dashboard };
            p.layout.ui.saved = saved;
          }
        });
    };
    if (focusKey && !focused.isConnected) {
      const replacement = g("interfaceEditor").querySelector(
        `[${focusKey.name}="${CSS.escape(focusKey.value)}"]`,
      );
      replacement?.focus({ preventScroll: true });
    }
    g("miyUndo").disabled = !history.length;
    g("miyRedo").disabled = !future.length;
    g("interfaceEditor")
      .querySelectorAll("[data-interface-preset]")
      .forEach((b) =>
        b.setAttribute(
          "aria-pressed",
          String(b.dataset.interfacePreset === ui.preset),
        ),
      );
  }
  function bindControls(root) {
    const set = (key, value) => {
      if (
        [
          "sidebar",
          "nav_mode",
          "density",
          "start_view",
          "sidebar_width",
          "collapsed",
        ].includes(key)
      )
        draft.layout[key] = value;
      else draft.layout.ui[key] = value;
    };
    root.onchange = (e) => {
      const el = e.target,
        key = el.dataset.interfaceControl;
      if (!key) return;
      const value =
        el.type === "checkbox"
          ? el.checked
          : ["sidebar_width", "corners", "content_width"].includes(key)
            ? Number(el.value)
            : el.value;
      if (el.type === "range") {
        history.push(el._miyOriginal || P.clone(draft));
        future = [];
        set(key, value);
        draft.layout.ui.preset = "custom";
        preview();
        renderDynamic();
      } else change(() => set(key, value));
    };
    root.querySelectorAll("input[type=range]").forEach(
      (el) =>
        (el.oninput = (e) => {
          el._miyOriginal ||= P.clone(draft);
          const key = el.dataset.interfaceControl,
            value = Number(el.value);
          set(key, value);
          draft.layout.ui.preset = "custom";
          el.previousElementSibling.textContent = value + "px";
          // Pointer motion only updates CSS; persist/normalize once the gesture ends.
          document.body.style.setProperty(
            key === "sidebar_width" ? "--sidebar-width" : "--miy-corners",
            value + "px",
          );
        }),
    );
  }
  function renderModules() {
    g("miyModules").innerHTML = draft.layout.ui.section_order
      .map(
        (section, index) =>
          `<section class="miy-module-section" data-module-section="${section}"><header><input data-group-name="${section}" maxlength="40" aria-label="${l("Section name", "Nazwa sekcji")}" placeholder="${h(l(...groupNames[section]))}" value="${h(draft.layout.ui.section_names[section] || "")}">${button("↑", `data-group-move="${section}" data-step="-1" ${index === 0 ? "disabled" : ""}`)}${button("↓", `data-group-move="${section}" data-step="1" ${index === P.GROUPS.length - 1 ? "disabled" : ""}`)}</header>${draft.layout.nav_order
            .filter((k) => draft.layout.ui.module_groups[k] === section)
            .map(
              (key) =>
                `<div class="miy-module-row" draggable="true" data-module-key="${key}"><span aria-hidden="true">⠿</span><label><input type="checkbox" data-module-visible="${key}" ${draft.layout.hidden_nav.includes(key) ? "" : "checked"}>${h(navName(key))}</label><select data-module-group="${key}" aria-label="${h(l("Section for ", "Sekcja dla ") + navName(key))}">${P.GROUPS.map((k) => `<option value="${k}" ${k === section ? "selected" : ""}>${h(draft.layout.ui.section_names[k] || l(...groupNames[k]))}</option>`).join("")}</select>${button("↑", `data-module-move="${key}" data-step="-1" aria-label="${h(l("Move up", "W górę"))}"`)}${button("↓", `data-module-move="${key}" data-step="1" aria-label="${h(l("Move down", "W dół"))}"`)}</div>`,
            )
            .join("")}</section>`,
      )
      .join("");
    const root = g("miyModules");
    root.onchange = (e) => {
      const { moduleVisible, moduleGroup, groupName } = e.target.dataset;
      try {
        if (moduleVisible) {
          if (
            !e.target.checked &&
            draft.layout.hidden_nav.length === P.NAV.length - 1
          )
            throw new Error(
              l("Keep one tool visible.", "Zostaw jedno narzędzie widoczne."),
            );
          change(
            (p) =>
              (p.layout.hidden_nav = e.target.checked
                ? p.layout.hidden_nav.filter((x) => x !== moduleVisible)
                : [...p.layout.hidden_nav, moduleVisible]),
          );
        }
        if (moduleGroup)
          change(
            (p) => (p.layout.ui.module_groups[moduleGroup] = e.target.value),
          );
        if (groupName)
          change(
            (p) => (p.layout.ui.section_names[groupName] = e.target.value),
          );
      } catch (err) {
        error(err.message);
        renderModules();
      }
    };
    root.onclick = (e) => {
      const b = e.target.closest("button");
      if (b?.dataset.moduleMove)
        change((p) =>
          move(
            p.layout.nav_order,
            b.dataset.moduleMove,
            Number(b.dataset.step),
          ),
        );
      if (b?.dataset.groupMove)
        change((p) =>
          move(
            p.layout.ui.section_order,
            b.dataset.groupMove,
            Number(b.dataset.step),
          ),
        );
    };
    root.ondragstart = (e) => {
      const row = e.target.closest("[data-module-key]");
      if (row) {
        dragged = { kind: "module", key: row.dataset.moduleKey };
        e.dataTransfer.setData("text/plain", row.dataset.moduleKey);
      }
    };
    root.ondragover = (e) => {
      if (dragged?.kind === "module") e.preventDefault();
    };
    root.ondrop = (e) => {
      const section = e.target.closest("[data-module-section]"),
        row = e.target.closest("[data-module-key]");
      if (!section || dragged?.kind !== "module") return;
      e.preventDefault();
      const key = dragged.key;
      change((p) => {
        p.layout.ui.module_groups[key] = section.dataset.moduleSection;
        if (row) reorder(p.layout.nav_order, key, row.dataset.moduleKey);
      });
      dragged = null;
    };
    filterModules();
  }
  function filterModules() {
    const query = g("miyModuleSearch")?.value.toLowerCase() || "";
    g("miyModules")
      ?.querySelectorAll("[data-module-key]")
      .forEach(
        (row) =>
          (row.hidden = !navName(row.dataset.moduleKey)
            .toLowerCase()
            .includes(query)),
      );
  }
  function renderPageControls() {
    if (!editing || !g("miyPageControls")) return;
    const view = document.body.dataset.view;
    if (g("miyPageSelect")) g("miyPageSelect").value = view;
    if (view === "overview") {
      KlyoDashboard.controls(g("miyPageControls"));
      return;
    }
    const items = parts(view),
      config = draft.layout.ui.pages[view];
    g("miyPageControls").innerHTML =
      `<label>${l("Placement","Układanie")}<select id="miyPanelSnap"><option value="magnetic">${l("Magnetic guides","Prowadnice")}</option><option value="grid">${l("Grid","Siatka")}</option><option value="free">${l("Free placement","Bez siatki")}</option></select></label><p>${l("Drag outlined panels in the work area. Use half/full width, reorder or hide optional panels. The main records always remain accessible.", "Przeciągaj obramowane panele w obszarze pracy. Zmieniaj szerokość, kolejność i widoczność. Główna lista danych pozostaje dostępna.")}</p>` +
      items
        .map(
          ({ id }) =>
            `<div class="miy-page-row"><label><input type="checkbox" data-page-visible="${id}" ${config?.hidden.includes(id) ? "" : "checked"} ${id === "records" ? "disabled" : ""}>${h(l(...partNames[id]))}</label>${button("↑", `data-page-move="${id}" data-step="-1"`)}${button("↓", `data-page-move="${id}" data-step="1"`)}<select data-page-span="${id}" aria-label="${l("Panel width", "Szerokość panelu")}"><option value="12">${l("Full", "Cała")}</option><option value="6" ${config?.spans[id] === 6 ? "selected" : ""}>½</option></select></div>`,
        )
        .join("") +
      `${button(l("Restore this page", "Przywróć tę stronę"), 'id="miyResetPage"')}`;
    g("miyPageControls").onchange = (e) =>
      change((p) => {
        const c = pageConfig(p, view);
        if (e.target.dataset.pageVisible)
          c.hidden = e.target.checked
            ? c.hidden.filter((k) => k !== e.target.dataset.pageVisible)
            : [...c.hidden, e.target.dataset.pageVisible];
        if (e.target.dataset.pageSpan)
          c.spans[e.target.dataset.pageSpan] = Number(e.target.value);
      });
    g("miyPageControls").onclick = (e) => {
      const b = e.target.closest("button");
      if (b?.dataset.pageMove)
        change((p) =>
          move(
            (KlyoTouchLayout.isPhone() ? (p.layout.ui.mobile.pages[view] ||= {order:parts(view).map(x=>x.id), heights:{}}) : pageConfig(p, view)).order,
            b.dataset.pageMove,
            Number(b.dataset.step),
          ),
        );
    };
    g("miyPanelSnap").value=draft.layout.dashboard_snap;
    g("miyPanelSnap").onchange=e=>change(p=>p.layout.dashboard_snap=e.target.value);
    g("miyResetPage").onclick = () =>
      change((p) => {
        if (KlyoTouchLayout.isPhone()) delete p.layout.ui.mobile.pages[view];
        else delete p.layout.ui.pages[view];
      });
  }
  function dropZones() {
    document.querySelectorAll(".miy-drop-zone").forEach((n) => n.remove());
    for (const [position, selector] of [
      ["header", ".topbar"],
      ["workspace", ".content"],
      ["rail", ".sidebar-foot"],
    ]) {
      const zone = document.createElement("div");
      zone.className = "miy-drop-zone";
      zone.dataset.dropZone = position;
      zone.textContent = l("＋ Drop shortcuts here", "＋ Upuść skróty tutaj");
      document.querySelector(selector).prepend(zone);
      zone.ondragover = (e) => {
        if (dragged?.kind === "shortcut") {
          e.preventDefault();
          zone.classList.add("miy-drag-over");
        }
      };
      zone.ondragleave = () => zone.classList.remove("miy-drag-over");
      zone.ondrop = (e) => {
        if (dragged?.kind !== "shortcut") return;
        e.preventDefault();
        const key = dragged.key;
        change((p) => {
          p.layout.ui.quick_position = position;
          if (!p.layout.ui.quick_actions.includes(key))
            p.layout.ui.quick_actions.push(key);
        });
        dragged = null;
        zone.classList.remove("miy-drag-over");
      };
    }
  }
  function regionTools() {
    const sidebar = document.querySelector(".sidebar"),
      topbar = document.querySelector(".topbar");
    for (const [region, node] of [
      ["navigation", sidebar],
      ["header", topbar],
    ]) {
      const grip = document.createElement("button");
      grip.type = "button";
      grip.className = "miy-region-grip";
      grip.draggable = true;
      grip.dataset.region = region;
      grip.textContent =
        "⠿ " +
        l(
          region === "navigation" ? "Navigation" : "Page actions",
          region === "navigation" ? "Menu" : "Akcje strony",
        );
      grip.ondragstart = (e) => {
        dragged = { kind: "region", key: region };
        e.dataTransfer.setData("text/plain", region);
        document.body.dataset.regionDrag = region;
      };
      grip.ondragend = () => {
        delete document.body.dataset.regionDrag;
      };
      node.prepend(grip);
    }
    for (const [position, region, en, pl] of [
      ["left", "navigation", "Navigation · left", "Menu · po lewej"],
      ["right", "navigation", "Navigation · right", "Menu · po prawej"],
      ["top", "navigation", "Navigation · top", "Menu · u góry"],
      ["top", "header", "Actions · top", "Akcje · u góry"],
      ["bottom", "header", "Actions · bottom", "Akcje · na dole"],
    ]) {
      const zone = document.createElement("div");
      zone.className = "miy-region-zone";
      zone.dataset.regionTarget = region;
      zone.dataset.regionPosition = position;
      zone.textContent = l(en, pl);
      zone.ondragover = (e) => {
        if (dragged?.kind === "region" && dragged.key === region) {
          e.preventDefault();
          zone.classList.add("miy-drag-over");
        }
      };
      zone.ondragleave = () => zone.classList.remove("miy-drag-over");
      zone.ondrop = (e) => {
        if (dragged?.kind !== "region" || dragged.key !== region) return;
        e.preventDefault();
        change((p) => {
          if (region === "navigation") {
            p.layout.sidebar = position;
            p.layout.collapsed = false;
            if (position === "top") p.layout.ui.closed_sections = [...P.GROUPS];
          } else p.layout.ui.header_position = position;
        });
        dragged = null;
        delete document.body.dataset.regionDrag;
      };
      document.body.append(zone);
    }
    const resize = document.createElement("button");
    resize.type = "button";
    resize.className = "miy-nav-resize";
    resize.setAttribute(
      "aria-label",
      l(
        "Resize navigation. Arrow keys adjust width.",
        "Zmień szerokość menu. Użyj także strzałek.",
      ),
    );
    resize.textContent = "⋮";
    sidebar.append(resize);
    resize.onpointerdown = (e) => {
      if (draft.layout.sidebar === "top") return;
      e.preventDefault();
      const start = e.clientX,
        origin = draft.layout.sidebar_width,
        original = P.clone(draft);
      resize.setPointerCapture(e.pointerId);
      const move = (e) => {
        draft.layout.sidebar_width = Math.min(
          360,
          Math.max(
            208,
            Math.round(
              origin +
                (e.clientX - start) *
                  (draft.layout.sidebar === "right" ? -1 : 1),
            ),
          ),
        );
        draft.layout.ui.preset = "custom";
        document.body.style.setProperty(
          "--sidebar-width",
          draft.layout.sidebar_width + "px",
        );
      };
      resize.onpointermove = move;
      resize.onpointerup = resize.onpointercancel = () => {
        history.push(original);
        future = [];
        resize.onpointermove = null;
        preview();
        renderDynamic();
      };
    };
    resize.onkeydown = (e) => {
      if (["ArrowLeft", "ArrowRight"].includes(e.key)) {
        e.preventDefault();
        change(
          (p) =>
            (p.layout.sidebar_width = Math.min(
              360,
              Math.max(
                208,
                p.layout.sidebar_width + (e.key === "ArrowRight" ? 8 : -8),
              ),
            )),
        );
      }
    };
  }
  function pageRoot(view) { return g(view === "overview" ? "salesOverviewView" : view + "View"); }
  function positionPanels(root,config,items) {
    if(!root)return;
    const canvas=Boolean(config?.positions && Object.keys(config.positions).length);
    root.classList.toggle("miy-page-canvas",canvas);
    let bottom=0;
    const width=root.clientWidth;
    for(const {id,node} of items){
      const p=config?.positions?.[id];
      if(canvas && p && innerWidth>800){
        Object.assign(node.style,{position:"absolute",left:(p.x/12*100)+"%",top:p.y+"px",width:(p.w/12*100)+"%",height:p.h+"px"});
        if(!config.hidden.includes(id))bottom=Math.max(bottom,p.y+p.h);
      }else for(const k of ["position","left","top","width","height"])node.style.removeProperty(k);
    }
    root.style.minHeight=canvas && innerWidth>800?(bottom+32)+"px":"";
  }
  function panelGeometry(view) {
    const root=pageRoot(view),board=root.getBoundingClientRect(),width=root.clientWidth;
    const positions={};
    for(const {id,node} of parts(view)){
      if(node.classList.contains("miy-panel-hidden"))continue;
      const r=node.getBoundingClientRect();
      positions[id]={x:Math.max(0,(r.left-board.left)/width*12),y:Math.max(0,r.top-board.top),w:Math.min(12,Math.max(2,r.width/width*12)),h:Math.max(72,r.height)};
    }
    return positions;
  }
  function startPanelGesture(e,item,view,kind="move") {
    if(!editing || e.button!==0 || e.target.closest(".miy-part-tools button:not([data-part-grip])") || (kind==="move" && e.target.closest(".miy-panel-resize")))return;
    if (KlyoTouchLayout.isPhone()) {
      if (kind === 'move' && !e.target.closest('[data-part-grip]')) return;
      KlyoTouchLayout.start(e, {
        container:pageRoot(view), item:item.node, selector:':scope > .miy-page-part', key:'miyPart', resize:kind === 'resize',
        commit:({order, height}) => change(p => {
          const mobile = p.layout.ui.mobile.pages[view] ||= {order:parts(view).map(x=>x.id), heights:{}};
          if (order) mobile.order = [...order, ...mobile.order.filter(key=>!order.includes(key))];
          if (height) mobile.heights[item.id] = height;
        }),
      });
      return;
    }
    e.preventDefault();e.stopPropagation();
    const root=pageRoot(view),initial=panelGeometry(view),original=initial[item.id];
    if(!original)return;
    const board=root.getBoundingClientRect(),startX=e.clientX,startY=e.clientY,scroll=window.scrollY,
      controller=new AbortController(),handle=item.node;
    let preview=structuredClone(initial),last=e,frame;
    root.classList.add("miy-gesture-active");
    handle.classList.add("miy-panel-moving");
    const guide=document.createElement("div");guide.className="miy-canvas-guide";root.append(guide);
    const snap=(n,step,free)=>free?n:Math.round(n/step)*step;
    const tick=()=>{
      const free=draft.layout.dashboard_snap==="free"||last.altKey,strict=draft.layout.dashboard_snap==="grid";
      const dx=(last.clientX-startX)/root.clientWidth*12,dy=last.clientY-startY+window.scrollY-scroll;
      const p={...original};
      if(kind==="move") {p.x=Math.max(0,Math.min(12-p.w,snap(original.x+dx,strict?1:.125,free)));p.y=Math.max(0,snap(original.y+dy,strict?32:8,free));}
      else {p.w=Math.max(2,Math.min(12-p.x,snap(original.w+dx,strict?1:.125,free)));p.h=Math.max(72,Math.min(10000,snap(original.h+dy,strict?32:8,free)));}
      p.x=Math.round(p.x*100)/100;p.w=Math.round(p.w*100)/100;p.y=Math.min(20000,Math.round(p.y));p.h=Math.round(p.h);
      preview=structuredClone(initial);preview[item.id]=p;
      // Move neighboring panels out of the drop area; no inaccessible overlapping controls.
      const placed=[p];
      for(const [id,q] of Object.entries(preview)){
        if(id===item.id)continue;
        for(let i=0;i<50;i++){
          const overlaps=placed.filter(a=>q.x<a.x+a.w-.01 && q.x+q.w>a.x+.01 && q.y<a.y+a.h+12 && q.y+q.h+12>a.y);
          if(!overlaps.length)break;
          q.y=Math.max(...overlaps.map(a=>a.y+a.h+16));
        }
        placed.push(q);
      }
      positionPanels(root,{positions:preview,hidden:[]},parts(view));
      Object.assign(guide.style,{left:p.x/12*100+"%",top:p.y+"px",width:p.w/12*100+"%",height:p.h+"px"});
      if(last.clientY>innerHeight-65)window.scrollBy(0,9);else if(last.clientY<70)window.scrollBy(0,-9);
      frame=requestAnimationFrame(tick);
    };
    handle.setPointerCapture(e.pointerId);
    const finish=(cancel=false)=>{canvasCancel=null;cancelAnimationFrame(frame);controller.abort();guide.remove();root.classList.remove("miy-gesture-active");handle.classList.remove("miy-panel-moving");try{handle.releasePointerCapture(e.pointerId);}catch{}
      if(!cancel)change(p=>{const c=pageConfig(p,view);c.positions=preview;});else applyCurrentPage();
    };
    canvasCancel=()=>finish(true);
    window.addEventListener("pointermove",ev=>{if(ev.pointerId===e.pointerId)last=ev;},{signal:controller.signal});
    window.addEventListener("pointerup",ev=>{if(ev.pointerId===e.pointerId)finish();},{signal:controller.signal});
    window.addEventListener("pointercancel",()=>finish(true),{signal:controller.signal});
    window.addEventListener("keydown",ev=>{if(ev.key==="Escape"){ev.preventDefault();finish(true);}},{signal:controller.signal,capture:true});
    frame=requestAnimationFrame(tick);
  }
  function startShortcutGesture(e,card) {
    if(!editing || e.button!==0)return;
    e.preventDefault();
    const key=card.dataset.shortcutDrag,controller=new AbortController(),ghost=card.cloneNode(true);
    ghost.className="miy-drag-ghost";ghost.removeAttribute("draggable");ghost.querySelector("input")?.remove();document.body.append(ghost);
    document.body.dataset.shortcutDragging="true";
    let target=null;
    const update=ev=>{
      ghost.style.left=ev.clientX+14+"px";ghost.style.top=ev.clientY+14+"px";
      document.querySelectorAll(".miy-drop-zone").forEach(n=>n.classList.remove("miy-drag-over"));
      target=document.elementFromPoint(ev.clientX,ev.clientY)?.closest("[data-drop-zone]");
      target?.classList.add("miy-drag-over");
    };
    update(e);card.setPointerCapture(e.pointerId);
    const finish=cancel=>{controller.abort();ghost.remove();delete document.body.dataset.shortcutDragging;document.querySelectorAll(".miy-drop-zone").forEach(n=>n.classList.remove("miy-drag-over"));
      if(!cancel && target)change(p=>{p.layout.ui.quick_position=target.dataset.dropZone;if(!p.layout.ui.quick_actions.includes(key))p.layout.ui.quick_actions.push(key);});
    };
    window.addEventListener("pointermove",update,{signal:controller.signal});
    window.addEventListener("pointerup",()=>finish(false),{signal:controller.signal});
    window.addEventListener("pointercancel",()=>finish(true),{signal:controller.signal});
  }

  function finish() {
    KlyoTouchLayout.cancel();
    canvasCancel?.();
    editing = false;
    KlyoDashboard.unembed();
    document.body.classList.remove("interface-editing");
    g("interfaceEditor")?.remove();
    document
      .querySelectorAll(
        ".miy-drop-zone,.miy-part-tools,.miy-panel-resize,.miy-drag-ghost,.miy-canvas-guide,.miy-region-grip,.miy-region-zone,.miy-nav-resize",
      )
      .forEach((n) => n.remove());
    delete document.body.dataset.regionDrag;
    document
      .querySelectorAll(".miy-page-organizing")
      .forEach((n) => n.classList.remove("miy-page-organizing"));
    returnFocus?.focus?.();
  }
  function cancel() {
    finish();
    KlyoCustomize.preview(KlyoCustomize.getSaved());
  }
  async function save() {
    const b = g("miySave");
    b.disabled = true;
    error("");
    try {
      await KlyoCustomize.save(P.normalize(draft, true));
      finish();
      KlyoCustomize.preview(KlyoCustomize.getSaved());
      if (draft.layout.hidden_nav.includes(document.body.dataset.view))
        switchView(draft.layout.start_view);
      toast(
        l(
          "Your workspace layout has been saved.",
          "Zapisano Twój układ przestrzeni.",
        ),
      );
      return true;
    } catch (e) {
      error(e.message);
      return false;
    } finally {
      if (b.isConnected) b.disabled = false;
    }
  }
  function error(message) {
    if (g("miyEditorError")) g("miyEditorError").textContent = message;
  }
  function directory() {
    const d = KlyoDocumentTools.dialog(
      l("All tools", "Wszystkie narzędzia"),
      `<p>${l("Hidden tools remain available here. Hiding never removes records or grants access.", "Ukryte narzędzia znajdziesz tutaj. Ukrywanie nie usuwa danych ani nie zmienia uprawnień.")}</p><input id="miyDirectorySearch" type="search" placeholder="${l("Find a tool", "Znajdź narzędzie")}"><div class="miy-directory">${P.NAV.filter(
        (key) => !(key === "team" && API.scope() === "personal"),
      )
        .map((key) => button(navName(key), `data-open-module="${key}"`))
        .join(
          "",
        )}${button(l("Integrations", "Integracje"), "data-directory-integrations")}</div>`,
    );
    d.find("#miyDirectorySearch").oninput = (e) =>
      d.root
        .querySelectorAll("[data-open-module]")
        .forEach(
          (b) =>
            (b.hidden = !b.textContent
              .toLowerCase()
              .includes(e.target.value.toLowerCase())),
        );
    d.root.querySelectorAll("[data-open-module]").forEach(
      (b) =>
        (b.onclick = () => {
          d.close();
          switchView(b.dataset.openModule);
        }),
    );
    d.find("[data-directory-integrations]").onclick = () => {
      d.close();
      KlyoIntegrations.open();
    };
  }
  return { init, apply, open, isEditing: () => editing, cancel, navName };
})();
window.KlyoInterface = KlyoInterface;
