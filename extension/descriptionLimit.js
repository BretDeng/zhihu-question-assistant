// Single source of truth for Zhihu's 3,000-character description field.
// Loaded as a plain content script and re-exported by draftPreferences.js, so
// the panel, the background worker and the Zhihu editor clip text identically.
globalThis.ZhihuDescriptionLimit ||= (() => {
  const ZHIHU_DESCRIPTION_LIMIT = 3000;
  const CITATION_LABEL = "引用来源：";

  function normalizeSourceUrl(value) {
    try {
      if (typeof value !== "string" || value.length > 4096) return "";
      const url = new URL(value);
      if (!/^https?:$/.test(url.protocol) || url.username || url.password) return "";
      url.hash = "";
      return url.href.length + CITATION_LABEL.length + 2 <= ZHIHU_DESCRIPTION_LIMIT ? url.href : "";
    } catch { return ""; }
  }
  function citationSuffix(source) {
    const url = normalizeSourceUrl(source);
    return url ? `\n\n${CITATION_LABEL}${url}` : "";
  }
  function descriptionRoom(source) {
    return Math.max(0, ZHIHU_DESCRIPTION_LIMIT - citationSuffix(source).length);
  }
  // Prefer whole paragraphs, then sentence endings. Keep URLs intact when
  // falling back to a character boundary in a single long paragraph.
  function clipDescriptionBody(text, room) {
    const sourceText = String(text || "").trim();
    if (room <= 0 || !sourceText) return "";
    if (sourceText.length <= room) return sourceText;
    const kept = [];
    let size = 0;
    for (const line of sourceText.split("\n")) {
      const extra = kept.length ? 1 : 0;
      if (size + extra + line.length > room) break;
      kept.push(line);
      size += extra + line.length;
    }
    if (kept.length) return kept.join("\n");
    const chunk = sourceText.slice(0, room);
    const end = Math.max(chunk.lastIndexOf("。"), chunk.lastIndexOf("！"), chunk.lastIndexOf("？"));
    let result = (end >= Math.floor(room * 0.6) ? chunk.slice(0, end + 1) : chunk).trimEnd();
    for (const match of sourceText.matchAll(/https?:\/\/[^\s<>]+/g)) {
      if (match.index >= result.length) break;
      if (match.index + match[0].length > result.length) {
        result = result.slice(0, match.index).trimEnd();
        break;
      }
    }
    return result;
  }
  // The body alone, sized so the citation still fits.
  function fitDescriptionBody(description, source) {
    const text = String(description || "").trim();
    const url = normalizeSourceUrl(source);
    if (!url) return clipDescriptionBody(text, ZHIHU_DESCRIPTION_LIMIT);
    if (text.includes(url)) {
      const clipped = clipDescriptionBody(text, ZHIHU_DESCRIPTION_LIMIT);
      if (clipped.includes(url)) return clipped;
    }
    return clipDescriptionBody(text, descriptionRoom(source));
  }
  // The final editor value includes the source URL within the same limit.
  function buildDescription(description, source) {
    const text = fitDescriptionBody(description, source);
    const url = normalizeSourceUrl(source);
    if (!url || text.includes(url)) return text;
    const suffix = citationSuffix(source);
    const body = clipDescriptionBody(text, ZHIHU_DESCRIPTION_LIMIT - suffix.length);
    if (!body) return `${CITATION_LABEL}${url}`;
    return `${body}${suffix}`;
  }
  return Object.freeze({ ZHIHU_DESCRIPTION_LIMIT, normalizeSourceUrl, citationSuffix,
    descriptionRoom, clipDescriptionBody, fitDescriptionBody, buildDescription });
})();
