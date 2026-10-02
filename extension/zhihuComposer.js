// Runs in the extension's isolated world; uses only the visible question form.
globalThis.ZhihuQuestionComposer = (() => {
  const visible = (el) => el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0;
  const unique = (items) => items.length === 1 ? items[0] : null;
  function findTitle() {
    return unique([...document.querySelectorAll(".Ask-form textarea")].filter((el) =>
      visible(el) && /写下你的问题|输入你的问题|请输入问题/.test(el.placeholder || "")));
  }
  function findEntry() {
    const entries = [...document.querySelectorAll("main div, main button, main a, header button, [role=banner] button")]
      .filter((el) => visible(el) && !el.disabled && /^(提问题|提问)$/.test(el.textContent.trim()));
    // The current homepage uses a clickable DIV rather than a button.
    return unique(entries.filter((el) => !entries.some((other) => other !== el && el.contains(other))));
  }
  function sourceURL(value) {
    try {
      if (typeof value !== "string") return "";
      const url = new URL(value);
      if (!/^https?:$/.test(url.protocol) || url.username || url.password || value.length > 4096) return "";
      url.hash = "";
      return url.href;
    } catch { return ""; }
  }
  function buildDescription(description, source) {
    const text = String(description || "").trim();
    const url = sourceURL(source);
    return url && !text.includes(url) ? `${text}${text ? "\n\n" : ""}引用来源：${url}` : text;
  }
  function setTitle(input, value) {
    const previous = input.value.trim();
    if (previous) return previous === value.trim();
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return input.value === value;
  }
  async function waitFor(getter, timeout = 10000, signal) {
    const deadline = Date.now() + timeout;
    do {
      signal?.throwIfAborted();
      const value = getter();
      if (value) return value;
      await new Promise((resolve) => setTimeout(resolve, 120));
    } while (Date.now() < deadline);
    signal?.throwIfAborted();
    return null;
  }
  async function fillDraft(draft, { signal } = {}) {
    signal?.throwIfAborted();
    let title = findTitle();
    if (!title) {
      const ready = await waitFor(() => findTitle() || findEntry(), 10000, signal);
      signal?.throwIfAborted();
      if (!ready) return { ok: false, message: "未找到提问入口。请登录知乎，手动点击「提问题」，再点「打开提问并填写」。" };
      if (!findTitle()) ready.click(); // Never click the publish button.
      title = await waitFor(findTitle, 5000, signal);
    }
    signal?.throwIfAborted();
    if (!title) return { ok: false, message: "提问框未打开，请手动打开后重试；也可复制草稿。" };
    if (!setTitle(title, draft.question)) return { ok: false, message: "提问框已有其他标题，未覆盖任何内容。请自行编辑或清空后重试。" };
    const description = buildDescription(draft.description, draft.sourceUrl);
    if (!description) return { ok: true, message: "已填写标题。请选择真实话题，检查后自行发布。" };
    // React can replace the form after title entry. Always query the current
    // form instead of waiting on a detached DOM node captured before rendering.
    const editor = await waitFor(() => {
      const currentTitle = findTitle();
      if (currentTitle?.value.trim() !== draft.question.trim()) return null;
      const form = currentTitle.closest(".Ask-form");
      return form && unique([...form.querySelectorAll(".AskDetail [contenteditable=true], .AskDetail textarea")].filter(visible));
    }, 10000, signal);
    signal?.throwIfAborted();
    if (!editor) return { ok: false, message: "已填写标题，但未找到描述编辑器。请复制「问题描述及引用来源」手动粘贴。" };
    if (findTitle()?.value.trim() !== draft.question.trim()) return { ok: false, message: "提问框内容已发生变化，停止自动填写。请检查后手动补充描述。" };
    const existing = (editor.value ?? editor.innerText ?? "").trim();
    if (existing === description) return { ok: true, message: "草稿已填入知乎提问框，请审核后发布。" };
    if (existing || editor.querySelector("img,video,figure")) return { ok: false, message: "已保留现有问题描述，没有覆盖。可复制「问题描述及引用来源」后自行补充。" };
    if (editor.tagName === "TEXTAREA") {
      setTitle(editor, description);
    } else {
      // Draft.js handles plain-text paste into its own state. Assigning innerHTML
      // would only change the DOM and could silently lose content on publication.
      editor.focus();
      const selection = document.getSelection();
      const range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
      try {
        const data = new DataTransfer();
        data.setData("text/plain", description);
        editor.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: data }));
      } catch { /* Some editor/browser combinations reject synthetic paste. */ }
      await waitFor(() => (editor.innerText || "").trim(), 600, signal);
      signal?.throwIfAborted();
      // Use the browser's native editing path when paste was ignored. It emits
      // editing events for the page's rich-text state, unlike assigning HTML.
      // Never retry over partial text or media inserted by the user/editor.
      if (!(editor.innerText || "").trim() && !editor.querySelector("img,video,figure") && findTitle()?.value.trim() === draft.question.trim()) {
        editor.focus();
        range.selectNodeContents(editor);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
        document.execCommand?.("insertText", false, description);
      }
    }
    const filled = await waitFor(() => (editor.value ?? editor.innerText ?? "").replace(/\r\n/g, "\n").trim() === description, 1500, signal);
    return filled
      ? { ok: true, message: "已填写标题、描述和引用来源。请选择真实话题，检查后自行发布。" }
      : { ok: false, message: "已填写标题；知乎未接受自动粘贴，请复制「问题描述及引用来源」手动粘贴。" };
  }
  return Object.freeze({ fillDraft, buildDescription, findEntry, findTitle, setTitle });
})();
