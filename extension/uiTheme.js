globalThis.ZhihuUiTheme = `
  :root, :host {
    --qa-bg:#f4f4f7; --qa-surface:#fff; --qa-ink:#25252b; --qa-muted:#767681;
    --qa-line:#e2e2e8; --qa-accent:#6250ff; --qa-soft:#efedff; --qa-danger:#b33d4c;
    --qa-shadow:0 2px 5px #21213408,0 12px 32px #2121340b;
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;
    color:var(--qa-ink); font-size:13px; line-height:1.6; color-scheme:light;
  }
  *, *::before, *::after { box-sizing:border-box; }
  button,input,textarea,select { font:inherit; }
  button { cursor:pointer; transition:background .16s,border-color .16s; }
  button:disabled { opacity:.5; cursor:wait; }
  button:focus-visible,summary:focus-visible { outline:2px solid var(--qa-accent); outline-offset:3px; }
  input,textarea,select { color:var(--qa-ink); background:var(--qa-surface); border:1px solid var(--qa-line); border-radius:10px; padding:10px 12px; outline:none; }
  input:focus,textarea:focus,select:focus { border-color:var(--qa-accent); box-shadow:0 0 0 3px #6250ff12; }
  .qa-primary,.qa-secondary { border-radius:10px; padding:9px 13px; font-weight:600; }
  .qa-primary { color:white; background:var(--qa-accent); border:1px solid var(--qa-accent); box-shadow:0 2px 3px #6250ff19; }
  .qa-primary:hover { background:#5140eb; }
  .qa-secondary { color:var(--qa-ink); background:white; border:1px solid var(--qa-line); box-shadow:0 1px 2px #21213408; }
  .qa-secondary:hover { background:#f8f8fb; border-color:#c5c3d6; }
  .qa-quiet { border:0; background:transparent; color:var(--qa-muted); padding:6px 8px; border-radius:8px; }
  .qa-quiet:hover { color:var(--qa-accent); background:var(--qa-soft); }
  .qa-label { display:block; font-size:11px; font-weight:600; color:var(--qa-muted); margin:0 0 6px; }
  .is-hidden { display:none!important; }
  @media(prefers-reduced-motion:reduce) { * { animation:none!important; transition:none!important; } }
`;
