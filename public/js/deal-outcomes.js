const KlyoOutcomes = (() => {
  const g = (id) => document.getElementById(id),
    h = KlyoDocumentTools.esc,
    l = (en, pl) => (KlyoI18n.getLang() === "pl" ? pl : en);
  let currencyInitialized = false;
  let mode = "pipeline",
    page = 0,
    version = 0;
  function bars(rows, key = "count") {
    const max = Math.max(1, ...rows.map((r) => Number(r[key] || 0)));
    return rows.length
      ? rows
          .map(
            (r) =>
              `<div class="result-bar"><div><span>${h(r.label)}</span><b>${Number(r[key] || 0)}</b></div><i><b style="width:${(100 * Number(r[key] || 0)) / max}%"></b></i></div>`,
          )
          .join("")
      : `<p class="muted">${l("No records in this period.", "Brak danych w tym okresie.")}</p>`;
  }
  function chart(rows) {
    const max = Math.max(1, ...rows.flatMap((r) => [r.won, r.lost]));
    if (!rows.length)
      return `<p class="muted">${l("No closed records for these filters.", "Brak zamkniętych spraw dla tych filtrów.")}</p>`;
    if (rows.length > 6)
      return rows
        .map(
          (r) =>
            `<div class="result-bar"><div><span>${h(r.label)}</span><b>✓ ${Number(r.won)} · × ${Number(r.lost)}</b></div><i><b style="width:${(100 * Number(r.won)) / max}%;background:var(--customer)"></b></i><i><b style="width:${(100 * Number(r.lost)) / max}%;background:var(--lost)"></b></i></div>`,
        )
        .join("");
    return `<svg viewBox="0 0 600 240" role="img" aria-label="${l("Won and lost opportunities", "Sprawy wygrane i przegrane")}"><path d="M12 190H590" stroke="currentColor" opacity=".2"/>${rows.map((r, i) => `<g><title>${h(r.label)}: ${r.won} / ${r.lost}</title><rect x="${22 + i * 95}" y="${190 - (150 * r.won) / max}" width="30" height="${(150 * r.won) / max}" fill="var(--customer)"/><rect x="${54 + i * 95}" y="${190 - (150 * r.lost) / max}" width="30" height="${(150 * r.lost) / max}" fill="var(--lost)"/><text x="${37 + i * 95}" y="${181 - (150 * r.won) / max}" font-size="12" text-anchor="middle" fill="currentColor">${Number(r.won) || ""}</text><text x="${69 + i * 95}" y="${181 - (150 * r.lost) / max}" font-size="12" text-anchor="middle" fill="currentColor">${Number(r.lost) || ""}</text><text x="${52 + i * 95}" y="218" font-size="12" text-anchor="middle" fill="currentColor">${h(String(r.label).slice(0, 14))}</text></g>`).join("")}</svg><p class="result-legend"><span>● ${l("Won", "Wygrane")}</span><span>● ${l("Lost", "Przegrane")}</span></p>`;
  }
  function cards(r) {
    const s = r.summary,
      m = (n) => fmtMoney(n, r.filters.currency, 0),
      total = s.won_count + s.lost_count;
    return `<div class="outcome-kpis"><button data-outcome-open="won"><small>✓ ${l("Won", "Wygrane")}</small><strong>${s.won_count}</strong><span>${h(m(s.won_value))}</span></button><button data-outcome-open="lost"><small>× ${l("Lost", "Przegrane")}</small><strong>${s.lost_count}</strong><span>${h(m(s.lost_value))}</span></button><article><small>${l("Win rate", "Skuteczność")}</small><strong>${total ? ((100 * s.won_count) / total).toFixed(1) + "%" : "—"}</strong><span>${l("Among closed opportunities", "Wśród zamkniętych spraw")}</span></article><article><small>${l("Average days to win", "Średnio dni do wygrania")}</small><strong>${s.days_to_win ?? "—"}</strong><span>${l("From creation to close", "Od utworzenia do zamknięcia")}</span></article></div>`;
  }
  function bind(box, params = {}) {
    box
      .querySelectorAll("[data-outcome-open]")
      .forEach((b) => (b.onclick = () => open(b.dataset.outcomeOpen, params)));
    box
      .querySelectorAll("[data-outcome-deal]")
      .forEach(
        (b) => (b.onclick = () => openDealPanel(Number(b.dataset.outcomeDeal))),
      );
  }
  async function load() {
    const t = ++version;
    g("outcomeError").textContent = "";
    g("outcomeContent").setAttribute("aria-busy", "true");
    try {
      const params = new URLSearchParams({
        month: g("outcomeMonth").value,
        currency: g("outcomeCurrency").value,
        pipeline_id: g("salesPipelineSelect").value,
        user_id: g("dealAssigneeFilter").value,
        status: mode === "lost" ? "lost" : "won",
        page,
      });
      const r = await API.get("/deal-outcomes?" + params);
      if (t !== version) return;
      g("outcomeContent").innerHTML =
        cards(r) +
        (mode === "results"
          ? `<div class="outcome-charts"><article><h3>${l("Won vs lost · six months", "Wygrane i przegrane · sześć miesięcy")}</h3>${chart(r.trend)}</article><article><h3>${l("Reasons for lost opportunities", "Powody przegranych")}</h3>${bars(r.reasons)}</article><article><h3>${l("Closed opportunity values", "Wartości zamkniętych spraw")} · ${h(r.filters.currency)}</h3>${chart(r.bands)}</article><article><h3>${l("Age of all currently open opportunities", "Wiek wszystkich obecnie otwartych spraw")}</h3>${bars(r.aging)}</article><article><h3>${l("Results by source · closed this month", "Wyniki według źródła · zamknięte w miesiącu")}</h3>${chart(r.sources)}</article></div>`
          : `<div class="table-card outcome-table"><table class="doc-table"><thead><tr><th>${l("Opportunity", "Szansa")}</th><th>${l("Company", "Firma")}</th><th>${l("Value", "Wartość")}</th><th>${l("Closed", "Zamknięto")}</th><th>${l("Owner / reason", "Opiekun / powód")}</th></tr></thead><tbody>${r.deals.map((d) => `<tr><td><button class="commercial-link" data-outcome-deal="${d.id}">${h(d.title)}</button></td><td>${h(d.company_name || "—")}</td><td>${h(fmtMoney(d.value, d.currency, 2))}</td><td>${h(d.closed_on)}</td><td>${h(d.owner || "—")}<small>${h(d.lost_reason || "")}</small></td></tr>`).join("") || `<tr><td colspan="5">${l("No closed deals in this period.", "Brak zamkniętych spraw w tym okresie.")}</td></tr>`}</tbody></table></div><div class="outcome-pages"><button id="outcomePrev" class="btn btn-ghost" ${page === 0 ? "disabled" : ""}>←</button><span>${page + 1} · ${r.total} ${l("deals", "spraw")}</span><button id="outcomeNext" class="btn btn-ghost" ${(page + 1) * 50 >= r.total ? "disabled" : ""}>→</button></div>`);
      bind(g("outcomeContent"));
      if (g("outcomePrev")) {
        g("outcomePrev").onclick = () => {
          page--;
          load();
        };
        g("outcomeNext").onclick = () => {
          page++;
          load();
        };
      }
    } catch (e) {
      if (t === version) {
        g("outcomeContent").replaceChildren();
        g("outcomeError").textContent = e.message;
      }
    } finally {
      if (t === version) g("outcomeContent").setAttribute("aria-busy", "false");
    }
  }
  function show(next) {
    if (!currencyInitialized) {
      g("outcomeCurrency").value = workspaceDefaultCurrency;
      currencyInitialized = true;
    }
    mode = next;
    page = 0;
    g("dealsView").dataset.outcomeView = next;
    g("outcomesPanel").hidden = next === "pipeline";
    g("outcomeTabs")
      .querySelectorAll("button")
      .forEach((b) =>
        b.setAttribute("aria-selected", String(b.dataset.outcome === next)),
      );
    if (next !== "pipeline") load();
  }
  function open(status, params = {}) {
    switchView("deals");
    if (
      params.pipeline_id &&
      g("salesPipelineSelect").querySelector(
        `option[value="${Number(params.pipeline_id)}"]`,
      )
    )
      g("salesPipelineSelect").value = params.pipeline_id;
    if (params.month) g("outcomeMonth").value = params.month;
    if (params.currency) {
      g("outcomeCurrency").value = params.currency;
      currencyInitialized = true;
    }
    show(status);
  }
  function init() {
    g("dealsView").insertAdjacentHTML(
      "afterbegin",
      `<div id="outcomeTabs" class="outcome-tabs" role="tablist" aria-label="${l("Sales results", "Wyniki sprzedaży")}">${[
        ["pipeline", "Pipeline", "Lejek"],
        ["won", "✓ Won", "✓ Wygrane"],
        ["lost", "× Lost", "× Przegrane"],
        ["results", "Results & charts", "Wyniki i wykresy"],
      ]
        .map(
          ([id, en, pl]) =>
            `<button class="btn btn-ghost" role="tab" data-outcome="${id}" aria-selected="${id === "pipeline"}">${l(en, pl)}</button>`,
        )
        .join(
          "",
        )}</div><section id="outcomesPanel" hidden><form id="outcomeFilters" class="outcome-filters"><label>${l("Closed in month", "Zamknięte w miesiącu")}<input id="outcomeMonth" type="month" value="${new Date().toISOString().slice(0, 7)}" required></label><label>${l("Currency", "Waluta")}<select id="outcomeCurrency">${["USD", "PLN", "EUR", "GBP", "CHF", "CAD", "AUD", "JPY", "SEK", "NOK", "DKK", "CZK", "HUF", "RON", "BGN", "HRK", "INR", "BRL", "MXN", "SGD"].map((c) => `<option>${c}</option>`).join("")}</select></label><button class="btn btn-primary">${l("Apply", "Zastosuj")}</button></form><p class="muted">${l("Closed results use the actual closing date. Currencies are kept separate; rates describe closed deals, not stage-by-stage conversion.", "Wyniki dotyczą rzeczywistej daty zamknięcia. Waluty są oddzielne; skuteczność dotyczy zamkniętych spraw, a nie konwersji między etapami.")}</p><p class="form-error" id="outcomeError" role="alert"></p><div id="outcomeContent"></div></section>`,
    );
    g("outcomeCurrency").value = workspaceDefaultCurrency;
    g("outcomeTabs").onclick = (e) => {
      const b = e.target.closest("[data-outcome]");
      if (b) show(b.dataset.outcome);
    };
    g("outcomeFilters").onsubmit = (e) => {
      e.preventDefault();
      page = 0;
      load();
    };
    g("salesPipelineSelect").addEventListener("change", () => {
      if (mode !== "pipeline") load();
    });
  }
  return {
    init,
    open,
    show,
    cards,
    bind,
    bars,
    chart,
    onView(view) {
      if (view === "deals" && mode !== "pipeline") load();
    },
  };
})();
