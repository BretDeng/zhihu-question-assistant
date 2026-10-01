import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { test } from "node:test";

test("drafts are tab-bound, omit credentials, and are removed when the tab closes", async () => {
  const stored = {};
  let listener;
  let removed;
  let nextId = 10;
  const updates = [];
  const chrome = {
    runtime: { onMessage: { addListener: (fn) => { listener = fn; } } },
    storage: { session: {
      set: async (value) => Object.assign(stored, value),
      get: async (key) => ({ [key]: stored[key] }),
      remove: async (key) => { delete stored[key]; },
    } },
    tabs: {
      create: async () => ({ id: nextId++ }),
      update: async (id, value) => updates.push({ id, ...value }),
      onRemoved: { addListener: (fn) => { removed = fn; } },
    },
  };
  const source = await readFile(new URL("../extension/serviceWorker.js", import.meta.url), "utf8");
  vm.runInNewContext(source.replace(/^import .*?;\n/gm, ""), { chrome, URL, Date, setTimeout, clearTimeout });
  const send = (message, sender = {}) => new Promise((resolve) => listener(message, sender, resolve));
  await send({ type: "OPEN_ZHIHU_DRAFT", payload: { question: "First?", description: "Draft", keywords: ["Topic"], sourceUrl: "https://example.com/article#section", apiKey: "secret" } });
  await send({ type: "OPEN_ZHIHU_DRAFT", payload: { question: "Second?", keywords: [], sourceUrl: "javascript:alert(1)" } });
  const first = await send({ type: "GET_ZHIHU_DRAFT" }, { tab: { id: 10 }, url: "https://www.zhihu.com/" });
  const second = await send({ type: "GET_ZHIHU_DRAFT" }, { tab: { id: 11 }, url: "https://www.zhihu.com/" });
  assert.equal(first.data.question, "First?");
  assert.equal(second.data.question, "Second?");
  assert.equal(first.data.apiKey, undefined);
  assert.equal(first.data.sourceUrl, "https://example.com/article");
  assert.equal(second.data.sourceUrl, "");
  assert.equal(listener({ type: "GET_ZHIHU_DRAFT" }, { tab: { id: 10 }, url: "https://evil.example" }, () => assert.fail()), undefined);
  assert.equal(updates[0].url, "https://www.zhihu.com/");
  assert.ok(!updates[0].url.includes("First"));
  const sender = { tab: { id: 11 }, url: "https://www.zhihu.com/question/123" };
  assert.equal(listener({ type: "CLEAR_ZHIHU_DRAFT", createdAt: stored["zhihuDraft:11"].createdAt }, { tab: { id: 11 }, url: "https://evil.example" }, () => assert.fail()), undefined);
  await send({ type: "UPDATE_ZHIHU_DRAFT_TITLE", createdAt: stored["zhihuDraft:11"].createdAt, publishedTitle: "Edited?" }, sender);
  assert.equal(stored["zhihuDraft:11"].publishedTitle, "Edited?");
  await send({ type: "CLEAR_ZHIHU_DRAFT", createdAt: -1 }, sender);
  assert.ok(stored["zhihuDraft:11"]);
  await send({ type: "CLEAR_ZHIHU_DRAFT", createdAt: stored["zhihuDraft:11"].createdAt }, sender);
  assert.equal(stored["zhihuDraft:11"], undefined);
  assert.ok(stored["zhihuDraft:10"]);
  removed(10);
  assert.equal(stored["zhihuDraft:10"], undefined);
});

test("generation reads trusted saved settings instead of page-provided configuration", async () => {
  let listener;
  let called;
  let timerCleared = false;
  const chrome = {
    runtime: { onMessage: { addListener: (fn) => { listener = fn; } } },
    storage: {
      local: { get: async () => ({ modelConfig: { provider: "openai", baseURL: "https://trusted.example/v1", model: "chosen" } }) },
      session: { get: async () => ({ modelApiKey: "stored-secret" }) },
    },
    tabs: { onRemoved: { addListener() {} } },
  };
  const source = await readFile(new URL("../extension/serviceWorker.js", import.meta.url), "utf8");
  vm.runInNewContext(source.replace(/^import .*?;\n/gm, ""), {
    chrome,
    setInterval: () => 42,
    clearInterval: (id) => { timerCleared = id === 42; },
    generateQuestions: async (page, config) => { called = { page, config }; return { items: [] }; },
    activeModelConfig: async () => ({ provider: "openai", baseURL: "https://trusted.example/v1", model: "chosen", apiKey: "stored-secret" }),
  });
  const reply = await new Promise((resolve) => listener({ type: "GENERATE_ZHIHU_QUESTIONS", payload: { title: "Page", modelConfig: { baseURL: "https://evil.example", apiKey: "page-key" } } }, {}, resolve));
  assert.equal(reply.ok, true);
  assert.equal(called.config.baseURL, "https://trusted.example/v1");
  assert.equal(called.config.apiKey, "stored-secret");
  assert.ok(!JSON.stringify(reply).includes("stored-secret"));
  assert.equal(timerCleared, true);
});

test("page-facing model status contains only the model and provider, never credentials", async () => {
  let listener;
  const chrome = { runtime: { onMessage: { addListener(fn) { listener = fn; } } }, storage: {}, tabs: { onRemoved: { addListener() {} } } };
  const source = await readFile(new URL("../extension/serviceWorker.js", import.meta.url), "utf8");
  vm.runInNewContext(source.replace(/^import .*?;\n/gm, ""), { chrome, activeModelConfig: async () => ({ model: "chosen", provider: "openai", apiKey: "private-secret", baseURL: "https://private.example/v1" }) });
  const reply = await new Promise(resolve => listener({ type: "GET_ACTIVE_MODEL" }, {}, resolve));
  assert.equal(reply.data.model, "chosen"); assert.equal(reply.data.provider, "openai");
  assert.equal(reply.data.apiKey, undefined); assert.equal(reply.data.baseURL, undefined);
  assert.equal(JSON.stringify(reply).includes("private-secret"), false);
});
