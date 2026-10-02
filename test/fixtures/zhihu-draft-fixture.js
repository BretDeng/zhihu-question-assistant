// Deterministic UI fixture, not included in the distributable extension.
const originalAttachShadow = Element.prototype.attachShadow;
Element.prototype.attachShadow = function (options) { return originalAttachShadow.call(this, { ...options, mode: "open" }); };
const fixtureDraft = {
  question: "如何让浏览器扩展更方便地整理网页内容？",
  description: "浏览网页时，希望直接整理出可讨论的问题、补充背景，并保留原始来源，减少反复复制粘贴。哪些交互设计最能提升这个流程的效率？",
  sourceUrl: "https://example.com/article",
  keywords: ["浏览器插件", "用户体验", "知识管理"],
  createdAt: Date.now(),
};
const siteListeners = [];
window.addEventListener("storage", event => { if (event.key === "ui-test-local") siteListeners.forEach(listener => listener({ type: "SITE_RULES_CHANGED" })); });
window.chrome = { runtime: { onMessage: { addListener(listener) { siteListeners.push(listener); }, removeListener() {} }, sendMessage: async (message) => {
  if (message.type === "GET_SITE_ACCESS") {
    const { isSiteExcluded } = await import("/siteRules.js");
    const { excludedSites } = JSON.parse(localStorage.getItem("ui-test-local") || "{}");
    return { ok: true, data: { enabled: !isSiteExcluded(location.href, excludedSites) } };
  }
  if (message.type === "CLEAR_ZHIHU_DRAFT") { sessionStorage.setItem("draft-fixture-closed", "true"); return { ok: true }; }
  if (message.type === "UPDATE_ZHIHU_DRAFT_TITLE") { fixtureDraft.publishedTitle = message.publishedTitle; return { ok: true }; }
  return { data: sessionStorage.getItem("draft-fixture-closed") ? null : fixtureDraft };
} } };
document.querySelector("#reset-draft").onclick = () => { sessionStorage.removeItem("draft-fixture-closed"); location.href = "/"; };
document.querySelector("#simulate-published").onclick = () => {
  const heading = document.createElement("h1"); heading.className = "QuestionHeader-title";
  heading.textContent = document.querySelector("textarea").value;
  document.querySelector("main").append(heading);
  document.querySelector(".Modal").hidden = true;
  history.pushState({}, "", "/question/123456");
};
document.querySelector("#entry").onclick = () => { document.querySelector(".Modal").hidden = false; };
document.querySelector("textarea").addEventListener("input", () => { document.querySelector(".AskDetail").hidden = false; });
document.querySelector("[contenteditable]").addEventListener("paste", (event) => {
  event.preventDefault();
  event.currentTarget.textContent = event.clipboardData.getData("text/plain");
});
const topicInput = document.querySelector(".TopicInputAlias-input input");
const list = document.querySelector(".TopicInputAlias-suggestionContainer");
document.querySelector("#topics").onclick = () => { topicInput.parentElement.hidden = false; };
topicInput.addEventListener("input", () => {
  list.replaceChildren();
  list.hidden = !topicInput.value;
  if (!["浏览器插件", "用户体验", "知识管理"].includes(topicInput.value)) return;
  const option = document.createElement("div");
  option.setAttribute("role", "option");
  option.id = "AutoComplete19-0";
  option.textContent = topicInput.value;
  option.onclick = () => {
    const tag = document.createElement("span");
    tag.className = "Tag-content";
    const link = document.createElement("a");
    link.href = "https://www.zhihu.com/topic/fixture";
    link.textContent = option.textContent;
    tag.append(link);
    document.querySelector(".TopicInputAlias-tagInput").append(tag);
    topicInput.value = "";
    topicInput.parentElement.hidden = true;
    list.hidden = true;
  };
  list.append(option);
});
