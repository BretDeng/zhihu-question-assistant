import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
const source = await readFile(new URL("../extension/draggable.js", import.meta.url), "utf8");
function setup() {
  const listeners = new Map(); let resize;
  const element = {
    style: {}, title: "问", captured: null,
    closest: () => element,
    getBoundingClientRect() { return { left: parseFloat(this.style.left || 500), top: parseFloat(this.style.top || 400), width: 48, height: 48 }; },
    addEventListener(type, fn) { listeners.set(type, fn); },
    removeEventListener(type) { listeners.delete(type); },
    setPointerCapture(id) { this.captured = id; }, hasPointerCapture(id) { return this.captured === id; }, releasePointerCapture() { this.captured = null; },
  };
  const context = { innerWidth: 800, innerHeight: 600, window: { addEventListener(_type, fn) { resize = fn; }, removeEventListener() {} }, ResizeObserver: class { observe() {} disconnect() {} } };
  vm.runInNewContext(source, context);
  const draggable = context.ZhihuDraggable.attach(element);
  const event = (type, overrides = {}) => {
    const value = { target: element, pointerId: 1, button: 0, clientX: 510, clientY: 410, detail: 1, preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; }, ...overrides };
    listeners.get(type)?.(value); return value;
  };
  return { element, draggable, event, context, resize: () => resize(), listeners };
}
test("drag moves the widget but suppresses its click, while a normal click remains usable", () => {
  const { element, draggable, event } = setup();
  event("pointerdown"); event("pointermove", { clientX: 210, clientY: 110 }); event("pointerup");
  assert.equal(element.style.left, "200px"); assert.equal(element.style.top, "100px"); assert.equal(draggable.moved, true);
  assert.equal(event("click").stopped, true);
  event("pointerdown"); event("pointermove", { clientX: 512 }); event("pointerup");
  assert.equal(event("click").stopped, undefined);
});
test("drag is clamped to viewport and re-clamped after window resize", () => {
  const { draggable, element, context, resize } = setup();
  draggable.moveTo(-999, 999);
  assert.equal(element.style.left, "8px"); assert.equal(element.style.top, "544px");
  context.innerHeight = 300; resize(); assert.equal(element.style.top, "244px");
});
test("buttons and input fields inside a title bar do not initiate dragging", () => {
  const { event, draggable } = setup();
  event("pointerdown", { target: { closest: () => ({ tagName: "BUTTON" }) } });
  event("pointermove", { clientX: 10 }); assert.equal(draggable.moved, false);
});
test("cancel releases pointer capture and destroy removes listeners", () => {
  const { event, draggable, element, listeners } = setup();
  event("pointerdown"); event("pointercancel"); assert.equal(element.captured, null);
  event("pointermove", { clientX: 0 }); assert.equal(draggable.moved, false);
  draggable.destroy(); assert.equal(listeners.size, 0);
});
