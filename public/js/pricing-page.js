(() => {
  const escape = (value) =>
    String(value ?? "").replace(
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
  async function loadPricing() {
    const grid = document.getElementById("pricingGrid"),
      error = document.getElementById("pricingError");
    if (grid.dataset.serverRendered === "true") return;
    error.hidden = true;
    grid.setAttribute("aria-busy", "true");
    try {
      const response = await fetch("/api/billing/tiers");
      if (!response.ok) throw new Error("Plans unavailable");
      const { tiers } = await response.json();
      if (!Array.isArray(tiers) || !tiers.length)
        throw new Error("Plans unavailable");
      const count = (value) =>
        value == null
          ? "Unlimited"
          : new Intl.NumberFormat("en-US").format(value);
      grid.innerHTML = tiers
        .map(
          (t) =>
            `<article class="price-card" data-plan="${escape(t.key)}"><h3>${escape(t.label)}</h3><p class="price-tagline">${escape(t.tagline)}</p><div class="price-amount"><strong>$${escape(t.price)}</strong><span>USD / month</span></div><a class="button button-outline" href="/signup">Start free trial ↗︎</a><ul><li><b>${escape(count(t.maxSeats))}</b> ${t.maxSeats === 1 ? "user" : "users"}</li><li><b>${escape(count(t.maxContacts))}</b> contacts</li><li><b>${escape(count(t.maxAiDraftsPerMonth))}</b> AI email drafts / month</li></ul><p class="price-included">Custom A4 PDFs · price-list imports<br>Sales pipelines · SharePoint files<br>Personal colours &amp; layout</p></article>`,
        )
        .join("");
    } catch {
      grid.innerHTML = "";
      error.hidden = false;
    } finally {
      grid.setAttribute("aria-busy", "false");
    }
  }
  document
    .getElementById("retryPricing")
    .addEventListener("click", loadPricing);
  loadPricing();
})();
