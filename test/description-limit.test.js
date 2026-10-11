import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import * as preferences from "../extension/draftPreferences.js";

const extension = new URL("../extension/", import.meta.url);
const shared = await readFile(new URL("descriptionLimit.js", extension), "utf8");
function load() {
  const context = { URL };
  context.globalThis = context;
  vm.runInNewContext(shared, context);
  return context.ZhihuDescriptionLimit;
}
const limit = load();
const url = "https://example.com/article";

test("clipping has exactly one implementation, shared by the module and content-script sides", async () => {
  // The module side must re-export the shared object rather than reimplement it.
  assert.equal(preferences.clipDescriptionBody, globalThis.ZhihuDescriptionLimit.clipDescriptionBody);
  assert.equal(preferences.fitDescriptionBody, globalThis.ZhihuDescriptionLimit.fitDescriptionBody);
  assert.equal(preferences.ZHIHU_DESCRIPTION_LIMIT, 3000);
  const composer = await readFile(new URL("zhihuComposer.js", extension), "utf8");
  const prefs = await readFile(new URL("draftPreferences.js", extension), "utf8");
  for (const [name, code] of [["zhihuComposer.js", composer], ["draftPreferences.js", prefs]]) {
    assert.equal(/lastIndexOf\("。"\)/.test(code), false, `${name} must not duplicate the clipping logic`);
    // User-facing wording may mention the citation; building it must not be
    // reimplemented here.
    assert.equal(/引用来源：\$\{/.test(code), false, `${name} must not rebuild the citation suffix`);
    assert.equal(/\b3000\b/.test(code), false, `${name} must not hardcode the limit`);
  }
  // Both content scripts that call it must load the shared file first.
  const manifest = JSON.parse(await readFile(new URL("manifest.json", extension), "utf8"));
  const zhihu = manifest.content_scripts.find((entry) => entry.matches.some((match) => match.includes("zhihu.com"))).js;
  assert.equal(zhihu.indexOf("descriptionLimit.js") < zhihu.indexOf("zhihuComposer.js"), true);
  assert.equal(zhihu.indexOf("descriptionLimit.js") < zhihu.indexOf("zhihuDraft.js"), true);
});

test("a clipped body always leaves room for exactly one citation", () => {
  const bodies = ["字".repeat(5000), Array.from({ length: 500 }, (_, i) => `第${i}段。`).join("\n"),
    "甲".repeat(4000) + "\n乙。", "丙".repeat(2000) + "。" + "丁".repeat(3000), "戊", "", "\n\n\n"];
  for (const source of [url, `https://example.com/${"p".repeat(200)}`, ""]) {
    for (const body of bodies) {
      const final = limit.buildDescription(body, source);
      assert.equal(final.length <= 3000, true, `over limit: ${final.length}`);
      assert.equal(final.split("引用来源：").length - 1 <= 1, true, "at most one citation");
      // The panel's own preview must fit once the editor appends the citation.
      const body2 = limit.fitDescriptionBody(body, source);
      assert.equal(limit.buildDescription(body2, source).length <= 3000, true);
    }
  }
});

test("clipping stays within the budget and preserves source links at the clipping boundary", () => {
  for (let room = 0; room <= 60; room++) {
    for (const body of ["字".repeat(80), "a\nbb\nccc\ndddd", "句。句。句。", "x".repeat(room + 5)]) {
      assert.equal(limit.clipDescriptionBody(body, room).length <= room, true, `room ${room}`);
    }
  }
  const carried = `${"丁".repeat(4000)}。${url}`;
  const final = limit.buildDescription(carried, url);
  assert.equal(/https:\/\/\S*$/.test(final) && !final.endsWith(url), false, "no half-cut URL");
  for (const prefixLength of [2975, 2990, 3005]) {
    const body = `${"字".repeat(prefixLength)} ${url} 后文`;
    const result = limit.buildDescription(body, url);
    assert.ok(result.length <= 3000);
    assert.ok(result.includes(url), "source survives even when it was beyond the cut");
    assert.equal(result.split(url).length - 1, 1);
    assert.ok(!limit.clipDescriptionBody(body, 3000).endsWith("https://example.com/art"));
  }
  const hugeUrl = `https://example.com/${"中".repeat(1500)}`;
  assert.equal(limit.normalizeSourceUrl(hugeUrl), "");
  assert.ok(limit.buildDescription("字".repeat(4000), hugeUrl).length <= 3000);
});
