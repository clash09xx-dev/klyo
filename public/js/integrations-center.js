/* A single directory over the existing provider flows and workspace permissions. */
const KlyoIntegrations = (() => {
  const g = (id) => document.getElementById(id),
    h = (v) => KlyoDocumentTools.esc(v),
    l = (en, pl) => (KlyoI18n.getLang() === "pl" ? pl : en);
  let ticket = 0,
    data = {},
    activeCategory = "all",
    query = "";
  const catalog = [
    {id:"resend",name:"Resend",category:"email",kind:"platform",mark:"R",color:"#172119",
      description:["Account emails and password recovery. Managed by the Klyo operator; your outgoing CRM email stays separate.","Wiadomości konta i odzyskiwanie hasła. Konfiguruje operator Klyo; wysyłka ofert CRM pozostaje osobna."],guide:"/docs/account-access.html"},
    {
      id: "sharepoint",
      name: "SharePoint",
      category: "files",
      kind: "shared",
      mark: "SP",
      color: "#087c83",
      description: [
        "Connect a document library, choose a CRM folder and link or upload files.",
        "Połącz bibliotekę dokumentów, wybierz folder CRM i dodawaj pliki.",
      ],
      guide: "/docs/sharepoint-setup",
    },
    {
      id: "google_drive",
      name: "Google Drive",
      category: "files",
      kind: "shared",
      mark: "GD",
      color: "#298559",
      description: [
        "Browse a selected folder, upload files and attach them to CRM records.",
        "Przeglądaj wybrany folder, przesyłaj pliki i łącz je z danymi CRM.",
      ],
    },
    {
      id: "dropbox",
      name: "Dropbox",
      category: "files",
      kind: "shared",
      mark: "DB",
      color: "#2463eb",
      description: [
        "Use your Dropbox folder for client, deal and proposal documents.",
        "Używaj folderu Dropbox do dokumentów klientów, spraw i ofert.",
      ],
    },
    {
      id: "microsoft_mail",
      name: "Microsoft 365 Inbox",
      category: "email",
      kind: "private",
      mark: "M",
      color: "#d26733",
      description: [
        "Connect your inbox. Link correspondence to CRM records or configure a shared mailbox.",
        "Połącz skrzynkę i przypisuj korespondencję do CRM. Możesz też dodać skrzynkę współdzieloną.",
      ],
    },
    {
      id: "gmail",
      name: "Gmail",
      category: "email",
      kind: "admin",
      mark: "G",
      color: "#bd3d45",
      description: [
        "Send reviewed offer emails through the Gmail account connected to this workspace.",
        "Wysyłaj zatwierdzone wiadomości ofertowe z konta Gmail połączonego z tą przestrzenią.",
      ],
    },
    {
      id: "smtp",
      name: "SMTP",
      category: "email",
      kind: "admin",
      mark: "@",
      color: "#5362ae",
      description: [
        "Connect your own email provider for outgoing messages.",
        "Podłącz własnego dostawcę poczty do wysyłania wiadomości.",
      ],
    },
    {
      id: "google_calendar",
      name: "Google Calendar",
      category: "calendar",
      kind: "private",
      mark: "31",
      color: "#3570cc",
      description: [
        "See your calendar and explicitly copy or publish CRM appointments.",
        "Wyświetlaj swój kalendarz oraz jawnie kopiuj lub publikuj wydarzenia CRM.",
      ],
      guide: "/docs/calendar-setup",
    },
    {
      id: "outlook_calendar",
      name: "Outlook Calendar",
      category: "calendar",
      kind: "private",
      mark: "O",
      color: "#2378a8",
      description: [
        "Connect a Microsoft calendar. Your private events stay private.",
        "Połącz kalendarz Microsoft. Prywatne terminy pozostają prywatne.",
      ],
      guide: "/docs/calendar-setup",
    },
    {
      id: "apple_calendar",
      name: "Apple Calendar / iCalendar",
      category: "calendar",
      kind: "export",
      mark: "IC",
      color: "#586476",
      description: [
        "Export a month of CRM events as .ics. File export, not live iCloud sync.",
        "Eksportuj miesiąc wydarzeń CRM do .ics. To eksport pliku, a nie synchronizacja z iCloud.",
      ],
      guide: "/docs/calendar-setup",
    },
    {
      id: "apollo",
      name: "Apollo.io",
      category: "sales",
      kind: "shared",
      mark: "A",
      color: "#996d1e",
      description: [
        "Bring your own API key to search and import contacts. Apollo credits may apply.",
        "Podaj własny klucz API, wyszukuj i importuj kontakty. Mogą być zużywane kredyty Apollo.",
      ],
    },
    {
      id: "fakturownia",
      name: "Fakturownia",
      category: "sales",
      kind: "shared",
      mark: "F",
      color: "#568044",
      description: [
        "Connect your own invoicing account. Review and issue invoices from orders.",
        "Połącz własne konto do faktur. Sprawdzaj i wystawiaj faktury z zamówień.",
      ],
    },
    {
      id: "dhl",
      name: "DHL Tracking",
      category: "sales",
      kind: "shared",
      mark: "DHL",
      color: "#9b7116",
      description: [
        "Connect your Tracking Unified API key to read shipment status.",
        "Podaj własny klucz Tracking Unified API, aby odczytywać status przesyłek.",
      ],
    },
    {
      id: "sms",
      name: "Twilio · SMS 2FA",
      category: "account",
      kind: "private",
      mark: "2FA",
      color: "#ac4164",
      description: [
        "SMS codes are required at signup and every sign-in. The operator configures the service.",
        "Kod SMS jest wymagany przy rejestracji i każdym logowaniu. Usługę konfiguruje operator.",
      ],
      guide: "/docs/sms-security.html",
    },
    {
      id: "google_signin",
      name: "Google sign-in",
      category: "account",
      kind: "platform",
      mark: "G",
      color: "#337e67",
      description: [
        "Use Continue with Google on the sign-in page. No user API key is needed.",
        "Korzystaj z Kontynuuj z Google na stronie logowania. Nie potrzebujesz własnego klucza API.",
      ],
    },
    {
      id: "ai",
      name: "OpenAI · Email assistant",
      category: "account",
      kind: "platform",
      mark: "AI",
      color: "#376a64",
      description: [
        "Optional email drafts in your language. You review and send every message.",
        "Opcjonalne szkice wiadomości w Twoim języku. Samodzielnie zatwierdzasz i wysyłasz.",
      ],
    },
    {
      id: "stripe",
      name: "Stripe · Klyo subscription",
      category: "account",
      kind: "platform",
      mark: "S",
      color: "#6b51c6",
      description: [
        "Manage your Klyo plan. This is subscription billing, not a customer payment gateway.",
        "Zarządzaj planem Klyo. To rozliczenie abonamentu, a nie bramka płatnicza dla Twoich klientów.",
      ],
    },
  ];
  const shared = () =>
    API.scope() === "personal" || API.getUser()?.is_team_owner === true;
  const categoryName = (key) =>
    ({
      all: l("All integrations", "Wszystkie integracje"),
      files: l("Files", "Pliki"),
      email: l("Email", "Poczta"),
      calendar: l("Calendars", "Kalendarze"),
      sales: l("Sales & delivery", "Sprzedaż i realizacja"),
      account: l("Account & services", "Konto i usługi"),
    })[key];
  function init() {
    g("integrationsSettingsTab").textContent = l("Integrations", "Integracje");
    const mail = g("mailCard");
    if (mail) {
      g("integrationSettings").insertAdjacentHTML(
        "beforeend",
        '<details id="integrationSmtpSettings" hidden><summary>SMTP</summary></details>',
      );
      g("integrationSmtpSettings").append(mail);
    }
    window.addEventListener("klyo:language", () => {
      g("integrationsSettingsTab").textContent = l(
        "Integrations",
        "Integracje",
      );
      if (!g("integrationSettings").classList.contains("hidden")) refresh();
    });
  }
  function open() {
    openAppearanceModal();
    KlyoCustomize.showTab("integrations");
  }
  async function refresh() {
    const version = ++ticket,
      root = g("integrationSettings");
    if (!g("integrationDirectory"))
      root.insertAdjacentHTML(
        "afterbegin",
        '<div id="integrationDirectory"></div>',
      );
    g("integrationDirectory").innerHTML =
      `<p role="status">${l("Loading integration status…", "Wczytywanie stanu integracji…")}</p>`;
    const endpoints = {
      communications: "/communications/status",
      calendars: "/calendar-integrations/status",
      sharepoint: "/sharepoint/status",
      gmail: "/integrations/gmail/status",
      smtp: "/integrations/mail/status",
      dhl: "/operations/tracking/status",
      sms: "/mfa/status",
      platform: "/integrations/platform/status",
      ...(shared() ? { fakturownia: "/communications/invoice-provider" } : {}),
    };
    const result = await Promise.allSettled(
      Object.values(endpoints).map((path) => API.get(path)),
    );
    if (version !== ticket) return;
    data = Object.fromEntries(
      Object.keys(endpoints).map((key, i) => [
        key,
        result[i].status === "fulfilled"
          ? result[i].value
          : { unavailable: true },
      ]),
    );
    render();
  }
  function state(item) {
    let d,
      conn,
      configured = true,
      connected = false,
      ready = true,
      error = false,
      detail = "";
    if (
      ["google_drive", "dropbox", "microsoft_mail", "apollo"].includes(item.id)
    ) {
      d = data.communications;
      conn = d?.connections?.find((c) => c.provider === item.id);
      connected = item.id === "apollo" ? d?.apollo_connected : !!conn;
      configured =
        item.id === "apollo" ||
        !!d?.providers?.find((p) => p.provider === item.id)?.configured;
      ready =
        item.id === "microsoft_mail" || item.id === "apollo" || !!conn?.root_id;
      error = !!conn?.sync_error;
      detail = conn?.root_name || conn?.account_name || "";
    } else if (item.id.endsWith("_calendar") && item.id !== "apple_calendar") {
      d = data.calendars;
      const provider = item.id === "google_calendar" ? "google" : "microsoft";
      conn = d?.connections?.find((c) => c.provider === provider);
      connected = !!conn;
      configured = !!d?.providers?.find((p) => p.provider === provider)
        ?.configured;
      ready = !!conn?.calendar_id;
      detail = conn?.calendar_name || conn?.account_name || "";
    } else if (item.id === "sharepoint") {
      d = data.sharepoint;
      connected = d?.connected;
      configured = d?.configured;
      ready = d?.ready;
      detail = d?.connection?.root_name || "";
    } else if (item.id === "sms") {
      d = data.sms;
      connected = d?.enabled;
      configured = d?.configured;
      detail = d?.phone || "";
    } else if (["gmail", "smtp", "fakturownia", "dhl"].includes(item.id)) {
      d = data[item.id];
      connected = item.id === "dhl" ? d?.configured : d?.connected;
      configured = item.id === "gmail" ? d?.configured : true;
      detail = d?.email || d?.subdomain || d?.from_email || "";
    } else if (item.id === "apple_calendar")
      return {
        label: l("File export", "Eksport pliku"),
        style: "neutral",
        configured: true,
        connected: false,
        ready: true,
      };
    else {
      d = data.platform;
      configured =
        !!d?.[
          {
            ai: "ai_configured",
            resend: "account_email_configured",
            stripe: "billing_configured",
            google_signin: "google_signin_configured",
          }[item.id]
        ];
      return {
        label: d?.unavailable
          ? l("Status unavailable", "Stan niedostępny")
          : configured
            ? l("Service available", "Usługa dostępna")
            : l("Operator setup needed", "Konfiguracja operatora"),
        style: configured ? "ready" : "neutral",
        configured,
        connected: false,
        ready: true,
      };
    }
    if (item.id === "fakturownia" && !shared())
      return {
        label: l("Owner manages connection", "Właściciel zarządza połączeniem"),
        style: "neutral",
        configured: true,
        connected: false,
        ready: false,
      };
    const apiKey = ["apollo", "dhl", "fakturownia"].includes(item.id);
    return {
      configured,
      connected,
      ready,
      conn,
      detail,
      style:
        error || d?.unavailable ? "error" : connected ? "ready" : "neutral",
      label: d?.unavailable
        ? l("Status unavailable · retry", "Stan niedostępny · ponów")
        : !configured
          ? l("Operator setup needed", "Konfiguracja operatora")
          : error
            ? l("Connection needs attention", "Połączenie wymaga uwagi")
            : connected && !ready
              ? l("Finish setup", "Dokończ konfigurację")
              : connected
                ? apiKey
                  ? l("Credentials saved", "Dane połączenia zapisane")
                  : l("Connected", "Połączono")
                : l("Not connected", "Niepołączone"),
    };
  }
  function allowed(item) {
    if (item.id === "microsoft_mail" && API.getUser()?.role === "viewer")
      return false;
    return item.kind === "shared"
      ? shared()
      : item.kind === "admin"
        ? API.getUser()?.role === "admin"
        : true;
  }
  function render() {
    const root = g("integrationDirectory");
    if (!root) return;
    root.innerHTML = `<header class="integration-heading"><div><span class="miy-eyebrow">${l("YOUR TOOLS, CONNECTED", "TWOJE NARZĘDZIA, POŁĄCZONE")}</span><h3>${l("Integrations", "Integracje")}</h3><p>${l("Connect your own accounts here. Shared connections belong to the active workspace; private connections belong to you.", "Połącz tutaj własne konta. Wspólne połączenia należą do aktywnej przestrzeni, a prywatne tylko do Ciebie.")}</p></div><button type="button" class="btn btn-ghost btn-sm" id="integrationRefresh">${l("Refresh", "Odśwież")}</button></header><div class="integration-context">${API.scope() === "personal" ? l("Personal · only you", "Personal · tylko Ty") : l("Team · shared workspace", "Team · wspólna przestrzeń")} · ${l("Saving an API key does not confirm provider access. Test it in the relevant tool.", "Zapisanie klucza API nie potwierdza dostępu u dostawcy. Sprawdź go w odpowiednim narzędziu.")}</div><div class="integration-search"><input id="integrationSearch" type="search" placeholder="${l("Find an integration", "Znajdź integrację")}" value="${h(query)}"></div><nav class="integration-categories" aria-label="${l("Integration categories", "Kategorie integracji")}">${["all", "files", "email", "calendar", "sales", "account"].map((key) => `<button type="button" data-integration-category="${key}" aria-pressed="${activeCategory === key}">${categoryName(key)}</button>`).join("")}</nav><div class="integration-grid">${catalog
      .map((item) => {
        const s = state(item);
        return `<article class="integration-card" data-integration="${item.id}" data-category="${item.category}"><div class="integration-card-top"><span class="integration-logo" style="--provider-color:${item.color}">${item.mark}</span><span class="integration-status" data-state="${s.style}">${h(s.label)}</span></div><h4>${item.name}</h4><small class="integration-privacy">${item.kind === "private" ? l("Your account · private", "Twoje konto · prywatne") : item.kind === "shared" || item.kind === "admin" ? l("Shared workspace connection", "Wspólne połączenie przestrzeni") : item.kind === "export" ? l("Manual export", "Eksport ręczny") : l("Configured by the Klyo operator", "Konfiguruje operator Klyo")}</small><p>${h(l(...item.description))}</p>${s.detail ? `<div class="integration-detail">${h(s.detail)}</div>` : ""}<div class="integration-card-actions"><button type="button" class="btn btn-primary btn-sm" data-integration-action="${item.id}" ${!allowed(item) ? "disabled" : ""}>${h(!allowed(item) ? (item.id === "microsoft_mail" ? l("Editor access required", "Wymagany dostęp do edycji") : l("Workspace owner required", "Wymagany właściciel przestrzeni")) : item.kind === "platform" ? l("Details", "Szczegóły") : item.kind === "export" ? l("Open calendar", "Otwórz kalendarz") : s.connected ? l("Manage", "Zarządzaj") : s.configured ? l("Connect", "Połącz") : l("Setup guide", "Instrukcja konfiguracji"))}</button><a href="${item.guide || "/docs/communications-setup"}" target="_blank" rel="noopener">${l("Guide", "Instrukcja")} ↗</a></div></article>`;
      })
      .join(
        "",
      )}</div><p id="integrationEmpty" hidden>${l("No matching integrations.", "Brak pasujących integracji.")}</p>`;
    g("integrationRefresh").onclick = refresh;
    g("integrationSearch").oninput = (e) => {
      query = e.target.value;
      filter();
    };
    root.querySelectorAll("[data-integration-category]").forEach(
      (b) =>
        (b.onclick = () => {
          activeCategory = b.dataset.integrationCategory;
          root
            .querySelectorAll("[data-integration-category]")
            .forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
          filter();
        }),
    );
    root.querySelectorAll("[data-integration-action]").forEach(
      (b) =>
        (b.onclick = async () => {
          b.disabled = true;
          try {
            await connect(b.dataset.integrationAction);
          } catch (e) {
            toast(e.message, "error");
          } finally {
            if (b.isConnected) b.disabled = false;
          }
        }),
    );
    filter();
  }
  function filter() {
    let count = 0;
    g("integrationDirectory")
      .querySelectorAll("[data-integration]")
      .forEach((card) => {
        card.hidden =
          (activeCategory !== "all" &&
            card.dataset.category !== activeCategory) ||
          !card.textContent.toLowerCase().includes(query.toLowerCase());
        if (!card.hidden) count++;
      });
    g("integrationEmpty").hidden = !!count;
  }
  function leaveSettings() {
    closeAppearanceModal();
  }
  async function connect(id) {
    const item = catalog.find((x) => x.id === id),
      s = state(item);
    if (!allowed(item)) return;
    if (
      !s.configured &&
      !["smtp", "apollo", "dhl", "fakturownia"].includes(id)
    ) {
      const d = KlyoDocumentTools.dialog(
        l("Operator configuration required", "Wymagana konfiguracja operatora"),
        `<p>${l("The Klyo operator must configure this provider before accounts can connect. You do not enter server secrets here.", "Operator Klyo musi skonfigurować dostawcę, zanim będzie można łączyć konta. Nie wpisuj tutaj sekretów serwera.")}</p><a class="btn btn-primary" href="${item.guide || "/docs/communications-setup"}" target="_blank" rel="noopener">${l("Open setup guide", "Otwórz instrukcję")}</a>`,
      );
      return;
    }
    if (id === "smtp") {
      const details = g("integrationSmtpSettings");
      details.hidden = false;
      details.open = true;
      g("mailCard").classList.remove("hidden");
      details.scrollIntoView({ behavior: "smooth", block: "start" });
      g("smtpHost").focus();
      return;
    }
    if (id === "gmail") {
      if (s.connected) {
        const d = KlyoDocumentTools.dialog(
          "Gmail",
          `<p>${h(s.detail)}</p><p>${l("This account sends messages for the active workspace.", "To konto wysyła wiadomości w aktywnej przestrzeni.")}</p><button type="button" class="btn btn-danger" id="hubDisconnectGmail">${l("Disconnect", "Odłącz")}</button>`,
        );
        d.find("#hubDisconnectGmail").onclick = async () => {
          try {
            await API.post("/integrations/gmail/disconnect", {});
            d.close();
            await refresh();
          } catch (e) {
            d.error(e);
          }
        };
      } else {
        const r = await API.post("/integrations/gmail/connect", {});
        location.assign(r.url);
      }
      return;
    }
    if (["apollo", "dhl", "fakturownia"].includes(id)) {
      keyForm(id, s);
      return;
    }
    if (id === "sharepoint") {
      leaveSettings();
      await KlyoFiles.configure();
      return;
    }
    if (id === "microsoft_mail") {
      if (s.connected) {
        leaveSettings();
        switchView("inbox");
      } else await KlyoCommunications.connect(id);
      return;
    }
    if (id === "google_drive" || id === "dropbox") {
      if (s.connected) {
        leaveSettings();
        await KlyoCloudFiles.setup(s.conn.id);
      } else await KlyoCommunications.connect(id);
      return;
    }
    if (id === "google_calendar" || id === "outlook_calendar") {
      leaveSettings();
      await KlyoCalendar.settings();
      return;
    }
    if (id === "apple_calendar") {
      leaveSettings();
      switchView("calendar");
      return;
    }
    if (id === "resend") { window.open("/docs/account-access.html","_blank","noopener"); return; }
    if (id === "sms") {
      leaveSettings();
      await KlyoMFA.settings();
      return;
    }
    if (id === "ai" || id === "stripe") {
      KlyoCustomize.showTab("account");
      const target =
        id === "ai" ? g("aiContextInput") : g("settingsCurrentPlan");
      target?.scrollIntoView({ block: "center", behavior: "smooth" });
      return;
    }
    if (id === "google_signin")
      KlyoDocumentTools.dialog(
        l("Google sign-in", "Logowanie Google"),
        `<p>${l("Use Continue with Google on the Klyo sign-in page. Google Calendar, Drive and Gmail are connected separately and each asks for its own consent.", "Użyj Kontynuuj z Google na stronie logowania Klyo. Kalendarz Google, Dysk i Gmail łączy się osobno, każde połączenie wymaga zgody.")}</p>`,
      );
  }
  function keyForm(id, s) {
    const item = catalog.find((x) => x.id === id),
      invoice = id === "fakturownia";
    const d = KlyoDocumentTools.dialog(
      item.name,
      `<p>${l("Use credentials from your own provider account. They are saved for this workspace, not for every Klyo customer.", "Użyj danych z własnego konta dostawcy. Zapiszą się w tej przestrzeni, a nie dla wszystkich użytkowników Klyo.")}</p><form>${invoice ? `<label>${l("Account subdomain", "Subdomena konta")}<input name="subdomain" required maxlength="63" value="${h(data.fakturownia?.subdomain || "")}" placeholder="my-company"></label>` : ""}<label>${invoice ? l("API token", "Token API") : l("API key", "Klucz API")}<input name="key" type="password" autocomplete="off" required maxlength="2000"></label><p>${id === "apollo" ? l("Search and enrichment access depend on your Apollo plan. Import may use credits.", "Dostęp do wyszukiwania i danych zależy od planu Apollo. Import może zużywać kredyty.") : id === "dhl" ? l("Use a key for DHL Tracking Unified API. This connection does not buy shipping labels.", "Użyj klucza DHL Tracking Unified API. To połączenie nie kupuje etykiet przewozowych.") : l("Connecting does not issue or send an invoice.", "Połączenie nie wystawia ani nie wysyła faktury.")}</p><button class="btn btn-primary" type="submit">${l("Save connection", "Zapisz połączenie")}</button></form>${s.connected ? `<button type="button" class="btn btn-danger" id="hubDisconnectKey">${l("Disconnect", "Odłącz")}</button>` : ""}`,
    );
    const path =
      id === "apollo"
        ? "/communications/apollo"
        : id === "dhl"
          ? "/operations/tracking/connection"
          : "/communications/invoice-provider";
    d.find("form").onsubmit = async (e) => {
      e.preventDefault();
      const b = e.target.querySelector("button");
      b.disabled = true;
      try {
        const f = e.target.elements;
        await API.put(
          path,
          invoice
            ? { subdomain: f.subdomain.value, api_token: f.key.value }
            : { api_key: f.key.value },
        );
        f.key.value = "";
        d.close();
        await refresh();
        toast(l("Connection credentials saved.", "Zapisano dane połączenia."));
      } catch (e) {
        d.error(e);
      } finally {
        if (b.isConnected) b.disabled = false;
      }
    };
    d.find("#hubDisconnectKey")?.addEventListener("click", async () => {
      try {
        if (
          !confirm(
            l(
              "Remove this workspace connection?",
              "Usunąć to połączenie z przestrzeni?",
            ),
          )
        )
          return;
        await API.del(path);
        d.close();
        await refresh();
      } catch (e) {
        d.error(e);
      }
    });
  }
  return { init, open, refresh };
})();
window.KlyoIntegrations = KlyoIntegrations;
