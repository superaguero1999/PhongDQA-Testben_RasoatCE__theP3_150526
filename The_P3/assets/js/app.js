import { APP, ROUTES } from "./config.js";
import { mountShell } from "./modules/shell.js";
import { renderP3 } from "./pages/p3.js";

let p3Teardown = null;

function boot() {
  const { outlet, getRouteHash } = mountShell();

  const render = () => {
    const h = getRouteHash();
    if (h !== ROUTES.p3) {
      const base = `${window.location.pathname}${window.location.search}`;
      window.history.replaceState(null, "", `${base}${ROUTES.p3}`);
    }
    if (p3Teardown) {
      try {
        p3Teardown();
      } catch (_) {}
      p3Teardown = null;
    }
    p3Teardown = renderP3(outlet);
  };

  window.addEventListener("hashchange", render);
  if (!window.location.hash) {
    const base = `${window.location.pathname}${window.location.search}`;
    window.history.replaceState(null, "", `${base}${APP.defaultRoute}`);
  } else if (getRouteHash() !== ROUTES.p3) {
    const base = `${window.location.pathname}${window.location.search}`;
    window.history.replaceState(null, "", `${base}${ROUTES.p3}`);
  }
  render();
}

boot();
