globalThis.ZhihuPageText = (() => {
  const OMIT = "nav,aside,footer,form,button,input,select,textarea,script,style,noscript,template,svg,iframe,[hidden],[aria-hidden='true'],[role='navigation'],[role='dialog'],[role='menu'],[role='toolbar'],#zhihu-question-assistant-root,#zhihu-question-draft-root";
  const BODY_SELECTORS = "[itemprop='articleBody'],.article-content,.articleContent,.article-body,.articleBody,.entry-content,.post-content,.post-body,#article-content,#articleContent,#js_content,.rich_media_content";
  const BLOCKS = new Set(["P", "DIV", "H1", "H2", "H3", "H4", "H5", "H6", "LI", "BLOCKQUOTE", "PRE", "TR", "SECTION", "ARTICLE"]);
  const NOISE = /(?:^|[\s_-])(?:sidebar|recommend(?:ation)?s?|related|comments?|share|social|breadcrumb|advert(?:isement)?|ads|paywall|subscribe|toolbar|navigation|menu)(?:$|[\s_-])/i;

  function reader(doc) {
    const cache = new WeakMap();
    const exclusions = new WeakMap();
    const caixin = /(^|\.)caixin\.com$/i.test(doc.location?.hostname || "");
    function visible(element) {
      const style = doc.defaultView?.getComputedStyle(element);
      return !element.hidden && style?.display !== "none" && style?.visibility !== "hidden" && style?.visibility !== "collapse" && style?.contentVisibility !== "hidden";
    }
    function omitted(element) {
      if (exclusions.has(element)) return exclusions.get(element);
      // Page-level classes describe site features (WeChat's body has "comment_feature"), not noise regions.
      const shell = element.tagName === "BODY" || element.tagName === "HTML";
      // Match Caixin's verified AI-instruction marker, not words in real prose.
      const result = element.matches(OMIT) || (!shell && NOISE.test(`${element.id} ${element.getAttribute("class") || ""}`)) || (caixin && element.matches(".aitt")) || !visible(element);
      exclusions.set(element, result);
      return result;
    }
    function allowed(element) {
      for (let node = element; node; node = node.parentElement) if (omitted(node)) return false;
      return true;
    }
    function text(node) {
      if (node.nodeType === 3) return node.nodeValue || "";
      if (node.nodeType !== 1 || omitted(node)) return "";
      if (cache.has(node)) return cache.get(node);
      if (node.tagName === "BR") return "\n";
      const value = [...node.childNodes].map(text).join("");
      const result = BLOCKS.has(node.tagName) ? `\n${value}\n` : value;
      cache.set(node, result);
      return result;
    }
    function block(element) {
      if (!allowed(element)) return "";
      return text(element).replace(/\u00a0/g, " ").replace(/\r\n?/g, "\n").split("\n").map(line => line.trim()).filter(Boolean).join("\n");
    }
    function candidate(element, generic = false) {
      if (["BODY", "HTML"].includes(element.tagName)) return null;
      const value = block(element);
      if (value.length < (generic ? 160 : 80)) return null;
      const paragraphs = [...element.querySelectorAll("p")].map(block).filter(part => part.length >= 40);
      const prose = paragraphs.reduce((sum, part) => sum + part.length, 0);
      const links = [...element.querySelectorAll("a")].reduce((sum, link) => sum + block(link).length, 0);
      // Reject navigation/index pages; links inside genuine prose are retained.
      if (links > value.length * 0.5 || (generic && (prose < 120 || prose < value.length * 0.5))) return null;
      return { text: value, score: prose + Math.min(value.length, 500) - links };
    }
    function best(elements, generic = false) {
      return [...new Set(elements)].slice(0, 250).map(element => candidate(element, generic)).filter(Boolean).sort((a, b) => b.score - a.score)[0]?.text || "";
    }
    function rendered(element) {
      for (let node = element; node; node = node.parentElement) if (!visible(node)) return false;
      return true;
    }
    return { block, best, rendered, caixin };
  }

  function extractDetailed(doc = document) {
    const read = reader(doc);
    let text;
    if (read.caixin) {
      // Actual article container, not the header's AI prompt.
      text = read.best(doc.querySelectorAll("#Main_Content_Val"));
    } else {
      text = read.best(doc.querySelectorAll(BODY_SELECTORS)) || read.best(doc.querySelectorAll("article")) || read.best(doc.querySelectorAll("main,[role='main']"), true);
      if (!text) {
        // Limited prose-container fallback, never the entire page/body shell.
        const parents = [...doc.querySelectorAll("p")].filter(p => read.block(p).length >= 80).flatMap(p => [p.parentElement, p.parentElement?.parentElement]).filter(Boolean);
        text = read.best(parents, true);
      }
    }
    const partial = read.caixin && [...doc.querySelectorAll("#chargeWall")].some(element => read.rendered(element) && /订阅后继续阅读|订阅后阅读/.test(element.innerText || ""));
    return { text, originalPartial: Boolean(partial), originalUnavailableReason:
      !text ? "未找到可靠的文章正文，已停止复制页面菜单和其他杂项。请等待正文加载后重试，或切换为「概括提问」并选中所需内容。" : "" };
  }
  return { extract: (doc = document) => extractDetailed(doc).text, extractDetailed, extractBlock: element => reader(element.ownerDocument || document).block(element) };
})();
