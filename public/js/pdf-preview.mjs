import { getDocument, GlobalWorkerOptions } from "/vendor/pdfjs/pdf.min.mjs";
GlobalWorkerOptions.workerSrc = "/vendor/pdfjs/pdf.worker.min.mjs";
// Renders only the current page. The large viewer code is fetched on demand.
export async function showPdf(buffer, container, language = "en") {
  let pdf = null,
    task = null,
    pageNumber = 1,
    scaleFactor = 1,
    version = 0,
    closed = false,
    resizeTimer;
  const pl = language === "pl";
  container.innerHTML = `<div class="pdf-loading">${pl ? "Przygotowywanie podglądu…" : "Preparing preview…"}</div>`;
  const loading = getDocument({
    data: new Uint8Array(buffer),
    isEvalSupported: false,
    useWasm: false,
    enableXfa: false,
  });
  pdf = await loading.promise;
  container.innerHTML = `<div class="pdf-page-toolbar"><button type="button" class="pdf-prev" aria-label="${pl ? "Poprzednia strona" : "Previous page"}">←</button><span class="pdf-page-label"></span><button type="button" class="pdf-next" aria-label="${pl ? "Następna strona" : "Next page"}">→</button><select class="pdf-zoom" aria-label="${pl ? "Powiększenie" : "Zoom"}"><option value="1">${pl ? "Dopasuj" : "Fit width"}</option><option value="1.25">125%</option><option value="1.5">150%</option></select></div><div class="pdf-canvas-scroll"><canvas aria-label="${pl ? "Strona oferty PDF" : "Proposal PDF page"}"></canvas></div>`;
  const canvas = container.querySelector("canvas"),
    scroll = container.querySelector(".pdf-canvas-scroll"),
    label = container.querySelector(".pdf-page-label"),
    prev = container.querySelector(".pdf-prev"),
    next = container.querySelector(".pdf-next");
  async function render() {
    if (closed) return;
    const current = ++version;
    container.dataset.rendered = "false";
    if (task) {
      task.cancel();
      try {
        await task.promise;
      } catch {}
      task = null;
    }
    const page = await pdf.getPage(pageNumber);
    if (current !== version || closed) return;
    const base = page.getViewport({ scale: 1 }),
      scale =
        Math.max(0.2, Math.min(2, (scroll.clientWidth - 36) / base.width)) *
        scaleFactor,
      viewport = page.getViewport({ scale }),
      ratio = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.ceil(viewport.width * ratio);
    canvas.height = Math.ceil(viewport.height * ratio);
    canvas.style.width = viewport.width + "px";
    canvas.style.height = viewport.height + "px";
    label.textContent = `${pl ? "Strona" : "Page"} ${pageNumber} / ${pdf.numPages}`;
    prev.disabled = pageNumber === 1;
    next.disabled = pageNumber === pdf.numPages;
    task = page.render({
      canvasContext: canvas.getContext("2d"),
      viewport,
      transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : undefined,
    });
    try {
      await task.promise;
      if (current === version && !closed) {
        container.dataset.rendered = "true";
        container.dataset.page = String(pageNumber);
        scroll.scrollTop = 0;
      }
    } catch (error) {
      if (error.name !== "RenderingCancelledException") throw error;
    }
  }
  const refresh = () =>
    render().catch((error) => {
      if (!closed)
        container.querySelector(".pdf-page-label").textContent = error.message;
    });
  prev.addEventListener("click", () => {
    if (pageNumber > 1) {
      pageNumber--;
      refresh();
    }
  });
  next.addEventListener("click", () => {
    if (pageNumber < pdf.numPages) {
      pageNumber++;
      refresh();
    }
  });
  container.querySelector(".pdf-zoom").addEventListener("change", (event) => {
    scaleFactor = Number(event.target.value);
    refresh();
  });
  const resize = () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(refresh, 150);
  };
  window.addEventListener("resize", resize);
  await render();
  return {
    async destroy() {
      closed = true;
      version++;
      clearTimeout(resizeTimer);
      window.removeEventListener("resize", resize);
      if (task) task.cancel();
      await loading.destroy();
    },
  };
}
