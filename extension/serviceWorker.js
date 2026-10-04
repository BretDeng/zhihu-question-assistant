import { generateQuestions } from "./modelClient.js";
import { activeModelConfig } from "./modelProfiles.js";
import { SITE_RULES_KEY, isSiteExcluded } from "./siteRules.js";
import { DESCRIPTION_MODE_KEY, normalizeDescriptionMode, readDescriptionMode, originalDescription, prepareDescription } from "./draftPreferences.js";
chrome.storage.local?.setAccessLevel?.({ accessLevel: "TRUSTED_CONTEXTS" })?.catch(() => {});
const ONBOARDING_KEY = "onboardingSeen";
const BALL_POSITION_KEY = "ballPosition";
// Stored as fractions of the free viewport space so it adapts to any window size.
function validBallPosition(value) {
  const ok = (n) => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1;
  return value && ok(value.x) && ok(value.y) ? { x: value.x, y: value.y } : null;
}
const openGuide = () => chrome.tabs.create({ url: chrome.runtime.getURL("guide.html") });

chrome.runtime.onInstalled?.addListener(({ reason }) => {
  if (reason === "install") openGuide().catch(() => {});
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "OPEN_GUIDE") {
    openGuide().then(() => sendResponse({ ok: true })).catch(() => sendResponse({ ok: false, error: "无法打开教程。" }));
    return true;
  }
  if (message?.type === "GET_UI_STATE") {
    chrome.storage.local.get([ONBOARDING_KEY, BALL_POSITION_KEY]).then(stored => sendResponse({ ok: true, data: {
      onboardingSeen: stored[ONBOARDING_KEY] === true,
      ballPosition: validBallPosition(stored[BALL_POSITION_KEY]),
    } })).catch(() => sendResponse({ ok: false }));
    return true;
  }
  if (message?.type === "SET_BALL_POSITION") {
    const position = message.position === null ? null : validBallPosition(message.position);
    if (message.position !== null && !position) return;
    (position ? chrome.storage.local.set({ [BALL_POSITION_KEY]: position }) : chrome.storage.local.remove(BALL_POSITION_KEY))
      .then(() => sendResponse({ ok: true })).catch(() => sendResponse({ ok: false }));
    return true;
  }
  if (message?.type === "SET_ONBOARDING_SEEN") {
    chrome.storage.local.set({ [ONBOARDING_KEY]: true }).then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }
  if (message?.type === "GET_DESCRIPTION_MODE") {
    readDescriptionMode(chrome).then(mode => sendResponse({ ok: true, data: { mode } }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }
  if (message?.type === "GET_SITE_ACCESS") {
    if (!_sender.url || !_sender.tab) return;
    siteEnabled(_sender.url).then(enabled => sendResponse({ ok: true, data: { enabled } }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }
  if (["CLEAR_ZHIHU_DRAFT", "UPDATE_ZHIHU_DRAFT_TITLE"].includes(message?.type)) {
    if (!_sender.tab?.id || !_sender.url?.startsWith("https://www.zhihu.com/")) return;
    updateDraftLifecycle(message, _sender.tab.id).then((data) => sendResponse({ ok: true, data }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }
  if (message?.type === "GET_ACTIVE_MODEL") {
    activeModelConfig().then(({ model, provider, apiKey }) => sendResponse({ ok: true, data: { model, provider, hasKey: Boolean(apiKey) } }))
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
      .catch(error => sendResponse({ ok: false, error: error.message || "无法打开知乎草稿，请重试。" }));
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

  requestQuestions(message.payload, _sender, message.requestId)
    .then((data) => sendResponse({ ok: true, data }))
    .catch((error) => {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : "生成问题失败，请重试。",
      });
    });

  return true;
});

async function siteEnabled(url) {
  const stored = await chrome.storage.local.get(SITE_RULES_KEY);
  return !isSiteExcluded(url, stored[SITE_RULES_KEY]);
}
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  const types = [
    changes[SITE_RULES_KEY] && "SITE_RULES_CHANGED",
    changes[DESCRIPTION_MODE_KEY] && "DESCRIPTION_MODE_CHANGED",
    (changes.modelProfiles || changes.modelProfileKeys) && "MODEL_CHANGED",
  ].filter(Boolean);
  if (!types.length) return;
  chrome.tabs.query({}).then(tabs => Promise.allSettled(tabs.flatMap(tab =>
    types.map(type => chrome.tabs.sendMessage(tab.id, { type }))
  ))).catch(() => {});
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
  const descriptionMode = normalizeDescriptionMode(payload.descriptionMode);
  const description = descriptionMode === "original" ? originalDescription(payload.description) : String(payload.description || "").slice(0, 3000);
  const draft = {
    question: payload.question.trim().slice(0, 500),
    description, descriptionMode,
    originalPartial: descriptionMode === "original" && payload.originalPartial === true,
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

async function requestQuestions(payload, sender = {}, requestId) {
  if (sender.url && !await siteEnabled(sender.url)) throw new Error("此网站已停用插件，可在面板的网站过滤中恢复。");
  // Read settings in the trusted background, never use a page-supplied API URL or key.
  const config = await activeModelConfig();
  const mode = await readDescriptionMode(chrome);
  const decorate = prepareDescription(mode, payload);
  // Capture the preference and original once per run. Switching the dashboard
  // during streaming must not mix two formats or overwrite edited cards.
  const modelPage = mode === "original" ? { ...payload, selectedText: "" } : payload;
  const keepAlive = setInterval(() => chrome.runtime.getPlatformInfo().catch(() => {}), 20000);
  let delivery = Promise.resolve();
  const progress = (data) => {
    if (!sender.tab?.id || typeof requestId !== "string") return;
    const target = sender.documentId ? { documentId: sender.documentId } : { frameId: sender.frameId || 0 };
    delivery = delivery.then(() => chrome.tabs.sendMessage(sender.tab.id, { type: "ZH_QUESTION_PROGRESS", requestId, ...data }, target)).catch(() => {});
  };
  try {
    const result = await generateQuestions(modelPage, { ...config, descriptionMode: mode }, undefined, {
      onItem: (item, index) => progress({ item: decorate(item), index }),
      onProgress: (phase) => progress({ phase }),
    });
    await delivery;
    return { ...result, items: result.items.map(decorate) };
  } catch (error) {
    await delivery;
    throw error;
  } finally {
    clearInterval(keepAlive);
  }
}
