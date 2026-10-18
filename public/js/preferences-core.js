/* Shared by the browser and API: bounded, account-only workspace preferences. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.KlyoPreferences = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const NAV = [
    "overview",
    "pipeline",
    "companies",
    "deals",
    "quotes",
    "products",
    "clients",
    "tasks",
    "calendar",
    "reminders",
    "files",
    "commercial",
    "projects",
    "orders",
    "equipment",
    "inbox",
    "rfq",
    "history",
    "team",
  ];
  const GROUPS = ["sales", "delivery", "work", "communication", "workspace"];
  const MODULE_GROUPS = Object.fromEntries(
    NAV.map((id) => [
      id,
      [
        "pipeline",
        "companies",
        "deals",
        "quotes",
        "products",
        "clients",
        "commercial",
      ].includes(id)
        ? "sales"
        : ["projects", "orders", "equipment"].includes(id)
          ? "delivery"
          : ["tasks", "calendar", "reminders"].includes(id)
            ? "work"
            : ["inbox", "rfq", "files"].includes(id)
              ? "communication"
              : "workspace",
    ]),
  );
  const INTERFACES = {
    classic: {
      icon_style: "line",
      font: "inter",
      corners: 5,
      sidebar: "left",
      nav_mode: "grouped",
      sidebar_width: 264,
      density: "compact",
    },
    explorer: {
      icon_style: "duotone",
      font: "inter",
      corners: 10,
      sidebar: "left",
      nav_mode: "grouped",
      sidebar_width: 300,
      density: "standard",
    },
    notebook: {
      icon_style: "letters",
      font: "grotesk",
      corners: 2,
      sidebar: "left",
      nav_mode: "list",
      sidebar_width: 248,
      density: "comfortable",
    },
    command: {
      icon_style: "solid",
      font: "mono",
      corners: 7,
      sidebar: "top",
      nav_mode: "grouped",
      sidebar_width: 264,
      density: "compact",
    },
  };
  const ACTIONS = [
    "new_deal",
    "new_contact",
    "new_quote",
    "new_task",
    "new_company",
    "integrations",
    "calendar",
  ];
  // These selectors identify existing UI regions; no arbitrary selectors or HTML are accepted.
  const PAGE_PARTS = {
    pipeline: {
      heading: ".collection-heading",
      summary: ".stat-grid",
      toolbar: ".contact-toolbar",
      records: ".table-card",
    },
    companies: { toolbar: ".filter-bar", records: ".table-card" },
    quotes: { toolbar: ".filter-bar", records: ".table-card" },
    products: { toolbar: ".filter-bar", records: ".table-card" },
    clients: { toolbar: ".filter-bar", records: ".table-card" },
    reminders: { records: ".table-card" },
    history: { toolbar: ".filter-bar", records: ".table-card" },
    team: {
      invites: "#inviteCard",
      records: ".table-card:not(#inviteCard)",
      insights: "#performanceCard",
    },
    tasks: { toolbar: "#opTaskToolbar", records: "#opTasksContent" },
    projects: { toolbar: ".op-toolbar", records: "#projectsContent" },
    orders: { toolbar: ".op-toolbar", records: "#ordersContent" },
    equipment: { toolbar: ".op-toolbar", records: "#equipmentContent" },
    files: {
      connections: "#filesStatus",
      toolbar: ".files-view-toolbar",
      records: "#filesRows",
      cloud: "#cloudProviderArea",
    },
    commercial: {
      heading: ".commercial-toolbar:first-child",
      toolbar: ".commercial-toolbar:nth-child(2)",
      records: ".commercial-scroll",
    },
    inbox: {
      heading: ".comm-toolbar:first-child",
      connections: ".comm-connections",
      toolbar: ".comm-toolbar:not(:first-child)",
      records: "#commMessages",
    },
    rfq: { heading: ".comm-toolbar", records: ".doc-scroll" },
    deals: {
      pipelines: ".pipeline-toolbar",
      tabs: ".outcome-tabs",
      saved: ".saved-views-bar",
      toolbar: ".filter-bar",
      insights: "#salesInsights",
      records: "#dealsBoardWrap",
    },
    calendar: {
      toolbar: ".filter-bar",
      connections: "#calendarConnectionNotice",
      records: "#calendarBoardBlock",
    },
  };
  function interfaceDefaults() {
    return {
      preset: "classic",
      base: "classic",
      icon_style: "line",
      font: "inter",
      corners: 5,
      content_width: 0,
      header_position: "top",
      toolbar_align: "right",
      quick_position: "header",
      quick_actions: [],
      section_order: [...GROUPS],
      module_groups: { ...MODULE_GROUPS },
      section_names: {},
      closed_sections: [],
      pages: {},
      saved: [],
    };
  }
  function useInterface(preferences, name) {
    const next = clone(preferences),
      kit = INTERFACES[name];
    if (!kit) return next;
    next.layout.ui = {
      ...interfaceDefaults(),
      ...next.layout.ui,
      preset: name,
      base: name,
      icon_style: kit.icon_style,
      font: kit.font,
      corners: kit.corners,
    };
    for (const key of ["sidebar", "nav_mode", "sidebar_width", "density"])
      next.layout[key] = kit[key];
    next.layout.collapsed = false;
    next.layout.ui.closed_sections = name === "command" ? [...GROUPS] : [];
    return next;
  }
  const COLUMNS = [
    "name",
    "contact",
    "company",
    "theme",
    "stage",
    "owner",
    "tags",
  ];
  const WIDGETS = ["metrics", "stages", "losses"];
  const DASHBOARD = [
    "metrics",
    "goal",
    "scorecards",
    "forecast",
    "sources",
    "daily",
    "closing",
    "risks",
    "leaderboard",
    "trend",
    "stages",
    "activity",
    "alltime",
    "wonlost",
    "lossreasons",
    "valuebands",
    "aging",
    "sourceconversion",
    "tasks",
    "companies",
    "quotes",
    "shortcut_deal",
    "shortcut_contact",
    "shortcut_quote",
    "shortcut_task",
  ];
  function packDashboard(input, moved) {
    const placed = [],
      occupied = (a, b) =>
        a.x < b.x + b.w - 0.0001 &&
        a.x + a.w > b.x + 0.0001 &&
        a.y < b.y + b.h - 0.0001 &&
        a.y + a.h > b.y + 0.0001;
    const order = moved
      ? [
          ...input.filter((w) => w.id === moved),
          ...input.filter((w) => w.id !== moved),
        ]
      : input;
    for (const raw of order) {
      const w = { ...raw };
      if (placed.some((p) => occupied(w, p))) {
        let found = false;
        for (
          let y = w.y;
          y <= 220 && !found;
          y = Math.round((y + 0.5) * 100) / 100
        )
          for (const x of [
            ...new Set([
              w.x,
              ...Array.from(
                { length: Math.floor((12 - w.w) * 2) + 1 },
                (_, i) => i / 2,
              ),
            ]),
          ])
            if (!placed.some((p) => occupied({ ...w, x, y }, p))) {
              w.x = x;
              w.y = y;
              found = true;
              break;
            }
        if (!found)
          throw Object.assign(new Error("The dashboard is full."), {
            status: 400,
          });
      }
      placed.push(w);
    }
    return input.map((w) => placed.find((p) => p.id === w.id));
  }
  function defaultDashboard() {
    return packDashboard(
      [
        "metrics",
        "goal",
        "scorecards",
        "forecast",
        "sources",
        "daily",
        "closing",
        "risks",
        "wonlost",
        "lossreasons",
        "stages",
        "activity",
        "alltime",
      ].map((id) => ({
        id,
        tilt: 0,
        x: 0,
        y: 0,
        w: [
          "metrics",
          "goal",
          "scorecards",
          "risks",
          "activity",
          "alltime",
        ].includes(id)
          ? 12
          : 6,
        h: id === "goal" ? 3 : id === "metrics" ? 5 : id === "activity" ? 5 : 6,
      })),
    );
  }
  const PRESETS = {
    day: {
      name: "Day",
      background: "#edf1f7",
      surface: "#ffffff",
      accent: "#2563eb",
      sidebar: "#172238",
    },
    graphite: {
      name: "Graphite",
      background: "#141923",
      surface: "#1d2532",
      accent: "#6b9cff",
      sidebar: "#0f141d",
    },
    midnight: {
      name: "Midnight",
      background: "#0c0d10",
      surface: "#17191f",
      accent: "#c7baff",
      sidebar: "#0c0d10",
    },
    ocean: {
      name: "Ocean",
      background: "#081d27",
      surface: "#102e3b",
      accent: "#4cdbcf",
      sidebar: "#071720",
    },
    forest: {
      name: "Forest",
      background: "#101e19",
      surface: "#1b3027",
      accent: "#85e5ac",
      sidebar: "#0b1712",
    },
    contrast: {
      name: "Contrast",
      background: "#000000",
      surface: "#101010",
      accent: "#ffff00",
      sidebar: "#000000",
    },
  };
  const LEGACY = {
    blanc: "day",
    office: "day",
    pearl: "day",
    sand: "day",
    dawn: "day",
    noir: "midnight",
    signal: "graphite",
    slate: "graphite",
    cobalt: "graphite",
    arctic: "ocean",
    meadow: "forest",
    forest: "forest",
    midnight: "midnight",
    nebula: "midnight",
    ember: "midnight",
  };
  const clone = (value) => JSON.parse(JSON.stringify(value));
  function defaults(theme) {
    return {
      version: 1,
      palette: {
        preset:
          PRESETS[theme] || theme === "custom"
            ? theme
            : LEGACY[theme] || "graphite",
        custom: {
          background: "#141923",
          surface: "#1d2532",
          accent: "#6b9cff",
          sidebar: "#0f141d",
          text: "#f4f7fc",
        },
        text_mode: "auto",
        high_contrast: false,
      },
      layout: {
        ui: interfaceDefaults(),
        dashboard: defaultDashboard(),
        dashboard_snap: "magnetic",
        sidebar_width: 264,
        nav_mode: "grouped",
        density: "compact",
        sidebar: "left",
        collapsed: false,
        start_view: "pipeline",
        nav_order: [...NAV],
        hidden_nav: [],
        contact_columns: [...COLUMNS],
        hidden_columns: [],
        summary_visible: true,
        summary_position: "above",
        overview_order: [...WIDGETS],
        hidden_widgets: [],
        overview_layout: "split",
      },
    };
  }
  function normalize(input, strict = false, legacyTheme) {
    const fail = (message) => {
      if (strict) throw Object.assign(new Error(message), { status: 400 });
    };
    if (input == null) input = {};
    if (typeof input !== "object" || Array.isArray(input)) {
      fail("Invalid workspace preferences.");
      input = {};
    }
    if (JSON.stringify(input).length > 60000)
      throw Object.assign(new Error("Workspace preferences are too large."), {
        status: 400,
      });
    const out = defaults(legacyTheme);
    const object = (value, name) => {
      if (value == null) return {};
      if (typeof value !== "object" || Array.isArray(value)) {
        fail(`Invalid ${name}.`);
        return {};
      }
      return value;
    };
    const palette = object(input.palette, "palette"),
      layout = object(input.layout, "layout"),
      custom = object(palette.custom, "custom colors");
    const choice = (value, values, fallback, name) => {
      if (value === undefined) return fallback;
      if (values.includes(value)) return value;
      fail(`Invalid ${name}.`);
      return fallback;
    };
    const bool = (value, fallback, name) => {
      if (value === undefined) return fallback;
      if (typeof value === "boolean") return value;
      fail(`Invalid ${name}.`);
      return fallback;
    };
    const list = (value, allowed, fallback, name, complete) => {
      if (value === undefined) return [...fallback];
      if (
        !Array.isArray(value) ||
        value.length > allowed.length ||
        value.some((v) => !allowed.includes(v)) ||
        new Set(value).size !== value.length
      ) {
        fail(`Invalid ${name}.`);
        return [...fallback];
      }
      return complete
        ? [...value, ...allowed.filter((v) => !value.includes(v))]
        : [...value];
    };
    out.palette.preset = choice(
      palette.preset,
      [...Object.keys(PRESETS), "custom"],
      out.palette.preset,
      "color preset",
    );
    out.palette.text_mode = choice(
      palette.text_mode,
      ["auto", "manual"],
      "auto",
      "text color mode",
    );
    out.palette.high_contrast = bool(palette.high_contrast, false, "contrast");
    for (const key of Object.keys(out.palette.custom))
      if (custom[key] !== undefined) {
        if (
          typeof custom[key] === "string" &&
          /^#[a-f\d]{6}$/i.test(custom[key])
        )
          out.palette.custom[key] = custom[key].toLowerCase();
        else fail(`Invalid ${key} color.`);
      }
    out.layout.density = choice(
      layout.density,
      ["compact", "standard", "comfortable"],
      "compact",
      "density",
    );
    out.layout.sidebar = choice(
      layout.sidebar,
      ["left", "right", "top"],
      "left",
      "sidebar position",
    );
    out.layout.collapsed = bool(layout.collapsed, false, "sidebar width");
    out.layout.start_view = choice(
      layout.start_view,
      NAV,
      "pipeline",
      "start page",
    );
    out.layout.nav_order = list(layout.nav_order, NAV, NAV, "menu order", true);
    out.layout.hidden_nav = list(
      layout.hidden_nav,
      NAV,
      [],
      "hidden menu items",
      false,
    );
    if (out.layout.hidden_nav.length === NAV.length) {
      fail("Keep at least one menu item visible.");
      out.layout.hidden_nav = [];
    }
    if (out.layout.hidden_nav.includes(out.layout.start_view))
      out.layout.start_view = out.layout.nav_order.find(
        (key) => !out.layout.hidden_nav.includes(key),
      );
    out.layout.contact_columns = list(
      layout.contact_columns,
      COLUMNS,
      COLUMNS,
      "contact columns",
      true,
    );
    out.layout.hidden_columns = list(
      layout.hidden_columns,
      COLUMNS.filter((k) => k !== "name"),
      [],
      "hidden columns",
      false,
    );
    out.layout.summary_visible = bool(
      layout.summary_visible,
      true,
      "contact summary",
    );
    out.layout.summary_position = choice(
      layout.summary_position,
      ["above", "below"],
      "above",
      "summary position",
    );
    out.layout.overview_order = list(
      layout.overview_order,
      WIDGETS,
      WIDGETS,
      "overview order",
      true,
    );
    out.layout.hidden_widgets = list(
      layout.hidden_widgets,
      WIDGETS,
      [],
      "hidden widgets",
      false,
    );
    if (out.layout.hidden_widgets.length === WIDGETS.length) {
      fail("Keep at least one overview widget visible.");
      out.layout.hidden_widgets = [];
    }
    out.layout.overview_layout = choice(
      layout.overview_layout,
      ["split", "stacked"],
      "split",
      "overview layout",
    );
    const bounded = (v, min, max, fallback, name) => {
      if (v === undefined) return fallback;
      const n = Number(v);
      if (Number.isInteger(n) && n >= min && n <= max) return n;
      fail("Invalid " + name + ".");
      return fallback;
    };
    out.layout.sidebar_width = bounded(
      layout.sidebar_width,
      208,
      360,
      264,
      "navigation width",
    );
    out.layout.nav_mode = choice(
      layout.nav_mode,
      ["grouped", "tiles", "list"],
      "grouped",
      "navigation layout",
    );
    out.layout.dashboard_snap = choice(
      layout.dashboard_snap,
      ["magnetic", "free", "grid"],
      "magnetic",
      "dashboard snapping",
    );
    const coordinate = (v, min, max, fallback, name) => {
      if (v === undefined) return fallback;
      const n = Number(v);
      if (Number.isFinite(n) && n >= min && n <= max)
        return Math.round(n * 100) / 100;
      fail("Invalid " + name + ".");
      return fallback;
    };
    if (layout.dashboard !== undefined) {
      if (
        !Array.isArray(layout.dashboard) ||
        layout.dashboard.length > DASHBOARD.length ||
        new Set(layout.dashboard.map((w) => w?.id)).size !==
          layout.dashboard.length ||
        layout.dashboard.some((w) => !w || !DASHBOARD.includes(w.id))
      ) {
        fail("Choose valid dashboard widgets.");
      } else {
        const widgets = layout.dashboard.map((w) => {
          const width = coordinate(w.w, 2, 12, 6, "widget width");
          return {
            id: w.id,
            x: Math.min(coordinate(w.x, 0, 12, 0, "widget column"), 12 - width),
            y: coordinate(w.y, 0, 220, 0, "widget row"),
            w: width,
            h: coordinate(w.h, 2, 20, 6, "widget height"),
            tilt: coordinate(w.tilt, -6, 6, 0, "widget tilt"),
          };
        });
        out.layout.dashboard = packDashboard(widgets);
      }
    }
    const ui = object(layout.ui, "interface layout"),
      target = out.layout.ui;
    target.preset = choice(
      ui.preset,
      [...Object.keys(INTERFACES), "custom"],
      "classic",
      "interface preset",
    );
    target.base = choice(
      ui.base,
      Object.keys(INTERFACES),
      "classic",
      "interface base",
    );
    target.icon_style = choice(
      ui.icon_style,
      ["line", "duotone", "letters", "solid"],
      "line",
      "icon style",
    );
    target.font = choice(
      ui.font,
      ["inter", "grotesk", "mono"],
      "inter",
      "interface font",
    );
    target.corners = bounded(ui.corners, 0, 20, 5, "corner radius");
    target.content_width = bounded(
      ui.content_width,
      0,
      2400,
      0,
      "content width",
    );
    if (target.content_width > 0 && target.content_width < 640) {
      fail("Content width must be at least 640.");
      target.content_width = 640;
    }
    target.header_position = choice(
      ui.header_position,
      ["top", "bottom"],
      "top",
      "header position",
    );
    target.toolbar_align = choice(
      ui.toolbar_align,
      ["left", "right"],
      "right",
      "toolbar alignment",
    );
    target.quick_position = choice(
      ui.quick_position,
      ["header", "workspace", "rail"],
      "header",
      "shortcut position",
    );
    target.quick_actions = list(
      ui.quick_actions,
      ACTIONS,
      [],
      "shortcuts",
      false,
    );
    target.section_order = list(
      ui.section_order,
      GROUPS,
      GROUPS,
      "navigation sections",
      true,
    );
    target.closed_sections = list(
      ui.closed_sections,
      GROUPS,
      [],
      "closed sections",
      false,
    );
    const groups = object(ui.module_groups, "module groups"),
      names = object(ui.section_names, "section names");
    for (const key of NAV)
      target.module_groups[key] = choice(
        groups[key],
        GROUPS,
        MODULE_GROUPS[key],
        "module group",
      );
    for (const key of GROUPS)
      if (names[key] !== undefined) {
        if (typeof names[key] !== "string" || names[key].length > 40) {
          fail("Section names must be at most 40 characters.");
          continue;
        }
        if (names[key].trim()) target.section_names[key] = names[key].trim();
      }
    const pages = object(ui.pages, "page layouts");
    for (const [page, raw] of Object.entries(pages)) {
      if (!Object.hasOwn(PAGE_PARTS, page)) {
        fail("Choose a supported page layout.");
        continue;
      }
      const value = object(raw, "page layout"),
        parts = Object.keys(PAGE_PARTS[page]);
      const spans = object(value.spans, "panel widths");
      target.pages[page] = {
        order: list(value.order, parts, parts, "panel order", true),
        hidden: list(
          value.hidden,
          parts.filter((p) => p !== "records"),
          [],
          "hidden panels",
          false,
        ),
        spans: {},
      };
      for (const key of parts)
        target.pages[page].spans[key] = choice(
          spans[key],
          [6, 12],
          12,
          "panel width",
        );
      if (value.positions !== undefined) {
        const positions = object(value.positions, "panel positions");
        target.pages[page].positions = {};
        for (const key of parts) {
          if (!positions[key]) continue;
          const p = object(positions[key], "panel geometry");
          const width = coordinate(p.w, 2, 12, 12, "panel width");
          target.pages[page].positions[key] = {
            x: Math.min(coordinate(p.x, 0, 12, 0, "panel x"),12-width),
            y: coordinate(p.y, 0, 20000, 0, "panel y"),
            w: width,
            h: coordinate(p.h, 72, 10000, 240, "panel height"),
          };
        }
      }
    }
    if (ui.saved !== undefined) {
      if (
        !Array.isArray(ui.saved) ||
        ui.saved.length > 6 ||
        new Set(ui.saved.map((x) => x?.id)).size !== ui.saved.length
      )
        fail("Save up to six unique layouts.");
      else
        for (const item of ui.saved) {
          if (
            !item ||
            typeof item.id !== "string" ||
            !/^layout-[a-zA-Z0-9_-]{1,60}$/.test(item.id) ||
            typeof item.name !== "string" ||
            !item.name.trim() ||
            item.name.length > 48
          ) {
            fail("Invalid saved layout.");
            continue;
          }
          const raw = object(item.configuration, "saved layout configuration");
          const clean = normalize(
            {
              layout: {
                ...raw,
                ui: { ...object(raw.ui, "saved interface"), saved: [] },
              },
            },
            strict,
          ).layout;
          // A shell preset never replaces someone's dashboard charts or their color palette.
          delete clean.dashboard;
          target.saved.push({
            id: item.id,
            name: item.name.trim(),
            configuration: clean,
          });
        }
    }
    return out;
  }
  const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const luminance = (hex) =>
    rgb(hex)
      .map((v) => {
        v /= 255;
        return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      })
      .reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
  const contrast = (a, b) => {
    const x = luminance(a),
      y = luminance(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  };
  const foreground = (background) => {
    const preferred =
      contrast(background, "#f7f9fc") >= contrast(background, "#111827")
        ? "#f7f9fc"
        : "#111827";
    return contrast(background, preferred) >= 4.5
      ? preferred
      : contrast(background, "#ffffff") >= contrast(background, "#000000")
        ? "#ffffff"
        : "#000000";
  };
  const mix = (a, b, amount) => {
    const x = rgb(a),
      y = rgb(b);
    return (
      "#" +
      x
        .map((v, i) =>
          Math.round(v * (1 - amount) + y[i] * amount)
            .toString(16)
            .padStart(2, "0"),
        )
        .join("")
    );
  };
  function tokens(palette) {
    const p =
      palette.preset === "custom"
        ? palette.custom
        : PRESETS[palette.preset] || PRESETS.graphite;
    const text =
        palette.text_mode === "manual"
          ? palette.custom.text
          : foreground(p.background),
      panelText =
        palette.text_mode === "manual"
          ? palette.custom.text
          : foreground(p.surface),
      navText = foreground(p.sidebar);
    const amount = palette.high_contrast ? 0.08 : 0.23;
    const dark = luminance(p.surface) < 0.25;
    return {
      "--bg": p.background,
      "--bg-glow": p.background,
      "--bg-soft": mix(p.surface, panelText, 0.045),
      "--surface": p.surface,
      "--surface-2": mix(p.surface, panelText, 0.08),
      "--topbar-bg": p.surface,
      "--text": text,
      "--text-dim": mix(text, p.background, amount),
      "--text-faint": mix(text, p.background, amount + 0.06),
      "--panel-text": panelText,
      "--panel-dim": mix(panelText, p.surface, amount),
      "--panel-muted": mix(panelText, p.surface, amount + 0.06),
      "--border": mix(
        p.surface,
        panelText,
        palette.high_contrast ? 0.55 : 0.23,
      ),
      "--border-soft": mix(
        p.surface,
        panelText,
        palette.high_contrast ? 0.35 : 0.12,
      ),
      "--accent-1": p.accent,
      "--accent-2": p.accent,
      "--signal": p.accent,
      "--on-accent": foreground(p.accent),
      "--nav-bg": p.sidebar,
      "--nav-text": navText,
      "--nav-muted": mix(navText, p.sidebar, 0.3),
      "--nav-active": mix(p.sidebar, navText, 0.13),
      "--nav-border": mix(p.sidebar, navText, 0.18),
      "--lead": dark ? "#93b4ff" : "#2c559b",
      "--contacted": mix(panelText, p.surface, 0.15),
      "--negotiating": dark ? "#f5c56a" : "#865900",
      "--customer": dark ? "#82e3ad" : "#1b7049",
      "--lost": dark ? "#ff9cab" : "#a82843",
      "--danger": dark ? "#ff9cab" : "#a82843",
    };
  }
  return {
    NAV,
    GROUPS,
    MODULE_GROUPS,
    INTERFACES,
    ACTIONS,
    PAGE_PARTS,
    interfaceDefaults,
    useInterface,
    COLUMNS,
    WIDGETS,
    DASHBOARD,
    packDashboard,
    defaultDashboard,
    PRESETS,
    LEGACY,
    clone,
    defaults,
    normalize,
    tokens,
    contrast,
    foreground,
    mix,
  };
});
