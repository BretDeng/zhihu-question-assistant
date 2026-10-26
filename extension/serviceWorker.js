import { generateQuestions } from "./modelClient.js";
import { readQuestionStyle, publicQuestionStyle, selectQuestionStyle, saveCustomStyle, deleteCustomStyle, questionStyleName } from "./questionStyles.js";
import { activeModelConfig } from "./modelProfiles.js";
import { SITE_RULES_KEY, isSiteExcluded } from "./siteRules.js";
import { DESCRIPTION_MODE_KEY, ATTACH_IMAGES_KEY, MAX_DRAFT_IMAGES, normalizeDescriptionMode, readDescriptionMode, originalDescription, prepareDescription, fitDescriptionBody, finishQuestion } from "./draftPreferences.js";
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
  if (message?.type === "GET_QUESTION_STYLE") {
    readQuestionStyle(chrome).then(style => sendResponse({ ok: true, data: publicQuestionStyle(style) }))
      .catch(() => sendResponse({ ok: false, error: "读取提问风格失败。" }));
    return true;
  }
  if (message?.type === "SET_QUESTION_STYLE") {
    selectQuestionStyle(chrome, message.selected).then(data => sendResponse({ ok: true, data }))
      .catch(error => sendResponse({ ok: false, error: error.message || "保存提问风格失败。" }));
    return true;
  }
  if (message?.type === "SAVE_CUSTOM_QUESTION_STYLE") {
    saveCustomStyle(chrome, message.name, message.prompt, message.id || "").then(data => sendResponse({ ok: true, data: publicQuestionStyle(data) }))
      .catch(error => sendResponse({ ok: false, error: error.message || "保存自定义风格失败。" }));
    return true;
  }
  if (message?.type === "DELETE_CUSTOM_QUESTION_STYLE") {
    deleteCustomStyle(chrome, message.id).then(data => sendResponse({ ok: true, data: publicQuestionStyle(data) }))
      .catch(error => sendResponse({ ok: false, error: error.message || "删除自定义风格失败。" }));
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
    chrome.tabs.create({ url: chrome.runtime.getURL(`popup.html?view=dashboard${message.section === "questionStyle" ? "#questionStyle" : ""}`) }).then(() => sendResponse({ ok: true }))
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
  if (message?.type === "FETCH_DRAFT_IMAGE") {
    if (!_sender.tab?.id || !_sender.url?.startsWith("https://www.zhihu.com/")) return;
    fetchDraftImage(_sender.tab.id, message.index).then(data => sendResponse({ ok: true, data }))
      .catch(error => sendResponse({ ok: false, error: error.message || "图片下载失败。" }));
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
    changes.questionStylePreferences && "QUESTION_STYLE_CHANGED",
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
  const question = finishQuestion(typeof payload?.question === "string" ? payload.question.slice(0, 499) : "");
  if (!question) throw new Error("缺少标题");
  const descriptionMode = normalizeDescriptionMode(payload.descriptionMode);
  const sourceUrl = safeSourceUrl(payload.sourceUrl);
  const normalized = descriptionMode === "original" ? originalDescription(payload.description) : String(payload.description || "").trim();
  const description = fitDescriptionBody(normalized, sourceUrl);
  const draft = {
    question,
    description, descriptionMode,
    originalPartial: descriptionMode === "original" && payload.originalPartial === true,
    descriptionClipped: payload.descriptionClipped === true || description.length < normalized.length,
    keywords: Array.isArray(payload.keywords) ? payload.keywords.filter((x) => typeof x === "string").slice(0, 5).map((x) => x.slice(0, 100)) : [],
    images: safeImageUrls(payload.images),
    sourceUrl,
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
function safeImageUrls(list) {
  if (!Array.isArray(list)) return [];
  return [...new Set(list.map(safeSourceUrl).filter(url => url.startsWith("https:") && url.length <= 2048))].slice(0, MAX_DRAFT_IMAGES);
}
async function readAttachImages() {
  const stored = await chrome.storage.local.get(ATTACH_IMAGES_KEY);
  return stored[ATTACH_IMAGES_KEY] !== false;
}

const IMAGE_TYPES = /^image\/(?:jpeg|png|gif|webp)$/;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
// Only URLs stored in this tab's own draft can be fetched, so a Zhihu page
// can't use the worker as a general-purpose proxy. No cookies or referrer
// are sent; many image CDNs block foreign referrers but allow none.
async function fetchDraftImage(tabId, index) {
  const stored = await chrome.storage.session.get(`zhihuDraft:${tabId}`);
  const url = stored[`zhihuDraft:${tabId}`]?.images?.[index];
  if (!Number.isInteger(index) || !url) throw new Error("草稿中没有这张图片。");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(url, { credentials: "omit", referrerPolicy: "no-referrer", signal: controller.signal });
    if (!response.ok) throw new Error(`图片下载失败（HTTP ${response.status}）。`);
    const blob = await response.blob();
    const type = blob.type.split(";")[0].trim().toLowerCase();
    if (!IMAGE_TYPES.test(type)) throw new Error("不支持的图片格式。");
    if (blob.size > MAX_IMAGE_BYTES) throw new Error("图片超过 10 MB。");
    const bitmap = await createImageBitmap(blob);
    const { width, height } = bitmap;
    bitmap.close?.();
    if (width < 200 || height < 120) throw new Error("图片尺寸过小，可能是图标。");
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return { base64: btoa(binary), type, width, height };
  } catch (error) {
    if (error.name === "AbortError") throw new Error("图片下载超时。");
    if (error instanceof TypeError) throw new Error("图片站点拒绝读取，可在 Dashboard 授权读取网页图片。");
    throw error;
  } finally { clearTimeout(timer); }
}

chrome.tabs.onRemoved.addListener((tabId) => chrome.storage.session.remove(`zhihuDraft:${tabId}`));

async function requestQuestions(payload, sender = {}, requestId) {
  if (sender.url && !await siteEnabled(sender.url)) throw new Error("此网站已停用插件，可在面板的网站过滤中恢复。");
  // Read settings in the trusted background, never use a page-supplied API URL or key.
  const config = await activeModelConfig();
  const mode = await readDescriptionMode(chrome);
  const questionStyle = await readQuestionStyle(chrome);
  const images = await readAttachImages() ? safeImageUrls(payload?.images) : [];
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
    const styleName = questionStyleName(questionStyle);
    const decorateStyle = item => ({ ...decorate(item), questionStyle: questionStyle.selected, questionStyleName: styleName, images });
    const result = await generateQuestions(modelPage, { ...config, descriptionMode: mode, questionStyle }, undefined, {
      onItem: (item, index) => progress({ item: decorateStyle(item), index }),
      onProgress: (phase) => progress({ phase }),
    });
    await delivery;
    return { ...result, items: result.items.map(decorateStyle) };
  } catch (error) {
    await delivery;
    throw error;
  } finally {
    clearInterval(keepAlive);
  }
}
