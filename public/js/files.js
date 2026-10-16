{
  const query = new URLSearchParams(location.search);
  if (
    query.get("sharepoint") === "connected" &&
    ["team", "personal"].includes(query.get("scope"))
  )
    API.setScope(query.get("scope"));
}
const KlyoFiles = (() => {
  const { esc, dialog, binary, size } = KlyoDocumentTools;
  let state = null,
    filter = null;
  const editable = () => API.getUser()?.role !== "viewer";
  function init() {
    document
      .querySelector('.nav [data-view="history"]')
      .insertAdjacentHTML(
        "beforebegin",
        '<a href="#" class="nav-item" data-view="files"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 7h7l2-3h9v17H3z"/></svg><span data-i18n="nav.files">Files</span></a>',
      );
    document
      .getElementById("productsView")
      .insertAdjacentHTML(
        "afterend",
        '<section id="filesView" class="hidden"><div id="filesStatus"></div><div class="files-view-toolbar"><strong id="filesHeading">Workspace files</strong><button class="btn btn-ghost" id="filesClearFilter" hidden>All files</button><button class="btn btn-ghost" id="filesLink">Link from SharePoint</button><button class="btn btn-primary" id="filesUpload">Upload files</button><input type="file" id="filesInput" multiple hidden></div><div id="filesRows" class="table-card"></div></section>',
      );
    document.getElementById("filesUpload").onclick = () =>
      chooseRecord(filter, (record) => {
        document.getElementById("filesInput").onchange = (e) =>
          upload([...e.target.files], record).catch((e) =>
            toast(e.message, "error"),
          );
        document.getElementById("filesInput").click();
      });
    document.getElementById("filesLink").onclick = () =>
      chooseRecord(filter, (record) =>
        pick(async (item) => {
          try {
            await API.post("/sharepoint/link", { item_id: item.id, ...record });
            await refresh();
            toast("File linked");
          } catch (e) {
            toast(e.message, "error");
          }
        }).catch((e) => toast(e.message, "error")),
      );
    document.getElementById("filesClearFilter").onclick = () => {
      filter = null;
      refresh().catch((e) => toast(e.message, "error"));
    };
  }
  async function refresh() {
    state = await API.get("/sharepoint/status");
    const c = state.connection,
      pl = KlyoI18n.getLang() === "pl",
      box = document.getElementById("filesStatus");
    box.innerHTML = `<div class="files-status"><div><h3>SharePoint ${state.ready ? "· Connected" : state.connected ? "· Choose a folder" : "· Not connected"}</h3><div class="files-note">${state.ready ? esc([c.site_name, c.drive_name, c.root_name].join(" / ")) : state.configured ? "Connect your Microsoft work account and choose a document library for CRM files." : "Microsoft sign-in has not been configured yet. The app owner must complete the Entra setup before connecting."}</div><small>${API.scope() === "personal" ? "Personal connection · only you" : "Team connection · shared workspace"}</small></div>${state.can_manage ? '<button class="btn btn-ghost" id="filesSettings">' + (pl ? "Konfiguracja SharePoint" : "Configure SharePoint") + "</button>" : ""}</div>`;
    document
      .getElementById("filesSettings")
      ?.addEventListener("click", () =>
        configure().catch((e) => toast(e.message, "error")),
      );
    document.getElementById("filesUpload").disabled =
      !state.ready || !editable();
    document.getElementById("filesLink").disabled = !state.ready || !editable();
    document.getElementById("filesClearFilter").hidden = !filter;
    document.getElementById("filesHeading").textContent = filter
      ? "Files · " + filter.name
      : "Workspace files";
    const query = filter
        ? "?entity=" + filter.entity + "&entity_id=" + filter.entity_id
        : "",
      data = await API.get("/sharepoint/files" + query);
    document.getElementById("filesRows").innerHTML = data.files.length
      ? `<div class="doc-scroll"><table class="doc-table"><thead><tr><th>File</th><th>Size</th><th>Linked record</th><th>Added</th><th></th></tr></thead><tbody>${data.files.map((f) => `<tr><td>${esc(f.name)}</td><td>${size(f.size)}</td><td>${esc(f.entity || "Workspace")}${f.entity_id ? " #" + f.entity_id : ""}</td><td>${esc(String(f.created_at).slice(0, 10))}</td><td><button class="btn btn-ghost btn-sm" data-open-file="${f.id}" ${state.ready ? "" : "disabled"}>Open</button>${editable() ? `<button class="btn btn-ghost btn-sm" data-unlink-file="${f.id}">Unlink</button>` : ""}</td></tr>`).join("")}</tbody></table></div>`
      : '<div class="empty-state"><h3>No files linked yet</h3><p>Upload documents to your connected SharePoint folder, or link an existing file to a CRM record.</p></div>';
    document.querySelectorAll("[data-open-file]").forEach(
      (b) =>
        (b.onclick = async () => {
          const win = window.open("about:blank", "_blank");
          if (win) win.opener = null;
          try {
            const r = await API.get(
              "/sharepoint/files/" + b.dataset.openFile + "/open",
            );
            if (win) win.location = r.url;
            else window.location.href = r.url;
          } catch (e) {
            win?.close();
            toast(e.message, "error");
          }
        }),
    );
    document.querySelectorAll("[data-unlink-file]").forEach(
      (b) =>
        (b.onclick = async () => {
          if (
            !confirm(
              "Remove this CRM link? The original file stays in SharePoint.",
            )
          )
            return;
          try {
            await API.del("/sharepoint/files/" + b.dataset.unlinkFile);
            await refresh();
          } catch (e) {
            toast(e.message, "error");
          }
        }),
    );
  }
  async function configure() {
    state = await API.get("/sharepoint/status");
    if (!state.can_manage)
      throw new Error("Only the owner can configure the workspace connection.");
    const d = dialog(
      "SharePoint connection",
      `<p>${API.scope() === "personal" ? "This connection is private to your Personal space." : "This connection is shared with your team. Only the team owner can change it."}</p>${!state.configured ? '<p>Microsoft sign-in needs to be enabled by the Klyo app owner. See the setup guide for Entra app registration and Railway settings.</p><a class="btn btn-ghost" href="/docs/sharepoint-setup" target="_blank" rel="noopener">Open setup guide</a>' : `<p>${esc(state.connection?.account_name || "Sign in with your Microsoft work or school account.")}</p><div class="doc-actions"><button class="btn btn-primary" id="connectMicrosoft">${state.connected ? "Reconnect Microsoft" : "Connect Microsoft"}</button>${state.connected ? '<button class="btn btn-ghost" id="chooseLibrary">Choose library / folder</button><button class="btn btn-ghost" id="disconnectMicrosoft">Disconnect</button>' : ""}</div><div id="librarySetup"></div>`}`,
    );
    d.find("#connectMicrosoft")?.addEventListener("click", async () => {
      try {
        d.find("#connectMicrosoft").disabled = true;
        const r = await API.post("/sharepoint/connect", {});
        window.location.href = r.url;
      } catch (e) {
        d.error(e);
        d.find("#connectMicrosoft").disabled = false;
      }
    });
    d.find("#disconnectMicrosoft")?.addEventListener("click", async () => {
      if (
        !confirm(
          "Disconnect SharePoint for this workspace? Files remain in Microsoft and CRM links are kept.",
        )
      )
        return;
      try {
        await API.del("/sharepoint/connection");
        d.close();
        await refresh();
      } catch (e) {
        d.error(e);
      }
    });
    d.find("#chooseLibrary")?.addEventListener("click", () => setup(d));
    if (state.connected && !state.ready) await setup(d);
  }
  async function setup(d) {
    const host = d.find("#librarySetup");
    host.innerHTML =
      '<label>Find your SharePoint site<input id="sharepointSiteSearch" placeholder="Company or site name"></label><button class="btn btn-ghost" id="findSharepointSites">Search sites</button><div id="sharepointSites"></div><div id="sharepointLibraries"></div><div id="sharepointSetupFolders"></div>';
    d.find("#findSharepointSites").onclick = async () => {
      try {
        const data = await API.get(
          "/sharepoint/sites?search=" +
            encodeURIComponent(d.find("#sharepointSiteSearch").value || "*"),
        );
        d.find("#sharepointSites").innerHTML = data.sites.length
          ? data.sites
              .map(
                (s) =>
                  `<button class="doc-folder" data-sp-site="${esc(s.id)}">${esc(s.name)}</button>`,
              )
              .join("")
          : "<p>No matching sites. Check Microsoft permissions or try another site name.</p>";
        d.root.querySelectorAll("[data-sp-site]").forEach(
          (b) =>
            (b.onclick = async () => {
              try {
                const drives = await API.get(
                  "/sharepoint/drives?site_id=" +
                    encodeURIComponent(b.dataset.spSite),
                );
                d.find("#sharepointLibraries").innerHTML =
                  "<h3>Document libraries</h3>" +
                  drives.drives
                    .map(
                      (l) =>
                        `<button class="doc-folder" data-sp-drive="${esc(l.id)}">${esc(l.name)}</button>`,
                    )
                    .join("");
                d.root
                  .querySelectorAll("[data-sp-drive]")
                  .forEach(
                    (b2) =>
                      (b2.onclick = () =>
                        setupFolder(b.dataset.spSite, b2.dataset.spDrive)),
                  );
              } catch (e) {
                d.error(e);
              }
            }),
        );
      } catch (e) {
        d.error(e);
      }
    };
    async function setupFolder(site, drive) {
      const host = d.find("#sharepointSetupFolders");
      let path = [{ id: "root", name: "Library root" }];
      async function render(cursor, append = false) {
        try {
          const folder = path.at(-1),
            data = await API.get(
              "/sharepoint/setup/folders?site_id=" +
                encodeURIComponent(site) +
                "&drive_id=" +
                encodeURIComponent(drive) +
                "&folder_id=" +
                encodeURIComponent(folder.id) +
                (cursor ? "&cursor=" + encodeURIComponent(cursor) : ""),
            );
          if (!append)
            host.innerHTML = `<p>${path.map((p) => esc(p.name)).join(" / ")}</p><div class="doc-actions"><button class="btn btn-ghost" id="spSetupBack" ${path.length < 2 ? "disabled" : ""}>Parent folder</button><button class="btn btn-primary" id="spUseFolder">Use this folder for CRM files</button></div><div id="spSetupItems"></div><button class="btn btn-ghost" id="spMoreSetup" hidden>Load more</button>`;
          host.querySelector("#spSetupItems").insertAdjacentHTML(
            "beforeend",
            data.items
              .filter((i) => i.folder)
              .map(
                (i) =>
                  `<button class="doc-folder" data-sp-folder="${esc(i.id)}">▸ ${esc(i.name)}</button>`,
              )
              .join(""),
          );
          host.querySelectorAll("[data-sp-folder]").forEach(
            (b) =>
              (b.onclick = () => {
                path.push({
                  id: b.dataset.spFolder,
                  name: b.textContent.slice(2),
                });
                render();
              }),
          );
          host.querySelector("#spSetupBack").onclick = () => {
            path.pop();
            render();
          };
          host.querySelector("#spUseFolder").onclick = async () => {
            try {
              await API.put("/sharepoint/folder", {
                site_id: site,
                drive_id: drive,
                root_id: folder.id,
              });
              d.close();
              await refresh();
              toast("SharePoint folder connected");
            } catch (e) {
              d.error(e);
            }
          };
          const more = host.querySelector("#spMoreSetup");
          more.hidden = !data.cursor;
          more.onclick = () => render(data.cursor, true);
        } catch (e) {
          d.error(e);
        }
      }
      await render();
    }
  }
  async function pick(onPick) {
    const status = await API.get("/sharepoint/status");
    if (!status.ready)
      throw new Error("Open Files and connect a SharePoint folder first.");
    const d = dialog("Choose a SharePoint file", '<div id="spPicker"></div>');
    let path = [
      { id: status.connection.root_id, name: status.connection.root_name },
    ];
    async function render(cursor, append = false) {
      try {
        const data = await API.get(
            "/sharepoint/children?folder_id=" +
              encodeURIComponent(path.at(-1).id) +
              (cursor ? "&cursor=" + encodeURIComponent(cursor) : ""),
          ),
          host = d.find("#spPicker");
        if (!append)
          host.innerHTML = `<p>${path.map((p) => esc(p.name)).join(" / ")}</p><button class="btn btn-ghost" id="spPickerBack" ${path.length < 2 ? "disabled" : ""}>Parent folder</button><div id="spPickerItems"></div><button class="btn btn-ghost" id="spPickerMore" hidden>Load more</button>`;
        host
          .querySelector("#spPickerItems")
          .insertAdjacentHTML(
            "beforeend",
            data.items
              .map(
                (i) =>
                  `<button class="doc-folder" data-picker-item="${esc(i.id)}">${i.folder ? "▸" : "↗"} ${esc(i.name)} ${i.folder ? "" : "· " + size(i.size)}</button>`,
              )
              .join(""),
          );
        host.querySelectorAll("[data-picker-item]").forEach((b) => {
          const item = data.items.find((i) => i.id === b.dataset.pickerItem);
          if (item)
            b.onclick = () => {
              if (item.folder) {
                path.push(item);
                render();
              } else {
                d.close();
                onPick(item);
              }
            };
        });
        host.querySelector("#spPickerBack").onclick = () => {
          path.pop();
          render();
        };
        const more = host.querySelector("#spPickerMore");
        more.hidden = !data.cursor;
        more.onclick = () => render(data.cursor, true);
      } catch (e) {
        d.error(e);
      }
    }
    await render();
  }
  function chooseRecord(preset, callback) {
    if (preset) {
      callback({ entity: preset.entity, entity_id: preset.entity_id });
      return;
    }
    const d = dialog(
      "Link files to a record",
      '<p>Keep these files in the workspace, or attach them to a particular customer, product or offer.</p><div class="files-record"><select id="fileRecordType"><option value="">Workspace files</option><option value="contact">Contact</option><option value="company">Company</option><option value="deal">Deal</option><option value="product">Product</option><option value="quote">Quote</option><option value="project">Project</option><option value="order">Order</option><option value="equipment">Equipment</option></select><select id="fileRecordId" disabled><option value="">Choose a record</option></select></div><button id="fileRecordContinue" class="btn btn-primary">Continue</button>',
    );
    d.find("#fileRecordType").onchange = async () => {
      try {
        const kind = d.find("#fileRecordType").value,
          el = d.find("#fileRecordId");
        el.disabled = !kind;
        el.innerHTML = '<option value="">Choose a record</option>';
        if (!kind) return;
        const data = await API.get(
            "/" +
              {
                contact: "contacts?limit=1000",
                company: "companies",
                deal: "deals",
                product: "products",
                quote: "quotes",
            project: "operations/projects", order:"operations/orders", equipment:"operations/equipment",
              }[kind],
          ),
          rows =
            data[
              {
                contact: "contacts",
                company: "companies",
                deal: "deals",
                product: "products",
                quote: "quotes",
              project:"projects",order:"orders",equipment:"equipment",
              }[kind]
            ] || [];
        if (d.find("#fileRecordType").value !== kind) return;
        el.innerHTML += rows
          .map(
            (r) =>
              `<option value="${r.id}">${esc(r.full_name || r.name || r.title)}</option>`,
          )
          .join("");
      } catch (e) {
        d.error(e);
      }
    };
    d.find("#fileRecordContinue").onclick = () => {
      const entity = d.find("#fileRecordType").value,
        entity_id = d.find("#fileRecordId").value;
      if (entity && !entity_id) {
        d.error("Choose a record.");
        return;
      }
      d.close();
      callback({ entity: entity || null, entity_id: entity_id || null });
    };
  }
  async function upload(files, record) {
    if (!files.length) return;
    const d = dialog(
      "Upload to SharePoint",
      '<p id="fileUploadName"></p><progress class="files-progress" id="fileUploadProgress" value="0" max="100"></progress><p id="fileUploadLabel">Preparing…</p><p>You can keep working after the upload finishes. Closing this window stops after the current chunk. A short filename suffix protects existing documents from being replaced.</p>',
    );
    for (let index = 0; index < files.length; index++) {
      if (!d.root.isConnected) break;
      const file = files[index];
      d.find("#fileUploadProgress").value = 0;
      d.find("#fileUploadLabel").textContent = "Preparing…";
      d.find("#fileUploadName").textContent =
        `${index + 1}/${files.length} · ${file.name} · ${size(file.size)}`;
      const session = await API.post("/sharepoint/uploads", {
        name: file.name,
        size: file.size,
        ...record,
      });
      let offset = 0;
      while (offset < file.size && d.root.isConnected) {
        const end = Math.min(offset + session.chunk_size, file.size);
        let result;
        for (let retry = 0; retry < 3; retry++) {
          try {
            const response = await binary("/sharepoint/uploads/" + session.id, {
              method: "PUT",
              headers: {
                "Content-Type": "application/octet-stream",
                "Content-Range": `bytes ${offset}-${end - 1}/${file.size}`,
              },
              body: file.slice(offset, end),
            });
            result = await response.json();
            break;
          } catch (e) {
            if (retry === 2) {
              d.error(e);
              throw e;
            }
            await new Promise((r) => setTimeout(r, 700 * (retry + 1)));
          }
        }
        if (!result || result.offset <= offset)
          throw new Error(
            "Microsoft did not confirm the file. Try uploading again.",
          );
        offset = result.offset;
        d.find("#fileUploadProgress").value = Math.round(
          (offset / file.size) * 100,
        );
        d.find("#fileUploadLabel").textContent =
          `${Math.round((offset / file.size) * 100)}% uploaded`;
      }
    }
    if (d.root.isConnected) {
      d.close();
      toast("Files uploaded to SharePoint");
    }
    document.getElementById("filesInput").value = "";
    await refresh();
  }
  function recordButton(kind, id, overlay, name) {
    const host = document
      .getElementById(overlay)
      ?.querySelector(".panel-head, .modal-head");
    if (!host) return;
    host.querySelector("[data-record-files]")?.remove();
    if (!id) return;
    const b = document.createElement("button");
    b.type = "button";
    b.className = "btn btn-ghost btn-sm";
    b.dataset.recordFiles = "";
    b.textContent = "Files";
    b.onclick = () => {
      filter = { entity: kind, entity_id: id, name: name || kind };
      document.getElementById(overlay).classList.add("hidden");
      switchView("files");
    };
    host.append(b);
  }
  function showRecord(entity,id,name){filter={entity,entity_id:id,name:name||entity};switchView("files");}
  async function redirect() {
    const p = new URLSearchParams(location.search);
    if (!p.has("sharepoint")) return;
    const outcome = p.get("sharepoint");
    p.delete("sharepoint");
    p.delete("scope");
    history.replaceState(
      {},
      "",
      location.pathname + (p.size ? "?" + p : "") + location.hash,
    );
    switchView("files");
    if (outcome === "connected") {
      toast("Microsoft connected. Choose a library and folder.");
      await configure();
    } else
      toast(
        outcome === "cancelled"
          ? "Microsoft connection cancelled."
          : "Unable to connect Microsoft. Try again.",
        "error",
      );
  }
  return {
    init,
    refresh,
    configure,
    pick,
    recordButton,
    showRecord,
    redirect,
    onView: (view) => {
      if (view === "files") refresh().catch((e) => toast(e.message, "error"));
    },
  };
})();
