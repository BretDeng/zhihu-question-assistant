import { readProfiles } from "./modelProfiles.js";
import { DESCRIPTION_MODE_KEY, readDescriptionMode } from "./draftPreferences.js";
import { renderFaq } from "./faq.js";
const theme = document.createElement("style");
theme.textContent = globalThis.ZhihuUiTheme;
document.head.append(theme);
const $ = (selector) => document.querySelector(selector);
let hasProfile = false;
renderFaq($("#faqList"), $("#faqSearch"));

function setCheck(id, done, text) {
  const item = $(id);
  item.dataset.state = done ? "done" : "todo";
  item.querySelector("small").textContent = text;
}
async function refresh() {
  try {
    const state = await readProfiles();
    const active = state.items.find((item) => item.id === state.activeId);
    hasProfile = state.items.length > 0;
    setCheck("#checkModel", Boolean(active), active ? `正在使用「${active.name}」（${active.model}）` : "还没有模型配置，点「打开模型设置」添加。");
    const key = active && (state.localKeys[active.id] || state.sessionKeys[active.id]);
    setCheck("#checkKey", Boolean(key), !active ? "添加配置时一并填写密钥。" : key ? (active.rememberKey ? "已保存在本机。" : "仅保留到浏览器关闭。") : "当前配置缺少密钥，请编辑配置重新填写。");
  } catch { setCheck("#checkModel", false, "读取配置失败，请刷新本页。"); }
  try {
    const mode = await readDescriptionMode(chrome);
    setCheck("#checkMode", true, mode === "original" ? "网页原文：描述使用网页已加载的正文。" : "概括提问：由模型撰写精简的背景和讨论点。");
  } catch { setCheck("#checkMode", false, "读取失败，请刷新本页。"); }
}
chrome.storage.onChanged.addListener((changes) => {
  if (changes.modelProfiles || changes.modelProfileKeys || changes[DESCRIPTION_MODE_KEY]) refresh();
});
refresh();

$("#openSettingsButton").onclick = () => chrome.tabs.create({ url: chrome.runtime.getURL(`popup.html?view=dashboard${hasProfile ? "" : "&add=1"}`) });
$("#doneButton").onclick = async () => {
  await chrome.storage.local.set({ onboardingSeen: true }).catch(() => {});
  $("#doneButton").textContent = "已完成，去任意网页点「问」试试吧";
};
