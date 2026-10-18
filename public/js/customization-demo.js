(() => {
  const t = window.KlyoPublicLanguage?.t || (text => text);
  const form = document.getElementById("customDemoForm"),
    list = document.getElementById("customDemoFields");
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const name = document.getElementById("customDemoName").value.trim();
    if (!name) return;
    if (list.children.length >= 7) {
      document.getElementById("customDemoFeedback").textContent =
        t("Preview full. Create your fields inside the workspace.");
      return;
    }
    const row = document.createElement("div"),
      label = document.createElement("span"),
      value = document.createElement("input");
    label.textContent = name;
    value.type = "text";
    value.placeholder = t("Enter a value");
    value.setAttribute("aria-label", name);
    row.append(label, value);
    list.appendChild(row);
    document.getElementById("customDemoName").value = "";
    document.getElementById("customDemoFeedback").textContent =
      t("Field added to the preview. Try entering a value.");
    value.focus();
  });
})();
