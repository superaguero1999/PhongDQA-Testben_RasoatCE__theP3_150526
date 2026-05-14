export function renderAbout(root) {
  root.innerHTML = "";
  const panel = document.createElement("section");
  panel.className = "panel";

  const h1 = document.createElement("h1");
  h1.textContent = "Giới thiệu";

  const p = document.createElement("p");
  p.textContent =
    "Dự án độc lập trong thư mục The_P3, không ảnh hưởng mã Form15. Mở rộng bằng module mới thay vì phình một file duy nhất.";

  panel.append(h1, p);
  root.append(panel);
}
