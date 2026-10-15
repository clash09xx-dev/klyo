/* Team/Personal isolation, record fields, warranty reminders and team administration. */
const KlyoWorkspace = (() => {
  const g = (id) => document.getElementById(id),
    h = (v) =>
      String(v ?? "").replace(
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
  const pl = () => KlyoI18n.getLang() === "pl",
    l = (en, pol) => (pl() ? pol : en);
  const seenNotices = new Set();
  const ink = (color) => {
    const rgb = String(color)
      .replace("#", "")
      .match(/../g)
      ?.map((v) => parseInt(v, 16));
    return rgb?.length === 3 &&
      rgb[0] * 0.299 + rgb[1] * 0.587 + rgb[2] * 0.114 < 150
      ? "#ffffff"
      : "#101828";
  };
  let spaceInfo = null,
    fieldDefs = { contact: [], product: [] },
    fieldValues = { contact: {}, product: {} },
    warrantyItems = [],
    notifications = [],
    copyRecords = [],
    copyIds = new Set(),
    timer;
  const editor = () => API.getUser()?.role !== "viewer";
  function show(id) {
    g(id).classList.remove("hidden");
  }
  function close(id) {
    g(id).classList.add("hidden");
  }
  async function refreshSpaces() {
    spaceInfo = await API.get("/spaces");
    document.body.dataset.space = spaceInfo.active;
    document.querySelectorAll("[data-switch-space]").forEach((b) => {
      b.setAttribute(
        "aria-pressed",
        String(b.dataset.switchSpace === spaceInfo.active),
      );
      b.disabled = b.dataset.switchSpace === "team" && !spaceInfo.team;
    });
    g("copyTeamBtn").hidden =
      spaceInfo.active !== "personal" || !spaceInfo.team;
    g("createTeamBtn").hidden = !!spaceInfo.team;
    g("workspaceScopeLabel").textContent =
      spaceInfo.active === "personal"
        ? l("Private · only you", "Prywatne · tylko Ty")
        : spaceInfo.team?.name || "Team";
  }
  function switchSpace(scope) {
    if (scope === API.scope()) return;
    API.setScope(scope);
    window.location.reload();
  }
  async function loadFields(entity) {
    const { fields } = await API.get("/custom-fields?entity=" + entity);
    fieldDefs[entity] = fields;
    return fields;
  }
  async function editFields(entity, record) {
    const container = g(entity + "CustomFields");
    container.innerHTML = `<p class="muted">${l("Loading fields…", "Wczytywanie pól…")}</p>`;
    const defs = await loadFields(entity);
    fieldValues[entity] = { ...(record?.custom_fields || {}) };
    container.innerHTML =
      `<div class="custom-fields-heading"><strong>${l("Your fields", "Twoje pola")}</strong><button type="button" class="btn btn-ghost btn-sm" data-manage-fields="${entity}">${l("Manage fields", "Zarządzaj polami")}</button></div>` +
      defs
        .map((d) => {
          const value = fieldValues[entity][d.field_key],
            id = "custom-" + entity + "-" + d.field_key,
            required = d.required ? "required" : "",
            attrs = `id="${id}" data-custom-key="${d.field_key}" ${required}`;
          const input =
            d.type === "select"
              ? `<select ${attrs}><option value="">—</option>${d.options.map((o) => `<option ${value === o ? "selected" : ""}>${h(o)}</option>`).join("")}</select>`
              : d.type === "textarea"
                ? `<textarea ${attrs} maxlength="8000">${h(value)}</textarea>`
                : d.type === "checkbox"
                  ? `<input id="${id}" data-custom-key="${d.field_key}" type="checkbox" ${value ? "checked" : ""}>`
                  : `<input ${attrs} type="${["number", "date"].includes(d.type) ? d.type : "text"}" ${d.type === "number" ? 'step="any"' : ""} value="${h(value)}" maxlength="1000">`;
          return `<div class="field custom-field-${d.type}"><label for="${id}">${h(d.name)}${d.required ? " *" : ""}</label>${input}</div>`;
        })
        .join("") +
      (!defs.length
        ? `<p class="muted">${l("Add characteristics that matter to your business.", "Dodaj cechy ważne w Twojej firmie.")}</p>`
        : "");
    container
      .querySelector("[data-manage-fields]")
      .addEventListener("click", () => manageFields(entity));
  }
  function collectFields(entity) {
    const result = { ...fieldValues[entity] };
    for (const d of fieldDefs[entity]) {
      const el = g("custom-" + entity + "-" + d.field_key);
      if (!el) continue;
      result[d.field_key] =
        d.type === "checkbox"
          ? el.checked
          : d.type === "number"
            ? el.value === ""
              ? null
              : Number(el.value)
            : el.value || null;
    }
    return result;
  }
  async function manageFields(entity) {
    g("fieldEntity").value = entity;
    g("fieldId").value = "";
    g("fieldName").value = "";
    g("fieldType").value = "text";
    g("fieldOptions").value = "";
    g("fieldRequired").checked = false;
    g("fieldError").textContent = "";
    g("fieldType").disabled = false;
    show("customFieldOverlay");
    await renderFieldList(entity);
  }
  async function renderFieldList(entity) {
    const defs = await loadFields(entity);
    g("customFieldList").innerHTML =
      defs
        .map(
          (d) =>
            `<div class="field-list-row"><div><b>${h(d.name)}</b><span>${h(d.type)}${d.required ? " · " + l("required", "wymagane") : ""}</span></div><button type="button" class="btn btn-ghost btn-sm" data-edit-field="${d.id}">${l("Edit", "Edytuj")}</button><button type="button" class="btn btn-ghost btn-sm" data-archive-field="${d.id}">${l("Archive", "Archiwizuj")}</button></div>`,
        )
        .join("") ||
      `<p class="muted">${l("No custom fields yet.", "Brak własnych pól.")}</p>`;
    g("customFieldList")
      .querySelectorAll("[data-edit-field]")
      .forEach(
        (b) =>
          (b.onclick = () => {
            const d = defs.find((d) => d.id === Number(b.dataset.editField));
            g("fieldId").value = d.id;
            g("fieldName").value = d.name;
            g("fieldType").value = d.type;
            g("fieldType").disabled = true;
            g("fieldOptions").value = d.options.join("\n");
            g("fieldRequired").checked = d.required;
          }),
      );
    g("customFieldList")
      .querySelectorAll("[data-archive-field]")
      .forEach(
        (b) =>
          (b.onclick = async () => {
            try {
              if (
                !confirm(
                  l(
                    "Archive this field? Saved values are kept.",
                    "Zarchiwizować pole? Zapisane wartości pozostaną zachowane.",
                  ),
                )
              )
                return;
              await API.del("/custom-fields/" + b.dataset.archiveField);
              await renderFieldList(entity);
              await refreshRecordFields(entity);
            } catch (e) {
              g("fieldError").textContent = e.message;
            }
          }),
      );
  }
  async function refreshRecordFields(entity) {
    const values = collectFields(entity);
    await editFields(entity, { custom_fields: values });
  }
  async function openCopy() {
    show("spaceCopyOverlay");
    g("spaceCopyError").textContent = "";
    g("spaceCopySummary").textContent = "";
    g("copyMode").value = "products";
    g("copyAllRecords").checked = true;
    await copyModeChanged();
  }
  async function copyModeChanged() {
    copyIds.clear();
    g("copyRunBtn").disabled = false;
    const mode = g("copyMode").value;
    g("copySelectionWrap").hidden = mode === "everything";
    copyRecords = [];
    g("copyRecordList").innerHTML = "";
    if (mode !== "everything") {
      copyRecords = (await API.get("/spaces/source?entity=" + mode)).records;
      renderCopyRecords();
    }
    await copyPreview();
  }
  function renderCopyRecords() {
    const query = g("copySearch").value.toLowerCase();
    g("copyRecordList").innerHTML = copyRecords
      .filter((r) => r.name.toLowerCase().includes(query))
      .map(
        (r) =>
          `<label><input type="checkbox" value="${r.id}" ${copyIds.has(r.id) ? "checked" : ""} ${g("copyAllRecords").checked ? "disabled" : ""}><span>${h(r.name)}</span></label>`,
      )
      .join("");
    g("copyRecordList")
      .querySelectorAll("input")
      .forEach(
        (el) =>
          (el.onchange = () => {
            if (el.checked) copyIds.add(Number(el.value));
            else copyIds.delete(Number(el.value));
            copyPreview().catch(
              (e) => (g("spaceCopyError").textContent = e.message),
            );
          }),
      );
  }
  const copyBody = () => ({
    mode: g("copyMode").value,
    ids:
      g("copyMode").value === "everything" || g("copyAllRecords").checked
        ? null
        : [...copyIds],
  });
  async function copyPreview() {
    const b = copyBody();
    g("copyRunBtn").disabled = Array.isArray(b.ids) && !b.ids.length;
    if (g("copyRunBtn").disabled) {
      g("spaceCopySummary").textContent = l(
        "Select records to copy.",
        "Wybierz rekordy do skopiowania.",
      );
      return;
    }
    const result = await API.post("/spaces/copy/preview", b);
    g("spaceCopySummary").textContent = Object.entries(result.counts)
      .map(([k, v]) => k + ": " + v)
      .join(" · ");
  }
  async function loadWarranty() {
    const data = await API.get("/warranty");
    warrantyItems = data.items;
    renderWarranty(data.today);
  }
  function renderWarranty(today) {
    const filter = g("warrantyFilter").value,
      query = g("warrantySearch").value.toLowerCase(),
      items = warrantyItems.filter((w) => {
        const due =
          w.status === "active" &&
          w.next_review_on &&
          w.next_review_on <= today;
        return (
          (filter === "all" ||
            (filter === "due" && due) ||
            (filter === "upcoming" &&
              w.status === "active" &&
              w.next_review_on > today) ||
            (filter === "closed" && w.status === "closed")) &&
          [w.product_name, w.contact_name, w.serial_number]
            .join(" ")
            .toLowerCase()
            .includes(query)
        );
      });
    g("warrantyList").innerHTML = items.length
      ? items
          .map((w) => {
            const due =
                w.status === "active" &&
                w.next_review_on &&
                w.next_review_on <= today,
              expired = w.warranty_until < today;
            return `<article class="warranty-card ${due ? "is-due" : ""}" style="--review-color:${h(w.color)};--review-ink:${ink(w.color)}"><div><span class="warranty-state">${w.status === "closed" ? l("Closed", "Zamknięta") : due ? l("REVIEW DUE", "CZAS NA PRZEGLĄD") : l("Scheduled", "Zaplanowano")}</span><h3>${h(w.product_name)}${Number(w.quantity) > 1 ? " × " + h(w.quantity) : ""}</h3><button type="button" class="warranty-client" data-warranty-contact="${w.contact_id}">${h(w.contact_name)} ↗</button>${w.serial_number ? `<p>${l("Serial", "Numer seryjny")}: ${h(w.serial_number)}</p>` : ""}<p>${l("Warranty until", "Gwarancja do")}: ${h(w.warranty_until)}${expired ? " · " + l("Expired", "Wygasła") : ""}</p><p>${l("Next review", "Następny przegląd")}: <b>${h(w.next_review_on || "—")}</b></p>${w.notes ? `<p>${h(w.notes)}</p>` : ""}</div><div class="warranty-actions"><button type="button" class="btn btn-primary btn-sm" data-review-warranty="${w.id}" ${w.status === "closed" || !editor() ? "disabled" : ""}>${l("Record review", "Zapisz przegląd")}</button><button type="button" class="btn btn-ghost btn-sm" data-edit-warranty="${w.id}" ${editor() ? "" : "disabled"}>${l("Edit", "Edytuj")}</button></div></article>`;
          })
          .join("")
      : `<p class="muted">${l("No warranty records match this view.", "Brak gwarancji pasujących do tego widoku.")}</p>`;
    g("warrantyList")
      .querySelectorAll("[data-warranty-contact]")
      .forEach((b) => (b.onclick = () => openPanel(b.dataset.warrantyContact)));
    g("warrantyList")
      .querySelectorAll("[data-edit-warranty]")
      .forEach(
        (b) =>
          (b.onclick = () =>
            openWarranty(
              warrantyItems.find(
                (w) => w.id === Number(b.dataset.editWarranty),
              ),
            )),
      );
    g("warrantyList")
      .querySelectorAll("[data-review-warranty]")
      .forEach(
        (b) =>
          (b.onclick = () =>
            openReview(
              warrantyItems.find(
                (w) => w.id === Number(b.dataset.reviewWarranty),
              ),
            )),
      );
  }
  async function refreshNotifications() {
    const data = await API.get("/warranty/notifications");
    notifications = data.items;
    g("warrantyBellCount").textContent = data.count;
    g("warrantyBellCount").hidden = !data.count;
    g("warrantyBell").classList.toggle("has-alert", data.count > 0);
    g("warrantyBell").setAttribute(
      "aria-label",
      l("Warranty reviews due: ", "Przeglądy gwarancyjne na dziś: ") +
        data.count,
    );
    const fresh = data.items.find((w) => {
      const key = `klyo_warranty_notice:${API.getUser()?.id}:${API.getUser()?.workspace_id}:${w.id}:${w.next_review_on}`;
      let seen = false;
      try {
        seen = localStorage.getItem(key) === "1";
      } catch {}
      return !seen && !seenNotices.has(key);
    });
    if (fresh) {
      const key = `klyo_warranty_notice:${API.getUser()?.id}:${API.getUser()?.workspace_id}:${fresh.id}:${fresh.next_review_on}`;
      seenNotices.add(key);
      try {
        localStorage.setItem(key, "1");
      } catch {}
      let notice = g("warrantyLiveNotice");
      if (!notice) {
        notice = document.createElement("aside");
        notice.id = "warrantyLiveNotice";
        notice.setAttribute("role", "status");
        document.body.appendChild(notice);
      }
      notice.style.setProperty("--review-color", fresh.color);
      notice.innerHTML = `<button type="button" class="warranty-notice-close" aria-label="Close">×</button><strong>${l("Warranty review due", "Czas na przegląd gwarancyjny")}</strong><p>${h(fresh.product_name)} · ${h(fresh.contact_name)}</p><button type="button" class="btn btn-ghost btn-sm warranty-notice-open">${l("Open item", "Otwórz produkt")} ↗</button>`;
      notice.querySelector(".warranty-notice-close").onclick = () =>
        notice.remove();
      notice.querySelector(".warranty-notice-open").onclick = async () => {
        notice.remove();
        switchView("reminders");
        await loadWarranty();
        await openWarranty(warrantyItems.find((w) => w.id === fresh.id));
      };
    }
    g("warrantyNotificationList").innerHTML = data.items.length
      ? data.items
          .map(
            (w) =>
              `<button type="button" class="warranty-alert" style="--review-color:${h(w.color)};--review-ink:${ink(w.color)}" data-alert-warranty="${w.id}"><b>${l("Warranty review", "Przegląd gwarancyjny")}: ${h(w.product_name)}</b><span>${h(w.contact_name)} · ${h(w.next_review_on)}</span></button>`,
          )
          .join("")
      : `<p class="muted">${l("No warranty reviews are due.", "Brak przeglądów na dziś.")}</p>`;
    g("warrantyNotificationList")
      .querySelectorAll("[data-alert-warranty]")
      .forEach(
        (b) =>
          (b.onclick = async () => {
            close("warrantyNotifications");
            switchView("reminders");
            await loadWarranty();
            await openWarranty(
              warrantyItems.find(
                (w) => w.id === Number(b.dataset.alertWarranty),
              ),
            );
          }),
      );
  }
  const dateToday = () =>
    new Intl.DateTimeFormat("en-CA", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  function plusMonths(date, months) {
    const [y, m, d] = date.split("-").map(Number),
      result = new Date(y, m - 1 + Number(months), 1, 12),
      last = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate();
    result.setDate(Math.min(d, last));
    return `${result.getFullYear()}-${String(result.getMonth() + 1).padStart(2, "0")}-${String(result.getDate()).padStart(2, "0")}`;
  }
  async function openWarranty(item = null, contactId = null) {
    g("warrantyError").textContent = "";
    g("warrantyId").value = item?.id || "";
    g("warrantyTitle").textContent = item
      ? l("Edit warranty item", "Edytuj gwarancję")
      : l("Register warranty item", "Dodaj produkt na gwarancji");
    show("warrantyOverlay");
    g("warrantySave").disabled = true;
    try {
      const [cts, ps] = await Promise.all([
        API.get("/contacts"),
        API.get("/products"),
      ]);
      g("warrantyContact").innerHTML =
        '<option value="">—</option>' +
        cts.contacts
          .map((c) => `<option value="${c.id}">${h(c.full_name)}</option>`)
          .join("");
      g("warrantyProduct").innerHTML =
        '<option value="">—</option>' +
        ps.products
          .map(
            (p) =>
              `<option value="${p.id}" data-months="${p.warranty_months || ""}" data-interval="${p.service_interval_months || ""}">${h(p.name)}</option>`,
          )
          .join("");
      g("warrantyContact").value = item?.contact_id || contactId || "";
      g("warrantyProduct").value = item?.product_id || "";
      for (const [id, key, fallback] of [
        ["warrantyProductName", "product_name", ""],
        ["warrantySerial", "serial_number", ""],
        ["warrantyQuantity", "quantity", 1],
        ["warrantyPurchased", "purchased_on", dateToday()],
        ["warrantyMonths", "warranty_months", 60],
        ["warrantyInterval", "review_interval_months", 12],
        ["warrantyNext", "next_review_on", plusMonths(dateToday(), 12)],
        ["warrantyColor", "color", "#f59e0b"],
        ["warrantyNotes", "notes", ""],
        ["warrantyStatus", "status", "active"],
      ])
        g(id).value = item?.[key] ?? fallback;
      const history = item
        ? (await API.get("/warranty/" + item.id + "/reviews")).reviews
        : [];
      g("warrantyReviewHistory").innerHTML = history
        .map(
          (r) =>
            `<div class="warranty-history"><b>${h(r.performed_on)}</b> · ${h(r.user_name || "")}<p>${h(r.notes)}</p></div>`,
        )
        .join("");
      g("warrantySave").disabled = !editor();
    } catch (e) {
      g("warrantyError").textContent = e.message;
    }
  }
  function updateWarrantyDates() {
    if (g("warrantyPurchased").value && g("warrantyInterval").value) {
      const next = plusMonths(
          g("warrantyPurchased").value,
          g("warrantyInterval").value,
        ),
        end = plusMonths(
          g("warrantyPurchased").value,
          g("warrantyMonths").value,
        );
      g("warrantyNext").value = next <= end ? next : "";
    }
  }
  function openReview(item) {
    g("reviewWarrantyId").value = item.id;
    g("reviewWarrantyTitle").textContent =
      item.product_name + " · " + item.contact_name;
    g("reviewPerformed").value = dateToday();
    const next = item.review_interval_months
      ? plusMonths(dateToday(), item.review_interval_months)
      : "";
    g("reviewNext").value = next && next <= item.warranty_until ? next : "";
    g("reviewNotes").value = "";
    g("reviewError").textContent = "";
    show("warrantyReviewOverlay");
  }
  function auditLabel(entry){
    const parts=String(entry.resource||'').split('/').filter(Boolean),category=parts[1],detail=parts.at(-1);
    const names={contacts:l('Contact','Kontakt'),companies:l('Company','Firma'),products:l('Product','Produkt'),deals:l('Deal','Szansa sprzedaży'),quotes:l('Proposal','Oferta'),offers:l('Email draft','Szkic wiadomości'),tasks:l('Task','Zadanie'),calendar:l('Calendar event','Wydarzenie'),'custom-fields':l('Custom field','Własne pole'),'quote-templates':l('Proposal template','Szablon oferty'),warranty:l('Warranty','Gwarancja'),pipelines:l('Sales pipeline','Lejek sprzedaży'),auth:l('Account & team','Konto i zespół'),billing:l('Plan & seats','Plan i miejsca'),spaces:l('Workspace','Przestrzeń'),sales:l('Sales settings','Ustawienia sprzedaży'),integrations:l('Mail connection','Połączenie poczty')};
    const actions={POST:l('Added','Dodano'),PUT:l('Updated','Zmieniono'),PATCH:l('Updated','Zmieniono'),DELETE:l('Removed','Usunięto')};
    let action=actions[entry.action]||l('Changed','Zmieniono');
    if(detail==='review')action=l('Review recorded','Zapisano przegląd');
    else if(detail==='send')action=l('Sent','Wysłano');
    else if(detail==='accept')action=l('Accepted','Zaakceptowano');
    else if(category==='billing'||category==='auth'||category==='spaces')action=l('Updated','Zmieniono');
    const id=parts.find((p,i)=>i>1&&/^\d+$/.test(p));
    return {action,record:(names[category]||l('Workspace settings','Ustawienia przestrzeni'))+(id?' #'+id:'')};
  }
  async function teamAdmin() {
    g("teamAuditSection").hidden = !API.getUser()?.is_team_owner;
    if (!API.getUser()?.is_team_owner) return;
    try {
      const [{ entries }, seats] = await Promise.all([
        API.get("/spaces/audit"),
        API.get("/billing/seats"),
      ]);
      g("teamAuditRows").innerHTML =
        entries
          .map(
            (e) =>
              `<tr><td>${h(formatDateTime(e.created_at))}</td><td>${h(e.user_name || "")}</td><td>${h(auditLabel(e).action)}</td><td>${h(auditLabel(e).record)}</td></tr>`,
          )
          .join("") ||
        `<tr><td colspan="4">${l("No administrative activity yet.", "Brak zarejestrowanych działań.")}</td></tr>`;
      g("teamSeatSummary").textContent =
        `${seats.used} ${l("people", "osób")} · ${l("included", "w planie")}: ${seats.included ?? "∞"} · ${l("additional", "dodatkowe")}: ${seats.extra} · ${seats.total_monthly} USD / ${l("month", "miesiąc")}`;
      g("extraSeatCount").value = seats.extra;
      g("seatManager").hidden = seats.unlimited;
    } catch (e) {
      g("teamAdminError").textContent = e.message;
    }
  }
  function onView(view) {
    if (view === "reminders")
      loadWarranty().catch((e) => toast(e.message, "error"));
    if (view === "team") teamAdmin();
  }
  function labels() {
    document
      .querySelectorAll("[data-ws-en]")
      .forEach(
        (el) => (el.textContent = pl() ? el.dataset.wsPl : el.dataset.wsEn),
      );
  }
  function field(label, id, type = "text", extra = "") {
    return `<div class="field"><label for="${id}">${label}</label><input id="${id}" type="${type}" ${extra}></div>`;
  }
  const label = (en, pol) => l(en, pol);
  function modal(id, title, content) {
    return `<div class="overlay hidden workspace-tools-overlay" id="${id}"><div class="modal"><div class="modal-head"><h2>${title}</h2><button type="button" class="modal-close" data-close-tool="${id}" aria-label="Close">×</button></div>${content}</div></div>`;
  }
  function mount() {
    document
      .querySelector(".brand")
      .insertAdjacentHTML(
        "afterend",
        `<div class="workspace-switch-wrap"><div class="workspace-switch" role="group" aria-label="CRM scope"><button type="button" data-switch-space="team" aria-pressed="${API.scope() === "team"}">Team</button><button type="button" data-switch-space="personal" aria-pressed="${API.scope() === "personal"}">Personal</button></div><span id="workspaceScopeLabel"></span><button type="button" class="btn btn-ghost btn-sm" id="copyTeamBtn" hidden>↙ ${l("Copy from Team", "Kopiuj z Team")}</button><button type="button" class="btn btn-ghost btn-sm" id="createTeamBtn" hidden>+ ${l("Create team", "Utwórz zespół")}</button></div>`,
      );
    document
      .querySelector(".topbar")
      .insertAdjacentHTML(
        "beforeend",
        `<button type="button" class="warranty-bell" id="warrantyBell" aria-label="Warranty reviews"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M10 21h4"/></svg><span id="warrantyBellCount" hidden></span></button>`,
      );
    g("remindersView").insertAdjacentHTML(
      "afterbegin",
      `<section class="warranty-section"><div class="warranty-heading"><div><h2>${l("Warranty & maintenance", "Gwarancje i przeglądy")}</h2><p class="muted">${l("Your client, their product, the next review. You decide when to contact them.", "Klient, jego produkt i następny przegląd. Ty decydujesz, kiedy się z nim kontaktujesz.")}</p></div><button type="button" class="btn btn-primary btn-sm" id="addWarrantyBtn">+ ${l("Register item", "Dodaj produkt")}</button></div><div class="filter-bar"><input id="warrantySearch" type="search" placeholder="${l("Client, product or serial…", "Klient, produkt lub numer seryjny…")}" aria-label="Search warranty"><select id="warrantyFilter"><option value="all">${l("All items", "Wszystkie produkty")}</option><option value="due">${l("Review due", "Do przeglądu")}</option><option value="upcoming">${l("Upcoming", "Nadchodzące")}</option><option value="closed">${l("Closed", "Zamknięte")}</option></select></div><div id="warrantyList"></div></section><h3 class="legacy-reminders-heading">${l("Other service reminders", "Pozostałe przypomnienia serwisowe")}</h3>`,
    );
    g("teamView").insertAdjacentHTML(
      "beforeend",
      `<section id="teamAuditSection" hidden><div class="section-title">${l("Team owner · administration", "Właściciel zespołu · administracja")}</div><div id="teamSeatSummary"></div><div id="seatManager" class="seat-manager" hidden>${field(l("Additional seats · 5 USD each / month", "Dodatkowe miejsca · 5 USD za osobę / mies."), "extraSeatCount", "number", 'min="0" max="1000" step="1"')}<button type="button" class="btn btn-primary btn-sm" id="buySeatsBtn">${l("Review seat change", "Sprawdź zmianę miejsc")}</button><p id="seatChangePrice" class="muted"></p></div><div id="teamAdminError" class="form-error"></div><div class="section-title">${l("Administrative activity", "Logi administracyjne")}</div><div class="table-card"><table><thead><tr><th>${l("When", "Kiedy")}</th><th>${l("Who", "Kto")}</th><th>${l("Action", "Działanie")}</th><th>${l("Resource", "Zasób")}</th></tr></thead><tbody id="teamAuditRows"></tbody></table></div><div class="team-transfer"><button type="button" class="btn btn-ghost btn-sm" id="transferTeamBtn">${l("Transfer team ownership", "Przekaż własność zespołu")}</button></div></section>`,
    );
    document.body.insertAdjacentHTML(
      "beforeend",
      modal(
        "customFieldOverlay",
        l("Your record fields", "Własne pola rekordów"),
        `<div id="customFieldList"></div><form id="customFieldForm"><input id="fieldId" type="hidden"><input id="fieldEntity" type="hidden">${field(l("Field name", "Nazwa pola"), "fieldName", "text", 'required maxlength="100"')}<div class="field"><label for="fieldType">${l("Type", "Typ")}</label><select id="fieldType"><option value="text">${l("Text", "Tekst")}</option><option value="textarea">${l("Long text", "Długi tekst")}</option><option value="number">${l("Number", "Liczba")}</option><option value="date">${l("Date", "Data")}</option><option value="select">${l("Choice list", "Lista wyboru")}</option><option value="checkbox">${l("Checkbox", "Pole wyboru")}</option></select></div><div class="field"><label for="fieldOptions">${l("Choice options · one per line", "Opcje listy · jedna w wierszu")}</label><textarea id="fieldOptions" maxlength="4000"></textarea></div><label class="tool-check"><input id="fieldRequired" type="checkbox">${l("Required field", "Pole wymagane")}</label><div id="fieldError" class="form-error"></div><div class="modal-actions"><button type="button" class="btn btn-ghost" data-close-tool="customFieldOverlay">${l("Done", "Gotowe")}</button><button class="btn btn-primary">${l("Save field", "Zapisz pole")}</button></div></form>`,
      ) +
        modal(
          "spaceCopyOverlay",
          l("Copy from Team to Personal", "Kopiuj z Team do Personal"),
          `<p class="muted">${l("Independent copies. Your team stays unchanged. Repeating a copy skips previously copied records and preserves your edits. Quotes and emails become drafts; nothing is sent.", "Niezależne kopie. Dane zespołu pozostają bez zmian. Ponowne kopiowanie pomija istniejące kopie i zachowuje Twoje zmiany. Oferty i maile stają się szkicami; nic nie jest wysyłane.")}</p><div class="field"><label for="copyMode">${l("What to copy", "Co skopiować")}</label><select id="copyMode"><option value="products">${l("Products", "Produkty")}</option><option value="contacts">${l("All clients / selected clients", "Wszyscy klienci / wybrani klienci")}</option><option value="companies">${l("Companies", "Firmy")}</option><option value="everything">${l("All CRM data", "Wszystkie dane CRM")}</option></select></div><div id="copySelectionWrap"><label class="tool-check"><input id="copyAllRecords" type="checkbox" checked>${l("Copy all records of this type", "Kopiuj wszystkie rekordy tego typu")}</label><input id="copySearch" type="search" placeholder="${l("Filter records…", "Filtruj rekordy…")}" aria-label="Filter records"><div id="copyRecordList"></div></div><p id="spaceCopySummary" class="copy-summary"></p><p class="muted">${l("Clients include their linked companies. All CRM data includes products, clients, companies, pipelines, deals, draft proposals, tasks, calendar, warranties and business history. Team members, invitations, billing, passwords and email connections are not copied.", "Klienci są kopiowani z powiązanymi firmami. Wszystkie dane CRM obejmują produkty, klientów, firmy, lejki, deale, szkice ofert, zadania, kalendarz, gwarancje i historię biznesową. Członkowie zespołu, zaproszenia, płatności, hasła i połączenia pocztowe nie są kopiowane.")}</p><div class="form-error" id="spaceCopyError"></div><div class="modal-actions"><button type="button" class="btn btn-ghost" data-close-tool="spaceCopyOverlay">${l("Cancel", "Anuluj")}</button><button type="button" class="btn btn-primary" id="copyRunBtn">${l("Copy to Personal", "Kopiuj do Personal")}</button></div>`,
        ) +
        modal(
          "warrantyNotifications",
          l("Warranty reviews", "Przeglądy gwarancyjne"),
          `<div id="warrantyNotificationList"></div>`,
        ) +
        modal(
          "warrantyOverlay",
          `<span id="warrantyTitle"></span>`,
          `<form id="warrantyForm"><input id="warrantyId" type="hidden"><div class="field-row"><div class="field"><label for="warrantyContact">${l("Client", "Klient")}</label><select id="warrantyContact" required></select></div><div class="field"><label for="warrantyProduct">${l("Product", "Produkt")}</label><select id="warrantyProduct"></select></div></div>${field(l("Item name (for custom or discontinued products)", "Nazwa produktu (dla własnych lub wycofanych produktów)"), "warrantyProductName", "text", 'maxlength="300"')}${field(l("Serial number / identifier", "Numer seryjny / identyfikator"), "warrantySerial", "text", 'maxlength="300"')}<div class="field-row">${field(l("Purchase date", "Data zakupu"), "warrantyPurchased", "date", "required")}${field(l("Quantity", "Ilość"), "warrantyQuantity", "number", 'required min="0.01" step="0.01"')}</div><div class="field-row">${field(l("Warranty · months (60 = 5 years)", "Gwarancja · miesiące (60 = 5 lat)"), "warrantyMonths", "number", 'required min="1" max="1200" step="1"')}${field(l("Review interval · months", "Przegląd co · miesiące"), "warrantyInterval", "number", 'min="1" max="1200" step="1"')}</div><div class="field-row">${field(l("Next review", "Następny przegląd"), "warrantyNext", "date")}${field(l("Notification colour", "Kolor powiadomienia"), "warrantyColor", "color")}</div><div class="field"><label for="warrantyStatus">${l("Status", "Status")}</label><select id="warrantyStatus"><option value="active">${l("Active", "Aktywna")}</option><option value="closed">${l("Closed", "Zamknięta")}</option></select></div><div class="field"><label for="warrantyNotes">${l("Notes", "Uwagi")}</label><textarea id="warrantyNotes" maxlength="10000"></textarea></div><div id="warrantyReviewHistory"></div><div id="warrantyError" class="form-error"></div><div class="modal-actions"><button type="button" class="btn btn-ghost" data-close-tool="warrantyOverlay">${l("Cancel", "Anuluj")}</button><button class="btn btn-primary" id="warrantySave">${l("Save item", "Zapisz produkt")}</button></div></form>`,
        ) +
        modal(
          "warrantyReviewOverlay",
          `<span id="reviewWarrantyTitle"></span>`,
          `<form id="warrantyReviewForm"><input id="reviewWarrantyId" type="hidden"><div class="field-row">${field(l("Review performed on", "Data wykonanego przeglądu"), "reviewPerformed", "date", "required")}${field(l("Next review (optional)", "Następny przegląd (opcjonalnie)"), "reviewNext", "date")}</div><div class="field"><label for="reviewNotes">${l("Review notes", "Uwagi z przeglądu")}</label><textarea id="reviewNotes" maxlength="5000"></textarea></div><div id="reviewError" class="form-error"></div><div class="modal-actions"><button type="button" class="btn btn-ghost" data-close-tool="warrantyReviewOverlay">${l("Cancel", "Anuluj")}</button><button class="btn btn-primary" id="reviewSave">${l("Confirm completed review", "Potwierdź wykonany przegląd")}</button></div></form>`,
        ),
    );
  }
  async function showContactFields(contact) {
    let el = g("contactCustomDetails");
    if (!el) {
      g("panelAdvanced").insertAdjacentHTML(
        "afterend",
        '<section id="contactCustomDetails" class="record-custom-fields"></section>',
      );
      el = g("contactCustomDetails");
    }
    el.innerHTML = "";
    try {
      const defs = await loadFields("contact");
      if (currentPanelContactId !== contact.id) return;
      el.innerHTML = defs
        .filter((d) => contact.custom_fields?.[d.field_key] != null)
        .map(
          (d) =>
            `<div class="detail-item"><div class="k">${h(d.name)}</div><div class="v">${h(d.type === "checkbox" ? (contact.custom_fields[d.field_key] ? l("Yes", "Tak") : l("No", "Nie")) : contact.custom_fields[d.field_key])}</div>`,
        )
        .join("");
      el.hidden = !el.innerHTML;
    } catch {
      el.hidden = true;
    }
  }
  async function init() {
    mount();
    document.body.dataset.space = API.scope();
    g("checkoutExtraSeats").addEventListener("input", renderPricingGrid);
    document
      .querySelectorAll("[data-switch-space]")
      .forEach((b) => (b.onclick = () => switchSpace(b.dataset.switchSpace)));
    document
      .querySelectorAll("[data-close-tool]")
      .forEach((b) => (b.onclick = () => close(b.dataset.closeTool)));
    document.querySelectorAll(".workspace-tools-overlay").forEach(
      (el) =>
        (el.onclick = (e) => {
          if (e.target === el) close(el.id);
        }),
    );
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape")
        document
          .querySelectorAll(".workspace-tools-overlay")
          .forEach((el) => el.classList.add("hidden"));
    });
    g("copyTeamBtn").onclick = () =>
      openCopy().catch((e) => (g("spaceCopyError").textContent = e.message));
    g("copyMode").onchange = () =>
      copyModeChanged().catch(
        (e) => (g("spaceCopyError").textContent = e.message),
      );
    g("copyAllRecords").onchange = () => {
      renderCopyRecords();
      copyPreview().catch((e) => (g("spaceCopyError").textContent = e.message));
    };
    g("copySearch").oninput = renderCopyRecords;
    g("copyRunBtn").onclick = async () => {
      const button = g("copyRunBtn");
      button.disabled = true;
      g("spaceCopyError").textContent = "";
      try {
        await API.post("/spaces/copy", copyBody());
        window.location.reload();
      } catch (e) {
        g("spaceCopyError").textContent = e.message;
        button.disabled = false;
      }
    };
    g("customFieldForm").onsubmit = async (e) => {
      e.preventDefault();
      g("fieldError").textContent = "";
      const button = e.submitter;
      button.disabled = true;
      try {
        const id = g("fieldId").value,
          body = {
            entity: g("fieldEntity").value,
            name: g("fieldName").value,
            type: g("fieldType").value,
            options: g("fieldOptions")
              .value.split("\n")
              .map((s) => s.trim())
              .filter(Boolean),
            required: g("fieldRequired").checked,
          };
        if (id) await API.put("/custom-fields/" + id, body);
        else await API.post("/custom-fields", body);
        await refreshRecordFields(body.entity);
        await renderFieldList(body.entity);
        g("fieldId").value = "";
        g("fieldName").value = "";
        g("fieldType").disabled = false;
        g("fieldOptions").value = "";
        g("fieldRequired").checked = false;
      } catch (e) {
        g("fieldError").textContent = e.message;
      } finally {
        button.disabled = false;
      }
    };
    g("warrantyBell").onclick = () => {
      refreshNotifications().catch((e) => toast(e.message, "error"));
      show("warrantyNotifications");
    };
    g("addWarrantyBtn").onclick = () => openWarranty();
    g("warrantyFilter").onchange = () => renderWarranty(dateToday());
    g("warrantySearch").oninput = () => renderWarranty(dateToday());
    g("warrantyProduct").onchange = () => {
      const o = g("warrantyProduct").selectedOptions[0];
      g("warrantyProductName").value = o.value ? o.textContent : "";
      if (o.dataset.months) g("warrantyMonths").value = o.dataset.months;
      if (o.dataset.interval) g("warrantyInterval").value = o.dataset.interval;
      updateWarrantyDates();
    };
    for (const id of [
      "warrantyPurchased",
      "warrantyInterval",
      "warrantyMonths",
    ])
      g(id).onchange = updateWarrantyDates;
    g("warrantyForm").onsubmit = async (e) => {
      e.preventDefault();
      const button = g("warrantySave");
      button.disabled = true;
      g("warrantyError").textContent = "";
      try {
        const body = {
            contact_id: g("warrantyContact").value,
            product_id: g("warrantyProduct").value || null,
            product_name:
              g("warrantyProductName").value ||
              g("warrantyProduct").selectedOptions[0]?.textContent,
            serial_number: g("warrantySerial").value,
            quantity: Number(g("warrantyQuantity").value),
            purchased_on: g("warrantyPurchased").value,
            warranty_months: Number(g("warrantyMonths").value),
            review_interval_months: g("warrantyInterval").value || null,
            next_review_on: g("warrantyNext").value || null,
            color: g("warrantyColor").value,
            notes: g("warrantyNotes").value,
            status: g("warrantyStatus").value,
          },
          id = g("warrantyId").value;
        if (id) await API.put("/warranty/" + id, body);
        else await API.post("/warranty", body);
        close("warrantyOverlay");
        await Promise.all([loadWarranty(), refreshNotifications()]);
      } catch (e) {
        g("warrantyError").textContent = e.message;
      } finally {
        button.disabled = false;
      }
    };
    g("warrantyReviewForm").onsubmit = async (e) => {
      e.preventDefault();
      g("reviewSave").disabled = true;
      g("reviewError").textContent = "";
      try {
        await API.post("/warranty/" + g("reviewWarrantyId").value + "/review", {
          performed_on: g("reviewPerformed").value,
          next_review_on: g("reviewNext").value || null,
          notes: g("reviewNotes").value,
        });
        close("warrantyReviewOverlay");
        close("warrantyOverlay");
        await Promise.all([loadWarranty(), refreshNotifications()]);
      } catch (e) {
        g("reviewError").textContent = e.message;
      } finally {
        g("reviewSave").disabled = false;
      }
    };
    g("buySeatsBtn").onclick = async () => {
      const extra = Number(g("extraSeatCount").value);
      if (!Number.isInteger(extra) || extra < 0 || extra > 1000) return;
      const info = await API.get("/billing/seats");
      const total = info.base_price + extra * info.unit_price;
      g("seatChangePrice").textContent =
        `${l("New recurring total", "Nowa cena cykliczna")}: ${total} USD / ${l("month", "miesiąc")}. ${l("A prorated amount may be due now.", "Może zostać naliczona proporcjonalna dopłata za bieżący okres.")}`;
      if (
        !confirm(
          l(
            `Confirm ${extra} extra seats at $5 each/month. New total: $${total}/month. Stripe may collect a prorated payment now.`,
            `Potwierdź ${extra} dodatkowych miejsc po 5 USD/mies. Nowa cena: ${total} USD/mies. Stripe może teraz pobrać proporcjonalną dopłatę.`,
          ),
        )
      )
        return;
      g("buySeatsBtn").disabled = true;
      try {
        const r = await API.post("/billing/seats", { extra_seats: extra });
        if (r.url) window.location.href = r.url;
        else if (r.pending)
          g("teamAdminError").textContent = l(
            "Payment is pending. Complete it in Stripe before inviting additional people.",
            "Płatność oczekuje. Zakończ ją w Stripe przed zaproszeniem dodatkowych osób.",
          );
        else await teamAdmin();
      } catch (e) {
        g("teamAdminError").textContent = e.message;
      } finally {
        g("buySeatsBtn").disabled = false;
      }
    };
    g("transferTeamBtn").onclick = () => {
      const people = team.filter((u) => u.id !== API.getUser().id);
      if (!people.length)
        return toast(
          l("Add a teammate first.", "Najpierw dodaj członka zespołu."),
          "error",
        );
      let overlay = g("transferTeamOverlay");
      if (!overlay) {
        document.body.insertAdjacentHTML(
          "beforeend",
          modal(
            "transferTeamOverlay",
            l("Transfer team ownership", "Przekaż własność zespołu"),
            `<form id="transferTeamForm"><div class="field"><label for="transferTeamUser">${l("New team owner", "Nowy właściciel zespołu")}</label><select id="transferTeamUser" required></select></div><p class="muted">${l("The new owner will manage invitations, roles and billing. Your shared and private records will stay in place.", "Nowy właściciel będzie zarządzał zaproszeniami, rangami i płatnościami. Wspólne i prywatne dane pozostaną na swoim miejscu.")}</p><div id="transferTeamError" class="form-error"></div><div class="modal-actions"><button type="button" class="btn btn-ghost" id="cancelTeamTransfer">${l("Cancel", "Anuluj")}</button><button class="btn btn-primary" id="confirmTeamTransfer">${l("Transfer ownership", "Przekaż własność")}</button></div></form>`,
          ),
        );
        g("cancelTeamTransfer").onclick = () => close("transferTeamOverlay");
        g("transferTeamOverlay").querySelector("[data-close-tool]").onclick =
          () => close("transferTeamOverlay");
        g("transferTeamForm").onsubmit = async (e) => {
          e.preventDefault();
          g("confirmTeamTransfer").disabled = true;
          try {
            await API.post("/spaces/ownership", {
              user_id: Number(g("transferTeamUser").value),
            });
            location.reload();
          } catch (e) {
            g("transferTeamError").textContent = e.message;
            g("confirmTeamTransfer").disabled = false;
          }
        };
      }
      g("transferTeamUser").innerHTML =
        '<option value="">—</option>' +
        people
          .map((u) => `<option value="${u.id}">${h(u.name)}</option>`)
          .join("");
      g("transferTeamError").textContent = "";
      show("transferTeamOverlay");
    };
    g("createTeamBtn").onclick = async () => {
      const name = prompt(l("New team name", "Nazwa nowego zespołu"));
      if (!name) return;
      try {
        await API.post("/spaces/team", { name });
        API.clearToken();
        location.href = "/login";
      } catch (e) {
        toast(e.message, "error");
      }
    };
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) refreshNotifications().catch(() => {});
    });
    timer = setInterval(() => {
      if (!document.hidden) refreshNotifications().catch(() => {});
    }, 60000);
    window.addEventListener("pagehide", () => clearInterval(timer), {
      once: true,
    });
    await Promise.allSettled([refreshSpaces(), refreshNotifications()]);
  }
  return {
    init,
    onView,
    editFields,
    collectFields,
    loadFields,
    openWarranty,
    refreshNotifications,
    teamAdmin,
    showContactFields,
  };
})();
