import { readProfiles, saveProfile, activeModelConfig } from "./modelProfiles.js";
import { resolveConfig, ZHIDA_MODELS } from "./modelClient.js";
import { readQuestionStyle, selectQuestionStyle, saveCustomStyle } from "./questionStyles.js";
import { DESCRIPTION_MODE_KEY, ATTACH_IMAGES_KEY, normalizeDescriptionMode } from "./draftPreferences.js";
import { renderFaq } from "./faq.js";

const theme = document.createElement("style");
theme.textContent = globalThis.ZhihuUiTheme;
document.head.append(theme);
const $ = selector => document.querySelector(selector);
const cards = [...document.querySelectorAll(".step-card")];
const api = globalThis.chrome;
let index = 0, busy = false, ready = false, modelDirty = false, preferenceDirty = false;
let profiles, savedFingerprint = "", verifiedFingerprint = "";
const fingerprint = config => JSON.stringify([config.provider, config.baseURL, config.model, config.apiKey]);
renderFaq($("#faqList"), $("#faqSearch"));

function status(id, message, error = false) {
  $(id).textContent = message;
  $(id).classList.toggle("is-error", error);
}
function setBusy(value) {
  busy = value;
  $("#modelFields").disabled = value || !profiles;
  $("#profileSelect").disabled = value || !profiles;
  $("#preferenceFields").disabled = value || !profiles;
  $("#backButton").disabled = value || index === 0;
  $("#nextButton").disabled = value;
  $("#trialButton").disabled = value || !ready;
}
function show(next) {
  index = Math.max(0, Math.min(cards.length - 1, next));
  cards.forEach((card, item) => card.classList.toggle("is-current", item === index));
  $("#stepProgress").textContent = `第 ${index + 1} 步，共 ${cards.length} 步`;
  $("#nextButton").textContent = index === 4 ? "完成，开始使用" : index === 3 ? "继续（可跳过试生成）" : "下一步";
  status("#navigationStatus", "");
  setBusy(busy);
  if (index === 4) $("#completionStatus").textContent = ready
    ? verifiedFingerprint === savedFingerprint ? "模型已保存，并已通过示例生成验证。" : "模型已保存，尚未验证实际调用；可以稍后在文章页尝试。"
    : "模型配置尚未就绪，请返回第 2 步完成设置。";
}
function providerFields() {
  const zhida = $("#providerInput").value === "zhida";
  $("#baseUrlField").classList.toggle("is-hidden", zhida);
  $("#zhidaHelp").classList.toggle("is-hidden", !zhida);
  $("#baseUrlInput").disabled = zhida;
  $("#modelInput").placeholder = zhida ? "zhida-agent" : "gpt-4o-mini";
  $("#modelOptions").replaceChildren(...(zhida ? ZHIDA_MODELS : ["gpt-4o-mini"]).map(name => new Option(name, name)));
  $("#providerHelp").textContent = zhida ? "使用知乎开放平台提供的 Access Secret。" : "填写服务商提供的接口地址、模型 ID 和 API Key。";
}
function editProfile(id) {
  const item = profiles.items.find(item => item.id === id);
  $("#nameInput").value = item?.name || "";
  $("#providerInput").value = item?.provider || "zhida";
  $("#baseUrlInput").value = item?.baseURL || "";
  $("#modelInput").value = item?.model || "";
  $("#apiKeyInput").value = "";
  $("#apiKeyInput").placeholder = item && (profiles.localKeys[id] || profiles.sessionKeys[id]) ? "已保存密钥；留空保留，填写可替换" : "粘贴密钥";
  $("#rememberKeyInput").checked = item ? item.rememberKey : true;
  modelDirty = !item || id !== profiles.activeId;
  providerFields();
}
async function refreshProfiles(resetForm = false) {
  profiles = await readProfiles(api);
  const active = profiles.items.find(item => item.id === profiles.activeId);
  const key = active && (profiles.localKeys[active.id] || profiles.sessionKeys[active.id]);
  ready = Boolean(key);
  savedFingerprint = ready ? fingerprint(await activeModelConfig(api)) : "";
  if (verifiedFingerprint !== savedFingerprint) {
    verifiedFingerprint = "";
    $("#trialResult").classList.add("is-hidden");
    status("#trialStatus", "尚未验证当前模型。");
  }
  $("#trialModel").textContent = active ? `当前模型：${active.name} · ${active.model}` : "请先保存模型配置。";
  status("#modelStatus", ready ? `「${active.name}」已保存${verifiedFingerprint ? "，已验证可用。" : "，尚未验证实际调用。"}` : active ? `「${active.name}」缺少密钥，请在这里补充并保存。` : "请填写第一套模型配置。");
  if (resetForm) {
    $("#profileSelect").replaceChildren(new Option("新建配置", ""), ...profiles.items.map(item => new Option(item.name, item.id)));
    $("#profileSelect").value = active?.id || "";
    editProfile(active?.id || "");
  }
  setBusy(busy);
}
async function loadPreferences() {
  const style = await readQuestionStyle(api);
  $("#styleSelect").replaceChildren(new Option("专业 · 原因、证据与趋势", "professional"), new Option("日常 · 工作、消费与生活", "daily"),
    ...style.customStyles.map(item => new Option(item.name, item.id)), new Option("＋ 新建自定义风格", "__new"));
  $("#styleSelect").value = style.selected;
  $("#customFields").classList.add("is-hidden");
  $("#stylePrompt").required = false;
  const stored = await api.storage.local.get([DESCRIPTION_MODE_KEY, ATTACH_IMAGES_KEY]);
  $("#descriptionSelect").value = normalizeDescriptionMode(stored[DESCRIPTION_MODE_KEY]);
  $("#imagesInput").checked = stored[ATTACH_IMAGES_KEY] !== false;
  preferenceDirty = false;
}
$("#profileSelect").onchange = () => editProfile($("#profileSelect").value);
$("#guideModelForm").oninput = () => { modelDirty = true; };
$("#guideModelForm").onchange = () => { modelDirty = true; };
$("#providerInput").onchange = () => { $("#modelInput").value = ""; providerFields(); };
$("#guideModelForm").onsubmit = async event => {
  event.preventDefault();
  if (busy) return;
  const id = $("#profileSelect").value;
  const form = { id, name: $("#nameInput").value, provider: $("#providerInput").value, baseURL: $("#baseUrlInput").value,
    model: $("#modelInput").value, apiKey: $("#apiKeyInput").value, rememberKey: $("#rememberKeyInput").checked };
  try {
    const config = resolveConfig({ ...form, apiKey: form.apiKey.trim() || profiles.localKeys[id] || profiles.sessionKeys[id] });
    // Request permission in the submit gesture, before any storage await.
    const permission = api.permissions.request({ origins: [`${new URL(config.baseURL).origin}/*`] });
    setBusy(true);
    if (!await permission) throw new Error("未获得该 API 地址的访问权限，请允许后再保存。");
    await saveProfile(form, api);
    $("#apiKeyInput").value = "";
    modelDirty = false;
    await refreshProfiles(true);
    show(2);
  } catch (error) { status("#modelStatus", error.message || "保存失败，请重试。", true); }
  finally { setBusy(false); }
};
$("#preferencesForm").oninput = () => { preferenceDirty = true; };
$("#preferencesForm").onchange = () => { preferenceDirty = true; };
$("#styleSelect").onchange = () => {
  const custom = $("#styleSelect").value === "__new";
  $("#customFields").classList.toggle("is-hidden", !custom);
  $("#stylePrompt").required = custom;
};
$("#preferencesForm").onsubmit = async event => {
  event.preventDefault();
  if (busy) return;
  setBusy(true);
  try {
    const selected = $("#styleSelect").value;
    if (selected === "__new") {
      await saveCustomStyle(api, $("#styleName").value, $("#stylePrompt").value);
      // Refresh immediately so retrying another failed save never adds duplicates.
      const style = await readQuestionStyle(api);
      const saved = style.customStyles.find(item => item.id === style.selected);
      $("#styleSelect").add(new Option(saved.name, saved.id));
      $("#styleSelect").value = saved.id;
      $("#customFields").classList.add("is-hidden");
      $("#stylePrompt").required = false;
    } else await selectQuestionStyle(api, selected);
    await api.storage.local.set({ [DESCRIPTION_MODE_KEY]: $("#descriptionSelect").value, [ATTACH_IMAGES_KEY]: $("#imagesInput").checked });
    preferenceDirty = false;
    status("#preferencesStatus", "已保存，Dashboard 和网页面板会使用这些偏好。");
    show(3);
  } catch (error) { status("#preferencesStatus", error.message || "保存失败，请重试。", true); }
  finally { setBusy(false); }
};
$("#trialButton").onclick = async () => {
  if (busy || !ready) return;
  setBusy(true);
  verifiedFingerprint = "";
  $("#trialResult").classList.add("is-hidden");
  status("#trialStatus", "正在发送示例，等待模型生成…（通常需要几秒至一分钟）");
  try {
    const tested = fingerprint(await activeModelConfig(api));
    const reply = await api.runtime.sendMessage({ type: "GENERATE_ZHIHU_QUESTIONS", payload: {
      title: "示例：社区图书馆延长开放时间", url: "https://example.com/library-demo", mainText: $("#sampleText").textContent, selectedText: "", description: "教程示例材料，并非真实新闻。",
    } });
    if (!reply?.ok) throw new Error(reply?.error || "生成失败，请检查配置后重试。");
    const item = reply.data?.items?.[0];
    if (!item) throw new Error("模型未返回有效草稿，请换用其他模型后重试。");
    await refreshProfiles(false);
    if (savedFingerprint !== tested) throw new Error("配置已在其他页面变更，请重新验证当前模型。");
    verifiedFingerprint = tested;
    $("#trialTitle").textContent = item.question;
    $("#trialDescription").textContent = item.description;
    $("#trialTopics").textContent = `话题建议：${item.keywords.join("、")}`;
    $("#trialResult").classList.remove("is-hidden");
    status("#trialStatus", "验证成功，当前模型已返回提问草稿。下方预览其中一个。");
  } catch (error) { status("#trialStatus", error.message || "验证失败，请重试。", true); }
  finally { setBusy(false); }
};
$("#backButton").onclick = () => { if (!busy) show(index - 1); };
$("#nextButton").onclick = async () => {
  if (busy) return;
  if (index === 1 && (!ready || modelDirty)) { status("#navigationStatus", "请先在本页保存模型配置。", true); return; }
  if (index === 2 && preferenceDirty) { status("#navigationStatus", "请先保存刚刚修改的生成偏好。", true); return; }
  if (index < 4) { show(index + 1); return; }
  setBusy(true);
  try {
    await refreshProfiles(false);
    if (!ready) { show(1); throw new Error("请先补充模型密钥再完成教程。"); }
    await api.storage.local.set({ onboardingSeen: true });
    status("#navigationStatus", "设置完成！刷新文章页，点击「问」即可开始。");
    $("#nextButton").textContent = "已完成";
  } catch (error) { status("#navigationStatus", error.message || "保存完成状态失败，请重试。", true); }
  finally { setBusy(false); }
};
$("#faqToggle").onclick = () => {
  const hidden = $("#faq").classList.toggle("is-hidden");
  $("#faqToggle").textContent = hidden ? "遇到报错？查看常见问题" : "收起常见问题";
};
api?.storage?.onChanged.addListener(changes => {
  if ((changes.modelProfiles || changes.modelProfileKeys) && !busy) refreshProfiles(!modelDirty).catch(() => { ready = false; setBusy(false); });
});
show(0);
async function initialize() {
  try { await refreshProfiles(true); await loadPreferences(); }
  catch { status("#modelStatus", "读取配置失败，请从已安装扩展中重新打开教程。", true); }
}
initialize();
