export const SPACES_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="color-scheme" content="dark" />
<title>ego-browser console</title>
<style>
  :root {
    color-scheme: dark;
    --frame: #0b0b0e;
    --frame-2: #0f0f13;
    --panel: #141418;
    --raised: #1b1b21;
    --raised-2: #24242b;
    --inset: #09090c;
    --hover: rgba(255, 255, 255, 0.045);
    --hover-2: rgba(255, 255, 255, 0.075);
    --hair: rgba(255, 255, 255, 0.065);
    --hair-2: rgba(255, 255, 255, 0.1);
    --hair-3: rgba(255, 255, 255, 0.16);
    --text: #ededf0;
    --text-2: #a4a4af;
    --text-3: #6f6f7b;
    --text-4: #4b4b55;
    --accent: #7c7ffb;
    --accent-2: #a3a5ff;
    --accent-soft: rgba(124, 127, 251, 0.14);
    --accent-ring: rgba(124, 127, 251, 0.42);
    --emerald: #34d399;
    --emerald-soft: rgba(52, 211, 153, 0.12);
    --amber: #fbbf24;
    --amber-soft: rgba(251, 191, 36, 0.13);
    --sky: #7dd3fc;
    --sky-soft: rgba(125, 211, 252, 0.09);
    --violet: #c4b5fd;
    --rose: #fb7185;
    --rose-soft: rgba(251, 113, 133, 0.14);
    --ease: cubic-bezier(.2, .8, .2, 1);
    --sb-w: 264px;
    --font: "Inter", -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", system-ui, "Ubuntu", "Cantarell", sans-serif;
    --mono: "JetBrains Mono", ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, monospace;
    --shadow-pop: 0 0 0 1px rgba(0, 0, 0, 0.5), 0 18px 48px -10px rgba(0, 0, 0, 0.75), 0 4px 14px rgba(0, 0, 0, 0.35);
  }
  * { box-sizing: border-box; }
  html, body {
    height: 100%;
    margin: 0;
    overflow: hidden;
    color: var(--text);
    background:
      radial-gradient(900px 520px at -8% -12%, rgba(124, 127, 251, 0.09), transparent 62%),
      radial-gradient(700px 480px at 108% 115%, rgba(52, 211, 153, 0.035), transparent 60%),
      var(--frame);
    font: 13px/1.45 var(--font);
    font-feature-settings: "cv11", "ss01", "ss03";
    letter-spacing: -0.003em;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
    font-variant-numeric: tabular-nums;
  }
  svg { display: block; flex-shrink: 0; }
  button { font: inherit; color: inherit; background: none; border: 0; padding: 0; margin: 0; cursor: pointer; }
  button:disabled { cursor: default; }
  :focus { outline: none; }
  :focus-visible { outline: 2px solid var(--accent-ring); outline-offset: 1px; }
  ::selection { background: rgba(124, 127, 251, 0.35); }
  .hidden { display: none !important; }

  /* ---------- Layout ---------- */
  .app {
    display: grid;
    grid-template-columns: var(--sb-w) minmax(0, 1fr);
    height: 100vh;
    transition: grid-template-columns .3s var(--ease);
  }
  .app.collapsed { grid-template-columns: 0px minmax(0, 1fr); }
  .sidebar { min-width: 0; min-height: 0; overflow: hidden; position: relative; }
  .sidebar-inner {
    width: var(--sb-w);
    height: 100%;
    display: flex;
    flex-direction: column;
    transition: opacity .22s var(--ease), transform .3s var(--ease);
  }
  .app.collapsed .sidebar-inner { opacity: 0; transform: translateX(-12px); visibility: hidden; transition: opacity .18s, transform .3s var(--ease), visibility 0s .3s; }
  .main { min-width: 0; min-height: 0; padding: 8px 8px 8px 0; transition: padding .3s var(--ease); }
  .app.collapsed .main { padding-left: 8px; }
  .browser {
    height: 100%;
    display: flex;
    flex-direction: column;
    background: var(--panel);
    border: 1px solid var(--hair-2);
    border-radius: 12px;
    overflow: hidden;
    box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.45), 0 14px 44px -12px rgba(0, 0, 0, 0.7), inset 0 1px 0 rgba(255, 255, 255, 0.035);
    position: relative;
  }

  /* ---------- Shared controls ---------- */
  .icon-btn {
    width: 30px; height: 30px;
    display: inline-grid; place-items: center;
    border-radius: 7px;
    color: var(--text-2);
    transition: background .14s, color .14s, transform .1s;
    flex-shrink: 0;
    text-decoration: none;
  }
  .icon-btn:hover:not(:disabled) { background: var(--hover-2); color: var(--text); }
  .icon-btn:active:not(:disabled) { transform: scale(.94); }
  .icon-btn:disabled { opacity: .32; }
  .icon-btn[aria-expanded="true"] { background: var(--hover-2); color: var(--text); }
  .btn {
    height: 30px;
    padding: 0 11px;
    display: inline-flex; align-items: center; justify-content: center; gap: 6px;
    border-radius: 8px;
    font-size: 12.5px; font-weight: 500;
    white-space: nowrap;
    color: var(--text);
    background: var(--raised);
    border: 1px solid var(--hair-2);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04), 0 1px 2px rgba(0, 0, 0, 0.3);
    transition: background .14s, border-color .14s, filter .14s, transform .1s, color .14s;
    flex-shrink: 0;
  }
  .btn:hover:not(:disabled) { background: var(--raised-2); border-color: var(--hair-3); }
  .btn:active:not(:disabled) { transform: translateY(.5px) scale(.985); }
  .btn:disabled { opacity: .4; }
  .btn.sm { height: 28px; padding: 0 10px; font-size: 12px; }
  .btn-primary {
    color: #fff;
    background: linear-gradient(180deg, #8a8dff 0%, #6d70f2 100%);
    border-color: rgba(255, 255, 255, 0.14);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.24), 0 1px 2px rgba(0, 0, 0, 0.45), 0 6px 16px -6px rgba(124, 127, 251, 0.6);
  }
  .btn-primary:hover:not(:disabled) { background: linear-gradient(180deg, #9497ff 0%, #7578f6 100%); border-color: rgba(255, 255, 255, 0.2); filter: saturate(1.05); }
  .btn-iso { color: var(--sky); background: var(--sky-soft); border-color: rgba(125, 211, 252, 0.18); box-shadow: none; }
  .btn-iso:hover:not(:disabled) { background: rgba(125, 211, 252, 0.15); border-color: rgba(125, 211, 252, 0.32); }
  .btn-amber {
    color: #1f1503; font-weight: 600;
    background: linear-gradient(180deg, #fcd34d 0%, #f5b20b 100%);
    border-color: rgba(255, 255, 255, 0.2);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.4), 0 1px 2px rgba(0, 0, 0, 0.4), 0 6px 18px -6px rgba(251, 191, 36, 0.55);
  }
  .btn-amber:hover:not(:disabled) { background: linear-gradient(180deg, #fde68a 0%, #fbbf24 100%); border-color: rgba(255, 255, 255, 0.3); }
  .btn-quiet { background: transparent; border-color: transparent; box-shadow: none; color: var(--text-2); }
  .btn-quiet:hover:not(:disabled) { background: var(--hover-2); border-color: transparent; color: var(--text); }
  kbd {
    font: 500 10.5px/1 var(--mono);
    display: inline-flex; align-items: center;
    height: 19px; padding: 0 5px;
    border-radius: 5px;
    color: var(--text);
    background: linear-gradient(180deg, #24242b, #1c1c22);
    border: 1px solid var(--hair-2);
    border-bottom-color: rgba(0, 0, 0, 0.55);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.05);
  }

  /* ---------- Status pips & pills ---------- */
  .pip { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; position: relative; }
  .pip.user, .pip.none { box-shadow: inset 0 0 0 1.5px var(--text-3); }
  .pip.agent { background: var(--emerald); box-shadow: 0 0 0 3px var(--emerald-soft); }
  .pip.agent.live::after, .pip.handoff::after {
    content: ""; position: absolute; inset: -4px; border-radius: 50%;
    border: 1.5px solid currentColor; opacity: 0;
    animation: ping 1.8s var(--ease) infinite;
  }
  .pip.agent.live { color: var(--emerald); }
  .pip.handoff { background: var(--amber); color: var(--amber); box-shadow: 0 0 0 3px var(--amber-soft); }
  @keyframes ping { 0% { transform: scale(.6); opacity: .8; } 80%, 100% { transform: scale(1.6); opacity: 0; } }
  .ppill {
    display: inline-flex; align-items: center;
    height: 17px; padding: 0 6px;
    border-radius: 5px;
    font-size: 10px; font-weight: 550; letter-spacing: .01em;
    color: var(--text-2);
    background: rgba(255, 255, 255, 0.05);
    box-shadow: inset 0 0 0 1px var(--hair);
    white-space: nowrap; flex-shrink: 0;
  }
  .ppill.iso { color: var(--sky); background: var(--sky-soft); box-shadow: inset 0 0 0 1px rgba(125, 211, 252, 0.18); }
  .ppill.seeded { color: var(--violet); background: rgba(196, 181, 253, 0.09); box-shadow: inset 0 0 0 1px rgba(196, 181, 253, 0.2); }
  .fav {
    --h: 240;
    width: 16px; height: 16px;
    border-radius: 4.5px;
    display: inline-grid; place-items: center;
    font: 700 9.5px/1 var(--font);
    color: hsl(var(--h) 85% 82%);
    background: hsl(var(--h) 60% 55% / 0.2);
    box-shadow: inset 0 0 0 1px hsl(var(--h) 60% 70% / 0.2);
    flex-shrink: 0;
  }
  .fav.blank { color: var(--text-3); background: rgba(255, 255, 255, 0.04); box-shadow: inset 0 0 0 1px var(--hair); }
  .fav.lg { width: 40px; height: 40px; border-radius: 11px; font-size: 17px; }

  /* ---------- Sidebar ---------- */
  .sb-head { height: 52px; padding: 0 8px 0 14px; display: flex; align-items: center; gap: 10px; flex-shrink: 0; }
  .brand { display: flex; align-items: center; gap: 9px; min-width: 0; flex: 1; }
  .logo {
    width: 24px; height: 24px; border-radius: 7px;
    display: grid; place-items: center;
    background: linear-gradient(145deg, #9b9dff 0%, #6366f1 55%, #4f46e5 100%);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.3), 0 0 0 1px rgba(0, 0, 0, 0.35), 0 4px 14px -4px rgba(124, 127, 251, 0.7);
    flex-shrink: 0;
  }
  .brand-name { font-weight: 600; font-size: 13.5px; letter-spacing: -0.015em; white-space: nowrap; }
  .brand-sub { color: var(--text-3); font-weight: 450; margin-left: 1px; }
  .sb-view { padding: 0 10px 10px; flex-shrink: 0; }
  .seg {
    display: grid; grid-template-columns: 1fr 1fr; gap: 2px;
    padding: 3px;
    border-radius: 9px;
    background: var(--inset);
    box-shadow: inset 0 0 0 1px var(--hair), inset 0 1px 2px rgba(0, 0, 0, 0.4);
  }
  .seg button {
    height: 26px;
    display: inline-flex; align-items: center; justify-content: center; gap: 6px;
    border-radius: 6px;
    font-size: 12px; font-weight: 500;
    color: var(--text-3);
    transition: background .16s, color .16s, box-shadow .16s;
  }
  .seg button:hover:not(:disabled) { color: var(--text-2); }
  .seg button.active {
    color: var(--text);
    background: var(--raised-2);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06), 0 0 0 1px rgba(0, 0, 0, 0.35), 0 1px 3px rgba(0, 0, 0, 0.4);
  }
  .seg button:disabled { opacity: .35; }
  .create-bar { padding: 0 10px 6px; flex-shrink: 0; }
  .create-row { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; gap: 6px; }
  .create-row .icon-btn { border-radius: 8px; box-shadow: inset 0 0 0 1px var(--hair); }
  .create-row .icon-btn[aria-expanded="true"] { box-shadow: inset 0 0 0 1px var(--hair-3); }
  .drawer { display: grid; grid-template-rows: 0fr; transition: grid-template-rows .26s var(--ease), margin .26s var(--ease), opacity .2s; opacity: 0; margin-top: 0; }
  .drawer.open { grid-template-rows: 1fr; opacity: 1; margin-top: 8px; }
  .drawer-clip { overflow: hidden; min-height: 0; }
  .drawer-body {
    padding: 11px;
    border-radius: 10px;
    background: rgba(255, 255, 255, 0.025);
    box-shadow: inset 0 0 0 1px var(--hair);
    display: flex; flex-direction: column; gap: 10px;
  }
  .field-label { display: flex; justify-content: space-between; font-size: 10.5px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: var(--text-3); margin-bottom: 5px; }
  .field-label em { font-style: normal; text-transform: none; letter-spacing: 0; font-weight: 450; color: var(--text-4); }
  .input, .select {
    width: 100%; height: 32px;
    font: inherit; font-size: 12.5px;
    color: var(--text);
    background: var(--inset);
    border: 1px solid var(--hair);
    border-radius: 8px;
    padding: 0 10px;
    outline: none;
    transition: border-color .14s, box-shadow .14s;
  }
  .input::placeholder { color: var(--text-4); }
  .input:focus, .select:focus { border-color: var(--accent-ring); box-shadow: 0 0 0 3px var(--accent-soft); }
  .select-wrap { position: relative; }
  .select { appearance: none; -webkit-appearance: none; padding-right: 30px; cursor: pointer; }
  .select-wrap svg { position: absolute; right: 10px; top: 50%; transform: translateY(-50%); color: var(--text-3); pointer-events: none; }
  .drawer-actions { display: flex; gap: 6px; }
  .drawer-actions .btn-primary { flex: 1; }
  .section-label {
    display: flex; align-items: center; justify-content: space-between;
    padding: 12px 16px 6px;
    font-size: 10.5px; font-weight: 600; letter-spacing: .07em; text-transform: uppercase;
    color: var(--text-3);
    flex-shrink: 0;
  }
  .section-label span:last-child { color: var(--text-4); letter-spacing: 0; }
  .spaces-list { flex: 1; min-height: 0; overflow-y: auto; padding: 0 8px 10px; display: flex; flex-direction: column; gap: 2px; }
  .spaces-list::-webkit-scrollbar, .grid-view::-webkit-scrollbar { width: 8px; }
  .spaces-list::-webkit-scrollbar-thumb, .grid-view::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.08); border-radius: 99px; border: 2px solid transparent; background-clip: padding-box; }
  .spaces-list::-webkit-scrollbar-thumb:hover, .grid-view::-webkit-scrollbar-thumb:hover { background-color: rgba(255, 255, 255, 0.16); }
  .space { border-radius: 10px; padding: 2px; transition: background .16s, box-shadow .16s; }
  .space.selected {
    background: linear-gradient(180deg, rgba(255, 255, 255, 0.055), rgba(255, 255, 255, 0.03));
    box-shadow: inset 0 0 0 1px var(--hair), 0 1px 2px rgba(0, 0, 0, 0.25);
  }
  .space.handoff { background: linear-gradient(180deg, rgba(251, 191, 36, 0.08), rgba(251, 191, 36, 0.035)); box-shadow: inset 0 0 0 1px rgba(251, 191, 36, 0.24); }
  .space-head {
    height: 34px;
    padding: 0 5px 0 10px;
    display: flex; align-items: center; gap: 9px;
    border-radius: 8px;
    cursor: pointer;
    transition: background .14s;
  }
  .space:not(.selected):not(.handoff) .space-head:hover { background: var(--hover); }
  .space-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; color: var(--text-2); transition: color .14s; }
  .space.selected .space-name, .space.handoff .space-name, .space-head:hover .space-name { color: var(--text); }
  .space-count { min-width: 16px; text-align: right; font-size: 11px; color: var(--text-4); padding-right: 4px; }
  .space-actions { display: none; align-items: center; gap: 1px; }
  .space-head:hover .space-count, .space-head:focus-within .space-count, .space.confirming .space-count { display: none; }
  .space-head:hover .space-actions, .space-head:focus-within .space-actions, .space.confirming .space-actions { display: flex; }
  .mini {
    height: 24px; min-width: 24px; padding: 0 5px;
    display: inline-grid; place-items: center;
    border-radius: 6px;
    color: var(--text-3);
    transition: background .12s, color .12s;
  }
  .mini:hover { background: var(--hover-2); color: var(--text); }
  .mini.danger:hover { background: var(--rose-soft); color: var(--rose); }
  .mini.confirm { color: var(--rose); background: var(--rose-soft); font-size: 11px; font-weight: 600; padding: 0 8px; }
  .space-meta { display: flex; align-items: center; gap: 6px; padding: 0 10px 6px 27px; margin-top: -3px; font-size: 11.5px; color: var(--text-3); white-space: nowrap; overflow: hidden; }
  .space-meta span { overflow: hidden; text-overflow: ellipsis; }
  .space-meta.agent { color: rgba(110, 231, 183, 0.85); }
  .space-meta.handoff { color: #fcd34d; }
  .tabs { position: relative; padding: 0 3px 4px 16px; display: flex; flex-direction: column; gap: 1px; }
  .tabs::before { content: ""; position: absolute; left: 13.5px; top: 2px; bottom: 10px; width: 1px; background: var(--hair); }
  .tab {
    height: 30px;
    padding: 0 3px 0 9px;
    margin-left: 6px;
    display: flex; align-items: center; gap: 8px;
    border-radius: 7px;
    font-size: 12.5px;
    color: var(--text-2);
    cursor: pointer;
    transition: background .12s, color .12s;
  }
  .tab:hover { background: var(--hover); color: var(--text); }
  .tab.active { background: rgba(255, 255, 255, 0.075); color: var(--text); box-shadow: inset 0 0 0 1px var(--hair), 0 1px 2px rgba(0, 0, 0, 0.25); }
  .tab-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .tab-close {
    width: 22px; height: 22px;
    display: grid; place-items: center;
    border-radius: 6px;
    color: var(--text-3);
    opacity: 0;
    transition: opacity .12s, background .12s, color .12s;
  }
  .tab:hover .tab-close, .tab:focus-within .tab-close { opacity: 1; }
  .tab-close:hover { background: var(--hover-2); color: var(--text); }
  .tab-empty { margin-left: 6px; padding: 6px 9px; font-size: 12px; color: var(--text-4); }
  .empty { display: flex; flex-direction: column; align-items: center; text-align: center; gap: 8px; padding: 26px 14px; }
  .empty-art {
    width: 48px; height: 48px; margin-bottom: 4px;
    border-radius: 13px;
    display: grid; place-items: center;
    color: var(--accent-2);
    background: linear-gradient(180deg, rgba(124, 127, 251, 0.2), rgba(124, 127, 251, 0.06));
    box-shadow: inset 0 0 0 1px rgba(124, 127, 251, 0.28), 0 10px 24px -10px rgba(124, 127, 251, 0.6);
  }
  .empty-title { font-weight: 600; font-size: 13.5px; }
  .empty p { margin: 0; max-width: 280px; font-size: 12px; line-height: 1.55; color: var(--text-3); }
  .empty-actions { display: flex; gap: 6px; margin-top: 8px; }
  .empty.big { padding: 9vh 20px; }
  .empty.big .empty-art { width: 60px; height: 60px; border-radius: 16px; }
  .empty.big .empty-title { font-size: 16px; }
  .empty.big p { font-size: 13px; max-width: 360px; }
  .sb-foot {
    height: 40px; flex-shrink: 0;
    padding: 0 14px;
    display: flex; align-items: center; gap: 8px;
    border-top: 1px solid var(--hair);
    font-size: 11.5px; color: var(--text-3);
  }
  .sb-foot .grow { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--amber); box-shadow: 0 0 0 3px var(--amber-soft); flex-shrink: 0; transition: background .3s, box-shadow .3s; }
  .dot.ok { background: var(--emerald); box-shadow: 0 0 0 3px var(--emerald-soft); }
  .dot.bad { background: var(--rose); box-shadow: 0 0 0 3px var(--rose-soft); }
  .foot-hint { display: inline-flex; align-items: center; gap: 5px; color: var(--text-4); white-space: nowrap; }
  .foot-hint kbd { height: 17px; font-size: 10px; color: var(--text-3); }
  .scrim { display: none; }

  /* ---------- Topbar ---------- */
  .topbar {
    height: 48px;
    padding: 0 8px;
    display: flex; align-items: center; gap: 4px;
    flex-wrap: nowrap;
    flex-shrink: 0;
    background: linear-gradient(180deg, rgba(255, 255, 255, 0.022), rgba(255, 255, 255, 0));
    border-bottom: 1px solid var(--hair);
    position: relative;
    z-index: 20;
  }
  .space-chip {
    height: 30px; max-width: 260px;
    padding: 0 10px 0 9px;
    display: inline-flex; align-items: center; gap: 8px;
    border-radius: 8px;
    font-size: 12.5px; font-weight: 500;
    color: var(--text);
    background: rgba(255, 255, 255, 0.035);
    box-shadow: inset 0 0 0 1px var(--hair);
    transition: background .14s, box-shadow .14s;
    flex-shrink: 1; min-width: 0;
    margin-right: 4px;
  }
  .space-chip:hover { background: var(--hover-2); box-shadow: inset 0 0 0 1px var(--hair-2); }
  .chip-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 36px; }
  .chip-empty { color: var(--text-3); font-weight: 450; }
  .nav-group { display: flex; align-items: center; gap: 1px; flex-shrink: 0; margin-right: 4px; }
  .omnibox {
    flex: 1; min-width: 120px;
    height: 32px;
    display: flex; align-items: center; gap: 8px;
    padding: 0 3px 0 10px;
    border-radius: 9px;
    background: var(--inset);
    border: 1px solid var(--hair);
    box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.5);
    transition: border-color .16s, box-shadow .16s, background .16s;
  }
  .omnibox:hover { border-color: var(--hair-2); }
  .omnibox:focus-within { background: #0c0c10; border-color: var(--accent-ring); box-shadow: 0 0 0 3px var(--accent-soft), inset 0 1px 2px rgba(0, 0, 0, 0.5); }
  .omni-icon { color: var(--text-3); display: grid; place-items: center; }
  .omni-icon.secure { color: rgba(110, 231, 183, 0.75); }
  .url-bar {
    flex: 1; min-width: 0; height: 100%;
    border: 0; outline: none; background: transparent;
    color: var(--text);
    font: inherit; font-size: 13px; letter-spacing: -0.005em;
    padding: 0;
  }
  .url-bar::placeholder { color: var(--text-4); }
  .url-bar:disabled { color: var(--text-3); }
  .copy-pill {
    height: 26px; padding: 0 9px;
    display: inline-flex; align-items: center; gap: 6px;
    border-radius: 6px;
    font-size: 11.5px; font-weight: 500;
    color: var(--text-2);
    background: rgba(255, 255, 255, 0.04);
    box-shadow: inset 0 0 0 1px var(--hair);
    transition: background .14s, color .14s, box-shadow .14s;
    flex-shrink: 0;
  }
  .copy-pill:hover:not(:disabled) { background: var(--hover-2); color: var(--text); }
  .copy-pill:disabled { opacity: .35; }
  .copy-pill .ic-done { display: none; }
  .copy-pill.copied { color: var(--emerald); background: var(--emerald-soft); box-shadow: inset 0 0 0 1px rgba(52, 211, 153, 0.3); }
  .copy-pill.copied .ic-copy { display: none; }
  .copy-pill.copied .ic-done { display: block; }
  .tb-sep { width: 1px; height: 18px; background: var(--hair-2); margin: 0 4px; flex-shrink: 0; }
  #btn-new-tab { margin-left: 6px; }
  .keys-wrap { position: relative; flex-shrink: 0; }
  .popover {
    position: absolute; right: -36px; top: calc(100% + 10px);
    width: 330px;
    padding: 14px;
    border-radius: 13px;
    background: rgba(23, 23, 28, 0.94);
    -webkit-backdrop-filter: blur(22px) saturate(1.4);
    backdrop-filter: blur(22px) saturate(1.4);
    border: 1px solid var(--hair-2);
    box-shadow: var(--shadow-pop), inset 0 1px 0 rgba(255, 255, 255, 0.05);
    z-index: 600;
    transform-origin: top right;
    display: none;
  }
  .popover.open { display: block; animation: pop .16s var(--ease); }
  @keyframes pop { from { opacity: 0; transform: translateY(-4px) scale(.98); } to { opacity: 1; transform: none; } }
  .pop-title { font-size: 10.5px; font-weight: 600; letter-spacing: .07em; text-transform: uppercase; color: var(--text-3); margin: 0 0 9px; }
  .pop-sub { font-size: 11.5px; color: var(--text-3); margin: -4px 0 10px; }
  .key-grid { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 14px; }
  .keycap {
    height: 30px; min-width: 52px; padding: 0 10px;
    display: inline-grid; place-items: center;
    border-radius: 8px;
    font: 500 11.5px/1 var(--mono);
    color: var(--text);
    background: linear-gradient(180deg, #2a2a32, #1e1e24);
    border: 1px solid var(--hair-2);
    border-bottom-color: rgba(0, 0, 0, 0.6);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.07), 0 1px 0 rgba(0, 0, 0, 0.6), 0 2px 6px rgba(0, 0, 0, 0.25);
    transition: transform .08s, background .14s, box-shadow .08s;
  }
  .keycap:hover { background: linear-gradient(180deg, #32323b, #24242b); }
  .keycap:active { transform: translateY(1px); box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.05), 0 0 0 rgba(0, 0, 0, 0.6); }
  .pop-divider { height: 1px; background: var(--hair); margin: 0 -14px 12px; }
  .shortcut-list { display: grid; grid-template-columns: 1fr auto; gap: 7px 12px; align-items: center; font-size: 12px; }
  .shortcut-list .desc { color: var(--text-2); }
  .shortcut-list .keys { display: inline-flex; gap: 4px; justify-content: flex-end; }

  /* ---------- Handoff banner ---------- */
  .handoff-banner {
    display: none;
    align-items: center; gap: 12px;
    padding: 9px 10px 9px 12px;
    background: linear-gradient(90deg, rgba(251, 191, 36, 0.15), rgba(251, 191, 36, 0.06) 55%, rgba(251, 191, 36, 0.03));
    border-bottom: 1px solid rgba(251, 191, 36, 0.22);
    flex-shrink: 0;
    position: relative;
    z-index: 10;
  }
  .handoff-banner.visible { display: flex; animation: slide .3s var(--ease); }
  @keyframes slide { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: none; } }
  .hb-icon {
    width: 30px; height: 30px; border-radius: 9px;
    display: grid; place-items: center;
    color: var(--amber);
    background: var(--amber-soft);
    box-shadow: inset 0 0 0 1px rgba(251, 191, 36, 0.3);
    flex-shrink: 0;
  }
  .hb-text { flex: 1; min-width: 0; display: flex; flex-direction: column; line-height: 1.35; }
  .hb-text strong { font-size: 12.5px; font-weight: 600; color: #fef3c7; }
  .hb-text span { font-size: 12px; color: rgba(253, 230, 138, 0.72); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  /* ---------- Workspace / viewport ---------- */
  .workspace { flex: 1; min-height: 0; position: relative; background: #060608; }
  iframe.vnc { width: 100%; height: 100%; border: 0; display: block; background: #060608; }
  .progress { position: absolute; left: 0; right: 0; top: 0; height: 2px; overflow: hidden; z-index: 300; opacity: 0; transition: opacity .25s; pointer-events: none; }
  .progress.active { opacity: 1; }
  .progress::after {
    content: ""; position: absolute; top: 0; bottom: 0; width: 38%;
    background: linear-gradient(90deg, transparent, var(--accent-2), transparent);
    animation: sweep 1.1s var(--ease) infinite;
  }
  @keyframes sweep { from { left: -38%; } to { left: 100%; } }
  .closed-overlay {
    position: absolute; inset: 0;
    display: none; place-items: center;
    padding: 24px;
    z-index: 250;
    background:
      radial-gradient(560px 380px at 50% 42%, rgba(124, 127, 251, 0.1), transparent 70%),
      rgba(8, 8, 11, 0.8);
    -webkit-backdrop-filter: blur(14px) saturate(1.2);
    backdrop-filter: blur(14px) saturate(1.2);
  }
  .closed-overlay.visible { display: grid; animation: fade .3s var(--ease); }
  @keyframes fade { from { opacity: 0; } to { opacity: 1; } }
  .closed-card {
    width: min(420px, 100%);
    padding: 30px 28px 20px;
    border-radius: 18px;
    text-align: center;
    background: linear-gradient(180deg, rgba(32, 32, 39, 0.82), rgba(20, 20, 25, 0.86));
    border: 1px solid var(--hair-2);
    box-shadow: var(--shadow-pop), inset 0 1px 0 rgba(255, 255, 255, 0.06);
    animation: rise .4s var(--ease);
  }
  @keyframes rise { from { opacity: 0; transform: translateY(8px) scale(.985); } to { opacity: 1; transform: none; } }
  .closed-art {
    width: 56px; height: 56px; margin: 0 auto 18px;
    border-radius: 15px;
    display: grid; place-items: center;
    color: var(--accent-2);
    background: linear-gradient(180deg, rgba(124, 127, 251, 0.24), rgba(124, 127, 251, 0.07));
    box-shadow: inset 0 0 0 1px rgba(124, 127, 251, 0.32), 0 12px 30px -10px rgba(124, 127, 251, 0.65);
  }
  .spinner { width: 22px; height: 22px; border-radius: 50%; border: 2px solid rgba(163, 165, 255, 0.22); border-top-color: var(--accent-2); animation: spin .8s linear infinite; display: none; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .closed-overlay.connecting .closed-art svg { display: none; }
  .closed-overlay.connecting .spinner { display: block; }
  .closed-overlay.connecting .closed-actions { display: none; }
  .closed-card h2 { margin: 0 0 7px; font-size: 16px; font-weight: 600; letter-spacing: -0.015em; }
  .closed-card p { margin: 0 auto; max-width: 330px; color: var(--text-2); font-size: 13px; line-height: 1.55; }
  .closed-actions { display: flex; gap: 8px; justify-content: center; flex-wrap: wrap; margin-top: 22px; }
  .closed-actions .btn { height: 34px; padding: 0 14px; font-size: 13px; }
  .closed-hint { margin-top: 20px; padding-top: 14px; border-top: 1px solid var(--hair); font-size: 11.5px; color: var(--text-3); display: flex; align-items: center; justify-content: center; gap: 6px; }

  /* ---------- Grid overview ---------- */
  .grid-view {
    position: absolute; inset: 0;
    display: none;
    overflow-y: auto;
    padding: 22px 24px 32px;
    z-index: 260;
    background:
      radial-gradient(800px 400px at 50% -10%, rgba(124, 127, 251, 0.05), transparent 70%),
      var(--panel);
  }
  .grid-view.visible { display: block; animation: fade .2s var(--ease); }
  .grid-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; margin-bottom: 18px; }
  .grid-head h1 { margin: 0; font-size: 16px; font-weight: 600; letter-spacing: -0.02em; }
  .grid-head p { margin: 3px 0 0; font-size: 12px; color: var(--text-3); }
  .grid-head-actions { display: flex; gap: 6px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(270px, 1fr)); gap: 16px; }
  .gcard {
    display: flex; flex-direction: column;
    border-radius: 13px;
    overflow: hidden;
    background: #18181d;
    border: 1px solid var(--hair);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
    cursor: pointer;
    text-align: left;
    transition: transform .22s var(--ease), box-shadow .22s var(--ease), border-color .22s;
  }
  .gcard:hover { transform: translateY(-2px); border-color: var(--hair-3); box-shadow: 0 16px 36px -14px rgba(0, 0, 0, 0.8), 0 2px 6px rgba(0, 0, 0, 0.3); }
  .gcard.selected { border-color: var(--accent-ring); box-shadow: 0 0 0 3px var(--accent-soft), 0 1px 2px rgba(0, 0, 0, 0.3); }
  .gcard.handoff { border-color: rgba(251, 191, 36, 0.42); box-shadow: 0 0 0 3px rgba(251, 191, 36, 0.1), 0 1px 2px rgba(0, 0, 0, 0.3); }
  .thumb {
    aspect-ratio: 16 / 10;
    position: relative;
    overflow: hidden;
    background:
      radial-gradient(circle at 50% 40%, rgba(255, 255, 255, 0.03), transparent 70%),
      #0b0b0e;
    border-bottom: 1px solid var(--hair);
  }
  .thumb img { width: 100%; height: 100%; object-fit: cover; object-position: top center; display: block; transition: transform .5s var(--ease); }
  .gcard:hover .thumb img { transform: scale(1.015); }
  .thumb-empty { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; font-size: 11.5px; color: var(--text-4); }
  .badge {
    position: absolute; top: 9px; left: 9px;
    height: 22px; padding: 0 8px 0 7px;
    display: inline-flex; align-items: center; gap: 6px;
    border-radius: 99px;
    font-size: 11px; font-weight: 550;
    color: var(--text-2);
    background: rgba(10, 10, 13, 0.66);
    -webkit-backdrop-filter: blur(10px);
    backdrop-filter: blur(10px);
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.1), 0 2px 8px rgba(0, 0, 0, 0.3);
    max-width: calc(100% - 18px);
    white-space: nowrap;
  }
  .badge i { width: 6px; height: 6px; border-radius: 50%; background: var(--text-3); flex-shrink: 0; position: relative; }
  .badge.agent { color: #a7f3d0; }
  .badge.agent i { background: var(--emerald); }
  .badge.handoff { color: #fde68a; }
  .badge.handoff i { background: var(--amber); }
  .badge.live i::after, .badge.handoff i::after { content: ""; position: absolute; inset: -3px; border-radius: 50%; border: 1.5px solid currentColor; animation: ping 1.8s var(--ease) infinite; }
  .thumb-pill { position: absolute; top: 10px; right: 10px; }
  .thumb-pill .ppill { background: rgba(10, 10, 13, 0.7); -webkit-backdrop-filter: blur(10px); backdrop-filter: blur(10px); }
  .cursor {
    position: absolute; width: 12px; height: 12px; border-radius: 50%;
    background: var(--emerald);
    box-shadow: 0 0 0 3px rgba(52, 211, 153, 0.3), 0 0 16px rgba(52, 211, 153, 0.8);
    transform: translate(-50%, -50%);
    transition: left .5s var(--ease), top .5s var(--ease);
    pointer-events: none;
  }
  .gbody { padding: 11px 13px 12px; display: flex; flex-direction: column; gap: 5px; min-width: 0; }
  .grow1 { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-width: 0; }
  .gname { font-weight: 550; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .gtabs { font-size: 11px; color: var(--text-3); flex-shrink: 0; }
  .gurl { display: flex; align-items: center; gap: 7px; font-size: 12px; color: var(--text-2); min-width: 0; }
  .gurl span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .gurl .host { color: var(--text-4); flex-shrink: 0; }
  .gurl .fav { width: 14px; height: 14px; border-radius: 4px; font-size: 8.5px; }
  .gact { display: flex; align-items: center; gap: 7px; font-size: 11.5px; color: rgba(110, 231, 183, 0.9); min-width: 0; }
  .gact i { width: 5px; height: 5px; border-radius: 50%; background: var(--emerald); flex-shrink: 0; }
  .gact span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .gcard.new {
    align-items: center; justify-content: center; gap: 6px;
    min-height: 200px;
    background: transparent;
    border: 1px dashed var(--hair-2);
    box-shadow: none;
    color: var(--text-2);
    font: inherit;
  }
  .gcard.new:hover { border-color: var(--accent-ring); background: rgba(124, 127, 251, 0.04); color: var(--text); }
  .new-ic { width: 38px; height: 38px; border-radius: 11px; display: grid; place-items: center; background: var(--hover); box-shadow: inset 0 0 0 1px var(--hair-2); margin-bottom: 6px; transition: background .2s, color .2s; }
  .gcard.new:hover .new-ic { background: var(--accent-soft); color: var(--accent-2); }
  .new-t { font-weight: 550; font-size: 13px; }
  .new-s { font-size: 11.5px; color: var(--text-3); }

  /* ---------- Toast ---------- */
  .toast {
    position: fixed; left: 50%; bottom: 22px;
    z-index: 9999;
    height: 36px; padding: 0 14px 0 11px;
    display: inline-flex; align-items: center; gap: 8px;
    border-radius: 11px;
    font-size: 12.5px; font-weight: 500;
    color: var(--text);
    background: rgba(26, 26, 32, 0.92);
    -webkit-backdrop-filter: blur(18px) saturate(1.4);
    backdrop-filter: blur(18px) saturate(1.4);
    border: 1px solid var(--hair-2);
    box-shadow: var(--shadow-pop);
    opacity: 0;
    transform: translate(-50%, 10px) scale(.98);
    transition: opacity .2s var(--ease), transform .25s var(--ease);
    pointer-events: none;
    white-space: nowrap;
    max-width: calc(100vw - 32px);
  }
  .toast svg { color: var(--emerald); }
  .toast.error svg { color: var(--rose); }
  .toast.visible { opacity: 1; transform: translate(-50%, 0) scale(1); }

  /* ---------- Responsive ---------- */
  @media (max-width: 1100px) { .space-chip { max-width: 170px; } .space-chip .ppill { display: none; } }
  @media (max-width: 960px) { .copy-label { display: none; } .copy-pill { padding: 0 7px; } #raw-vnc { display: none; } .popover { right: 0; width: min(330px, calc(100vw - 24px)); } }
  @media (max-width: 820px) {
    .app, .app.collapsed { grid-template-columns: minmax(0, 1fr); }
    .sidebar {
      position: fixed; left: 0; top: 0; bottom: 0; width: var(--sb-w);
      z-index: 500;
      background: var(--frame);
      border-right: 1px solid var(--hair-2);
      box-shadow: 20px 0 50px rgba(0, 0, 0, 0.5);
      transition: transform .3s var(--ease);
    }
    .app.collapsed .sidebar { transform: translateX(-102%); box-shadow: none; }
    .main, .app.collapsed .main { padding: 6px; }
    .scrim { position: fixed; inset: 0; z-index: 400; background: rgba(0, 0, 0, 0.5); -webkit-backdrop-filter: blur(2px); backdrop-filter: blur(2px); }
    .app:not(.collapsed) .scrim { display: block; }
    .space-chip { display: none; }
    .nav-group #btn-forward { display: none; }
  }
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { animation-duration: 0.01ms !important; animation-iteration-count: 1 !important; transition-duration: 0.01ms !important; }
  }
</style>
</head>
<body>
<div id="app" class="app">
  <aside id="sidebar" class="sidebar" aria-label="Spaces">
    <div class="sidebar-inner">
      <div class="sb-head">
        <div class="brand">
          <div class="logo" aria-hidden="true">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5.5 12h13"/><path d="M18.5 12a6.5 6.5 0 1 0-1.9 4.6"/></svg>
          </div>
          <div class="brand-name">ego-browser <span class="brand-sub">console</span></div>
        </div>
        <button id="btn-collapse-sidebar" class="icon-btn" type="button" title="Hide sidebar (Alt+S)" aria-label="Hide sidebar">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="3"/><path d="M9 4v16"/><path d="m15.5 14.5-2.5-2.5 2.5-2.5"/></svg>
        </button>
      </div>

      <div class="sb-view">
        <div class="seg" role="tablist" aria-label="View mode">
          <button id="view-live" class="active" type="button" role="tab" title="Live browser (Alt+G toggles)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M3 9h18"/></svg>
            Live
          </button>
          <button id="view-grid" type="button" role="tab" title="Overview of every Space (Alt+G toggles)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="3.5" width="7" height="7" rx="1.75"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.75"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.75"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.75"/></svg>
            Grid
          </button>
        </div>
      </div>

      <div class="create-bar">
        <div class="create-row">
          <button id="btn-quick-default" class="btn btn-primary" type="button" title="Open a new persistent Space instantly (auto-named)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>
            New Space
          </button>
          <button id="btn-quick-isolated" class="btn btn-iso" type="button" title="Open a clean, zero-login isolated Space instantly">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21.5s7.5-3.6 7.5-9.4V5.6L12 2.8 4.5 5.6v6.5c0 5.8 7.5 9.4 7.5 9.4z"/></svg>
            Isolated
          </button>
          <button id="toggle-new" class="icon-btn" type="button" title="More options: name &amp; profile" aria-label="More space options" aria-expanded="false">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="5.5" cy="12" r="1.1"/><circle cx="12" cy="12" r="1.1"/><circle cx="18.5" cy="12" r="1.1"/></svg>
          </button>
        </div>
        <form id="new-form" class="drawer" autocomplete="off">
          <div class="drawer-clip">
            <div class="drawer-body">
              <div>
                <label class="field-label" for="new-name">Name <em>optional</em></label>
                <input id="new-name" class="input" type="text" maxlength="80" placeholder="Auto-named if left blank" />
              </div>
              <div>
                <label class="field-label" for="new-profile">Profile</label>
                <div class="select-wrap">
                  <select id="new-profile" class="select"><option value="Default">Default</option></select>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>
                </div>
              </div>
              <div class="drawer-actions">
                <button class="btn btn-primary sm" type="submit">Create &amp; Open</button>
                <button id="cancel-new" class="btn btn-quiet sm" type="button">Cancel</button>
              </div>
            </div>
          </div>
        </form>
      </div>

      <div class="section-label"><span>Spaces</span><span id="space-count"></span></div>
      <div id="spaces-list" class="spaces-list"></div>

      <div class="sb-foot">
        <span id="chrome-dot" class="dot"></span>
        <span id="conn-text" class="grow">Connecting…</span>
        <span class="foot-hint" id="foot-hint"></span>
      </div>
    </div>
  </aside>
  <div id="scrim" class="scrim"></div>

  <main class="main">
    <section class="browser">
      <header class="topbar">
        <button id="btn-expand-sidebar" class="icon-btn hidden" type="button" title="Show sidebar (Alt+S)" aria-label="Show sidebar">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="3"/><path d="M9 4v16"/><path d="m13 9.5 2.5 2.5-2.5 2.5"/></svg>
        </button>
        <button id="topbar-meta" class="space-chip" type="button" title="Toggle sidebar (Alt+S)"><span class="chip-empty">No space</span></button>
        <div class="nav-group">
          <button id="btn-back" class="icon-btn" type="button" title="Back (Alt+[)" aria-label="Back">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5"/><path d="m11 18-6-6 6-6"/></svg>
          </button>
          <button id="btn-forward" class="icon-btn" type="button" title="Forward (Alt+])" aria-label="Forward">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m13 6 6 6-6 6"/></svg>
          </button>
          <button id="btn-reload" class="icon-btn" type="button" title="Reload (Alt+R)" aria-label="Reload">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M20.5 12a8.5 8.5 0 1 1-2.6-6.1L20.5 8.5"/><path d="M20.5 3.5v5h-5"/></svg>
          </button>
        </div>

        <div class="omnibox">
          <span id="omni-icon" class="omni-icon"></span>
          <input id="url-bar" class="url-bar" type="text" spellcheck="false" autocomplete="off" autocapitalize="off" placeholder="Search or enter address" aria-label="Address bar" />
          <button id="btn-copy-url" class="copy-pill" type="button" title="Copy active URL (Alt+C)">
            <svg class="ic-copy" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="8.5" y="8.5" width="12" height="12" rx="2.5"/><path d="M15.5 8.5V6a2.5 2.5 0 0 0-2.5-2.5H6A2.5 2.5 0 0 0 3.5 6v7A2.5 2.5 0 0 0 6 15.5h2.5"/></svg>
            <svg class="ic-done" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
            <span id="copy-label" class="copy-label">Copy URL</span>
          </button>
        </div>

        <button id="btn-new-tab" class="btn" type="button" title="New Tab (Alt+T)">+ Tab</button>

        <div id="keys-wrap" class="keys-wrap">
          <button id="btn-keys-popover" class="icon-btn" type="button" title="Remote keys &amp; shortcuts" aria-label="Remote keys and shortcuts" aria-expanded="false" aria-haspopup="true">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="5" width="19" height="14" rx="2.5"/><path d="M6.5 9h.01M10 9h.01M14 9h.01M17.5 9h.01M6.5 12.5h.01M10 12.5h.01M14 12.5h.01M17.5 12.5h.01M8 16h8"/></svg>
          </button>
          <div id="keys-popover" class="popover" role="dialog" aria-label="Remote keys and keyboard shortcuts">
            <div class="pop-title">Send to remote page</div>
            <div class="pop-sub">Delivered straight to the active tab.</div>
            <div class="key-grid">
              <button class="keycap" type="button" data-rkey="a" data-rcode="KeyA" data-rctrl="1" data-rcmd="selectAll" data-rlabel="Ctrl+A">Ctrl+A</button>
              <button class="keycap" type="button" data-rkey="c" data-rcode="KeyC" data-rctrl="1" data-rcmd="copy" data-rlabel="Ctrl+C">Ctrl+C</button>
              <button class="keycap" type="button" data-rkey="v" data-rcode="KeyV" data-rctrl="1" data-rcmd="paste" data-rlabel="Ctrl+V">Ctrl+V</button>
              <button class="keycap" type="button" data-rkey="z" data-rcode="KeyZ" data-rctrl="1" data-rcmd="undo" data-rlabel="Ctrl+Z">Ctrl+Z</button>
              <button class="keycap" type="button" data-rkey="Escape" data-rcode="Escape" data-rlabel="Esc">Esc</button>
            </div>
            <div class="pop-divider"></div>
            <div class="pop-title">Shortcuts &middot; work inside the live view too</div>
            <div id="shortcut-list" class="shortcut-list"></div>
          </div>
        </div>
        <a id="raw-vnc" class="icon-btn" href="/vnc/vnc.html?autoconnect=true&amp;resize=scale&amp;path=vnc/websockify" target="_blank" rel="noopener" title="Open raw noVNC in a new tab" aria-label="Open raw noVNC">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h6v6"/><path d="M20 4 11 13"/><path d="M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10"/></svg>
        </a>
      </header>

      <div id="handoff-banner" class="handoff-banner" role="status">
        <div class="hb-icon">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M18 11V6a2 2 0 0 0-4 0v5"/><path d="M14 10V4a2 2 0 0 0-4 0v6"/><path d="M10 10.5V6a2 2 0 0 0-4 0v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-6-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/></svg>
        </div>
        <div class="hb-text">
          <strong>Waiting for you</strong>
          <span>Finish the login, 2FA or verification below, then hand control back to the agent.</span>
        </div>
        <button id="banner-takeover" class="btn btn-amber" type="button">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
          Done &mdash; Return to Agent
        </button>
      </div>

      <div class="workspace">
        <div id="progress" class="progress"></div>
        <iframe id="vnc-frame" class="vnc" title="Live browser"></iframe>
        <div id="closed-overlay" class="closed-overlay">
          <div class="closed-card">
            <div class="closed-art">
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="7.5" y="3" width="13.5" height="10.5" rx="2.5" opacity=".45"/><rect x="3" y="8" width="13.5" height="12" rx="2.5"/><path d="M3 12h13.5"/></svg>
              <div class="spinner"></div>
            </div>
            <h2 id="closed-title">No Chrome window open</h2>
            <p id="closed-desc">Chrome is still running in the background. Bring a window back and pick up right where you left off.</p>
            <div class="closed-actions">
              <button id="btn-reopen-browser" class="btn btn-primary" type="button">Reopen Chrome Window</button>
              <button id="btn-reopen-isolated" class="btn btn-iso" type="button">Open Isolated Window</button>
            </div>
            <div class="closed-hint">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21.5s7.5-3.6 7.5-9.4V5.6L12 2.8 4.5 5.6v6.5c0 5.8 7.5 9.4 7.5 9.4z"/><path d="m9 12 2 2 4-4"/></svg>
              Your saved logins and Spaces are safe.
            </div>
          </div>
        </div>
        <div id="grid-view" class="grid-view"></div>
      </div>
    </section>
  </main>
</div>
<div id="toast" class="toast" role="status" aria-live="polite"></div>

<script>
const CONFIG = __EGO_CONSOLE_CONFIG__;
const params = new URLSearchParams(location.search);
let selectedSpaceId = params.has("space") ? Number(params.get("space")) : null;
let initialFocusPending = Number.isInteger(selectedSpaceId) && selectedSpaceId > 0;
let viewMode = params.get("view") === "grid" ? "grid" : "live";
let latestSpaces = [];
let latestStatus = { chromeConnected: false, pageCount: 0 };
let statusKnown = false;
let toastTimer = null;
let copyTimer = null;
let pendingCloseId = null;
let pendingCloseTimer = null;
let busyCount = 0;
let creating = false;
let lastListHtml = "";
let lastGridHtml = "";
let lastChipHtml = "";
let lastOmniIcon = "";
let refreshPromise = null;
let refreshAgain = false;

const isMac = /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent || "");
const MOD = isMac ? "⌥" : "Alt+";
const $ = (id) => document.getElementById(id);
const appEl = $("app");
const vncFrame = $("vnc-frame");
const closedOverlay = $("closed-overlay");
const closedTitle = $("closed-title");
const closedDesc = $("closed-desc");
const gridView = $("grid-view");
const listEl = $("spaces-list");
const urlBar = $("url-bar");
const omniIcon = $("omni-icon");
const btnBack = $("btn-back");
const btnForward = $("btn-forward");
const btnReload = $("btn-reload");
const btnCopyUrl = $("btn-copy-url");
const copyLabel = $("copy-label");
const btnNewTab = $("btn-new-tab");
const btnKeysPopover = $("btn-keys-popover");
const keysWrap = $("keys-wrap");
const keysPopover = $("keys-popover");
const spaceChip = $("topbar-meta");
const banner = $("handoff-banner");
const progressEl = $("progress");
const newForm = $("new-form");
const toggleNewBtn = $("toggle-new");
const toastEl = $("toast");
const narrowMq = window.matchMedia("(max-width: 820px)");

const ICONS = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  x: '<path d="M17 7 7 17M7 7l10 10"/>',
  shield: '<path d="M12 21.5s7.5-3.6 7.5-9.4V5.6L12 2.8 4.5 5.6v6.5c0 5.8 7.5 9.4 7.5 9.4z"/>',
  pause: '<rect x="6.5" y="5" width="3.5" height="14" rx="1.2"/><rect x="14" y="5" width="3.5" height="14" rx="1.2"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.3 2.4 3.4 5.2 3.4 8.5s-1.1 6.1-3.4 8.5c-2.3-2.4-3.4-5.2-3.4-8.5S9.7 5.9 12 3.5z"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8.5 10.5V7.5a3.5 3.5 0 0 1 7 0v3"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  alert: '<circle cx="12" cy="12" r="8.5"/><path d="M12 8v4.5M12 16h.01"/>',
  bot: '<rect x="4.5" y="8" width="15" height="11.5" rx="3"/><path d="M12 4.5V8M9.5 13.5h.01M14.5 13.5h.01"/>',
  hand: '<path d="M18 11V6a2 2 0 0 0-4 0v5"/><path d="M14 10V4a2 2 0 0 0-4 0v6"/><path d="M10 10.5V6a2 2 0 0 0-4 0v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-6-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/>',
  stack: '<rect x="7.5" y="3" width="13.5" height="10.5" rx="2.5" opacity=".45"/><rect x="3" y="8" width="13.5" height="12" rx="2.5"/><path d="M3 12h13.5"/>',
};

function icon(name, size) {
  const s = size || 14;
  return '<svg width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICONS[name] || "") + '</svg>';
}

function esc(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
}

if (CONFIG.vncEnabled) {
  vncFrame.src = "/vnc/vnc.html?autoconnect=true&resize=scale&path=vnc/websockify";
} else {
  viewMode = "grid";
  vncFrame.style.display = "none";
  $("raw-vnc").classList.add("hidden");
  $("view-live").disabled = true;
  $("view-live").title = "Live view needs VNC to be enabled";
}

/* ---------- Small helpers ---------- */
function showToast(message, isError) {
  toastEl.innerHTML = icon(isError ? "alert" : "check", 15) + "<span>" + esc(message) + "</span>";
  toastEl.classList.toggle("error", Boolean(isError));
  toastEl.classList.add("visible");
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("visible"), 2300);
}

function setBusy(delta) {
  busyCount = Math.max(0, busyCount + delta);
  progressEl.classList.toggle("active", busyCount > 0);
}

function hostOf(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return "";
    return u.hostname.replace(/^www[.]/, "");
  } catch {
    return "";
  }
}

function hueOf(text) {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) >>> 0;
  return h % 360;
}

function favHtml(url, large) {
  const host = hostOf(url || "");
  const cls = "fav" + (large ? " lg" : "");
  if (!host) return '<span class="' + cls + ' blank">' + icon("globe", large ? 20 : 11) + "</span>";
  return '<span class="' + cls + '" style="--h:' + hueOf(host) + '">' + esc(host.charAt(0).toUpperCase()) + "</span>";
}

function tabTitle(t) {
  if (!t) return "New Tab";
  if (t.title && t.title !== "about:blank") return t.title;
  return hostOf(t.url) || "New Tab";
}

function ownerState(s) {
  if (!s) return "none";
  if (s.ownership === "agentDelegatedToUser") return "handoff";
  if (s.ownership === "agent") return "agent";
  return "user";
}

function agentName(s) {
  const a = s && s.agent;
  if (typeof a === "string" && a) return a;
  if (a && typeof a === "object") return a.name || a.id || "Agent";
  return "Agent";
}

function spaceName(s) {
  return (s && s.name) || ("Space #" + (s ? s.id : ""));
}

function profilePill(s) {
  const id = s.profileId || "Default";
  const kind = s.profileKind || "persistent";
  if (id === "Default" && kind === "persistent") return "";
  let cls = "";
  if (id === "isolated-seeded" || kind === "isolated-seeded") cls = " seeded";
  else if (id === "isolated" || kind === "isolated") cls = " iso";
  const label = id === "isolated" || id === "isolated-seeded" ? id : (s.profileName || id);
  return '<span class="ppill' + cls + '" title="Profile: ' + esc(s.profileName || id) + '">' + esc(label) + "</span>";
}

function getActiveSpace() {
  return latestSpaces.find((s) => s.id === selectedSpaceId) || null;
}

function getActiveTab(space) {
  if (!space) return null;
  const tabs = space.tabs || [];
  return (
    tabs.find((t) => t.active) ||
    (space.activeTargetId ? tabs.find((t) => t.targetId === space.activeTargetId) : null) ||
    tabs[0] ||
    null
  );
}

function syncUrl() {
  try {
    const u = new URL(location.href);
    if (selectedSpaceId) u.searchParams.set("space", String(selectedSpaceId));
    else u.searchParams.delete("space");
    if (viewMode === "grid" && CONFIG.vncEnabled) u.searchParams.set("view", "grid");
    else u.searchParams.delete("view");
    history.replaceState(null, "", u);
  } catch {}
}

/* ---------- Sidebar ---------- */
function readStoredCollapsed() {
  try { return localStorage.getItem("ego.console.sidebarCollapsed") === "1"; } catch { return false; }
}
function setSidebarCollapsed(collapsed, persist) {
  appEl.classList.toggle("collapsed", collapsed);
  $("btn-expand-sidebar").classList.toggle("hidden", !collapsed);
  $("btn-collapse-sidebar").setAttribute("aria-expanded", collapsed ? "false" : "true");
  if (persist !== false && !narrowMq.matches) {
    try { localStorage.setItem("ego.console.sidebarCollapsed", collapsed ? "1" : "0"); } catch {}
  }
}
function toggleSidebar() {
  setSidebarCollapsed(!appEl.classList.contains("collapsed"));
}
setSidebarCollapsed(narrowMq.matches ? true : readStoredCollapsed(), false);
narrowMq.addEventListener("change", () => setSidebarCollapsed(narrowMq.matches ? true : readStoredCollapsed(), false));
$("btn-collapse-sidebar").onclick = () => setSidebarCollapsed(true);
$("btn-expand-sidebar").onclick = () => setSidebarCollapsed(false);
$("scrim").onclick = () => setSidebarCollapsed(true, false);
spaceChip.onclick = () => toggleSidebar();
$("foot-hint").innerHTML = "<kbd>" + MOD + "S</kbd> sidebar";

/* ---------- View mode ---------- */
function syncViewButtons() {
  $("view-live").classList.toggle("active", viewMode === "live");
  $("view-grid").classList.toggle("active", viewMode === "grid");
  $("view-live").setAttribute("aria-selected", viewMode === "live" ? "true" : "false");
  $("view-grid").setAttribute("aria-selected", viewMode === "grid" ? "true" : "false");
  gridView.classList.toggle("visible", viewMode === "grid");
  syncClosedOverlay();
  syncUrl();
}

function setViewMode(mode) {
  viewMode = mode === "live" && CONFIG.vncEnabled ? "live" : "grid";
  syncViewButtons();
}

function syncClosedOverlay() {
  const showClosed =
    CONFIG.vncEnabled &&
    viewMode === "live" &&
    (!latestStatus.chromeConnected || Number(latestStatus.pageCount || 0) === 0);
  closedOverlay.classList.toggle("visible", showClosed);
  closedOverlay.classList.toggle("connecting", !latestStatus.chromeConnected);
  if (!latestStatus.chromeConnected) {
    closedTitle.textContent = statusKnown ? "Reconnecting to Chrome…" : "Connecting to Chrome…";
    closedDesc.textContent = "Waiting for the Chrome DevTools endpoint to respond. This usually only takes a moment.";
  } else {
    closedTitle.textContent = "No Chrome window open";
    closedDesc.textContent = "Chrome is still running in the background. Bring a window back and pick up right where you left off.";
  }
}

function syncConnection() {
  const dot = $("chrome-dot");
  const connected = Boolean(latestStatus.chromeConnected);
  dot.classList.toggle("ok", connected);
  dot.classList.toggle("bad", statusKnown && !connected);
  const pages = Number(latestStatus.pageCount || 0);
  $("conn-text").textContent = !statusKnown
    ? "Connecting…"
    : connected
      ? "Connected · " + pages + (pages === 1 ? " page" : " pages")
      : "Chrome unreachable";
}

$("view-live").onclick = () => setViewMode("live");
$("view-grid").onclick = () => setViewMode("grid");

/* ---------- Create drawer ---------- */
function setDrawerOpen(open) {
  newForm.classList.toggle("open", open);
  toggleNewBtn.setAttribute("aria-expanded", open ? "true" : "false");
  if (open) setTimeout(() => $("new-name").focus(), 60);
}
toggleNewBtn.onclick = () => setDrawerOpen(!newForm.classList.contains("open"));
$("cancel-new").onclick = () => setDrawerOpen(false);

/* ---------- Keys popover ---------- */
function setPopoverOpen(open) {
  keysPopover.classList.toggle("open", open);
  btnKeysPopover.setAttribute("aria-expanded", open ? "true" : "false");
}
btnKeysPopover.onclick = (e) => {
  e.stopPropagation();
  setPopoverOpen(!keysPopover.classList.contains("open"));
};
document.addEventListener("click", (e) => {
  if (!keysWrap.contains(e.target)) setPopoverOpen(false);
});
window.addEventListener("blur", () => setPopoverOpen(false));

const SHORTCUTS = [
  ["New tab", [MOD + "T"]],
  ["Close tab", [MOD + "W"]],
  ["Reload", isMac ? [MOD + "R", "⌘R"] : [MOD + "R"]],
  ["Focus address bar", isMac ? [MOD + "L", "⌘L"] : [MOD + "L"]],
  ["Copy active URL", [MOD + "C"]],
  ["Back", isMac ? [MOD + "[", "⌘["] : [MOD + "[", MOD + "←"]],
  ["Forward", isMac ? [MOD + "]", "⌘]"] : [MOD + "]", MOD + "→"]],
  ["Switch to tab 1–9", [MOD + "1–9"]],
  ["Toggle sidebar", [MOD + "S"]],
  ["Live / Grid", [MOD + "G"]],
  ["Close menus · revert URL", ["Esc"]],
];
$("shortcut-list").innerHTML = SHORTCUTS.map((row) =>
  '<span class="desc">' + esc(row[0]) + '</span><span class="keys">' + row[1].map((k) => "<kbd>" + esc(k) + "</kbd>").join("") + "</span>"
).join("");

/* ---------- API ---------- */
async function apiPost(path, body) {
  setBusy(1);
  try {
    const res = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body || {}),
    });
    let data = {};
    try { data = await res.json(); } catch {}
    if (!res.ok && !data.error) data.error = "Request failed (" + res.status + ")";
    return data;
  } catch (err) {
    return { error: (err && err.message) || "Network error" };
  } finally {
    setBusy(-1);
  }
}

async function copyText(text) {
  if (!text) return false;
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {}
  }
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    area.style.pointerEvents = "none";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}

async function loadProfiles() {
  try {
    const data = await fetch("/api/profiles").then((r) => r.json());
    const profiles = data.profiles || [];
    if (!profiles.length) return;
    $("new-profile").innerHTML = profiles.map((p) => {
      const hint = p.kind === "isolated" ? " — clean, zero-login" : p.kind === "isolated-seeded" ? " — fresh, with copied logins" : p.id === "Default" ? " — saved logins" : "";
      return '<option value="' + esc(p.id) + '">' + esc((p.name || p.id) + hint) + "</option>";
    }).join("");
  } catch {}
}

async function createQuickSpace(profileId, name = "") {
  if (creating) return;
  creating = true;
  ["btn-quick-default", "btn-quick-isolated"].forEach((id) => { $(id).disabled = true; });
  try {
    const res = await apiPost("/api/spaces", { name, profileId });
    if (res.error) {
      showToast(res.error, true);
      return;
    }
    if (res.space?.id) {
      selectedSpaceId = res.space.id;
      viewMode = CONFIG.vncEnabled ? "live" : "grid";
    }
    if (narrowMq.matches) setSidebarCollapsed(true, false);
    showToast("Opened " + (res.space?.name || "new Space"));
    await refresh();
    syncViewButtons();
  } finally {
    creating = false;
    ["btn-quick-default", "btn-quick-isolated"].forEach((id) => { $(id).disabled = false; });
  }
}

$("btn-quick-default").onclick = () => createQuickSpace("Default", "");
$("btn-quick-isolated").onclick = () => createQuickSpace("isolated", "");

$("btn-reopen-browser").onclick = async () => {
  const btn = $("btn-reopen-browser");
  btn.disabled = true;
  try {
    const res = await apiPost("/api/browser/reopen");
    if (res.error) {
      showToast(res.error, true);
      return;
    }
    if (res.space?.id || res.spaceId) {
      selectedSpaceId = res.space?.id || res.spaceId;
    }
    showToast("Chrome window reopened");
    await refresh();
    syncViewButtons();
  } finally {
    btn.disabled = false;
  }
};
$("btn-reopen-isolated").onclick = () => createQuickSpace("isolated", "");

async function selectAndFocus(id, targetId) {
  selectedSpaceId = id;
  const space = getActiveSpace();
  if (space && targetId) {
    (space.tabs || []).forEach((t) => { t.active = t.targetId === targetId; });
  }
  syncUrl();
  renderSpaces(latestSpaces);
  if (narrowMq.matches) setSidebarCollapsed(true, false);
  await apiPost("/api/spaces/" + id + "/focus", targetId ? { targetId } : {});
  await refresh();
}

async function createTabInActive(url = "about:blank") {
  const active = getActiveSpace();
  if (!active) {
    await createQuickSpace("Default", "");
    return;
  }
  const res = await apiPost("/api/spaces/" + active.id + "/tabs", { url });
  if (res.error) {
    showToast(res.error, true);
    return;
  }
  showToast("New tab opened");
  await refresh();
}

async function closeTab(spaceId, targetId) {
  const res = await apiPost("/api/spaces/" + spaceId + "/tabs/close", targetId ? { targetId } : {});
  if (res.error) {
    showToast(res.error, true);
    return;
  }
  if (res.spaceClosed && spaceId === selectedSpaceId) {
    selectedSpaceId = null;
  }
  showToast(res.spaceClosed ? "Space closed" : "Tab closed");
  await refresh();
}

async function spaceAction(id, act) {
  if (act === "close") {
    if (pendingCloseId !== id) {
      pendingCloseId = id;
      if (pendingCloseTimer) clearTimeout(pendingCloseTimer);
      pendingCloseTimer = setTimeout(() => {
        pendingCloseId = null;
        renderSpaces(latestSpaces);
      }, 2800);
      renderSpaces(latestSpaces);
      return;
    }
    pendingCloseId = null;
    if (pendingCloseTimer) clearTimeout(pendingCloseTimer);
  }
  const res = await apiPost("/api/spaces/" + id + "/" + act);
  if (res.error) {
    showToast(res.error, true);
  } else {
    if (act === "close" && id === selectedSpaceId) selectedSpaceId = null;
    showToast(act === "close" ? "Space closed" : act === "stop" ? "Agent paused — you have control" : "Control returned to agent");
  }
  await refresh();
}

async function navigateActive(payload, label) {
  const active = getActiveSpace();
  if (!active) return;
  const activeTab = getActiveTab(active);
  const res = await apiPost("/api/spaces/" + active.id + "/navigate", {
    targetId: activeTab?.targetId,
    ...payload,
  });
  if (res.error) {
    showToast(res.error, true);
    return;
  }
  if (res.url && document.activeElement !== urlBar) {
    urlBar.value = res.url;
  }
  if (label) showToast(label);
  await refresh();
}

function flashCopied(ok) {
  btnCopyUrl.classList.toggle("copied", ok);
  copyLabel.textContent = ok ? "Copied" : "Copy URL";
  if (copyTimer) clearTimeout(copyTimer);
  copyTimer = setTimeout(() => {
    btnCopyUrl.classList.remove("copied");
    copyLabel.textContent = "Copy URL";
  }, 1600);
}

async function copyActiveUrl() {
  const active = getActiveSpace();
  if (!active) return;
  const activeTab = getActiveTab(active);
  const targetUrl = activeTab?.url || active.url || urlBar.value.trim();
  if (!targetUrl) {
    showToast("No URL to copy", true);
    return;
  }
  const ok = await copyText(targetUrl);
  flashCopied(ok);
  showToast(ok ? "URL copied to clipboard" : "Copy failed", !ok);
}

async function sendRemoteKey(payload, label) {
  const active = getActiveSpace();
  if (!active) return;
  const activeTab = getActiveTab(active);
  const res = await apiPost("/api/spaces/" + active.id + "/key", {
    targetId: activeTab?.targetId,
    ...payload,
  });
  if (res.error) {
    showToast(res.error, true);
    return;
  }
  showToast("Sent " + (label || payload.key));
}

btnBack.onclick = () => navigateActive({ action: "back" }, "");
btnForward.onclick = () => navigateActive({ action: "forward" }, "");
btnReload.onclick = () => navigateActive({ action: "reload" }, "Reloaded");
btnCopyUrl.onclick = () => copyActiveUrl();
btnNewTab.onclick = () => createTabInActive("about:blank");

function revertUrlBar() {
  const active = getActiveSpace();
  urlBar.value = getActiveTab(active)?.url || active?.url || "";
}

urlBar.addEventListener("focus", () => setTimeout(() => urlBar.select(), 0));
urlBar.addEventListener("keydown", async (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    const targetUrl = urlBar.value.trim();
    if (!targetUrl) return;
    urlBar.blur();
    await navigateActive({ url: targetUrl }, "");
  } else if (e.key === "Escape") {
    e.preventDefault();
    revertUrlBar();
    urlBar.blur();
  }
});

keysPopover.querySelectorAll("button[data-rkey]").forEach((btn) => {
  btn.onclick = () => {
    sendRemoteKey(
      {
        key: btn.dataset.rkey,
        code: btn.dataset.rcode || undefined,
        ctrl: btn.dataset.rctrl === "1",
        command: btn.dataset.rcmd || undefined,
      },
      btn.dataset.rlabel || btn.textContent,
    );
  };
});

newForm.onsubmit = async (e) => {
  e.preventDefault();
  const name = $("new-name").value.trim();
  const profileId = $("new-profile").value || "Default";
  $("new-name").value = "";
  setDrawerOpen(false);
  await createQuickSpace(profileId, name);
};

$("banner-takeover").onclick = async () => {
  const active = getActiveSpace();
  if (!active) return;
  const res = await apiPost("/api/spaces/" + active.id + "/takeover");
  if (res.error) showToast(res.error, true);
  else showToast("Control returned to agent");
  await refresh();
};

/* ---------- Keyboard shortcuts (page + same-origin noVNC frame) ---------- */
function isEditableEl(el) {
  if (!el || !el.tagName) return false;
  const tag = el.tagName.toUpperCase();
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || Boolean(el.isContentEditable);
}

function handleShortcut(e) {
  const key = (e.key || "").toLowerCase();
  const code = e.code || "";

  if (key === "escape") {
    if (keysPopover.classList.contains("open")) setPopoverOpen(false);
    if (newForm.classList.contains("open") && newForm.contains(document.activeElement)) setDrawerOpen(false);
    if (narrowMq.matches && !appEl.classList.contains("collapsed")) setSidebarCollapsed(true, false);
    if (document.activeElement === urlBar || e.target === urlBar) {
      revertUrlBar();
      urlBar.blur();
      e.preventDefault();
      e.stopPropagation();
    }
    return;
  }

  if (isEditableEl(document.activeElement) || isEditableEl(e.target)) return;

  const altOnly = e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey;
  const metaMac = isMac && e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey;

  const intercept = () => {
    e.preventDefault();
    e.stopPropagation();
    if (typeof e.stopImmediatePropagation === "function") e.stopImmediatePropagation();
  };

  if (altOnly && (code === "KeyT" || key === "t")) {
    intercept();
    createTabInActive("about:blank");
    return;
  }
  if (altOnly && (code === "KeyW" || key === "w")) {
    intercept();
    const active = getActiveSpace();
    if (active) closeTab(active.id, getActiveTab(active)?.targetId);
    return;
  }
  if ((altOnly || metaMac) && (code === "KeyR" || key === "r")) {
    intercept();
    navigateActive({ action: "reload" }, "Reloaded");
    return;
  }
  if ((altOnly || metaMac) && (code === "KeyL" || key === "l")) {
    intercept();
    if (!urlBar.disabled) {
      urlBar.focus();
      urlBar.select();
    }
    return;
  }
  if (altOnly && (code === "KeyC" || key === "c")) {
    intercept();
    copyActiveUrl();
    return;
  }
  if (altOnly && (code === "KeyS" || key === "s")) {
    intercept();
    toggleSidebar();
    return;
  }
  if (altOnly && (code === "KeyG" || key === "g")) {
    intercept();
    setViewMode(viewMode === "grid" ? "live" : "grid");
    return;
  }
  if ((altOnly && (code === "BracketLeft" || key === "[" || e.key === "ArrowLeft")) || (metaMac && (code === "BracketLeft" || key === "["))) {
    intercept();
    navigateActive({ action: "back" }, "");
    return;
  }
  if ((altOnly && (code === "BracketRight" || key === "]" || e.key === "ArrowRight")) || (metaMac && (code === "BracketRight" || key === "]"))) {
    intercept();
    navigateActive({ action: "forward" }, "");
    return;
  }
  if (altOnly && code.startsWith("Digit")) {
    const n = Number(code.slice(5));
    if (n >= 1 && n <= 9) {
      const active = getActiveSpace();
      const targetTab = active?.tabs?.[n - 1];
      if (targetTab) {
        intercept();
        selectAndFocus(active.id, targetTab.targetId);
      }
    }
  }
}

window.addEventListener("keydown", handleShortcut, true);
function attachVncShortcuts() {
  try {
    const cw = vncFrame.contentWindow;
    if (!cw) return;
    cw.removeEventListener("keydown", handleShortcut, true);
    cw.addEventListener("keydown", handleShortcut, true);
  } catch {}
}
vncFrame.addEventListener("load", attachVncShortcuts);

/* ---------- Rendering ---------- */
function emptyHtml(big) {
  return (
    '<div class="empty' + (big ? " big" : "") + '">' +
      '<div class="empty-art">' + icon("stack", big ? 28 : 22) + "</div>" +
      '<div class="empty-title">No spaces yet</div>' +
      "<p>Start a persistent Space with your saved logins, or a clean Isolated one for zero-login testing. No naming needed.</p>" +
      '<div class="empty-actions">' +
        '<button class="btn btn-primary sm" type="button" data-create="Default">' + icon("plus", 13) + "New Space</button>" +
        '<button class="btn btn-iso sm" type="button" data-create="isolated">' + icon("shield", 13) + "Isolated</button>" +
      "</div>" +
    "</div>"
  );
}

function spaceRowHtml(s) {
  const st = ownerState(s);
  const isSel = s.id === selectedSpaceId;
  const tabs = s.tabs || [];
  const activeTab = getActiveTab(s);
  const confirming = pendingCloseId === s.id;
  const cls = "space" + (isSel ? " selected" : "") + (st === "handoff" ? " handoff" : "") + (confirming ? " confirming" : "");
  const pipCls = "pip " + st + (st === "agent" && s.activity ? " live" : "");

  let ctrl = "";
  if (st === "handoff") {
    ctrl = '<button class="mini" type="button" data-act="takeover" data-id="' + s.id + '" title="Return control to agent" aria-label="Return control to agent">' + icon("undo", 14) + "</button>";
  } else if (st === "agent") {
    ctrl = '<button class="mini" type="button" data-act="stop" data-id="' + s.id + '" title="Pause agent &amp; take over" aria-label="Pause agent and take over">' + icon("pause", 14) + "</button>";
  }
  const closeBtn = confirming
    ? '<button class="mini danger confirm" type="button" data-act="close" data-id="' + s.id + '" title="Click again to close this Space">Close?</button>'
    : '<button class="mini danger" type="button" data-act="close" data-id="' + s.id + '" title="Close Space" aria-label="Close Space">' + icon("x", 14) + "</button>";

  let meta = "";
  if (st === "handoff") {
    meta = '<div class="space-meta handoff">' + icon("hand", 12) + "<span>Waiting for you</span></div>";
  } else if (st === "agent") {
    meta = '<div class="space-meta agent">' + icon("bot", 12) + "<span>" + esc(agentName(s)) + (s.activity ? " · working" : " · in control") + "</span></div>";
  }

  let tabsHtml = "";
  if (isSel || st === "handoff") {
    tabsHtml =
      '<div class="tabs">' +
        tabs.map((t) => {
          const isActive = activeTab && t.targetId === activeTab.targetId;
          return (
            '<div class="tab' + (isActive ? " active" : "") + '" tabindex="0" data-space="' + s.id + '" data-target="' + esc(t.targetId) + '" title="' + esc(t.url || "") + '">' +
              favHtml(t.url) +
              '<span class="tab-title">' + esc(tabTitle(t)) + "</span>" +
              '<button class="tab-close" type="button" data-close-space="' + s.id + '" data-close-target="' + esc(t.targetId) + '" title="Close tab" aria-label="Close tab">' + icon("x", 12) + "</button>" +
            "</div>"
          );
        }).join("") +
        (tabs.length ? "" : '<div class="tab-empty">No open tabs</div>') +
      "</div>";
  }

  return (
    '<div class="' + cls + '">' +
      '<div class="space-head" tabindex="0" data-select="' + s.id + '" title="#' + s.id + " " + esc(spaceName(s)) + '">' +
        '<span class="' + pipCls + '"></span>' +
        '<span class="space-name">' + esc(spaceName(s)) + "</span>" +
        profilePill(s) +
        '<span class="space-count">' + (tabs.length || "") + "</span>" +
        '<span class="space-actions">' + ctrl + closeBtn + "</span>" +
      "</div>" +
      meta +
      tabsHtml +
    "</div>"
  );
}

function gridCardHtml(s) {
  const st = ownerState(s);
  const tabs = s.tabs || [];
  const isSel = s.id === selectedSpaceId;
  const badge = st === "handoff"
    ? '<span class="badge handoff"><i></i>Waiting for you</span>'
    : st === "agent"
      ? '<span class="badge agent' + (s.activity ? " live" : "") + '"><i></i>' + esc(agentName(s)) + (s.activity ? " · working" : "") + "</span>"
      : '<span class="badge user"><i></i>You</span>';
  const pill = profilePill(s);
  const thumb = s.thumbnail
    ? '<img data-thumb="' + s.id + '" alt="" draggable="false" />'
    : '<div class="thumb-empty">' + favHtml(s.url || (getActiveTab(s) || {}).url, true) + "<span>No live frame yet</span></div>";
  const hasCursor = s.activity && s.activity.fx != null && s.activity.fy != null;
  const lead = getActiveTab(s) || {};
  const leadUrl = s.url || lead.url || "";
  const leadTitle = s.title || lead.title || "";
  const host = hostOf(leadUrl);
  const title = leadTitle && leadTitle !== "about:blank" ? leadTitle : (host || "New Tab");
  return (
    '<div class="gcard' + (isSel ? " selected" : "") + (st === "handoff" ? " handoff" : "") + '" tabindex="0" data-grid-id="' + s.id + '">' +
      '<div class="thumb">' + thumb +
        (hasCursor ? '<span class="cursor" data-cursor="' + s.id + '"></span>' : "") +
        badge +
        (pill ? '<span class="thumb-pill">' + pill + "</span>" : "") +
      "</div>" +
      '<div class="gbody">' +
        '<div class="grow1"><span class="gname">' + esc(spaceName(s)) + '</span><span class="gtabs">' + tabs.length + (tabs.length === 1 ? " tab" : " tabs") + "</span></div>" +
        '<div class="gurl">' + favHtml(leadUrl) + "<span>" + esc(title) + "</span>" + (host && title !== host ? '<span class="host">' + esc(host) + "</span>" : "") + "</div>" +
        (s.activity ? '<div class="gact"><i></i><span data-act-label="' + s.id + '"></span></div>' : "") +
      "</div>" +
    "</div>"
  );
}

function gridHtml(sorted) {
  const tabsTotal = sorted.reduce((n, s) => n + (s.tabs || []).length, 0);
  const head =
    '<div class="grid-head">' +
      "<div><h1>Overview</h1><p>" + sorted.length + (sorted.length === 1 ? " space" : " spaces") + " · " + tabsTotal + (tabsTotal === 1 ? " tab" : " tabs") + "</p></div>" +
      (sorted.length
        ? '<div class="grid-head-actions">' +
            '<button class="btn btn-iso sm" type="button" data-create="isolated">' + icon("shield", 13) + "Isolated</button>" +
            '<button class="btn btn-primary sm" type="button" data-create="Default">' + icon("plus", 13) + "New Space</button>" +
          "</div>"
        : "") +
    "</div>";
  if (!sorted.length) return head + emptyHtml(true);
  return (
    head +
    '<div class="grid">' +
      sorted.map(gridCardHtml).join("") +
      '<button class="gcard new" type="button" data-create="Default">' +
        '<span class="new-ic">' + icon("plus", 18) + "</span>" +
        '<span class="new-t">New Space</span>' +
        '<span class="new-s">Auto-named · keeps your logins</span>' +
      "</button>" +
    "</div>"
  );
}

function syncGridVolatile(sorted) {
  sorted.forEach((s) => {
    const img = gridView.querySelector('img[data-thumb="' + s.id + '"]');
    if (img && s.thumbnail && img.getAttribute("src") !== s.thumbnail) img.setAttribute("src", s.thumbnail);
    const cur = gridView.querySelector('[data-cursor="' + s.id + '"]');
    if (cur && s.activity) {
      cur.style.left = (Math.max(0, Math.min(1, Number(s.activity.fx) || 0)) * 100).toFixed(2) + "%";
      cur.style.top = (Math.max(0, Math.min(1, Number(s.activity.fy) || 0)) * 100).toFixed(2) + "%";
    }
    const lbl = gridView.querySelector('[data-act-label="' + s.id + '"]');
    if (lbl && s.activity) {
      const text = (s.activity.name || agentName(s)) + " — " + (s.activity.label || "working");
      if (lbl.textContent !== text) lbl.textContent = text;
    }
  });
}

function syncOmniIcon(url) {
  let name = "search";
  let cls = "omni-icon";
  if (/^https:/i.test(url)) { name = "lock"; cls += " secure"; }
  else if (url && !/^about:/i.test(url)) name = "globe";
  const keyStr = name + cls;
  if (keyStr === lastOmniIcon) return;
  lastOmniIcon = keyStr;
  omniIcon.className = cls;
  omniIcon.innerHTML = icon(name, 14);
}

function renderSpaces(spaces) {
  latestSpaces = spaces;
  if (!spaces.length) {
    selectedSpaceId = null;
  } else if (!selectedSpaceId || !spaces.some((s) => s.id === selectedSpaceId)) {
    selectedSpaceId = spaces[0].id;
  }

  const sorted = [...spaces].sort((a, b) => {
    if (a.ownership === "agentDelegatedToUser" && b.ownership !== "agentDelegatedToUser") return -1;
    if (b.ownership === "agentDelegatedToUser" && a.ownership !== "agentDelegatedToUser") return 1;
    return a.id - b.id;
  });

  $("space-count").textContent = sorted.length ? String(sorted.length) : "";
  const listHtml = sorted.length ? sorted.map(spaceRowHtml).join("") : emptyHtml(false);
  if (listHtml !== lastListHtml) {
    lastListHtml = listHtml;
    listEl.innerHTML = listHtml;
  }

  const gHtml = gridHtml(sorted);
  if (gHtml !== lastGridHtml) {
    lastGridHtml = gHtml;
    gridView.innerHTML = gHtml;
  }
  syncGridVolatile(sorted);

  const active = sorted.find((s) => s.id === selectedSpaceId) || null;
  const activeTab = getActiveTab(active);
  const hasActive = Boolean(active);
  btnBack.disabled = !hasActive;
  btnForward.disabled = !hasActive;
  btnReload.disabled = !hasActive;
  btnCopyUrl.disabled = !hasActive;
  btnNewTab.disabled = false;
  btnKeysPopover.disabled = !hasActive;
  urlBar.disabled = !hasActive;
  urlBar.placeholder = hasActive ? "Search or enter address" : "Create a Space to start browsing";

  let chipHtml;
  if (!active) {
    chipHtml = '<span class="chip-empty">No space</span>';
    if (document.activeElement !== urlBar) urlBar.value = "";
    banner.classList.remove("visible");
    document.title = "ego-browser console";
  } else {
    const st = ownerState(active);
    chipHtml =
      '<span class="pip ' + st + (st === "agent" && active.activity ? " live" : "") + '"></span>' +
      '<span class="chip-name">' + esc(spaceName(active)) + "</span>" +
      profilePill(active);
    if (document.activeElement !== urlBar) {
      urlBar.value = activeTab?.url || active.url || "";
    }
    banner.classList.toggle("visible", st === "handoff");
    document.title = (st === "handoff" ? "● " : "") + spaceName(active) + " · ego-browser console";
  }
  if (chipHtml !== lastChipHtml) {
    lastChipHtml = chipHtml;
    spaceChip.innerHTML = chipHtml;
  }
  syncOmniIcon(document.activeElement === urlBar ? (activeTab?.url || "") : urlBar.value);
}

/* ---------- Delegated interactions ---------- */
listEl.addEventListener("click", (e) => {
  const create = e.target.closest("[data-create]");
  if (create) { createQuickSpace(create.dataset.create, ""); return; }
  const act = e.target.closest("button[data-act]");
  if (act) { e.stopPropagation(); spaceAction(Number(act.dataset.id), act.dataset.act); return; }
  const tc = e.target.closest(".tab-close");
  if (tc) { e.stopPropagation(); closeTab(Number(tc.dataset.closeSpace), tc.dataset.closeTarget); return; }
  const tab = e.target.closest(".tab");
  if (tab) { selectAndFocus(Number(tab.dataset.space), tab.dataset.target); return; }
  const row = e.target.closest("[data-select]");
  if (row) selectAndFocus(Number(row.dataset.select));
});
listEl.addEventListener("keydown", (e) => {
  if (e.key !== "Enter" && e.key !== " ") return;
  const t = e.target;
  if (!t || !t.matches || !(t.matches(".tab") || t.matches("[data-select]"))) return;
  e.preventDefault();
  t.click();
});

function openFromGrid(id) {
  viewMode = CONFIG.vncEnabled ? "live" : "grid";
  syncViewButtons();
  selectAndFocus(id);
}
gridView.addEventListener("click", (e) => {
  const create = e.target.closest("[data-create]");
  if (create) { createQuickSpace(create.dataset.create, ""); return; }
  const card = e.target.closest("[data-grid-id]");
  if (card) openFromGrid(Number(card.dataset.gridId));
});
gridView.addEventListener("keydown", (e) => {
  if ((e.key === "Enter" || e.key === " ") && e.target && e.target.matches && e.target.matches("[data-grid-id]")) {
    e.preventDefault();
    openFromGrid(Number(e.target.dataset.gridId));
  }
});

/* ---------- Polling ---------- */
async function doRefresh() {
  try {
    const [statusRes, spacesRes] = await Promise.all([
      fetch("/api/status").then((r) => r.json()).catch(() => ({ chromeConnected: false, pageCount: 0 })),
      fetch("/api/spaces").then((r) => r.json()),
    ]);
    latestStatus = statusRes || { chromeConnected: false, pageCount: 0 };
    statusKnown = true;
    syncConnection();
    renderSpaces(spacesRes.spaces || []);
    syncClosedOverlay();
    if (initialFocusPending && selectedSpaceId) {
      initialFocusPending = false;
      syncUrl();
      await apiPost("/api/spaces/" + selectedSpaceId + "/focus");
    }
  } catch {}
}

function refresh() {
  if (refreshPromise) {
    refreshAgain = true;
    return refreshPromise;
  }
  refreshPromise = (async () => {
    do {
      refreshAgain = false;
      await doRefresh();
    } while (refreshAgain);
  })().finally(() => {
    refreshPromise = null;
  });
  return refreshPromise;
}

syncOmniIcon("");
syncViewButtons();
loadProfiles();
refresh();
setInterval(refresh, 2500);
</script>
</body>
</html>`;
