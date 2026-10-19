/* A compact mobile header, with a visible sign-in link on every product page. */
(() => {
  const nav = document.querySelector(".site-nav");
  if (!nav) return;
  const pl = document.documentElement.lang === "pl";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "mobile-site-toggle";
  button.setAttribute("aria-expanded", "false");
  button.setAttribute("aria-label", pl ? "Otwórz menu" : "Open menu");
  button.innerHTML =
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/></svg><span>Menu</span>';
  nav.append(button);
  nav.classList.add("mobile-site-ready");
  const set = (open) => {
    nav.dataset.mobileOpen = String(open);
    button.setAttribute("aria-expanded", String(open));
    button.setAttribute(
      "aria-label",
      pl
        ? open
          ? "Zamknij menu"
          : "Otwórz menu"
        : open
          ? "Close menu"
          : "Open menu",
    );
  };
  button.onclick = () => set(nav.dataset.mobileOpen !== "true");
  nav.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      set(false);
      button.focus();
    }
  });
  matchMedia("(max-width:600px)").addEventListener("change", () => set(false));
})();
