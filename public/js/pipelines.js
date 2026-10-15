/* Named sales pipelines and company groups. Personal selection, shared sales data. */
const KlyoPipelines = (() => {
  const g = (id) => document.getElementById(id);
  const h = (v) =>
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
  const labels = {
    en: {
      pipeline: "Sales pipeline",
      add: "Add another pipeline",
      edit: "Edit pipeline",
      purpose: "What is this pipeline for?",
      emptyPurpose:
        "Add a description to explain which opportunities belong here.",
      name: "Pipeline name",
      description: "What do you sell here?",
      example: "e.g. Sensors",
      descriptionExample:
        "Sensor sales, from first conversation to purchase order.",
      copy: "Starting stages",
      standard: "Standard sales stages",
      save: "Save pipeline",
      cancel: "Cancel",
      remove: "Delete empty pipeline",
      confirm: "Delete this empty pipeline and its stages?",
      parent: "Parent company",
      none: "Independent company",
      children: "Sub-companies",
      addChild: "Add sub-company",
      noChildren: "No sub-companies yet.",
      group: "Company group",
      saved: "Pipeline saved",
      failed: "Could not load stages. Try again.",
      stage: "No stage",
    },
    pl: {
      pipeline: "Lejek sprzedaży",
      add: "Dodaj kolejny lejek",
      edit: "Edytuj lejek",
      purpose: "Do czego służy ten lejek?",
      emptyPurpose:
        "Dodaj opis, aby wyjaśnić, które szanse sprzedaży tu trafiają.",
      name: "Nazwa lejka",
      description: "Co sprzedajesz w tym lejku?",
      example: "np. Czujniki",
      descriptionExample:
        "Sprzedaż czujników — od pierwszej rozmowy do zamówienia.",
      copy: "Etapy na początek",
      standard: "Standardowe etapy sprzedaży",
      save: "Zapisz lejek",
      cancel: "Anuluj",
      remove: "Usuń pusty lejek",
      confirm: "Usunąć ten pusty lejek i jego etapy?",
      parent: "Firma nadrzędna",
      none: "Firma niezależna",
      children: "Podfirmy",
      addChild: "Dodaj podfirmę",
      noChildren: "Brak podfirm.",
      group: "Grupa firm",
      saved: "Zapisano lejek",
      failed: "Nie udało się wczytać etapów. Spróbuj ponownie.",
      stage: "Bez etapu",
    },
  };
  const l = (k) => (labels[KlyoI18n.getLang()] || labels.en)[k];
  let list = [],
    selectedId = null,
    pending = null,
    modalVersion = 0;
  const editor = () => API.getUser()?.role !== "viewer";
  const key = () =>
    `klyo_pipeline:${API.getUser()?.workspace_id || "workspace"}:${API.getUser()?.id}`;
  function setSelected(id) {
    selectedId = Number(id) || null;
    try {
      localStorage.setItem(key(), String(selectedId || ""));
    } catch {}
    render();
  }
  function render() {
    const select = g("salesPipelineSelect");
    if (!select) return;
    select.innerHTML = list
      .map((p) => `<option value="${p.id}">${h(p.name)}</option>`)
      .join("");
    select.value = selectedId || "";
    const current = list.find((p) => p.id === selectedId);
    g("pipelineDescription").textContent =
      current?.description || l("emptyPurpose");
    g("pipelinePurpose").open = false;
    g("editPipelineBtn").disabled = !current || !editor();
    g("addPipelineBtn").disabled = !editor();
  }
  async function load(force = false) {
    if (force) list = [];
    if (!list.length) {
      if (!pending)
        pending = API.get("/pipelines")
          .then((data) => {
            list = data.pipelines || [];
          })
          .finally(() => (pending = null));
      await pending;
      if (!selectedId) {
        try {
          selectedId = Number(localStorage.getItem(key())) || null;
        } catch {}
      }
    }
    if (!list.some((p) => p.id === selectedId))
      selectedId = list.find((p) => p.is_default)?.id || list[0]?.id || null;
    render();
    return selectedId;
  }
  function localize() {
    document
      .querySelectorAll("[data-pipeline-label]")
      .forEach((el) => (el.textContent = l(el.dataset.pipelineLabel)));
    g("pipelineName").placeholder = l("example");
    g("pipelineText").placeholder = l("descriptionExample");
    g("salesPipelineSelect").setAttribute("aria-label", l("pipeline"));
    if (list.length) render();
  }
  async function open(edit = false) {
    try {
      await load(true);
      const p = edit ? list.find((p) => p.id === selectedId) : null;
      g("pipelineId").value = p?.id || "";
      g("pipelineName").value = p?.name || "";
      g("pipelineText").value = p?.description || "";
      g("pipelineModalTitle").textContent = l(edit ? "edit" : "add");
      g("pipelineFormError").textContent = "";
      g("pipelineCopyField").classList.toggle("hidden", !!p);
      g("deletePipelineBtn").classList.toggle(
        "hidden",
        !p || p.is_default || p.deal_count > 0,
      );
      g("pipelineCopy").innerHTML =
        `<option value="">${h(l("standard"))}</option>` +
        list
          .map((p) => `<option value="${p.id}">${h(p.name)}</option>`)
          .join("");
      g("pipelineCopy").value = selectedId || "";
      g("pipelineOverlay").classList.remove("hidden");
      g("pipelineName").focus();
    } catch (e) {
      toast(e.message, "error");
    }
  }
  async function modalStages(pipelineId, stageId = "") {
    const version = ++modalVersion;
    els.dealSubmitBtn.disabled = true;
    els.dealStageSelect.disabled = true;
    els.dealFormError.textContent = "";
    els.dealStageSelect.innerHTML = "";
    try {
      const { stages } = await API.get(
        `/deals/stages?pipeline_id=${encodeURIComponent(pipelineId)}`,
      );
      if (version !== modalVersion) return;
      els.dealStageSelect.innerHTML =
        `<option value="">${h(l("stage"))}</option>` +
        (stages || [])
          .map((s) => `<option value="${s.id}">${h(s.name)}</option>`)
          .join("");
      els.dealStageSelect.value = stageId || "";
      els.dealStageSelect.disabled = false;
      els.dealSubmitBtn.disabled = !editor();
    } catch (e) {
      if (version === modalVersion)
        els.dealFormError.textContent = e.message || l("failed");
    }
  }
  async function prepareDeal(deal) {
    await load();
    const id = deal?.pipeline_id || selectedId;
    g("dealPipelineSelect").innerHTML = list
      .map((p) => `<option value="${p.id}">${h(p.name)}</option>`)
      .join("");
    g("dealPipelineSelect").value = id;
    await modalStages(id, deal?.stage_id);
  }
  async function companyOptions(company, parentId) {
    const { companies: all } = await API.get("/companies");
    const excluded = new Set(company ? [Number(company.id)] : []);
    let changed = true;
    while (changed) {
      changed = false;
      for (const c of all)
        if (excluded.has(Number(c.parent_company_id)) && !excluded.has(c.id)) {
          excluded.add(c.id);
          changed = true;
        }
    }
    g("coParent").innerHTML =
      `<option value="">${h(l("none"))}</option>` +
      all
        .filter((c) => !excluded.has(c.id))
        .map((c) => `<option value="${c.id}">${h(c.name)}</option>`)
        .join("");
    g("coParent").value = parentId || company?.parent_company_id || "";
  }
  function companyGroup(company, parent, children = []) {
    g("companyGroup").innerHTML =
      `<div class="section-title">${h(l("group"))}</div>${parent ? `<p class="company-parent">${h(l("parent"))}: <button type="button" class="btn btn-ghost btn-sm" data-company-link="${parent.id}">${h(parent.name)} ↗</button></p>` : ""}<div class="company-group-heading"><strong>${h(l("children"))} <span class="muted">${children.length}</span></strong><button type="button" class="btn btn-ghost btn-sm" id="addSubCompanyBtn" ${editor() ? "" : "disabled"}>+ ${h(l("addChild"))}</button></div><div class="company-children">${children.length ? children.map((c) => `<button type="button" class="company-child" data-company-link="${c.id}"><span>${h(c.name)}</span><span>↗</span></button>`).join("") : `<p class="muted">${h(l("noChildren"))}</p>`}</div>`;
    g("companyGroup")
      .querySelectorAll("[data-company-link]")
      .forEach((button) =>
        button.addEventListener("click", () =>
          openCompanyPanel(button.dataset.companyLink).catch((e) =>
            toast(e.message, "error"),
          ),
        ),
      );
    g("addSubCompanyBtn").addEventListener("click", () =>
      openCompanyModal(null, company.id),
    );
  }
  function init() {
    localize();
    g("salesPipelineSelect").addEventListener("change", async (e) => {
      setSelected(e.target.value);
      els.dealStageFilter.value = "";
      g("savedDealView").value = "";
      await loadDeals();
    });
    g("addPipelineBtn").addEventListener("click", () => open());
    g("editPipelineBtn").addEventListener("click", () => open(true));
    const close = () => g("pipelineOverlay").classList.add("hidden");
    g("pipelineCancel").addEventListener("click", close);
    g("closePipelineBtn").addEventListener("click", close);
    g("pipelineOverlay").addEventListener("click", (e) => {
      if (e.target === g("pipelineOverlay")) close();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") close();
    });
    g("pipelineForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const button = g("pipelineSave");
      button.disabled = true;
      g("pipelineFormError").textContent = "";
      try {
        const id = g("pipelineId").value;
        const body = {
          name: g("pipelineName").value.trim(),
          description: g("pipelineText").value.trim(),
          copy_from: g("pipelineCopy").value || null,
        };
        const { pipeline } = id
          ? await API.put(`/pipelines/${id}`, body)
          : await API.post("/pipelines", body);
        setSelected(pipeline.id);
        await load(true);
        els.dealStageFilter.value = "";
        g("savedDealView").value = "";
        await loadDeals();
        close();
        toast(l("saved"));
      } catch (e) {
        g("pipelineFormError").textContent = e.message;
      } finally {
        button.disabled = false;
      }
    });
    g("deletePipelineBtn").addEventListener("click", async () => {
      if (!confirm(l("confirm"))) return;
      const button = g("deletePipelineBtn");
      button.disabled = true;
      try {
        await API.del(`/pipelines/${g("pipelineId").value}`);
        selectedId = null;
        await load(true);
        els.dealStageFilter.value = "";
        await loadDeals();
        close();
      } catch (e) {
        g("pipelineFormError").textContent = e.message;
      } finally {
        button.disabled = false;
      }
    });
    g("dealPipelineSelect").addEventListener("change", (e) =>
      modalStages(e.target.value),
    );
  }
  return {
    init,
    load,
    localize,
    setSelected,
    prepareDeal,
    companyOptions,
    companyGroup,
    selected: () => selectedId,
  };
})();
