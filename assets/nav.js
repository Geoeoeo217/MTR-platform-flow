// Rail Flow AI: the shared top bar that links the five programs. One file, included by every page,
// so names and order stay the same everywhere. Hidden when a page is shown inside the demo reel.
(() => {
  if (window.self !== window.top) return;
  const root = new URL('..', document.currentScript.src).href;           // site root, from this file's location
  const here = location.href.split('#')[0].split('?')[0];
  const pages = [
    ['Home', ''],
    ['1 · Live system', 'live/'],
    ['2 · 2D simulator', 'platform-flow/'],
    ['3 · 3D platform', 'platform-flow/3d.html'],
    ['4 · Hardware', 'hardware-3d.html'],
    ['5 · Proof', 'proof/'],
  ];
  const css = `
    .rfnav{background:#0b1110;color:#e4ecea;border-bottom:1px solid #2a3735;font:500 13px/1 "IBM Plex Sans",system-ui,sans-serif;
      display:flex;flex-wrap:wrap;align-items:center;gap:4px 14px;min-height:40px;
      padding:6px max(16px,env(safe-area-inset-right,0px)) 6px max(16px,env(safe-area-inset-left,0px));position:relative;z-index:50}
    .rfnav .brand{display:inline-flex;align-items:center;gap:8px;font:700 17px/1 "Barlow Condensed","Arial Narrow",sans-serif;letter-spacing:.04em;text-transform:uppercase;color:#e4ecea;text-decoration:none;margin-right:6px}
    .rfnav .brand i{width:8px;height:8px;border-radius:50%;display:inline-block}
    .rfnav a.p{color:#a9bab5;text-decoration:none;padding:6px 8px;border-radius:5px;white-space:nowrap}
    .rfnav a.p:hover{color:#e4ecea;background:#172120}
    .rfnav a.p[aria-current="page"]{color:#0b1110;background:#7ea2ee;font-weight:600}
    .rfnav a:focus-visible{outline:2px solid #7ea2ee;outline-offset:2px}`;
  const style = document.createElement('style'); style.textContent = css; document.head.appendChild(style);
  const nav = document.createElement('nav'); nav.className = 'rfnav'; nav.setAttribute('aria-label', 'Rail Flow AI programs');
  const isHere = p => { const u = root + p; return p === '' ? here === u || here === u + 'index.html' : here === u || here === u + 'index.html'; };
  nav.innerHTML = `<a class="brand" href="${root}"><i style="background:#2fd27a"></i><i style="background:#f2bd2c"></i><i style="background:#ff5a4e"></i>Rail Flow AI</a>` +
    pages.slice(1).map(([name, p]) => `<a class="p" href="${root + p}"${isHere(p) ? ' aria-current="page"' : ''}>${name}</a>`).join('');
  document.body.prepend(nav);
  document.documentElement.style.setProperty('--rfnav-h', nav.offsetHeight + 'px');
})();
