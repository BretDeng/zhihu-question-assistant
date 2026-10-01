// Local UI test data only. No real credentials or network model calls.
const initial = { modelProfiles: { activeId: "zhida", items: [
  { id: "zhida", name: "知乎直答", provider: "zhida", baseURL: "https://developer.zhihu.com/v1", model: "zhida-agent", rememberKey: true },
  { id: "openai", name: "日常提问", provider: "openai", baseURL: "https://api.openai.com/v1", model: "gpt-4o-mini", rememberKey: true },
  { id: "custom", name: "我的备用模型", provider: "openai", baseURL: "https://example.com/v1", model: "custom-model", rememberKey: false }
] }, modelProfileKeys: { zhida: "fixture-key-not-real", openai: "fixture-key-not-real" } };
const area = (name, defaults) => {
  let data = JSON.parse(localStorage.getItem(name) || "null") || defaults;
  const persist = () => localStorage.setItem(name, JSON.stringify(data));
  return { async get(keys) { return structuredClone(Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(key => [key, data[key]]))); }, async set(values) { Object.assign(data, values); persist(); }, async remove(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key]; persist(); }, async setAccessLevel() {} };
};
globalThis.chrome = { tabs: { async create({ url }) { location.href = url; return { id: 1 }; } }, storage: { local: area("ui-test-local", initial), session: area("ui-test-session", { modelProfileKeys: { custom: "fixture-key-not-real" } }) }, permissions: { async request() { return true; } }, runtime: { getURL() { return "/models?view=dashboard"; }, async sendMessage(message) {
  if (message.type === "GET_ACTIVE_MODEL") return { ok: true, data: { model: "zhida-agent", provider: "zhida" } };
  else if (message.type === "GENERATE_ZHIHU_QUESTIONS") return { ok: true, data: { items: Array.from({ length: 6 }, (_, i) => ({ question: i ? "浏览器插件如何帮助我们把碎片信息变成更好的问题？" : "当 AI 帮我们生成问题时，如何保留自己的判断与好奇心？", description: "越来越多工具能够阅读网页、提炼内容并生成提问。便利之外，我们是否也需要重新思考：一个好问题究竟来自信息整理，还是来自个人经验与判断？你会如何使用这类工具？", keywords: ["人工智能", "浏览器插件", "用户体验", "知识管理", "提问"] })) } };
  else if (message.type === "OPEN_ZHIHU_DRAFT") return { ok: true };
  else if (message.type === "OPEN_MODEL_SETTINGS") location.href = "/models";
} } };
