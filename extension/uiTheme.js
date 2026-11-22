globalThis.ZhihuUiTheme = `
  :root, :host {
    --qa-bg:#f4f4f7; --qa-surface:#fff; --qa-sub:#f6f6f8; --qa-ink:#1f1f23; --qa-muted:#6c6c75;
    --qa-line:#e4e4e9; --qa-accent:#056de8; --qa-accent-hover:#0459c2; --qa-accent-strong:#0a4fa8;
    --qa-accent-line:#b9d4f7; --qa-soft:#eaf2fd; --qa-danger:#c23b4a; --qa-danger-soft:#fdf0f1;
    --qa-shadow:0 2px 5px #21213408,0 12px 32px #2121340b;
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;
    color:var(--qa-ink); font-size:13px; line-height:1.6; color-scheme:light;
  }
  *, *::before, *::after { box-sizing:border-box; }
  button,input,textarea,select { font:inherit; }
  button { cursor:pointer; transition:background .16s,border-color .16s; }
  button:disabled { opacity:.5; cursor:wait; }
  button:focus-visible,summary:focus-visible { outline:2px solid var(--qa-accent); outline-offset:2px; }
  input,textarea,select { color:var(--qa-ink); background:var(--qa-surface); border:1px solid var(--qa-line); border-radius:8px; padding:10px 12px; outline:none; }
  input:focus,textarea:focus,select:focus { border-color:var(--qa-accent); box-shadow:0 0 0 3px #056de81f; }
  .qa-primary,.qa-secondary { border-radius:8px; padding:9px 13px; font-weight:600; }
  .qa-primary { color:white; background:var(--qa-accent); border:1px solid var(--qa-accent); }
  .qa-primary:hover { background:var(--qa-accent-hover); }
  .qa-secondary { color:var(--qa-ink); background:var(--qa-surface); border:1px solid var(--qa-line); }
  .qa-secondary:hover { background:var(--qa-sub); border-color:#c9cdd6; }
  .qa-quiet { border:0; background:transparent; color:var(--qa-muted); padding:6px 8px; border-radius:6px; }
  .qa-quiet:hover { color:var(--qa-accent); background:var(--qa-soft); }
  .qa-label { display:block; font-size:12px; font-weight:600; color:var(--qa-muted); margin:0 0 6px; }
  .is-hidden { display:none!important; }
  @media(prefers-reduced-motion:reduce) { * { animation:none!important; transition:none!important; } }
`;
