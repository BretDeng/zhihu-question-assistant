import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import * as styles from "../extension/questionStyles.js";
import * as preferences from "../extension/draftPreferences.js";
import { SITE_RULES_KEY } from "../extension/siteRules.js";
import { buildMessages, generateQuestions } from "../extension/modelClient.js";

function storage(initial = {}) {
  const data = { ...initial };
  return { data, storage: { local: {
    get: async keys => Object.fromEntries([keys].flat().map(key => [key, data[key]])),
    set: async values => { Object.assign(data, structuredClone(values)); },
  } } };
}
test("style preferences default safely, validate custom input and survive switching", async () => {
  const api = storage();
  assert.equal((await styles.readQuestionStyle(api)).selected, "professional");
  assert.equal(styles.normalizeQuestionStyle({ selected: "custom" }).selected, "professional");
  await assert.rejects(styles.selectQuestionStyle(api, "custom"), /先在 Dashboard/);
  await assert.rejects(styles.saveCustomStyle(api, "名称", " "), /填写/);
  await assert.rejects(styles.saveCustomStyle(api, "名称", "文".repeat(1501)), /1500/);
  await styles.saveCustomStyle(api, "打工人的好奇心", "关注工作和收入，少用术语。");
  await styles.selectQuestionStyle(api, "daily");
  await styles.selectQuestionStyle(api, "custom");
  const stored = await styles.readQuestionStyle(api);
  assert.equal(stored.customPrompt, "关注工作和收入，少用术语。");
  assert.deepEqual(styles.publicQuestionStyle(stored), { selected: "custom", customName: "打工人的好奇心", hasCustom: true });
  await assert.rejects(styles.selectQuestionStyle(api, "invalid"), /有效/);
});
test("concurrent style saves and switches preserve the latest custom text", async () => {
  const api = storage();
  await Promise.all([
    styles.saveCustomStyle(api, "新风格", "从生活的实际影响出发。"),
    styles.selectQuestionStyle(api, "daily"),
  ]);
  assert.deepEqual(await styles.readQuestionStyle(api), { selected: "daily", customName: "新风格", customPrompt: "从生活的实际影响出发。" });
});
const page = { title: "新技术新闻", url: "https://example.com", mainText: "新闻正文。" };
test("both providers receive the selected style while keeping six-item and original-mode rules", async () => {
  for (const provider of ["openai", "zhida"]) for (const selected of styles.STYLE_IDS) {
    const questionStyle = { selected, customName: "亲子", customPrompt: "从家长的教育选择出发。" };
    const config = { provider, model: provider === "zhida" ? "zhida-agent" : "model", questionStyle, descriptionMode: "original" };
    const prompt = buildMessages(page, config)[0].content;
    assert.ok(prompt.includes(styles.questionStylePrompt(questionStyle)));
    assert.match(prompt, /description 固定为空字符串/);
    assert.match(prompt, /items 必须恰好 6 项/);
    let sent;
    await generateQuestions(page, { ...config, apiKey: "fixture" }, async (_url, options) => {
      sent = JSON.parse(options.body);
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ items: Array.from({ length: 6 }, (_, i) => ({ question: `问题 ${i}？`, description: "", keywords: ["教育"] })) }) } }] }), { headers: { "Content-Type": "application/json" } });
    });
    assert.ok(sent.messages[0].content.includes(styles.questionStylePrompt(questionStyle)));
  }
});
test("background uses saved style and captures it for an entire streamed generation", async () => {
  const api = storage({ [styles.QUESTION_STYLE_KEY]: { selected: "daily" } });
  let listener, changed, finish, ready;
  const started = new Promise(resolve => { ready = resolve; });
  const delivered = [];
  const item = { question: "对我的日常生活有什么影响？", description: "背景", keywords: ["生活"] };
  const chrome = { storage: { ...api.storage, onChanged: { addListener(fn) { changed = fn; } } },
    runtime: { onMessage: { addListener(fn) { listener = fn; } } },
    tabs: { onRemoved: { addListener() {} }, query: async () => [{ id: 1 }], sendMessage: async (_id, message) => delivered.push(message) } };
  const source = (await readFile(new URL("../extension/serviceWorker.js", import.meta.url), "utf8")).replace(/^import .*?;\n/gm, "");
  vm.runInNewContext(source, { ...preferences, ...styles, SITE_RULES_KEY, chrome, setInterval: () => 1, clearInterval() {}, activeModelConfig: async () => ({ apiKey: "fixture" }),
    generateQuestions: async (_page, config, _fetch, callbacks) => {
      assert.equal(config.questionStyle.selected, "daily");
      callbacks.onItem(item, 0); ready();
      await new Promise(resolve => { finish = resolve; });
      callbacks.onItem(item, 1);
      return { items: [item, item] };
    } });
  const send = message => new Promise(resolve => listener(message, { tab: { id: 1 } }, resolve));
  const pending = send({ type: "GENERATE_ZHIHU_QUESTIONS", requestId: "style", payload: { ...page, questionStyle: { selected: "professional" } } });
  await started;
  await send({ type: "SAVE_CUSTOM_QUESTION_STYLE", name: "家长", prompt: "从家长角度提问。" });
  finish();
  const result = await pending;
  assert.equal(result.ok, true);
  assert.ok(result.data.items.every(item => item.questionStyle === "daily"));
  assert.ok(delivered.every(message => message.item.questionStyleName === "日常"));
  const current = await send({ type: "GET_QUESTION_STYLE" });
  assert.equal(current.data.selected, "custom");
  assert.equal("customPrompt" in current.data, false);
  changed({ questionStylePreferences: {} }, "local");
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(delivered.at(-1).type, "QUESTION_STYLE_CHANGED");
});
