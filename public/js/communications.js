const KlyoCommunications = (() => {
  const { esc, dialog, binary, size } = KlyoDocumentTools;
  let status = null,
    mailPage = 0,
    refreshTimer;
  const call = (fn) => async () => {
    try {
      await fn();
    } catch (e) {
      toast(e.message, "error");
    }
  };
  function init() {
    const p = new URLSearchParams(location.search);
    if (
      p.get("integration") === "connected" &&
      ["team", "personal"].includes(p.get("scope"))
    )
      API.setScope(p.get("scope"));
    const nav = document.querySelector('.nav [data-view="history"]');
    for (const [view, label, path] of [
      ["inbox", "Inbox", "M3 5h18v14H3z M3 5l9 7 9-7"],
      ["rfq", "RFQ register", "M4 3h16v18H4z M8 8h8 M8 12h8 M8 16h5"],
    ]) {
      nav.insertAdjacentHTML(
        "beforebegin",
        `<a href="#" class="nav-item" data-view="${view}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="${path}"/></svg><span>${label}</span></a>`,
      );
      document
        .getElementById("filesView")
        .insertAdjacentHTML(
          "afterend",
          `<section id="${view}View" class="hidden comm-view"></section>`,
        );
    }
  }
  async function getStatus() {
    return (status = await API.get("/communications/status"));
  }
  function connectionLabel(c) {
    return c.account_name || "Microsoft 365";
  }
  async function connect(provider) {
    if (
      provider === "microsoft_mail" &&
      !confirm(
        "Connect your private Microsoft 365 mailbox? Your inbox stays private. Messages from known CRM contacts are added to shared record correspondence. RFQ rules publish matching messages to the workspace. No messages will be sent automatically.",
      )
    )
      return;
    const r = await API.post("/communications/connect/" + provider, {});
    location.assign(r.url);
  }
  async function inbox() {
    const s = await getStatus(),
      cs = s.connections.filter((c) => c.provider === "microsoft_mail"),
      v = document.getElementById("inboxView");
    v.innerHTML = `<div class="comm-toolbar"><div><h2>Microsoft 365 inbox</h2><p>Your mailbox is private. Linked correspondence appears on CRM records.</p></div><button class="btn btn-primary" id="commConnect">Connect Microsoft 365</button></div>${!s.providers.find((x) => x.provider === "microsoft_mail")?.configured ? '<div class="comm-notice">Microsoft sign-in needs administrator setup. <a href="/docs/communications-setup" target="_blank">Setup guide</a></div>' : ""}<div class="comm-connections">${cs.map((c) => `<div><strong>${esc(connectionLabel(c))}</strong> <small>${c.synced_at ? "Synced " + esc(new Date(c.synced_at).toLocaleString()) : "Not synced yet"}</small> <button class="btn btn-ghost btn-sm" data-sync-mail="${c.id}">Sync now</button><button class="btn btn-ghost btn-sm" data-disconnect-mail="${c.id}">Disconnect</button>${c.sync_error ? `<p role="alert">${esc(c.sync_error)}</p>` : ""}</div>`).join("")}</div><div class="comm-toolbar"><input class="input" id="commSearch" type="search" placeholder="Search subject or sender"><span id="commPaging"></span></div><div id="commMessages"></div>`;
    v.querySelector("#commConnect").onclick = call(() =>
      connect("microsoft_mail"),
    );
    v.querySelectorAll("[data-sync-mail]").forEach(
      (b) =>
        (b.onclick = call(async () => {
          b.disabled = true;
          try {
            await API.post(
              "/communications/mail/" + b.dataset.syncMail + "/sync",
              {},
            );
            await inbox();
          } finally {
            b.disabled = false;
          }
        })),
    );
    v.querySelectorAll("[data-disconnect-mail]").forEach(
      (b) =>
        (b.onclick = call(async () => {
          if (
            confirm(
              "Disconnect this mailbox? Imported mail and RFQ entries from this connection will be removed. CRM deals and tasks remain.",
            )
          ) {
            await API.del(
              "/communications/connections/" + b.dataset.disconnectMail,
            );
            await inbox();
          }
        })),
    );
    let timer;
    v.querySelector("#commSearch").oninput = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        mailPage = 0;
        loadMessages().catch((e) => toast(e.message, "error"));
      }, 250);
    };
    await loadMessages();
  }
  async function loadMessages() {
    const search = document.getElementById("commSearch")?.value || "",
      r = await API.get(
        "/communications/mail?search=" +
          encodeURIComponent(search) +
          "&page=" +
          mailPage,
      ),
      box = document.getElementById("commMessages");
    if (!box) return;
    box.innerHTML = r.messages.length
      ? `<div class="table-card doc-scroll"><table class="doc-table"><thead><tr><th>From</th><th>Subject</th><th>Received</th><th>Visibility</th></tr></thead><tbody>${r.messages.map((m) => `<tr data-message="${m.id}" tabindex="0"><td>${esc(m.sender_name || m.sender_email)}<small>${esc(m.sender_email)}</small></td><td>${esc(m.subject)}${m.has_attachments ? " · 📎" : ""}${m.removed ? " · Removed in Outlook" : ""}</td><td>${esc(new Date(m.received_at).toLocaleString())}</td><td>${m.shared ? "Linked to CRM" : "Private inbox"}</td></tr>`).join("")}</tbody></table></div>`
      : '<div class="empty-state"><h3>No messages</h3><p>Connect Microsoft 365, then sync your inbox.</p></div>';
    box.querySelectorAll("[data-message]").forEach((b) => {
      b.onclick = call(() => openMessage(b.dataset.message));
      b.onkeydown = (e) => {
        if (e.key === "Enter") b.click();
      };
    });
    const paging = document.getElementById("commPaging");
    paging.innerHTML = `<button class="btn btn-ghost" id="mailPrev" ${mailPage === 0 ? "disabled" : ""}>Previous</button> ${mailPage + 1} <button class="btn btn-ghost" id="mailNext" ${r.messages.length < 50 ? "disabled" : ""}>Next</button>`;
    paging.querySelector("#mailPrev").onclick = call(async () => {
      mailPage--;
      await loadMessages();
    });
    paging.querySelector("#mailNext").onclick = call(async () => {
      mailPage++;
      await loadMessages();
    });
  }
  async function download(path, name) {
    const r = await binary(path),
      url = URL.createObjectURL(await r.blob()),
      a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
  async function openMessage(id) {
    const r = await API.get("/communications/mail/" + id),
      m = r.message,
      d = dialog(
        m.subject,
        `<div class="comm-message-meta"><strong>${esc(m.sender_name)} &lt;${esc(m.sender_email)}&gt;</strong><span>${esc(new Date(m.received_at).toLocaleString())}</span><p>To: ${esc(m.recipients.join(", "))}</p></div><div class="comm-toolbar"><button class="btn btn-ghost" id="mailLink">Link to CRM record</button><button class="btn btn-ghost" id="mailCreate">Create from email</button>${m.has_attachments ? '<button class="btn btn-ghost" id="mailAttachments">Load attachments</button>' : ""}</div><div id="mailLinks">${r.links.map((l) => `<span class="comm-tag">${esc(l.entity)} #${l.entity_id}</span>`).join("")}</div><pre class="comm-message-body">${esc(m.body_text)}</pre><div id="mailAttachmentRows"></div>`,
        true,
      );
    d.find("#mailLink").onclick = () =>
      chooseRecord(async (record) => {
        try {
          await API.post("/communications/mail/" + id + "/link", record);
          d.close();
          await openMessage(id);
        } catch (e) {
          toast(e.message, "error");
        }
      });
    d.find("#mailCreate").onclick = () => createFromMail(m, d);
    const draw = (aa) => {
      d.find("#mailAttachmentRows").innerHTML = aa
        .map(
          (a) =>
            `<button class="btn btn-ghost" data-download-attachment="${a.id}">${esc(a.name)} · ${size(a.size)}</button>`,
        )
        .join("");
      d.root
        .querySelectorAll("[data-download-attachment]")
        .forEach(
          (b) =>
            (b.onclick = call(() =>
              download(
                "/communications/attachments/" +
                  b.dataset.downloadAttachment +
                  "/download",
                aa.find((a) => String(a.id) === b.dataset.downloadAttachment)
                  .name,
              ),
            )),
        );
    };
    draw(r.attachments);
    if (d.find("#mailAttachments"))
      d.find("#mailAttachments").onclick = async () => {
        try {
          draw(
            (
              await API.post(
                "/communications/mail/" + id + "/attachments/sync",
                {},
              )
            ).attachments,
          );
        } catch (e) {
          d.error(e);
        }
      };
  }
  async function chooseRecord(callback) {
    const d = dialog(
      "Link to CRM record",
      '<p>Linking publishes this message and its attachments to colleagues who can access this CRM record. Your other inbox messages remain private.</p><label>Record type<select id="commEntity"><option value="contact">Contact</option><option value="company">Company</option><option value="deal">Deal</option><option value="product">Product</option><option value="quote">Quote</option></select></label><label>Record<select id="commRecord"></select></label><button class="btn btn-primary" id="commRecordSave">Link record</button>',
    );
    let rows = [];
    async function load() {
      const kind = d.find("#commEntity").value,
        r = await API.get("/" + ({ company: "companies" }[kind] || kind + "s"));
      rows = r[{ company: "companies" }[kind] || kind + "s"] || [];
      d.find("#commRecord").innerHTML = rows
        .map(
          (x) =>
            `<option value="${x.id}">${esc(x.full_name || x.name || x.title || "#" + x.id)}</option>`,
        )
        .join("");
    }
    d.find("#commEntity").onchange = () => load().catch(d.error);
    d.find("#commRecordSave").onclick = async () => {
      try {
        const id = Number(d.find("#commRecord").value);
        if (!id) throw new Error("Choose a record.");
        await callback({ entity: d.find("#commEntity").value, entity_id: id });
        d.close();
      } catch (e) {
        d.error(e);
      }
    };
    load().catch(d.error);
  }
  async function createFromMail(m, parent) {
    const d = dialog(
      "Create from email",
      `<label>Type<select id="mailCreateType"><option value="contact">Contact</option><option value="company">Company</option><option value="deal">Deal</option></select></label><label>Name<input id="mailCreateName" value="${esc(m.sender_name || m.subject)}"></label><p>Link this message to the new record. Additional CRM details can be edited afterward.</p><button class="btn btn-primary" id="mailCreateSave">Create and link</button>`,
    );
    d.find("#mailCreateSave").onclick = async () => {
      try {
        await API.post("/communications/mail/" + m.id + "/create", {
          type: d.find("#mailCreateType").value,
          name: d.find("#mailCreateName").value,
        });
        d.close();
        parent.close();
        await openMessage(m.id);
      } catch (e) {
        d.error(e);
      }
    };
  }
  async function history(kind, id, name) {
    const r = await API.get(
        "/communications/history?entity=" +
          encodeURIComponent(kind) +
          "&entity_id=" +
          id,
      ),
      d = dialog(
        "Correspondence · " + name,
        r.messages.length
          ? `<div class="comm-history">${r.messages.map((m) => `<button class="btn btn-ghost" data-history-mail="${m.id}"><strong>${esc(m.subject)}</strong><small>${esc(m.sender_email)} · ${esc(new Date(m.received_at).toLocaleString())}</small></button>`).join("")}</div>`
          : "<p>No linked correspondence yet. Connect Microsoft 365 from Inbox, or link an email manually.</p>",
        true,
      );
    d.root
      .querySelectorAll("[data-history-mail]")
      .forEach(
        (b) => (b.onclick = call(() => openMessage(b.dataset.historyMail))),
      );
  }
  async function rfq() {
    const s = await getStatus(),
      r = await API.get("/communications/rfq"),
      v = document.getElementById("rfqView");
    v.innerHTML = `<div class="comm-toolbar"><div><h2>RFQ register</h2><p>Incoming requests, accountable owners and response deadlines. Rules only process mail received after activation.</p></div>${s.can_manage ? '<button class="btn btn-primary" id="rfqRules">Inbound rules</button>' : ""}</div><div class="doc-scroll table-card"><table class="doc-table"><thead><tr><th>Request</th><th>Sender</th><th>Assignee</th><th>Response deadline</th><th>Time remaining</th><th>Status</th><th>Deal / task</th></tr></thead><tbody>${r.requests.map((x) => `<tr><td><button class="btn btn-ghost btn-sm" data-rfq-message="${x.message_id}">${esc(x.subject)}</button></td><td>${esc(x.sender_email)}</td><td>${esc(x.assignee_name || "Unassigned")}</td><td>${esc(new Date(x.due_at).toLocaleString())}</td><td data-sla="${esc(x.due_at)}" data-done="${!!x.responded_at || x.status === "closed"}"></td><td><select data-rfq-status="${x.id}">${["new", "in_progress", "responded", "closed"].map((y) => `<option value="${y}" ${y === x.status ? "selected" : ""}>${esc(y.replace("_", " "))}</option>`).join("")}</select></td><td>${x.deal_id ? "Deal #" + x.deal_id : ""} · ${x.task_id ? "Task #" + x.task_id : ""}</td></tr>`).join("")}</tbody></table>${!r.requests.length ? '<p class="comm-notice">No requests yet. The workspace owner can connect a mailbox and activate a folder rule.</p>' : ""}</div>`;
    v.querySelector("#rfqRules")?.addEventListener("click", call(rules));
    v.querySelectorAll("[data-rfq-message]").forEach(
      (b) => (b.onclick = call(() => openMessage(b.dataset.rfqMessage))),
    );
    v.querySelectorAll("[data-rfq-status]").forEach(
      (b) =>
        (b.onchange = call(async () => {
          await API.patch("/communications/rfq/" + b.dataset.rfqStatus, {
            status: b.value,
          });
          await rfq();
        })),
    );
    clearInterval(refreshTimer);
    function tick() {
      v.querySelectorAll("[data-sla]").forEach((el) => {
        const left = new Date(el.dataset.sla) - Date.now(),
          done = el.dataset.done === "true";
        el.className =
          "comm-sla " +
          (done
            ? "comm-done"
            : left < 0
              ? "comm-overdue"
              : left < 3600000
                ? "comm-soon"
                : "");
        el.textContent = done
          ? "Recorded"
          : (left < 0 ? "Overdue " : "") +
            Math.floor(Math.abs(left) / 3600000) +
            "h " +
            Math.floor((Math.abs(left) % 3600000) / 60000) +
            "m";
      });
    }
    tick();
    refreshTimer = setInterval(tick, 15000);
  }
  async function rules() {
    const s = await getStatus(),
      mailboxes = s.connections.filter((c) => c.provider === "microsoft_mail"),
      r = await API.get("/communications/rfq/rules");
    if (!mailboxes.length) {
      toast("Connect your Microsoft 365 mailbox from Inbox first.", "error");
      return;
    }
    const d = dialog(
      "Inbound RFQ rules",
      `<div>${r.rules.map((r) => `<p><strong>${esc(r.name)}</strong> · ${r.sla_minutes} min <button class="btn btn-ghost btn-sm" data-rule-delete="${r.id}">Remove</button></p>`).join("")}</div><hr><p>Each matching new message creates one sales opportunity and one response task. No email is sent.</p><label>Rule name<input id="rfqName" value="Inbound sales enquiries"></label><label>Mailbox<select id="rfqConnection">${mailboxes.map((c) => `<option value="${c.id}">${esc(connectionLabel(c))}</option>`).join("")}</select></label><label>Mail folder<select id="rfqFolder"></select></label><button class="btn btn-ghost btn-sm" id="rfqChildFolders">Browse selected subfolders</button><label>Subject contains (optional)<input id="rfqSubject"></label><label>Sender domain (optional)<input id="rfqDomain" placeholder="example.com"></label><label>Assignee<select id="rfqAssignee"></select></label><label>Pipeline<select id="rfqPipeline"></select></label><label>Stage<select id="rfqStage"></select></label><label>Response SLA (minutes)<input type="number" min="1" max="43200" value="120" id="rfqSla"></label><button class="btn btn-primary" id="rfqSave">Activate rule for future messages</button>`,
      true,
    );
    const users = await API.get("/auth/team"),
      pipelines = await API.get("/pipelines");
    d.find("#rfqAssignee").innerHTML = (users.team || [])
      .map((u) => `<option value="${u.id}">${esc(u.name)}</option>`)
      .join("");
    d.find("#rfqPipeline").innerHTML = pipelines.pipelines
      .map((p) => `<option value="${p.id}">${esc(p.name)}</option>`)
      .join("");
    const loadStages = async () => {
      const r = await API.get(
        "/deals/stages?pipeline_id=" + d.find("#rfqPipeline").value,
      );
      d.find("#rfqStage").innerHTML = r.stages
        .map((s) => `<option value="${s.id}">${esc(s.name)}</option>`)
        .join("");
    };
    const loadFolders = async (parent) => {
      const r = await API.get(
        "/communications/mail/folders/" +
          d.find("#rfqConnection").value +
          (parent ? "?parent=" + encodeURIComponent(parent) : ""),
      );
      d.find("#rfqFolder").innerHTML = r.folders
        .map(
          (f) =>
            `<option value="${esc(f.id)}">${esc(f.name)}${f.child_count ? " /" : ""}</option>`,
        )
        .join("");
    };
    d.find("#rfqConnection").onchange = () => loadFolders().catch(d.error);
    d.find("#rfqChildFolders").onclick = () =>
      loadFolders(d.find("#rfqFolder").value).catch(d.error);
    d.find("#rfqPipeline").onchange = () => loadStages().catch(d.error);
    await Promise.all([loadStages(), loadFolders()]);
    d.root.querySelectorAll("[data-rule-delete]").forEach(
      (b) =>
        (b.onclick = async () => {
          try {
            await API.del("/communications/rfq/rules/" + b.dataset.ruleDelete);
            d.close();
            await rules();
          } catch (e) {
            d.error(e);
          }
        }),
    );
    d.find("#rfqSave").onclick = async () => {
      try {
        await API.post("/communications/rfq/rules", {
          name: d.find("#rfqName").value,
          connection_id: Number(d.find("#rfqConnection").value),
          folder_id: d.find("#rfqFolder").value,
          subject_contains: d.find("#rfqSubject").value,
          sender_domain: d.find("#rfqDomain").value,
          assigned_to: Number(d.find("#rfqAssignee").value),
          pipeline_id: Number(d.find("#rfqPipeline").value),
          stage_id: Number(d.find("#rfqStage").value),
          sla_minutes: Number(d.find("#rfqSla").value),
        });
        d.close();
        toast("RFQ rule activated for new messages");
      } catch (e) {
        d.error(e);
      }
    };
  }
  async function onView(view) {
    if (view === "inbox") await inbox();
    if (view === "rfq") await rfq();
    else clearInterval(refreshTimer);
  }
  return {
    init,
    onView,
    history,
    openMessage,
    chooseRecord,
    download,
    connect,
    getStatus,
  };
})();
