/* Accessible screenshot tabs; all product copy and images also work without JS. */
(() => {
  for (const preview of document.querySelectorAll("[data-product-preview]")) {
    const tabs = [...preview.querySelectorAll("[data-product-tab]")];
    function select(tab) {
      for (const item of tabs) {
        const selected = item === tab;
        item.setAttribute("aria-selected", String(selected));
        item.tabIndex = selected ? 0 : -1;
        document.getElementById(item.getAttribute("aria-controls")).hidden =
          !selected;
      }
    }
    for (const tab of tabs) {
      tab.addEventListener("click", () => select(tab));
      tab.addEventListener("keydown", (event) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
          return;
        event.preventDefault();
        const index =
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? tabs.length - 1
              : (tabs.indexOf(tab) +
                  (event.key === "ArrowRight" ? 1 : -1) +
                  tabs.length) %
                tabs.length;
        select(tabs[index]);
        tabs[index].focus();
      });
    }
  }
})();
