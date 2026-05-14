import { APP } from "../config.js";

export function renderHome(root) {
  root.innerHTML = "";
  const panel = document.createElement("section");
  panel.className = "panel";

  const h1 = document.createElement("h1");
  h1.textContent = `Chào mừng đến ${APP.name}`;

  const p = document.createElement("p");
  p.textContent =
    "Đây là điểm bắt đầu modular: thêm trang mới bằng file trong pages/, nối route trong app.js.";

  const meta = document.createElement("p");
  meta.className = "meta";
  meta.textContent = "Cấu trúc: config → shell → pages — giữ mỗi file một trách nhiệm.";

  panel.append(h1, p, meta);
  root.append(panel);
}
