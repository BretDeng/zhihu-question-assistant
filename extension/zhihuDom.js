// Shared DOM helpers for the Zhihu content scripts. Both the composer and the
// topic picker poll the page, so these run often and must stay cheap.
globalThis.ZhihuDom ||= (() => {
  // Read each candidate's geometry once, avoiding redundant layout reads.
  const visible = (el) => {
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };
  // Act only when the match is unambiguous, so we never click the wrong control.
  const unique = (items) => items.length === 1 ? items[0] : null;
  return Object.freeze({ visible, unique });
})();
