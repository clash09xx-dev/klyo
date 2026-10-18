(() => {
  const t = window.KlyoPublicLanguage?.t || (text => text);
  const demo = document.querySelector("[data-layout-demo]");
  if (!demo) return;
  const tabs = [...demo.querySelectorAll("[data-demo-layout]")],
    captions = {
      classic: "A familiar sidebar. Your everyday tools, together.",
      explorer: "A section rail with a focused list of tools beside it.",
      notebook: "A quiet page list and a document-style work surface.",
      command: "Your work sections at the top. More room for the work.",
    };
  function select(tab) {
    demo.dataset.layoutDemo = tab.dataset.demoLayout;
    tabs.forEach((t) => {
      t.setAttribute("aria-selected", String(t === tab));
      t.tabIndex = t === tab ? 0 : -1;
    });
    document
      .getElementById("interfaceDemoCanvas")
      .setAttribute("aria-labelledby", tab.id);
    document.getElementById("interfaceDemoCaption").textContent =
      t(captions[tab.dataset.demoLayout]);
  }
  for (const tab of tabs) {
    tab.addEventListener("click", () => select(tab));
    tab.addEventListener("keydown", (e) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
      e.preventDefault();
      const index =
        e.key === "Home"
          ? 0
          : e.key === "End"
            ? tabs.length - 1
            : (tabs.indexOf(tab) +
                (e.key === "ArrowRight" ? 1 : -1) +
                tabs.length) %
              tabs.length;
      select(tabs[index]);
      tabs[index].focus();
    });
  }
})();
