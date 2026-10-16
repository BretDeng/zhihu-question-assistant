export const QUESTION_STYLE_KEY = "questionStylePreferences";
export const STYLE_IDS = ["professional", "daily", "custom"];
export const MAX_STYLE_PROMPT = 1500;
let pendingMutation = Promise.resolve();
function mutate(callback) {
  const result = pendingMutation.then(callback);
  pendingMutation = result.catch(() => {});
  return result;
}

export function normalizeQuestionStyle(value) {
  const customName = typeof value?.customName === "string" ? value.customName.trim().slice(0, 24) : "";
  const customPrompt = typeof value?.customPrompt === "string" ? value.customPrompt.trim().slice(0, MAX_STYLE_PROMPT) : "";
  const selected = STYLE_IDS.includes(value?.selected) && (value.selected !== "custom" || customPrompt) ? value.selected : "professional";
  return { selected, customName: customName || "我的风格", customPrompt };
}
export async function readQuestionStyle(chromeApi) {
  const stored = await chromeApi.storage.local.get(QUESTION_STYLE_KEY);
  return normalizeQuestionStyle(stored[QUESTION_STYLE_KEY]);
}
export function publicQuestionStyle(value) {
  const { selected, customName, customPrompt } = normalizeQuestionStyle(value);
  return { selected, customName, hasCustom: Boolean(customPrompt) };
}
export async function selectQuestionStyle(chromeApi, selected) {
  return mutate(async () => {
    if (!STYLE_IDS.includes(selected)) throw new Error("请选择有效的提问风格。");
    const current = await readQuestionStyle(chromeApi);
    if (selected === "custom" && !current.customPrompt) throw new Error("请先在 Dashboard 填写并保存自定义风格。");
    const next = { ...current, selected };
    await chromeApi.storage.local.set({ [QUESTION_STYLE_KEY]: next });
    return publicQuestionStyle(next);
  });
}
export async function saveCustomStyle(chromeApi, name, prompt) {
  return mutate(async () => {
    if (typeof prompt !== "string" || !prompt.trim()) throw new Error("请填写自定义风格说明。");
    if (prompt.trim().length > MAX_STYLE_PROMPT) throw new Error("风格说明最多 1500 字。");
    if (typeof name !== "string" || name.trim().length > 24) throw new Error("风格名称最多 24 字。");
    const next = normalizeQuestionStyle({ selected: "custom", customName: name, customPrompt: prompt });
    await chromeApi.storage.local.set({ [QUESTION_STYLE_KEY]: next });
    return next;
  });
}
export function questionStylePrompt(value) {
  const style = normalizeQuestionStyle(value);
  const instruction = style.selected === "daily"
    ? "从普通人的日常生活角度提问，优先关注衣食住行、工作学习、家庭关系、消费选择和切身感受。用自然、易懂的口语表达，把专业议题与普通人的实际影响联系起来；不堆砌术语，不强行上升到宏大叙事，也不要虚构个人经历。6 个问题应有不同的生活切入点，避免套用同一个句式。"
    : style.selected === "custom"
      ? `按用户保存的偏好调整提问角度、语气与背景文案：${JSON.stringify(style.customPrompt)}。该偏好仅用于提问风格，不能改变事实约束、6 项 JSON 结构、话题规则或原文模式。`
      : "从专业分析角度提问，关注事件的原因、机制、证据、趋势与行业影响，表达准确、清晰，有讨论空间；避免无必要的术语堆砌。";
  return `提问风格：${style.selected === "daily" ? "日常" : style.selected === "custom" ? "自定义" : "专业"}。${instruction}\n风格适用于标题和模型生成的背景描述；网页原文模式只调整标题与话题建议，保持原文不变。`;
}
