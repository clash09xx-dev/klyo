(() => {
  const current = location.pathname;
  document.querySelectorAll(".nav-center a").forEach((a) => {
    if (a.getAttribute("href") === current)
      a.setAttribute("aria-current", "page");
  });
  document.getElementById("motionToggle")?.remove();
})();
