// The side panel hosts the same question panel as the floating one. It reads
// the page through the content script of the active tab in this window.
(() => {
  const host = document.querySelector("#root");
  // A shadow root keeps the panel's :host theme rules identical to the page version.
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `<style>:host{all:initial;display:block;height:100%} ${globalThis.ZhihuUiTheme || ""}${ZhihuQuestionPanel.styles()}</style>${ZhihuQuestionPanel.markup({ closeLabel: "关闭侧边栏" })}`;
  const UNREADABLE = "无法读取这个页面。刚安装或更新扩展后请先刷新网页；浏览器内置页面、扩展商店和已排除的网站不能分析。";
  let sourceTabId = null;

  async function activeTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error(UNREADABLE);
    return tab;
  }
  async function askTab(message) {
    const tab = await activeTab();
    let reply;
    try { reply = await chrome.tabs.sendMessage(tab.id, message); }
    catch { throw new Error(UNREADABLE); }
    if (!reply?.ok) throw new Error(reply?.error || UNREADABLE);
    return { tab, data: reply.data };
  }

  const ui = ZhihuQuestionPanel.bind(shadow, {
    async getPage() {
      const { tab, data } = await askTab({ type: "EXTRACT_PAGE_CONTENT" });
      sourceTabId = tab.id;
      return data;
    },
    // The worker cannot see which tab a side panel means, so it is passed along.
    requestFields: () => ({ tabId: sourceTabId }),
    clearSelection: () => askTab({ type: "CLEAR_PAGE_SELECTION" }),
    isActive: () => true,
    onClose: () => window.close(),
  });
  shadow.querySelector(".panel").classList.add("is-embedded");

  // Show which page "分析当前网页" will read, and its selection, as tabs change.
  let infoRevision = 0;
  async function refreshPage() {
    const revision = ++infoRevision;
    try {
      const { data } = await askTab({ type: "GET_PAGE_INFO" });
      if (revision !== infoRevision) return;
      ui.setPageInfo(`当前网页 · ${data.title || data.url}`);
      ui.setSelection(data.selection);
    } catch (error) {
      if (revision !== infoRevision) return;
      ui.setPageInfo(error.message === UNREADABLE ? "当前页面无法分析" : error.message);
      ui.setSelection(0);
    }
  }
  chrome.tabs.onActivated.addListener(refreshPage);
  chrome.tabs.onUpdated.addListener((_tabId, change, tab) => { if (tab.active && change.status === "complete") refreshPage(); });
  // Selecting text happens in the page; re-read it when the user comes back here.
  window.addEventListener("focus", refreshPage);
  document.addEventListener("pointerenter", refreshPage);
  ui.refresh();
  refreshPage();
})();
