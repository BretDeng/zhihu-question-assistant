import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../extension/contentScript.js", import.meta.url), "utf8");

// Minimal DOM that records style writes to detect redundant observer updates.
function mount({ innerWidth = 1280, innerHeight = 900 } = {}) {
  const writes = [];
  let resizeObserverCallback = null;
  const nodes = [];
  function element(className = "") {
    const node = {
      className, children: [], dataset: {}, disabled: false, value: "",
      classList: { set: new Set(),
        add(...names) { for (const name of names) this.set.add(name); },
        remove(...names) { for (const name of names) this.set.delete(name); },
        contains(name) { return this.set.has(name); },
        toggle(name, force) { const on = force ?? !this.set.has(name); if (on) this.set.add(name); else this.set.delete(name); return on; },
      },
      append(...items) { node.children.push(...items); },
      insertBefore(child) { node.children.unshift(child); },
      setAttribute() {}, removeAttribute() {}, focus() {}, select() {}, remove() {},
      addEventListener() {}, removeEventListener() {},
      setPointerCapture() {}, releasePointerCapture() {}, hasPointerCapture: () => false,
      getBoundingClientRect: () => ({ left: 0, top: 0, right: 48, bottom: 48, width: 48, height: 48 }),
      querySelector: () => null, querySelectorAll: () => [],
      attachShadow: () => shadow,
    };
    const declaration = {
      setProperty(key, value) { writes.push({ node: node.className, key, value }); declaration[key] = value; },
      removeProperty(key) { writes.push({ node: node.className, key, value: "" }); delete declaration[key]; },
    };
    node.style = new Proxy(declaration, {
      set(target, key, value) { writes.push({ node: node.className, key, value }); target[key] = value; return true; },
      get(target, key) { const value = target[key]; return typeof value === "function" ? value : value ?? ""; },
    });
    nodes.push(node);
    return node;
  }
  const shadow = {
    innerHTML: "",
    querySelector(selector) {
      const name = selector.replace(/^\./, "");
      return nodes.find((item) => item.className.split(/\s+/).includes(name)) || element(name);
    },
  };
  for (const name of ["assistant-dock", "floating-ball", "panel", "panel-header", "close-button",
    "analyze-button", "loading", "error", "empty-state", "results", "model-switch", "timing-status",
    "format-status", "onboarding", "onboarding-index", "onboarding-text", "onboarding-next",
    "onboarding-guide", "guide-button"]) element(name);
  const context = {
    innerWidth, innerHeight, performance, Date, crypto: { randomUUID: () => "id" },
    setTimeout, clearTimeout, setInterval: () => 1, clearInterval() {},
    document: {
      documentElement: element("html"), body: element("body"), title: "页面",
      createElement: (tag) => element(tag),
      querySelector: () => null, querySelectorAll: () => [],
      addEventListener() {}, removeEventListener() {},
    },
    window: { addEventListener() {} },
    ResizeObserver: class { constructor(callback) { resizeObserverCallback = callback; } observe() {} disconnect() {} },
    MutationObserver: class { observe() {} disconnect() {} },
    ZhihuSiteAccess: { watch(callback) { callback(true); } },
    ZhihuDraggable: { attach: () => ({ moved: false, moveTo() {} }) },
    ZhihuPageText: { extractDetailed: () => ({ text: "正文", originalPartial: false, originalUnavailableReason: "" }) },
    ZhihuUiTheme: "",
    getSelection: () => ({ toString: () => "" }),
    chrome: { runtime: { onMessage: { addListener() {} }, sendMessage: async () => ({ ok: false }) } },
  };
  context.globalThis = context;
  vm.runInNewContext(source, context);
  return { writes, shadow, resize: () => resizeObserverCallback?.() };
}

test("a settled dock layout stops writing styles when its own resize fires back", () => {
  const ui = mount();
  const before = ui.writes.length;
  // The observer watches the element this layout mutates, so re-entering it
  // must settle instead of queueing an identical write on every callback.
  for (let round = 0; round < 25; round++) ui.resize();
  assert.deepEqual(ui.writes.slice(before), []);
});

test("the bubble and the panel share one positioned dock", () => {
  const ui = mount();
  const dock = ui.shadow.querySelector(".assistant-dock");
  const ball = ui.shadow.querySelector(".floating-ball");
  const panel = ui.shadow.querySelector(".panel");
  // Only the dock is positioned; children rely on flex order, so dragging the
  // bubble cannot detach the panel from it.
  assert.match(`${dock.style.right} ${dock.style.bottom}`, /px/);
  assert.equal(ball.style.left, "");
  assert.equal(panel.style.left, "");
});
