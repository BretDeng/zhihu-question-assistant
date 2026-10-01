import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
test("popup roots establish width independently of Chrome's initial viewport", async () => {
  const css = await readFile(new URL("../extension/styles.css", import.meta.url), "utf8");
  assert.match(css, /html\{width:440px;min-width:440px\}/);
  assert.match(css, /body\{width:440px;min-width:440px/);
  assert.doesNotMatch(css, /max-width:100vw/);
  assert.match(css, /html\.is-dashboard\{width:auto;min-width:0\}/);
});
test("model settings launched from the webpage use the full dashboard route", async () => {
  const worker = await readFile(new URL("../extension/serviceWorker.js", import.meta.url), "utf8");
  const popup = await readFile(new URL("../extension/popup.js", import.meta.url), "utf8");
  assert.match(worker, /getURL\("popup\.html\?view=dashboard"\)/);
  assert.match(popup, /getURL\("popup\.html\?view=dashboard"\)/);
  assert.match(popup, /classList\.toggle\("is-dashboard", fullDashboard\)/);
});
