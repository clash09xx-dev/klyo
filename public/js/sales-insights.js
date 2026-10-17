const KlyoSalesInsights = (() => {
  const l = (en, pl) => KlyoModuleI18n.pick(en, pl),
    h = KlyoDocumentTools.esc;
  function render(r, box, params, reload) {
    if (!box || !r.extended) return;
    const x = r.extended,
      m = r.metrics,
      b = x.benchmark,
      money = (n) => fmtMoney(n, r.filters.currency, 0),
      ratio = (n, d) => (d > 0 ? ((100 * n) / d).toFixed(1) + "%" : "—"),
      meetings = r.can_manage
        ? r.activity.reduce((s, a) => s + a.meetings, 0)
        : null,
      coverage =
        m.goal > Number(m.won_value)
          ? (
              Number(x.summary.period_pipeline) /
              (m.goal - Number(m.won_value))
            ).toFixed(2) + "×"
          : "—";
    const state = (actual, target) =>
      target == null || actual == null
        ? ""
        : Number(actual) >= Number(target)
          ? "is-good"
          : "is-behind";
    const cards = [
      [l("New opportunities", "Nowe szanse"), x.summary.new_count, null, null],
      [
        l("New pipeline value", "Wartość nowych szans"),
        money(x.summary.new_value),
        Number(x.summary.new_value),
        b.pipeline_goal,
      ],
      [
        l("Pipeline coverage", "Pokrycie pozostałego planu"),
        coverage,
        null,
        null,
      ],
      [
        l("Meetings logged", "Zarejestrowane spotkania"),
        meetings ?? "—",
        meetings,
        r.can_manage ? b.meeting_goal : null,
      ],
      [
        l("Won / lost ratio", "Stosunek wygranych do przegranych"),
        m.lost_count ? (m.won_count / m.lost_count).toFixed(2) : "—",
        null,
        null,
      ],
      [l("Lost value", "Wartość przegranych"), money(m.lost_value), null, null],
      [
        l("Change vs previous month", "Zmiana wobec poprzedniego miesiąca"),
        Number(x.summary.previous_won) > 0
          ? (
              (Number(m.won_value) / Number(x.summary.previous_won) - 1) *
              100
            ).toFixed(1) + "%"
          : "—",
        null,
        null,
      ],
      [
        l("Win-rate target", "Cel skuteczności"),
        m.win_rate == null ? "—" : m.win_rate + "%",
        m.win_rate,
        b.win_rate_goal,
      ],
    ];
    box.innerHTML = `<section id="salesScorecardBlock"><div class="analytics-section-heading"><h3>${KlyoModuleI18n.label("Sales scorecard", "Wyniki względem celów")}</h3>${r.can_manage ? `<button class="btn btn-ghost btn-sm" id="analyticsBenchmarks">${KlyoModuleI18n.label("Set benchmarks", "Ustaw cele i progi")}</button>` : ""}</div><p class="analytics-note">${KlyoModuleI18n.label("Benchmarks are your own targets, not invented industry averages. Activity totals are filtered by person and month, independently of the selected deal pipeline.", "Benchmarki to Twoje cele, a nie wymyślone średnie rynkowe. Aktywność jest filtrowana po osobie i miesiącu, niezależnie od wybranego lejka spraw.")}</p><div class="analytics-scorecards">${cards.map(([title, value, actual, target]) => `<article class="analytics-scorecard ${state(actual, target)}"><span>${title}</span><strong>${h(value)}</strong><small>${target == null ? l("No benchmark set", "Nie ustawiono celu") : l("Target", "Cel") + ": " + h(title === l("New pipeline value", "Wartość nowych szans") ? money(target) : target)}</small></article>`).join("")}</div></section><div class="analytics-insights-grid"><article class="analytics-chart"><h3>${KlyoModuleI18n.label("Forecast vs target", "Prognoza względem planu")}</h3><div id="salesForecast"></div><p class="analytics-note">${KlyoModuleI18n.label("Confirmed wins + probability-weighted open opportunities. This is an estimate, not guaranteed revenue. A missing target is not plotted as zero.", "Wygrane sprawy + otwarte szanse ważone prawdopodobieństwem. To szacunek, nie gwarantowany przychód. Brak planu nie jest rysowany jako zero.")}</p></article><article class="analytics-chart" id="salesSources"><h3>${KlyoModuleI18n.label("Opportunity value by source", "Wartość szans według źródła")}</h3>${bars(x.sources, money)}</article><article class="analytics-chart"><h3>${KlyoModuleI18n.label("Created vs closed opportunities", "Nowe a zamknięte sprawy")}</h3><div id="salesDaily"></div></article><article class="analytics-chart" id="salesClosing"><h3>${KlyoModuleI18n.label("Closing in the next 30 days", "Planowane zamknięcie w ciągu 30 dni")}</h3>${dealTable(x.closing, money, false)}</article></div><article class="analytics-chart analytics-risk" id="salesRisk"><h3>${KlyoModuleI18n.label("Pipeline health · needs attention", "Stan lejka · wymaga uwagi")}</h3><p class="analytics-note">${l("Missing dates/value, zero probability, overdue tasks or stalled stages. Stalled threshold", "Brak daty/wartości, zerowe prawdopodobieństwo, zaległe zadania lub zastój w etapie. Próg zastoju")}: ${b.stale_days} ${l("days", "dni")}. ${l("Up to 30 opportunities.", "Maksymalnie 30 spraw.")}</p>${dealTable(x.risks, money, true, b.stale_days)}</article>${r.can_manage ? `<article class="analytics-chart" id="salesLeaderboard"><h3>${KlyoModuleI18n.label("Team sales results", "Wyniki sprzedaży zespołu")}</h3><div class="analytics-scroll"><table><thead><tr><th>${KlyoModuleI18n.label("Person", "Osoba")}</th><th>${KlyoModuleI18n.label("Won value", "Wartość wygranych")}</th><th>${KlyoModuleI18n.label("Won deals", "Wygrane sprawy")}</th></tr></thead><tbody>${x.leaderboard.map((a) => `<tr><td>${h(a.name)}</td><td>${h(money(a.won_value))}</td><td>${a.won_count}</td></tr>`).join("")}</tbody></table></div></article>` : ""}`;
    box
      .querySelectorAll("[data-insight-deal]")
      .forEach(
        (btn) =>
          (btn.onclick = () => openDealPanel(Number(btn.dataset.insightDeal))),
      );
    box.querySelector("#salesForecast").innerHTML = forecast(x.forecast, money);
    box.querySelector("#salesDaily").innerHTML = daily(x.daily);
    box
      .querySelector("#analyticsBenchmarks")
      ?.addEventListener("click", () => edit(b, params, reload));
    // The original target cards also use meaningful, configured targets.
    const metrics = document.querySelectorAll(
      "#analyticsMetrics .analytics-metric",
    );
    if (metrics[4])
      metrics[4].classList.toggle(
        "is-good",
        m.goal_attainment >= 100 && m.goal > 0,
      );
    if (metrics[4])
      metrics[4].classList.toggle(
        "is-behind",
        m.goal > 0 && m.goal_attainment < 100,
      );
  }
  const empty = () =>
    `<p class="analytics-note">${KlyoModuleI18n.label("No data for these filters.", "Brak danych dla wybranych filtrów.")}</p>`;
  function bars(rows, money) {
    const max = Math.max(1, ...rows.map((r) => Number(r.value)));
    return rows.length
      ? rows
          .map(
            (r) =>
              `<div class="analytics-stage"><div><strong>${h(r.source === "Unspecified" ? l("Unspecified", "Nieokreślone") : r.source)}</strong><span>${h(money(r.value))} · ${r.count}</span></div><div class="analytics-stage-bar"><b style="width:${(Number(r.value) / max) * 100}%"></b></div></div>`,
          )
          .join("")
      : empty();
  }
  function dealTable(rows, money, risk, days) {
    if (!rows.length) return empty();
    return `<div class="analytics-scroll"><table><thead><tr><th>${KlyoModuleI18n.label("Opportunity", "Szansa")}</th><th>${KlyoModuleI18n.label("Value", "Wartość")}</th><th>${KlyoModuleI18n.label("Close date", "Data zamknięcia")}</th>${risk ? `<th>${KlyoModuleI18n.label("Attention", "Uwaga")}</th>` : ""}</tr></thead><tbody>${rows.map((d) => `<tr><td><button class="commercial-link" data-insight-deal="${d.id}">${h(d.title)}</button></td><td>${d.value == null ? "—" : h(money(d.value))}</td><td>${h(String(d.expected_close_date || "—").slice(0, 10))}</td>${risk ? `<td>${[d.overdue ? l("Overdue", "Po terminie") : "", !d.expected_close_date ? l("No close date", "Brak daty") : "", d.value == null ? l("No value", "Brak wartości") : "", Number(d.probability) === 0 ? "0%" : "", d.overdue_task ? l("Overdue task", "Zaległe zadanie") : "", d.stage_days >= days ? l("Stalled", "Zastój") + " " + d.stage_days + "d" : ""].filter(Boolean).map(h).join(" · ")}</td>` : ""}</tr>`).join("")}</tbody></table></div>`;
  }
  function forecast(rows, money) {
    const max = Math.max(
      1,
      ...rows.flatMap((r) => [
        Number(r.won) + Number(r.forecast),
        Number(r.target) || 0,
      ]),
    );
    let targets = [];
    const shapes = rows
      .map((r, i) => {
        const x = 30 + i * 95,
          a = (Number(r.won) / max) * 150,
          b = (Number(r.forecast) / max) * 150;
        if (r.target != null)
          targets.push(
            `<circle cx="${x + 25}" cy="${190 - (Number(r.target) / max) * 150}" r="4" fill="var(--analytics-target)"/><text x="${x + 25}" y="${Math.max(14, 181 - (Number(r.target) / max) * 150)}" text-anchor="middle" fill="currentColor" font-size="9">${h(money(r.target))}</text>`,
          );
        return `<g><title>${h(r.month + " · " + l("Won", "Wygrane") + ": " + money(r.won) + " · " + l("Weighted", "Ważone") + ": " + money(r.forecast))}</title><rect x="${x}" y="${190 - a}" width="50" height="${a}" fill="var(--analytics-won)"/><rect x="${x}" y="${190 - a - b}" width="50" height="${b}" fill="var(--analytics-forecast)"/><text x="${x + 25}" y="213" fill="currentColor" text-anchor="middle" font-size="11">${h(r.month)}</text></g>`;
      })
      .join("");
    const point = rows.map((r, i) =>
      r.target == null
        ? null
        : [55 + i * 95, 190 - (Number(r.target) / max) * 150],
    );
    let lines = "";
    for (let i = 1; i < point.length; i++)
      if (point[i] && point[i - 1])
        lines += `<line x1="${point[i - 1][0]}" y1="${point[i - 1][1]}" x2="${point[i][0]}" y2="${point[i][1]}" stroke="var(--analytics-target)" stroke-width="2"/>`;
    return `<svg viewBox="0 0 600 230" role="img" aria-label="${l("Wins, weighted forecast and target", "Wygrane, ważona prognoza i plan")}">${shapes}${lines}${targets.join("")}</svg><div class="analytics-legend"><span style="--legend:var(--analytics-won)">${KlyoModuleI18n.label("Won", "Wygrane")}</span><span style="--legend:var(--analytics-forecast)">${KlyoModuleI18n.label("Weighted forecast", "Prognoza ważona")}</span><span style="--legend:var(--analytics-target)">${KlyoModuleI18n.label("Target", "Plan")}</span></div>`;
  }
  function daily(rows) {
    if (!rows.length) return empty();
    const max = Math.max(1, ...rows.flatMap((r) => [r.created, r.closed])),
      points = (k) =>
        rows
          .map(
            (r, i) =>
              `${20 + (i * 560) / Math.max(1, rows.length - 1)},${170 - (r[k] / max) * 140}`,
          )
          .join(" ");
    return `<svg viewBox="0 0 600 210" role="img" aria-label="${l("Created and closed deal counts", "Liczba utworzonych i zamkniętych spraw")}"><polyline points="${points("created")}" fill="none" stroke="var(--analytics-forecast)" stroke-width="3"/><polyline points="${points("closed")}" fill="none" stroke="var(--analytics-won)" stroke-width="3"/>${rows
      .filter((r, i) => i % 5 === 0 || i === rows.length - 1)
      .map((r) => {
        const i = rows.indexOf(r);
        return `<text x="${20 + (i * 560) / Math.max(1, rows.length - 1)}" y="198" font-size="10" text-anchor="middle" fill="currentColor">${h(r.day.slice(5))}</text>`;
      })
      .join(
        "",
      )}${rows.map((r, i) => `<circle cx="${20 + (i * 560) / Math.max(1, rows.length - 1)}" cy="${170 - (r.created / max) * 140}" r="3" fill="var(--analytics-forecast)"><title>${h(r.day)}: ${r.created} / ${r.closed}</title></circle>`).join("")}</svg><div class="analytics-legend"><span style="--legend:var(--analytics-forecast)">${KlyoModuleI18n.label("Created", "Utworzone")}</span><span style="--legend:var(--analytics-won)">${KlyoModuleI18n.label("Closed", "Zamknięte")}</span></div>`;
  }
  function edit(b, params, reload) {
    const d = KlyoDocumentTools.dialog(
      l("Sales benchmarks", "Cele i progi sprzedaży"),
      `<p>${KlyoModuleI18n.label("Targets apply to this person, month and currency across all pipelines. Leave a target empty when it is not defined.", "Cele dotyczą tej osoby, miesiąca i waluty we wszystkich lejkach. Zostaw puste, jeśli cel nie jest ustalony.")}</p><form class="op-form">${[
        [
          "pipeline_goal",
          KlyoModuleI18n.pick("New pipeline value"),
          "Wartość nowych szans",
          "0.01",
        ],
        ["meeting_goal", KlyoModuleI18n.pick("Meetings"), "Spotkania", "1"],
        [
          "win_rate_goal",
          KlyoModuleI18n.pick("Win rate %"),
          "Skuteczność %",
          "0.01",
        ],
        [
          "stale_days",
          KlyoModuleI18n.pick("Stalled after days"),
          "Zastój po liczbie dni",
          "1",
        ],
      ]
        .map(
          ([key, en, pl, step]) =>
            `<label>${KlyoModuleI18n.label(en, pl)}<input name="${key}" type="number" min="${key === "stale_days" ? 1 : 0}" ${key === "win_rate_goal" ? 'max="100"' : key === "stale_days" ? 'max="365"' : ""} step="${step}" value="${b[key] ?? ""}" ${key === "stale_days" ? "required" : ""}></label>`,
        )
        .join(
          "",
        )}<button class="btn btn-primary">${KlyoModuleI18n.label("Save", "Zapisz")}</button></form>`,
    );
    d.find("form").onsubmit = async (e) => {
      e.preventDefault();
      try {
        await API.put("/analytics/benchmarks", {
          ...Object.fromEntries(params()),
          ...Object.fromEntries(new FormData(e.target)),
        });
        d.close();
        await reload();
      } catch (e) {
        d.error(e);
      }
    };
  }
  return { render };
})();
