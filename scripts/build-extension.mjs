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
const files = ["manifest.json", "modelClient.js", "modelProfiles.js", "uiTheme.js", "draftPreferences.js", "pageText.js", "siteRules.js", "siteAccess.js", "draggable.js", "serviceWorker.js", "popup.html", "popup.js", "styles.css", "guide.html", "guide.js", "guide.css", "faq.js", "contentScript.js", "zhihuComposer.js", "zhihuTopics.js", "zhihuDraftLifecycle.js", "zhihuDraft.js"];
const result = spawnSync("zip", ["-q", "-X", destination, ...files], { cwd: path.join(root, "extension"), stdio: "inherit" });
if (result.error || result.status !== 0) throw new Error("ZIP 打包失败，请确认开发机器安装了 zip 命令。");
console.log(destination);
console.log(`SHA-256: ${createHash("sha256").update(await readFile(destination)).digest("hex")}`);
