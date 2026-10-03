export const DESCRIPTION_MODE_KEY = "descriptionMode";
export const MAX_ORIGINAL_LENGTH = 200000;
export const normalizeDescriptionMode = value => value === "original" ? "original" : "summary";

export async function readDescriptionMode(chromeApi) {
  const stored = await chromeApi.storage.local.get(DESCRIPTION_MODE_KEY);
  return normalizeDescriptionMode(stored[DESCRIPTION_MODE_KEY]);
}

export function originalDescription(text) {
  if (typeof text !== "string") throw new Error("未抓取到网页正文，请刷新网页后重试。");
  // Keep wording, punctuation, order and repeated paragraphs. Only compact
  // blank lines and line-edge whitespace; never apply model typography rules.
  const result = text.replace(/\u0000/g, "").replace(/\r\n?/g, "\n").split("\n").map(line => line.trim()).filter(Boolean).join("\n");
  if (!result) throw new Error("未抓取到网页正文，无法使用网页原文模式。");
  if (result.length > MAX_ORIGINAL_LENGTH) throw new Error("网页正文超过 20 万字符，无法完整保存。请改用概括提问模式；原文未被截断或发送给模型。");
  return result;
}

export function prepareDescription(mode, page) {
  if (mode === "original" && page?.originalUnavailableReason) throw new Error(page.originalUnavailableReason);
  const original = mode === "original" ? originalDescription(page?.mainText) : null;
  return item => ({ ...item, description: original ?? item.description, descriptionMode: mode,
    originalPartial: mode === "original" && page?.originalPartial === true,
    descriptionLimit: mode === "original" ? MAX_ORIGINAL_LENGTH : 3000 });
}
