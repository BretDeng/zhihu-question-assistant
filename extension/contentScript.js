(() => {
  if (globalThis.__ZH_QA_FLOATING_ASSISTANT_LOADED__) {
    return;
  }
  globalThis.__ZH_QA_FLOATING_ASSISTANT_LOADED__ = true;

  let assistantHost;
  let closePanel = () => {};
  ZhihuSiteAccess.watch(enabled => {
    if (enabled && !assistantHost) mount();
    if (!assistantHost) return;
    if (enabled) assistantHost.style.removeProperty("display");
    else { assistantHost.style.setProperty("display", "none", "important"); closePanel(); }
  });
  function mount() {

  let lastSelectedText = "";
  let isAnalyzing = false;
  let currentRequest = null;

  const host = document.createElement("div");
  assistantHost = host;
  host.id = "zhihu-question-assistant-root";
  document.documentElement.append(host);

  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `
    <style>${getStyles()}</style>
    <button class="floating-ball" type="button" aria-label="打开知乎提问助手" title="知乎提问助手">
      <span>问</span>
    </button>
    <section class="panel" aria-label="知乎提问助手">
      <header class="panel-header">
        <div>
          <p class="eyebrow">QUESTION LAB</p>
          <h1>知乎提问助手</h1>
        </div>
        <button class="close-button qa-quiet" type="button" aria-label="收起面板">收起</button>
      </header>
      <div class="panel-body">
        <div class="panel-toolbar">
        <button class="model-switch qa-secondary" type="button">选择模型</button>
        <button class="analyze-button" type="button">分析当前网页</button>
        </div>
        <div class="loading is-hidden" aria-live="polite">
          <span class="spinner" aria-hidden="true"></span>
          <span>正在生成问题，已有结果会继续保留…</span>
        </div>
        <div class="error is-hidden" role="alert"></div>
        <div class="empty-state">生成 6 个提问草稿，可编辑标题、文案和话题建议后去知乎提问。</div>
        <div class="results" aria-live="polite"></div>
        <p class="timing-status" role="status"></p>
      </div>
    </section>
  `;

  const ball = shadow.querySelector(".floating-ball");
  const panel = shadow.querySelector(".panel");
  const closeButton = shadow.querySelector(".close-button");
  const analyzeButton = shadow.querySelector(".analyze-button");
  const loadingElement = shadow.querySelector(".loading");
  const errorElement = shadow.querySelector(".error");
  const emptyState = shadow.querySelector(".empty-state");
  const resultsElement = shadow.querySelector(".results");
  const modelSwitch = shadow.querySelector(".model-switch");
  const timingElement = shadow.querySelector(".timing-status");
  const loadingText = loadingElement.querySelector("span:last-child");
  function acceptItem(item, index) {
    const request = currentRequest;
    if (!request || request.received.has(index)) return;
    if (!request.startedResults) { resultsElement.replaceChildren(); request.startedResults = true; }
    renderResults([item], request.url, { append: true, startIndex: index });
    request.received.add(index);
    request.firstDraftMs ??= Math.round(performance.now() - request.started);
    loadingText.textContent = `已生成 ${request.received.size}/6 个草稿，可先编辑，剩余继续生成…`;
  }
  chrome.runtime.onMessage?.addListener((message) => {
    if (message?.type !== "ZH_QUESTION_PROGRESS" || message.requestId !== currentRequest?.id) return;
    if (message.item && Number.isInteger(message.index) && message.index >= 0 && message.index < 6) acceptItem(message.item, message.index);
    else if (message.phase === "connected" && !currentRequest.received.size) loadingText.textContent = "模型已连接，正在生成第一个草稿…";
  });
  modelSwitch.onclick = () => chrome.runtime.sendMessage({ type: "OPEN_MODEL_SETTINGS" });
  function refreshActiveModel() {
    chrome.runtime.sendMessage({ type: "GET_ACTIVE_MODEL" }).then((reply) => {
      modelSwitch.textContent = reply?.data?.model ? `模型 · ${reply.data.model}` : "选择模型";
      modelSwitch.title = reply?.data?.model ? `当前模型：${reply.data.model}，点击切换` : "打开模型设置";
    }).catch(() => {});
  }
  refreshActiveModel();

  const ballDrag = ZhihuDraggable.attach(ball);
  const panelDrag = ZhihuDraggable.attach(panel, shadow.querySelector(".panel-header"));
  closePanel = () => panel.classList.remove("is-open");
  ball.addEventListener("click", () => {
    panel.classList.toggle("is-open");
    if (panel.classList.contains("is-open") && ballDrag.moved && !panelDrag.moved) {
      const anchor = ball.getBoundingClientRect(), rect = panel.getBoundingClientRect();
      panelDrag.moveTo(anchor.right - rect.width, anchor.top >= rect.height + 20 ? anchor.top - rect.height - 12 : anchor.bottom + 12);
    }
    refreshActiveModel();
  });
  closeButton.addEventListener("click", () => panel.classList.remove("is-open"));
  analyzeButton.addEventListener("click", analyzeCurrentPage);

  document.addEventListener("selectionchange", rememberSelectedText, { passive: true });

  async function analyzeCurrentPage() {
    if (isAnalyzing) return;

    setLoading(true);
    const started = performance.now();
    currentRequest = { id: crypto.randomUUID(), received: new Set(), started, startedResults: false, url: location.href };
    loadingText.textContent = "正在提取网页并连接模型…";
    timingElement.textContent = "";
    refreshActiveModel();
    showError("");

    try {
      const pageData = extractPageContent();
      currentRequest.extractMs = Math.round(performance.now() - started);
      currentRequest.url = pageData.url;
      if (pageData.selectedText.length < 50 && pageData.mainText.length < 200 && pageData.description.length < 100) {
        throw new Error("当前页面正文较少，可以先选中一段文字再分析。");
      }

      const response = await chrome.runtime.sendMessage({
        type: "GENERATE_ZHIHU_QUESTIONS",
        payload: pageData,
        requestId: currentRequest.id,
      });

      if (!response?.ok) {
        throw new Error(response?.error || "生成问题失败，请重试。");
      }

      response.data.items.forEach((item, index) => acceptItem(item, index));
      const total = Math.round(performance.now() - started);
      const stats = response.data.timings || {};
      timingElement.textContent = `首个草稿 ${(currentRequest.firstDraftMs / 1000).toFixed(1)} 秒 · 总耗时 ${(total / 1000).toFixed(1)} 秒`;
      timingElement.title = `网页提取 ${currentRequest.extractMs} ms；模型连接 ${stats.headersMs ?? "未知"} ms；首段正文 ${stats.firstContentMs ?? "未知"} ms；模型生成完成 ${stats.totalMs ?? "未知"} ms。计时不保存网页内容或密钥。`;
    } catch (error) {
      showError(`${error instanceof Error ? error.message : "发生未知错误，请重试。"}${currentRequest?.received.size ? " 已生成的有效草稿已保留。" : ""}`);
    } finally {
      setLoading(false);
      currentRequest = null;
    }
  }

  function extractPageContent() {
    const currentSelection = cleanText(globalThis.getSelection()?.toString() || "");
    if (currentSelection) {
      lastSelectedText = currentSelection;
    }

    return {
      title: cleanText(document.title).slice(0, 500),
      url: location.href,
      description: cleanText(
        document.querySelector('meta[name="description"]')?.content ||
          document.querySelector('meta[property="og:description"]')?.content ||
          "",
      ).slice(0, 1500),
      selectedText: (currentSelection || lastSelectedText).slice(0, 12000),
      mainText: extractMainText().slice(0, 12000),
    };
  }

  function extractMainText() {
    const preferredBlocks = [...document.querySelectorAll("article, main, [role='main']")]
      .map(extractCleanBlock)
      .filter((text) => text.length >= 80)
      .sort((left, right) => right.length - left.length);

    if (preferredBlocks.length > 0) {
      return preferredBlocks[0];
    }

    return joinUniqueBlocks(
      [...document.querySelectorAll("p, h1, h2, h3")]
        .filter((element) => !element.closest("nav, aside, footer, form, [aria-hidden='true']"))
        .map((element) => cleanText(element.innerText || element.textContent || ""))
        .filter((text) => text.length >= 2),
    );
  }

  function extractCleanBlock(element) {
    const clone = element.cloneNode(true);
    clone.querySelectorAll("nav, aside, footer, form, script, style, noscript, [aria-hidden='true']").forEach((item) => item.remove());
    return cleanText(clone.textContent || "");
  }

  function joinUniqueBlocks(blocks) {
    const unique = new Set();
    for (const block of blocks) {
      unique.add(block);
    }
    return cleanText([...unique].join("\n\n"));
  }

  function rememberSelectedText() {
    const selectedText = cleanText(globalThis.getSelection()?.toString() || "");
    if (selectedText) {
      lastSelectedText = selectedText.slice(0, 12000);
    }
  }

  function renderResults(items, sourceUrl, { append = false, startIndex = 0 } = {}) {
    if (!append) resultsElement.replaceChildren();
    emptyState.classList.add("is-hidden");

    items.forEach((item, localIndex) => {
      const index = startIndex + localIndex;
      const card = document.createElement("article");
      card.className = "result-card";
      card.dataset.index = String(index);

      const heading = document.createElement("div");
      heading.className = "result-heading";

      const number = document.createElement("span");
      number.className = "number";
      number.textContent = `问题 ${String(index + 1).padStart(2, "0")}`;

      heading.append(number);

      const titleInput = document.createElement("textarea");
      titleInput.className = "draft-field draft-title";
      titleInput.setAttribute("aria-label", `问题 ${index + 1} 标题`);
      titleInput.value = item.question;
      titleInput.maxLength = 500;
      const descriptionInput = document.createElement("textarea");
      descriptionInput.className = "draft-field draft-description";
      descriptionInput.setAttribute("aria-label", `问题 ${index + 1} 描述`);
      descriptionInput.placeholder = "补充提问背景与讨论点";
      descriptionInput.value = item.description || "";
      descriptionInput.maxLength = 3000;
      const topicLabel = document.createElement("label");
      topicLabel.className = "qa-label topic-label";
      topicLabel.textContent = "话题建议";
      topicLabel.title = "进入知乎后自动匹配真实话题，由你审核";
      const topicInput = document.createElement("input");
      topicInput.className = "draft-field";
      topicInput.setAttribute("aria-label", `问题 ${index + 1} 话题建议`);
      topicInput.value = item.keywords.join("、");
      topicLabel.append(topicInput);
      const openButton = document.createElement("button");
      openButton.className = "qa-primary open-button";
      openButton.textContent = "去知乎提问";
      openButton.addEventListener("click", async () => {
        openButton.disabled = true;
        try {
          const reply = await chrome.runtime.sendMessage({ type: "OPEN_ZHIHU_DRAFT", payload: {
            question: titleInput.value,
            description: descriptionInput.value,
            sourceUrl,
            keywords: topicInput.value.split(/[、,，]/).map((x) => x.trim()).filter(Boolean),
          }});
          if (!reply?.ok) throw new Error(reply?.error || "打开草稿失败");
        } catch (error) { showError(error.message); }
        finally { openButton.disabled = false; }
      });
      card.append(heading, titleInput, descriptionInput, topicLabel, openButton);
      const next = [...resultsElement.children].find(child => Number(child.dataset.index) > index);
      resultsElement.insertBefore(card, next || null);
      const fitField = (field, min, max) => {
        field.style.height = "auto";
        field.style.height = `${Math.max(min, Math.min(max, field.scrollHeight + 2))}px`;
      };
      for (const [field, min, max] of [[titleInput, 64, 150], [descriptionInput, 100, 180]]) {
        fitField(field, min, max);
        field.addEventListener("input", () => fitField(field, min, max));
      }
    });
  }

  function setLoading(loading) {
    isAnalyzing = loading;
    analyzeButton.disabled = loading;
    analyzeButton.textContent = loading ? "分析中…" : "分析当前网页";
    loadingElement.classList.toggle("is-hidden", !loading);
  }

  function showError(message) {
    errorElement.textContent = message;
    errorElement.classList.toggle("is-hidden", !message);
  }

  function cleanText(value) {
    return String(value)
      .replace(/\u00a0/g, " ")
      .replace(/[\t\f\v ]+/g, " ")
      .replace(/\s*\n\s*/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function getStyles() {
    return `:host{all:initial} ${globalThis.ZhihuUiTheme || ""}
      button,input,textarea{font-family:inherit}
      .floating-ball{position:fixed;right:22px;bottom:24px;z-index:2147483647;width:48px;height:48px;border:1px solid #dcd8ff;border-radius:16px;color:var(--qa-accent);background:white;box-shadow:var(--qa-shadow);font-size:20px;font-weight:600}
      .floating-ball:hover{background:var(--qa-soft)}
      .panel{position:fixed;right:22px;bottom:86px;z-index:2147483646;display:flex;flex-direction:column;width:min(360px,calc(100vw - 28px));max-height:min(700px,calc(100vh - 108px));overflow:hidden;color:var(--qa-ink);background:var(--qa-bg);border:1px solid var(--qa-line);border-radius:18px;box-shadow:0 4px 8px #21213408,0 20px 60px #21213424;opacity:0;pointer-events:none;transform:translateY(8px);transition:opacity .18s,transform .18s}
      .panel.is-open{opacity:1;pointer-events:auto;transform:none}
      .panel-header{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid var(--qa-line);background:#fafafd}
      .eyebrow{margin:0 0 2px;color:var(--qa-muted);font-size:9px;font-weight:600;letter-spacing:.12em}h1{margin:0;font-size:18px;letter-spacing:-.03em;line-height:1.4}
      .panel-body{min-height:0;overflow:auto;padding:12px}
      .panel-toolbar{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:stretch}
      .model-switch{min-width:0;margin:0;text-align:left;font-size:11px;color:var(--qa-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:9px 10px}
      .analyze-button{border:1px solid var(--qa-accent);border-radius:10px;padding:9px 12px;color:#fff;background:var(--qa-accent);font-size:12px;font-weight:600;white-space:nowrap}
      .analyze-button:hover{background:#5140eb}.loading,.error,.empty-state{margin-top:12px;padding:12px 14px;border-radius:12px;font-size:12px;line-height:1.6}
      .loading{background:var(--qa-soft);color:#5140a9}.spinner{display:none}.error{color:var(--qa-danger);background:#fff1f2;border:1px solid #f1d4db}.empty-state{background:white;color:var(--qa-muted);border:1px dashed var(--qa-line)}
      .results{display:grid;gap:10px;margin-top:12px}.result-card{padding:14px;background:white;border:1px solid var(--qa-line);border-radius:14px;box-shadow:0 2px 6px #21213404}
      .timing-status{font-size:10px;color:var(--qa-muted);margin:10px 2px 0}.timing-status:empty{display:none}
      .number{font-size:10px;font-weight:600;color:var(--qa-muted);letter-spacing:.08em}.result-heading{margin-bottom:8px}
      .draft-field{display:block;width:100%;font:inherit;line-height:1.7;resize:vertical;margin:0 0 10px}
      .draft-title{font-size:14px;font-weight:600;min-height:64px;border-color:transparent;background:#fafafd;padding:8px 10px}
      .draft-description{min-height:100px;font-size:12px;border-color:transparent;padding:6px 4px;background:white;line-height:1.75}
      .topic-label{margin-top:10px}.topic-label input{font-size:11px;font-weight:400;background:var(--qa-soft);border-color:transparent;margin-top:6px;line-height:1.6}
      .open-button{width:100%;font-size:12px;margin-top:4px}
      @media(max-width:520px){.floating-ball{right:14px;bottom:16px}.panel{right:14px;bottom:76px;max-height:calc(100vh - 94px)}}
    `;
  }
  }
})();
