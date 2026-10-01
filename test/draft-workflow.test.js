import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { test } from "node:test";

const source = await readFile(new URL("../extension/zhihuDraft.js", import.meta.url), "utf8");
async function runWorkflow({ failure = false, question = "生成的问题？" } = {}) {
  class Element {
    constructor() { this.value = ""; this.children = []; this.classList = { toggle() {}, contains: () => false }; }
    append(...items) { this.children.push(...items); }
    insertBefore(child) { this.children.unshift(child); }
    setAttribute() {}
    attachShadow() { return root; }
    remove() { this.removed = true; }
  }
  const section = new Element();
  const details = new Element();
  const root = { querySelector: (selector) => selector === "section" ? section : details };
  const calls = [];
  const messages = [];
  const hosts = [];
  const context = {
    Date, location: { pathname: "/" },
    document: { documentElement: new Element(), body: new Element(), createElement: () => { const element = new Element(); hosts.push(element); return element; } },
    window: { addEventListener() {} },
    MutationObserver: class { observe() {} disconnect() {} },
    chrome: { runtime: { sendMessage: async (message) => { messages.push(message); return ({ data: {
      question: "生成的问题？", description: "描述", sourceUrl: "https://example.com", keywords: ["创新药", "生物医药"], createdAt: Date.now(),
    } }); } } },
    ZhihuQuestionComposer: {
      findTitle: () => ({ value: question }),
      fillDraft: async () => {
        if (failure) throw new Error("Editor changed");
        return { ok: false, message: "引用卡片导致文本校验不一致" };
      },
    },
    ZhihuQuestionTopics: {
      bindTopics: async (keywords, title) => { calls.push({ keywords: [...keywords], title }); return { bound: keywords, unmatched: [] }; },
      summary: () => "已绑定话题",
    },
  };
  vm.runInNewContext(source, context);
  await new Promise((resolve) => setImmediate(resolve));
  return { calls, section, details, hosts, messages };
}
test("topic binding continues when a link-card description fails strict text verification", async () => {
  const { calls, section } = await runWorkflow();
  assert.deepEqual(calls, [{ keywords: ["创新药", "生物医药"], title: "生成的问题？" }]);
  assert.match(section.children[0].textContent, /已绑定话题/);
});
test("topic binding also continues after editor errors when the intended title is present", async () => {
  const { calls } = await runWorkflow({ failure: true });
  assert.equal(calls.length, 1);
});
test("does not bind topics to a different user-edited title", async () => {
  const { calls } = await runWorkflow({ question: "用户另一个问题？" });
  assert.equal(calls.length, 0);
});
test("manual close removes the panel and clears its saved draft without altering editor data", async () => {
  const { details, hosts, messages } = await runWorkflow();
  const fieldValues = () => details.children.flatMap(child => child.children || []).filter(child => child.value).map(child => child.value);
  const values = fieldValues();
  assert.equal(values.length, 4);
  const dismiss = details.children.find(child => child.className === "qa-quiet dismiss-draft");
  dismiss.onclick(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(hosts[0].removed, true);
  assert.equal(messages.filter(message => message.type === "CLEAR_ZHIHU_DRAFT").length, 1);
  assert.deepEqual(fieldValues(), values);
});
