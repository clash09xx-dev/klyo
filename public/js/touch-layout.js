/* Touch editing keeps the page scrollable; only explicit handles capture a drag. */
window.KlyoTouchLayout = (() => {
  let cancelCurrent = null;
  const isPhone = () => matchMedia("(max-width:800px)").matches;
  function start(
    e,
    { container, item, selector, key, resize = false, commit },
  ) {
    if (e.button !== 0 || !isPhone()) return;
    cancelCurrent?.();
    e.preventDefault();
    e.stopPropagation();
    const handle = e.currentTarget;
    const items = [...container.querySelectorAll(selector)]
      .filter((n) => !n.hidden && n.getClientRects().length)
      .sort(
        (a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top,
      );
    const others = items.filter((n) => n !== item),
      rect = item.getBoundingClientRect();
    const originalOrder = items.map((n) => n.dataset[key]);
    const originalHeight = item.style.getPropertyValue("--miy-mobile-height");
    const ghost = document.createElement("div");
    ghost.className = "miy-touch-ghost";
    ghost.textContent =
      item.querySelector("header strong,[data-part-grip]")?.textContent || "";
    ghost.style.width = Math.min(rect.width, innerWidth - 24) + "px";
    const guide = document.createElement("div");
    guide.className = "miy-touch-guide";
    guide.setAttribute("aria-hidden", "true");
    document.body.append(ghost, guide);
    item.classList.add("miy-touch-moving");
    const controller = new AbortController();
    let last = e,
      order = originalOrder,
      height = rect.height,
      moved = false,
      frame;
    const update = () => {
      moved ||= Math.abs(last.clientY - e.clientY) > 5;
      ghost.style.left =
        Math.max(12, Math.min(innerWidth - ghost.offsetWidth - 12, rect.left)) +
        "px";
      ghost.style.top = Math.max(8, last.clientY - 22) + "px";
      if (resize) {
        height = Math.max(
          160,
          Math.min(1800, Math.round(rect.height + last.clientY - e.clientY)),
        );
        item.style.setProperty("--miy-mobile-height", height + "px");
        const current = item.getBoundingClientRect();
        Object.assign(guide.style, {
          left: current.left + "px",
          top: current.bottom - 2 + "px",
          width: current.width + "px",
        });
      } else {
        const index = others.filter(
          (n) =>
            last.clientY >
            n.getBoundingClientRect().top +
              n.getBoundingClientRect().height / 2,
        ).length;
        order = others.map((n) => n.dataset[key]);
        order.splice(index, 0, item.dataset[key]);
        const target = others[index]?.getBoundingClientRect();
        const end = others.at(-1)?.getBoundingClientRect();
        Object.assign(guide.style, {
          left: rect.left + "px",
          top:
            (target ? target.top - 6 : end ? end.bottom + 6 : rect.top) + "px",
          width: rect.width + "px",
        });
      }
      const dock = document
        .getElementById("interfaceEditor")
        ?.getBoundingClientRect();
      const bottom = dock && dock.top < innerHeight ? dock.top : innerHeight;
      if (last.clientY > bottom - 45) window.scrollBy(0, 8);
      else if (last.clientY < 95) window.scrollBy(0, -8);
      frame = requestAnimationFrame(update);
    };
    const finish = (cancelled) => {
      cancelCurrent = null;
      controller.abort();
      cancelAnimationFrame(frame);
      ghost.remove();
      guide.remove();
      item.classList.remove("miy-touch-moving");
      try {
        handle.releasePointerCapture(e.pointerId);
      } catch {}
      if (cancelled || !moved) {
        if (originalHeight)
          item.style.setProperty("--miy-mobile-height", originalHeight);
        else item.style.removeProperty("--miy-mobile-height");
      }
      if (!cancelled && moved) commit(resize ? { height } : { order });
    };
    cancelCurrent = () => finish(true);
    handle.setPointerCapture(e.pointerId);
    window.addEventListener(
      "pointermove",
      (ev) => {
        if (ev.pointerId === e.pointerId) last = ev;
      },
      { signal: controller.signal },
    );
    window.addEventListener(
      "pointerup",
      (ev) => {
        if (ev.pointerId === e.pointerId) {
          last = ev;
          finish(false);
        }
      },
      { signal: controller.signal },
    );
    window.addEventListener("pointercancel", () => finish(true), {
      signal: controller.signal,
    });
    window.addEventListener(
      "keydown",
      (ev) => {
        if (ev.key === "Escape") {
          ev.preventDefault();
          finish(true);
        }
      },
      { signal: controller.signal },
    );
    frame = requestAnimationFrame(update);
  }
  return { isPhone, start, cancel: () => cancelCurrent?.() };
})();
