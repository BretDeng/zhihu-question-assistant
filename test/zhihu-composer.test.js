import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { test } from "node:test";

const source = await readFile(new URL("../extension/zhihuComposer.js", import.meta.url), "utf8");
function fixture({ titleValue = "", editorValue = "", open = false, acceptsPaste = true, nativeInsert = false, media = false } = {}) {
  const events = [];
  class Textarea {
    constructor(value) { this._value = value; this.placeholder = "写下你的问题，准确地描述问题更容易得到解答"; }
    get value() { return this._value; }
    set value(value) { this._value = value; }
    getBoundingClientRect() { return { width: 500, height: 60 }; }
    closest() { return form; }
    dispatchEvent(event) { events.push(event.type); }
  }
  const title = new Textarea(titleValue);
  const editor = {
    tagName: "DIV", innerText: editorValue,
    getBoundingClientRect: () => ({ width: 500, height: 150 }),
    querySelector: () => media ? {} : null,
    focus() {},
    dispatchEvent(event) { events.push(event.type); if (acceptsPaste) this.innerText = event.clipboardData.getData("text/plain"); },
  };
  const form = { isConnected: true, querySelectorAll: () => [editor] };
  let opened = open;
  let clicks = 0;
  const entry = { textContent: "提问题", contains: () => false, getBoundingClientRect: () => ({ width: 80, height: 30 }), click() { clicks++; opened = true; } };
  let time = 0;
  const context = {
    URL, HTMLTextAreaElement: Textarea,
    Date: { now: () => time }, setTimeout: (fn) => { time += 120; queueMicrotask(fn); },
    Event: class { constructor(type) { this.type = type; } },
    DataTransfer: class { setData(type, value) { this[type] = value; } getData(type) { return this[type]; } },
    ClipboardEvent: class { constructor(type, options) { Object.assign(this, { type }, options); } },
    document: {
      querySelectorAll: (selector) => selector === ".Ask-form textarea" ? (opened ? [title] : []) : [entry],
      getSelection: () => ({ removeAllRanges() {}, addRange() {} }),
      createRange: () => ({ selectNodeContents() {}, collapse() {} }),
      execCommand: (command, _ui, value) => {
        events.push(command);
        if (nativeInsert) editor.innerText = value;
        return nativeInsert;
      },
    },
  };
  vm.runInNewContext(source, context);
  return { bridge: context.ZhihuQuestionComposer, title, editor, events, clicks: () => clicks, context };
}
const draft = { question: "如何整理网页内容？", description: "背景和讨论点", sourceUrl: "https://example.com/article#part" };

test("opens the current clickable-DIV entry and fills title plus description and source", async () => {
  const f = fixture();
  const result = await f.bridge.fillDraft(draft);
  assert.equal(result.ok, true);
  assert.equal(f.clicks(), 1);
  assert.equal(f.title.value, draft.question);
  assert.equal(f.editor.innerText, "背景和讨论点\n\n引用来源：https://example.com/article");
  assert.deepEqual(f.events, ["input", "change", "paste"]);
});
test("existing title, existing description, and media are not overwritten", async () => {
  const title = fixture({ open: true, titleValue: "用户自己的标题" });
  assert.equal((await title.bridge.fillDraft(draft)).ok, false);
  assert.equal(title.title.value, "用户自己的标题");
  assert.deepEqual(title.events, []);
  for (const options of [{ editorValue: "已有描述" }, { media: true }]) {
    const f = fixture({ open: true, titleValue: draft.question, ...options });
    assert.equal((await f.bridge.fillDraft(draft)).ok, false);
    assert.equal(f.editor.innerText, options.editorValue || "");
    assert.deepEqual(f.events, []);
  }
});
test("repeated filling does not duplicate text; blocked paste produces a manual fallback", async () => {
  const f = fixture();
  await f.bridge.fillDraft(draft);
  const description = f.editor.innerText;
  await f.bridge.fillDraft(draft);
  assert.equal(f.editor.innerText, description);
  assert.equal(f.events.filter((type) => type === "paste").length, 1);
  const blocked = fixture({ open: true, acceptsPaste: false });
  const result = await blocked.bridge.fillDraft(draft);
  assert.equal(result.ok, false);
  assert.match(result.message, /手动粘贴/);
  assert.equal(blocked.editor.innerText, "");
});
test("source URLs are plain text, validated, and not duplicated", () => {
  const { bridge } = fixture();
  assert.equal(bridge.buildDescription("描述", "javascript:alert(1)"), "描述");
  assert.equal(bridge.buildDescription("描述", "https://secret:password@example.com"), "描述");
  assert.equal(bridge.buildDescription("引用来源：https://example.com/article", draft.sourceUrl), "引用来源：https://example.com/article");
  assert.equal(bridge.buildDescription("", draft.sourceUrl), "引用来源：https://example.com/article");
});
test("native text insertion fills descriptions when synthetic paste is ignored", async () => {
  const f = fixture({ open: true, acceptsPaste: false, nativeInsert: true });
  assert.equal((await f.bridge.fillDraft(draft)).ok, true);
  assert.equal(f.editor.innerText, "背景和讨论点\n\n引用来源：https://example.com/article");
  assert.equal(f.events.filter((type) => type === "insertText").length, 1);
  assert.equal((await f.bridge.fillDraft(draft)).ok, true);
  assert.equal(f.events.filter((type) => type === "insertText").length, 1);
});
test("form re-rendering after title entry does not prevent description filling", async () => {
  const f = fixture({ open: true });
  const originalDispatch = f.title.dispatchEvent.bind(f.title);
  let currentTitle = f.title;
  f.title.dispatchEvent = (event) => {
    originalDispatch(event);
    if (event.type === "input") currentTitle = new f.title.constructor(f.title.value);
  };
  const originalQuery = f.context.document.querySelectorAll;
  f.context.document.querySelectorAll = (selector) => selector === ".Ask-form textarea" ? [currentTitle] : originalQuery(selector);
  assert.equal((await f.bridge.fillDraft(draft)).ok, true);
  assert.notEqual(currentTitle, f.title);
  assert.match(f.editor.innerText, /引用来源/);
});
test("ambiguous entries are not clicked", () => {
  const f = fixture();
  f.context.document.querySelectorAll = () => [
    { textContent: "提问题", getBoundingClientRect: () => ({ width: 80, height: 30 }), contains: () => false },
    { textContent: "提问题", getBoundingClientRect: () => ({ width: 80, height: 30 }), contains: () => false },
  ];
  assert.equal(f.bridge.findEntry(), null);
});
