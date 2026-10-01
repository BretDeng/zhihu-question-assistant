(() => {
  const normalize = (value) => String(value || "").normalize("NFKC").replace(/\s+/g, "").trim();
  function isPublishedDraft(draft, pathname, title) {
    return /^\/question\/\d+(?:\/answer\/\d+)?\/?$/.test(pathname)
      && Boolean(normalize(title))
      && normalize(title) === normalize(draft.publishedTitle || draft.question);
  }
  function watch(draft, onPublished, onPublishTitle) {
    let stopped = false;
    const check = () => {
      if (stopped) return;
      const title = (document.querySelector(".QuestionHeader-title") || document.querySelector("h1[itemprop='name'], h1"))?.textContent;
      if (isPublishedDraft(draft, location.pathname, title)) { stop(); onPublished(); }
    };
    const rememberTitle = (event) => {
      const title = globalThis.ZhihuQuestionComposer?.findTitle();
      const composer = title?.closest(".Ask-form, [role='dialog'], .Modal");
      if (!composer || !composer.contains(event.target)) return;
      if (event.type === "click") {
        const button = event.target.closest("button, [role='button'], input[type='submit']");
        if (!button || button.disabled || button.getAttribute("aria-disabled") === "true"
          || !/^(发布问题|发布提问|提问|发布)$/.test((button.textContent || button.value || "").trim())) return;
      }
      const value = title.value.trim().slice(0, 500);
      if (value) { draft.publishedTitle = value; onPublishTitle(value); }
    };
    const observer = new MutationObserver(check);
    const interval = setInterval(check, 1000); // Also covers SPA URL changes without DOM events.
    function stop() {
      if (stopped) return;
      stopped = true; observer.disconnect(); clearInterval(interval);
      document.removeEventListener("click", rememberTitle, true);
      document.removeEventListener("submit", rememberTitle, true);
      window.removeEventListener("popstate", check);
      window.removeEventListener("pagehide", stop);
    }
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    document.addEventListener("click", rememberTitle, true);
    document.addEventListener("submit", rememberTitle, true);
    window.addEventListener("popstate", check);
    window.addEventListener("pagehide", stop);
    check();
    return stop;
  }
  globalThis.ZhihuDraftLifecycle = { isPublishedDraft, watch };
})();
