import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
const source = await readFile(new URL("../extension/zhihuDraftLifecycle.js", import.meta.url), "utf8");
function lifecycle(context = {}) { vm.runInNewContext(source, context); return context.ZhihuDraftLifecycle; }
test("only a matching question page completes the draft, not a click or closed composer", () => {
  const { isPublishedDraft } = lifecycle(); const draft = { question: "AI 工具如何帮助提问？" };
  assert.equal(isPublishedDraft(draft, "/question/12345", "AI工具如何帮助提问?"), true);
  assert.equal(isPublishedDraft(draft, "/", draft.question), false);
  assert.equal(isPublishedDraft(draft, "/question/12345", "其他人的问题？"), false);
  assert.equal(isPublishedDraft(draft, "/question/12345", ""), false);
  assert.equal(isPublishedDraft(draft, "/question/invalid", draft.question), false);
});
test("a title edited before publishing is accepted without matching an unrelated title", () => {
  const { isPublishedDraft } = lifecycle(); const draft = { question: "原草稿？", publishedTitle: "审核后的问题？" };
  assert.equal(isPublishedDraft(draft, "/question/123", "审核后的问题？"), true);
  assert.equal(isPublishedDraft(draft, "/question/123", "原草稿？"), false);
});
test("SPA completion stops observers, timers, and capture listeners exactly once", () => {
  let check, ticks, disconnected = 0, removed = 0, cleared = 0, completed = 0;
  let title = ""; const location = { pathname: "/" };
  const api = lifecycle({ location,
    document: { body: {}, querySelector: () => ({ textContent: title }), addEventListener() {}, removeEventListener() { removed++; } },
    window: { addEventListener() {}, removeEventListener() {} },
    MutationObserver: class { constructor(callback) { check = callback; } observe() {} disconnect() { disconnected++; } },
    setInterval(fn) { ticks = fn; return 1; }, clearInterval() { cleared++; }
  });
  const stop = api.watch({ question: "草稿标题？" }, () => completed++, () => {});
  title = "草稿标题？"; check(); assert.equal(completed, 0);
  location.pathname = "/question/123"; ticks(); check(); stop();
  assert.equal(completed, 1); assert.equal(disconnected, 1); assert.equal(cleared, 1); assert.equal(removed, 2);
});
