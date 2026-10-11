import { readProfiles } from "./modelProfiles.js";
import { renderFaq } from "./faq.js";
const theme = document.createElement("style");
theme.textContent = globalThis.ZhihuUiTheme;
document.head.append(theme);
const extension = globalThis.chrome;
const $ = (selector) => document.querySelector(selector);
const cards = [...document.querySelectorAll(".step-card")];
let index = 0;
let hasProfile = false;
renderFaq($("#faqList"), $("#faqSearch"));

function show(next) {
  index = Math.max(0, Math.min(cards.length - 1, next));
  cards.forEach((card, item) => card.classList.toggle("is-current", item === index));
  $("#stepProgress").textContent = `第 ${index + 1} 步，共 ${cards.length} 步`;
  $("#backButton").disabled = index === 0;
  $("#nextButton").textContent = index === cards.length - 1 ? "完成，开始使用" : "下一步";
}
async function refreshModelStatus() {
  const status = $("#modelStatus");
  if (!extension?.storage) { status.textContent = "打开扩展里的教程时，这里会显示模型是否已经配好。"; return; }
  try {
    const state = await readProfiles();
    const active = state.items.find((item) => item.id === state.activeId);
    hasProfile = state.items.length > 0;
    const key = active && (state.localKeys[active.id] || state.sessionKeys[active.id]);
    status.textContent = !active ? "还没有模型。点上面的按钮添加。" : key ? `已经可以使用「${active.name}」。可以下一步。` : `「${active.name}」还缺密钥，点上面的按钮去填写。`;
  } catch { status.textContent = "暂时读不到配置。可以先下一步，稍后再打开模型设置。"; }
}
show(0);
refreshModelStatus();
extension?.storage?.onChanged.addListener((changes) => { if (changes.modelProfiles || changes.modelProfileKeys) refreshModelStatus(); });

$("#backButton").onclick = () => show(index - 1);
$("#nextButton").onclick = async () => {
  if (index < cards.length - 1) { show(index + 1); return; }
  await extension?.storage?.local.set({ onboardingSeen: true }).catch(() => {});
  $("#nextButton").textContent = "好了，去文章页点「问」";
  $("#nextButton").disabled = true;
};
$("#openSettingsButton").onclick = () => extension?.tabs?.create({ url: extension.runtime.getURL(`popup.html?view=dashboard${hasProfile ? "" : "&add=1"}`) });
$("#faqToggle").onclick = () => {
  const faq = $("#faq");
  const hidden = faq.classList.toggle("is-hidden");
  $("#faqToggle").textContent = hidden ? "遇到报错？查看常见问题" : "收起常见问题";
  if (!hidden) faq.scrollIntoView({ behavior: "smooth", block: "nearest" });
};
