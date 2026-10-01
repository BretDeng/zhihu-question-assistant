(() => {
  if (globalThis.__ZH_QA_DRAFT_LOADED__) return;
  globalThis.__ZH_QA_DRAFT_LOADED__ = true;
  chrome.runtime.sendMessage({ type: "GET_ZHIHU_DRAFT" }).then((reply) => {
    const draft = reply?.data;
    if (!draft || Date.now() - draft.createdAt > 24 * 60 * 60 * 1000) return;
    const clearSavedDraft = () => chrome.runtime.sendMessage({ type: "CLEAR_ZHIHU_DRAFT", createdAt: draft.createdAt }).catch(() => {});
    const pageTitle = (document.querySelector?.(".QuestionHeader-title") || document.querySelector?.("h1[itemprop='name'], h1"))?.textContent;
    if (globalThis.ZhihuDraftLifecycle?.isPublishedDraft(draft, location.pathname, pageTitle)) { clearSavedDraft(); return; }
    const host = document.createElement("div");
    document.documentElement.append(host);
    const root = host.attachShadow({ mode: "closed" });
    root.innerHTML = `<style>
      :host { all:initial; } ${globalThis.ZhihuUiTheme || ""}
      section{position:fixed;right:18px;bottom:90px;z-index:2147483647;width:min(360px,calc(100vw - 36px));max-height:70vh;overflow:auto;background:var(--qa-bg);color:var(--qa-ink);padding:18px;border:1px solid var(--qa-line);border-radius:18px;box-shadow:0 4px 8px #21213408,0 20px 60px #21213424}
      section.is-collapsed{width:min(290px,calc(100vw - 36px))}section.is-collapsed .details{display:none}
      .draft-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;gap:12px}h2{font-size:16px;font-weight:600;letter-spacing:-.025em;margin:0}.dismiss-draft{font-size:20px!important;line-height:1;min-width:32px;min-height:32px;margin:0!important}.intro{color:var(--qa-muted);font-size:11px;margin:0 0 16px;line-height:1.65}
      .field-group{padding:12px;background:white;border:1px solid var(--qa-line);border-radius:12px;margin-bottom:10px}.field-heading{display:flex;align-items:center;justify-content:space-between;margin-bottom:4px}.field-heading label{font-size:10px;font-weight:600;color:var(--qa-muted)}
      textarea,input{width:100%;font-size:12px;line-height:1.7;margin:0;border:0;padding:4px 2px;background:white;border-radius:6px}textarea{min-height:92px;resize:vertical}textarea[aria-label="问题描述"]{min-height:130px}
      button{font-size:11px;margin:5px 5px 0 0}.field-heading button{font-size:10px;margin:0;padding:3px 6px}
      .status{color:#5140a9;background:var(--qa-soft);border:1px solid #e3dfff;border-radius:11px;padding:10px 12px;font-size:11px;line-height:1.7;margin:0 0 14px;overflow-wrap:anywhere}
    </style><section aria-label="待提问草稿"><div class="draft-header"><h2>提问草稿</h2></div><div class="details"><p class="intro">内容与话题会自动填入知乎。你只需审核后发布，已有内容不会被覆盖。</p></div></section>`;
    const section = root.querySelector("section");
    const details = root.querySelector(".details");
    const status = document.createElement("p");
    status.className = "status";
    status.setAttribute("aria-live", "polite");
    const fields = {};
    for (const [key, label, value] of [
      ["question", "标题", draft.question],
      ["description", "问题描述", draft.description],
      ["sourceUrl", "引用来源链接", draft.sourceUrl || ""],
      ["keywords", "话题建议（自动匹配真实话题）", draft.keywords.join("、")],
    ]) {
      const field = document.createElement(key === "keywords" || key === "sourceUrl" ? "input" : "textarea");
      field.setAttribute("aria-label", label);
      field.value = value;
      fields[key] = field;
      field.id = `qa-draft-${key}`;
      const group = document.createElement("div");
      group.className = "field-group";
      const heading = document.createElement("div");
      heading.className = "field-heading";
      const fieldLabel = document.createElement("label");
      fieldLabel.setAttribute("for", field.id);
      fieldLabel.textContent = label.split("（")[0];
      const button = document.createElement("button");
      button.className = "qa-quiet";
      button.textContent = "复制";
      button.setAttribute("aria-label", `复制${label.split("（")[0]}`);
      button.onclick = async () => {
        const value = key === "description" ? ZhihuQuestionComposer.buildDescription(field.value, fields.sourceUrl.value) : field.value;
        try { await navigator.clipboard.writeText(value); status.textContent = "已复制，可粘贴到知乎提问框。"; }
        catch { field.value = value; field.focus(); field.select(); status.textContent = "请按 Ctrl/Cmd+C 复制。"; }
      };
      if (key === "description") button.setAttribute("aria-label", "复制问题描述及引用来源");
      heading.append(fieldLabel, button); group.append(heading, field); details.append(group);
    }
    const fill = document.createElement("button");
    fill.textContent = "打开提问并填写";
    fill.className = "qa-primary";
    const bind = document.createElement("button");
    bind.textContent = "重新匹配话题";
    bind.className = "qa-secondary";
    const attemptedTitles = new WeakSet();
    let disposed = false;
    let stopLifecycle = () => {};
    // Also handle a composer opened manually after login or slow page loading.
    // Retry only once per mounted title field, never on every DOM mutation.
    const observer = new MutationObserver(() => {
      if (disposed || fill.disabled) return;
      const title = ZhihuQuestionComposer.findTitle();
      if (!title || attemptedTitles.has(title)) return;
      attemptedTitles.add(title);
      fill.onclick();
    });
    fill.onclick = async () => {
      if (disposed || fill.disabled) return;
      if (!fields.question.value.trim()) { status.textContent = "请先填写草稿标题。"; return; }
      fill.disabled = true;
      setCollapsed(true);
      status.textContent = "正在打开提问并填写草稿…";
      try {
        let result;
        try {
          result = await ZhihuQuestionComposer.fillDraft({ question: fields.question.value.trim(), description: fields.description.value, sourceUrl: fields.sourceUrl.value });
        } catch {
          result = { ok: false, message: "描述自动填写未完成，请检查已填内容。" };
        }
        const title = ZhihuQuestionComposer.findTitle();
        if (title) attemptedTitles.add(title);
        status.textContent = result.message;
        // A rich-text editor may turn a URL into a link card, changing its
        // visible text. Topic binding must not depend on exact description text.
        if (title?.value.trim() === fields.question.value.trim()) {
          observer.disconnect();
          status.textContent = "正在通过 # 按钮搜索并绑定知乎话题…";
          try {
            const topics = await ZhihuQuestionTopics.bindTopics(fields.keywords.value.split(/[、,，]/).map((x) => x.trim()).filter(Boolean), fields.question.value.trim(), showTopicProgress);
            status.textContent = `${result.ok ? "" : `${result.message} `}${ZhihuQuestionTopics.summary(topics)}`;
          } catch { status.textContent = `${result.message} 话题绑定未完成，请检查已选话题。`; }
        }
        if (!result.ok) setCollapsed(false);
      } catch {
        status.textContent = "自动填写未完成，请检查提问框，或使用复制按钮手动填写。";
        setCollapsed(false);
      } finally { fill.disabled = false; }
    };
    bind.onclick = async () => {
      if (disposed || fill.disabled || bind.disabled) return;
      const title = ZhihuQuestionComposer.findTitle();
      if (!title?.value.trim()) { status.textContent = "请先打开提问框并填写标题。"; return; }
      fill.disabled = bind.disabled = true;
      status.textContent = "正在搜索并绑定知乎话题…";
      try {
        const topics = await ZhihuQuestionTopics.bindTopics(fields.keywords.value.split(/[、,，]/).map((x) => x.trim()).filter(Boolean), title.value.trim(), showTopicProgress);
        status.textContent = ZhihuQuestionTopics.summary(topics);
      } catch { status.textContent = "话题绑定未完成，请检查已选话题或手动选择。"; }
      finally { fill.disabled = bind.disabled = false; }
    };
    function showTopicProgress({ keyword, index, total }) {
      status.textContent = `正在绑定话题 ${index}/${total}：${keyword}…`;
    }
    const close = document.createElement("button");
    close.textContent = "收起草稿";
    close.className = "qa-quiet";
    function setCollapsed(collapsed) {
      section.classList.toggle("is-collapsed", collapsed);
      close.textContent = collapsed ? "展开草稿" : "收起草稿";
      close.setAttribute("aria-expanded", String(!collapsed));
    }
    close.onclick = () => setCollapsed(!section.classList.contains("is-collapsed"));
    section.insertBefore(status, details);
    section.append(fill, bind, close);
    observer.observe(document.body, { childList: true, subtree: true });
    function dismissDraft() {
      if (disposed) return;
      disposed = true; observer.disconnect(); stopLifecycle(); host.remove(); clearSavedDraft();
    }
    const dismiss = document.createElement("button");
    dismiss.className = "qa-quiet dismiss-draft"; dismiss.type = "button"; dismiss.textContent = "×";
    dismiss.setAttribute("aria-label", "关闭草稿面板");
    dismiss.title = "关闭草稿面板，不清除知乎已填写的内容";
    dismiss.onclick = dismissDraft;
    root.querySelector(".draft-header").append(dismiss);
    stopLifecycle = globalThis.ZhihuDraftLifecycle?.watch(draft, dismissDraft, (publishedTitle) => {
      chrome.runtime.sendMessage({ type: "UPDATE_ZHIHU_DRAFT_TITLE", createdAt: draft.createdAt, publishedTitle }).catch(() => {});
    }) || (() => {});
    window.addEventListener("pagehide", () => observer.disconnect(), { once: true });
    if (location.pathname === "/") fill.onclick();
  }).catch(() => {});
})();
