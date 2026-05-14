import { APP } from "../config.js";

/**
 * Gắn shell (header + outlet) và trả về phần tử outlet để mount trang.
 * Chỉ ứng dụng P3 — không còn thanh tab điều hướng.
 */
export function mountShell() {
  const root = document.getElementById("app-root");
  if (!root) throw new Error("Thiếu #app-root");

  root.innerHTML = "";
  root.className = "app-shell";

  const header = document.createElement("header");
  header.className = "app-header";

  const brand = document.createElement("div");
  brand.className = "brand";
  brand.textContent = APP.name;

  header.append(brand);

  const outlet = document.createElement("main");
  outlet.className = "outlet";
  outlet.setAttribute("role", "main");

  root.append(header, outlet);

  return { outlet, getRouteHash: () => window.location.hash || APP.defaultRoute };
}
