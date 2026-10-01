import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { test } from "node:test";

const source = await readFile(new URL("../extension/zhihuTopics.js", import.meta.url), "utf8");
function fixture({ existing = [], candidates = {}, query = "", edited = false, accepts = true } = {}) {
  const bound = [...existing];
  const searched = [];
  const clicked = [];
  let opened = false;
  let options = [];
  let time = 0;
  const rectangle = () => ({ width: 80, height: 30 });
  class Input {
    constructor() { this._value = query; this.isConnected = true; }
    get value() { return this._value; }
    set value(value) { this._value = value; }
    getBoundingClientRect() { return opened ? rectangle() : { width: 0, height: 0 }; }
    getAttribute() { return "AutoComplete19-0"; }
    focus() {}
    blur() {}
    dispatchEvent(event) {
      if (event.type !== "input") return;
      if (this.value) searched.push(this.value);
      options = (candidates[this.value] || []).map((candidate, index) => {
        const name = typeof candidate === "string" ? candidate : candidate.name;
        return { id: typeof candidate === "string" ? `AutoComplete19-${index}` : candidate.id,
          textContent: name, getBoundingClientRect: rectangle,
          click() { clicked.push(name); if (accepts) { bound.push(name); input.value = ""; opened = false; } },
        };
      });
      if (edited && this.value) this.value = "用户正在编辑";
    }
  }
  const input = new Input();
  const button = { getBoundingClientRect: rectangle, click() { opened = true; } };
  const form = {
    isConnected: true,
    querySelectorAll(selector) {
      if (selector.includes(".Tag-content")) return bound.map((name) => ({ textContent: name }));
      if (selector.includes("input[role=combobox]")) return [input];
      return [button];
    },
  };
  const title = { value: "问题？", closest: () => form };
  const context = {
    ZhihuQuestionComposer: { findTitle: () => title }, HTMLInputElement: Input,
    Event: class { constructor(type) { this.type = type; } },
    KeyboardEvent: class { constructor(type) { this.type = type; } },
    Date: { now: () => time }, setTimeout: (fn) => { time += 120; queueMicrotask(fn); },
    document: { querySelectorAll: () => options },
  };
  vm.runInNewContext(source, context);
  return { bridge: context.ZhihuQuestionTopics, bound, searched, clicked, input };
}
test("binds exact real topics, verifies selected chips, and skips duplicate suggestions", async () => {
  const f = fixture({ candidates: { "人工智能": ["人工智能", "人工智能技术"], "Chrome": ["chrome"] } });
  const result = await f.bridge.bindTopics(["人工智能", "人工智能", "Chrome"], "问题？");
  assert.deepEqual([...result.bound], ["人工智能", "chrome"]);
  assert.deepEqual([...result.unmatched], []);
  assert.deepEqual(f.clicked, ["人工智能", "chrome"]);
  assert.deepEqual(f.searched, ["人工智能", "Chrome"]);
});
test("does not create topics, choose fuzzy matches, or use another autocomplete's results", async () => {
  const f = fixture({ candidates: {
    "浏览器扩展": ["谷歌浏览器扩展程序", "创建 浏览器扩展 话题"],
    "法律": [{ name: "法律", id: "AutoComplete1-0" }],
  } });
  const result = await f.bridge.bindTopics(["浏览器扩展", "法律"], "问题？");
  assert.deepEqual(f.clicked, []);
  assert.deepEqual([...result.unmatched], ["浏览器扩展", "法律"]);
  assert.equal(f.input.value, "");
});
test("preserves existing topics and stops at five topics", async () => {
  const f = fixture({ existing: ["一", "二", "三", "四"], candidates: { "五": ["五"], "六": ["六"] } });
  const result = await f.bridge.bindTopics(["一", "五", "六"], "问题？");
  assert.deepEqual(f.bound, ["一", "二", "三", "四", "五"]);
  assert.deepEqual([...result.unmatched], ["六"]);
  assert.deepEqual(f.searched, ["五"]);
});
test("stops on manual query editing or unconfirmed selection", async () => {
  const edited = fixture({ edited: true, candidates: { "法律": ["法律"] } });
  const result = await edited.bridge.bindTopics(["法律"], "问题？");
  assert.deepEqual(edited.clicked, []);
  assert.equal(edited.input.value, "用户正在编辑");
  assert.match(result.reason, /手动编辑/);
  const rejected = fixture({ accepts: false, candidates: { "法律": ["法律"] } });
  const missing = await rejected.bridge.bindTopics(["法律", "人工智能"], "问题？");
  assert.deepEqual([...missing.bound], []);
  assert.deepEqual([...missing.unmatched], ["法律", "人工智能"]);
  assert.deepEqual(rejected.clicked, ["法律"]);
});
test("ambiguous exact candidates are left for review", async () => {
  const f = fixture({ candidates: { "法律": ["法律", "法律"] } });
  const result = await f.bridge.bindTopics(["法律"], "问题？");
  assert.deepEqual(f.clicked, []);
  assert.match(f.bridge.summary(result), /待手动确认：法律/);
});
test("recognizes the hashtag button by its icon when tooltip labels change", () => {
  const { bridge } = fixture();
  const button = { getBoundingClientRect: () => ({ width: 40, height: 40 }) };
  const form = { querySelectorAll: (selector) => selector === "svg.ZDI--Hash24" ? [{ closest: () => button }] : [] };
  assert.equal(bridge.findHashButton(form), button);
});
