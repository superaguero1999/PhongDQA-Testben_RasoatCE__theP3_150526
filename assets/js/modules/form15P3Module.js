/**
 * Tab «Theo dõi P3» — The_P3 nằm trong cùng folder với index (./The_P3/).
 * Hỗ trợ thêm layout monorepo (../The_P3/ từ form15-frontend-main/).
 */
let p3Teardown = null;
let renderP3 = null;

function encSeg(folder) {
  return String(folder || "The_P3")
    .split("/")
    .filter(Boolean)
    .map((s) => encodeURIComponent(s))
    .join("/");
}

function p3EmbedFolders() {
  const cfg =
    globalThis.Form15Config && globalThis.Form15Config.CONFIG && globalThis.Form15Config.CONFIG.p3Embed;
  const ex = cfg && String(cfg.theP3Folder || "").trim();
  if (ex) return [ex];
  return ["The_P3", "the_P3", "the P3"];
}

function p3PageImportCandidates() {
  const cfg =
    globalThis.Form15Config && globalThis.Form15Config.CONFIG && globalThis.Form15Config.CONFIG.p3Embed;
  const explicit = cfg && String(cfg.theP3ImportBase || "").trim();
  if (explicit) {
    const b = explicit.replace(/\/+$/, "");
    return [b.endsWith(".js") ? b : `${b}/pages/p3.js`];
  }
  const meta = import.meta.url;
  const hrefs = [];
  for (const folder of p3EmbedFolders()) {
    const f = encSeg(folder);
    hrefs.push(
      new URL(`../../../${f}/assets/js/pages/p3.js`, meta).href,
      new URL(`../../../../${f}/assets/js/pages/p3.js`, meta).href
    );
  }
  return [...new Set(hrefs)];
}

for (const href of p3PageImportCandidates()) {
  try {
    const mod = await import(href);
    if (mod && typeof mod.renderP3 === "function") {
      renderP3 = mod.renderP3;
      break;
    }
  } catch (_) {}
}

function p3Outlet() {
  return document.getElementById("p3-embed-root");
}

function applyP3VisibilityFromConfig() {
  const cfg =
    globalThis.Form15Config && globalThis.Form15Config.CONFIG && globalThis.Form15Config.CONFIG.p3Embed;
  const off = cfg && cfg.enabled === false;
  const tab = document.querySelector('.module-tab[data-module="p3"]');
  const panel = document.querySelector('.app-module-panel[data-module-panel="p3"]');
  if (tab) tab.hidden = !!off;
  if (panel) panel.hidden = !!off;
  if (off && typeof p3Teardown === "function") {
    p3Teardown();
    p3Teardown = null;
  }
}

function form15P3AfterModuleSwitch(mod) {
  const name = String(mod || "").trim();
  if (name === "p3") {
    const el = p3Outlet();
    if (!el) return;
    if (typeof p3Teardown === "function") {
      p3Teardown();
      p3Teardown = null;
    }
    if (typeof renderP3 !== "function") {
      el.innerHTML =
        '<div class="ce-empty p3-embed-fallback"><p><strong>Không tải được <code>p3.js</code>.</strong></p><p>Trong cùng folder với <code>index.html</code> cần có <code>The_P3/assets/js/pages/p3.js</code>. Mở trang qua HTTP (GitHub Pages / localhost), không dùng <code>file://</code>.</p></div>';
      return;
    }
    p3Teardown = renderP3(el);
    return;
  }
  if (typeof p3Teardown === "function") {
    p3Teardown();
    p3Teardown = null;
  }
}

globalThis.Form15P3AfterModuleSwitch = form15P3AfterModuleSwitch;

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", applyP3VisibilityFromConfig);
} else {
  applyP3VisibilityFromConfig();
}
