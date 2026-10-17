/* Real SVG flag assets with native language names, never emoji. */
(() => {
  function init() {
    for (const select of document.querySelectorAll(
      "#appLangPicker,#loginLangPicker,#docLangPicker",
    )) {
      select.hidden = true;
      const group = document.createElement("div");
      group.className = "language-choices";
      group.setAttribute("role", "group");
      const sync = () => {
        const lang = KlyoI18n.getLang();
        select.value = lang;
        group.setAttribute(
          "aria-label",
          lang === "pl" ? "Język interfejsu" : "Interface language",
        );
        for (const b of group.children)
          b.setAttribute(
            "aria-pressed",
            String(b.dataset.languageChoice === lang),
          );
      };
      for (const [lang, name] of [
        ["pl", "Polski"],
        ["en", "English"],
      ]) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "language-choice";
        b.dataset.languageChoice = lang;
        const img = document.createElement("img");
        img.src = "/images/flag-" + lang + ".svg";
        img.alt = "";
        img.setAttribute("aria-hidden", "true");
        const label = document.createElement("span");
        label.textContent = name;
        b.append(img, label);
        b.onclick = () => {
          if (lang === KlyoI18n.getLang()) return;
          select.value = lang;
          select.dispatchEvent(new Event("change", { bubbles: true }));
        };
        group.append(b);
      }
      select.after(group);
      sync();
      window.addEventListener("klyo:language", sync);
      window.addEventListener("klyo:language-ready", sync);
    }
  }
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", init);
  else init();
})();
