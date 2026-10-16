const KlyoNotifications = (() => {
  const g = (id) => document.getElementById(id),
    pl = () => KlyoI18n.getLang() === "pl",
    l = (en, p) => (pl() ? p : en);
  let timer = null,
    ticket = 0,
    items = [];
  function init() {
    if (g("taskReminderBell")) return;
    const bell = document.createElement("button");
    bell.id = "taskReminderBell";
    bell.className = "btn btn-ghost btn-sm task-reminder-bell";
    bell.type = "button";
    bell.title = l(
      "Task and calibration reminders",
      "Przypomnienia zadań i kalibracji",
    );
    bell.setAttribute("aria-label", bell.title);
    bell.innerHTML =
      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M9 3h6l1 3h4v15H4V6h4z M8 13l3 3 5-6"/></svg><span id="taskReminderCount" hidden>0</span>';
    const target = g("warrantyBell");
    if (target) target.after(bell);
    else document.querySelector(".topbar-actions")?.prepend(bell);
    bell.onclick = open;
    refresh();
    timer = setInterval(() => {
      if (!document.hidden) refresh();
    }, 60000);
    window.addEventListener("focus", refresh);
  }
  async function refresh() {
    const version = ++ticket;
    try {
      const data = await API.get("/operations/reminders");
      if (version !== ticket) return;
      items = data.reminders || [];
      g("taskReminderCount").textContent = items.length;
      g("taskReminderCount").hidden = !items.length;
      g("taskReminderBell").classList.toggle("has-reminders", items.length > 0);
    } catch {}
  }
  async function open() {
    await refresh();
    const { esc, dialog } = KlyoDocumentTools,
      d = dialog(
        l("Task & calibration reminders", "Przypomnienia zadań i kalibracji"),
        `<p>${l("Reminders assigned to you, including calibration and service deadlines.", "Przypomnienia przypisane do Ciebie, w tym terminy kalibracji i serwisu.")}</p><div>${items.map((t) => `<article class="task-reminder-item"><strong>${esc(t.title)}</strong><p>${l("Due", "Termin")}: ${esc(t.due_date?.slice(0, 10) || "—")}</p><button class="btn btn-primary btn-sm" data-open-reminder="${t.id}">${l("Open task", "Otwórz zadanie")}</button>${API.getUser()?.role !== "viewer" ? `<button class="btn btn-ghost btn-sm" data-dismiss-reminder="${t.id}">${l("Dismiss reminder", "Odrzuć przypomnienie")}</button>` : ""}</article>`).join("") || `<p>${l("No reminders due.", "Brak przypomnień do wyświetlenia.")}</p>`}`,
      );
    d.root.querySelectorAll("[data-open-reminder]").forEach(
      (b) =>
        (b.onclick = () => {
          const task = items.find(
            (t) => String(t.id) === b.dataset.openReminder,
          );
          d.close();
          KlyoOperations.taskEditor(task).catch((e) =>
            toast(e.message, "error"),
          );
        }),
    );
    d.root.querySelectorAll("[data-dismiss-reminder]").forEach(
      (b) =>
        (b.onclick = async () => {
          try {
            await API.post(
              "/operations/tasks/" +
                b.dataset.dismissReminder +
                "/dismiss-reminder",
              {},
            );
            d.close();
            await open();
          } catch (e) {
            d.error(e);
          }
        }),
    );
  }
  return { init, refresh };
})();
