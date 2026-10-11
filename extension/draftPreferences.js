export const DESCRIPTION_MODE_KEY = "descriptionMode";
export const MAX_ORIGINAL_LENGTH = 200000;
export const ZHIHU_DESCRIPTION_LIMIT = 3000;
export const normalizeDescriptionMode = value => value === "original" ? "original" : "summary";

export function normalizeSourceUrl(value) {
  try {
    if (typeof value !== "string" || value.length > 4096) return "";
    const url = new URL(value);
    if (!/^https?:$/.test(url.protocol) || url.username || url.password) return "";
    url.hash = "";
    return url.href;
  } catch { return ""; }
}
// Keep the joined text identical to zhihuComposer.buildDescription.
export function citationSuffix(source) {
  const url = normalizeSourceUrl(source);
  return url ? `\n\n引用来源：${url}` : "";
}
export function descriptionRoom(source) {
  return Math.max(0, ZHIHU_DESCRIPTION_LIMIT - citationSuffix(source).length);
}
export function clipDescriptionBody(text, room) {
  const sourceText = String(text || "").trim();
  if (room <= 0 || !sourceText) return "";
  if (sourceText.length <= room) return sourceText;
  const lines = sourceText.split("\n");
  let size = 0;
  const kept = [];
  for (const line of lines) {
    const extra = kept.length ? 1 : 0;
    if (size + extra + line.length > room) break;
    kept.push(line);
    size += extra + line.length;
  }
  if (kept.length) return kept.join("\n");
  const chunk = sourceText.slice(0, room);
  const end = Math.max(chunk.lastIndexOf("。"), chunk.lastIndexOf("！"), chunk.lastIndexOf("？"));
  return (end >= Math.floor(room * 0.6) ? chunk.slice(0, end + 1) : chunk).trimEnd();
}
export function fitDescriptionBody(description, source) {
  const text = String(description || "").trim();
  const url = normalizeSourceUrl(source);
  if (!url || text.includes(url)) return text.slice(0, ZHIHU_DESCRIPTION_LIMIT);
  return clipDescriptionBody(text, descriptionRoom(source));
}

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
  const room = descriptionRoom(page?.url);
  return item => {
    const raw = original ?? (typeof item.description === "string" ? item.description : "");
    const description = fitDescriptionBody(raw, page?.url);
    return { ...item, description, descriptionMode: mode,
      originalPartial: mode === "original" && page?.originalPartial === true,
      descriptionClipped: original != null && description.length < original.length,
      descriptionLimit: room };
  };
}
