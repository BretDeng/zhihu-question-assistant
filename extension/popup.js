import { DEFAULT_BASE_URL, resolveConfig } from "./modelClient.js";
import { readProfiles, saveProfile, selectProfile, removeProfile } from "./modelProfiles.js";
import { SITE_RULES_KEY, parseSites } from "./siteRules.js";
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
let state;
let editingId = null;
let busy = false;
$("#addProfileButton").onclick = () => openEditor();
$("#cancelEditButton").onclick = () => $("#profileEditor").classList.add("is-hidden");
$("#profileSearch").oninput = renderProfiles;
$("#providerInput").onchange = () => { $("#modelInput").value = ""; updateProviderFields(); };
$("#profileForm").onsubmit = saveSettings;
load();
loadSites();
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
function keyFor(id) { return state.localKeys[id] || state.sessionKeys[id] || ""; }
function renderProfiles() {
  if (!state) return;
  const active = state.items.find((item) => item.id === state.activeId);
  $("#activeName").textContent = active?.name || "尚未配置模型";
  $("#activeDetail").textContent = active ? `${active.model} · ${keyFor(active.id) ? "密钥已就绪" : "需补充密钥"}` : "添加你的 API，开始把网页变成好问题。";
  $("#profileCount").textContent = state.items.length;
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
    const api = document.createElement("small"); api.textContent = `${new URL(item.baseURL || DEFAULT_BASE_URL).hostname} · ${keyFor(item.id) ? (item.rememberKey ? "本机保存" : "会话密钥") : "缺少密钥"}`;
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
