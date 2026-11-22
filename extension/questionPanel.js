// The question panel UI, shared by the floating panel (content script, inside
// a closed shadow root) and the Chrome side panel (extension page). Where the
// page text comes from is supplied by the caller's adapter:
//   getPage()        -> Promise<pageData>   extract the page to analyze
//   requestFields()  -> object              extra fields for generate/cancel messages
//   clearSelection() -> void|Promise
//   isActive()       -> boolean             panel visible; settings refresh only then
//   onClose()        -> void
//   onBusyChange(busy, received), onDrafts(count)   optional, for the launcher
globalThis.ZhihuQuestionPanel ||= (() => {
  const DEFAULT_DESCRIPTION_LIMIT = 3000;
  const MAX_TOPICS = 5;
  const ICON_HELP = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><circle cx="8" cy="8" r="6.2"/><path d="M6.3 6.2a1.8 1.8 0 1 1 2.5 1.7c-.5.2-.8.6-.8 1.1v.4"/><circle cx="8" cy="11.4" r=".5" fill="currentColor" stroke="none"/></svg>';
  const ICON_CLOSE = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg>';

  function markup({ closeLabel = "收起面板" } = {}) {
    return `
    <section class="panel" aria-label="知乎提问助手">
      <header class="panel-header">
        <button class="model-switch" type="button"><span class="dot" aria-hidden="true"></span><span class="model-name">读取模型…</span><span class="caret" aria-hidden="true">▾</span></button>
        <span class="grow"></span>
        <button class="guide-button icon-button" type="button" aria-label="打开新手教程" title="新手教程">${ICON_HELP}</button>
        <button class="close-button icon-button" type="button" aria-label="${closeLabel}" title="${closeLabel}">${ICON_CLOSE}</button>
      </header>
      <div class="panel-body">
        <div class="prefs">
          <label class="pref">风格<select class="question-style-select" aria-label="提问风格" disabled><option value="professional">专业</option><option value="daily">日常</option></select></label>
          <label class="pref">描述<select class="description-mode-select" aria-label="问题描述形式" disabled><option value="summary">概括</option><option value="original">原文</option></select></label>
        </div>
        <p class="page-info is-hidden" role="status"></p>
        <div class="selection-hint is-hidden"><span class="selection-text"></span><button class="selection-clear link-button" type="button">清除</button></div>
        <button class="analyze-button" type="button"><span class="analyze-label">分析当前网页</span><span class="analyze-progress"></span></button>
        <div class="progress-track is-hidden" aria-hidden="true"><i class="progress-bar"></i></div>
        <div class="error is-hidden" role="alert"></div>
        <p class="empty-state">生成 6 个提问草稿，选一个修改后带到知乎</p>
        <p class="results-meta is-hidden" role="status"></p>
        <div class="results" aria-live="polite"></div>
      </div>
    </section>`;
  }

  function bind(root, adapter) {
    const $ = (selector) => root.querySelector(selector);
    const panel = $(".panel");
    const header = $(".panel-header");
    const analyzeButton = $(".analyze-button");
    const analyzeLabel = $(".analyze-label");
    const analyzeProgress = $(".analyze-progress");
    const progressTrack = $(".progress-track");
    const progressBar = $(".progress-bar");
    const errorElement = $(".error");
    const emptyState = $(".empty-state");
    const resultsMeta = $(".results-meta");
    const resultsElement = $(".results");
    const modelSwitch = $(".model-switch");
    const modelName = $(".model-name");
    const styleSelect = $(".question-style-select");
    const descriptionSelect = $(".description-mode-select");
    const selectionHint = $(".selection-hint");
    const selectionText = $(".selection-text");
    const pageInfo = $(".page-info");
    let isAnalyzing = false, currentRequest = null, runMeta = null, selectionLength = 0;

    let styleState = { selected: "professional", customStyles: [] }, styleBusy = false, styleRevision = 0;
    function renderStyle() {
      const customStyles = Array.isArray(styleState.customStyles) ? styleState.customStyles : [];
      // new Option() sets text, never HTML, so user-chosen names cannot inject markup.
      styleSelect.replaceChildren(new Option("专业", "professional"), new Option("日常", "daily"),
        ...customStyles.map(item => new Option(item.name, item.id)), new Option("＋ 新建风格…", "__new"));
      styleSelect.value = styleState.selected;
    }
    async function refreshStyle() {
      const revision = ++styleRevision;
      try {
        const reply = await chrome.runtime.sendMessage({ type: "GET_QUESTION_STYLE" });
        if (revision !== styleRevision || styleBusy) return;
        if (!reply?.ok) throw new Error();
        styleState = reply.data; renderStyle(); styleSelect.disabled = isAnalyzing;
      } catch { if (revision === styleRevision) styleSelect.title = "风格读取失败，重新打开面板可重试。"; }
    }
    const openStyleSettings = () => chrome.runtime.sendMessage({ type: "OPEN_MODEL_SETTINGS", section: "questionStyle" }).catch(error => showError(friendlyError(error)));
    styleSelect.onchange = async () => {
      if (styleBusy || isAnalyzing) return;
      const selected = styleSelect.value;
      if (selected === "__new") { styleSelect.value = styleState.selected; openStyleSettings(); return; }
      styleBusy = true; styleSelect.disabled = true; ++styleRevision;
      try {
        const reply = await chrome.runtime.sendMessage({ type: "SET_QUESTION_STYLE", selected });
        if (!reply?.ok) throw new Error(reply?.error || "保存风格失败。");
        styleState = reply.data; renderStyle();
      } catch (error) { styleSelect.value = styleState.selected; showError(friendlyError(error)); }
      finally { styleBusy = false; styleSelect.disabled = isAnalyzing; refreshStyle(); }
    };
    // The selects show the setting for the next run. Drafts already shown keep
    // the mode they were generated with, which the results line reports.
    const formatState = { next: "summary" };
    descriptionSelect.onchange = async () => {
      if (isAnalyzing) return;
      const mode = descriptionSelect.value;
      descriptionSelect.disabled = true;
      try {
        const reply = await chrome.runtime.sendMessage({ type: "SET_DESCRIPTION_MODE", mode });
        if (!reply?.ok) throw new Error(reply?.error || "保存描述形式失败。");
        formatState.next = reply.data.mode;
      } catch (error) { descriptionSelect.value = formatState.next; showError(friendlyError(error)); }
      finally { descriptionSelect.disabled = isAnalyzing; renderSelectionHint(); }
    };
    const modeLabel = (mode, partial) => mode === "original" ? `原文${partial ? " · 仅已加载部分" : ""}` : "概括";
    function renderMeta() {
      resultsMeta.classList.toggle("is-hidden", !runMeta);
      if (!runMeta) return;
      resultsMeta.textContent = [`${runMeta.count} 个草稿`, runMeta.style, modeLabel(runMeta.mode, runMeta.partial), runMeta.note].filter(Boolean).join(" · ");
    }
    function friendlyError(error) {
      const message = error instanceof Error ? error.message : "";
      if (/Extension context invalidated|Receiving end does not exist|message port closed/i.test(message)) return "扩展已更新或重新加载，请刷新此网页后重试。";
      return message || "发生未知错误，请重试。";
    }
    function setProgress(text, done = 0) {
      analyzeProgress.textContent = text;
      progressBar.style.width = `${Math.max(4, Math.round(done / 6 * 100))}%`;
    }
    function acceptItem(item, index) {
      const request = currentRequest;
      if (!request || request.received.has(index)) return;
      if (!request.startedResults) {
        resultsElement.replaceChildren(); request.startedResults = true;
        runMeta = { count: 0, style: item.questionStyleName || "", mode: item.descriptionMode || "summary", partial: item.originalPartial === true, note: "" };
      }
      renderResults([item], request.url, { append: true, startIndex: index, autoOpen: !request.opened });
      request.opened = true;
      request.received.add(index);
      runMeta.count = request.received.size; renderMeta();
      request.firstDraftMs ??= Math.round(performance.now() - request.started);
      setProgress(`已生成 ${request.received.size}/6`, request.received.size);
      adapter.onBusyChange?.(true, request.received.size);
    }
    // Settings are read when the panel is shown, so a hidden panel (most pages)
    // never wakes the background worker for them.
    const active = () => adapter.isActive?.() ?? true;
    chrome.runtime.onMessage?.addListener((message) => {
      if (message?.type === "DESCRIPTION_MODE_CHANGED") { if (active()) refreshDescriptionMode(); return; }
      if (message?.type === "QUESTION_STYLE_CHANGED") { if (active()) refreshStyle(); return; }
      if (message?.type === "MODEL_CHANGED") { if (active()) refreshActiveModel(); return; }
      if (message?.type !== "ZH_QUESTION_PROGRESS" || message.requestId !== currentRequest?.id) return;
      if (message.item && Number.isInteger(message.index) && message.index >= 0 && message.index < 6) acceptItem(message.item, message.index);
      else if (message.phase === "connected" && !currentRequest.received.size) setProgress("生成中 0/6");
    });
    modelSwitch.onclick = () => chrome.runtime.sendMessage({ type: "OPEN_MODEL_SETTINGS" }).catch(() => {});
    $(".guide-button").addEventListener("click", () => chrome.runtime.sendMessage({ type: "OPEN_GUIDE" }).catch(() => {}));
    $(".close-button").addEventListener("click", () => adapter.onClose?.());
    $(".selection-clear").addEventListener("click", async () => {
      try { await adapter.clearSelection?.(); } catch { /* The page may have gone away. */ }
      setSelection(0);
    });
    // Original mode never sends the selection, so the hint would mislead there.
    function renderSelectionHint() {
      const show = selectionLength > 0 && formatState.next !== "original";
      selectionHint.classList.toggle("is-hidden", !show);
      if (show) selectionText.textContent = `已选中 ${selectionLength} 字，将优先分析选区`;
    }
    function setSelection(length) { selectionLength = Number(length) || 0; renderSelectionHint(); }
    function setPageInfo(text) {
      pageInfo.textContent = text || "";
      pageInfo.classList.toggle("is-hidden", !text);
    }
    function refreshActiveModel() {
      refreshDescriptionMode();
      refreshStyle();
      chrome.runtime.sendMessage({ type: "GET_ACTIVE_MODEL" }).then((reply) => {
        const model = reply?.ok ? reply.data?.model : "";
        const ready = Boolean(model && reply.data.hasKey);
        modelSwitch.classList.toggle("needs-setup", !ready);
        modelName.textContent = !model ? "未配置模型 · 点此添加" : ready ? model : `${model} · 需补充密钥`;
        modelSwitch.title = !model ? "打开模型设置，添加知乎直答或 OpenAI 兼容 API" : ready ? `当前模型：${model}，点击管理模型` : "密钥仅保存到浏览器会话结束，请在模型面板重新填写";
      }).catch(() => {});
    }
    function refreshDescriptionMode() {
      chrome.runtime.sendMessage({ type: "GET_DESCRIPTION_MODE" }).then(reply => {
        if (!reply?.ok) return;
        formatState.next = reply.data.mode;
        descriptionSelect.value = reply.data.mode;
        descriptionSelect.disabled = isAnalyzing;
        renderSelectionHint();
      }).catch(() => {});
    }

    analyzeButton.addEventListener("click", () => isAnalyzing ? cancel() : analyze());
    // A second click of a double-click must not stop the run it just started.
    function cancel(force = false) {
      const request = currentRequest;
      if (!request || request.cancelled || (!force && performance.now() - request.started < 400)) return;
      request.cancelled = true;
      analyzeButton.disabled = true;
      analyzeLabel.textContent = "正在停止…";
      chrome.runtime.sendMessage({ type: "CANCEL_ZHIHU_QUESTIONS", requestId: request.id, ...request.fields }).catch(() => {});
    }

    async function analyze() {
      if (isAnalyzing || styleBusy) return;
      const started = performance.now();
      currentRequest = { id: crypto.randomUUID(), received: new Set(), started, startedResults: false, url: "", fields: {} };
      setLoading(true);
      setProgress("连接中…");
      refreshActiveModel();
      showError("");
      try {
        const pageData = await adapter.getPage();
        currentRequest.fields = adapter.requestFields?.() || {};
        currentRequest.extractMs = Math.round(performance.now() - started);
        currentRequest.url = pageData.url;
        if (!pageData.shortNote && pageData.selectedText.length < 50 && pageData.mainText.length < 200 && pageData.description.length < 100) {
          throw new Error("当前页面正文较少，可以先选中一段文字再分析。");
        }
        const response = await chrome.runtime.sendMessage({ type: "GENERATE_ZHIHU_QUESTIONS", payload: pageData, requestId: currentRequest.id, ...currentRequest.fields });
        if (!response?.ok) throw new Error(response?.error || "生成问题失败，请重试。");
        response.data.items.forEach((item, index) => acceptItem(item, index));
        const total = Math.round(performance.now() - started);
        const stats = response.data.timings || {};
        if (runMeta) runMeta.note = `用时 ${(total / 1000).toFixed(1)} 秒`;
        resultsMeta.title = `首个草稿 ${(currentRequest.firstDraftMs / 1000).toFixed(1)} 秒；网页提取 ${currentRequest.extractMs} ms；模型连接 ${stats.headersMs ?? "未知"} ms；首段正文 ${stats.firstContentMs ?? "未知"} ms；模型生成完成 ${stats.totalMs ?? "未知"} ms。`;
      } catch (error) {
        // Drafts of this run stay; a run that produced none leaves the old list.
        if (currentRequest?.cancelled) { if (currentRequest.startedResults && runMeta) runMeta.note = "已停止"; }
        else {
          if (currentRequest?.startedResults && runMeta) runMeta.note = "未完成";
          showError(`${friendlyError(error)}${currentRequest?.received.size ? " 已生成的有效草稿已保留。" : ""}`);
        }
      } finally {
        const received = currentRequest?.received.size || 0;
        setLoading(false);
        renderMeta();
        currentRequest = null;
        adapter.onBusyChange?.(false, received);
        if (received) adapter.onDrafts?.(received);
      }
    }

    function fitField(field, min, max) {
      field.style.height = "auto";
      field.style.height = `${Math.max(min, Math.min(max, field.scrollHeight + 2))}px`;
    }
    // One draft is open at a time; the rest stay as a scannable list of titles.
    function openDraft(card, focus = false) {
      for (const other of resultsElement.querySelectorAll(".draft.is-open")) if (other !== card) other.classList.remove("is-open");
      card.classList.add("is-open");
      for (const field of card.querySelectorAll("textarea")) field.dispatchEvent(new Event("input"));
      // The clicked row is hidden now; keep keyboard focus inside this draft.
      if (focus) card.querySelector(".collapse")?.focus({ preventScroll: true });
    }
    const splitTopics = (value) => value.split(/[、,，]/).map((x) => x.trim()).filter(Boolean);
    const make = (tag, className, text) => {
      const node = document.createElement(tag);
      if (className) node.className = className;
      if (text != null) node.textContent = text;
      return node;
    };

    function renderResults(items, sourceUrl, { append = false, startIndex = 0, autoOpen = false } = {}) {
      if (!append) resultsElement.replaceChildren();
      emptyState.classList.add("is-hidden");
      items.forEach((item, localIndex) => {
        const index = startIndex + localIndex;
        const label = String(index + 1);
        const card = make("article", "draft");
        card.dataset.index = String(index);

        const row = make("button", "draft-row");
        row.type = "button";
        row.setAttribute("aria-label", `展开问题 ${label}`);
        const rowTitle = make("span", "row-title", item.question);
        const chevron = make("span", "chev", "›");
        chevron.setAttribute("aria-hidden", "true");
        row.append(make("span", "num", label), rowTitle, chevron);
        row.addEventListener("click", () => openDraft(card, true));

        const edit = make("div", "draft-edit");
        const collapse = make("button", "collapse", label);
        collapse.type = "button";
        collapse.title = "收起";
        collapse.setAttribute("aria-label", `收起问题 ${label}`);
        collapse.addEventListener("click", () => { card.classList.remove("is-open"); row.focus(); });
        const main = make("div", "draft-main");

        const titleInput = make("textarea", "draft-field draft-title");
        titleInput.setAttribute("aria-label", `问题 ${label} 标题`);
        titleInput.value = item.question;
        titleInput.maxLength = 500;
        titleInput.rows = 2;
        titleInput.addEventListener("input", () => { rowTitle.textContent = titleInput.value; fitField(titleInput, 52, 150); });

        const descriptionInput = make("textarea", "draft-field draft-description");
        descriptionInput.setAttribute("aria-label", `问题 ${label} 描述`);
        descriptionInput.placeholder = "补充提问背景与讨论点";
        descriptionInput.value = item.description || "";
        const limit = Number.isInteger(item.descriptionLimit) ? item.descriptionLimit : DEFAULT_DESCRIPTION_LIMIT;
        descriptionInput.maxLength = limit;
        const count = make("p", "count");
        const renderCount = () => {
          count.textContent = `${item.descriptionClipped ? "已按知乎上限截取 · " : ""}${descriptionInput.value.length} / ${limit}`;
        };
        descriptionInput.addEventListener("input", () => { renderCount(); fitField(descriptionInput, 96, 200); });
        renderCount();

        let topics = [...item.keywords];
        const topicList = make("div", "topics");
        topicList.setAttribute("aria-label", `问题 ${label} 话题建议，进入知乎后自动匹配真实话题`);
        function renderTopics() {
          const tags = topics.map((topic, topicIndex) => {
            const tag = make("span", "tag");
            const remove = make("button", "", "×");
            remove.type = "button";
            remove.setAttribute("aria-label", `移除话题 ${topic}`);
            remove.addEventListener("click", () => { topics.splice(topicIndex, 1); renderTopics(); });
            tag.append(topic, remove);
            return tag;
          });
          if (topics.length < MAX_TOPICS) {
            const add = make("button", "tag-add", "＋ 话题");
            add.type = "button";
            add.addEventListener("click", () => {
              const input = make("input", "tag-input");
              input.setAttribute("aria-label", "添加话题，回车确认");
              input.placeholder = "回车添加";
              let done = false;
              const commit = (keep) => {
                if (done) return;
                done = true;
                if (keep) topics = [...new Set([...topics, ...splitTopics(input.value)])].slice(0, MAX_TOPICS);
                renderTopics();
              };
              input.addEventListener("keydown", (event) => {
                if (event.key === "Enter") { event.preventDefault(); commit(true); topicList.querySelector(".tag-add")?.focus(); }
                if (event.key === "Escape") { event.stopPropagation(); commit(false); }
              });
              input.addEventListener("blur", () => commit(true));
              add.replaceWith(input);
              input.focus();
            });
            tags.push(add);
          }
          topicList.replaceChildren(...tags);
        }
        renderTopics();

        const actions = make("div", "actions");
        const images = Array.isArray(item.images) ? item.images : [];
        const attach = make("input");
        attach.type = "checkbox";
        attach.checked = images.length > 0;
        if (images.length) {
          const attachLabel = make("label", "attach");
          attachLabel.title = "在知乎填写时插入网页正文里的图片";
          attachLabel.append(attach, `附 ${images.length} 张原图`);
          actions.append(attachLabel);
        }
        const copyButton = make("button", "qa-secondary copy-button", "复制");
        copyButton.type = "button";
        copyButton.title = "复制标题、描述和引用来源";
        copyButton.addEventListener("click", async () => {
          const text = [titleInput.value.trim(), descriptionInput.value.trim(), sourceUrl ? `引用来源：${sourceUrl}` : ""].filter(Boolean).join("\n\n");
          try {
            await navigator.clipboard.writeText(text);
            copyButton.textContent = "已复制";
            setTimeout(() => { copyButton.textContent = "复制"; }, 1500);
          } catch { showError("无法写入剪贴板，请在文本框中手动选择并复制。"); }
        });
        const openButton = make("button", "qa-primary open-button", "去知乎提问");
        openButton.type = "button";
        openButton.addEventListener("click", async () => {
          openButton.disabled = true;
          try {
            const reply = await chrome.runtime.sendMessage({ type: "OPEN_ZHIHU_DRAFT", payload: {
              question: titleInput.value,
              description: descriptionInput.value,
              descriptionMode: item.descriptionMode || "summary",
              originalPartial: item.originalPartial === true,
              descriptionClipped: item.descriptionClipped === true,
              sourceUrl,
              images: attach.checked ? images : [],
              keywords: topics,
            }});
            if (!reply?.ok) throw new Error(reply?.error || "打开草稿失败");
          } catch (error) { showError(friendlyError(error)); }
          finally { openButton.disabled = false; }
        });
        actions.append(copyButton, openButton);

        main.append(titleInput, descriptionInput, count, topicList, actions);
        edit.append(collapse, main);
        card.append(row, edit);
        const next = [...resultsElement.children].find(child => Number(child.dataset.index) > index);
        resultsElement.insertBefore(card, next || null);
        if (autoOpen && localIndex === 0) openDraft(card);
      });
    }

    function setLoading(loading) {
      isAnalyzing = loading;
      analyzeButton.disabled = false;
      styleSelect.disabled = loading || styleBusy;
      descriptionSelect.disabled = loading;
      // Once drafts exist, "去知乎提问" is the main action and re-running steps back.
      const hasResults = resultsElement.children.length > 0;
      analyzeButton.classList.toggle("is-stop", loading);
      analyzeButton.classList.toggle("is-quiet", loading || hasResults);
      analyzeLabel.textContent = loading ? "停止生成" : hasResults ? "重新分析" : "分析当前网页";
      if (!loading) analyzeProgress.textContent = "";
      progressTrack.classList.toggle("is-hidden", !loading);
      adapter.onBusyChange?.(loading, 0);
    }
    function showError(message) {
      errorElement.textContent = message;
      errorElement.classList.toggle("is-hidden", !message);
    }

    return { panel, header, refresh: refreshActiveModel, cancel, setSelection, setPageInfo, showError,
      isBusy: () => isAnalyzing };
  }

  // Panel styles only; the caller adds the theme and its own container rules.
  function styles() {
    return `
      :host{--qa-panel-shadow:0 8px 28px #0000001f}
      @media (prefers-color-scheme:dark){:host{
        --qa-bg:#18181b;--qa-surface:#1e1e21;--qa-sub:#28282c;--qa-ink:#ececee;--qa-muted:#9d9da6;--qa-line:#38383e;
        --qa-accent:#3d8bff;--qa-accent-hover:#5a9cff;--qa-accent-strong:#8ab8ff;--qa-accent-line:#2d4a75;--qa-soft:#1f3150;
        --qa-danger:#ff7a87;--qa-danger-soft:#3a1f24;--qa-panel-shadow:0 8px 28px #00000066;color-scheme:dark}}
      button,input,textarea,select{font-family:inherit}
      .panel{position:relative;display:none;flex-direction:column;width:min(360px,calc(100vw - 28px));max-height:min(700px,calc(100vh - 108px));overflow:hidden;color:var(--qa-ink);background:var(--qa-surface);border:1px solid var(--qa-line);border-radius:10px;box-shadow:var(--qa-panel-shadow)}
      .panel.is-open{display:flex;animation:qa-rise .16s ease}
      @keyframes qa-rise{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
      .panel.is-embedded{display:flex;width:100%;height:100%;max-height:none;border:0;border-radius:0;box-shadow:none;animation:none}
      .panel-header{display:flex;align-items:center;gap:2px;padding:6px 6px 6px 8px;border-bottom:1px solid var(--qa-line)}
      .grow{flex:1}
      .model-switch{display:inline-flex;align-items:center;gap:6px;min-width:0;max-width:250px;border:0;background:transparent;border-radius:6px;padding:5px 8px;font-size:12px;color:var(--qa-ink)}
      .model-switch:hover{background:var(--qa-sub)}
      .model-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .dot{flex:none;width:6px;height:6px;border-radius:50%;background:#2fa66a}
      .caret{flex:none;color:var(--qa-muted);font-size:10px}
      .model-switch.needs-setup{color:var(--qa-accent-strong);background:var(--qa-soft)}.needs-setup .dot{background:#d9822b}
      .icon-button{display:inline-grid;place-items:center;flex:none;width:28px;height:28px;padding:0;border:0;background:transparent;border-radius:6px;color:var(--qa-muted)}
      .icon-button:hover{background:var(--qa-sub);color:var(--qa-ink)}.icon-button svg{width:16px;height:16px}
      .panel-body{min-height:0;overflow:auto;padding:10px}
      .prefs{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px}
      .pref{position:relative;display:inline-flex;align-items:center;min-width:0;border:1px solid var(--qa-line);border-radius:6px;padding-left:8px;font-size:12px;color:var(--qa-muted)}
      .pref::after{content:"▾";position:absolute;right:7px;font-size:10px;color:var(--qa-muted);pointer-events:none}
      .pref:hover{background:var(--qa-sub)}
      .pref select{appearance:none;-webkit-appearance:none;field-sizing:content;min-width:0;max-width:160px;border:0;border-radius:6px;background:transparent;box-shadow:none;padding:3px 20px 3px 6px;font-size:12px;font-weight:500;color:var(--qa-ink);cursor:pointer;text-overflow:ellipsis}
      .pref select:disabled{cursor:wait;opacity:.6}
      .page-info{margin:0 2px 8px;font-size:12px;color:var(--qa-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .selection-hint{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px;padding:6px 8px;border-radius:6px;background:var(--qa-sub);font-size:12px;color:var(--qa-muted)}
      .link-button{flex:none;border:0;background:transparent;padding:0 2px;font-size:12px;color:var(--qa-accent)}
      .analyze-button{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;border:1px solid var(--qa-accent);border-radius:8px;padding:8px 12px;background:var(--qa-accent);color:#fff;font-size:13px;font-weight:600}
      .analyze-button:hover{background:var(--qa-accent-hover)}
      .analyze-button.is-quiet{background:var(--qa-surface);border-color:var(--qa-line);color:var(--qa-ink);font-weight:500}
      .analyze-button.is-quiet:hover{background:var(--qa-sub)}
      .analyze-button.is-stop{justify-content:space-between}
      .analyze-progress{color:var(--qa-muted);font-size:12px;font-weight:400}.analyze-progress:empty{display:none}
      .progress-track{height:2px;margin-top:8px;border-radius:2px;background:var(--qa-line);overflow:hidden}
      .progress-bar{display:block;width:4%;height:100%;background:var(--qa-accent);transition:width .3s}
      .error{margin-top:10px;padding:8px 10px;border-radius:6px;background:var(--qa-danger-soft);color:var(--qa-danger);font-size:12px;line-height:1.6}
      .empty-state{margin:0;padding:24px 12px 14px;text-align:center;font-size:12px;color:var(--qa-muted)}
      .results-meta{margin:12px 2px 6px;font-size:12px;color:var(--qa-muted)}
      .results{display:grid;border-top:1px solid var(--qa-line)}.results:empty{display:none}
      .draft{border-bottom:1px solid var(--qa-line)}
      .draft-row{display:flex;align-items:flex-start;gap:8px;width:100%;border:0;border-radius:0;background:transparent;padding:9px 4px;text-align:left;font-size:13px;line-height:1.6;color:var(--qa-ink)}
      .draft-row:hover{background:var(--qa-sub)}
      .num,.collapse{flex:none;width:18px;padding:1px 0 0;font-size:12px;color:var(--qa-muted);font-variant-numeric:tabular-nums}
      .collapse{border:0;background:transparent;text-align:left;align-self:start}.collapse:hover{color:var(--qa-accent)}
      .row-title{flex:1;min-width:0;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}
      .chev{flex:none;color:var(--qa-muted)}
      .draft.is-open .draft-row{display:none}
      .draft-edit{display:none;grid-template-columns:18px minmax(0,1fr);gap:8px;padding:9px 4px 12px}
      .draft.is-open .draft-edit{display:grid}
      .draft-main{min-width:0}
      .draft-field{display:block;width:100%;margin:0 0 6px;border:1px solid transparent;border-radius:6px;background:var(--qa-sub);padding:6px 8px;line-height:1.7;resize:vertical}
      .draft-field:focus{border-color:var(--qa-accent);background:var(--qa-surface);box-shadow:none}
      .draft-title{min-height:52px;font-size:14px;font-weight:600}
      .draft-description{min-height:96px;font-size:12px}
      .count{margin:-2px 0 8px;text-align:right;font-size:12px;color:var(--qa-muted)}
      .topics{display:flex;flex-wrap:wrap;gap:4px;margin-bottom:10px}
      .tag{display:inline-flex;align-items:center;border-radius:4px;padding:1px 0 1px 6px;background:var(--qa-soft);color:var(--qa-accent-strong);font-size:12px;line-height:1.6}
      .tag button{border:0;background:transparent;padding:0 5px;color:inherit;font-size:12px;line-height:1;opacity:.6}.tag button:hover{opacity:1}
      .tag-add{border:1px dashed var(--qa-line);border-radius:4px;background:transparent;padding:1px 6px;font-size:12px;line-height:1.6;color:var(--qa-muted)}
      .tag-add:hover{color:var(--qa-accent);border-color:var(--qa-accent)}
      .tag-input{width:96px;border-radius:4px;padding:1px 6px;font-size:12px;line-height:1.6}
      .actions{display:flex;align-items:center;gap:8px}
      .attach{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--qa-muted);cursor:pointer}
      .attach input{width:auto;margin:0;padding:0;accent-color:var(--qa-accent)}
      .copy-button{margin-left:auto}
      .actions .qa-secondary,.actions .qa-primary{padding:6px 12px;font-size:12px}
    `;
  }

  return { markup, bind, styles };
})();
