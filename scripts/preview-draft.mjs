import http from "node:http";
import { readFile } from "node:fs/promises";

// Serve only public UI fixtures and allowlisted extension files, never keys.
const routes = new Map([
  ["/", ["../test/fixtures/zhihu-draft.html", "text/html"]],
  ["/zhihu-draft-fixture.js", ["../test/fixtures/zhihu-draft-fixture.js", "text/javascript"]],
  ["/extension/zhihuComposer.js", ["../extension/zhihuComposer.js", "text/javascript"]],
  ["/extension/zhihuTopics.js", ["../extension/zhihuTopics.js", "text/javascript"]],
  ["/extension/zhihuDraft.js", ["../extension/zhihuDraft.js", "text/javascript"]],
  ["/extension/zhihuDraftLifecycle.js", ["../extension/zhihuDraftLifecycle.js", "text/javascript"]],
  ["/models", ["../extension/popup.html", "text/html"]],
  ["/questions", ["../test/fixtures/questions.html", "text/html"]],
  ["/extraction", ["../test/fixtures/page-text.html", "text/html"]],
  ["/page-text-fixture.js", ["../test/fixtures/page-text-fixture.js", "text/javascript"]],
  ["/ui-fixture.js", ["../test/fixtures/ui-fixture.js", "text/javascript"]],
  ...["popup.js", "uiTheme.js", "draftPreferences.js", "pageText.js", "siteRules.js", "siteAccess.js", "draggable.js", "modelProfiles.js", "modelClient.js", "contentScript.js"].flatMap((name) => [[`/${name}`, [`../extension/${name}`, "text/javascript"]], [`/extension/${name}`, [`../extension/${name}`, "text/javascript"]]]),
  ["/styles.css", ["../extension/styles.css", "text/css"]],
]);
http.createServer(async (request, response) => {
  const pathname = new URL(request.url, "http://127.0.0.1").pathname;
  const route = routes.get(pathname);
  if (!route) { response.writeHead(404); response.end(); return; }
  try {
    let content = await readFile(new URL(route[0], import.meta.url));
    if (pathname === "/models") content = content.toString().replace('<script src="uiTheme.js">', '<script src="/ui-fixture.js"></script><script src="uiTheme.js">');
    response.writeHead(200, { "Content-Type": `${route[1]}; charset=utf-8`, "Cache-Control": "no-store" });
    response.end(content);
  } catch { response.writeHead(500); response.end(); }
}).listen(8767, "127.0.0.1", () => console.log("Draft fixture: http://127.0.0.1:8767/ (Ctrl+C to stop)"));
