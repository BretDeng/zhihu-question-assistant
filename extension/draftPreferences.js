import "./descriptionLimit.js";

export const DESCRIPTION_MODE_KEY = "descriptionMode";
export const MAX_ORIGINAL_LENGTH = 200000;
export const normalizeDescriptionMode = value => value === "original" ? "original" : "summary";

// Clipping lives in descriptionLimit.js so the panel, this worker and the
// Zhihu editor cannot drift apart. Re-exported here for the module consumers.
export const { ZHIHU_DESCRIPTION_LIMIT, normalizeSourceUrl, citationSuffix,
  descriptionRoom, clipDescriptionBody, fitDescriptionBody, finishQuestion } = globalThis.ZhihuDescriptionLimit;
export const ATTACH_IMAGES_KEY = "attachImages";
export const MAX_DRAFT_IMAGES = 6;

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
  // The draft is clipped to Zhihu's 3,000-character limit anyway, so a very
  // long page is not a failure. Bound the text we carry instead of refusing.
  return result.slice(0, MAX_ORIGINAL_LENGTH);
}

export function prepareDescription(mode, page) {
  if (mode === "original" && page?.originalUnavailableReason) throw new Error(page.originalUnavailableReason);
  const original = mode === "original" ? originalDescription(page?.mainText) : null;
  const room = descriptionRoom(page?.url);
  const fittedOriginal = original == null ? null : fitDescriptionBody(original, page?.url);
  return item => {
    const raw = original ?? (typeof item.description === "string" ? item.description : "");
    const description = fittedOriginal ?? fitDescriptionBody(raw, page?.url);
    return { ...item, description, descriptionMode: mode,
      originalPartial: mode === "original" && page?.originalPartial === true,
      descriptionClipped: original != null && description.length < original.length,
      descriptionLimit: room };
  };
}
