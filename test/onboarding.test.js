import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { SITE_RULES_KEY, isSiteExcluded } from "../extension/siteRules.js";
import { DESCRIPTION_MODE_KEY } from "../extension/draftPreferences.js";

async function background() {
  const source = await readFile(new URL("../extension/serviceWorker.js", import.meta.url), "utf8");
  const stored = {}, created = [], messages = [];
  let listener, installed, changed;
  const chrome = {
    runtime: {
      onMessage: { addListener(fn) { listener = fn; } },
      onInstalled: { addListener(fn) { installed = fn; } },
      getURL: (path) => `chrome-extension://id/${path}`,
    },
    storage: {
      local: {
        get: async (keys) => Object.fromEntries([keys].flat().filter((key) => key in stored).map((key) => [key, stored[key]])),
        set: async (values) => { Object.assign(stored, values); },
        remove: async (key) => { delete stored[key]; },
      },
      onChanged: { addListener(fn) { changed = fn; } },
    },
    tabs: {
      create: async (options) => { created.push(options.url); return { id: 9 }; },
      onRemoved: { addListener() {} },
      query: async () => [{ id: 1 }],
      sendMessage: async (id, message) => messages.push(message.type),
    },
  };
  vm.runInNewContext(source.replace(/^import .*?;\n/gm, ""), { chrome, SITE_RULES_KEY, DESCRIPTION_MODE_KEY, isSiteExcluded });
  const send = (message) => new Promise((resolve) => { if (listener(message, { tab: { id: 1 }, url: "https://a.com" }, resolve) !== true) resolve(undefined); });
  return { stored, created, messages, send, install: (reason) => installed({ reason }), change: (changes) => changed(changes, "local") };
}

test("the guide opens on first install only and from page messages", async () => {
  const bg = await background();
  bg.install("update");
  bg.install("install");
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(bg.created, ["chrome-extension://id/guide.html"]);
  assert.equal((await bg.send({ type: "OPEN_GUIDE" })).ok, true);
  assert.equal(bg.created.length, 2);
});

test("onboarding and ball position are persisted with validated values only", async () => {
  const bg = await background();
  assert.deepEqual(JSON.parse(JSON.stringify((await bg.send({ type: "GET_UI_STATE" })).data)), { onboardingSeen: false, ballPosition: null });
  await bg.send({ type: "SET_ONBOARDING_SEEN" });
  assert.equal(await bg.send({ type: "SET_BALL_POSITION", position: { x: 2, y: 0.5 } }), undefined);
  assert.equal(await bg.send({ type: "SET_BALL_POSITION", position: { x: "1", y: 0.5 } }), undefined);
  assert.equal("ballPosition" in bg.stored, false);
  assert.equal((await bg.send({ type: "SET_BALL_POSITION", position: { x: 0.25, y: 1, extra: "dropped" } })).ok, true);
  assert.deepEqual(JSON.parse(JSON.stringify(bg.stored.ballPosition)), { x: 0.25, y: 1 });
  assert.deepEqual(JSON.parse(JSON.stringify((await bg.send({ type: "GET_UI_STATE" })).data)), { onboardingSeen: true, ballPosition: { x: 0.25, y: 1 } });
  await bg.send({ type: "SET_BALL_POSITION", position: null });
  assert.equal("ballPosition" in bg.stored, false);
});

test("simultaneous setting changes broadcast every affected notification", async () => {
  const bg = await background();
  bg.change({ [SITE_RULES_KEY]: {}, [DESCRIPTION_MODE_KEY]: {}, modelProfiles: {} });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(bg.messages, ["SITE_RULES_CHANGED", "DESCRIPTION_MODE_CHANGED", "MODEL_CHANGED"]);
});
