(() => {
  const copy = JSON.parse(
    document.getElementById("public-runtime-copy")?.textContent || "{}",
  );
  window.KlyoPublicLanguage = { t: (text) => copy[text] ?? text };
})();
