import { DEFAULT_BASE_URL, resolveConfig } from "./modelClient.js";
import { readProfiles, saveProfile, selectProfile, removeProfile } from "./modelProfiles.js";
import { SITE_RULES_KEY, parseSites } from "./siteRules.js";
import { DESCRIPTION_MODE_KEY, normalizeDescriptionMode, readDescriptionMode } from "./draftPreferences.js";
import { renderFaq } from "./faq.js";
import { QUESTION_STYLE_KEY, MAX_CUSTOM_STYLES, normalizeQuestionStyle, readQuestionStyle, activeCustomStyle } from "./questionStyles.js";
const theme = document.createElement("style");
theme.textContent = globalThis.ZhihuUiTheme;
document.head.append(theme);
const $ = (selector) => document.querySelector(selector);
const fullDashboard = new URL(location.href).searchParams.get("view") === "dashboard";
document.documentElement.classList.toggle("is-dashboard", fullDashboard);
$("#expandDashboardButton").classList.toggle("is-hidden", fullDashboard);
$("#expandDashboardButton").onclick = async () => {
  try { await chrome.tabs.create({ url: chrome.runtime.getURL("popup.html?view=dashboard") }); }
  catch { showStatus("无法打开独立面板，请重试。", true); }
};
const openGuide = async () => {
  try { await chrome.tabs.create({ url: chrome.runtime.getURL("guide.html") }); }
  catch { showStatus("无法打开教程，请重试。", true); }
};
$("#guideButton").onclick = openGuide;
if (fullDashboard) {
  renderFaq($("#faqList"), $("#faqSearch"));
  if (location.hash === "#faq") $("#faq").scrollIntoView();
}
$("#openFaqButton").onclick = async () => {
  try { await chrome.tabs.create({ url: chrome.runtime.getURL("popup.html?view=dashboard#faq") }); }
  catch { showStatus("无法打开常见问题，请重试。", true); }
};
$("#resetBallButton").onclick = async () => {
  try { await chrome.storage.local.remove("ballPosition"); siteStatus("已恢复默认位置，刷新或新打开的网页生效。"); }
  catch { siteStatus("恢复失败，请重试。", true); }
};
$("#welcomeGuideButton").onclick = openGuide;
$("#welcomeAddButton").onclick = () => openEditor();
let state;
let editingId = null;
let busy = false;
$("#addProfileButton").onclick = () => openEditor();
if (new URL(location.href).searchParams.get("add") === "1") load().then(() => openEditor());
$("#cancelEditButton").onclick = () => $("#profileEditor").classList.add("is-hidden");
$("#profileSearch").oninput = renderProfiles;
$("#providerInput").onchange = () => { $("#modelInput").value = ""; updateProviderFields(); };
$("#profileForm").onsubmit = saveSettings;
load();
loadSites();
let descriptionMode = "summary";
let modeBusy = true;
const modeButtons = [$("#summaryModeButton"), $("#originalModeButton")];
let styleState = normalizeQuestionStyle(), styleBusy = true;
const styleSelect = $("#questionStyleSelect");
let editingStyleId = "";
$("#customStyleLibrary").classList.toggle("is-hidden", !fullDashboard);
$("#editStyleButton").classList.toggle("is-hidden", fullDashboard);
$("#editStyleButton").onclick = () => chrome.tabs.create({ url: chrome.runtime.getURL("popup.html?view=dashboard#questionStyle") }).catch(() => styleStatus("无法打开 Dashboard，请重试。", true));
readQuestionStyle(chrome).then(style => {
  renderQuestionStyle(style);
  setStyleBusy(false);
  if (fullDashboard && location.hash === "#questionStyle") $("#questionStyle").scrollIntoView();
}).catch(() => styleStatus("读取风格失败，请重新打开面板。", true));
function setStyleBusy(busy) {
  styleBusy = busy;
  styleSelect.disabled = busy;
  $("#saveStyleButton").disabled = busy;
  $("#newStyleButton").disabled = busy || styleState.customStyles.length >= MAX_CUSTOM_STYLES;
  document.querySelectorAll("#customStyleList button").forEach(button => { button.disabled = busy; });
}
// Every style write goes through the background so all open pages get one change event.
async function sendStyle(message, success) {
  if (styleBusy) return false;
  setStyleBusy(true);
  try {
    const reply = await chrome.runtime.sendMessage(message);
    if (!reply?.ok) throw new Error(reply?.error || "保存失败，请重试。");
    renderQuestionStyle(await readQuestionStyle(chrome));
    styleStatus(success);
    return true;
  } catch (error) {
    styleSelect.value = styleState.selected;
    styleStatus(error.message || "保存失败，请重试。", true);
    return false;
  } finally { setStyleBusy(false); }
}
function openStyleEditor(style = null) {
  editingStyleId = style?.id || "";
  $("#customStyleFormTitle").textContent = style ? `编辑「${style.name}」` : "新建风格";
  $("#customStyleName").value = style?.name || "";
  $("#customStylePrompt").value = style?.prompt || "";
  $("#customStyleForm").classList.remove("is-hidden");
  $("#customStyleName").focus();
}
function closeStyleEditor() { editingStyleId = ""; $("#customStyleForm").classList.add("is-hidden"); }
$("#newStyleButton").onclick = () => openStyleEditor();
$("#cancelStyleButton").onclick = closeStyleEditor;
styleSelect.onchange = async () => {
  if (styleBusy) return;
  if (styleSelect.value === "__new") {
    styleSelect.value = styleState.selected;
    if (fullDashboard) openStyleEditor(); else $("#editStyleButton").click();
    return;
  }
  await sendStyle({ type: "SET_QUESTION_STYLE", selected: styleSelect.value }, "已保存，下次分析使用此风格。已有草稿保持不变。");
};
$("#customStyleForm").onsubmit = async event => {
  event.preventDefault();
  const editing = Boolean(editingStyleId);
  const saved = await sendStyle({ type: "SAVE_CUSTOM_QUESTION_STYLE", id: editingStyleId, name: $("#customStyleName").value, prompt: $("#customStylePrompt").value },
    editing ? "风格已更新并启用，下次分析生效。" : "新风格已保存并启用，下次分析生效。");
  if (saved) closeStyleEditor();
};
function renderQuestionStyle(style) {
  styleState = normalizeQuestionStyle(style);
  const options = [["professional", "专业 · 深入分析"], ["daily", "日常 · 贴近生活"],
    ...styleState.customStyles.map(item => [item.id, `自定义 · ${item.name}`])];
  if (styleState.customStyles.length < MAX_CUSTOM_STYLES) options.push(["__new", "＋ 新建自定义风格…"]);
  styleSelect.replaceChildren(...options.map(([value, label]) => new Option(label, value)));
  styleSelect.value = styleState.selected;
  const custom = activeCustomStyle(styleState);
  $("#questionStyleHint").textContent = styleState.selected === "daily" ? "从普通人的生活体验、工作、消费和实际选择出发，用更自然、好懂的话提问。"
    : custom ? `使用「${custom.name}」的角度与表达偏好。` : "关注原因、机制、证据与行业影响，表达准确、清晰。";
  if (editingStyleId && !styleState.customStyles.some(item => item.id === editingStyleId)) closeStyleEditor();
  renderStyleLibrary();
}
function renderStyleLibrary() {
  if (!fullDashboard) return;
  $("#customStyleCount").textContent = `${styleState.customStyles.length}/${MAX_CUSTOM_STYLES}`;
  const rows = styleState.customStyles.map(item => {
    const active = item.id === styleState.selected;
    const row = document.createElement("article"); row.className = `style-item${active ? " is-active" : ""}`;
    const info = document.createElement("div"); info.className = "style-item-info";
    const name = document.createElement("h4"); name.textContent = item.name;
    if (active) { const pill = document.createElement("span"); pill.className = "style-pill"; pill.textContent = "使用中"; name.append(pill); }
    const prompt = document.createElement("p"); prompt.textContent = item.prompt;
    info.append(name, prompt);
    const actions = document.createElement("div"); actions.className = "style-item-actions";
    const use = document.createElement("button"); use.type = "button"; use.className = "qa-secondary"; use.textContent = active ? "已启用" : "使用"; use.disabled = active || styleBusy;
    use.onclick = () => sendStyle({ type: "SET_QUESTION_STYLE", selected: item.id }, `已切换到「${item.name}」，下次分析生效。`);
    const edit = document.createElement("button"); edit.type = "button"; edit.className = "qa-quiet"; edit.textContent = "编辑"; edit.disabled = styleBusy;
    edit.onclick = () => openStyleEditor(item);
    const remove = document.createElement("button"); remove.type = "button"; remove.className = "qa-quiet danger"; remove.textContent = "删除"; remove.disabled = styleBusy;
    remove.onclick = () => {
      if (!confirm(`删除风格「${item.name}」？${active ? "删除后将切回「专业」风格。" : ""}`)) return;
      sendStyle({ type: "DELETE_CUSTOM_QUESTION_STYLE", id: item.id }, `已删除「${item.name}」。`);
    };
    actions.append(use, edit, remove);
    row.append(info, actions);
    return row;
  });
  if (!rows.length) {
    const empty = document.createElement("p"); empty.className = "empty-state";
    empty.textContent = "还没有自定义风格。点「新建风格」写下你想要的提问角度，可以保存多个并随时切换。";
    rows.push(empty);
  }
  $("#customStyleList").replaceChildren(...rows);
  $("#newStyleButton").disabled = styleBusy || styleState.customStyles.length >= MAX_CUSTOM_STYLES;
}
function styleStatus(message, error = false) { $("#questionStyleStatus").textContent = message; $("#questionStyleStatus").classList.toggle("is-error", error); }
loadDescriptionMode();
modeButtons.forEach((button, index) => { button.onclick = () => saveDescriptionMode(index ? "original" : "summary"); });
chrome.storage.onChanged?.addListener((changes, area) => {
  if (area === "local" && changes[DESCRIPTION_MODE_KEY]) renderDescriptionMode(normalizeDescriptionMode(changes[DESCRIPTION_MODE_KEY].newValue));
  if (area === "local" && changes[QUESTION_STYLE_KEY]) renderQuestionStyle(changes[QUESTION_STYLE_KEY].newValue);
  // Keep the popup and the dashboard in sync when the other one saves.
  if (changes.modelProfiles || changes.modelProfileKeys) load();
});
function renderDescriptionMode(mode) {
  descriptionMode = mode;
  modeButtons[0].setAttribute("aria-pressed", String(mode === "summary"));
  modeButtons[1].setAttribute("aria-pressed", String(mode === "original"));
  $("#descriptionModeHint").textContent = mode === "original"
    ? "标题 + 当前网页已加载的正文。仅加载部分时也可使用。保留原文，段落之间无空行；引用链接附在末尾。正文加引用来源一共不超过 3000 字，超出的段落不会写入。原文可在生成后编辑。"
    : "标题 + 材料概括与讨论问题，由模型生成精简的问题描述。";
}
async function loadDescriptionMode() {
  try { renderDescriptionMode(await readDescriptionMode(chrome)); modeBusy = false; modeButtons.forEach(button => { button.disabled = false; }); }
  catch { $("#descriptionModeStatus").textContent = "读取生成偏好失败，请重新打开面板。"; }
}
async function saveDescriptionMode(mode) {
  if (modeBusy || mode === descriptionMode) return;
  modeBusy = true; modeButtons.forEach(button => { button.disabled = true; });
  const status = $("#descriptionModeStatus");
  try {
    await chrome.storage.local.set({ [DESCRIPTION_MODE_KEY]: mode });
    renderDescriptionMode(mode);
    status.textContent = "已保存，下次分析使用此形式；已有草稿保持不变。";
    status.classList.remove("is-error");
  } catch { status.textContent = "保存失败，请重试。"; status.classList.add("is-error"); }
  finally { modeBusy = false; modeButtons.forEach(button => { button.disabled = false; }); }
}
$("#siteForm").onsubmit = async event => {
  event.preventDefault();
  const button = $("#saveSitesButton");
  if (button.disabled) return;
  button.disabled = true;
  try {
    const sites = parseSites($("#excludedSitesInput").value);
    await chrome.storage.local.set({ [SITE_RULES_KEY]: sites });
    $("#excludedSitesInput").value = sites.join("\n");
    siteStatus(sites.length ? `已排除 ${sites.length} 个域名及其子域名，已打开页面会立即生效。` : "已清空排除列表，所有网站恢复启用。");
  } catch (error) { siteStatus(error.message || "保存失败，请重试。", true); }
  finally { button.disabled = false; }
};
async function loadSites() {
  try {
    const stored = await chrome.storage.local.get(SITE_RULES_KEY);
    $("#excludedSitesInput").value = Array.isArray(stored[SITE_RULES_KEY]) ? stored[SITE_RULES_KEY].join("\n") : "";
    $("#excludedSitesInput").disabled = $("#saveSitesButton").disabled = false;
  } catch { siteStatus("网站过滤读取失败，请重新打开面板。", true); }
}
function siteStatus(message, error = false) {
  $("#siteStatus").textContent = message;
  $("#siteStatus").classList.toggle("is-error", error);
}
async function load() {
  try { state = await readProfiles(); renderProfiles(); }
  catch { showStatus("读取配置失败，请重新打开扩展。", true); }
}
function hostnameOf(value) {
  try { return new URL(value).hostname; } catch { return "地址无效，请编辑"; }
}
function keyFor(id) { return state.localKeys[id] || state.sessionKeys[id] || ""; }
function renderProfiles() {
  if (!state) return;
  const active = state.items.find((item) => item.id === state.activeId);
  $("#activeName").textContent = active?.name || "尚未配置模型";
  $("#activeDetail").textContent = active ? `${active.model} · ${keyFor(active.id) ? "密钥已就绪" : "需补充密钥"}` : "添加你的 API，开始把网页变成好问题。";
  $("#profileCount").textContent = state.items.length;
  $("#welcomeCard").classList.toggle("is-hidden", state.items.length > 0);
  const list = $("#profileList");
  list.replaceChildren();
  const search = $("#profileSearch").value.trim().toLowerCase();
  const items = state.items.filter((item) => `${item.name} ${item.model} ${item.baseURL}`.toLowerCase().includes(search));
  if (!items.length) {
    const empty = document.createElement("p"); empty.className = "empty-state";
    empty.textContent = state.items.length ? "没有找到匹配的模型配置。" : "还没有保存的模型。添加一套配置，以后就能一键切换。";
    list.append(empty);
  }
  for (const item of items) {
    const row = document.createElement("article"); row.className = `profile-card${item.id === state.activeId ? " is-active" : ""}`;
    const info = document.createElement("div"); info.className = "profile-info";
    const name = document.createElement("h3"); name.textContent = item.name;
    const model = document.createElement("p"); model.textContent = item.model;
    const api = document.createElement("small"); api.textContent = `${hostnameOf(item.baseURL || DEFAULT_BASE_URL)} · ${keyFor(item.id) ? (item.rememberKey ? "本机保存" : "会话密钥") : "缺少密钥"}`;
    info.append(name, model, api);
    const actions = document.createElement("div"); actions.className = "profile-actions";
    const use = document.createElement("button"); use.className = item.id === state.activeId ? "active-pill" : "qa-secondary";
    use.textContent = item.id === state.activeId ? "正在使用" : "使用"; use.disabled = item.id === state.activeId;
    use.onclick = () => action(async () => { await selectProfile(item.id); await load(); showStatus(`已切换到「${item.name}」。`); });
    const edit = document.createElement("button"); edit.className = "qa-quiet"; edit.textContent = "编辑"; edit.onclick = () => openEditor(item);
    const remove = document.createElement("button"); remove.className = "qa-quiet danger"; remove.textContent = "删除";
    remove.onclick = () => action(async () => { if (!confirm(`删除「${item.name}」及其密钥？`)) return; await removeProfile(item.id); await load(); if (editingId === item.id) $("#profileEditor").classList.add("is-hidden"); showStatus("配置和对应密钥已删除。"); });
    actions.append(use, edit, remove); row.append(info, actions); list.append(row);
  }
}
function openEditor(item) {
  if (busy) return;
  editingId = item?.id || null;
  $("#editorTitle").textContent = item ? "编辑模型配置" : "添加模型配置";
  $("#nameInput").value = item?.name || ""; $("#providerInput").value = item?.provider || "openai";
  $("#baseUrlInput").value = item?.baseURL || ""; $("#modelInput").value = item?.model || "";
  $("#apiKeyInput").value = ""; $("#apiKeyInput").placeholder = item && keyFor(item.id) ? "已保存 · 留空保留原密钥" : "输入密钥";
  $("#rememberKeyInput").checked = item ? item.rememberKey : true;
  updateProviderFields(); $("#profileEditor").classList.remove("is-hidden"); $("#nameInput").focus();
  $("#profileEditor").scrollIntoView({ block: "nearest" });
}
function updateProviderFields() {
  const zhida = $("#providerInput").value === "zhida";
  $("#baseUrlField").classList.toggle("is-hidden", zhida);
  $("#modelInput").placeholder = zhida ? "zhida-agent" : "gpt-4o-mini";
  $("#modelHint").textContent = zhida ? "可选择 Agent、快速或思考模型。" : "支持填写供应商提供的任意模型 ID。";
  $("#modelOptions").replaceChildren(...(zhida ? ["zhida-agent", "zhida-fast-1p5", "zhida-thinking-1p5"] : ["gpt-4o-mini"]).map((name) => { const option = document.createElement("option"); option.value = name; return option; }));
}
async function saveSettings(event) {
  event.preventDefault(); if (busy) return;
  const form = { id: editingId, name: $("#nameInput").value, provider: $("#providerInput").value,
    baseURL: $("#baseUrlInput").value.trim() || DEFAULT_BASE_URL, model: $("#modelInput").value,
    apiKey: $("#apiKeyInput").value, rememberKey: $("#rememberKeyInput").checked };
  try {
    const config = resolveConfig({ ...form, apiKey: form.apiKey || (editingId && keyFor(editingId)) });
    const previous = state.items.find((item) => item.id === editingId);
    if (previous && !form.apiKey.trim() && new URL(resolveConfig({ ...previous, apiKey: keyFor(editingId) }).baseURL).origin !== new URL(config.baseURL).origin) throw new Error("API 域名已改变，请填写对应服务的新密钥。");
    const permission = chrome.permissions.request({ origins: [`${new URL(config.baseURL).origin}/*`] });
    busy = true; $("#saveSettingsButton").disabled = true;
    if (!await permission) throw new Error("未授予该 API 域名访问权限，配置未保存。");
    await saveProfile(form); $("#apiKeyInput").value = ""; $("#profileEditor").classList.add("is-hidden");
    await load(); showStatus("已保存并启用，下次分析将使用这套模型。");
  } catch (error) { showStatus(error.message || "保存失败，请重试。", true); }
  finally { busy = false; $("#saveSettingsButton").disabled = false; }
}
async function action(callback) {
  if (busy) return; busy = true;
  try { await callback(); } catch (error) { showStatus(error.message || "操作失败。", true); }
  finally { busy = false; }
}
function showStatus(message, error = false) { $("#settingsStatus").textContent = message; $("#settingsStatus").classList.toggle("is-error", error); }
