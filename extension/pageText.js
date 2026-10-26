globalThis.ZhihuPageText = (() => {
  const OMIT = "nav,aside,footer,form,button,input,select,textarea,script,style,noscript,template,svg,iframe,[hidden],[aria-hidden='true'],[role='navigation'],[role='dialog'],[role='menu'],[role='toolbar'],#zhihu-question-assistant-root,#zhihu-question-draft-root";
  const BODY_SELECTORS = "[itemprop='articleBody'],.article-content,.articleContent,.article-body,.articleBody,.entry-content,.post-content,.post-body,#article-content,#articleContent,#js_content,.rich_media_content";
  const BLOCKS = new Set(["P", "DIV", "H1", "H2", "H3", "H4", "H5", "H6", "LI", "BLOCKQUOTE", "PRE", "TR", "SECTION", "ARTICLE"]);
  const NOISE = /(?:^|[\s_-])(?:sidebar|recommend(?:ation)?s?|related|comments?|share|social|breadcrumb|advert(?:isement)?|ads|paywall|subscribe|toolbar|navigation|menu)(?:$|[\s_-])/i;
  const PAYWALL_TEXT = /finish reading|continue reading|keep reading|订阅后|继续阅读/i;

  function reader(doc) {
    const cache = new WeakMap();
    const exclusions = new WeakMap();
    const caixin = /(^|\.)caixin\.com$/i.test(doc.location?.hostname || "");
    function visible(element) {
      const style = doc.defaultView?.getComputedStyle(element);
      return !element.hidden && style?.display !== "none" && style?.visibility !== "hidden" && style?.visibility !== "collapse" && style?.contentVisibility !== "hidden";
    }
    function classLabel(element) {
      // paywall-content is the readable body on sites such as Foreign Affairs.
      // Remove that token before the noise test so the gate named "paywall" is still skipped.
      return `${element.id} ${element.getAttribute("class") || ""}`.replace(/(?:^|[\s_-])paywall[-_]content(?=$|[\s_-])/ig, " ");
    }
    function omitted(element) {
      if (exclusions.has(element)) return exclusions.get(element);
      // Page-level classes describe site features (WeChat's body has "comment_feature"), not noise regions.
      const shell = element.tagName === "BODY" || element.tagName === "HTML";
      // Match Caixin's verified AI-instruction marker, not words in real prose.
      const result = element.matches(OMIT) || (!shell && NOISE.test(classLabel(element))) || (caixin && element.matches(".aitt")) || !visible(element);
      exclusions.set(element, result);
      return result;
    }
    function paywallGate(element) {
      const raw = `${element.id} ${element.getAttribute("class") || ""}`;
      return /(?:^|[\s_-])paywall(?:$|[\s_-])/i.test(raw) && !/(?:^|[\s_-])paywall[-_]content(?:$|[\s_-])/i.test(raw);
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
      return { text: value, element, score: prose + Math.min(value.length, 500) - links };
    }
    function best(elements, generic = false) {
      return [...new Set(elements)].slice(0, 250).map(element => candidate(element, generic)).filter(Boolean).sort((a, b) => b.score - a.score)[0] || null;
    }
    function rendered(element) {
      for (let node = element; node; node = node.parentElement) if (!visible(node)) return false;
      return true;
    }
    return { block, best, rendered, allowed, caixin, paywallGate };
  }

  const MAX_IMAGES = 6;
  // Article figures only: same container as the extracted text, visible, large
  // enough to be content rather than icons, avatars, logos or tracking pixels.
  function articleImages(read, containers, doc) {
    const base = doc.baseURI || doc.location?.href;
    const seen = new Set();
    const images = [];
    for (const img of containers.filter(Boolean).flatMap(container => [...container.querySelectorAll("img")])) {
      if (images.length >= MAX_IMAGES) break;
      if (!read.allowed(img) || !read.rendered(img)) continue;
      // Loaded images are checked here; lazy ones are verified after download.
      const width = img.naturalWidth || Number(img.getAttribute("width")) || 0;
      const height = img.naturalHeight || Number(img.getAttribute("height")) || 0;
      if (width && height && (width < 200 || height < 120)) continue;
      const raw = img.currentSrc || img.getAttribute("data-src") || img.getAttribute("data-original") || img.getAttribute("src") || "";
      let url;
      try { url = new URL(raw, base); } catch { continue; }
      if (!/^https?:$/.test(url.protocol) || /\.svg(?:$|\?)/i.test(url.pathname) || /(?:^|[\W_])(?:logo|avatar|icon|qrcode|sprite)(?:$|[\W_])/i.test(url.pathname)) continue;
      url.hash = "";
      if (seen.has(url.href) || url.href.length > 2048) continue;
      seen.add(url.href);
      images.push(url.href);
    }
    return images;
  }

  function extractDetailed(doc = document) {
    const read = reader(doc);
    let found;
    if (read.caixin) {
      // Actual article container, not the header's AI prompt.
      found = read.best(doc.querySelectorAll("#Main_Content_Val"));
    } else {
      found = read.best(doc.querySelectorAll(BODY_SELECTORS)) || read.best(doc.querySelectorAll("article")) || read.best(doc.querySelectorAll("main,[role='main']"), true);
      if (!found) {
        // Limited prose-container fallback, never the entire page/body shell.
        const parents = [...doc.querySelectorAll("p")].filter(p => read.block(p).length >= 80).flatMap(p => [p.parentElement, p.parentElement?.parentElement]).filter(Boolean);
        found = read.best(parents, true);
      }
    }
    const text = found?.text || "";
    const caixinPartial = read.caixin && [...doc.querySelectorAll("#chargeWall")].some(element => read.rendered(element) && /订阅后继续阅读|订阅后阅读/.test(element.innerText || ""));
    // Ask the engine for the few paywall-named nodes instead of walking every
    // div on the page, limiting candidate traversal and innerText reads.
    const paywallPartial = Boolean(text) && [...doc.querySelectorAll("[class*='paywall' i],[id*='paywall' i]")]
      .some(element => read.paywallGate(element) && read.rendered(element) && PAYWALL_TEXT.test(element.innerText || ""));
    let images = [];
    // Caixin places the lead photo just above the text container.
    const containers = read.caixin ? [...doc.querySelectorAll(".article_media_pic"), found?.element] : [found?.element];
    try { images = articleImages(read, containers, doc); } catch { /* Images are optional. */ }
    return { text, images, originalPartial: Boolean(caixinPartial || paywallPartial), originalUnavailableReason:
      !text ? "未找到可靠的文章正文，已停止复制页面菜单和其他杂项。请等待正文加载后重试，或切换为「概括提问」并选中所需内容。" : "" };
  }
  return { extract: (doc = document) => extractDetailed(doc).text, extractDetailed, extractBlock: element => reader(element.ownerDocument || document).block(element) };
})();
