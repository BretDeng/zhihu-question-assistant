import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { normalizeSite, parseSites, isSiteExcluded, SITE_RULES_KEY } from "../extension/siteRules.js";

test("site rules normalize pasted URLs, case, trailing dots, Unicode and duplicates", () => {
  assert.deepEqual(parseSites("Example.COM\nhttps://example.com/article?q=1\n\nnews.example.org."), ["example.com", "news.example.org"]);
  assert.equal(normalizeSite("https://例子.中国/path"), "xn--fsqu00a.xn--fiqs8s");
  assert.equal(normalizeSite("http://localhost:8080/path"), "localhost");
  assert.equal(normalizeSite("http://[::1]:8080"), "[::1]");
  assert.deepEqual(parseSites(" \n"), []);
});
test("rules match only exact hosts or real subdomains, never lookalike suffixes", () => {
  for (const url of ["https://example.com", "http://news.example.com:8000/path", "https://EXAMPLE.COM./"]) assert.equal(isSiteExcluded(url, ["example.com"]), true);
  for (const url of ["https://notexample.com", "https://example.com.evil.test", "https://another.org", "invalid"]) assert.equal(isSiteExcluded(url, ["example.com"]), false);
  assert.equal(isSiteExcluded("https://example.com", ["www.example.com"]), false);
});
test("invalid rules are rejected rather than partially saved", () => {
  for (const value of ["*.example.com", "not a site", "ftp://example.com", "https://user:pass@example.com", "bad..com", "-bad.com"]) assert.throws(() => normalizeSite(value));
  assert.throws(() => parseSites(Array.from({ length: 201 }, (_, i) => `${i}.example.com`).join("\n")));
});
test("site access ignores stale responses and reacts to live rule changes", async () => {
  const source = await readFile(new URL("../extension/siteAccess.js", import.meta.url), "utf8");
  let listener; const replies = [], enabled = [];
  const context = { chrome: { runtime: {
    sendMessage: () => new Promise(resolve => replies.push(resolve)),
    onMessage: { addListener(fn) { listener = fn; }, removeListener(fn) { assert.equal(fn, listener); } },
  } } };
  vm.runInNewContext(source, context);
  const stop = context.ZhihuSiteAccess.watch(value => enabled.push(value));
  listener({ type: "SITE_RULES_CHANGED" });
  replies[1]({ ok: true, data: { enabled: false } });
  await new Promise(resolve => setImmediate(resolve));
  replies[0]({ ok: true, data: { enabled: true } });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(enabled, [false]);
  listener({ type: "SITE_RULES_CHANGED" });
  replies[2]({ ok: true, data: { enabled: true } });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(enabled, [false, true]);
  stop();
});
test("background policy uses sender URL, broadcasts changes, and blocks model calls", async () => {
  let listener, onChanged, generated = false; const messages = [];
  const source = await readFile(new URL("../extension/serviceWorker.js", import.meta.url), "utf8");
  const chrome = {
    runtime: { onMessage: { addListener(fn) { listener = fn; } } },
    storage: { local: { get: async () => ({ excludedSites: ["example.com"], modelProfileKeys: { secret: "not-for-pages" } }) }, onChanged: { addListener(fn) { onChanged = fn; } } },
    tabs: { onRemoved: { addListener() {} }, query: async () => [{ id: 1 }, { id: 2 }], sendMessage: async (id, message) => messages.push({ id, message }) },
  };
  vm.runInNewContext(source.replace(/^import .*?;\n/gm, ""), { chrome, SITE_RULES_KEY, isSiteExcluded, activeModelConfig: async () => { generated = true; } });
  const sender = { tab: { id: 1 }, url: "https://news.example.com" };
  const send = message => new Promise(resolve => listener(message, sender, resolve));
  assert.deepEqual(JSON.parse(JSON.stringify(await send({ type: "GET_SITE_ACCESS", url: "https://allowed.org" }))), { ok: true, data: { enabled: false } });
  const reply = await send({ type: "GENERATE_ZHIHU_QUESTIONS" });
  assert.equal(reply.ok, false); assert.equal(generated, false);
  onChanged({ excludedSites: {} }, "local");
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(messages.length, 2); assert.equal(messages[0].message.type, "SITE_RULES_CHANGED");
  assert.equal(JSON.stringify(messages).includes("not-for-pages"), false);
});
