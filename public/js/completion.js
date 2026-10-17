const KlyoCompletion = (() => {
  const { dialog, esc: h } = KlyoDocumentTools,
    l = (en, pl) => KlyoModuleI18n.pick(en, pl),
    owner = () => API.scope() === "personal" || API.getUser()?.is_team_owner;
  const money = (n, c) => fmtMoney(n, c, 2);
  async function settings() {
    const r = await API.get("/operations/settings");
    const d = dialog(
      l("Project settings", "Ustawienia projektów"),
      `<form><label><input type="checkbox" name="auto" ${r.settings.auto_project_on_win ? "checked" : ""} ${r.can_manage ? "" : "disabled"}> ${KlyoModuleI18n.label("Create one project when a deal is won", "Twórz jeden projekt po wygraniu sprawy")}</label><p>${KlyoModuleI18n.label("Applies to future wins in this workspace. Existing projects are reused; reopening and winning again never creates a second project.", "Dotyczy przyszłych wygranych w tej przestrzeni. Istniejące projekty są używane ponownie; ponowne wygranie nie tworzy drugiego projektu.")}</p>${r.can_manage ? `<button class="btn btn-primary">${KlyoModuleI18n.label("Save", "Zapisz")}</button>` : ""}</form>`,
    );
    d.find("form").onsubmit = async (e) => {
      e.preventDefault();
      try {
        await API.put("/operations/settings", {
          auto_project_on_win: e.target.elements.auto.checked,
        });
        d.close();
      } catch (e) {
        d.error(e);
      }
    };
  }
  async function finance(p) {
    const f = await API.get("/operations/projects/" + p.id + "/finance");
    const d = dialog(
      l("Project settlement", "Rozliczenie projektu") + " · " + p.title,
      `<p>${KlyoModuleI18n.label("Confirmed orders, net amounts. Draft and cancelled orders are excluded. Internal orders are not counted again as supplier costs. Work uses saved hourly cost snapshots. Currencies are shown separately.", "Potwierdzone zamówienia, kwoty netto. Szkice i anulowane zamówienia są pomijane. Zamówienia wewnętrzne nie są liczone ponownie jako koszt zakupu. Praca korzysta z zapisanych stawek kosztowych. Waluty są pokazywane oddzielnie.")}</p><p>${l("Project budget", "Budżet projektu")}: <strong>${h(money(f.budget, f.budget_currency))}</strong></p>${f.groups
        .map(
          (g) =>
            `<section><h3>${h(g.currency)}</h3><div class="op-kpis">${[
              [KlyoModuleI18n.pick("Sales"), "Sprzedaż", g.revenue],
              [KlyoModuleI18n.pick("Received"), "Wpłacono", g.received],
              [
                KlyoModuleI18n.pick("Outstanding"),
                "Do otrzymania",
                g.outstanding,
              ],
              [KlyoModuleI18n.pick("Purchases"), "Zakupy", g.purchases],
              [KlyoModuleI18n.pick("Labor cost"), "Koszt pracy", g.labor],
              [
                KlyoModuleI18n.pick("Other costs"),
                "Pozostałe koszty",
                g.expenses,
              ],
              [
                KlyoModuleI18n.pick("Total cost"),
                "Koszt łącznie",
                g.total_cost,
              ],
              [KlyoModuleI18n.pick("Profit"), "Zysk", g.profit],
            ]
              .map(
                ([en, pl, n]) =>
                  `<div><small>${KlyoModuleI18n.label(en, pl)}</small><strong>${n == null ? "—" : h(money(n, g.currency))}</strong></div>`,
              )
              .join(
                "",
              )}</div><p>${l("Margin", "Marża")}: ${g.margin_percent == null ? "—" : g.margin_percent + "%"} · ${l("Suppliers due", "Do zapłaty dostawcom")}: ${h(money(g.suppliers_due, g.currency))}</p>${g.unpriced_hours ? `<p class="doc-error">${h(g.unpriced_hours)} h · ${l("Missing hourly costs; profit is unavailable.", "Brak kosztu godzinowego; zysk jest niedostępny.")}</p>` : ""}</section>`,
        )
        .join(
          "",
        )}<button id="projectExpenseAdd" class="btn btn-primary">${KlyoModuleI18n.label("Add expense", "Dodaj koszt")}</button><div>${f.expenses.map((e) => `<p>${h(String(e.spent_on).slice(0, 10))} · ${h(e.description)} · ${h(money(e.amount, e.currency))} <button class="btn btn-ghost" data-expense-delete="${e.id}">×</button></p>`).join("")}</div><h3>${KlyoModuleI18n.label("Work cost snapshots", "Zapisane koszty pracy")}</h3><div id="projectWorkCosts"></div>`,
      true,
    );
    d.find("#projectExpenseAdd").onclick = () => {
      const a = dialog(
        l("Add expense", "Dodaj koszt"),
        `<form class="op-form"><label>${KlyoModuleI18n.label("Description", "Opis")}<input name="description" required maxlength="1000"></label><label>${KlyoModuleI18n.label("Date", "Data")}<input name="spent_on" type="date" required></label><label>${KlyoModuleI18n.label("Currency", "Waluta")}<input name="currency" value="${h(p.currency)}" required maxlength="3"></label><label>${KlyoModuleI18n.label("Amount", "Kwota")}<input name="amount" type="number" min="0" step="0.01" required></label><button class="btn btn-primary">${KlyoModuleI18n.label("Save", "Zapisz")}</button></form>`,
      );
      a.find("form").onsubmit = async (e) => {
        e.preventDefault();
        const submit = e.target.querySelector("button");
        submit.disabled = true;
        try {
          await API.post(
            "/operations/projects/" + p.id + "/expenses",
            Object.fromEntries(new FormData(e.target)),
          );
          a.close();
          d.close();
          await finance(p);
        } catch (e) {
          a.error(e);
        } finally {
          submit.disabled = false;
        }
      };
    };
    d.root.querySelectorAll("[data-expense-delete]").forEach(
      (b) =>
        (b.onclick = async () => {
          try {
            await API.del(
              "/operations/projects/" +
                p.id +
                "/expenses/" +
                b.dataset.expenseDelete,
            );
            d.close();
            await finance(p);
          } catch (e) {
            d.error(e);
          }
        }),
    );
    const detail = await API.get("/operations/projects/" + p.id);
    d.find("#projectWorkCosts").innerHTML = detail.time_entries
      .map(
        (t) =>
          `<form class="op-toolbar" data-time-cost="${t.id}"><label>${h(t.user_name)} · ${h(t.hours)} h · ${h(p.currency)}${KlyoCopy.label("/h")} <input type="number" name="hourly_cost" min="0" step="0.01" value="${t.hourly_cost ?? ""}"></label><button class="btn btn-ghost">${KlyoModuleI18n.label("Save cost", "Zapisz koszt")}</button></form>`,
      )
      .join("");
    d.root.querySelectorAll("[data-time-cost]").forEach(
      (form) =>
        (form.onsubmit = async (e) => {
          e.preventDefault();
          try {
            await API.patch(
              "/operations/projects/" +
                p.id +
                "/time/" +
                form.dataset.timeCost +
                "/cost",
              { hourly_cost: form.elements.hourly_cost.value },
            );
            d.close();
            await finance(p);
          } catch (e) {
            d.error(e);
          }
        }),
    );
  }
  async function order(d, o) {
    const row = document.createElement("div");
    row.className = "op-toolbar";
    row.innerHTML = `<button class="btn btn-ghost" id="shipmentDetails">${KlyoModuleI18n.label("Shipment status", "Status przesyłki")}</button>`;
    d.body.querySelector(".op-toolbar").append(row);
    row.querySelector("button").onclick = async () => {
      try {
        const status = await API.get("/operations/tracking/status");
        const a = dialog(
          l("Shipment status", "Status przesyłki"),
          `<p>${h(o.logistics?.carrier || "—")} · ${h(o.logistics?.tracking_number || "—")}</p><div id="shipmentSnapshot"></div><button class="btn btn-primary" id="shipmentRefresh">${KlyoModuleI18n.label("Refresh DHL status", "Odśwież status DHL")}</button>${status.can_manage ? `<form id="shipmentKey"><label>${KlyoModuleI18n.label("DHL API key", "Klucz API DHL")}<input name="key" type="password" autocomplete="off" required></label><button class="btn btn-ghost">${KlyoModuleI18n.label("Connect DHL", "Połącz DHL")}</button><button type="button" id="shipmentDisconnect" class="btn btn-ghost">${KlyoModuleI18n.label("Disconnect", "Odłącz")}</button></form>` : ""}<p>${KlyoModuleI18n.label("A DHL Tracking API subscription key is required. No subscription is purchased by Klyo. Other carriers remain available through their official tracking portal. A carrier delivery scan does not mark customer acceptance.", "Wymagany jest klucz DHL Tracking API. Klyo nie kupuje abonamentu. Inni przewoźnicy pozostają dostępni przez oficjalne strony śledzenia. Skan doręczenia nie oznacza podpisania odbioru przez klienta.")}</p>`,
        );
        const draw = (s, date) =>
          (a.find("#shipmentSnapshot").innerHTML = s
            ? `<p><strong>${h(s.status.description || s.status.status)}</strong> · ${h(date ? new Date(date).toLocaleString() : "")}</p><p>${h(s.estimated_delivery || "")}</p>${s.events.map((e) => `<p>${h(e.timestamp)} · ${h(e.description || e.status)} · ${h(e.location)}</p>`).join("")}`
            : `<p>${KlyoModuleI18n.label("No downloaded status yet.", "Nie pobrano jeszcze statusu.")}</p>`);
        draw(o.tracking_snapshot, o.tracking_checked_at);
        a.find("#shipmentRefresh").disabled =
          !status.configured ||
          String(o.logistics?.carrier || "").toLowerCase() !== "dhl";
        a.find("#shipmentRefresh").onclick = async (e) => {
          e.target.disabled = true;
          try {
            const r = await API.post(
              "/operations/orders/" + o.id + "/tracking/refresh",
              {},
            );
            draw(r.snapshot, r.checked_at);
          } catch (e) {
            a.error(e);
          } finally {
            e.target.disabled = false;
          }
        };
        if (status.can_manage) {
          a.find("#shipmentKey").onsubmit = async (e) => {
            e.preventDefault();
            try {
              await API.put("/operations/tracking/connection", {
                api_key: e.target.elements.key.value,
              });
              e.target.reset();
              a.find("#shipmentRefresh").disabled =
                String(o.logistics?.carrier || "").toLowerCase() !== "dhl";
            } catch (e) {
              a.error(e);
            }
          };
          a.find("#shipmentDisconnect").onclick = async () => {
            try {
              await API.del("/operations/tracking/connection");
              a.find("#shipmentRefresh").disabled = true;
            } catch (e) {
              a.error(e);
            }
          };
        }
      } catch (e) {
        d.error(e);
      }
    };
  }
  function project(d, p) {
    if (!owner()) return;
    const b = document.createElement("button");
    b.className = "btn btn-ghost";
    b.id = "projectFinance";
    b.dataset.moduleKey = "Settlement";
    b.textContent = l("Settlement", "Rozliczenie");
    b.onclick = () => finance(p).catch(d.error);
    d.body.querySelector(".op-toolbar").append(b);
  }
  function init() {
    const toolbar = document.querySelector("#projectsView>.op-toolbar");
    if (toolbar) {
      const b = document.createElement("button");
      b.id = "projectSettings";
      b.dataset.moduleKey = "Project settings";
      b.className = "btn btn-ghost";
      b.textContent = l("Project settings", "Ustawienia projektów");
      b.onclick = () => settings().catch((e) => toast(e.message, "error"));
      toolbar.append(b);
    }
  }
  return { init, project, finance, order };
})();
