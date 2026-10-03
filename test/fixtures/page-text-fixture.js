// Use the real DOM and CSS, with only the host changed to test the site adapter.
const fixture = document.querySelector("#fixture");
fixture.style.display = "block";
const doc = { location: { hostname: "finance.caixin.com" }, defaultView: window, querySelectorAll: selector => fixture.querySelectorAll(selector) };
const result = ZhihuPageText.extractDetailed(doc);
document.querySelector("#extracted").textContent = result.text;
const expected = [...fixture.querySelectorAll("#Main_Content_Val > p:not(.aitt)")].map(p => p.innerText.trim()).join("\n");
const pass = result.text === expected && !result.originalUnavailableReason && !/Kimi|商城|订阅|退出|AI 指令|隐藏付费|相关推荐/.test(result.text) && !result.text.includes("\n\n");
document.querySelector("#checks").textContent = pass ? "通过：只读取两段正文，保留行内文字和末尾，无空行、菜单或 AI 提示。" : "失败：正文提取不符合预期。";
document.documentElement.dataset.extractionPass = String(pass);
const wall = document.createElement("div"); wall.id = "chargeWall"; wall.textContent = "本文共计1678字，订阅后继续阅读"; fixture.append(wall);
const preview = ZhihuPageText.extractDetailed(doc);
document.querySelector("#partial").textContent = preview.originalPartial ? "仅包含已加载部分，可继续生成，不会因为订阅提示中止。" : "未检测到部分正文。";
document.documentElement.dataset.partialPass = String(preview.originalPartial && !preview.originalUnavailableReason && preview.text === expected);
fixture.style.display = "none";
