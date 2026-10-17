const KlyoAnalytics = (() => {
  const g = (id) => document.getElementById(id),
    h = KlyoDocumentTools.esc,
    pl = () => KlyoI18n.getLang() === "pl",
    l = (en, pol) => KlyoModuleI18n.pick(en, pol);
  let report = null,
    version = 0,
    mounted = false,
    currencyInitialized = false;
  const labels = () => ({
    month: l("Reporting month", "Miesiąc raportu"),
    currency: l("Currency", "Waluta"),
    owner: l("Owner", "Opiekun"),
    team: l("Whole workspace", "Cała przestrzeń"),
    apply: l("Apply filters", "Zastosuj filtry"),
    export: l("Export report", "Eksport raportu"),
    target: l("Sales target", "Plan sprzedaży"),
    setTarget: l("Edit target", "Edytuj plan"),
    save: l("Save target", "Zapisz plan"),
    remove: l("Remove target", "Usuń plan"),
    won: l("Won this month", "Wygrane w miesiącu"),
    forecast: l("Weighted open forecast", "Ważona prognoza otwartych"),
    outlook: l("Won + weighted forecast", "Wygrane + prognoza ważona"),
    attainment: l("Target attainment", "Realizacja planu"),
    gap: l("Remaining to target", "Do realizacji planu"),
    trend: l(
      "Closed deals · last six months",
      "Zamknięte sprawy · ostatnie sześć miesięcy",
    ),
    stage: l(
      "Open pipeline · expected close this month",
      "Otwarty lejek · zamknięcie planowane w miesiącu",
    ),
    activity: l("Recorded team activity", "Zarejestrowana aktywność zespołu"),
    meetings: l("Meetings logged", "Zalogowane spotkania"),
    calls: l("Calls logged", "Zalogowane rozmowy"),
    offers: l("Offers sent", "Wysłane oferty"),
    weighted: l("Weighted value", "Wartość ważona"),
    value: l("Value", "Wartość"),
    noGoal: l("No target set", "Nie ustawiono planu"),
    note: l(
      "Quote-linked amounts are net after discounts. Manually entered deal values are used as saved. Forecast = deal value × probability. Open forecast uses expected close dates; won results use the actual close date. Currencies are never combined. This is a weighted estimate, not guaranteed revenue.",
      "Wartości z ofert są netto po rabatach. Ręczne wartości spraw są liczone tak, jak je zapisano. Prognoza = wartość deala × prawdopodobieństwo. Prognoza otwartych używa planowanego terminu, a wygrane faktycznej daty zamknięcia. Waluty są liczone oddzielnie. To szacunek ważony, nie gwarantowany przychód.",
    ),
    net: l(
      "Enter net amounts. Linked offers use their net total after discounts.",
      "Wpisuj kwoty netto. Powiązane oferty używają wartości netto po rabatach.",
    ),
    probability: l("Win probability %", "Prawdopodobieństwo wygranej %"),
    missing: l(
      "Open deals without an expected close date",
      "Otwarte sprawy bez planowanej daty zamknięcia",
    ),
    zero: l(
      "Open deals at 0% probability",
      "Otwarte sprawy z prawdopodobieństwem 0%",
    ),
    winRate: l("Win rate this month", "Skuteczność w miesiącu"),
    average: l("Average won deal", "Średnia wygrana sprawa"),
    cycle: l("Average days to win", "Średnia liczba dni do wygranej"),
  });
  function mount() {
    if (mounted) return;
    mounted = true;
    g("salesOverviewView").insertAdjacentHTML(
      "afterbegin",
      `<section id="analyticsDashboard"><div class="analytics-heading"><div><span class="eyebrow">${KlyoModuleI18n.label("Sales reporting", "Raporty sprzedaży")}</span><h2>${KlyoModuleI18n.label("Performance & forecast", "Wyniki i prognoza")}</h2></div><button class="btn btn-ghost btn-sm" id="analyticsExport"></button></div><form id="analyticsFilters" class="analytics-filters"><label><span data-an="month"></span><input type="month" id="analyticsMonth" min="2000-01" max="2100-12" required></label><label><span data-an="currency"></span><select id="analyticsCurrency">${["USD", "PLN", "EUR", "GBP", "CHF", "CAD", "AUD", "JPY", "SEK", "NOK", "DKK", "CZK", "HUF", "RON", "BGN", "HRK", "INR", "BRL", "MXN", "SGD"].map((c) => `<option>${c}</option>`).join("")}</select></label><label><span data-an="owner"></span><select id="analyticsOwner"><option value=""></option></select></label><button class="btn btn-primary btn-sm" data-an="apply"></button></form><p class="analytics-note" data-an="note"></p><div id="analyticsMetrics" class="analytics-metrics"></div><div id="analyticsGoal"></div><div class="analytics-charts"><article class="analytics-chart"><h3 data-an="trend"></h3><div id="analyticsTrend"></div></article><article class="analytics-chart"><h3 data-an="stage"></h3><div id="analyticsStages"></div></article></div><section id="analyticsActivity" class="analytics-chart"></section><p class="form-error" id="analyticsError" role="alert"></p></section>`,
    );
    g("analyticsOwner")
      .closest("label")
      .insertAdjacentHTML(
        "afterend",
        `<label>${KlyoModuleI18n.label("Pipeline", "Lejek")}<select id="analyticsPipeline"><option value="">${KlyoModuleI18n.label("All pipelines", "Wszystkie lejki")}</option></select></label>`,
      );
    g("analyticsActivity").insertAdjacentHTML(
      "afterend",
      '<div id="analyticsExtended"></div>',
    );
    const now = new Date();
    g("analyticsMonth").value =
      now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0");
    g("analyticsCurrency").value =
      typeof workspaceDefaultCurrency !== "undefined"
        ? workspaceDefaultCurrency
        : "USD";
    g("analyticsFilters").onsubmit = (e) => {
      e.preventDefault();
      load();
    };
    g("analyticsExport").onclick = exportReport;
    localize();
  }
  function localize() {
    if (!mounted) return;
    const d = labels();
    document
      .querySelectorAll("[data-an]")
      .forEach((el) => (el.textContent = d[el.dataset.an]));
    g("analyticsExport").textContent = d.export;
  }
  function params() {
    return new URLSearchParams({
      month: g("analyticsMonth").value,
      currency: g("analyticsCurrency").value,
      user_id: g("analyticsOwner").value,
      pipeline_id: g("analyticsPipeline").value,
    });
  }
  async function load() {
    mount();
    if (!currencyInitialized) {
      g("analyticsCurrency").value = workspaceDefaultCurrency;
      currencyInitialized = true;
    }
    localize();
    const ticket = ++version;
    g("analyticsError").textContent = "";
    g("analyticsDashboard").setAttribute("aria-busy", "true");
    try {
      const data = await API.get("/analytics?" + params());
      if (ticket !== version) return;
      report = data;
      render();
    } catch (e) {
      if (ticket === version) {
        report = null;
        if(typeof KlyoDashboard!=="undefined")KlyoDashboard.beforeRender();
        g("analyticsMetrics").innerHTML = "";
        g("analyticsTrend").innerHTML = "";
        g("analyticsStages").innerHTML = "";
        g("analyticsActivity").innerHTML = "";
        g("analyticsGoal").innerHTML = "";
        g("analyticsExtended").innerHTML = "";
        g("analyticsError").textContent = e.message;
      }
    } finally {
      if (ticket === version)
        g("analyticsDashboard").setAttribute("aria-busy", "false");
    }
  }
  const money = (v) => fmtMoney(v, report.filters.currency, 2),
    num = (v) =>
      v == null
        ? "—"
        : Number(v).toLocaleString(pl() ? "pl-PL" : "en-GB", {
            maximumFractionDigits: 1,
          });
  function render() {
    if(typeof KlyoDashboard!=="undefined")KlyoDashboard.beforeRender();
    const d = labels(),
      m = report.metrics;
    g("analyticsPipeline").innerHTML =
      `<option value="">${KlyoModuleI18n.label("All pipelines", "Wszystkie lejki")}</option>` +
      (report.pipelines || [])
        .map((p) => `<option value="${p.id}">${h(p.name)}</option>`)
        .join("");
    g("analyticsPipeline").value = report.filters.pipeline_id || "";
    g("analyticsOwner").innerHTML =
      `<option value="">${d.team}</option>` +
      report.owners
        .map((o) => `<option value="${o.id}">${h(o.name)}</option>`)
        .join("");
    g("analyticsOwner").value = report.filters.user_id || "";
    g("analyticsMetrics").innerHTML = [
      [d.won, money(m.won_value)],
      [d.forecast, money(m.weighted_forecast)],
      [d.outlook, money(m.weighted_outlook)],
      [d.target, m.goal == null ? "—" : money(m.goal)],
      [
        d.attainment,
        m.goal_attainment == null ? "—" : num(m.goal_attainment) + "%",
      ],
      [d.gap, m.gap_to_goal == null ? "—" : money(m.gap_to_goal)],
      [d.winRate, m.win_rate == null ? "—" : num(m.win_rate) + "%"],
      [d.average, money(m.average_won_value)],
      [d.cycle, num(m.average_days_to_win)],
    ]
      .map(
        ([label, value]) =>
          `<div class="analytics-metric"><span>${h(label)}</span><strong>${h(value)}</strong></div>`,
      )
      .join("");
    g("analyticsGoal").innerHTML =
      `<div class="analytics-goal"><div><strong>${m.goal == null ? d.noGoal : d.attainment + ": " + (m.goal_attainment == null ? "—" : num(m.goal_attainment) + "%")}</strong><div class="analytics-progress" role="img" aria-label="${h(d.attainment)}"><span style="width:${Math.min(100, Math.max(0, Number(m.goal_attainment) || 0))}%"></span></div></div>${report.can_manage ? `<button class="btn btn-ghost btn-sm" id="analyticsEditTarget">${d.setTarget}</button>` : ""}</div><p class="analytics-note">${d.missing}: ${m.missing_close_date} · ${d.zero}: ${m.zero_probability}</p><form id="analyticsTargetForm" class="analytics-filters" hidden><label>${d.target} · ${h(report.filters.currency)}<input id="analyticsTargetAmount" type="number" min="0" max="999999999999" step="0.01" required value="${m.goal ?? ""}"></label><button class="btn btn-primary btn-sm" data-save-target>${d.save}</button><button type="button" class="btn btn-ghost btn-sm" id="analyticsRemoveTarget">${d.remove}</button></form>`;
    g("analyticsEditTarget")?.addEventListener("click", () => {
      g("analyticsTargetForm").hidden = !g("analyticsTargetForm").hidden;
      g("analyticsTargetAmount").focus();
    });
    g("analyticsTargetForm").onsubmit = async (e) => {
      e.preventDefault();
      const b = e.currentTarget.querySelector("[data-save-target]");
      b.disabled = true;
      try {
        await API.put("/analytics/target", {
          ...Object.fromEntries(params()),
          amount: g("analyticsTargetAmount").value,
        });
        await load();
      } catch (e) {
        g("analyticsError").textContent = e.message;
        b.disabled = false;
      }
    };
    g("analyticsRemoveTarget").onclick = async () => {
      try {
        await API.del("/analytics/target?" + params());
        await load();
      } catch (e) {
        g("analyticsError").textContent = e.message;
      }
    };
    if (typeof KlyoSalesInsights !== "undefined")
      KlyoSalesInsights.render(report, g("analyticsExtended"), params, load);
    const max = Math.max(1, ...report.months.map((r) => Number(r.won_value))),
      w = 600,
      base = 200;
    g("analyticsTrend").innerHTML =
      `<svg viewBox="0 0 600 260" role="img" aria-label="${h(d.trend)}"><line x1="15" y1="200" x2="585" y2="200" stroke="currentColor" opacity=".2"/>${report.months
        .map((r, i) => {
          const height = (Number(r.won_value) / max) * 140,
            x = 25 + i * 96;
          return `<g><title>${h(r.month + ": " + money(r.won_value) + " · " + r.won_count + " won / " + r.lost_count + " lost")}</title><rect x="${x}" y="${base - height}" width="60" height="${Math.max(1, height)}" fill="var(--accent-1)" rx="2"/><text x="${x + 30}" y="${Math.max(30, base - height - 10)}" text-anchor="middle" fill="currentColor" font-size="11">${h(money(r.won_value))}</text><text x="${x + 30}" y="228" text-anchor="middle" fill="currentColor" font-size="12">${h(r.month)}</text><text x="${x + 30}" y="247" text-anchor="middle" fill="currentColor" font-size="10">${r.won_count} / ${r.lost_count}</text></g>`;
        })
        .join(
          "",
        )}</svg><p class="analytics-note">${KlyoModuleI18n.label("Under each month: won / lost deal count.", "Pod miesiącem: liczba wygranych / przegranych spraw.")}</p>`;
    const stageMax = Math.max(1, ...report.stages.map((s) => Number(s.value)));
    g("analyticsStages").innerHTML =
      report.stages
        .map(
          (s) =>
            `<div class="analytics-stage"><div><strong>${h(s.pipeline_name + " / " + s.name)}</strong><span>${s.count} · ${h(money(s.value))}</span></div><div class="analytics-stage-bar"><i style="width:${(Number(s.value) / stageMax) * 100}%"></i><b style="width:${(Number(s.weighted_value) / stageMax) * 100}%"></b></div><small>${d.weighted}: ${h(money(s.weighted_value))}</small></div>`,
        )
        .join("") ||
      `<p class="analytics-note">${KlyoModuleI18n.label("No stages yet.", "Nie ma jeszcze etapów.")}</p>`;
    g("analyticsActivity").hidden = !report.can_manage;
    g("analyticsActivity").innerHTML = report.can_manage
      ? `<h3>${d.activity}</h3><div class="analytics-scroll"><table><thead><tr><th>${d.owner}</th><th>${d.meetings}</th><th>${d.calls}</th><th>${d.offers}</th></tr></thead><tbody>${report.activity.map((a) => `<tr><td>${h(a.name)}</td><td>${a.meetings}</td><td>${a.calls}</td><td>${a.offers_sent}</td></tr>`).join("")}</tbody></table></div><p class="analytics-note">${KlyoModuleI18n.label("Counts use logged activities in the selected month. Scheduled calendar events are not counted as completed meetings.", "Liczby dotyczą aktywności zarejestrowanych w miesiącu. Zaplanowane wydarzenia w kalendarzu nie są liczone jako odbyte spotkania.")}</p>`
      : "";
    if(typeof KlyoDashboard!=="undefined")KlyoDashboard.reconcile(report,params());
  }
  function exportReport() {
    if (!report) return;
    const d = labels(),
      rows = [
        [
          "Klyo",
          report.filters.month,
          report.filters.currency,
          report.filters.timezone,
        ],
        [KlyoModuleI18n.pick("Metric"), KlyoModuleI18n.pick("Value")],
        ...Object.entries(report.metrics),
        [],
        [
          KlyoModuleI18n.pick("Stage"),
          KlyoModuleI18n.pick("Pipeline"),
          KlyoModuleI18n.pick("Deals"),
          KlyoModuleI18n.pick("Value"),
          KlyoModuleI18n.pick("Weighted"),
        ],
        ...report.stages.map((r) => [
          r.name,
          r.pipeline_name,
          r.count,
          r.value,
          r.weighted_value,
        ]),
        [],
        [
          KlyoModuleI18n.pick("Month"),
          KlyoModuleI18n.pick("Won value"),
          KlyoModuleI18n.pick("Won count"),
          KlyoModuleI18n.pick("Lost count"),
        ],
        ...report.months.map((r) => [
          r.month,
          r.won_value,
          r.won_count,
          r.lost_count,
        ]),
        [],
        [
          KlyoModuleI18n.pick("Owner"),
          KlyoModuleI18n.pick("Meetings logged"),
          KlyoModuleI18n.pick("Calls logged"),
          KlyoModuleI18n.pick("Offers sent"),
        ],
        ...report.activity.map((r) => [
          r.name,
          r.meetings,
          r.calls,
          r.offers_sent,
        ]),
        ...Object.entries(report.extended || {}).flatMap(([section, data]) => {
          const list = Array.isArray(data) ? data : [data];
          const keys = [
            ...new Set(list.flatMap((row) => Object.keys(row || {}))),
          ];
          return keys.length
            ? [
                [],
                [section],
                keys,
                ...list.map((row) => keys.map((key) => row[key])),
              ]
            : [];
        }),
      ],
      cell = (v) =>
        '"' +
        (/^[=+\-@\t\r]/.test(String(v ?? "")) ? "'" : "") +
        String(v ?? "").replace(/"/g, '""') +
        '"',
      url = URL.createObjectURL(
        new Blob(
          ["\ufeff" + rows.map((r) => r.map(cell).join(",")).join("\r\n")],
          { type: "text/csv;charset=utf-8" },
        ),
      ),
      a = document.createElement("a");
    a.href = url;
    a.download = "Klyo-sales-" + report.filters.month + ".csv";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function init() {
    mount();
    const currencyField = document.createElement("div");
    currencyField.className = "field";
    currencyField.id = "dealCurrencyField";
    currencyField.innerHTML =
      '<label for="dealCurrency" data-an="currency"></label><select id="dealCurrency">' +
      g("analyticsCurrency").innerHTML +
      "</select>";
    g("dealValue").closest(".field").after(currencyField);
    g("dealValue").insertAdjacentHTML(
      "afterend",
      '<small class="muted" data-an="net"></small>',
    );
    g("dealCurrency").addEventListener("change", previewDeal);
    g("dealForm").insertAdjacentHTML(
      "beforeend",
      `<div class="field"><label for="dealSource">${KlyoModuleI18n.label("Opportunity source", "Źródło szansy")}</label><input id="dealSource" maxlength="120" placeholder="${l("e.g. referral, website, event", "np. polecenie, strona, targi")}"></div>`,
    );
    document
      .getElementById("dealForm")
      .insertAdjacentHTML(
        "beforeend",
        '<div class="field" id="dealProbabilityField"><label for="dealProbability" data-an="probability"></label><input id="dealProbability" type="number" min="0" max="100" step="0.01" value="0" required><small class="muted" id="dealWeightedPreview"></small></div>',
      );
    const field = g("dealProbabilityField");
    g("dealForm").insertBefore(field, g("dealFormError"));
    for (const id of ["dealProbability", "dealValue"])
      g(id).addEventListener("input", previewDeal);
    window.addEventListener("klyo:language", () => {
      localize();
      if (currentView === "overview") load();
    });
    localize();
  }
  function previewDeal() {
    g("dealWeightedPreview").textContent =
      labels().weighted +
      ": " +
      fmtMoney(
        ((Number(g("dealValue").value) || 0) *
          (Number(g("dealProbability").value) || 0)) /
          100,
        g("dealCurrency").value || workspaceDefaultCurrency,
        2,
      );
  }
  function openDeal(deal) {
    g("dealSource").value = deal?.source || "";
    g("dealProbability").value = deal?.probability ?? 0;
    g("dealCurrency").value = deal?.currency || workspaceDefaultCurrency;
    previewDeal();
  }
  return {
    init,
    load,
    openDeal,
    collect: () => ({
      probability: g("dealProbability").value,
      source: g("dealSource").value,
    }),
    onView: (view) => {
      if (view === "overview") load();
    },
  };
})();
