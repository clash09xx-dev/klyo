/* Account-specific appearance and layout. No workspace permissions live here. */
const KlyoCustomize = (() => {
  const P = KlyoPreferences,
    g = (id) => document.getElementById(id),
    esc = (value) =>
      String(value ?? "").replace(
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
  let saved = P.defaults(),
    draft = P.clone(saved),
    owner = false,
    userId = null,
    drag = null,
    initialized = false;
  const words = {
    en: {
      personal: "My workspace",
      account: "Account & organization",
      intro: "Your colors. Your workflow.",
      description:
        "Personalize your workspace without changing anything for teammates. Preview changes here, then save.",
      presets: "Color presets",
      custom: "Custom",
      colors: "Custom palette",
      background: "Background",
      surface: "Panels & tables",
      accent: "Accent",
      sidebar: "Navigation",
      text: "Text",
      automatic: "Automatic text contrast",
      manual: "Choose text color",
      contrast: "Stronger borders & contrast",
      density: "Density",
      compact: "Compact",
      standard: "Standard",
      comfortable: "Comfortable",
      position: "Navigation position",
      left: "Left",
      right: "Right",
      collapsed: "Icons-only navigation",
      start: "Open on sign-in",
      menu: "Menu order & visibility",
      columns: "Contact columns",
      widgets: "Overview widgets",
      drag: "Drag to reorder, or use the arrows. Uncheck an item to hide it.",
      summary: "Show contact summary",
      summaryPosition: "Summary position",
      above: "Above the table",
      below: "Below the table",
      overview: "Overview layout",
      split: "Side by side",
      stacked: "Stacked",
      save: "Save my workspace",
      reset: "Reset to defaults",
      saved: "Your workspace has been saved.",
      failed: "Could not save your workspace.",
      only: "Saved only for your account.",
      autoNote: "Text and button colors adapt to your palette.",
      contrastRatio: "Text contrast",
      metrics: "Sales totals",
      stages: "Open pipeline",
      losses: "Loss reasons",
      name: "Name",
      contact: "Email & phone",
      company: "Company",
      theme: "Contact theme",
      stage: "Stage",
      tags: "Tags",
      owner: "Owner",
      collapse: "Collapse navigation",
      expand: "Expand navigation",
      instruction:
        "Describe the email in your language, or request another output language explicitly.",
    },
    pl: {
      personal: "Mój CRM",
      account: "Konto i organizacja",
      intro: "Twoje kolory. Twój sposób pracy.",
      description:
        "Dostosuj swój CRM bez zmieniania widoku współpracowników. Zobacz podgląd i zapisz zmiany.",
      presets: "Gotowe motywy",
      custom: "Własny",
      colors: "Własna paleta",
      background: "Tło",
      surface: "Panele i tabele",
      accent: "Kolor akcentu",
      sidebar: "Nawigacja",
      text: "Tekst",
      automatic: "Automatyczny kontrast tekstu",
      manual: "Wybiorę kolor tekstu",
      contrast: "Mocniejsze obramowanie i kontrast",
      density: "Gęstość widoku",
      compact: "Kompaktowa",
      standard: "Standardowa",
      comfortable: "Przestronna",
      position: "Położenie menu",
      left: "Po lewej",
      right: "Po prawej",
      collapsed: "Menu z samymi ikonami",
      start: "Widok po zalogowaniu",
      menu: "Kolejność i widoczność menu",
      columns: "Kolumny kontaktów",
      widgets: "Elementy podsumowania",
      drag: "Przeciągnij element lub użyj strzałek. Odznacz, aby ukryć.",
      summary: "Pokaż podsumowanie kontaktów",
      summaryPosition: "Położenie podsumowania",
      above: "Nad tabelą",
      below: "Pod tabelą",
      overview: "Układ podsumowania",
      split: "Obok siebie",
      stacked: "Jeden pod drugim",
      save: "Zapisz mój CRM",
      reset: "Przywróć domyślne",
      saved: "Zapisano Twój układ CRM.",
      failed: "Nie udało się zapisać układu.",
      only: "Ustawienia zapisują się tylko na Twoim koncie.",
      autoNote: "Tekst i przyciski dopasują kontrast do wybranych kolorów.",
      contrastRatio: "Kontrast tekstu",
      metrics: "Wyniki sprzedaży",
      stages: "Otwarty lejek",
      losses: "Powody przegranej",
      name: "Nazwa",
      contact: "Email i telefon",
      company: "Firma",
      theme: "Tematyka kontaktu",
      stage: "Etap",
      tags: "Tagi",
      owner: "Opiekun",
      collapse: "Zwiń menu",
      expand: "Rozwiń menu",
      instruction:
        "Opisz email w swoim języku lub wskaż inny język, w którym ma powstać wiadomość.",
    },
  };
  const lang = () =>
    typeof KlyoI18n !== "undefined" ? KlyoI18n.getLang() : "en";
  const t = (key) => (words[lang()] || words.en)[key] || key;
  const navName = (key) => {
    const label =
      typeof KlyoI18n !== "undefined" ? KlyoI18n.t("nav." + key) : "";
    return label && label !== "nav." + key
      ? label
      : key[0].toUpperCase() + key.slice(1);
  };
  function applyPalette(palette) {
    document.documentElement.dataset.theme = palette.preset;
    for (const [key, value] of Object.entries(P.tokens(palette)))
      document.documentElement.style.setProperty(key, value);
  }
  function applyContactColumns(value = draft.layout) {
    const table = g("contactsTable");
    if (!table) return;
    table.style.minWidth =
      Math.max(
        320,
        (value.contact_columns.length - value.hidden_columns.length) * 130,
      ) + "px";
    const rows = [
      table.tHead?.rows[0],
      ...Array.from(table.tBodies[0]?.rows || []),
    ].filter(Boolean);
    for (const row of rows) {
      const cells = [...row.children];
      for (let i = 0; i < cells.length; i++)
        if (!cells[i].dataset.column) cells[i].dataset.column = P.COLUMNS[i];
      for (const key of value.contact_columns) {
        const cell = cells.find((c) => c.dataset.column === key);
        if (cell) {
          cell.hidden = value.hidden_columns.includes(key);
          row.appendChild(cell);
        }
      }
    }
  }
  const sections = {
    sales: [
      "pipeline",
      "companies",
      "deals",
      "quotes",
      "products",
      "clients",
      "commercial",
    ],
    delivery: ["projects", "orders", "equipment"],
    work: ["tasks", "calendar", "reminders"],
    communication: ["inbox", "rfq", "files"],
    workspace: ["overview", "history", "team"],
  };
  function applyNav(layout) {
    const nav = document.querySelector(".sidebar .nav");
    if (!nav) return;
    const nodes = new Map(
      [...nav.querySelectorAll(".nav-item[data-view]")]
        .filter((n) => n.dataset.view !== "platform")
        .map((n) => [n.dataset.view, n]),
    );
    let list = nav.querySelector(".personal-nav");
    if (!list) {
      list = document.createElement("div");
      list.className = "personal-nav";
      nav.prepend(list);
    }
    const closed = new Set(
      [...list.querySelectorAll("details:not([open])")].map(
        (n) => n.dataset.section,
      ),
    );
    list.replaceChildren();
    list.dataset.mode = layout.nav_mode;
    const titles =
      KlyoI18n.getLang() === "pl"
        ? {
            sales: "Sprzedaż",
            delivery: "Realizacja",
            work: "Zadania i terminy",
            communication: "Komunikacja i pliki",
            workspace: "Przestrzeń",
          }
        : {
            sales: "Sales",
            delivery: "Delivery",
            work: "Work & calendar",
            communication: "Communication & files",
            workspace: "Workspace",
          };
    for (const key of layout.nav_order) {
      const item = nodes.get(key);
      if (!item) continue;
      item.classList.toggle("personal-hidden", layout.hidden_nav.includes(key));
      item.title = navName(key);
      item.setAttribute("aria-label", navName(key));
      if (layout.nav_mode === "list") {
        list.append(item);
        continue;
      }
      const section =
        Object.keys(sections).find((s) => sections[s].includes(key)) ||
        "workspace";
      let group = list.querySelector(`[data-section="${section}"]`);
      if (!group) {
        group = document.createElement("details");
        group.dataset.section = section;
        group.open = layout.collapsed || !closed.has(section);
        group.innerHTML = `<summary>${esc(titles[section])}</summary><div class="nav-section-items"></div>`;
        list.append(group);
      }
      group.querySelector("div").append(item);
    }
    list
      .querySelectorAll("details")
      .forEach(
        (d) =>
          (d.hidden = ![...d.querySelectorAll(".nav-item")].some(
            (n) => !n.classList.contains("personal-hidden"),
          )),
      );
    nav.querySelectorAll(".nav-group").forEach((group) => {
      if (!group.querySelector('.nav-item:not([data-view="platform"])'))
        group.classList.add("empty-nav-group");
    });
    const platform = g("platformNavItem");
    platform.classList.toggle("hidden", !owner);
    platform.closest(".nav-group")?.classList.toggle("hidden", !owner);
    platform.title = "Platform";
  }
  function applyOverview(layout) {
    const view = g("salesOverviewView");
    if (!view) return;
    let container = g("personalOverview");
    if (!container) {
      container = document.createElement("div");
      container.id = "personalOverview";
      container.className = "personal-overview";
      view.querySelector(".workspace-heading").after(container);
      const metrics = view.querySelector(".sales-metrics");
      metrics.dataset.widget = "metrics";
      container.appendChild(metrics);
      const sections = view.querySelectorAll(
        ".overview-columns>.workspace-section",
      );
      sections.forEach((el, i) => {
        el.dataset.widget = i ? "losses" : "stages";
        container.appendChild(el);
      });
      view.querySelector(".overview-columns").classList.add("hidden");
    }
    container.dataset.layout = layout.overview_layout;
    for (const key of layout.overview_order) {
      const item = container.querySelector(`[data-widget="${key}"]`);
      if (item) {
        item.hidden = layout.hidden_widgets.includes(key);
        container.appendChild(item);
      }
    }
  }
  function applyLayout(layout) {
    document.body.style.setProperty(
      "--sidebar-width",
      (layout.collapsed ? 68 : layout.sidebar_width) + "px",
    );
    document.body.dataset.density = layout.density;
    document.body.dataset.sidebar = layout.sidebar;
    document.body.dataset.sidebarCollapsed = String(layout.collapsed);
    applyNav(layout);
    applyContactColumns(layout);
    applyOverview(layout);
    const view = g("pipelineView"),
      summary = view?.querySelector(".stat-grid");
    if (summary) {
      summary.hidden = !layout.summary_visible;
      if (layout.summary_position === "below")
        view.querySelector(".table-card").after(summary);
      else view.querySelector(".contact-toolbar").before(summary);
    }
    const button = g("collapseNavigation");
    if (button) {
      button.title = t(layout.collapsed ? "expand" : "collapse");
      button.setAttribute("aria-label", button.title);
      button.textContent = layout.collapsed ? "»" : "«";
    }
  }
  function apply(value) {
    applyPalette(value.palette);
    applyLayout(value.layout);
  }
  function initUser(user) {
    userId = user.id;
    owner = user.is_platform_admin === true;
    saved = P.normalize(user.workspace_preferences, false, user.theme);
    draft = P.clone(saved);
    apply(saved);
    try {
      localStorage.setItem("klyo_preferences:" + userId, JSON.stringify(saved));
    } catch {}
  }
  function preload() {
    try {
      const user = API.getUser();
      if (!user?.id) return;
      const value = JSON.parse(
        localStorage.getItem("klyo_preferences:" + user.id) || "null",
      );
      if (value) applyPalette(P.normalize(value).palette);
    } catch {}
  }
  function listMarkup(kind, order, hidden) {
    return order
      .map(
        (key, i) =>
          `<li class="preference-item" draggable="true" data-key="${key}"><span class="drag-grip" aria-hidden="true">⋮⋮</span><label><input type="checkbox" data-visible="${key}" ${hidden.includes(key) ? "" : "checked"} ${kind === "columns" && key === "name" ? "disabled" : ""}>${esc(kind === "nav" ? navName(key) : t(key))}</label><button type="button" data-move="-1" data-key="${key}" aria-label="${esc((kind === "nav" ? navName(key) : t(key)) + " ↑")}" ${i === 0 ? "disabled" : ""}>↑</button><button type="button" data-move="1" data-key="${key}" aria-label="${esc((kind === "nav" ? navName(key) : t(key)) + " ↓")}" ${i === order.length - 1 ? "disabled" : ""}>↓</button></li>`,
      )
      .join("");
  }
  const listConfig = {
    nav: ["nav_order", "hidden_nav"],
    columns: ["contact_columns", "hidden_columns"],
    widgets: ["overview_order", "hidden_widgets"],
  };
  function renderLists() {
    for (const [kind, [order, hidden]] of Object.entries(listConfig))
      g("prefList-" + kind).innerHTML = listMarkup(
        kind,
        draft.layout[order],
        draft.layout[hidden],
      );
  }
  function refreshPreview() {
    try {
      draft = P.normalize(draft, true);
      apply(draft);
      g("preferencesError").textContent = "";
    } catch (error) {
      g("preferencesError").textContent = error.message;
      return false;
    }
    const tokens = P.tokens(draft.palette);
    g("colorContrastValue").textContent =
      `${t("contrastRatio")}: ${Math.min(P.contrast(tokens["--bg"], tokens["--text"]), P.contrast(tokens["--surface"], tokens["--panel-text"])).toFixed(1)}:1`;
    g("colorContrastValue").classList.toggle(
      "contrast-warning",
      Math.min(
        P.contrast(tokens["--bg"], tokens["--text"]),
        P.contrast(tokens["--surface"], tokens["--panel-text"]),
      ) < 4.5,
    );
    g("customPaletteFields").classList.toggle(
      "hidden",
      draft.palette.preset !== "custom",
    );
    g("customTextField").classList.toggle(
      "hidden",
      draft.palette.text_mode !== "manual",
    );
    g("themeGrid")
      .querySelectorAll("[data-preset]")
      .forEach((button) =>
        button.setAttribute(
          "aria-pressed",
          String(button.dataset.preset === draft.palette.preset),
        ),
      );
    return true;
  }
  function readControl(event) {
    const el = event.target;
    if (el.dataset.color) {
      draft.palette.custom[el.dataset.color] = el.value;
      g("hex-" + el.dataset.color).value = el.value;
    } else if (el.dataset.hex) {
      if (!/^#[a-f\d]{6}$/i.test(el.value)) return;
      draft.palette.custom[el.dataset.hex] = el.value;
      g("color-" + el.dataset.hex).value = el.value;
    } else if (el.dataset.layout)
      draft.layout[el.dataset.layout] =
        el.type === "checkbox" ? el.checked : el.value;
    else if (el.id === "prefTextMode") {
      draft.palette.text_mode = el.value;
      if (el.value === "manual" && draft.palette.preset !== "custom") {
        draft.palette.custom = {
          ...draft.palette.custom,
          ...P.PRESETS[draft.palette.preset],
        };
        draft.palette.preset = "custom";
        renderControls();
        return;
      }
    } else if (el.id === "prefHighContrast")
      draft.palette.high_contrast = el.checked;
    else return;
    refreshPreview();
  }
  function renderControls() {
    g("themeGrid").innerHTML = [
      ...Object.entries(P.PRESETS).map(
        ([key, p]) =>
          `<button type="button" class="personal-preset" data-preset="${key}" aria-pressed="false"><span style="--preset-bg:${p.background};--preset-surface:${p.surface};--preset-accent:${p.accent};--preset-sidebar:${p.sidebar}" class="preset-mini"><i></i><b></b><em></em></span><span>${esc(p.name)}</span></button>`,
      ),
      `<button type="button" class="personal-preset custom-preset" data-preset="custom" aria-pressed="false"><span class="preset-mini">＋</span><span>${t("custom")}</span></button>`,
    ].join("");
    g("customPaletteFields").innerHTML =
      `<legend>${t("colors")}</legend><div class="color-grid">` +
      ["background", "surface", "accent", "sidebar", "text"]
        .map(
          (key) =>
            `<label class="color-control" ${key === "text" ? 'id="customTextField"' : ""}><span>${t(key)}</span><span class="color-inputs"><input type="color" id="color-${key}" data-color="${key}" value="${draft.palette.custom[key]}" aria-label="${t(key)}"><input type="text" id="hex-${key}" data-hex="${key}" maxlength="7" pattern="#[a-fA-F0-9]{6}" value="${draft.palette.custom[key]}" aria-label="${t(key)} HEX"></span></label>`,
        )
        .join("") +
      "</div>";
    const select = (name, title, choices, value) =>
      `<label class="preference-control"><span>${title}</span><select id="pref-${name}" data-layout="${name}">${choices.map((key) => `<option value="${key}" ${key === value ? "selected" : ""}>${["start_view"].includes(name) ? esc(navName(key)) : t(key)}</option>`).join("")}</select></label>`;
    g("layoutControls").innerHTML =
      select(
        "density",
        t("density"),
        ["compact", "standard", "comfortable"],
        draft.layout.density,
      ) +
      select(
        "sidebar",
        t("position"),
        ["left", "right"],
        draft.layout.sidebar,
      ) +
      select("start_view", t("start"), P.NAV, draft.layout.start_view) +
      select(
        "summary_position",
        t("summaryPosition"),
        ["above", "below"],
        draft.layout.summary_position,
      ) +
      select(
        "overview_layout",
        t("overview"),
        ["split", "stacked"],
        draft.layout.overview_layout,
      ) +
      `<label class="preference-checkbox"><input type="checkbox" data-layout="collapsed" ${draft.layout.collapsed ? "checked" : ""}>${t("collapsed")}</label><label class="preference-checkbox"><input type="checkbox" data-layout="summary_visible" ${draft.layout.summary_visible ? "checked" : ""}>${t("summary")}</label>`;
    g("prefTextMode").innerHTML =
      `<option value="auto">${t("automatic")}</option><option value="manual">${t("manual")}</option>`;
    g("prefTextMode").value = draft.palette.text_mode;
    g("prefHighContrast").checked = draft.palette.high_contrast;
    if (g("offerLanguageHint"))
      g("offerLanguageHint").textContent = t("instruction");
    document.querySelectorAll("[data-pref-label]").forEach((el) => {
      el.textContent = t(el.dataset.prefLabel);
    });
    renderLists();
    refreshPreview();
  }
  function showTab(tab) {
    g("personalSettings").classList.toggle("hidden", tab !== "personal");
    g("accountSettings").classList.toggle("hidden", tab !== "account");
    document.querySelectorAll("[data-settings-tab]").forEach((button) => {
      button.setAttribute(
        "aria-selected",
        String(button.dataset.settingsTab === tab),
      );
    });
  }
  function open() {
    draft = P.clone(saved);
    renderControls();
    showTab("personal");
  }
  function cancelPreview() {
    draft = P.clone(saved);
    apply(saved);
  }
  async function persist(value) {
    const result = await API.put("/auth/preferences", value);
    saved = P.normalize(result.preferences);
    draft = P.clone(saved);
    apply(saved);
    const user = API.getUser();
    user.workspace_preferences = saved;
    user.theme = saved.palette.preset;
    API.setUser(user);
    try {
      localStorage.setItem("klyo_preferences:" + userId, JSON.stringify(saved));
    } catch {}
  }
  function init() {
    if (initialized) return;
    initialized = true;
    const collapse = document.createElement("button");
    collapse.type = "button";
    collapse.id = "collapseNavigation";
    collapse.className = "collapse-navigation";
    document.querySelector(".sidebar .brand").appendChild(collapse);
    collapse.addEventListener("click", async () => {
      collapse.disabled = true;
      const next = P.clone(saved);
      next.layout.collapsed = !next.layout.collapsed;
      apply(next);
      try {
        await persist(next);
      } catch (error) {
        apply(saved);
        toast(error.message, "error");
      } finally {
        collapse.disabled = false;
      }
    });
    for (const item of document.querySelectorAll(".sidebar-foot .nav-item")) {
      item.setAttribute("aria-label", item.textContent.trim());
      item.title = item.textContent.trim();
    }
    g("personalSettings").addEventListener("input", readControl);
    g("personalSettings").addEventListener("change", readControl);
    g("themeGrid").addEventListener("click", (event) => {
      const button = event.target.closest("[data-preset]");
      if (!button) return;
      if (
        button.dataset.preset === "custom" &&
        draft.palette.preset !== "custom"
      ) {
        const from = P.PRESETS[draft.palette.preset];
        if (from) draft.palette.custom = { ...draft.palette.custom, ...from };
      }
      draft.palette.preset = button.dataset.preset;
      renderControls();
    });
    document
      .querySelectorAll("[data-settings-tab]")
      .forEach((button) =>
        button.addEventListener("click", () =>
          showTab(button.dataset.settingsTab),
        ),
      );
    for (const [kind, [order, hidden]] of Object.entries(listConfig)) {
      const list = g("prefList-" + kind);
      const move = (key, target) => {
        const arr = draft.layout[order],
          from = arr.indexOf(key);
        if (from < 0 || target < 0 || target >= arr.length) return;
        arr.splice(from, 1);
        arr.splice(target, 0, key);
        renderLists();
        refreshPreview();
      };
      list.addEventListener("click", (event) => {
        const button = event.target.closest("[data-move]");
        if (button)
          move(
            button.dataset.key,
            draft.layout[order].indexOf(button.dataset.key) +
              Number(button.dataset.move),
          );
      });
      list.addEventListener("change", (event) => {
        const key = event.target.dataset.visible;
        if (!key) return;
        const previous = P.clone(draft.layout);
        draft.layout[hidden] = event.target.checked
          ? draft.layout[hidden].filter((v) => v !== key)
          : [...draft.layout[hidden], key];
        if (!refreshPreview()) draft.layout = previous;
        renderLists();
      });
      list.addEventListener("dragstart", (event) => {
        const row = event.target.closest("[data-key]");
        if (!row) return;
        drag = { kind, key: row.dataset.key };
        event.dataTransfer.setData("text/plain", row.dataset.key);
        event.dataTransfer.effectAllowed = "move";
      });
      list.addEventListener("dragover", (event) => {
        if (drag?.kind === kind) event.preventDefault();
      });
      list.addEventListener("drop", (event) => {
        event.preventDefault();
        const row = event.target.closest("[data-key]");
        if (row && drag?.kind === kind)
          move(drag.key, draft.layout[order].indexOf(row.dataset.key));
        drag = null;
      });
    }
    g("resetPreferencesBtn").addEventListener("click", () => {
      draft = P.defaults("graphite");
      renderControls();
    });
    g("savePreferencesBtn").addEventListener("click", async () => {
      const button = g("savePreferencesBtn");
      button.disabled = true;
      g("preferencesError").textContent = "";
      try {
        for (const input of g("personalSettings").querySelectorAll(
          "[data-hex]",
        ))
          if (!/^#[a-f\d]{6}$/i.test(input.value))
            throw new Error("Enter a valid HEX color, for example #2563eb.");
        await persist(P.normalize(draft, true));
        renderControls();
        if (saved.layout.hidden_nav.includes(currentView))
          switchView(saved.layout.start_view);
        toast(t("saved"));
      } catch (error) {
        g("preferencesError").textContent = error.message || t("failed");
      } finally {
        button.disabled = false;
      }
    });
    window.addEventListener("klyo:language", () => {
      g("offerLanguageHint").textContent = t("instruction");
      if (!g("appearanceModalOverlay").classList.contains("hidden"))
        renderControls();
      applyNav(draft.layout);
    });
    renderControls();
    apply(saved);
  }
  function startup() {
    switchView(saved.layout.start_view);
  }
  function applyLegacy(theme) {
    const palette = P.clone(saved.palette);
    palette.preset = P.PRESETS[theme] ? theme : P.LEGACY[theme] || "graphite";
    applyPalette(palette);
  }
  return {
    initUser,
    init,
    open,
    cancelPreview,
    startup,
    applyContactColumns,
    applyLegacy,
    preload,
    getSaved: () => P.clone(saved),
    preview: apply,
    save: persist,
  };
})();
KlyoCustomize.preload();
