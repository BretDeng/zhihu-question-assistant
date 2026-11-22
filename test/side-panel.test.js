import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { test } from "node:test";
import * as draftPreferences from "../extension/draftPreferences.js";
import * as styles from "../extension/questionStyles.js";
import * as siteRules from "../extension/siteRules.js";

const source = await readFile(new URL("../extension/serviceWorker.js", import.meta.url), "utf8");
const SIDE_PANEL = { url: "chrome-extension://id/sidepanel.html" };

function worker({ stored = {}, generate } = {}) {
  let listener, tabRemoved, storageChanged;
  const runtimeMessages = [], tabMessages = [], actions = [];
  const chrome = {
    runtime: { getURL: path => `chrome-extension://id/${path}`, onMessage: { addListener(fn) { listener = fn; } }, sendMessage: async message => { runtimeMessages.push(message); } },
    storage: { local: { get: async () => ({ ...stored }) }, session: { remove: async () => {} }, onChanged: { addListener(fn) { storageChanged = fn; } } },
    tabs: { onRemoved: { addListener(fn) { tabRemoved = fn; } }, query: async () => [{ id: 3 }], sendMessage: async (tabId, message) => { tabMessages.push({ tabId, message }); } },
    action: { setPopup: async value => { actions.push(["popup", value.popup]); } },
    sidePanel: { setPanelBehavior: async value => { actions.push(["side", value.openPanelOnActionClick]); } },
  };
  vm.runInNewContext(source.replace(/^import .*?;\n/gm, ""), { ...draftPreferences, ...styles, ...siteRules, chrome, URL, Error, setTimeout, clearTimeout, AbortController, setInterval: () => 1, clearInterval() {},
    activeModelConfig: async () => ({ apiKey: "fixture" }), generateQuestions: generate });
  const send = (message, sender) => new Promise(resolve => { if (listener(message, sender, resolve) !== true) resolve(undefined); });
  return { send, runtimeMessages, tabMessages, actions, closeTab: id => tabRemoved(id), changeStorage: changes => storageChanged(changes, "local") };
}
const item = { question: "问题？", description: "描述", keywords: ["话题"] };

test("the side panel runs for a named tab, gets progress by runtime message, and the tab's close stops it", async () => {
  const signals = [];
  const bg = worker({ generate: (_page, _config, _fetch, { onItem, signal }) => new Promise((_resolve, reject) => {
    signals.push(signal);
    onItem(item, 0);
    signal.addEventListener("abort", () => reject(new Error("已停止生成。")));
  }) });
  const pending = bg.send({ type: "GENERATE_ZHIHU_QUESTIONS", requestId: "r1", tabId: 12, payload: { url: "https://example.com/a" } }, SIDE_PANEL);
  while (!signals.length) await new Promise(resolve => setTimeout(resolve, 1));
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(bg.runtimeMessages[0].type, "ZH_QUESTION_PROGRESS");
  assert.equal(bg.runtimeMessages[0].requestId, "r1");
  assert.equal(bg.tabMessages.length, 0, "progress is not sent into the page");
  // A page's content script cannot name another tab to stop its run.
  await bg.send({ type: "CANCEL_ZHIHU_QUESTIONS", requestId: "r1", tabId: 12 }, { tab: { id: 99 }, url: "https://evil.example/" });
  assert.equal(signals[0].aborted, false);
  bg.closeTab(12);
  assert.equal((await pending).error, "已停止生成。");
});

test("the side panel's stop button cancels by tab and request id", async () => {
  const signals = [];
  const bg = worker({ generate: (_page, _config, _fetch, { signal }) => new Promise((_resolve, reject) => {
    signals.push(signal);
    signal.addEventListener("abort", () => reject(new Error("已停止生成。")));
  }) });
  const pending = bg.send({ type: "GENERATE_ZHIHU_QUESTIONS", requestId: "r2", tabId: 4, payload: { url: "https://example.com/a" } }, SIDE_PANEL);
  while (!signals.length) await new Promise(resolve => setTimeout(resolve, 1));
  await bg.send({ type: "CANCEL_ZHIHU_QUESTIONS", requestId: "r2", tabId: 4 }, SIDE_PANEL);
  assert.equal((await pending).error, "已停止生成。");
});

test("side panel runs respect the site filter for the page they read", async () => {
  const bg = worker({ stored: { excludedSites: ["example.com"] }, generate: async () => assert.fail("must not generate") });
  const reply = await bg.send({ type: "GENERATE_ZHIHU_QUESTIONS", requestId: "r3", tabId: 4, payload: { url: "https://news.example.com/a" } }, SIDE_PANEL);
  assert.match(reply.error, /已停用插件/);
});

test("switching the display mode re-points the toolbar icon and tells every page", async () => {
  const bg = worker();
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.deepEqual(bg.actions, [["popup", "popup.html"], ["side", false]], "default is the floating bubble");
  bg.changeStorage({ panelMode: { newValue: "sidePanel" } });
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.deepEqual(bg.actions.slice(2), [["popup", ""], ["side", true]]);
  assert.deepEqual(JSON.parse(JSON.stringify(bg.tabMessages)), [{ tabId: 3, message: { type: "PANEL_MODE_CHANGED", mode: "sidePanel" } }]);
});
