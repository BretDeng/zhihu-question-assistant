// Read only the current page's policy, never expose trusted model/key storage.
globalThis.ZhihuSiteAccess ||= (() => {
  function watch(onChange) {
    let revision = 0;
    let previous;
    let stopped = false;
    async function refresh() {
      const current = ++revision;
      try {
        const reply = await chrome.runtime.sendMessage({ type: "GET_SITE_ACCESS" });
        if (stopped || current !== revision || !reply?.ok) return;
        const enabled = reply.data.enabled === true;
        if (enabled !== previous) { previous = enabled; onChange(enabled); }
      } catch { /* Keep the current UI unchanged if the extension reloads. */ }
    }
    const onMessage = message => { if (message?.type === "SITE_RULES_CHANGED") refresh(); };
    chrome.runtime.onMessage.addListener(onMessage);
    refresh();
    return () => { stopped = true; chrome.runtime.onMessage.removeListener(onMessage); };
  }
  return { watch };
})();
