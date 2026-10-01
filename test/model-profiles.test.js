import test from "node:test";
import assert from "node:assert/strict";
import { activeModelConfig, readProfiles, saveProfile, selectProfile, removeProfile } from "../extension/modelProfiles.js";
function mockChrome(local = {}, session = {}) {
  const area = (data) => ({ data, async get(keys) { return structuredClone(Object.fromEntries(keys.map(key => [key, data[key]]))); }, async set(values) { Object.assign(data, structuredClone(values)); }, async remove(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key]; }, async setAccessLevel(value) { this.accessLevel = value.accessLevel; } });
  return { storage: { local: area(local), session: area(session) } };
}
const form = { name: "测试模型", provider: "openai", baseURL: "https://api.example.com/v1", model: "model-1", apiKey: "test-key", rememberKey: true };
test("remembered keys survive a browser session restart without leaking into metadata", async () => {
  const api = mockChrome(); const id = await saveProfile(form, api);
  assert.equal(api.storage.local.accessLevel, "TRUSTED_CONTEXTS");
  assert.equal(JSON.stringify(api.storage.local.data.modelProfiles).includes("test-key"), false);
  const restarted = mockChrome(structuredClone(api.storage.local.data));
  assert.equal((await activeModelConfig(restarted)).apiKey, "test-key");
  assert.equal((await readProfiles(restarted)).activeId, id);
});
test("session-only keys are not written locally and disappear after restart", async () => {
  const api = mockChrome(); await saveProfile({ ...form, rememberKey: false }, api);
  assert.equal(JSON.stringify(api.storage.local.data).includes("test-key"), false);
  assert.equal((await activeModelConfig(api)).apiKey, "test-key");
  assert.equal((await activeModelConfig(mockChrome(api.storage.local.data))).apiKey, "");
});
test("switching profiles isolates credentials and deletion selects a remaining profile", async () => {
  const api = mockChrome(); const first = await saveProfile(form, api);
  const second = await saveProfile({ ...form, model: "model-2", apiKey: "another-key", rememberKey: false }, api);
  await selectProfile(first, api); assert.equal((await activeModelConfig(api)).apiKey, "test-key");
  await selectProfile(second, api); assert.equal((await activeModelConfig(api)).apiKey, "another-key");
  await removeProfile(second, api); assert.equal((await readProfiles(api)).activeId, first);
  assert.equal(api.storage.session.data.modelProfileKeys[second], undefined);
  await removeProfile(first, api); await assert.rejects(activeModelConfig(api), /添加/);
});
test("editing can retain or move a key but cannot silently reuse it on another domain", async () => {
  const api = mockChrome(); const id = await saveProfile(form, api);
  await saveProfile({ ...form, id, apiKey: "", model: "model-3", rememberKey: false }, api);
  assert.equal((await activeModelConfig(api)).apiKey, "test-key");
  assert.equal(api.storage.local.data.modelProfileKeys[id], undefined);
  await assert.rejects(saveProfile({ ...form, id, apiKey: "", baseURL: "https://other.example/v1" }, api), /新密钥/);
  assert.equal((await activeModelConfig(api)).baseURL, form.baseURL);
});
test("legacy settings retain session-only policy and discard unexpected credential fields", async () => {
  const api = mockChrome({ modelConfig: { ...form, apiKey: "should-not-leak" } }, { modelApiKey: "legacy-key" });
  const state = await readProfiles(api);
  assert.equal(state.items[0].rememberKey, false); assert.equal(state.items[0].apiKey, undefined);
  await selectProfile("legacy", api); assert.equal((await activeModelConfig(api)).apiKey, "legacy-key");
  await removeProfile("legacy", api); assert.equal((await readProfiles(api)).items.length, 0);
});
