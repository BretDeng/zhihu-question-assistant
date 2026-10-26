import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { test } from "node:test";
import * as draftPreferences from "../extension/draftPreferences.js";
import { parseQuestionSet } from "../extension/modelClient.js";

const { finishQuestion } = draftPreferences;

test("every question ends with exactly one full-width question mark", () => {
  for (const [input, expected] of [
    ["AI 会取代程序员吗", "AI 会取代程序员吗？"],
    ["AI 会取代程序员吗？", "AI 会取代程序员吗？"],
    ["AI 会取代程序员吗?", "AI 会取代程序员吗？"],
    ["真的吗？？？", "真的吗？"],
    ["真的吗？！", "真的吗？"],
    ["如何看待这件事。", "如何看待这件事？"],
    ["如何看待这件事……  ", "如何看待这件事？"],
    ["「为什么」是个问题", "「为什么」是个问题？"],
    ["？", ""], ["   ", ""],
  ]) assert.equal(finishQuestion(input), expected, input);
  // Question marks in the middle stay; only the ending is normalized.
  assert.equal(finishQuestion("为什么？为什么不呢"), "为什么？为什么不呢？");
});

test("model output is normalized to a single trailing question mark", () => {
  const { items } = parseQuestionSet(JSON.stringify({ items: [
    { question: "缺少问号", description: "", keywords: ["社会"] },
    { question: "重复问号？？", description: "", keywords: ["社会"] },
    { question: "半角问号?", description: "", keywords: ["社会"] },
    { question: "？", description: "", keywords: ["社会"] },
  ] }));
  assert.deepEqual(items.map(item => item.question), ["缺少问号？", "重复问号？", "半角问号？"]);
});

async function worker(stored = {}, fetchImpl) {
  let listener;
  const session = { ...stored };
  const chrome = {
    runtime: { onMessage: { addListener: fn => { listener = fn; } } },
    storage: { onChanged: { addListener() {} }, local: { get: async () => ({}) }, session: {
      get: async key => ({ [key]: session[key] }), set: async value => Object.assign(session, value), remove: async key => { delete session[key]; } } },
    tabs: { create: async () => ({ id: 5 }), update: async () => {}, onRemoved: { addListener() {} } },
  };
  const source = await readFile(new URL("../extension/serviceWorker.js", import.meta.url), "utf8");
  vm.runInNewContext(source.replace(/^import .*?;\n/gm, ""), { ...draftPreferences, chrome, URL, Date, setTimeout, clearTimeout, AbortController, TypeError, Uint8Array, String, btoa,
    fetch: fetchImpl, createImageBitmap: async blob => blob.dims });
  return { session, listener: (...args) => listener(...args), send: (message, sender) => new Promise(resolve => listener(message, sender, resolve)) };
}

test("drafts keep only HTTPS image URLs, capped at six, and fetch only their own images", async () => {
  const fetched = [];
  const blob = (type, dims, size = 4) => ({ type, size, dims, arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer });
  const { session, send, listener } = await worker({}, async (url, options) => {
    fetched.push({ url, options });
    return { ok: true, blob: async () => url.includes("tiny") ? blob("image/png", { width: 32, height: 32 }) : url.includes("svg") ? blob("image/svg+xml", {}) : blob("image/jpeg", { width: 840, height: 560 }) };
  });
  const images = ["https://img.example/a.jpg", "http://img.example/b.jpg", "javascript:alert(1)", "https://img.example/a.jpg#x", "https://img.example/tiny.png", "https://img.example/svg", ...Array.from({ length: 6 }, (_, i) => `https://img.example/${i}.jpg`)];
  await send({ type: "OPEN_ZHIHU_DRAFT", payload: { question: "标题", keywords: [], images } }, {});
  const draft = session["zhihuDraft:5"];
  assert.equal(draft.question, "标题？");
  assert.deepEqual([...draft.images.slice(0, 3)], ["https://img.example/a.jpg", "https://img.example/tiny.png", "https://img.example/svg"]);
  assert.equal(draft.images.length, 6);
  const zhihu = { tab: { id: 5 }, url: "https://www.zhihu.com/" };
  const ok = await send({ type: "FETCH_DRAFT_IMAGE", index: 0 }, zhihu);
  assert.equal(ok.ok, true); assert.equal(ok.data.type, "image/jpeg"); assert.equal(ok.data.base64, "AQIDBA==");
  assert.equal(fetched[0].options.credentials, "omit"); assert.equal(fetched[0].options.referrerPolicy, "no-referrer");
  assert.equal((await send({ type: "FETCH_DRAFT_IMAGE", index: 1 }, zhihu)).ok, false, "icons are rejected by size");
  assert.equal((await send({ type: "FETCH_DRAFT_IMAGE", index: 2 }, zhihu)).ok, false, "SVG is not accepted");
  assert.equal((await send({ type: "FETCH_DRAFT_IMAGE", index: 9 }, zhihu)).ok, false);
  // Other pages and other tabs cannot use the worker as an image proxy.
  const fetchedBefore = fetched.length;
  assert.equal((await send({ type: "FETCH_DRAFT_IMAGE", index: 0 }, { tab: { id: 6 }, url: "https://www.zhihu.com/" })).ok, false);
  assert.equal(listener({ type: "FETCH_DRAFT_IMAGE", index: 0 }, { tab: { id: 5 }, url: "https://evil.example/" }, () => assert.fail()), undefined);
  assert.equal(fetched.length, fetchedBefore);
});

test("page extraction returns visible article images and skips icons and other regions", async () => {
  const context = { URL };
  vm.runInNewContext(await readFile(new URL("../extension/pageText.js", import.meta.url), "utf8"), context);
  const make = (tag, attrs = {}, children = []) => {
    const node = { nodeType: 1, tagName: tag.toUpperCase(), id: attrs.id || "", hidden: false, parentElement: null, naturalWidth: attrs.w || 0, naturalHeight: attrs.h || 0, currentSrc: "",
      getAttribute: key => attrs[key] ?? null,
      matches(selectors) { return selectors.split(",").some(s => { s = s.trim(); return s.startsWith("#") ? this.id === s.slice(1) : s.startsWith(".") ? (attrs.class || "").split(/\s+/).includes(s.slice(1)) : !s.startsWith("[") && this.tagName === s.toUpperCase(); }); },
      querySelectorAll(selectors) { return this.childNodes.flatMap(child => child.nodeType === 1 ? [...(child.matches(selectors) ? [child] : []), ...child.querySelectorAll(selectors)] : []); } };
    node.childNodes = children.map(child => typeof child === "string" ? { nodeType: 3, nodeValue: child } : child);
    for (const child of node.childNodes) child.parentElement = node;
    Object.defineProperty(node, "innerText", { get: () => node.childNodes.map(c => c.nodeType === 3 ? c.nodeValue : c.innerText).join("") });
    return node;
  };
  const prose = "这是文章正文段落，包含足够长度的事实描述。".repeat(8);
  const article = make("article", {}, [
    make("p", {}, [prose]),
    make("img", { src: "/photo.jpg", w: 800, h: 500 }),
    make("img", { "data-src": "https://cdn.example/lazy.jpg" }),
    make("img", { src: "/logo.png", w: 800, h: 500 }),
    make("img", { src: "/small.jpg", w: 40, h: 40 }),
    make("img", { src: "/photo.jpg", w: 800, h: 500 }),
    make("aside", {}, [make("img", { src: "/related.jpg", w: 800, h: 500 })]),
    make("p", {}, [prose]),
  ]);
  const root = make("html", {}, [make("body", {}, [make("img", { src: "/banner.jpg", w: 1200, h: 400 }), article])]);
  const doc = { baseURI: "https://news.example/a/1.html", location: { hostname: "news.example", href: "https://news.example/a/1.html" }, querySelectorAll: s => root.querySelectorAll(s), defaultView: { getComputedStyle: () => ({ display: "block", visibility: "visible" }) } };
  const result = context.ZhihuPageText.extractDetailed(doc);
  assert.deepEqual([...result.images], ["https://news.example/photo.jpg", "https://cdn.example/lazy.jpg"]);
});

test("composer pastes each image file at the end and waits for Zhihu's upload", async () => {
  const pasted = [];
  const editor = { tagName: "DIV", images: 0, focus() {}, getBoundingClientRect: () => ({ width: 500, height: 150 }),
    querySelectorAll() { return Array.from({ length: this.images }); },
    dispatchEvent(event) { pasted.push(event.clipboardData.files[0]); if (pasted.length < 3) this.images++; } };
  const title = { value: "标题？", placeholder: "写下你的问题", getBoundingClientRect: () => ({ width: 500, height: 40 }), closest: () => ({ querySelectorAll: () => [editor] }) };
  let time = 0;
  const range = { selectNodeContents() {}, collapse(start) { assert.equal(start, false); } };
  const context = {
    URL, Date: { now: () => time }, setTimeout: fn => { time += 120; queueMicrotask(fn); },
    DataTransfer: class { constructor() { this.files = []; this.items = { add: file => this.files.push(file) }; } },
    ClipboardEvent: class { constructor(type, options) { Object.assign(this, { type }, options); } },
    document: { querySelectorAll: s => s === ".Ask-form textarea" ? [title] : [], getSelection: () => ({ removeAllRanges() {}, addRange() {} }), createRange: () => range },
  };
  for (const file of ["descriptionLimit.js", "zhihuDom.js", "zhihuComposer.js"]) vm.runInNewContext(await readFile(new URL(`../extension/${file}`, import.meta.url), "utf8"), context);
  const progress = [];
  const inserted = await context.ZhihuQuestionComposer.insertImages("标题？", ["a", "b", "c", "d"], { onProgress: (i, n) => progress.push(`${i}/${n}`) });
  assert.equal(inserted, 2);
  assert.deepEqual(pasted, ["a", "b", "c"], "stops after the editor ignores a paste");
  assert.deepEqual(progress, ["1/4", "2/4", "3/4"]);
  title.value = "别的标题？";
  assert.equal(await context.ZhihuQuestionComposer.insertImages("标题？", ["e"]), 0, "never pastes into a different question");
});
