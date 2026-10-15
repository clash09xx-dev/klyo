const KlyoDocumentTools = (() => {
  const esc = (v) =>
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
  function dialog(title, body, wide = false) {
    const overlay = document.createElement("div");
    overlay.className = "doc-overlay";
    overlay.innerHTML = `<section role="dialog" aria-modal="true" aria-label="${esc(title)}" class="doc-dialog ${wide ? "doc-wide" : ""}"><header><h2>${esc(title)}</h2><button type="button" class="btn btn-ghost" aria-label="Close">×</button></header><div class="doc-content">${body}</div><p class="doc-error" role="alert"></p></section>`;
    const previous = document.activeElement;
    const close = () => {
      overlay.remove();
      document.removeEventListener("keydown", key, true);
      previous?.focus();
    };
    const key = (e) => {
      if (!overlay.isConnected) return;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopImmediatePropagation();
        close();
      }
      if (e.key === "Tab") {
        const focus = [
          ...overlay.querySelectorAll("button,input,select,textarea,a[href]"),
        ].filter((n) => !n.disabled && n.getClientRects().length);
        if (!focus.length) return;
        const first = focus[0],
          last = focus.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", key, true);
    overlay.querySelector("header button").onclick = close;
    document.body.append(overlay);
    overlay.querySelector("header button").focus();
    return {
      root: overlay,
      body: overlay.querySelector(".doc-content"),
      close,
      error: (e) => {
        overlay.querySelector(".doc-error").textContent =
          e?.message || String(e || "");
      },
      find: (q) => overlay.querySelector(q),
    };
  }
  async function binary(path, options = {}) {
    const r = await fetch("/api" + path, {
      ...options,
      headers: API.headers(options.headers || {}),
    });
    if (!r.ok) {
      const b = await r.json().catch(() => ({}));
      throw new Error(b.error || "Unable to transfer file.");
    }
    return r;
  }
  const size = (n) =>
    Number(n) < 1048576
      ? (Number(n) / 1024).toFixed(0) + " KB"
      : (Number(n) / 1048576).toFixed(1) + " MB";
  return { esc, dialog, binary, size };
})();
