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
test("style library defaults safely, validates input and saves many custom styles", async () => {
  const api = storage();
  assert.equal((await styles.readQuestionStyle(api)).selected, "professional");
  assert.equal(styles.normalizeQuestionStyle({ selected: "missing" }).selected, "professional");
  await assert.rejects(styles.selectQuestionStyle(api, "sabcdef"), /有效/);
  await assert.rejects(styles.saveCustomStyle(api, "名称", " "), /填写/);
  await assert.rejects(styles.saveCustomStyle(api, "名称", "文".repeat(1501)), /1500/);
  const first = await styles.saveCustomStyle(api, "打工人的好奇心", "关注工作和收入，少用术语。");
  const second = await styles.saveCustomStyle(api, "家长视角", "从孩子教育和家庭开支出发。");
  assert.equal(second.customStyles.length, 2);
  const [work, parent] = second.customStyles;
  assert.equal(second.selected, parent.id);
  await styles.selectQuestionStyle(api, work.id);
  assert.equal(styles.questionStyleName(await styles.readQuestionStyle(api)), "打工人的好奇心");
  const edited = await styles.saveCustomStyle(api, "打工人", "只问和收入有关的事。", work.id);
  assert.equal(edited.customStyles.length, 2);
  assert.deepEqual(edited.customStyles[0], { id: work.id, name: "打工人", prompt: "只问和收入有关的事。" });
  assert.deepEqual(styles.publicQuestionStyle(edited), { selected: work.id, customStyles: [{ id: work.id, name: "打工人" }, { id: parent.id, name: "家长视角" }] });
  const removed = await styles.deleteCustomStyle(api, work.id);
  assert.equal(removed.selected, "professional");
  assert.deepEqual(removed.customStyles.map(item => item.id), [parent.id]);
  await assert.rejects(styles.saveCustomStyle(api, "旧", "文", work.id), /已被删除/);
  await assert.rejects(styles.deleteCustomStyle(api, work.id), /不存在/);
  assert.ok(first.customStyles[0].id !== parent.id);
});
test("the single v2.3.0 custom style migrates into the library", () => {
  const migrated = styles.normalizeQuestionStyle({ selected: "custom", customName: "亲子", customPrompt: "从家长角度。" });
  assert.deepEqual(migrated, { selected: "legacy", customStyles: [{ id: "legacy", name: "亲子", prompt: "从家长角度。" }] });
  assert.equal(styles.normalizeQuestionStyle({ selected: "daily", customName: "亲子", customPrompt: "从家长角度。" }).selected, "daily");
  assert.deepEqual(styles.normalizeQuestionStyle({ selected: "custom" }), { selected: "professional", customStyles: [] });
});
test("the library is capped and concurrent saves keep every style", async () => {
  const api = storage();
  await Promise.all(Array.from({ length: 3 }, (_, i) => styles.saveCustomStyle(api, `风格${i}`, `说明${i}`)));
  await styles.selectQuestionStyle(api, "daily");
  const saved = await styles.readQuestionStyle(api);
  assert.equal(saved.selected, "daily");
  assert.deepEqual(saved.customStyles.map(item => item.name), ["风格0", "风格1", "风格2"]);
  for (let i = 3; i < styles.MAX_CUSTOM_STYLES; i++) await styles.saveCustomStyle(api, `风格${i}`, `说明${i}`);
  await assert.rejects(styles.saveCustomStyle(api, "多余", "说明"), /最多保存 20/);
});
const page = { title: "新技术新闻", url: "https://example.com", mainText: "新闻正文。" };
test("both providers receive the selected style while keeping six-item and original-mode rules", async () => {
  for (const provider of ["openai", "zhida"]) for (const selected of ["professional", "daily", "kid01"]) {
    const questionStyle = { selected, customStyles: [{ id: "kid01", name: "亲子", prompt: "从家长的教育选择出发。" }] };
    const config = { provider, model: provider === "zhida" ? "zhida-agent" : "model", questionStyle, descriptionMode: "original" };
    const prompt = buildMessages(page, config)[0].content;
    assert.ok(prompt.includes(styles.questionStylePrompt(questionStyle)));
    if (selected === "kid01") assert.match(prompt, /从家长的教育选择出发/);
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
  assert.equal(current.data.customStyles[0].name, "家长");
  assert.equal(current.data.selected, current.data.customStyles[0].id);
  assert.equal(JSON.stringify(current.data).includes("从家长角度提问"), false);
  const second = await send({ type: "SAVE_CUSTOM_QUESTION_STYLE", name: "学生", prompt: "从学生角度提问。" });
  assert.equal(second.data.customStyles.length, 2);
  const deleted = await send({ type: "DELETE_CUSTOM_QUESTION_STYLE", id: second.data.selected });
  assert.equal(deleted.ok, true);
  assert.equal(deleted.data.selected, "professional");
  assert.equal(deleted.data.customStyles.length, 1);
  changed({ questionStylePreferences: {} }, "local");
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(delivered.at(-1).type, "QUESTION_STYLE_CHANGED");
});
