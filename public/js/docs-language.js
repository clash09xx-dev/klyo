(() => {
  const select = document.getElementById("docLangPicker");
  const requested = new URLSearchParams(location.search).get("lang");
  if (KlyoI18n.SUPPORTED.includes(requested)) KlyoI18n.setLang(requested, true);
  const apply = () => {
    const lang = KlyoI18n.getLang();
    select.value = lang;
    document.querySelectorAll("[data-doc-lang]").forEach((node) => {
      node.hidden = node.dataset.docLang !== lang;
      if (!node.hidden) document.title = node.dataset.docTitle;
    });
    document.documentElement.lang = lang;
  };
  select.onchange = () => KlyoI18n.setLang(select.value, true);
  window.addEventListener("klyo:language", apply);
  apply();
})();
