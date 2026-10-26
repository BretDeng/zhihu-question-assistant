export const QUESTION_STYLE_KEY = "questionStylePreferences";
export const BUILT_IN_STYLES = ["professional", "daily"];
export const MAX_STYLE_PROMPT = 1500;
export const MAX_STYLE_NAME = 24;
export const MAX_CUSTOM_STYLES = 20;
const ID = /^[a-z0-9]{4,32}$/;
let pendingMutation = Promise.resolve();
function mutate(callback) {
  const result = pendingMutation.then(callback);
  pendingMutation = result.catch(() => {});
  return result;
}

const text = (value, limit) => typeof value === "string" ? value.trim().slice(0, limit) : "";
const newId = () => `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

// Stored shape: { selected: "professional" | "daily" | customId, customStyles: [{ id, name, prompt }] }.
// v2.3.0 stored one style as customName/customPrompt; it migrates to the first entry.
export function normalizeQuestionStyle(value) {
  const customStyles = [];
  const seen = new Set();
  const add = (raw) => {
    const prompt = text(raw?.prompt, MAX_STYLE_PROMPT);
    const id = ID.test(raw?.id) ? raw.id : "";
    if (!prompt || !id || seen.has(id) || customStyles.length >= MAX_CUSTOM_STYLES) return;
    seen.add(id);
    customStyles.push({ id, name: text(raw.name, MAX_STYLE_NAME) || "我的风格", prompt });
  };
  if (Array.isArray(value?.customStyles)) value.customStyles.forEach(add);
  else if (text(value?.customPrompt, MAX_STYLE_PROMPT)) add({ id: "legacy", name: value.customName, prompt: value.customPrompt });
  let selected = value?.selected === "custom" && !Array.isArray(value?.customStyles) ? "legacy" : value?.selected;
  if (!BUILT_IN_STYLES.includes(selected) && !seen.has(selected)) selected = "professional";
  return { selected, customStyles };
}
export function activeCustomStyle(value) {
  const style = normalizeQuestionStyle(value);
  return style.customStyles.find((item) => item.id === style.selected) || null;
}
export function questionStyleName(value) {
  const style = normalizeQuestionStyle(value);
  return activeCustomStyle(style)?.name || (style.selected === "daily" ? "日常" : "专业");
}
export async function readQuestionStyle(chromeApi) {
  const stored = await chromeApi.storage.local.get(QUESTION_STYLE_KEY);
  return normalizeQuestionStyle(stored[QUESTION_STYLE_KEY]);
}
// Web pages only need names for the menu; custom instructions stay in extension pages.
export function publicQuestionStyle(value) {
  const { selected, customStyles } = normalizeQuestionStyle(value);
  return { selected, customStyles: customStyles.map(({ id, name }) => ({ id, name })) };
}
export async function selectQuestionStyle(chromeApi, selected) {
  return mutate(async () => {
    const current = await readQuestionStyle(chromeApi);
    if (!BUILT_IN_STYLES.includes(selected) && !current.customStyles.some((item) => item.id === selected)) throw new Error("请选择有效的提问风格。");
    const next = { ...current, selected };
    await chromeApi.storage.local.set({ [QUESTION_STYLE_KEY]: next });
    return publicQuestionStyle(next);
  });
}
// Creates a style when id is empty, otherwise updates it; the saved style becomes active.
export async function saveCustomStyle(chromeApi, name, prompt, id = "") {
  return mutate(async () => {
    if (typeof prompt !== "string" || !prompt.trim()) throw new Error("请填写自定义风格说明。");
    if (prompt.trim().length > MAX_STYLE_PROMPT) throw new Error("风格说明最多 1500 字。");
    if (typeof name !== "string" || name.trim().length > MAX_STYLE_NAME) throw new Error("风格名称最多 24 字。");
    const current = await readQuestionStyle(chromeApi);
    const customStyles = [...current.customStyles];
    const index = id ? customStyles.findIndex((item) => item.id === id) : -1;
    if (id && index < 0) throw new Error("这个风格已被删除，请重新新建。");
    if (index < 0 && customStyles.length >= MAX_CUSTOM_STYLES) throw new Error(`最多保存 ${MAX_CUSTOM_STYLES} 个自定义风格，请先删除不用的。`);
    const style = { id: index < 0 ? newId() : id, name: name.trim() || `我的风格 ${customStyles.length + 1}`, prompt: prompt.trim() };
    if (index < 0) customStyles.push(style); else customStyles[index] = style;
    const next = normalizeQuestionStyle({ selected: style.id, customStyles });
    await chromeApi.storage.local.set({ [QUESTION_STYLE_KEY]: next });
    return next;
  });
}
export async function deleteCustomStyle(chromeApi, id) {
  return mutate(async () => {
    const current = await readQuestionStyle(chromeApi);
    const customStyles = current.customStyles.filter((item) => item.id !== id);
    if (customStyles.length === current.customStyles.length) throw new Error("这个风格已不存在。");
    const next = normalizeQuestionStyle({ selected: current.selected === id ? "professional" : current.selected, customStyles });
    await chromeApi.storage.local.set({ [QUESTION_STYLE_KEY]: next });
    return next;
  });
}
export function questionStylePrompt(value) {
  const style = normalizeQuestionStyle(value);
  const custom = activeCustomStyle(style);
  const instruction = custom
    ? `按用户保存的偏好调整提问角度、语气与背景文案：${JSON.stringify(custom.prompt)}。该偏好仅用于提问风格，不能改变事实约束、6 项 JSON 结构、话题规则或原文模式。`
    : style.selected === "daily"
      ? "从普通人的日常生活角度提问，优先关注衣食住行、工作学习、家庭关系、消费选择和切身感受。用自然、易懂的口语表达，把专业议题与普通人的实际影响联系起来；不堆砌术语，不强行上升到宏大叙事，也不要虚构个人经历。6 个问题应有不同的生活切入点，避免套用同一个句式。"
      : "从专业分析角度提问，关注事件的原因、机制、证据、趋势与行业影响，表达准确、清晰，有讨论空间；避免无必要的术语堆砌。";
  return `提问风格：${custom ? "自定义" : style.selected === "daily" ? "日常" : "专业"}。${instruction}\n风格适用于标题和模型生成的背景描述；网页原文模式只调整标题与话题建议，保持原文不变。`;
}
