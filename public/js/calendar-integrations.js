{
  const p = new URLSearchParams(location.search);
  if (
    p.get("calendar_connect") === "connected" &&
    ["team", "personal"].includes(p.get("scope"))
  )
    API.setScope(p.get("scope"));
}
const KlyoCalendar = (() => {
  const { esc, dialog, binary } = KlyoDocumentTools,
    g = (id) => document.getElementById(id),
    pl = () => KlyoI18n.getLang() === "pl",
    l = (en, pol) => KlyoModuleI18n.pick(en, pol),
    editable = () => API.getUser()?.role !== "viewer";
  let state = null,
    range = null,
    version = 0,
    pending = null,
    remoteChanges = new Set();
  const provider = (p) =>
    p === "google"
      ? "Google Calendar"
      : p === "icloud"
        ? "Apple Calendar / iCloud"
        : "Outlook / Microsoft 365";
  const run = (fn) => async (e) => {
    const b = e?.currentTarget;
    if (b) b.disabled = true;
    try {
      await fn();
    } catch (e) {
      toast(e.message, "error");
    } finally {
      if (b?.isConnected) b.disabled = false;
    }
  };
  function init() {
    const params = new URLSearchParams(location.search);
    if (
      params.get("calendar_connect") === "connected" &&
      ["team", "personal"].includes(params.get("scope"))
    )
      API.setScope(params.get("scope"));
    g("calTodayBtn").insertAdjacentHTML(
      "afterend",
      `<button class="btn btn-ghost btn-sm" type="button" id="calendarConnections">${KlyoModuleI18n.label("Connect calendars", "Połącz kalendarze")}</button><button class="btn btn-ghost btn-sm" type="button" id="calendarRefresh">${KlyoModuleI18n.label("Refresh", "Odśwież")}</button><button class="btn btn-ghost btn-sm" type="button" id="calendarExport">${KlyoModuleI18n.label("Export CRM .ics", "Eksport CRM .ics")}</button>`,
    );
    g("calendarView")
      .querySelector(".filter-bar")
      .insertAdjacentHTML(
        "afterend",
        KlyoCopy.html(
          '<div id="calendarConnectionNotice" class="calendar-notice" role="status"></div>',
        ),
      );
    g("calendarConnections").onclick = run(settings);
    g("calendarRefresh").onclick = run(() => loadCalendar());
    g("calendarExport").onclick = run(async () => {
      const q = range ? new URLSearchParams(range) : "";
      const response = await binary("/calendar/export.ics?" + q),
        url = URL.createObjectURL(await response.blob()),
        a = document.createElement("a");
      a.href = url;
      a.download = "Klyo-calendar.ics";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
    g("eventDesc")
      .closest(".field")
      .insertAdjacentHTML(
        "beforebegin",
        `<div class="field" style="grid-column:1/-1"><label for="eventLocation">${KlyoModuleI18n.label("Location / meeting link", "Miejsce / link spotkania")}</label><input id="eventLocation" maxlength="1000" class="input"></div>`,
      );
    g("eventForm").insertAdjacentHTML(
      "beforeend",
      `<div class="calendar-event-footer"><small>${KlyoModuleI18n.label("Times use your local timezone. For all-day events, the end date is exclusive.", "Godziny używają Twojej strefy czasowej. Dla całodniowych termin końcowy oznacza pierwszy dzień po wydarzeniu.")}</small><button type="button" class="btn btn-ghost" id="eventProviderLinks">${KlyoModuleI18n.label("Calendar links", "Połączenia kalendarza")}</button></div>`,
    );
    g("eventProviderLinks").onclick = run(() => {
      if (g("eventForm").dataset.calendarSignature !== signature())
        throw new Error(
          l(
            "Save your event changes before opening calendar links.",
            "Zapisz zmiany wydarzenia przed otwarciem połączeń kalendarzy.",
          ),
        );
      return eventLinks(g("eventId").value);
    });
    g("eventAllDay").addEventListener("change", () => {
      const all = g("eventAllDay").checked;
      for (const id of ["eventStart", "eventEnd"]) {
        const old = g(id).value;
        g(id).type = all ? "date" : "datetime-local";
        g(id).value = old
          ? all
            ? old.slice(0, 10)
            : old.slice(0, 10) + "T09:00"
          : "";
      }
      if (all && g("eventStart").value && !g("eventEnd").value)
        g("eventEnd").value = nextDay(g("eventStart").value);
    });
    if (params.has("calendar_connect"))
      setTimeout(
        () =>
          toast(
            l(
              params.get("calendar_connect") === "connected"
                ? KlyoModuleI18n.pick(
                    "Calendar account connected. Choose a calendar.",
                  )
                : KlyoModuleI18n.pick("Calendar connection was not completed."),
              params.get("calendar_connect") === "connected"
                ? "Konto połączone. Wybierz kalendarz."
                : "Nie ukończono połączenia kalendarza.",
            ),
          ),
        500,
      );
  }
  setInterval(() => {
    if (
      document.visibilityState === "visible" &&
      g("calendarView") &&
      !g("calendarView").classList.contains("hidden") &&
      g("eventModalOverlay")?.classList.contains("hidden") &&
      !document.querySelector('[role="dialog"]') &&
      !document.body.classList.contains("interface-editing")
    )
      loadCalendar().catch(() => {});
  }, 60000);
  async function connectICloud() {
    const d = dialog(
      l("Connect iCloud", "Połącz iCloud"),
      `<form id="icloudConnectForm"><p>${l("Use an Apple app-specific password, never your main Apple Account password. Your credentials are encrypted and private to this account and workspace.", "Użyj hasła aplikacji Apple, nigdy głównego hasła konta Apple. Dane są szyfrowane i prywatne dla tego konta oraz przestrzeni.")}</p><label>${l("Apple ID email", "Adres email Apple ID")}<input name="apple_id" type="email" autocomplete="username" required maxlength="254"></label><label>${l("App-specific password", "Hasło aplikacji")}<input name="app_password" type="password" autocomplete="new-password" placeholder="xxxx-xxxx-xxxx-xxxx" required maxlength="19" pattern="[a-zA-Z]{4}(-[a-zA-Z]{4}){3}"></label><p><a href="https://account.apple.com/" target="_blank" rel="noopener">${l("Apple Account → Sign-In and Security → App-Specific Passwords", "Konto Apple → Logowanie i zabezpieczenia → Hasła aplikacji")}</a></p><button class="btn btn-primary" type="submit">${l("Connect iCloud", "Połącz iCloud")}</button></form>`,
    );
    d.find("form").onsubmit = async (e) => {
      e.preventDefault();
      const form = e.target,
        button = form.querySelector("button");
      button.disabled = true;
      try {
        await API.post("/calendar-integrations/icloud/connect", {
          apple_id: form.elements.apple_id.value,
          app_password: form.elements.app_password.value,
        });
        form.elements.app_password.value = "";
        d.close();
        await settings();
      } catch (error) {
        form.elements.app_password.value = "";
        d.error(error);
      } finally {
        button.disabled = false;
      }
    };
  }
  function nextDay(s) {
    return new Date(Date.parse(s + "T12:00:00Z") + 86400000)
      .toISOString()
      .slice(0, 10);
  }
  function localInput(s) {
    if (!s) return "";
    const d = new Date(s),
      pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  function signature() {
    return JSON.stringify(
      [
        "eventTitle",
        "eventDesc",
        "eventStart",
        "eventEnd",
        "eventLocation",
        "eventColor",
        "eventContactSelect",
        "eventDealSelect",
      ]
        .map((id) => g(id).value)
        .concat(g("eventAllDay").checked),
    );
  }
  function prepare(event) {
    const all = Boolean(event?.all_day);
    for (const id of ["eventStart", "eventEnd"])
      g(id).type = all ? "date" : "datetime-local";
    g("eventStart").value = event?.start_at
      ? all
        ? event.start_date?.slice(0, 10) || event.start_at.slice(0, 10)
        : localInput(event.start_at)
      : g("eventStart").value;
    g("eventEnd").value = event?.end_at
      ? all
        ? event.end_date?.slice(0, 10) || event.end_at.slice(0, 10)
        : localInput(event.end_at)
      : "";
    g("eventLocation").value = event?.location || "";
    g("eventProviderLinks").hidden = !event?.id;
    g("eventForm").dataset.revision = event?.updated_at || "";
    g("eventForm").dataset.originalStart = event?.start_at || "";
    g("eventForm").dataset.originalEnd = event?.end_at || "";
    g("eventForm").dataset.originalAllDay = String(Boolean(event?.all_day));
    g("eventForm").dataset.calendarSignature = signature();
    g("eventSubmitBtn").disabled = !editable();
    g("deleteEventBtn").disabled = !editable();
  }
  function instant(value, original) {
    if (!value) return null;
    if (
      original &&
      g("eventForm").dataset.originalAllDay === "false" &&
      localInput(original) === value
    )
      return new Date(original).toISOString();
    const result = new Date(value).toISOString();
    if (localInput(result) !== value)
      throw new Error(
        l(
          "This local time does not exist because of daylight saving time. Choose another time.",
          "Ta godzina nie istnieje z powodu zmiany czasu. Wybierz inną godzinę.",
        ),
      );
    return result;
  }
  function collect() {
    const all = g("eventAllDay").checked,
      start = g("eventStart").value,
      end = g("eventEnd").value;
    if (!start)
      throw new Error(l("Choose a start date.", "Wybierz datę rozpoczęcia."));
    return {
      start_at: all
        ? start + "T00:00:00Z"
        : instant(start, g("eventForm").dataset.originalStart),
      end_at: all
        ? (end || nextDay(start)) + "T00:00:00Z"
        : end
          ? instant(end, g("eventForm").dataset.originalEnd)
          : null,
      start_date: all ? start : null,
      end_date: all ? end || nextDay(start) : null,
      time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
      location: g("eventLocation").value,
      revision: g("eventForm").dataset.revision || undefined,
    };
  }
  function load(bounds) {
    const key = JSON.stringify([
      API.scope(),
      API.getUser()?.id,
      bounds.start,
      bounds.end,
    ]);
    if (pending?.key === key) return pending.promise;
    range = bounds;
    const ticket = ++version;
    // Navigation and refresh can request the same calendar simultaneously.
    // Share identical reads and serialize different ranges to respect provider locks.
    const promise = Promise.resolve(pending?.promise)
      .catch(() => {})
      .then(() => (ticket === version ? read(bounds, ticket) : []));
    pending = { key, promise };
    const clear = () => {
      if (pending?.promise === promise) pending = null;
    };
    promise.then(clear, clear);
    return promise;
  }
  async function read(bounds, ticket) {
    try {
      const [status, data] = await Promise.all([
        API.get("/calendar-integrations/status"),
        API.get("/calendar-integrations/events?" + new URLSearchParams(bounds)),
      ]);
      if (ticket !== version) return [];
      state = status;
      remoteChanges = new Set(
        (data.updates || []).map((u) => u.connection_id + ":" + u.event_id),
      );
      g("calendarConnectionNotice").textContent = data.errors?.length
        ? data.errors
            .map((e) => provider(e.provider) + ": " + e.message)
            .join(" · ")
        : status.connections?.length
          ? status.connections
              .map(
                (c) =>
                  provider(c.provider) +
                  ": " +
                  (c.calendar_name ||
                    l("choose calendar", "wybierz kalendarz")),
              )
              .join(" · ")
          : l(
              "Connect Google, Outlook or iCloud to see your private calendar alongside CRM events.",
              "Połącz Google, Outlook lub iCloud, aby widzieć prywatne terminy obok wydarzeń CRM.",
            );
      g("calendarConnectionNotice").classList.toggle(
        "calendar-warning",
        Boolean(data.errors?.length),
      );
      return data.events || [];
    } catch (e) {
      if (ticket === version) {
        g("calendarConnectionNotice").textContent = e.message;
        g("calendarConnectionNotice").classList.add("calendar-warning");
      }
      return [];
    }
  }
  async function settings() {
    state = await API.get("/calendar-integrations/status");
    const d = dialog(
      l("Calendar integrations", "Integracje kalendarzy"),
      `<p>${KlyoModuleI18n.label("Your connected calendar is private to your account in the active Team or Personal space. Only events you explicitly copy to CRM become visible to that workspace. Nothing invites attendees.", "Połączony kalendarz jest prywatny dla Twojego konta w aktywnym Team lub Personal. Zespół widzi dopiero wydarzenia jawnie skopiowane do CRM. Integracja nie zaprasza uczestników.")}</p>${state.providers
        .map((p) => {
          const c = state.connections.find((c) => c.provider === p.provider);
          return `<section class="calendar-provider"><h3>${provider(p.provider)}</h3><p>${esc(c?.account_name || l("Not connected", "Niepołączone"))}</p>${c ? `<p>${esc(c.calendar_name || l("Choose a calendar", "Wybierz kalendarz"))}${c.calendar_id && !c.can_write ? " · " + l("read-only", "tylko odczyt") : ""}</p><button class="btn btn-primary" data-calendar-choose="${c.id}">${KlyoModuleI18n.label("Choose calendar", "Wybierz kalendarz")}</button><button class="btn btn-ghost" data-calendar-disconnect="${c.id}">${KlyoModuleI18n.label("Disconnect", "Odłącz")}</button>${p.provider === "icloud" ? `<button class="btn btn-ghost" data-calendar-reconnect>${l("Update password", "Zmień hasło aplikacji")}</button>${c.calendar_id ? `<p>${l("Automatic two-way sync", "Automatyczna synchronizacja w obie strony")}: <strong>${c.auto_sync ? l("On", "Włączona") : l("Off", "Wyłączona")}</strong></p><p>${l("Only events copied to CRM or sent to iCloud are linked. Updates and deletions synchronize both ways; simultaneous edits require your decision. Recurring events and invitations stay editable in Apple Calendar.", "Powiązane są tylko terminy skopiowane do CRM lub wysłane do iCloud. Zmiany i usunięcia synchronizują się w obie strony; równoczesne zmiany wymagają Twojej decyzji. Serie i zaproszenia edytujesz w Apple Calendar.")}</p><button class="btn btn-primary" data-calendar-auto="${c.id}" data-enabled="${c.auto_sync}">${c.auto_sync ? l("Pause automatic sync", "Wstrzymaj synchronizację") : l("Enable automatic sync", "Włącz synchronizację")}</button><button class="btn btn-ghost" data-calendar-sync="${c.id}">${l("Sync now", "Synchronizuj teraz")}</button>${c.last_sync_at ? `<p>${l("Last sync", "Ostatnia synchronizacja")}: ${esc(new Date(c.last_sync_at).toLocaleString())}</p>` : ""}${c.sync_error ? `<p class="calendar-warning">${l("Some events need attention. Open their calendar links.", "Niektóre wydarzenia wymagają uwagi. Otwórz ich połączenia kalendarza.")}</p><button class="btn btn-ghost" data-calendar-issues="${c.id}">${l("Review sync issues", "Sprawdź problemy synchronizacji")}</button>` : ""}` : ""}` : ""}` : `<button class="btn btn-primary" data-calendar-connect="${p.provider}" ${p.configured ? "" : "disabled"}>${KlyoModuleI18n.label("Connect", "Połącz")}</button>${p.configured ? "" : `<p>${KlyoModuleI18n.label("Server configuration is required.", "Wymagana konfiguracja serwera.")}</p>`}`}</section>`;
        })
        .join(
          "",
        )}<p><a href="/docs/calendar-setup.html" target="_blank" rel="noopener">${KlyoModuleI18n.label("Setup guide · Google, Outlook and Apple Calendar", "Instrukcja · Google, Outlook i Apple Calendar")}</a></p><p>${KlyoModuleI18n.label("iCloud connects using an Apple app-specific password. Only linked CRM events synchronize. You can also export CRM .ics for other calendar apps.", "iCloud połączysz hasłem aplikacji Apple. Synchronizują się tylko powiązane wydarzenia CRM. Dla innych programów nadal dostępny jest eksport CRM .ics.")}</p>`,
      true,
    );
    d.root.querySelectorAll("[data-calendar-connect]").forEach(
      (b) =>
        (b.onclick = run(async () => {
          if (b.dataset.calendarConnect === "icloud") {
            d.close();
            await connectICloud();
            return;
          }
          const data = await API.post("/calendar-integrations/connect", {
            provider: b.dataset.calendarConnect,
          });
          location.assign(data.url);
        })),
    );
    d.root.querySelector("[data-calendar-reconnect]")?.addEventListener(
      "click",
      run(async () => {
        d.close();
        await connectICloud();
      }),
    );
    const syncConsent = () =>
      confirm(
        l(
          "Synchronize linked events in both directions, including deletions? In Team, colleagues' changes to those CRM events also update your iCloud calendar. Unrelated private events stay private.",
          "Synchronizować powiązane wydarzenia w obie strony, również usunięcia? W Team zmiany tych wydarzeń CRM przez współpracowników zaktualizują Twój iCloud. Pozostałe prywatne terminy pozostaną prywatne.",
        ),
      );
    d.root.querySelectorAll("[data-calendar-auto]").forEach(
      (b) =>
        (b.onclick = run(async () => {
          const enabled = b.dataset.enabled !== "true";
          if (enabled && !syncConsent()) return;
          await API.put(
            "/calendar-integrations/connections/" +
              b.dataset.calendarAuto +
              "/sync",
            { auto_sync: enabled, confirm_changes: enabled },
          );
          d.close();
          await settings();
        })),
    );
    d.root.querySelectorAll("[data-calendar-sync]").forEach(
      (b) =>
        (b.onclick = run(async () => {
          if (!syncConsent()) return;
          const result = await API.post(
            "/calendar-integrations/connections/" +
              b.dataset.calendarSync +
              "/sync",
            { confirm_changes: true },
          );
          toast(
            l("Sync complete", "Synchronizacja zakończona") +
              `: ↑${result.pushed} ↓${result.pulled} · ${l("Needs attention", "Wymaga uwagi")}: ${result.conflicts + result.errors}`,
          );
          d.close();
          await loadCalendar();
          await settings();
        })),
    );
    d.root.querySelectorAll("[data-calendar-issues]").forEach(
      (b) =>
        (b.onclick = run(async () => {
          const id = b.dataset.calendarIssues,
            data = await API.get(
              "/calendar-integrations/connections/" + id + "/issues",
            );
          d.close();
          const issues = dialog(
            l("Sync issues", "Problemy synchronizacji"),
            data.issues
              .map(
                (x) =>
                  `<section class="calendar-provider"><h3>${esc(x.title || l("Deleted CRM event", "Usunięte wydarzenie CRM"))}</h3><p>${esc(x.sync_error)}</p>${x.event_id ? `<button class="btn btn-primary" data-issue-event="${x.event_id}">${l("Review event versions", "Sprawdź wersje wydarzenia")}</button>` : `<button class="btn btn-primary" data-issue-restore="${esc(x.external_id)}">${l("Restore from iCloud", "Przywróć z iCloud")}</button>`}<button class="btn btn-ghost" data-issue-unlink="${x.id}">${l("Unlink and keep iCloud event", "Odłącz i zachowaj wydarzenie iCloud")}</button></section>`,
              )
              .join("") || l("No issues.", "Brak problemów."),
          );
          issues.root.querySelectorAll("[data-issue-event]").forEach(
            (b) =>
              (b.onclick = run(async () => {
                issues.close();
                await eventLinks(b.dataset.issueEvent);
              })),
          );
          issues.root.querySelectorAll("[data-issue-restore]").forEach(
            (b) =>
              (b.onclick = run(async () => {
                if (
                  !confirm(
                    l(
                      "Copy this iCloud event back into the active CRM workspace?",
                      "Skopiować to wydarzenie iCloud ponownie do aktywnej przestrzeni CRM?",
                    ),
                  )
                )
                  return;
                await API.post(
                  "/calendar-integrations/connections/" + id + "/copy",
                  { external_id: b.dataset.issueRestore, confirm_share: true },
                );
                issues.close();
                await loadCalendar();
                await settings();
              })),
          );
          issues.root.querySelectorAll("[data-issue-unlink]").forEach(
            (b) =>
              (b.onclick = run(async () => {
                if (
                  !confirm(
                    l(
                      "Unlink without deleting either version?",
                      "Odłączyć bez usuwania którejkolwiek wersji?",
                    ),
                  )
                )
                  return;
                await API.del(
                  "/calendar-integrations/links/" + b.dataset.issueUnlink,
                );
                issues.close();
                await settings();
              })),
          );
        })),
    );
    d.root.querySelectorAll("[data-calendar-choose]").forEach(
      (b) =>
        (b.onclick = run(async () => {
          const id = b.dataset.calendarChoose,
            data = await API.get(
              "/calendar-integrations/connections/" + id + "/calendars",
            ),
            current = state.connections.find((c) => String(c.id) === id);
          d.close();
          const picker = dialog(
            l("Choose calendar", "Wybierz kalendarz"),
            `<form><label>${KlyoModuleI18n.label("Calendar", "Kalendarz")}<select name="calendar_id" required>${data.calendars.map((c) => `<option value="${esc(c.id)}" ${current?.calendar_id === c.id ? "selected" : ""}>${esc(c.name)}${c.can_write ? "" : " · " + l("read-only", "tylko odczyt")}</option>`).join("")}</select></label><p>${KlyoModuleI18n.label("Existing CRM events are not published automatically.", "Istniejące wydarzenia CRM nie są publikowane automatycznie.")}</p><button class="btn btn-primary">${KlyoModuleI18n.label("Use this calendar", "Użyj tego kalendarza")}</button></form>`,
          );
          picker.find("form").onsubmit = async (e) => {
            e.preventDefault();
            try {
              await API.put(
                "/calendar-integrations/connections/" + id + "/calendar",
                { calendar_id: e.target.elements.calendar_id.value },
              );
              picker.close();
              await loadCalendar();
              await settings();
            } catch (e) {
              picker.error(e);
            }
          };
        })),
    );
    d.root.querySelectorAll("[data-calendar-disconnect]").forEach(
      (b) =>
        (b.onclick = run(async () => {
          if (
            !confirm(
              l(
                "Disconnect this account? CRM events and provider events will be kept.",
                "Odłączyć konto? Wydarzenia CRM i dostawcy pozostaną.",
              ),
            )
          )
            return;
          await API.del(
            "/calendar-integrations/connections/" +
              b.dataset.calendarDisconnect,
          );
          d.close();
          await loadCalendar();
          await settings();
        })),
    );
  }
  async function external(event) {
    const d = dialog(
      event.title,
      `<p class="calendar-source">${esc(provider(event.provider) + " · " + event.calendar_name)} · ${l("Private external event", "Prywatne wydarzenie zewnętrzne")}</p><p>${esc(event.all_day ? event.start_date + " → " + event.end_date : new Date(event.start_at).toLocaleString())}</p><p>${esc(event.location)}</p><p class="calendar-event-description">${esc(event.description)}</p>${event.web_url ? `<a class="btn btn-ghost" href="${esc(event.web_url)}" target="_blank" rel="noopener">${KlyoModuleI18n.label("Open calendar", "Otwórz kalendarz")}</a>` : ""}${editable() ? `<button class="btn btn-primary" id="copyExternalCalendarEvent">${KlyoModuleI18n.label(API.scope() === "team" ? KlyoModuleI18n.pick("Copy to Team CRM") : KlyoModuleI18n.pick("Copy to Personal CRM"), API.scope() === "team" ? "Kopiuj do Team CRM" : "Kopiuj do Personal CRM")}</button>` : ""}`,
    );
    d.find("#copyExternalCalendarEvent")?.addEventListener(
      "click",
      run(async () => {
        if (
          !confirm(
            l(
              "Copy the title, dates, location and description to this CRM workspace? Team colleagues will be able to read it.",
              "Skopiować tytuł, daty, miejsce i opis do tej przestrzeni CRM? W Team zobaczą je współpracownicy.",
            ),
          )
        )
          return;
        const data = await API.post(
          "/calendar-integrations/connections/" + event.connection_id + "/copy",
          { external_id: event.external_id, confirm_share: true },
        );
        d.close();
        await loadCalendar();
        openEventModal(data.event);
      }),
    );
  }
  async function eventLinks(id) {
    if (!id) return;
    const [data, status] = await Promise.all([
      API.get("/calendar-integrations/events/" + id + "/links"),
      API.get("/calendar-integrations/status"),
    ]);
    const d = dialog(
      l("Event calendar links", "Połączenia wydarzenia"),
      `<p>${KlyoModuleI18n.label("Save CRM edits before publishing. Publishing creates a calendar appointment without attendees. Pull explicitly replaces title, dates, description and location in CRM. Unlink keeps both events.", "Zapisz zmiany CRM przed publikacją. Publikacja tworzy termin bez uczestników. Pobranie jawnie zastępuje tytuł, daty, opis i miejsce w CRM. Odłączenie zachowuje oba wydarzenia.")}</p>${data.links.map((k) => `<section class="calendar-provider"><h3>${esc(provider(k.provider) + " · " + k.calendar_name)}</h3><p>${k.sync_error ? l("Sync needs attention: ", "Synchronizacja wymaga uwagi: ") + esc(k.sync_error) : k.auto_sync ? l("Automatic sync is on · changes and deletions sync both ways", "Automatyczna synchronizacja włączona · zmiany i usunięcia w obie strony") : remoteChanges.has(k.connection_id + ":" + id) ? l("External calendar changes available · pull to update CRM", "Są zmiany w kalendarzu · pobierz, aby zaktualizować CRM") : k.kind === "copied" ? l("Copied from your external calendar", "Skopiowano z kalendarza zewnętrznego") : k.status === "pending" ? l("Publication pending · retry using the same link", "Publikacja oczekuje · ponów na tym samym połączeniu") : k.local_changed ? l("CRM changes are not published yet", "Zmiany CRM nie są jeszcze opublikowane") : l("Last synchronized version", "Ostatnia zsynchronizowana wersja")}</p>${k.web_url ? `<a href="${esc(k.web_url)}" target="_blank" rel="noopener">${KlyoModuleI18n.label("Open external calendar", "Otwórz kalendarz zewnętrzny")}</a>` : ""}${editable() ? `<div class="calendar-actions">${k.kind === "published" || k.provider === "icloud" ? `<button class="btn btn-primary" data-publish-calendar="${k.connection_id}">${KlyoModuleI18n.label("Publish CRM version", "Opublikuj wersję CRM")}</button>` : ""}${["synced", "conflict"].includes(k.status) ? `<button class="btn btn-ghost" data-pull-calendar="${k.id}">${KlyoModuleI18n.label("Pull calendar version", "Pobierz wersję kalendarza")}</button>` : ""}<button class="btn btn-ghost" data-unlink-calendar="${k.id}">${KlyoModuleI18n.label("Unlink", "Odłącz")}</button></div>` : ""}</section>`).join("")}${
        editable()
          ? `<div class="calendar-actions">${status.connections
              .filter(
                (c) =>
                  c.calendar_id &&
                  c.can_write &&
                  !data.links.some((k) => k.connection_id === c.id),
              )
              .map(
                (c) =>
                  `<button class="btn btn-primary" data-publish-calendar="${c.id}">${l("Send to", "Wyślij do")} ${esc(provider(c.provider) + " · " + c.calendar_name)}</button>`,
              )
              .join("")}</div>`
          : ""
      }<button type="button" class="btn btn-ghost" id="eventCalendarSettings">${KlyoModuleI18n.label("Connect / choose calendar", "Połącz / wybierz kalendarz")}</button>`,
    );
    d.find("#eventCalendarSettings").onclick = run(async () => {
      d.close();
      await settings();
    });
    d.root.querySelectorAll("[data-publish-calendar]").forEach(
      (b) =>
        (b.onclick = run(async () => {
          if (
            !confirm(
              l(
                "Publish the saved CRM event to the selected calendar?",
                "Opublikować zapisane wydarzenie CRM w wybranym kalendarzu?",
              ),
            )
          )
            return;
          try {
            await API.post("/calendar-integrations/events/" + id + "/publish", {
              connection_id: b.dataset.publishCalendar,
              revision: data.event.updated_at,
              confirm_publish: true,
            });
            d.close();
            await loadCalendar();
            await eventLinks(id);
          } catch (e) {
            d.error(e);
          }
        })),
    );
    d.root.querySelectorAll("[data-pull-calendar]").forEach(
      (b) =>
        (b.onclick = run(async () => {
          if (
            !confirm(
              l(
                "Replace CRM event details with the external calendar version?",
                "Zastąpić dane wydarzenia CRM wersją z kalendarza?",
              ),
            )
          )
            return;
          try {
            await API.post(
              "/calendar-integrations/links/" +
                b.dataset.pullCalendar +
                "/pull",
              { confirm_pull: true, revision: data.event.updated_at },
            );
            d.close();
            closeEventModal();
            await loadCalendar();
            await eventLinks(id);
          } catch (e) {
            d.error(e);
          }
        })),
    );
    d.root.querySelectorAll("[data-unlink-calendar]").forEach(
      (b) =>
        (b.onclick = run(async () => {
          if (
            !confirm(
              l(
                "Unlink these events? Neither event will be deleted.",
                "Odłączyć wydarzenia? Żadne nie zostanie usunięte.",
              ),
            )
          )
            return;
          await API.del(
            "/calendar-integrations/links/" + b.dataset.unlinkCalendar,
          );
          d.close();
          await loadCalendar();
          await eventLinks(id);
        })),
    );
  }
  function onDay(event, y, m, day) {
    if (event.all_day) {
      const key = `${y}-${String(m + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
        start = event.start_date?.slice(0, 10) || event.start_at.slice(0, 10),
        end = event.end_date?.slice(0, 10) || nextDay(start);
      return start <= key && key < end;
    }
    const start = new Date(y, m, day).getTime(),
      end = new Date(y, m, day + 1).getTime(),
      es = Date.parse(event.start_at),
      ee = event.end_at ? Date.parse(event.end_at) : es + 3600000;
    return es < end && ee > start;
  }
  return {
    init,
    settings,
    connectICloud,
    load,
    prepare,
    collect,
    external,
    onDay,
    localInput,
    hasChanges: (id) => [...remoteChanges].some((k) => k.endsWith(":" + id)),
  };
})();
