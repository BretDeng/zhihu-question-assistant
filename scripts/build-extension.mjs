import { mkdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const manifest = JSON.parse(await readFile(path.join(root, "extension/manifest.json"), "utf8"));
const name = `ZhihuQuestionAssistant-Extension-${manifest.version}.zip`;
await mkdir(path.join(root, "dist"), { recursive: true });
const destination = path.join(root, "dist", name);
const files = ["manifest.json", "modelClient.js", "modelProfiles.js", "uiTheme.js", "draftPreferences.js", "descriptionLimit.js", "pageText.js", "siteRules.js", "siteAccess.js", "draggable.js", "serviceWorker.js", "popup.html", "popup.js", "styles.css", "guide.html", "guide.js", "guide.css", "faq.js", "contentScript.js", "zhihuDom.js", "zhihuComposer.js", "zhihuTopics.js", "zhihuDraftLifecycle.js", "zhihuDraft.js"];
// The packaged extension must contain every file it loads: manifest entries,
// page <script>/<link> tags, and the ES module import graph behind them.
const read = (name) => readFile(path.join(root, "extension", name), "utf8");
const referenced = new Set([...(await read("manifest.json")).matchAll(/"([\w.-]+\.(?:js|html|css))"/g)].map((match) => match[1]));
for (const page of ["popup.html", "guide.html"]) {
  referenced.add(page);
  for (const match of (await read(page)).matchAll(/(?:src|href)="([\w.-]+\.(?:js|css))"/g)) referenced.add(match[1]);
}
for (const name of referenced) {
  if (!name.endsWith(".js")) continue;
  for (const match of (await read(name)).matchAll(/(?:from|import)\s*"\.\/([\w.-]+\.js)"/g)) referenced.add(match[1]);
}
const missing = [...referenced].filter((name) => !files.includes(name));
if (missing.length) throw new Error(`打包清单缺少被引用的文件：${missing.join("、")}`);
const result = spawnSync("zip", ["-q", "-X", destination, ...files], { cwd: path.join(root, "extension"), stdio: "inherit" });
if (result.error || result.status !== 0) throw new Error("ZIP 打包失败，请确认开发机器安装了 zip 命令。");
console.log(destination);
console.log(`SHA-256: ${createHash("sha256").update(await readFile(destination)).digest("hex")}`);
