export const SITE_RULES_KEY = "excludedSites";

export function normalizeSite(value) {
  const text = String(value || "").trim();
  if (!text || /\s|\*/.test(text)) throw new Error("请输入域名或完整网址，不使用空格或通配符。");
  let url;
  try { url = new URL(text.includes("://") ? text : `https://${text}`); }
  catch { throw new Error("网址格式不正确，请填写例如 example.com。"); }
  if (!/^https?:$/.test(url.protocol) || url.username || url.password) throw new Error("仅支持 HTTP/HTTPS 网站，不包含用户名或密码。");
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!host || host.length > 253 || (!host.startsWith("[") && !host.split(".").every(part => /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(part)))) {
    throw new Error("域名格式不正确。");
  }
  return host;
}

export function parseSites(text) {
  const sites = [...new Set(String(text || "").split(/\r?\n/).map(line => line.trim()).filter(Boolean).map(normalizeSite))];
  if (sites.length > 200) throw new Error("最多设置 200 个排除域名。");
  return sites;
}

export function isSiteExcluded(url, sites = []) {
  let host;
  try { host = new URL(url).hostname.toLowerCase().replace(/\.$/, ""); } catch { return false; }
  return Array.isArray(sites) && sites.some(site => {
    if (typeof site !== "string") return false;
    return host === site || host.endsWith(`.${site}`);
  });
}
