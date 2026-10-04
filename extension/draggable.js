globalThis.ZhihuDraggable ||= (() => {
  function attach(element, handle = element, { onDragEnd } = {}) {
    let drag = null;
    let moved = false;
    let suppressClick = false;
    const margin = 8;
    handle.style.cursor = "grab";
    handle.style.touchAction = "none";
    handle.style.userSelect = "none";
    handle.title = `${handle.title ? `${handle.title} · ` : ""}按住拖动`;
    function moveTo(x, y) {
      const rect = element.getBoundingClientRect();
      const left = Math.max(margin, Math.min(x, Math.max(margin, innerWidth - rect.width - margin)));
      const top = Math.max(margin, Math.min(y, Math.max(margin, innerHeight - rect.height - margin)));
      Object.assign(element.style, { left: `${left}px`, top: `${top}px`, right: "auto", bottom: "auto" });
      moved = true;
    }
    function constrain() {
      if (!moved) return;
      // The hidden panel has an animation transform; don't accumulate that
      // visual offset into its saved layout coordinates on resize.
      moveTo(parseFloat(element.style.left), parseFloat(element.style.top));
    }
    function down(event) {
      if (event.button !== 0 || event.isPrimary === false) return;
      const control = event.target.closest?.("button,input,textarea,select,a,[contenteditable=true]");
      if (control && control !== handle) return;
      const rect = element.getBoundingClientRect();
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY, left: rect.left, top: rect.top, active: false };
      suppressClick = false;
      handle.setPointerCapture(event.pointerId);
    }
    function move(event) {
      if (!drag || drag.id !== event.pointerId) return;
      const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
      if (!drag.active && Math.hypot(dx, dy) < 5) return;
      drag.active = true;
      suppressClick = true;
      handle.style.cursor = "grabbing";
      event.preventDefault();
      moveTo(drag.left + dx, drag.top + dy);
    }
    function end(event) {
      if (!drag || drag.id !== event.pointerId) return;
      const dragged = drag.active;
      drag = null;
      handle.style.cursor = "grab";
      if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
      if (dragged) onDragEnd?.(element.getBoundingClientRect());
    }
    function click(event) {
      if (!suppressClick || event.detail === 0) return;
      suppressClick = false;
      event.preventDefault(); event.stopImmediatePropagation();
    }
    handle.addEventListener("pointerdown", down);
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
    handle.addEventListener("lostpointercapture", end);
    handle.addEventListener("click", click, true);
    window.addEventListener("resize", constrain);
    const observer = new ResizeObserver(constrain);
    observer.observe(element);
    return {
      moveTo, get moved() { return moved; },
      destroy() {
        observer.disconnect(); window.removeEventListener("resize", constrain);
        for (const [type, listener] of [["pointerdown", down], ["pointermove", move], ["pointerup", end], ["pointercancel", end], ["lostpointercapture", end]]) handle.removeEventListener(type, listener);
        handle.removeEventListener("click", click, true);
      },
    };
  }
  return { attach };
})();
