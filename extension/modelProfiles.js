import { resolveConfig } from "./modelClient.js";
const PROFILES = "modelProfiles";
const KEYS = "modelProfileKeys";
// Every write is read-modify-write of the whole profile set. Serialize writes
// in this page and, via Web Locks, across the popup, dashboard and worker.
let writeQueue = Promise.resolve();
function exclusive(task) {
  const run = () => globalThis.navigator?.locks ? navigator.locks.request("zh-qa-model-profiles", task) : task();
  const result = writeQueue.then(run, run);
  writeQueue = result.catch(() => {});
  return result;
}
export const saveProfile = (form, chromeApi = chrome) => exclusive(() => saveProfileNow(form, chromeApi));
export const selectProfile = (id, chromeApi = chrome) => exclusive(() => selectProfileNow(id, chromeApi));
export const removeProfile = (id, chromeApi = chrome) => exclusive(() => removeProfileNow(id, chromeApi));
export async function restrictStorage(chromeApi = chrome) {
  await chromeApi.storage.local.setAccessLevel?.({ accessLevel: "TRUSTED_CONTEXTS" });
}
export async function readProfiles(chromeApi = chrome) {
  await restrictStorage(chromeApi);
  const local = await chromeApi.storage.local.get([PROFILES, KEYS, "modelConfig"]);
  const session = await chromeApi.storage.session.get([KEYS, "modelApiKey"]);
  const state = local[PROFILES];
  if (state && Array.isArray(state.items)) return { activeId: state.activeId, items: state.items, localKeys: local[KEYS] || {}, sessionKeys: session[KEYS] || {} };
  const old = local.modelConfig;
  const items = old?.provider && old.provider !== "codex-cli" ? [{ id: "legacy", name: old.provider === "zhida" ? "知乎直答" : "我的 API", provider: old.provider, baseURL: old.baseURL, model: old.model, rememberKey: false }] : [];
  return { activeId: items[0]?.id || null, items, localKeys: {}, sessionKeys: session.modelApiKey ? { legacy: session.modelApiKey } : {} };
}
export async function activeModelConfig(chromeApi = chrome) {
  const state = await readProfiles(chromeApi);
  const item = state.items.find((profile) => profile.id === state.activeId);
  if (!item) throw new Error("请先在模型面板添加并启用一套模型配置。");
  return { provider: item.provider, baseURL: item.baseURL, model: item.model, apiKey: state.localKeys[item.id] || state.sessionKeys[item.id] || "" };
}
async function saveProfileNow(form, chromeApi = chrome) {
  const state = await readProfiles(chromeApi);
  const existing = state.items.find((item) => item.id === form.id);
  const id = existing?.id || crypto.randomUUID();
  const apiKey = form.apiKey?.trim() || state.localKeys[id] || state.sessionKeys[id] || "";
  const config = resolveConfig({ ...form, apiKey });
  if (existing && !form.apiKey?.trim() && new URL(resolveConfig({ ...existing, apiKey }).baseURL).origin !== new URL(config.baseURL).origin) throw new Error("API 域名已改变，请填写对应服务的新密钥。");
  const item = { id, name: String(form.name || config.model).trim().slice(0, 60), provider: config.provider, baseURL: config.baseURL, model: config.model, rememberKey: Boolean(form.rememberKey) };
  if (state.items.length >= 20 && !existing) throw new Error("最多保存 20 套模型配置。");
  state.items = existing ? state.items.map((value) => value.id === id ? item : value) : [...state.items, item];
  delete state.localKeys[id]; delete state.sessionKeys[id];
  (item.rememberKey ? state.localKeys : state.sessionKeys)[id] = config.apiKey;
  await chromeApi.storage.session.set({ [KEYS]: state.sessionKeys });
  await chromeApi.storage.local.set({ [PROFILES]: { activeId: id, items: state.items }, [KEYS]: state.localKeys });
  await chromeApi.storage.local.remove("modelConfig"); await chromeApi.storage.session.remove("modelApiKey");
  return id;
}
async function selectProfileNow(id, chromeApi = chrome) {
  const state = await readProfiles(chromeApi);
  if (!state.items.some((item) => item.id === id)) throw new Error("模型配置已不存在，请刷新面板。");
  await chromeApi.storage.session.set({ [KEYS]: state.sessionKeys });
  await chromeApi.storage.local.set({ [PROFILES]: { activeId: id, items: state.items }, [KEYS]: state.localKeys });
}
async function removeProfileNow(id, chromeApi = chrome) {
  const state = await readProfiles(chromeApi);
  state.items = state.items.filter((item) => item.id !== id);
  delete state.localKeys[id]; delete state.sessionKeys[id];
  const activeId = state.activeId === id ? state.items[0]?.id || null : state.activeId;
  await chromeApi.storage.session.set({ [KEYS]: state.sessionKeys });
  await chromeApi.storage.local.set({ [PROFILES]: { activeId, items: state.items }, [KEYS]: state.localKeys });
  await chromeApi.storage.local.remove("modelConfig"); await chromeApi.storage.session.remove("modelApiKey");
}
