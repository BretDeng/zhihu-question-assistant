import { generateQuestions } from "./modelClient.js";
import { activeModelConfig } from "./modelProfiles.js";
chrome.storage.local?.setAccessLevel?.({ accessLevel: "TRUSTED_CONTEXTS" })?.catch(() => {});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (["CLEAR_ZHIHU_DRAFT", "UPDATE_ZHIHU_DRAFT_TITLE"].includes(message?.type)) {
    if (!_sender.tab?.id || !_sender.url?.startsWith("https://www.zhihu.com/")) return;
    updateDraftLifecycle(message, _sender.tab.id).then((data) => sendResponse({ ok: true, data }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }
  if (message?.type === "GET_ACTIVE_MODEL") {
    activeModelConfig().then(({ model, provider }) => sendResponse({ ok: true, data: { model, provider } }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }
  if (message?.type === "OPEN_MODEL_SETTINGS") {
    chrome.tabs.create({ url: chrome.runtime.getURL("popup.html?view=dashboard") }).then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false, error: "无法打开模型面板。" }));
    return true;
  }
  if (message?.type === "OPEN_ZHIHU_DRAFT") {
    openZhihuDraft(message.payload).then((data) => sendResponse({ ok: true, data }))
      .catch(() => sendResponse({ ok: false, error: "无法打开知乎草稿，请重试。" }));
    return true;
  }
  if (message?.type === "GET_ZHIHU_DRAFT") {
    if (!_sender.tab?.id || !_sender.url?.startsWith("https://www.zhihu.com/")) return;
    chrome.storage.session.get(`zhihuDraft:${_sender.tab.id}`)
      .then((stored) => sendResponse({ ok: true, data: stored[`zhihuDraft:${_sender.tab.id}`] || null }))
      .catch(() => sendResponse({ ok: false, error: "读取草稿失败" }));
    return true;
  }
  if (message?.type !== "GENERATE_ZHIHU_QUESTIONS") {
    return undefined;
  }

  requestQuestions(message.payload)
    .then((data) => sendResponse({ ok: true, data }))
    .catch((error) => {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : "生成问题失败，请重试。",
      });
    });

  return true;
});

async function updateDraftLifecycle(message, tabId) {
  const key = `zhihuDraft:${tabId}`;
  const stored = await chrome.storage.session.get(key);
  const draft = stored[key];
  if (!draft || draft.createdAt !== message.createdAt) return { cleared: false };
  if (message.type === "CLEAR_ZHIHU_DRAFT") { await chrome.storage.session.remove(key); return { cleared: true }; }
  if (typeof message.publishedTitle === "string" && message.publishedTitle.trim()) {
    await chrome.storage.session.set({ [key]: { ...draft, publishedTitle: message.publishedTitle.trim().slice(0, 500) } });
  }
  return { cleared: false };
}

async function openZhihuDraft(payload) {
  if (typeof payload?.question !== "string" || !payload.question.trim()) throw new Error("缺少标题");
  const draft = {
    question: payload.question.trim().slice(0, 500),
    description: String(payload.description || "").slice(0, 3000),
    keywords: Array.isArray(payload.keywords) ? payload.keywords.filter((x) => typeof x === "string").slice(0, 5).map((x) => x.slice(0, 100)) : [],
    sourceUrl: safeSourceUrl(payload.sourceUrl),
    createdAt: Date.now(),
  };
  // Bind each draft to its destination tab; never put its contents in a URL.
  const tab = await chrome.tabs.create({ url: "about:blank" });
  try {
    await chrome.storage.session.set({ [`zhihuDraft:${tab.id}`]: draft });
    await chrome.tabs.update(tab.id, { url: "https://www.zhihu.com/" });
    return { tabId: tab.id };
  } catch (error) {
    await chrome.storage.session.remove(`zhihuDraft:${tab.id}`);
    throw error;
  }
}

function safeSourceUrl(value) {
  try {
    if (typeof value !== "string" || value.length > 4096) return "";
    const url = new URL(value);
    if (!/^https?:$/.test(url.protocol) || url.username || url.password) return "";
    url.hash = "";
    return url.href;
  } catch { return ""; }
}

chrome.tabs.onRemoved.addListener((tabId) => chrome.storage.session.remove(`zhihuDraft:${tabId}`));

async function requestQuestions(payload) {
  // Read settings in the trusted background, never use a page-supplied API URL or key.
  const config = await activeModelConfig();
  const keepAlive = setInterval(() => chrome.runtime.getPlatformInfo().catch(() => {}), 20000);
  try {
    return await generateQuestions(payload, config);
  } finally {
    clearInterval(keepAlive);
  }
}
