// Local UI test data only. No real credentials or network model calls.
const initial = { modelProfiles: { activeId: "zhida", items: [
  { id: "zhida", name: "知乎直答", provider: "zhida", baseURL: "https://developer.zhihu.com/v1", model: "zhida-agent", rememberKey: true },
  { id: "openai", name: "日常提问", provider: "openai", baseURL: "https://api.openai.com/v1", model: "gpt-4o-mini", rememberKey: true },
  { id: "custom", name: "我的备用模型", provider: "openai", baseURL: "https://example.com/v1", model: "custom-model", rememberKey: false }
] }, modelProfileKeys: { zhida: "fixture-key-not-real", openai: "fixture-key-not-real" } };
const area = (name, defaults) => {
  let data = JSON.parse(localStorage.getItem(name) || "null") || defaults;
  const persist = () => localStorage.setItem(name, JSON.stringify(data));
  return { async get(keys) { data = JSON.parse(localStorage.getItem(name) || "null") || data; return structuredClone(Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(key => [key, data[key]]))); }, async set(values) { Object.assign(data, values); persist(); }, async remove(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key]; persist(); }, async setAccessLevel() {} };
};
const progressListeners = [];
const storageListeners = [];
const notifyStorage = event => {
  if (event.key !== "ui-test-local") return;
  progressListeners.forEach(listener => { listener({ type: "SITE_RULES_CHANGED" }); listener({ type: "DESCRIPTION_MODE_CHANGED" }); });
  const before = JSON.parse(event.oldValue || "{}"), after = JSON.parse(event.newValue || "{}");
  storageListeners.forEach(listener => listener({ descriptionMode: { oldValue: before.descriptionMode, newValue: after.descriptionMode } }, "local"));
};
window.addEventListener("storage", notifyStorage);
if (new URL(location.href).searchParams.has("long")) {
  const paragraph = document.createElement("p");
  paragraph.textContent = `${"这是保留原样的长正文。".repeat(1600)}原文尾部标记ABC2026。`;
  document.querySelector("main").append(paragraph);
}
globalThis.chrome = { tabs: { async create({ url }) { location.href = url; return { id: 1 }; } }, storage: { onChanged: { addListener(listener) { storageListeners.push(listener); } }, local: area("ui-test-local", initial), session: area("ui-test-session", { modelProfileKeys: { custom: "fixture-key-not-real" } }) }, permissions: { async request() { return true; } }, runtime: { onMessage: { addListener(listener) { progressListeners.push(listener); } }, getURL() { return "/models?view=dashboard"; }, async sendMessage(message) {
  if (message.type === "GET_ACTIVE_MODEL") return { ok: true, data: { model: "zhida-agent", provider: "zhida" } };
  else if (message.type === "GET_DESCRIPTION_MODE") {
    const { readDescriptionMode } = await import("/draftPreferences.js");
    return { ok: true, data: { mode: await readDescriptionMode(chrome) } };
  }
  else if (message.type === "GET_SITE_ACCESS") {
    const { isSiteExcluded } = await import("/siteRules.js");
    const { excludedSites } = await chrome.storage.local.get("excludedSites");
    return { ok: true, data: { enabled: !isSiteExcluded(location.href, excludedSites) } };
  }
  else if (message.type === "GENERATE_ZHIHU_QUESTIONS") {
    const { readDescriptionMode, prepareDescription } = await import("/draftPreferences.js");
    const decorate = prepareDescription(await readDescriptionMode(chrome), message.payload);
    const items = Array.from({ length: 6 }, (_, i) => decorate({ question: i ? "浏览器插件如何帮助我们把碎片信息变成更好的问题？" : "当 AI 帮我们生成问题时，如何保留自己的判断与好奇心？", description: "越来越多工具能够阅读网页、提炼内容并生成提问。便利之外，我们是否也需要重新思考：一个好问题究竟来自信息整理，还是来自个人经验与判断？你会如何使用这类工具？", keywords: ["人工智能", "浏览器插件", "用户体验", "知识管理", "提问"] }));
    if (new URL(location.href).searchParams.has("progressive")) {
      const progress = data => progressListeners.forEach(listener => listener({ type: "ZH_QUESTION_PROGRESS", requestId: message.requestId, ...data }));
      progress({ phase: "connected" }); progress({ item: items[0], index: 0 });
      const button = document.querySelector("#complete-generation"); button.hidden = false;
      await new Promise(resolve => { button.onclick = () => { items.slice(1).forEach((item, index) => progress({ item, index: index + 1 })); button.hidden = true; resolve(); }; });
    }
    return { ok: true, data: { items } };
  }
  else if (message.type === "OPEN_ZHIHU_DRAFT") { document.querySelector("main").dataset.openedDraft = JSON.stringify(message.payload); localStorage.setItem("ui-test-draft", JSON.stringify(message.payload)); return { ok: true }; }
  else if (message.type === "OPEN_MODEL_SETTINGS") location.href = "/models";
} } };
