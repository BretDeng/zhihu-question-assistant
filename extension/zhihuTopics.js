// Use Zhihu's visible topic picker, not an undocumented write API.
globalThis.ZhihuQuestionTopics = (() => {
  const normalize = (value) => String(value || "").normalize("NFKC").replace(/\s+/g, "").toLocaleLowerCase();
  const visible = (el) => el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0;
  const unique = (items) => items.length === 1 ? items[0] : null;
  const selected = (form) => [...form.querySelectorAll(".TopicInputAlias-tagInput .Tag-content a[href*='/topic/']")].map((el) => el.textContent.trim());
  function findInput(form) {
    return unique([...form.querySelectorAll('.TopicInputAlias-input input[role=combobox], input[placeholder="绑定相关话题可以被更多人看到"]')].filter(visible));
  }
  function findHashButton(form) {
    const labelled = [...form.querySelectorAll('[aria-label="绑定相关话题可以被更多人看到"] button, [data-tooltip="绑定相关话题可以被更多人看到"] button, button[aria-label="绑定相关话题可以被更多人看到"]')];
    const icons = [...form.querySelectorAll("svg.ZDI--Hash24")].map((icon) => icon.closest?.("button")).filter(Boolean);
    return unique([...new Set([...labelled, ...icons])].filter((el) => visible(el) && !el.disabled));
  }
  function exactCandidate(input, keyword) {
    const active = input.getAttribute("aria-activedescendant") || "";
    const prefix = active.replace(/-\d+$/, "");
    if (!prefix || prefix === active) return null;
    return unique([...document.querySelectorAll(".TopicInputAlias-suggestionContainer [role=option]")].filter((el) =>
      visible(el) && el.id.startsWith(`${prefix}-`) && normalize(el.textContent) === normalize(keyword)));
  }
  function setInput(input, value) {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }
  async function waitFor(getter, timeout, signal) {
    const deadline = Date.now() + timeout;
    do {
      signal?.throwIfAborted();
      const result = getter();
      if (result) return result;
      await new Promise((resolve) => setTimeout(resolve, 120));
    } while (Date.now() < deadline);
    signal?.throwIfAborted();
    return null;
  }
  async function bindTopics(keywords, question, onProgress = () => {}, { signal } = {}) {
    signal?.throwIfAborted();
    const wanted = [...new Map((Array.isArray(keywords) ? keywords : []).filter((x) => typeof x === "string" && x.trim()).map((x) => [normalize(x), x.trim().slice(0, 100)])).values()].slice(0, 5);
    const result = { bound: [], unmatched: [], reason: "" };
    if (!wanted.length) return result;
    const title = globalThis.ZhihuQuestionComposer.findTitle();
    const form = title?.closest(".Ask-form");
    const unchanged = () => form?.isConnected && globalThis.ZhihuQuestionComposer.findTitle()?.value.trim() === question.trim();
    if (!unchanged()) return { ...result, unmatched: wanted, reason: "提问框已变化，未自动绑定话题" };
    const initialInput = findInput(form);
    if (initialInput?.value.trim()) return { ...result, unmatched: wanted, reason: "话题搜索框已有输入，已保留你的操作" };
    for (let index = 0; index < wanted.length; index++) {
      signal?.throwIfAborted();
      const keyword = wanted[index];
      onProgress({ keyword, index: index + 1, total: wanted.length });
      if (!unchanged()) { result.unmatched.push(...wanted.slice(index)); result.reason = "提问内容已变化，停止绑定"; break; }
      const existing = selected(form);
      const already = existing.find((name) => normalize(name) === normalize(keyword));
      if (already) { result.bound.push(already); continue; }
      if (existing.length >= 5) { result.unmatched.push(...wanted.slice(index)); result.reason = "已达到 5 个话题，保留现有选择"; break; }
      let input = findInput(form);
      if (!input) {
        const button = findHashButton(form);
        if (!button) { result.unmatched.push(...wanted.slice(index)); result.reason = "未找到话题选择入口"; break; }
        button.click();
        input = await waitFor(() => unchanged() && findInput(form), 4000, signal);
        signal?.throwIfAborted();
      }
      if (!input || input.value.trim()) { result.unmatched.push(...wanted.slice(index)); result.reason = "话题选择器未就绪或正在编辑"; break; }
      input.focus();
      setInput(input, keyword);
      // Search results are asynchronous. Only use an exact option belonging to
      // this input's autocomplete, never the first option or a create-topic row.
      const candidate = await waitFor(() => unchanged() && input.value === keyword && exactCandidate(input, keyword), 6000, signal);
      signal?.throwIfAborted();
      if (!unchanged() || input.value !== keyword) { result.unmatched.push(...wanted.slice(index)); result.reason = "检测到手动编辑，停止绑定"; break; }
      if (candidate) {
        candidate.click();
        const bound = await waitFor(() => unchanged() && selected(form).find((name) => normalize(name) === normalize(keyword)), 2000, signal);
        signal?.throwIfAborted();
        if (bound) result.bound.push(bound);
        else { result.unmatched.push(...wanted.slice(index)); result.reason = "知乎未确认绑定结果，停止操作"; break; }
      } else result.unmatched.push(keyword);
      // Clear only the query entered by this run, never somebody else's text.
      if (input.isConnected && input.value === keyword) { setInput(input, ""); input.blur(); }
    }
    const remaining = findInput(form);
    if (remaining && !remaining.value) {
      remaining.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true }));
      remaining.blur();
    }
    return result;
  }
  function summary(result) {
    const bound = result.bound.length ? `已绑定话题：${result.bound.join("、")}。` : "未自动绑定话题。";
    const unmatched = result.unmatched.length ? `待手动确认：${result.unmatched.join("、")}。` : "";
    return `${bound}${unmatched}${result.reason ? `${result.reason}。` : ""}请审核内容和话题后自行发布。`;
  }
  return Object.freeze({ bindTopics, exactCandidate, findHashButton, normalize, summary });
})();
