import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import * as preferences from "../extension/draftPreferences.js";
import { generateQuestions, buildMessages } from "../extension/modelClient.js";

const item = { question: "如何评价这些事实？", description: "模型概括", keywords: ["科技", "经济", "社会", "历史", "文化"] };
test("original paragraphs preserve wording and repeats, compact blank lines and reject silent truncation", () => {
  const original = ' 原文ABC2026与“原文引号”。\r\n\r\n 第二段。\n\n第二段。 ';
  assert.equal(preferences.originalDescription(original), '原文ABC2026与“原文引号”。\n第二段。\n第二段。');
  const long = `${"正文".repeat(10000)}末尾不能丢失`;
  assert.equal(preferences.originalDescription(long), long);
  assert.throws(() => preferences.originalDescription(""), /未抓取/);
  assert.throws(() => preferences.originalDescription("文".repeat(preferences.MAX_ORIGINAL_LENGTH + 1)), /未被截断/);
});
test("preferences default to summary and decoration doesn't change titles or topics", async () => {
  assert.equal(await preferences.readDescriptionMode({ storage: { local: { get: async () => ({}) } } }), "summary");
  assert.equal(preferences.prepareDescription("summary", {})(item).description, item.description);
  const draft = preferences.prepareDescription("original", { mainText: "完整原文\n\n尾段" })(item);
  assert.equal(draft.description, "完整原文\n尾段");
  assert.equal(draft.question, item.question); assert.deepEqual(draft.keywords, item.keywords);
  assert.equal(draft.descriptionLimit, preferences.MAX_ORIGINAL_LENGTH);
});
test("original-mode model input remains bounded and asks for empty description for both providers", async () => {
  const page = { title: "网页", url: "https://example.com", mainText: `${"文".repeat(18000)}原文尾部不发送给模型` };
  for (const provider of ["openai", "zhida"]) {
    const messages = buildMessages(page, { provider, model: provider === "zhida" ? "zhida-agent" : "model", descriptionMode: "original" });
    assert.match(messages[0].content, /description 固定为空字符串/);
    assert.equal(messages.some(message => message.content.includes("原文尾部不发送给模型")), false);
    let request;
    const reply = await generateQuestions(page, { provider, apiKey: "fixture", descriptionMode: "original" }, async (_url, options) => {
      request = JSON.parse(options.body);
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ items: Array.from({ length: 6 }, () => ({ ...item, description: "" })) }) } }] }), { headers: { "Content-Type": "application/json" } });
    });
    assert.match(request.messages[0].content, /固定为空字符串/);
    assert.equal(reply.items[0].description, "");
  }
});

const worker = (await readFile(new URL("../extension/serviceWorker.js", import.meta.url), "utf8")).replace(/^import .*?;\n/gm, "");
function background({ mode = "original", generate } = {}) {
  let listener; const delivered = [], stored = {};
  const chrome = {
    runtime: { onMessage: { addListener(fn) { listener = fn; } } },
    storage: {
      local: { get: async () => ({ descriptionMode: mode }) },
      session: { get: async key => ({ [key]: stored[key] }), set: async value => Object.assign(stored, value), remove: async key => { delete stored[key]; } },
      onChanged: { addListener() {} },
    },
    tabs: { onRemoved: { addListener() {} }, sendMessage: async (_tab, value) => delivered.push(value), create: async () => ({ id: 7 }), update: async () => {} },
  };
  vm.runInNewContext(worker, { ...preferences, chrome, URL, Date, Error, setInterval: () => 1, clearInterval() {}, activeModelConfig: async () => ({ apiKey: "fixture" }), generateQuestions: generate });
  return { send: message => new Promise(resolve => listener(message, { tab: { id: 7 } }, resolve)), delivered, stored, switchMode: value => { mode = value; } };
}
test("background captures original mode for the whole stream and handoff retains more than 3,000 characters", async () => {
  const original = `${"全文ABC2026“引号”。\n".repeat(1200)}末尾标记。`;
  let finish, reached;
  const ready = new Promise(resolve => { reached = resolve; });
  const bg = background({ generate: async (page, config, _fetch, callbacks) => {
    assert.equal(config.descriptionMode, "original"); assert.equal(page.selectedText, "");
    callbacks.onItem(item, 0); reached();
    await new Promise(resolve => { finish = resolve; });
    callbacks.onItem(item, 1);
    return { items: Array.from({ length: 6 }, () => item) };
  } });
  const pending = bg.send({ type: "GENERATE_ZHIHU_QUESTIONS", requestId: "test", payload: { mainText: original, selectedText: "旧选区" } });
  await ready; bg.switchMode("summary"); finish();
  const reply = await pending;
  assert.equal(reply.ok, true);
  for (const message of bg.delivered) assert.equal(message.item.description, original.trim());
  assert.equal(reply.data.items[5].description, original.trim());
  const opened = await bg.send({ type: "OPEN_ZHIHU_DRAFT", payload: { ...reply.data.items[0], sourceUrl: "https://example.com" } });
  assert.equal(opened.ok, true);
  assert.equal(bg.stored["zhihuDraft:7"].description, original.trim());
});
test("oversized original fails before a billable request or tab creation", async () => {
  let called = false;
  const bg = background({ generate: async () => { called = true; } });
  const reply = await bg.send({ type: "GENERATE_ZHIHU_QUESTIONS", payload: { mainText: "文".repeat(preferences.MAX_ORIGINAL_LENGTH + 1) } });
  assert.equal(reply.ok, false); assert.match(reply.error, /超过/); assert.equal(called, false);
  const opened = await bg.send({ type: "OPEN_ZHIHU_DRAFT", payload: { question: "问题", descriptionMode: "original", description: "文".repeat(preferences.MAX_ORIGINAL_LENGTH + 1) } });
  assert.equal(opened.ok, false); assert.equal(Object.keys(bg.stored).length, 0);
});
test("partial original generates and hands off loaded paragraphs without adding warning copy", async () => {
  let called = false;
  const page = { mainText: "已加载的第一段原文。\n\n已加载的第二段原文。", originalPartial: true, originalUnavailableReason: "" };
  const bg = background({ generate: async () => { called = true; return { items: [item] }; } });
  const reply = await bg.send({ type: "GENERATE_ZHIHU_QUESTIONS", payload: page });
  assert.equal(reply.ok, true); assert.equal(called, true);
  const draft = reply.data.items[0];
  assert.equal(draft.description, "已加载的第一段原文。\n已加载的第二段原文。");
  assert.equal(draft.originalPartial, true);
  const opened = await bg.send({ type: "OPEN_ZHIHU_DRAFT", payload: { ...draft, sourceUrl: "https://finance.caixin.com/article.html" } });
  assert.equal(opened.ok, true);
  assert.equal(bg.stored["zhihuDraft:7"].description, draft.description);
  assert.equal(bg.stored["zhihuDraft:7"].originalPartial, true);
  assert.equal(preferences.prepareDescription("summary", page)(item).description, item.description);
  assert.equal(preferences.prepareDescription("summary", page)(item).originalPartial, false);
});
test("a missing reliable body still stops original mode before billing", async () => {
  let called = false;
  const bg = background({ generate: async () => { called = true; } });
  const reply = await bg.send({ type: "GENERATE_ZHIHU_QUESTIONS", payload: { mainText: "", originalUnavailableReason: "未找到可靠的文章正文。" } });
  assert.equal(reply.ok, false); assert.match(reply.error, /可靠/); assert.equal(called, false);
});
