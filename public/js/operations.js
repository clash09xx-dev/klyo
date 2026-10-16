/* Projects, fulfillment, equipment and task planning. Every mutation is explicit. */
const KlyoOperations = (() => {
  const g = (id) => document.getElementById(id),
    h = KlyoDocumentTools.esc,
    dialog = KlyoDocumentTools.dialog;
  let lookup = {},
    tasks = [],
    projects = [],
    orders = [],
    equipment = [],
    taskMode = "list",
    projectMode = "board";
  const pl = () =>
      typeof KlyoI18n !== "undefined" && KlyoI18n.getLang() === "pl",
    L = (en, pol) => (pl() ? pol : en),
    can = () => API.getUser()?.role !== "viewer";
  const labels = {
    planned: ["Planned", "Planowane"],
    active: ["Active", "Aktywne"],
    on_hold: ["On hold", "Wstrzymane"],
    completed: ["Completed", "Zakończone"],
    cancelled: ["Cancelled", "Anulowane"],
    todo: ["To do", "Do zrobienia"],
    in_progress: ["In progress", "W realizacji"],
    done: ["Done", "Gotowe"],
    draft: ["Draft", "Szkic"],
    confirmed: ["Confirmed", "Potwierdzone"],
    ordered: ["Ordered", "Zamówione"],
    shipped: ["Shipped", "Wysłane"],
    delivered: ["Delivered", "Dostarczone"],
    low: ["Low", "Niski"],
    medium: ["Medium", "Średni"],
    high: ["High", "Wysoki"],
    customer: ["Customer", "Klient"],
    supplier: ["Supplier", "Dostawca"],
    internal: ["Internal", "Wewnętrzne"],
    delivery: ["Delivery", "Dostawa"],
    service: ["Service", "Serwis"],
    presentation: ["Presentation", "Prezentacja"],
    good: ["Good", "Dobry"],
    needs_inspection: ["Needs inspection", "Do przeglądu"],
    damaged: ["Damaged", "Uszkodzony"],
    repair: ["In repair", "W naprawie"],
    reserved: ["Reserved", "Zarezerwowane"],
    checked_out: ["Checked out", "Pobrane"],
    returned: ["Returned", "Zwrócone"],
  };
  const label = (v) => (labels[v] ? L(...labels[v]) : v),
    day = (v) => (v ? String(v).slice(0, 10) : ""),
    dt = (v) =>
      v ? new Date(v).toLocaleString(pl() ? "pl-PL" : "en-GB") : "—",
    money = (v, c) =>
      new Intl.NumberFormat(pl() ? "pl-PL" : "en-GB", {
        style: "currency",
        currency: c || "USD",
      }).format(Number(v || 0));
  const opts = (list, selected, blank = true) =>
    `${blank ? '<option value="">—</option>' : ""}` +
    (list || [])
      .map(
        (x) =>
          `<option value="${h(x.id ?? x)}" ${String(x.id ?? x) === String(selected) ? "selected" : ""}>${h(x.name ?? label(x))}</option>`,
      )
      .join("");
  const field = (name, title, value = "", type = "text", extra = "") =>
    `<label class="op-field"><span>${h(title)}</span><input name="${name}" type="${type}" value="${h(value ?? "")}" ${extra}></label>`;
  const select = (name, title, list, value, blank = true) =>
    `<label class="op-field"><span>${h(title)}</span><select name="${name}">${opts(list, value, blank)}</select></label>`;
  const area = (name, title, value = "") =>
    `<label class="op-field op-wide"><span>${h(title)}</span><textarea name="${name}" rows="3">${h(value)}</textarea></label>`;
  const check = (name, title, value) =>
    `<label class="op-check"><input type="checkbox" name="${name}" ${value ? "checked" : ""}> ${h(title)}</label>`;
  const saveBtn = () =>
    `<div class="op-wide op-actions"><button class="btn btn-primary" type="submit">${L("Save", "Zapisz")}</button></div>`;
  const read = (form) => Object.fromEntries([...new FormData(form)]);
  async function loadLookup() {
    lookup = await API.get("/operations/lookup");
    return lookup;
  }
  async function submit(d, fn) {
    try {
      d.error("");
      d.find("[type=submit]").disabled = true;
      await fn();
      d.close();
    } catch (e) {
      d.error(e);
    } finally {
      const b = d.find("[type=submit]");
      if (b) b.disabled = false;
    }
  }
  function init() {
    document.addEventListener(
      "click",
      (event) => {
        if (event.target.closest("#addTaskBtn,#tasksEmptyAddBtn")) {
          event.preventDefault();
          event.stopImmediatePropagation();
          taskEditor().catch((e) => toast(e.message, "error"));
        }
      },
      true,
    );
    for (const [v, en, pol, icon] of [
      ["projects", "Projects", "Projekty", "M3 7h18v14H3z M3 7l3-4h5l3 4"],
      [
        "orders",
        "Orders",
        "Zamówienia",
        "M4 3h16v18H4z M8 8h8 M8 12h8 M8 16h5",
      ],
      ["equipment", "Equipment", "Wyposażenie", "M4 8h16v13H4z M8 8V3h8v5"],
    ]) {
      document
        .querySelector('.nav [data-view="history"]')
        ?.insertAdjacentHTML(
          "beforebegin",
          `<a href="#" class="nav-item" data-view="${v}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="${icon}"/></svg><span data-op-nav="${v}">${L(en, pol)}</span></a>`,
        );
      g("productsView").insertAdjacentHTML(
        "afterend",
        `<section id="${v}View" class="hidden op-view"><div class="op-toolbar"><h2>${L(en, pol)}</h2><input type="search" data-op-search="${v}" placeholder="${L("Search", "Szukaj")}"><button class="btn btn-primary" data-op-new="${v}">${L("Add", "Dodaj")}</button></div><div id="${v}Content"></div></section>`,
      );
      g(`${v}View`).querySelector("[data-op-new]").onclick = () =>
        ({
          projects: () => projectEditor(),
          orders: () => orderEditor(),
          equipment: () => equipmentEditor(),
        })[v]();
      g(`${v}View`).querySelector("[data-op-search]").oninput = () => render(v);
    }
    const tv = g("tasksView");
    tv.insertAdjacentHTML(
      "afterbegin",
      `<div id="opTaskToolbar" class="op-toolbar"><div class="op-segments"><button class="btn btn-ghost" data-task-mode="list">${L("List", "Lista")}</button><button class="btn btn-ghost" data-task-mode="matrix">${L("Eisenhower matrix", "Macierz Eisenhowera")}</button><button class="btn btn-ghost" data-task-mode="kanban">Kanban</button></div><input id="opTaskSearch" type="search" placeholder="${L("Search tasks", "Szukaj zadań")}"><select id="opTaskStatus"><option value="">${L("All statuses", "Wszystkie statusy")}</option>${opts(["todo", "in_progress", "done"], "", false)}</select><button class="btn btn-primary" id="opNewTask">${L("New task", "Nowe zadanie")}</button></div><div id="opTasksContent"></div>`,
    );
    [...tv.children].forEach((n) => {
      if (!["opTaskToolbar", "opTasksContent"].includes(n.id)) {
        n.dataset.opLegacy = "true";
        n.hidden = true;
      }
    });
    tv.querySelectorAll("[data-task-mode]").forEach(
      (b) =>
        (b.onclick = () => {
          taskMode = b.dataset.taskMode;
          renderTasks();
        }),
    );
    g("opTaskSearch").oninput = renderTasks;
    g("opTaskStatus").onchange = renderTasks;
    g("opNewTask").onclick = () => taskEditor();
  }
  async function onView(view) {
    for (const v of ["projects", "orders", "equipment"])
      g(v + "View")?.classList.toggle("hidden", view !== v);
    if (!["projects", "orders", "equipment", "tasks"].includes(view)) return;
    try {
      await loadLookup();
      if (view === "tasks") {
        tasks = (await API.get("/operations/tasks")).tasks;
        renderTasks();
      } else {
        const result = await API.get("/operations/" + view);
        if (view === "projects") projects = result.projects;
        if (view === "orders") orders = result.orders;
        if (view === "equipment") equipment = result.equipment;
        render(view);
      }
      document
        .querySelectorAll("[data-op-new],#opNewTask")
        .forEach((b) => (b.disabled = !can()));
    } catch (e) {
      toast(e.message, "error");
    }
  }
  function filtered(v, list) {
    const s =
      g(v + "View")
        ?.querySelector("[data-op-search]")
        .value.toLowerCase() || "";
    return list.filter((x) =>
      Object.values(x).some(
        (v) => typeof v === "string" && v.toLowerCase().includes(s),
      ),
    );
  }
  function render(v) {
    if (v === "projects") renderProjects();
    if (v === "orders") renderOrders();
    if (v === "equipment") renderEquipment();
  }
  const empty = (msg) => `<div class="empty-state"><p>${h(msg)}</p></div>`;
  const progress = (done, total) =>
    `<div class="op-progress" aria-label="${done} / ${total}"><span style="width:${total ? Math.min(100, (done / total) * 100) : 0}%"></span></div><small>${done} / ${total} ${L("tasks complete", "zadań ukończonych")}</small>`;
  function taskCard(t) {
    return `<article class="op-card ${t.status === "done" ? "op-done" : ""}" data-task="${t.id}" draggable="${can()}"><strong>${t.is_milestone ? "◆ " : ""}${h(t.title)}</strong><div>${h(t.assigned_name || L("Unassigned", "Nieprzypisane"))}</div><footer><span class="op-priority op-${t.priority}">${h(label(t.priority))}</span><time class="${t.due_date && day(t.due_date) < new Date().toISOString().slice(0, 10) && t.status !== "done" ? "op-overdue" : ""}">${h(day(t.due_date) || "—")}</time></footer>${t.project_title ? `<small>${h(t.project_title)}</small>` : ""}${t.parent_id ? `<small>↳ ${h(tasks.find((x) => x.id === t.parent_id)?.title || "#" + t.parent_id)}</small>` : ""}${t.reminder_at ? `<small>◷ ${h(dt(t.reminder_at))}</small>` : ""}</article>`;
  }
  function wireTasks(container, onUpdated) {
    container.querySelectorAll("[data-task]").forEach((card) => {
      card.onclick = () =>
        taskEditor(tasks.find((t) => t.id === Number(card.dataset.task)));
      card.ondragstart = (e) => {
        e.dataTransfer.setData("text/x-klyo-task", card.dataset.task);
        e.dataTransfer.effectAllowed = "move";
      };
    });
    container.querySelectorAll("[data-task-drop]").forEach((col) => {
      col.ondragover = (e) => {
        e.preventDefault();
        col.classList.add("op-dragover");
      };
      col.ondragleave = () => col.classList.remove("op-dragover");
      col.ondrop = async (e) => {
        e.preventDefault();
        col.classList.remove("op-dragover");
        const t = tasks.find(
          (x) => x.id === Number(e.dataTransfer.getData("text/x-klyo-task")),
        );
        if (!t || !can()) return;
        const b = col.dataset.taskDrop.startsWith("quadrant")
          ? {
              urgent: col.dataset.urgent === "true",
              important: col.dataset.important === "true",
            }
          : { status: col.dataset.taskDrop };
        try {
          await API.put("/operations/tasks/" + t.id, b);
          await (onUpdated ? onUpdated() : refreshTasks(container));
        } catch (err) {
          toast(err.message, "error");
        }
      };
    });
  }
  async function refreshTasks(container) {
    tasks = (await API.get("/operations/tasks")).tasks;
    if (container?.dataset.projectTasks) {
      await showProject(Number(container.dataset.projectTasks));
    } else renderTasks();
  }
  function renderTasks() {
    const box = g("opTasksContent");
    if (!box) return;
    const search = g("opTaskSearch").value.toLowerCase(),
      status = g("opTaskStatus").value,
      list = tasks.filter(
        (t) =>
          (!search ||
            [t.title, t.assigned_name, t.project_title]
              .join(" ")
              .toLowerCase()
              .includes(search)) &&
          (!status || t.status === status),
      );
    g("opTaskToolbar")
      .querySelectorAll("[data-task-mode]")
      .forEach((b) =>
        b.classList.toggle("active", b.dataset.taskMode === taskMode),
      );
    if (taskMode === "matrix") {
      box.innerHTML = `<div class="op-matrix">${[
        [
          true,
          true,
          L("Do now · urgent & important", "Zrób teraz · pilne i ważne"),
        ],
        [
          false,
          true,
          L("Plan · important, not urgent", "Zaplanuj · ważne, niepilne"),
        ],
        [
          true,
          false,
          L(
            "Delegate · urgent, less important",
            "Deleguj · pilne, mniej ważne",
          ),
        ],
        [
          false,
          false,
          L(
            "Reconsider · neither urgent nor important",
            "Przemyśl · niepilne i nieważne",
          ),
        ],
      ]
        .map(
          ([u, i, n]) =>
            `<section class="op-column" data-task-drop="quadrant" data-urgent="${u}" data-important="${i}"><h3>${h(n)}</h3>${
              list
                .filter((t) => t.urgent === u && t.important === i)
                .map(taskCard)
                .join("") || empty(L("No tasks", "Brak zadań"))
            }</section>`,
        )
        .join("")}</div>`;
    } else if (taskMode === "kanban") box.innerHTML = taskBoard(list);
    else
      box.innerHTML = list.length
        ? `<div class="op-task-list">${list.map((t) => taskCard(t)).join("")}</div>`
        : empty(
            L(
              "No tasks yet. Add your first task or milestone.",
              "Brak zadań. Dodaj zadanie lub kamień milowy.",
            ),
          );
    wireTasks(box);
  }
  function taskBoard(list) {
    return `<div class="op-board op-three">${["todo", "in_progress", "done"]
      .map(
        (status) =>
          `<section class="op-column" data-task-drop="${status}"><h3>${h(label(status))} <small>${list.filter((t) => t.status === status).length}</small></h3>${
            list
              .filter((t) => t.status === status)
              .map(taskCard)
              .join("") || empty("—")
          }</section>`,
      )
      .join("")}</div>`;
  }
  async function taskEditor(t = {}, preset = {}) {
    await loadLookup();
    t = { ...preset, ...t };
    const d = dialog(
      t.id
        ? L("Edit task", "Edytuj zadanie")
        : L("New task / milestone", "Nowe zadanie / kamień milowy"),
      `<form class="op-form">${field("title", L("Title", "Tytuł"), t.title, "text", 'required maxlength="300"')}${select("status", L("Status", "Status"), ["todo", "in_progress", "done"], t.status || "todo", false)}${select("assigned_to", L("Assigned to", "Przypisane do"), lookup.users, t.assigned_to)}${select("priority", L("Priority", "Priorytet"), ["low", "medium", "high"], t.priority || "medium", false)}${field("due_date", L("Due date", "Termin"), day(t.due_date), "date")}${field("reminder_at", L("Reminder", "Przypomnienie"), t.reminder_at ? localStamp(t.reminder_at) : "", "datetime-local")}${select("project_id", L("Project", "Projekt"), lookup.projects, t.project_id)}${select(
        "parent_id",
        L("Parent task / milestone", "Zadanie nadrzędne / kamień milowy"),
        lookup.tasks.filter((x) => x.id !== t.id),
        t.parent_id,
      )}${select("company_id", L("Company", "Firma"), lookup.companies, t.company_id)}${select("contact_id", L("Contact", "Kontakt"), lookup.contacts, t.contact_id)}${select("deal_id", L("Sales opportunity", "Szansa sprzedaży"), lookup.deals, t.deal_id)}<div class="op-checks">${check("urgent", L("Urgent", "Pilne"), t.urgent)}${check("important", L("Important", "Ważne"), t.important !== false)}${check("is_milestone", L("Milestone", "Kamień milowy"), t.is_milestone)}</div>${area("description", L("Description / steps", "Opis / kroki"), t.description)}${t.id ? '<button type="button" class="btn btn-ghost" id="opDeleteTask">' + L("Delete task and subtasks", "Usuń zadanie i podzadania") + "</button>" : ""}${saveBtn()}</form>`,
      true,
    );
    if (!can())
      d.find("form")
        .querySelectorAll("input,select,textarea,button")
        .forEach((e) => (e.disabled = true));
    d.find("#opDeleteTask")?.addEventListener("click", async () => {
      if (
        !confirm(
          L(
            "Delete this task and all its subtasks?",
            "Usunąć to zadanie i wszystkie jego podzadania?",
          ),
        )
      )
        return;
      try {
        await API.del("/operations/tasks/" + t.id);
        d.close();
        await onView("tasks");
      } catch (e) {
        d.error(e);
      }
    });
    d.find("form").onsubmit = (e) => {
      e.preventDefault();
      submit(d, async () => {
        const b = read(e.target);
        for (const f of ["urgent", "important", "is_milestone"])
          b[f] = e.target.elements[f].checked;
        if (b.reminder_at)
          b.reminder_at = new Date(b.reminder_at).toISOString();
        await (t.id
          ? API.put("/operations/tasks/" + t.id, b)
          : API.post("/operations/tasks", b));
        switchView("tasks");
        await onView("tasks");
        if (t.project_id) showProject(t.project_id);
      });
    };
  }
  function localStamp(v) {
    const d = new Date(v);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 16);
  }
  function renderProjects() {
    const list = filtered("projects", projects),
      box = g("projectsContent");
    box.innerHTML =
      `<div class="op-segments op-view-switch"><button class="btn btn-ghost" id="opProjectsBoard">Kanban</button><button class="btn btn-ghost" id="opProjectsList">${L("List", "Lista")}</button></div>` +
      (projectMode === "board"
        ? `<div class="op-board op-project-board">${[
            "planned",
            "active",
            "on_hold",
            "completed",
            "cancelled",
          ]
            .map(
              (s) =>
                `<section class="op-column" data-project-drop="${s}"><h3>${h(label(s))} <small>${list.filter((p) => p.status === s).length}</small></h3>${list
                  .filter((p) => p.status === s)
                  .map(projectCard)
                  .join("")}</section>`,
            )
            .join("")}</div>`
        : `<div class="op-grid">${list.map(projectCard).join("")}</div>`);
    g("opProjectsBoard").onclick = () => {
      projectMode = "board";
      renderProjects();
    };
    g("opProjectsList").onclick = () => {
      projectMode = "list";
      renderProjects();
    };
    box.querySelectorAll("[data-project]").forEach((c) => {
      c.onclick = () => showProject(Number(c.dataset.project));
      c.ondragstart = (e) =>
        e.dataTransfer.setData("text/x-klyo-project", c.dataset.project);
    });
    box.querySelectorAll("[data-project-drop]").forEach((c) => {
      c.ondragover = (e) => e.preventDefault();
      c.ondrop = async (e) => {
        e.preventDefault();
        const id = Number(e.dataTransfer.getData("text/x-klyo-project"));
        if (!id || !can()) return;
        try {
          await API.put("/operations/projects/" + id, {
            status: c.dataset.projectDrop,
          });
          await onView("projects");
        } catch (e) {
          toast(e.message, "error");
        }
      };
    });
  }
  function projectCard(p) {
    return `<article class="op-card" draggable="${can()}" data-project="${p.id}"><strong>${h(p.title)}</strong><span>${h(p.company_name || "")}</span><span>${h(p.assigned_name || "—")} · ${h(day(p.due_date) || "—")}</span>${progress(p.done_count, p.task_count)}<footer>${h(label(p.kind))}<span>${h(money(p.budget, p.currency))}</span></footer></article>`;
  }
  async function projectEditor(p = {}, preset = {}) {
    await loadLookup();
    p = { ...preset, ...p };
    const d = dialog(
      p.id
        ? L("Edit project", "Edytuj projekt")
        : L("New project", "Nowy projekt"),
      `<form class="op-form">${field("title", L("Project title", "Tytuł projektu"), p.title, "text", "required")}${select("kind", L("Type", "Typ"), ["delivery", "service", "presentation", "internal"], p.kind || "delivery", false)}${select("status", L("Status", "Status"), ["planned", "active", "on_hold", "completed", "cancelled"], p.status || "planned", false)}${select("assigned_to", L("Project lead", "Prowadzący"), lookup.users, p.assigned_to)}${select(
        "deal_id",
        L("Won sales opportunity", "Wygrana szansa"),
        lookup.deals.filter((x) => x.status === "won"),
        p.deal_id,
      )}${select("company_id", L("Company", "Firma"), lookup.companies, p.company_id)}${select("contact_id", L("Contact", "Kontakt"), lookup.contacts, p.contact_id)}${field("starts_on", L("Start", "Początek"), day(p.starts_on), "date")}${field("due_date", L("Deadline", "Termin"), day(p.due_date), "date")}${field("budget", L("Budget", "Budżet"), p.budget || 0, "number", 'min="0" step="0.01"')}${field("currency", L("Currency", "Waluta"), p.currency || (typeof workspaceDefaultCurrency !== "undefined" ? workspaceDefaultCurrency : "USD"), "text", 'maxlength="3" required')}${area("description", L("Scope / service contract", "Zakres / umowa serwisowa"), p.description)}${area("notes", L("Internal notes", "Notatki wewnętrzne"), p.notes)}${saveBtn()}</form>`,
      true,
    );
    d.find("form").onsubmit = (e) => {
      e.preventDefault();
      submit(d, async () => {
        const r = await (p.id
          ? API.put("/operations/projects/" + p.id, read(e.target))
          : API.post("/operations/projects", read(e.target)));
        switchView("projects");
        await onView("projects");
        await showProject(r.project.id);
      });
    };
  }
  async function showProject(id) {
    try {
      const r = await API.get("/operations/projects/" + id),
        p = r.project;
      tasks = (await API.get("/operations/tasks")).tasks;
      const d = dialog(
        p.title,
        `<div class="op-toolbar"><span class="op-badge">${h(label(p.status))}</span><span>${h(day(p.starts_on))} → ${h(day(p.due_date) || "—")}</span><button class="btn btn-ghost" id="opProjectEdit">${L("Edit", "Edytuj")}</button><button class="btn btn-ghost" id="opProjectFiles">${L("Files", "Pliki")}</button><button class="btn btn-ghost" id="opProtocolDownload">${L("Download protocol PDF", "Pobierz protokół PDF")}</button></div><p>${h(p.description)}</p><div class="op-kpis"><div><small>${L("Budget", "Budżet")}</small><strong>${h(money(p.budget, p.currency))}</strong></div><div><small>${L("Orders", "Zamówienia")}</small><strong>${r.orders.length}</strong></div><div><small>${L("Equipment assigned", "Przypisany sprzęt")}</small><strong>${r.equipment.filter((a) => ["reserved", "checked_out"].includes(a.status)).length}</strong></div></div>${progress(r.tasks.filter((t) => t.status === "done").length, r.tasks.length)}<div class="op-toolbar"><h3>${L("People & time", "Osoby i czas")}</h3><button class="btn btn-ghost" id="opProjectResource">${L("Plan resources", "Zaplanuj osoby")}</button><button class="btn btn-ghost" id="opProjectTime">${L("Log work", "Zapisz czas")}</button></div><p>${L("Logged / planned hours", "Godziny zapisane / planowane")}: <strong>${r.time_entries.reduce((s, t) => s + Number(t.hours), 0).toFixed(2)} / ${r.resources.reduce((s, t) => s + Number(t.planned_hours), 0).toFixed(2)} h</strong></p>${r.resources.map((t) => `<div class="op-detail-row"><strong>${h(t.user_name)}</strong><span>${h(t.role)} · ${h(t.planned_hours)} h</span>${can() ? `<button class="btn btn-ghost" data-remove-resource="${t.user_id}">${L("Remove plan", "Usuń plan")}</button>` : ""}</div>`).join("")}${r.time_entries.map((t) => `<div class="op-detail-row"><span>${h(day(t.spent_on))} · ${h(t.user_name)} · ${h(t.hours)} h</span><span>${h(t.task_title || "")} ${h(t.notes)}</span>${can() ? `<button class="btn btn-ghost" data-remove-time="${t.id}">${L("Delete entry", "Usuń wpis")}</button>` : ""}</div>`).join("")}<div class="op-toolbar"><h3>${L("Milestones & tasks", "Kamienie milowe i zadania")}</h3><button class="btn btn-primary" id="opProjectTask">${L("Add task", "Dodaj zadanie")}</button></div><div data-project-tasks="${p.id}">${taskBoard(r.tasks)}</div><div class="op-toolbar"><h3>${L("Orders & fulfillment", "Zamówienia i realizacja")}</h3><button class="btn btn-ghost" id="opProjectOrder">${L("Add order", "Dodaj zamówienie")}</button></div><div class="op-grid">${r.orders.map(orderCard).join("") || empty("—")}</div><h3>${L("Assigned equipment", "Przypisane wyposażenie")}</h3>${r.equipment.map((a) => `<div class="op-detail-row"><strong>${h(a.name)}</strong><span>${h(a.assigned_name)} · ${h(label(a.status))}</span><span>${h(dt(a.starts_at))} → ${h(dt(a.ends_at))}</span></div>`).join("") || empty("—")}<div class="op-toolbar"><h3>${L("Documentation, agreements & protocols", "Dokumentacja, uzgodnienia i protokoły")}</h3><button class="btn btn-ghost" id="opProjectNote">${L("Add record", "Dodaj wpis")}</button></div>${r.notes.map((n) => `<article class="op-note"><strong>${h(n.title)}</strong><small>${h(n.kind)} · ${h(n.author || "")} · ${h(dt(n.created_at))}</small><p>${h(n.body)}</p>${n.document_url ? `<a href="${h(n.document_url)}" target="_blank" rel="noopener">${L("Open document", "Otwórz dokument")}</a>` : ""}</article>`).join("")}`,
        true,
      );
      wireTasks(d.body, async () => {
        d.close();
        await showProject(p.id);
      });
      d.body
        .querySelectorAll("[data-order]")
        .forEach((b) => (b.onclick = () => showOrder(Number(b.dataset.order))));
      d.find("#opProjectEdit").onclick = () => {
        d.close();
        projectEditor(p);
      };
      d.find("#opProjectTask").onclick = () => {
        d.close();
        taskEditor({}, { project_id: p.id });
      };
      d.find("#opProjectOrder").onclick = () => {
        d.close();
        orderEditor(
          {},
          {
            project_id: p.id,
            deal_id: p.deal_id,
            company_id: p.company_id,
            contact_id: p.contact_id,
            currency: p.currency,
          },
        );
      };
      d.find("#opProjectFiles").onclick = () => {
        d.close();
        files("project", p.id, p.title);
      };
      d.find("#opProjectResource").onclick = () => resourceEditor(p, d);
      d.find("#opProjectTime").onclick = () => timeEditor(p, r.tasks, d);
      d.body.querySelectorAll("[data-remove-resource]").forEach(
        (b) =>
          (b.onclick = async () => {
            try {
              await API.del(
                "/operations/projects/" +
                  p.id +
                  "/resources/" +
                  b.dataset.removeResource,
              );
              d.close();
              await showProject(p.id);
            } catch (e) {
              d.error(e);
            }
          }),
      );
      d.body.querySelectorAll("[data-remove-time]").forEach(
        (b) =>
          (b.onclick = async () => {
            try {
              await API.del(
                "/operations/projects/" +
                  p.id +
                  "/time/" +
                  b.dataset.removeTime,
              );
              d.close();
              await showProject(p.id);
            } catch (e) {
              d.error(e);
            }
          }),
      );
      d.find("#opProjectNote").onclick = () => noteEditor(p, d);
      d.find("#opProtocolDownload").onclick = () =>
        download(
          "/operations/projects/" + p.id + "/protocol.pdf",
          `Project-${p.id}-protocol.pdf`,
        ).catch((e) => d.error(e));
      d.body
        .querySelectorAll(
          "#opProjectEdit,#opProjectTask,#opProjectOrder,#opProjectNote,#opProjectResource,#opProjectTime",
        )
        .forEach((b) => (b.disabled = !can()));
    } catch (e) {
      toast(e.message, "error");
    }
  }
  async function resourceEditor(p, parent) {
    await loadLookup();
    const d = dialog(
      L("Plan project resources", "Zaplanuj osoby w projekcie"),
      `<form class="op-form">${select("user_id", L("Person", "Osoba"), lookup.users, null)}${field("role", L("Role / responsibility", "Rola / odpowiedzialność"))}${field("planned_hours", L("Planned hours", "Planowane godziny"), 0, "number", 'min="0" step="0.25" required')}${saveBtn()}</form>`,
    );
    d.find("form").onsubmit = (e) => {
      e.preventDefault();
      submit(d, async () => {
        await API.post(
          "/operations/projects/" + p.id + "/resources",
          read(e.target),
        );
        parent.close();
        await showProject(p.id);
      });
    };
  }
  async function timeEditor(p, projectTasks, parent) {
    await loadLookup();
    const d = dialog(
      L("Log project work", "Zapisz czas pracy w projekcie"),
      `<form class="op-form">${select("user_id", L("Person", "Osoba"), lookup.users, API.getUser()?.id)}${select(
        "task_id",
        L("Project task", "Zadanie projektu"),
        projectTasks.map((t) => ({ id: t.id, name: t.title })),
        null,
      )}${field("spent_on", L("Work date", "Data pracy"), localStamp(new Date().toISOString()).slice(0, 10), "date", "required")}${field("hours", L("Hours worked", "Liczba godzin"), 1, "number", 'min="0.01" max="24" step="0.01" required')}${area("notes", L("Work performed", "Wykonana praca"))}${saveBtn()}</form>`,
    );
    d.find("form").onsubmit = (e) => {
      e.preventDefault();
      submit(d, async () => {
        await API.post(
          "/operations/projects/" + p.id + "/time",
          read(e.target),
        );
        parent.close();
        await showProject(p.id);
      });
    };
  }
  function noteEditor(p, parent) {
    const d = dialog(
      L("Project record", "Wpis projektu"),
      `<form class="op-form">${field("title", L("Title", "Tytuł"), "", "text", "required")}${select(
        "kind",
        L("Type", "Typ"),
        [
          { id: "note", name: L("Note", "Notatka") },
          {
            id: "agreement",
            name: L("Customer agreement", "Uzgodnienie z klientem"),
          },
          { id: "protocol", name: L("Protocol", "Protokół") },
          { id: "document", name: L("Document", "Dokument") },
        ],
        "note",
        false,
      )}${area("body", L("Details", "Treść"))}${field("document_url", L("Document HTTPS link", "Link HTTPS do dokumentu"), "", "url")}${saveBtn()}</form>`,
    );
    d.find("form").onsubmit = (e) => {
      e.preventDefault();
      submit(d, async () => {
        await API.post(
          "/operations/projects/" + p.id + "/notes",
          read(e.target),
        );
        parent.close();
        await showProject(p.id);
      });
    };
  }
  async function files(entity, id, name) {
    if (typeof KlyoFiles !== "undefined" && KlyoFiles.showRecord)
      KlyoFiles.showRecord(entity, id, name);
    else
      toast(
        L(
          "Open Files and choose the linked record.",
          "Otwórz Pliki i wybierz rekord.",
        ),
      );
  }
  async function download(path, name) {
    const r = await KlyoDocumentTools.binary(path),
      url = URL.createObjectURL(await r.blob()),
      a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
  function renderOrders() {
    const list = filtered("orders", orders),
      box = g("ordersContent");
    box.innerHTML = `<div class="op-kpis"><div><small>${L("Active orders", "Aktywne zamówienia")}</small><strong>${list.filter((o) => !["completed", "cancelled"].includes(o.status)).length}</strong></div><div><small>${L("Awaiting payment", "Do zapłaty")}</small><strong>${list.filter((o) => o.invoice_number && !o.paid_at).length}</strong></div><div><small>${L("Delivery acknowledgments missing", "Brak potwierdzenia dostawy")}</small><strong>${list.filter((o) => ["delivered", "completed"].includes(o.status) && !o.delivery_acknowledged_at).length}</strong></div></div><div class="op-grid">${list.map(orderCard).join("") || empty(L("Create an order from a won opportunity or add an internal / supplier order.", "Utwórz zamówienie z wygranej szansy lub dodaj zamówienie wewnętrzne / do dostawcy."))}</div>`;
    box
      .querySelectorAll("[data-order]")
      .forEach((b) => (b.onclick = () => showOrder(Number(b.dataset.order))));
  }
  function orderCard(o) {
    const stages = [
        "draft",
        "confirmed",
        "ordered",
        "in_progress",
        "shipped",
        "delivered",
        "completed",
      ],
      idx = stages.indexOf(o.status);
    return `<article class="op-card" data-order="${o.id}"><small>${h(o.number)} · ${h(label(o.kind))}</small><strong>${h(o.title)}</strong><span>${h(o.company_name || o.supplier_name || "")}</span><span>${h(label(o.status))} · ${h(money(o.total, o.currency))}</span><div class="op-progress"><span style="width:${(Math.max(0, idx) / 6) * 100}%"></span></div><footer><span>${h(day(o.confirmed_delivery_date) || "—")}</span><span>${o.paid_at ? L("Paid", "Zapłacone") : o.invoice_number ? L("Invoice issued", "Faktura wystawiona") : ""}</span></footer></article>`;
  }
  async function orderEditor(o = {}, preset = {}) {
    await loadLookup();
    o = { ...preset, ...o };
    const log = o.logistics || {};
    const d = dialog(
      o.id
        ? L("Edit order", "Edytuj zamówienie")
        : L("New order", "Nowe zamówienie"),
      `<form class="op-form">${field("title", L("Title", "Tytuł"), o.title, "text", o.deal_id || o.quote_id ? "" : "required")}${field("number", L("Order number (blank = automatic)", "Numer zamówienia (puste = automatycznie)"), o.number, "text", 'maxlength="60"')}${select("kind", L("Type", "Typ"), ["customer", "internal", "supplier"], o.kind || "customer", false)}${select("status", L("Status", "Status"), ["draft", "confirmed", "ordered", "in_progress", "shipped", "delivered", "completed", "cancelled"], o.status || "draft", false)}${select(
        "deal_id",
        L("Won opportunity", "Wygrana szansa"),
        lookup.deals.filter((x) => x.status === "won"),
        o.deal_id,
      )}${select("quote_id", L("Source quote", "Oferta źródłowa"), lookup.quotes, o.quote_id)}${select("project_id", L("Project", "Projekt"), lookup.projects, o.project_id)}${select("company_id", L("Company", "Firma"), lookup.companies, o.company_id)}${select("contact_id", L("Contact", "Kontakt"), lookup.contacts, o.contact_id)}${field("supplier_name", L("Supplier", "Dostawca"), o.supplier_name)}${field("currency", L("Currency", "Waluta"), o.currency || (typeof workspaceDefaultCurrency !== "undefined" ? workspaceDefaultCurrency : "USD"), "text", 'maxlength="3" required')}${field("confirmed_delivery_date", L("Confirmed delivery date", "Potwierdzony termin dostawy"), day(o.confirmed_delivery_date), "date")}<div class="op-wide op-toolbar"><h3>${L("Final items & serial numbers", "Pozycje końcowe i numery seryjne")}</h3><button class="btn btn-ghost" type="button" id="opAddOrderItem">${L("Add item", "Dodaj pozycję")}</button></div><div class="op-wide" id="opOrderItems"></div><p class="muted op-wide">${L("Order prices and payments are net amounts, excluding VAT. If a source quote is selected and this list is empty, its items and net value are copied. Required serial numbers must be supplied before confirmation.", "Ceny i rozliczenia zamówienia to kwoty netto, bez VAT. Jeśli wybierzesz ofertę źródłową i lista będzie pusta, jej pozycje i wartość netto zostaną skopiowane. Wymagane numery seryjne trzeba podać przed potwierdzeniem.")}</p>${field("total", L("Final negotiated net amount", "Końcowa uzgodniona kwota netto"), o.total ?? "", "number", 'min="0" step="0.01"')}${field("carrier", L("Carrier", "Przewoźnik"), log.carrier)}${field("tracking_number", L("Tracking number", "Numer przesyłki"), log.tracking_number)}${field("shipping_date", L("Shipping date", "Data wysyłki"), day(log.shipping_date), "date")}${area("delivery_address", L("Delivery address", "Adres dostawy"), log.delivery_address)}${field("delivery_terms", L("Delivery terms", "Warunki dostawy"), log.delivery_terms)}${field("delivery_acknowledged_at", L("Customer acknowledged delivery", "Klient potwierdził dostawę"), o.delivery_acknowledged_at ? localStamp(o.delivery_acknowledged_at) : "", "datetime-local")}${field("delivery_acknowledged_by", L("Signed / acknowledged by", "Podpis / potwierdzenie przez"), o.delivery_acknowledged_by)}${field("delivery_document_url", L("Signed delivery document (HTTPS)", "Podpisany dokument dostawy (HTTPS)"), o.delivery_document_url, "url")}${field("invoice_number", L("Invoice number", "Numer faktury"), o.invoice_number)}${field("invoice_issued_at", L("Invoice issue date", "Data wystawienia faktury"), day(o.invoice_issued_at), "date")}${field("invoice_due_date", L("Payment due", "Termin płatności"), day(o.invoice_due_date), "date")}${field("paid_amount", L("Net payment allocated", "Rozliczona wpłata netto"), o.paid_amount || 0, "number", 'min="0" step="0.01"')}${field("paid_at", L("Fully paid at", "Zapłacono w całości"), o.paid_at ? localStamp(o.paid_at) : "", "datetime-local")}${area("notes", L("Notes", "Notatki"), o.notes)}${saveBtn()}</form>`,
      true,
    );
    let items = structuredClone(o.items || []);
    const renderItems = () => {
      d.find("#opOrderItems").innerHTML = items
        .map(
          (x, i) =>
            `<div class="op-order-item" data-order-item="${i}"><select data-item-field="product_id">${opts(lookup.products, x.product_id)}</select><input data-item-field="name" value="${h(x.name || x.description || "")}" placeholder="${L("Name / description", "Nazwa / opis")}"><input data-item-field="quantity" type="number" min="0.01" step="0.01" value="${h(x.quantity || 1)}" aria-label="Quantity"><input data-item-field="unit_price" type="number" min="0" step="0.01" value="${h(x.unit_price || 0)}" aria-label="Unit price"><input data-item-field="serial_numbers" value="${h((x.serial_numbers || []).join(", "))}" placeholder="${L("Serial numbers, comma separated", "Numery seryjne, oddzielone przecinkiem")}"><button type="button" class="btn btn-ghost" data-remove-item="${i}" aria-label="Remove">×</button></div>`,
        )
        .join("");
      d.body.querySelectorAll("[data-item-field]").forEach(
        (input) =>
          (input.onchange = () => {
            const row =
                items[
                  Number(input.closest("[data-order-item]").dataset.orderItem)
                ],
              f = input.dataset.itemField;
            row[f] =
              f === "serial_numbers"
                ? input.value
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean)
                : input.value;
            if (f === "name") row.description = input.value;
          }),
      );
      d.body.querySelectorAll("[data-remove-item]").forEach(
        (b) =>
          (b.onclick = () => {
            items.splice(Number(b.dataset.removeItem), 1);
            renderItems();
          }),
      );
    };
    renderItems();
    d.find("#opAddOrderItem").onclick = () => {
      items.push({ name: "", quantity: 1, unit_price: 0, serial_numbers: [] });
      renderItems();
    };
    d.find("form").onsubmit = (e) => {
      e.preventDefault();
      submit(d, async () => {
        const b = read(e.target);
        b.logistics = {
          ...log,
          carrier: b.carrier,
          tracking_number: b.tracking_number,
          shipping_date: b.shipping_date,
          delivery_address: b.delivery_address,
          delivery_terms: b.delivery_terms,
        };
        for (const f of ["paid_at", "delivery_acknowledged_at"])
          if (b[f]) b[f] = new Date(b[f]).toISOString();
        if (items.length || o.id) b.items = items;
        if (b.total === "") delete b.total;
        const r = await (o.id
          ? API.put("/operations/orders/" + o.id, b)
          : API.post("/operations/orders", b));
        switchView("orders");
        await onView("orders");
        await showOrder(r.order.id);
      });
    };
  }
  async function showOrder(id) {
    try {
      const r = await API.get("/operations/orders/" + id),
        o = r.order,
        log = o.logistics || {},
        stages = [
          "draft",
          "confirmed",
          "ordered",
          "in_progress",
          "shipped",
          "delivered",
          "completed",
        ];
      const d = dialog(
        o.number + " · " + o.title,
        `<div class="op-toolbar"><span class="op-badge">${h(label(o.kind))}</span><button class="btn btn-ghost" id="opOrderEdit">${L("Edit order", "Edytuj zamówienie")}</button><button class="btn btn-ghost" id="opOrderFiles">${L("Files", "Pliki")}</button>${o.kind === "customer" ? `<button class="btn btn-primary" id="opConfirmation">${L("Order confirmation PDF", "Potwierdzenie zamówienia PDF")}</button><button class="btn btn-ghost" id="opConfirmationSettings">${L("Customize confirmation", "Dostosuj potwierdzenie")}</button>` : ""}</div><div class="op-order-stages">${stages.map((s, i) => `<span class="${stages.indexOf(o.status) >= i ? "is-done" : ""}">${h(label(s))}</span>`).join("")}</div><div class="op-kpis"><div><small>${L("Net amount", "Kwota netto")}</small><strong>${h(money(o.total, o.currency))}</strong></div><div><small>${L("Paid", "Wpłacono")}</small><strong>${h(money(o.paid_amount, o.currency))}</strong></div><div><small>${L("Outstanding net amount", "Pozostała kwota netto")}</small><strong>${h(money(Number(o.total) - Number(o.paid_amount), o.currency))}</strong></div></div><h3>${L("Order items", "Pozycje zamówienia")}</h3><div class="doc-scroll"><table class="doc-table"><thead><tr><th>${L("Item", "Pozycja")}</th><th>${L("Quantity", "Ilość")}</th><th>${L("Net unit price", "Cena jednostkowa netto")}</th><th>${L("Serial numbers", "Numery seryjne")}</th></tr></thead><tbody>${o.items.map((i) => `<tr><td>${h(i.name || i.description)}</td><td>${h(i.quantity)}</td><td>${h(money(i.unit_price, o.currency))}</td><td>${h((i.serial_numbers || []).join(", "))}</td></tr>`).join("")}</tbody></table></div><div class="op-grid"><section class="op-card"><h3>${L("Logistics & delivery", "Logistyka i dostawa")}</h3><p>${L("Confirmed delivery", "Potwierdzona dostawa")}: ${h(day(o.confirmed_delivery_date) || "—")}</p><p>${h(log.delivery_address || "—")}</p><p>${h(log.delivery_terms || "")}</p><p>${h(log.carrier || "")} · ${h(log.tracking_number || "")}</p>${log.tracking_number ? `<button class="btn btn-ghost" id="opTracking">${L("Open carrier tracking", "Otwórz śledzenie przewoźnika")}</button>` : ""}<p class="${o.delivery_acknowledged_at ? "" : "op-overdue"}">${o.delivery_acknowledged_at ? h(dt(o.delivery_acknowledged_at) + " · " + o.delivery_acknowledged_by) : L("Customer delivery acknowledgment missing", "Brak potwierdzenia dostawy przez klienta")}</p>${o.delivery_document_url ? `<a target="_blank" rel="noopener" href="${h(o.delivery_document_url)}">${L("Signed delivery document", "Podpisany dokument dostawy")}</a>` : ""}</section><section class="op-card"><h3>${L("Invoice & payment register", "Rejestr faktur i płatności")}</h3>${o.kind === "customer" ? `<button class="btn btn-ghost" id="opInvoiceProvider">${L("Invoice integration", "Integracja fakturowania")}</button>` : ""}<p>${h(o.invoice_number || L("No invoice recorded", "Nie zapisano faktury"))}</p><p>${L("Issued", "Wystawiono")}: ${h(day(o.invoice_issued_at) || "—")}</p><p>${L("Payment due", "Termin płatności")}: ${h(day(o.invoice_due_date) || "—")}</p><p>${o.paid_at ? L("Paid", "Zapłacono") + " · " + h(dt(o.paid_at)) : L("Not fully paid", "Nieopłacone w całości")}</p><small>${L("Update invoice and payment details using Edit order.", "Zaktualizuj fakturę i płatność w Edytuj zamówienie.")}</small></section></div><p>${h(o.notes)}</p><h3>${L("Order history", "Historia zamówienia")}</h3>${r.events.map((e) => `<div class="op-detail-row"><span>${h(e.description)}</span><small>${h(e.user_name || "")} · ${h(dt(e.created_at))}</small></div>`).join("")}`,
        true,
      );
      d.find("#opOrderEdit").disabled = !can();
      d.find("#opOrderEdit").onclick = () => {
        d.close();
        orderEditor(o);
      };
      d.find("#opOrderFiles").onclick = () => {
        d.close();
        files("order", o.id, o.title);
      };
      const customize = d.find("#opConfirmationSettings");
      if (customize) {
        customize.disabled = !can();
        customize.onclick = () => {
          d.close();
          confirmationEditor(o).catch((e) => toast(e.message, "error"));
        };
      }
      d.find("#opConfirmation")?.addEventListener("click", () =>
        download(
          "/commercial/orders/" + o.id + "/confirmation.pdf",
          o.number + ".pdf",
        ).catch((e) => d.error(e)),
      );
      d.find("#opInvoiceProvider")?.addEventListener("click", () => {
        if (typeof KlyoCloudFiles !== "undefined" && KlyoCloudFiles.openInvoice)
          KlyoCloudFiles.openInvoice(o.id);
        else
          d.error(
            L(
              "Invoice integration is not configured.",
              "Integracja fakturowania nie jest skonfigurowana.",
            ),
          );
      });
      d.find("#opTracking")?.addEventListener("click", async () => {
        try {
          const r = await API.get(
            "/communications/tracking?carrier=" +
              encodeURIComponent(log.carrier) +
              "&number=" +
              encodeURIComponent(log.tracking_number),
          );
          window.open(r.url, "_blank", "noopener");
        } catch (e) {
          d.error(e);
        }
      });
    } catch (e) {
      toast(e.message, "error");
    }
  }
  async function confirmationEditor(order) {
    const [templates, source] = await Promise.all([
      API.get("/quote-templates"),
      order.quote_id
        ? API.get("/quotes/" + order.quote_id)
        : Promise.resolve({ quote: { document: {} } }),
    ]);
    const base = source.quote?.document || {};
    let settings = KlyoQuoteCore.normalizeDocument({
      ...base,
      ...(order.customer_confirmation || {}),
    });
    settings.buyer.name ||=
      lookup.companies?.find((c) => c.id === order.company_id)?.name ||
      lookup.contacts?.find((c) => c.id === order.contact_id)?.name ||
      "";
    const d = dialog(
      L("Customize order confirmation", "Dostosuj potwierdzenie zamówienia"),
      `<p>${L("Reuse a saved proposal template, including your own A4 design, or adjust the confirmation below. Order items, final net amount and confirmed delivery date always come from the order.", "Użyj zapisanego szablonu oferty, również własnego projektu A4, lub zmień dane poniżej. Pozycje, końcowa cena netto i potwierdzony termin dostawy pochodzą z zamówienia.")}</p><form class="op-form"><label>${L("Template", "Szablon")}<select name="template"><option value="">${L("Current / inherited from source offer", "Bieżący / odziedziczony z oferty")}</option>${(templates.templates || []).map((t) => `<option value="${t.id}">${h(t.name)}</option>`).join("")}</select></label>${select(
        "language",
        L("PDF language", "Język PDF"),
        [
          { id: "en", name: "English" },
          { id: "pl", name: "Polski" },
        ],
        settings.language,
        false,
      )}${select("layout", L("Layout", "Układ"), [{ id: "studio", name: "Studio" }, { id: "executive", name: "Executive" }, ...(settings.canvas ? [{ id: "canvas", name: "Custom A4" }] : [])], settings.layout, false)}${field("accent", L("Accent", "Kolor"), settings.accent, "color")}${select(
        "pricing_mode",
        L("Client prices", "Ceny dla klienta"),
        [
          {
            id: "itemized",
            name: L("Itemized / bundles", "Pozycje / zestawy"),
          },
          { id: "total_only", name: L("Only total", "Tylko suma") },
        ],
        settings.pricing_mode,
        false,
      )}${field("seller_name", L("Seller name", "Sprzedawca"), settings.seller.name)}${area("seller_details", L("Seller details", "Dane sprzedawcy"), settings.seller.details)}${field("buyer_name", L("Buyer name", "Nabywca"), settings.buyer.name)}${area("buyer_details", L("Buyer details", "Dane nabywcy"), settings.buyer.details)}${area("scope", L("Scope", "Zakres"), settings.scope)}${area("payment", L("Payment terms", "Warunki płatności"), settings.payment)}${area("terms", L("Terms / acceptance", "Warunki / odbiór"), settings.terms)}${field("footer", L("Footer", "Stopka"), settings.footer)}${saveBtn()}</form>`,
      true,
    );
    const form = d.find("form");
    form.elements.template.onchange = () => {
      const t = templates.templates.find(
        (t) => String(t.id) === form.elements.template.value,
      );
      settings = KlyoQuoteCore.normalizeDocument(
        t?.content?.document || {
          ...base,
          ...(order.customer_confirmation || {}),
        },
      );
      for (const key of [
        "language",
        "accent",
        "pricing_mode",
        "scope",
        "payment",
        "terms",
        "footer",
      ])
        form.elements[key].value = settings[key];
      form.elements.layout.innerHTML = [
        "studio",
        "executive",
        ...(settings.canvas ? ["canvas"] : []),
      ]
        .map(
          (k) =>
            `<option value="${k}">${k === "canvas" ? "Custom A4" : k}</option>`,
        )
        .join("");
      form.elements.layout.value = settings.layout;
      for (const party of ["seller", "buyer"]) {
        form.elements[party + "_name"].value = settings[party].name;
        form.elements[party + "_details"].value = settings[party].details;
      }
    };
    form.onsubmit = (e) => {
      e.preventDefault();
      submit(d, async () => {
        const b = read(form),
          document = KlyoQuoteCore.normalizeDocument({
            ...settings,
            language: b.language,
            layout: b.layout,
            accent: b.accent,
            pricing_mode: b.pricing_mode,
            seller: {
              ...settings.seller,
              name: b.seller_name,
              details: b.seller_details,
            },
            buyer: {
              ...settings.buyer,
              name: b.buyer_name,
              details: b.buyer_details,
            },
            scope: b.scope,
            payment: b.payment,
            terms: b.terms,
            footer: b.footer,
          });
        await API.put("/operations/orders/" + order.id, {
          customer_confirmation: document,
        });
        await showOrder(order.id);
      });
    };
  }
  function renderEquipment() {
    const list = filtered("equipment", equipment),
      today = new Date().toISOString().slice(0, 10);
    g("equipmentContent").innerHTML =
      `<div class="op-kpis"><div><small>${L("Active equipment", "Aktywne wyposażenie")}</small><strong>${list.filter((e) => !e.retired).length}</strong></div><div><small>${L("Checked out", "Pobrane")}</small><strong>${list.filter((e) => e.assignments.some((a) => a.status === "checked_out")).length}</strong></div><div><small>${L("Calibration due", "Wymagana kalibracja")}</small><strong>${list.filter((e) => !e.retired && e.next_calibration && day(e.next_calibration) <= today).length}</strong></div></div><div class="op-grid">${list.map((e) => `<article class="op-card" data-equipment="${e.id}">${e.inspection_photo ? `<img class="op-equipment-photo" src="${h(e.inspection_photo)}" alt="${h(e.name)}" loading="lazy">` : ""}<strong>${h(e.name)}</strong><span>${h(e.manufacturer)} · ${h(e.model)}</span><span>${L("Serial", "Numer seryjny")}: ${h(e.serial_number || "—")}</span><span>${h(label(e.technical_condition))}${e.retired ? " · " + L("Retired", "Wycofane") : ""}</span><div class="${e.next_calibration && day(e.next_calibration) <= today ? "op-calibration-due" : ""}">${L("Next calibration", "Następna kalibracja")}: ${h(day(e.next_calibration) || "—")}</div>${e.assignments.map((a) => `<small>${h(label(a.status))} · ${h(a.assigned_name)} · ${h(dt(a.ends_at))}</small>`).join("")}</article>`).join("") || empty(L("Add measuring instruments, tools or presentation equipment.", "Dodaj przyrządy pomiarowe, narzędzia i sprzęt demonstracyjny."))}</div>`;
    g("equipmentContent")
      .querySelectorAll("[data-equipment]")
      .forEach(
        (c) => (c.onclick = () => showEquipment(Number(c.dataset.equipment))),
      );
  }
  async function equipmentEditor(e = {}) {
    await loadLookup();
    const d = dialog(
      e.id
        ? L("Edit equipment", "Edytuj wyposażenie")
        : L("New equipment", "Nowe wyposażenie"),
      `<form class="op-form">${field("name", L("Equipment name", "Nazwa wyposażenia"), e.name, "text", "required")}${field("manufacturer", L("Manufacturer", "Producent"), e.manufacturer)}${field("model", L("Model", "Model"), e.model)}${field("serial_number", L("Serial number", "Numer seryjny"), e.serial_number)}${field("last_calibration", L("Last calibration", "Ostatnia kalibracja"), day(e.last_calibration), "date")}${field("calibration_months", L("Calibration interval (months; 0 = none)", "Okres kalibracji (miesiące; 0 = brak)"), e.calibration_months ?? 12, "number", 'min="0" max="120" step="1" required')}${select("technical_condition", L("Technical condition", "Stan techniczny"), ["good", "needs_inspection", "damaged", "repair"], e.technical_condition || "good", false)}${select("assigned_to", L("Equipment custodian", "Opiekun sprzętu"), lookup.users, e.assigned_to)}${field("inspection_photo", L("Inspection photo HTTPS link", "Zdjęcie inspekcyjne — link HTTPS"), e.inspection_photo, "url")}${check("retired", L("Retired / unavailable", "Wycofane / niedostępne"), e.retired)}${area("notes", L("Inspection notes", "Notatki inspekcyjne"), e.notes)}<p class="muted op-wide">${L("Saving the calibration date creates one calibration task for the next due date. Updating the date closes the previous calibration task.", "Zapisanie daty kalibracji tworzy jedno zadanie z terminem następnej kalibracji. Zmiana daty zamyka poprzednie zadanie kalibracji.")}</p>${saveBtn()}</form>`,
      true,
    );
    d.find("form").onsubmit = (x) => {
      x.preventDefault();
      submit(d, async () => {
        const b = read(x.target);
        b.retired = x.target.elements.retired.checked;
        await (e.id
          ? API.put("/operations/equipment/" + e.id, b)
          : API.post("/operations/equipment", b));
        switchView("equipment");
        await onView("equipment");
      });
    };
  }
  async function showEquipment(id) {
    const e = equipment.find((x) => x.id === id);
    if (!e) return;
    try {
      const r = await API.get("/operations/equipment/" + id + "/history"),
        d = dialog(
          e.name,
          `<div class="op-toolbar"><button class="btn btn-ghost" id="opEquipmentEdit">${L("Edit / calibrate", "Edytuj / kalibruj")}</button><button class="btn btn-ghost" id="opEquipmentFiles">${L("Files / inspection photos", "Pliki / zdjęcia inspekcyjne")}</button><button class="btn btn-primary" id="opReserveEquipment">${L("Reserve / assign", "Zarezerwuj / przypisz")}</button></div><p>${h(e.manufacturer)} ${h(e.model)} · ${h(e.serial_number)}</p><p>${L("Last / next calibration", "Ostatnia / następna kalibracja")}: ${h(day(e.last_calibration) || "—")} / ${h(day(e.next_calibration) || "—")}</p><p>${h(e.notes)}</p><h3>${L("Reservations, check-outs & returns", "Rezerwacje, pobrania i zwroty")}</h3>${r.assignments.map((a) => `<article class="op-note"><strong>${h(a.assigned_name)} · ${h(label(a.status))}</strong><span>${h(a.project_title || "")}</span><span>${h(dt(a.starts_at))} → ${h(dt(a.ends_at))}</span><p>${h(a.notes)}</p>${a.checkout_condition ? `<small>${L("Checkout condition", "Stan przy pobraniu")}: ${h(a.checkout_condition)}</small>` : ""}${a.return_condition ? `<small>${L("Return condition", "Stan przy zwrocie")}: ${h(a.return_condition)}</small>` : ""}${can() && a.status === "reserved" ? `<button class="btn btn-primary" data-assignment="${a.id}" data-action="checked_out">${L("Check out", "Pobierz")}</button><button class="btn btn-ghost" data-assignment="${a.id}" data-action="cancelled">${L("Cancel reservation", "Anuluj rezerwację")}</button>` : can() && a.status === "checked_out" ? `<button class="btn btn-primary" data-assignment="${a.id}" data-action="returned">${L("Return equipment", "Zdaj sprzęt")}</button>` : ""}</article>`).join("") || empty("—")}`,
          true,
        );
      d.find("#opEquipmentEdit").onclick = () => {
        d.close();
        equipmentEditor(e);
      };
      d.find("#opEquipmentFiles").onclick = () => {
        d.close();
        files("equipment", e.id, e.name);
      };
      d.find("#opReserveEquipment").onclick = () => reservationEditor(e, d);
      d.find("#opEquipmentEdit").disabled = !can();
      d.find("#opReserveEquipment").disabled = !can() || e.retired;
      d.body.querySelectorAll("[data-assignment]").forEach(
        (b) =>
          (b.onclick = () => {
            const action = b.dataset.action,
              ad = dialog(
                label(action),
                `<form class="op-form">${area("condition", L("Technical condition / inspection notes", "Stan techniczny / notatki inspekcyjne"))}${action === "returned" ? select("technical_condition", L("Equipment condition after return", "Stan sprzętu po zwrocie"), ["good", "needs_inspection", "damaged", "repair"], e.technical_condition, false) : ""}${saveBtn()}</form>`,
              );
            ad.find("form").onsubmit = (x) => {
              x.preventDefault();
              submit(ad, async () => {
                await API.patch(
                  "/operations/assignments/" + b.dataset.assignment,
                  { status: action, ...read(x.target) },
                );
                d.close();
                switchView("equipment");
                await onView("equipment");
                await showEquipment(e.id);
              });
            };
          }),
      );
    } catch (err) {
      toast(err.message, "error");
    }
  }
  async function reservationEditor(e, parent) {
    await loadLookup();
    const d = dialog(
      L("Reserve equipment", "Zarezerwuj wyposażenie") + " · " + e.name,
      `<form class="op-form">${select("assigned_to", L("Person taking the equipment", "Osoba pobierająca sprzęt"), lookup.users, null)}${select("project_id", L("Project / service contract", "Projekt / umowa serwisowa"), lookup.projects, null)}${select("task_id", L("Task / presentation", "Zadanie / prezentacja"), lookup.tasks, null)}${field("starts_at", L("From", "Od"), localStamp(new Date().toISOString()), "datetime-local", "required")}${field("ends_at", L("Until", "Do"), localStamp(new Date(Date.now() + 86400000).toISOString()), "datetime-local", "required")}${area("notes", L("Purpose / location", "Cel / lokalizacja"))}${saveBtn()}</form>`,
    );
    d.find("form").onsubmit = (x) => {
      x.preventDefault();
      submit(d, async () => {
        const b = read(x.target);
        b.starts_at = new Date(b.starts_at).toISOString();
        b.ends_at = new Date(b.ends_at).toISOString();
        await API.post("/operations/equipment/" + e.id + "/assignments", b);
        parent.close();
        switchView("equipment");
        await onView("equipment");
        await showEquipment(e.id);
      });
    };
  }
  function dealActions(deal, container) {
    if (!deal || !container) return;
    let slot = container.querySelector(".op-deal-actions");
    if (slot) slot.remove();
    slot = document.createElement("div");
    slot.className = "op-toolbar op-deal-actions";
    slot.innerHTML = `<button class="btn btn-ghost" data-create-project>${L("Create project", "Utwórz projekt")}</button><button class="btn btn-ghost" data-create-order>${L("Create order", "Utwórz zamówienie")}</button>`;
    container.append(slot);
    slot.querySelector("[data-create-project]").onclick = () =>
      projectEditor(
        {},
        {
          deal_id: deal.id,
          title: deal.title,
          company_id: deal.company_id,
          contact_id: deal.contact_id,
          currency: deal.currency,
        },
      );
    slot.querySelector("[data-create-order]").onclick = () =>
      orderEditor(
        {},
        {
          deal_id: deal.id,
          title: deal.title,
          company_id: deal.company_id,
          contact_id: deal.contact_id,
          currency: deal.currency,
        },
      );
    slot
      .querySelectorAll("button")
      .forEach((b) => (b.disabled = !can() || deal.status !== "won"));
  }
  return {
    init,
    onView,
    taskEditor,
    projectEditor,
    orderEditor,
    equipmentEditor,
    dealActions,
  };
})();
