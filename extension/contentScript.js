(() => {
  if (globalThis.__ZH_QA_FLOATING_ASSISTANT_LOADED__) {
    return;
  }
  globalThis.__ZH_QA_FLOATING_ASSISTANT_LOADED__ = true;

  // The remembered selection belongs to one page URL, and is dropped when the
  // user deselects inside the page. Clicking the assistant must keep it.
  let lastSelection = { text: "", url: "" };
  // Matches the bubble's CSS box.
  const BALL_SIZE = 44;
  // The budget the worker applies to selections.
  const MAX_SELECTION = 12000;
  let siteOn = false;
  // "floating" shows the bubble and panel on the page; "sidePanel" injects no
  // UI at all and only answers the side panel's requests for page content.
  let panelMode = "floating";
  let uiState = null;
  let assistant = null;
  let pointerInPage = false;

  ZhihuSiteAccess.watch(enabled => {
    siteOn = enabled;
    if (!enabled) { assistant?.hide(); return; }
    if (uiState) { applyMode(); return; }
    chrome.runtime.sendMessage({ type: "GET_UI_STATE" }).then(reply => {
      uiState = reply?.ok ? reply.data : {};
    }).catch(() => { uiState = {}; }).finally(() => {
      panelMode = uiState.panelMode === "sidePanel" ? "sidePanel" : "floating";
      applyMode();
    });
  });
  function applyMode() {
    if (!siteOn) return;
    if (panelMode === "floating") { assistant ||= mountFloating(); assistant.show(); }
    else assistant?.hide();
  }
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "PANEL_MODE_CHANGED") {
      panelMode = message.mode === "sidePanel" ? "sidePanel" : "floating";
      applyMode();
      return;
    }
    // Requests from the extension's side panel (tabs.sendMessage). Excluded
    // sites answer with the reason instead of their content.
    if (message?.type === "GET_PAGE_INFO") {
      sendResponse(siteOn ? { ok: true, data: pageInfo() } : { ok: false, error: "此网站已在网站过滤中停用插件。" });
      return;
    }
    if (message?.type === "EXTRACT_PAGE_CONTENT") {
      if (!siteOn) { sendResponse({ ok: false, error: "此网站已在网站过滤中停用插件。" }); return; }
      try { sendResponse({ ok: true, data: extractPageContent() }); }
      catch { sendResponse({ ok: false, error: "读取网页内容失败，请刷新网页后重试。" }); }
      return;
    }
    if (message?.type === "CLEAR_PAGE_SELECTION") {
      clearSelection();
      sendResponse({ ok: true });
    }
  });

  function pageInfo() {
    flushSelection();
    return { title: cleanText(document.title).slice(0, 200), url: location.href, selection: rememberedSelection().length };
  }
  function rememberedSelection() {
    return lastSelection.url === location.href ? lastSelection.text : "";
  }
  function clearSelection() {
    lastSelection = { text: "", url: "" };
    globalThis.getSelection()?.removeAllRanges?.();
    assistant?.ui.setSelection(0);
  }

  document.addEventListener("pointerdown", (event) => { pointerInPage = event.target !== assistant?.host; }, { capture: true, passive: true });
  // Drag-selecting fires this continuously, and reading the selection
  // serializes it. Read once after it settles, with the pointer state of the
  // last change; analysis flushes a pending read first.
  let selectionTimer = 0, selectionFromPage = false;
  function flushSelection() {
    if (!selectionTimer) return;
    clearTimeout(selectionTimer); selectionTimer = 0;
    rememberSelectedText(selectionFromPage);
  }
  document.addEventListener("selectionchange", () => {
    selectionFromPage = pointerInPage;
    clearTimeout(selectionTimer);
    selectionTimer = setTimeout(flushSelection, 200);
  }, { passive: true });
  function rememberSelectedText(fromPage) {
    const selectedText = cleanText(globalThis.getSelection()?.toString() || "");
    if (selectedText) lastSelection = { text: selectedText.slice(0, MAX_SELECTION), url: location.href };
    else if (fromPage) lastSelection = { text: "", url: "" };
    assistant?.ui.setSelection(rememberedSelection().length);
  }

  function extractPageContent() {
    flushSelection();
    const article = ZhihuPageText.extractDetailed();
    const currentSelection = cleanText(globalThis.getSelection()?.toString() || "");
    if (currentSelection) lastSelection = { text: currentSelection.slice(0, MAX_SELECTION), url: location.href };
    return {
      title: cleanText(article.title || document.title).slice(0, 500),
      url: location.href,
      description: cleanText(
        document.querySelector('meta[name="description"]')?.content ||
          document.querySelector('meta[property="og:description"]')?.content ||
          "",
      ).slice(0, 1500),
      selectedText: (currentSelection || rememberedSelection()).slice(0, MAX_SELECTION),
      // Preserve the complete extracted text for local original-mode drafts.
      // The model client applies its separate 10,000-character input budget.
      mainText: article.text,
      shortNote: article.kind === "note" && Boolean(article.text),
      images: article.images || [],
      originalPartial: article.originalPartial,
      originalUnavailableReason: article.originalUnavailableReason,
    };
  }

  function cleanText(value) {
    return String(value)
      .replace(/\u00a0/g, " ")
      .replace(/[\t\f\v ]+/g, " ")
      .replace(/\s*\n\s*/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function mountFloating() {
  const host = document.createElement("div");
  host.id = "zhihu-question-assistant-root";
  document.documentElement.append(host);

  // Closed: page scripts must not read drafts, model names or error details.
  const shadow = host.attachShadow({ mode: "closed" });
  shadow.innerHTML = `
    <style>:host{all:initial} ${globalThis.ZhihuUiTheme || ""}${ZhihuQuestionPanel.styles()}${dockStyles()}</style>
    <div class="assistant-dock">
    ${ZhihuQuestionPanel.markup()}
    <button class="floating-ball" type="button" aria-label="打开知乎提问助手" aria-expanded="false" title="知乎提问助手 · 按住拖动">
      <span class="ball-label" aria-hidden="true">问</span><span class="ball-badge" aria-hidden="true"></span>
    </button>
    </div>
  `;

  const dock = shadow.querySelector(".assistant-dock");
  const ball = shadow.querySelector(".floating-ball");
  const badge = shadow.querySelector(".ball-badge");
  const panel = shadow.querySelector(".panel");
  const panelOpen = () => panel.classList.contains("is-open");
  // The bubble reflects the panel: pressed while open, a pulse while drafts
  // are generating behind a closed panel, and a count of unseen drafts.
  let unseen = 0;
  function renderBall(busy = ui?.isBusy()) {
    const open = panelOpen();
    if (open) unseen = 0;
    ball.classList.toggle("is-open", open);
    ball.classList.toggle("is-busy", Boolean(busy) && !open);
    ball.classList.toggle("has-badge", unseen > 0 && !open);
    badge.textContent = unseen ? String(unseen) : "";
    ball.setAttribute("aria-expanded", String(open));
    ball.setAttribute("aria-label", unseen && !open ? `打开知乎提问助手，${unseen} 个新草稿` : busy && !open ? "打开知乎提问助手，正在生成" : open ? "收起知乎提问助手" : "打开知乎提问助手");
  }
  const ui = ZhihuQuestionPanel.bind(shadow, {
    getPage: async () => extractPageContent(),
    clearSelection,
    isActive: panelOpen,
    onClose: () => { setPanelOpen(false); ball.focus(); },
    onBusyChange: (busy) => renderBall(busy),
    onDrafts: (count) => { if (!panelOpen()) unseen = count; renderBall(false); },
  });
  const header = ui.header;
  header.title = "按住空白处拖动";
  ui.setSelection(rememberedSelection().length);

  // The bubble and the question panel share one dock, anchored at the bubble's
  // bottom-right, so opening or dragging always keeps them attached.
  const saved = uiState?.ballPosition;
  const anchor = saved
    ? { right: innerWidth - saved.x * Math.max(1, innerWidth - BALL_SIZE) - BALL_SIZE, bottom: innerHeight - saved.y * Math.max(1, innerHeight - BALL_SIZE) - BALL_SIZE }
    : { right: 22, bottom: 24 };
  let drag = null;
  let suppressClick = false;
  function layoutDock() {
    const margin = 8;
    const open = panelOpen();
    // The anchor is the bubble. The panel hangs off it and must not push it.
    anchor.right = Math.min(Math.max(margin, anchor.right), Math.max(margin, innerWidth - BALL_SIZE - margin));
    anchor.bottom = Math.min(Math.max(margin, anchor.bottom), Math.max(margin, innerHeight - BALL_SIZE - margin));
    const ballLeft = innerWidth - anchor.right - BALL_SIZE;
    const ballTop = innerHeight - anchor.bottom - BALL_SIZE;
    const panelWidth = Math.min(360, innerWidth - margin * 2);
    const alignStart = open && ballLeft + BALL_SIZE - panelWidth < margin;
    const spaceAbove = ballTop - 12 - margin;
    const spaceBelow = anchor.bottom - 12 - margin;
    const flip = open && spaceAbove < 180 && spaceBelow > spaceAbove;
    // ResizeObserver can re-enter this function; skip unchanged style writes.
    const alignItems = alignStart ? "flex-start" : "flex-end";
    if (dock.style.alignItems !== alignItems) dock.style.alignItems = alignItems;
    const panelOrder = flip ? "1" : "0", ballOrder = flip ? "0" : "1";
    if (panel.style.order !== panelOrder) panel.style.order = panelOrder;
    if (ball.style.order !== ballOrder) ball.style.order = ballOrder;
    if (open) {
      const maxHeight = `${Math.min(700, Math.max(120, flip ? spaceBelow : spaceAbove))}px`;
      if (panel.style.maxHeight !== maxHeight) panel.style.maxHeight = maxHeight;
    }
    const next = {
      left: alignStart ? `${ballLeft}px` : "auto",
      right: alignStart ? "auto" : `${anchor.right}px`,
      top: flip ? `${ballTop}px` : "auto",
      bottom: flip ? "auto" : `${anchor.bottom}px`,
    };
    for (const [key, value] of Object.entries(next)) if (dock.style[key] !== value) dock.style[key] = value;
  }
  function saveBallPosition() {
    const rect = ball.getBoundingClientRect();
    const free = (size, length) => Math.max(1, size - length);
    const clamp = (value) => Math.min(1, Math.max(0, value));
    const position = { x: clamp(rect.left / free(innerWidth, rect.width)), y: clamp(rect.top / free(innerHeight, rect.height)) };
    if (uiState) uiState.ballPosition = position;
    chrome.runtime.sendMessage({ type: "SET_BALL_POSITION", position }).catch(() => {});
  }
  function syncAnchorToVisual() {
    const rect = ball.getBoundingClientRect();
    anchor.right = innerWidth - rect.right;
    anchor.bottom = innerHeight - rect.bottom;
  }
  function onDragDown(event) {
    if (event.button !== 0 || event.isPrimary === false) return;
    const handle = event.currentTarget;
    const control = event.target.closest?.("button,input,textarea,select,a,[contenteditable=true]");
    if (control && control !== handle) return;
    syncAnchorToVisual();
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, right: anchor.right, bottom: anchor.bottom, active: false, handle };
    suppressClick = false;
    handle.setPointerCapture(event.pointerId);
  }
  function onDragMove(event) {
    if (!drag || drag.id !== event.pointerId || drag.handle !== event.currentTarget) return;
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
    if (!drag.active && Math.hypot(dx, dy) < 5) return;
    drag.active = true;
    suppressClick = true;
    event.preventDefault();
    anchor.right = drag.right - dx;
    anchor.bottom = drag.bottom - dy;
    layoutDock();
  }
  function onDragEnd(event) {
    if (!drag || drag.id !== event.pointerId || drag.handle !== event.currentTarget) return;
    const dragged = drag.active;
    drag = null;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (dragged) saveBallPosition();
  }
  function onDragClick(event) {
    if (!suppressClick || event.detail === 0) return;
    suppressClick = false;
    event.preventDefault();
    event.stopImmediatePropagation();
  }
  for (const handle of [ball, header]) {
    handle.style.cursor = "grab";
    handle.style.touchAction = "none";
    handle.style.userSelect = "none";
    handle.addEventListener("pointerdown", onDragDown);
    handle.addEventListener("pointermove", onDragMove);
    handle.addEventListener("pointerup", onDragEnd);
    handle.addEventListener("pointercancel", onDragEnd);
    handle.addEventListener("lostpointercapture", onDragEnd);
    handle.addEventListener("click", onDragClick, true);
  }
  window.addEventListener("resize", layoutDock);
  new ResizeObserver(layoutDock).observe(dock);
  layoutDock();
  function setPanelOpen(open) {
    panel.classList.toggle("is-open", open);
    renderBall();
    layoutDock();
  }
  ball.addEventListener("click", () => {
    setPanelOpen(!panelOpen());
    if (panelOpen()) ui.refresh();
  });
  panel.addEventListener("keydown", event => {
    if (event.key === "Escape") { setPanelOpen(false); ball.focus(); }
  });
  window.addEventListener("pagehide", () => ui.cancel(true));
  renderBall(false);

  return {
    host, ui,
    show() { host.style.removeProperty("display"); },
    // Excluding the site or switching to the side panel stops a running request.
    hide() { host.style.setProperty("display", "none", "important"); setPanelOpen(false); ui.cancel(true); },
  };
  }

  function dockStyles() {
    return `
      .assistant-dock{position:fixed;right:22px;bottom:24px;z-index:2147483646;display:flex;flex-direction:column;align-items:flex-end;gap:10px;width:max-content;max-width:calc(100vw - 16px)}
      .floating-ball{position:relative;flex:none;display:grid;place-items:center;width:${BALL_SIZE}px;height:${BALL_SIZE}px;padding:0;border:1px solid var(--qa-line);border-radius:10px;color:var(--qa-accent);background:var(--qa-surface);box-shadow:var(--qa-panel-shadow);font-size:18px;font-weight:600;line-height:1}
      .floating-ball:hover{border-color:var(--qa-accent-line);background:var(--qa-sub)}
      .floating-ball.is-open{border-color:var(--qa-accent-line);background:var(--qa-soft)}
      .ball-badge{position:absolute;top:-6px;right:-6px;display:none;min-width:18px;height:18px;padding:0 5px;border:2px solid var(--qa-surface);border-radius:9px;background:var(--qa-accent);color:#fff;font-size:11px;font-weight:600;line-height:14px;text-align:center;box-sizing:border-box}
      .floating-ball.has-badge .ball-badge{display:block}
      .floating-ball.is-busy .ball-badge{display:block;min-width:0;width:12px;height:12px;top:-4px;right:-4px;padding:0;animation:qa-pulse 1.2s ease-in-out infinite}
      @keyframes qa-pulse{0%,100%{box-shadow:0 0 0 0 #056de866}50%{box-shadow:0 0 0 4px #056de800}}
    `;
  }
})();
