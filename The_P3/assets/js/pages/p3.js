import { P3_MASTER_PIN, P3_POLL_MS } from "../config.js";
import { p3AbsThumbUrl, p3EndInstance, p3FetchDashboard, p3StartInstance } from "../modules/p3Api.js";

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;");
}

function fmtTime(v) {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return esc(v);
  return esc(d.toLocaleString("vi-VN"));
}

function fmtP3(v) {
  if (v === "" || v == null) return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return esc(v);
  const sign = n > 0 ? "+" : "";
  return `${sign}${(n * 100).toFixed(1)}%`;
}

/** Khoảng T2 − T1 (giờ); null nếu thiếu hoặc không hợp lệ */
function hoursDeltaT2T1(t1Iso, t2Iso) {
  if (!t1Iso || !t2Iso) return null;
  const t1 = new Date(t1Iso).getTime();
  const t2 = new Date(t2Iso).getTime();
  if (!Number.isFinite(t1) || !Number.isFinite(t2) || t2 <= t1) return null;
  return (t2 - t1) / 3600000;
}

/** Trung bình (T2−T1) theo giờ trên các lượt done (ưu tiên số từ API / NocoDB) */
function itemAvgCongChuanMoiHours(item) {
  const list = Array.isArray(item.instances) ? item.instances : [];
  const vals = [];
  for (let i = 0; i < list.length; i++) {
    const h = instancePersonalHours(list[i]);
    if (h != null && Number.isFinite(h)) vals.push(h);
  }
  if (!vals.length) return null;
  let s = 0;
  for (let j = 0; j < vals.length; j++) s += vals[j];
  return s / vals.length;
}

/** Giờ T2−T1 cho một lượt (done); ưu tiên trường từ Worker */
function instancePersonalHours(ins) {
  const st = String(ins.status || "").toLowerCase();
  if (st !== "done") return null;
  if (ins.congChuanCaNhan != null && String(ins.congChuanCaNhan).trim() !== "") {
    const n = Number(ins.congChuanCaNhan);
    if (Number.isFinite(n)) return n;
  }
  return hoursDeltaT2T1(ins.t1, ins.t2);
}

function fmtCongChuanMoiCell(item) {
  const fromApi =
    item.congChuanMoiAvg != null && String(item.congChuanMoiAvg).trim() !== ""
      ? Number(item.congChuanMoiAvg)
      : null;
  const raw = fromApi != null && Number.isFinite(fromApi) ? fromApi : itemAvgCongChuanMoiHours(item);
  if (raw == null || !Number.isFinite(Number(raw))) return "—";
  return Number(raw).toFixed(2);
}

function fmtCongChuanCaNhanCell(ins) {
  const h = instancePersonalHours(ins);
  if (h == null || !Number.isFinite(h)) return "—";
  return h.toFixed(2);
}

/** Trường lọc: parent = hạng mục; instance = từng lượt (bảng phụ) */
const P3_FILTER_FIELDS = [
  { value: "", label: "— Chọn trường —" },
  { value: "maCat", label: "Mã CAT", scope: "parent" },
  { value: "linhKien", label: "Linh kiện", scope: "parent" },
  { value: "hangMuc", label: "Hạng mục kiểm tra", scope: "parent" },
  { value: "tieuChuan", label: "Tiêu chuẩn", scope: "parent" },
  { value: "document", label: "Document", scope: "parent" },
  { value: "congChuan", label: "Công chuẩn (H0)", scope: "parent" },
  { value: "congChuanMoi", label: "Công chuẩn (mới)", scope: "parent" },
  { value: "p3Avg", label: "P3 trung bình", scope: "parent" },
  { value: "runningTot", label: "Running / Tổng lượt", scope: "parent" },
  { value: "pic", label: "PIC", scope: "instance" },
  { value: "t1", label: "T1", scope: "instance" },
  { value: "t2", label: "T2", scope: "instance" },
  { value: "congChuanCaNhan", label: "Công chuẩn cá nhân", scope: "instance" },
  { value: "tyLeP3", label: "P3 cá nhân", scope: "instance" },
  { value: "status", label: "Trạng thái", scope: "instance" },
];

function p3FilterScope(fieldKey) {
  if (!fieldKey) return null;
  const row = P3_FILTER_FIELDS.find((r) => r.value === fieldKey);
  return row && row.scope ? row.scope : null;
}

function p3NeedleNorm(v) {
  const s = String(v ?? "").trim().toLowerCase();
  return typeof s.normalize === "function" ? s.normalize("NFC") : s;
}

function p3SearchableTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return String(iso) + " " + d.toLocaleString("vi-VN");
}

function p3RatioSearchBlob(raw) {
  if (raw === "" || raw == null) return "";
  const n = Number(raw);
  if (!Number.isFinite(n)) return String(raw);
  const sign = n > 0 ? "+" : "";
  return String(raw) + " " + sign + (n * 100).toFixed(1) + "%";
}

/** Chuỗi tìm kiếm (không HTML) cho một cặp hạng mục + lượt */
function p3HaystackForPair(item, ins, fieldKey) {
  switch (fieldKey) {
    case "maCat":
      return String(item.maCat ?? "");
    case "linhKien":
      return String(item.linhKien ?? "");
    case "hangMuc":
      return String(item.hangMuc ?? "");
    case "tieuChuan":
      return String(item.tieuChuan ?? "");
    case "document":
      return String(item.document ?? "");
    case "congChuan":
      return String(item.congChuan ?? "");
    case "congChuanMoi":
      return fmtCongChuanMoiCell(item);
    case "p3Avg":
      return p3RatioSearchBlob(item.p3Avg);
    case "runningTot":
      return String(item.runningCount ?? "") + "/" + String(item.instanceCount ?? "");
    case "pic":
      return String(ins && ins.pic != null ? ins.pic : "").trim();
    case "t1":
      return p3SearchableTime(ins.t1);
    case "t2":
      return p3SearchableTime(ins.t2);
    case "congChuanCaNhan":
      return fmtCongChuanCaNhanCell(ins);
    case "tyLeP3":
      return p3RatioSearchBlob(ins.tyLeP3);
    case "status":
      return String(ins.status ?? "");
    default:
      return "";
  }
}

function p3PairMatchesFilter(item, ins, fieldKey, needle) {
  if (!fieldKey || !needle) return true;
  const sc = p3FilterScope(fieldKey);
  let hay = p3HaystackForPair(item, ins, fieldKey).toLowerCase();
  if (typeof hay.normalize === "function") hay = hay.normalize("NFC");
  if (sc === "parent") {
    return hay.includes(needle);
  }
  if (sc === "instance") {
    if (!ins) return false;
    return hay.includes(needle);
  }
  return true;
}

/** Lọc mảng lượt của một hạng mục theo AND hai tầng (dùng chung cho bảng chính + bảng phụ) */
function p3FilterInstancesArray(item, f1, v1, f2, v2) {
  const n1 = p3NeedleNorm(v1);
  const n2 = p3NeedleNorm(v2);
  const a1 = !!f1 && !!n1;
  const a2 = !!f2 && !!n2;
  const raw = Array.isArray(item.instances) ? item.instances : [];
  if (!a1 && !a2) return raw.slice();
  if (!raw.length) return [];
  return raw.filter(
    (ins) =>
      p3PairMatchesFilter(item, ins, f1, a1 ? n1 : "") && p3PairMatchesFilter(item, ins, f2, a2 ? n2 : ""),
  );
}

/** Lọc AND 2 tầng; bảng phụ chỉ còn các lượt thỏa cả hai điều kiện (khi có lượt) */
function p3ApplyFiltersToItems(originalItems, f1, v1, f2, v2) {
  const n1 = p3NeedleNorm(v1);
  const n2 = p3NeedleNorm(v2);
  const a1 = !!f1 && !!n1;
  const a2 = !!f2 && !!n2;
  if (!a1 && !a2) {
    return originalItems.map((it) => ({
      ...it,
      instances: Array.isArray(it.instances) ? [...it.instances] : [],
    }));
  }
  const out = [];
  for (let i = 0; i < originalItems.length; i++) {
    const item = originalItems[i];
    const raw = Array.isArray(item.instances) ? item.instances : [];
    if (raw.length === 0) {
      const ok =
        p3PairMatchesFilter(item, null, f1, a1 ? n1 : "") && p3PairMatchesFilter(item, null, f2, a2 ? n2 : "");
      if (ok) out.push({ ...item, instances: [] });
      continue;
    }
    const filtered = p3FilterInstancesArray(item, f1, v1, f2, v2);
    if (filtered.length) out.push({ ...item, instances: filtered });
  }
  return out;
}

function p3FilterSelectOptionsHtml(selectedVal) {
  return P3_FILTER_FIELDS.map((o) => {
    const sel = o.value === selectedVal ? " selected" : "";
    return `<option value="${esc(o.value)}"${sel}>${esc(o.label)}</option>`;
  }).join("");
}

/** Có ít nhất một điều kiện lọc (AND giữa hai tầng khi cả hai đều bật) */
function p3FiltersEffectivelyOn(f1, v1, f2, v2) {
  const n1 = p3NeedleNorm(v1);
  const n2 = p3NeedleNorm(v2);
  return (!!f1 && !!n1) || (!!f2 && !!n2);
}

/** YYYY-MM từ T1 (theo giờ local) */
function p3YmFromT1(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function p3CurrentYm() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function p3TyLeP3NumFromIns(ins) {
  const n = Number(ins && ins.tyLeP3);
  return Number.isFinite(n) ? n : null;
}

function p3PicLabelFromIns(ins) {
  const p = String(ins && ins.pic != null ? ins.pic : "").trim();
  return p || "(chưa đặt PIC)";
}

/** picList từ Worker: mảng chuỗi (bản cũ) hoặc `{ name, nguong?, mucTieu? }` */
function normalizePicRoster(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (let i = 0; i < raw.length; i++) {
    const x = raw[i];
    if (x && typeof x === "object" && typeof x.name === "string") {
      const name = String(x.name).trim();
      if (!name) continue;
      out.push({
        name,
        nguong: x.nguong != null && String(x.nguong).trim() !== "" ? String(x.nguong).trim() : "",
        mucTieu: x.mucTieu != null && String(x.mucTieu).trim() !== "" ? String(x.mucTieu).trim() : "",
      });
      continue;
    }
    const s = String(x ?? "").trim();
    if (s) out.push({ name: s, nguong: "", mucTieu: "" });
  }
  return out;
}

function p3PicKpiFromRoster(roster, picLabel) {
  const label = String(picLabel ?? "").trim();
  if (!label || label === "(chưa đặt PIC)") return { nguong: "", mucTieu: "" };
  for (let j = 0; j < roster.length; j++) {
    if (roster[j].name === label) {
      return { nguong: roster[j].nguong || "", mucTieu: roster[j].mucTieu || "" };
    }
  }
  return { nguong: "", mucTieu: "" };
}

function p3KpiCellDisplay(v) {
  const t = String(v ?? "").trim();
  return t ? esc(t) : "—";
}

/** Lượt done có T1 thuộc tháng ym — mỗi phần tử { item, ins } */
function p3DoneInstancesForPicMonth(items, ym) {
  const out = [];
  const arr = Array.isArray(items) ? items : [];
  for (let i = 0; i < arr.length; i++) {
    const item = arr[i];
    const inst = Array.isArray(item.instances) ? item.instances : [];
    for (let j = 0; j < inst.length; j++) {
      const ins = inst[j];
      const st = String(ins.status || "").toLowerCase();
      if (st === "duplicate") continue;
      if (st !== "done") continue;
      if (p3YmFromT1(ins.t1) !== ym) continue;
      out.push({ item, ins });
    }
  }
  return out;
}

/** Gom theo PIC: số lượt done trong tháng (theo T1), số hạng mục khác nhau, TB tỷ lệ P3 cá nhân, danh sách chi tiết từng lượt */
function p3BuildPicMonthAggregates(items, ym) {
  const flat = p3DoneInstancesForPicMonth(items, ym);
  const byPic = new Map();
  for (let k = 0; k < flat.length; k++) {
    const { item, ins } = flat[k];
    const pic = p3PicLabelFromIns(ins);
    if (!byPic.has(pic)) byPic.set(pic, { pic, rows: [], itemIds: new Set() });
    const g = byPic.get(pic);
    g.rows.push({ item, ins });
    g.itemIds.add(String(item.id));
  }
  const out = [];
  byPic.forEach((g) => {
    const ratios = [];
    for (let i = 0; i < g.rows.length; i++) {
      const n = p3TyLeP3NumFromIns(g.rows[i].ins);
      if (n != null) ratios.push(n);
    }
    const avgRatio = ratios.length ? ratios.reduce((s, v) => s + v, 0) / ratios.length : null;
    out.push({
      pic: g.pic,
      /** Số hạng mục (item) khác nhau có ít nhất một lượt done trong tháng */
      distinctItemCount: g.itemIds.size,
      /** Số lượt done — khớp số dòng trong bảng chi tiết */
      doneInstanceCount: g.rows.length,
      avgRatio,
      rows: g.rows,
    });
  });
  out.sort((a, b) => String(a.pic).localeCompare(String(b.pic), "vi"));
  return out;
}

function stBadge(s) {
  const st = String(s || "idle").toLowerCase();
  if (st === "running") return '<span class="p3-badge p3-badge-run">running</span>';
  if (st === "done") return '<span class="p3-badge p3-badge-done">done</span>';
  return '<span class="p3-badge p3-badge-idle">idle</span>';
}

let lbEl = null;
let lbEsc = null;

function ensureLightbox() {
  if (lbEl) return lbEl;
  const el = document.createElement("div");
  el.className = "p3-lightbox";
  el.setAttribute("aria-hidden", "true");
  el.innerHTML =
    '<div class="p3-lightbox-backdrop" data-close="1"></div>' +
    '<div class="p3-lightbox-inner">' +
    '<button class="p3-lightbox-close" type="button" data-close="1" aria-label="Đóng">×</button>' +
    '<img class="p3-lightbox-img" alt="Ảnh P3" />' +
    "</div>";
  el.addEventListener("click", (e) => {
    if (e.target instanceof Element && e.target.closest("[data-close='1']")) closeLightbox();
  });
  document.body.appendChild(el);
  lbEl = el;
  return el;
}

function openLightbox(src) {
  if (!src) return;
  const lb = ensureLightbox();
  const img = lb.querySelector(".p3-lightbox-img");
  if (img) img.setAttribute("src", src);
  lb.classList.add("p3-lightbox-open");
  lb.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
  lbEsc = (e) => {
    if (e.key === "Escape") closeLightbox();
  };
  document.addEventListener("keydown", lbEsc);
}

function closeLightbox() {
  if (!lbEl) return;
  lbEl.classList.remove("p3-lightbox-open");
  lbEl.setAttribute("aria-hidden", "true");
  const img = lbEl.querySelector(".p3-lightbox-img");
  if (img) img.removeAttribute("src");
  document.body.style.overflow = "";
  if (lbEsc) {
    document.removeEventListener("keydown", lbEsc);
    lbEsc = null;
  }
}

/** Trạng thái hiển thị 1 dòng hạng mục: running nếu có lượt running; done nếu mọi lượt (hợp lệ) đều done; ngược lại idle (không class) */
function p3AggregateParentRowStatus(item) {
  const list = Array.isArray(item.instances) ? item.instances : [];
  const relevant = list.filter((ins) => String(ins.status || "").toLowerCase() !== "duplicate");
  if (!relevant.length) return "";
  let hasRun = false;
  let allDone = true;
  for (let i = 0; i < relevant.length; i++) {
    const st = String(relevant[i].status || "idle").toLowerCase();
    if (st === "running") hasRun = true;
    if (st !== "done") allDone = false;
  }
  if (hasRun) return "running";
  if (allDone) return "done";
  return "";
}

function buildMainRow(item, expanded) {
  const avg = fmtP3(item.p3Avg);
  const congMoi = esc(fmtCongChuanMoiCell(item));
  const rowStatus = p3AggregateParentRowStatus(item);
  const statusClass = rowStatus ? ` p3-row-${rowStatus}` : "";
  const rowClass = (expanded ? "p3-parent-row p3-parent-row-open" : "p3-parent-row") + statusClass;
  const toggle = expanded ? "−" : "+";
  return (
    `<tr class="${rowClass}" data-item-row="${esc(item.id)}">` +
    `<td class="p3-nowrap"><button type="button" class="p3-toggle" data-toggle="${esc(item.id)}">${toggle}</button> ${esc(item.maCat)}</td>` +
    `<td class="p3-col-linh-kien">${esc(item.linhKien)}</td>` +
    `<td class="p3-cell-long p3-col-hang-muc">${esc(item.hangMuc)}</td>` +
    `<td class="p3-cell-long p3-col-tieu-chuan">${esc(item.tieuChuan)}</td>` +
    `<td class="p3-cell-long">${esc(item.document)}</td>` +
    `<td class="p3-col-cong-chuan-h0">${esc(item.congChuan)}</td>` +
    `<td class="p3-nowrap p3-hdelta p3-col-cong-chuan-moi" title="Trung bình (T2−T1) giờ — các lượt done; đồng bộ NocoDB cột Công chuẩn (mới)">${congMoi}</td>` +
    `<td class="p3-p3col">${avg}</td>` +
    `<td class="p3-col-running">${esc(item.runningCount)}/${esc(item.instanceCount)}</td>` +
    `<td class="p3-col-sticky"><button type="button" class="p3-btn" data-new="${esc(item.id)}">[+] Triển khai mới</button></td>` +
    "</tr>"
  );
}

function buildInstanceRows(item, f1, v1, f2, v2) {
  const list = p3FilterInstancesArray(item, f1, v1, f2, v2);
  if (!list.length) {
    const raw = Array.isArray(item.instances) ? item.instances : [];
    const filtersOn = p3FiltersEffectivelyOn(f1, v1, f2, v2);
    const emptyMsg =
      filtersOn && raw.length
        ? "Không có lượt thoả bộ lọc hiện tại."
        : "Không có lượt triển khai hiện tại.";
    return `<tr><td colspan="9" class="p3-sub-empty">${emptyMsg}</td></tr>`;
  }
  return list
    .map((ins) => {
      const imgT1 = ins.thumbStart
        ? `<img class="p3-thumb" src="${esc(p3AbsThumbUrl(ins.thumbStart))}" alt="" loading="lazy" title="Bấm để xem lớn" />`
        : "—";
      const imgT2 = ins.thumbEnd
        ? `<img class="p3-thumb" src="${esc(p3AbsThumbUrl(ins.thumbEnd))}" alt="" loading="lazy" title="Bấm để xem lớn" />`
        : "—";
      const endBtn =
        String(ins.status) === "running"
          ? `<button type="button" class="p3-btn p3-btn-end" data-end="${esc(ins.id)}">Kết thúc</button>`
          : `<button type="button" class="p3-btn p3-btn-end" disabled>Kết thúc</button>`;

      const caNhan = esc(fmtCongChuanCaNhanCell(ins));
      return (
        "<tr>" +
        `<td>${esc(ins.pic || "(chưa đặt PIC)")}</td>` +
        `<td class="p3-nowrap">${fmtTime(ins.t1)}</td>` +
        `<td class="p3-nowrap">${fmtTime(ins.t2)}</td>` +
        `<td class="p3-nowrap p3-hdelta" title="T2−T1 (giờ), lưu NocoDB khi kết thúc lượt">${caNhan}</td>` +
        `<td>${imgT1}</td>` +
        `<td>${imgT2}</td>` +
        `<td class="p3-p3col">${fmtP3(ins.tyLeP3)}</td>` +
        `<td>${stBadge(ins.status)}</td>` +
        `<td>${endBtn}</td>` +
        "</tr>"
      );
    })
    .join("");
}

function buildDetailRow(displayItem, f1, v1, f2, v2, allItems) {
  const id = String(displayItem.id ?? "");
  const full =
    Array.isArray(allItems) && allItems.length
      ? allItems.find((it) => String(it.id ?? "") === id) || displayItem
      : displayItem;
  return (
    `<tr class="p3-detail-row"><td colspan="10">` +
    `<div class="p3-sub-wrap">` +
    `<table class="p3-sub-table">` +
    "<thead><tr><th>PIC</th><th>T1</th><th>T2</th><th title=\"T2−T1 (giờ)\">Công chuẩn cá nhân</th><th>Ảnh T1</th><th>Ảnh T2</th><th>P3 cá nhân</th><th>Trạng thái</th><th>Thao tác</th></tr></thead>" +
    `<tbody>${buildInstanceRows(full, f1, v1, f2, v2)}</tbody>` +
    "</table></div></td></tr>"
  );
}

function buildFiltersSectionHtml(fs) {
  const f = fs || { f1: "", v1: "", f2: "", v2: "" };
  return (
    '<div class="p3-filters" role="search" aria-label="Lọc bảng P3" data-p3-filter-v="3">' +
    '<div class="p3-filter-tier">' +
    '<span class="p3-filter-tier-label">Lọc 1</span>' +
    '<select id="p3-filter-1-field" class="p3-filter-select" aria-label="Trường lọc 1">' +
    p3FilterSelectOptionsHtml(f.f1) +
    "</select>" +
    '<input id="p3-filter-1-val" class="p3-filter-input" type="text" placeholder="Giá trị chứa… (có thể chỉ lọc theo cột lượt)" autocomplete="off" aria-label="Giá trị lọc 1" />' +
    "</div>" +
    '<div class="p3-filter-tier">' +
    '<span class="p3-filter-tier-label">Lọc 2</span>' +
    '<select id="p3-filter-2-field" class="p3-filter-select" aria-label="Trường lọc 2">' +
    p3FilterSelectOptionsHtml(f.f2) +
    "</select>" +
    '<input id="p3-filter-2-val" class="p3-filter-input" type="text" placeholder="Giá trị chứa…" autocomplete="off" aria-label="Giá trị lọc 2" />' +
    "</div>" +
    '<div class="p3-filter-actions">' +
    '<button type="button" class="p3-btn p3-btn-end" id="p3-filter-clear">Xóa lọc</button>' +
    '<button type="button" class="p3-help-link" id="p3-help-open" aria-haspopup="dialog">Hướng dẫn</button>' +
    "</div>" +
    "</div>"
  );
}

/** Chỉ vùng bảng (thay đổi khi lọc / tải dữ liệu) — giữ nguyên thanh lọc để không mất focus */
function buildTableMountInner(displayItems, expandedSet, f1, v1, f2, v2, allItems) {
  const rows = displayItems
    .map((item) => {
      const open = expandedSet.has(String(item.id));
      return buildMainRow(item, open) + (open ? buildDetailRow(item, f1, v1, f2, v2, allItems) : "");
    })
    .join("");

  const body =
    rows || '<tr><td colspan="10" class="p3-sub-empty">Không có dữ liệu hạng mục.</td></tr>';

  return (
    '<div class="p3-table-scroll">' +
    '<table class="p3-table">' +
    '<thead><tr><th>Mã CAT</th><th class="p3-col-linh-kien">Linh kiện</th><th class="p3-col-hang-muc">Hạng mục kiểm tra</th><th class="p3-col-tieu-chuan">Tiêu chuẩn</th><th>Document</th><th class="p3-col-cong-chuan-h0">Công chuẩn (H0)</th><th class="p3-col-cong-chuan-moi" title="Trung bình (T2−T1) giờ — lưu NocoDB">Công chuẩn (mới)</th><th>P3 trung bình</th><th class="p3-col-running">Running/<wbr><span class="p3-running-th-phrase">Tổng lượt</span></th><th class="p3-col-sticky">Thao tác</th></tr></thead>' +
    `<tbody>${body}</tbody>` +
    "</table></div>"
  );
}

function buildP3ChromeHtml(fs) {
  return (
    '<div class="p3-wrap">' +
    '<p class="p3-toolbar">' +
    '<span id="p3-status" class="p3-status"></span>' +
    '<button type="button" class="p3-btn" id="p3-stats-pic-open">Thống kê P3 theo PIC</button>' +
    "</p>" +
    buildFiltersSectionHtml(fs) +
    '<div id="p3-table-mount"></div>' +
    "</div>"
  );
}

function ensureActionModal() {
  let m = document.getElementById("p3-action-modal");
  if (m) return m;
  m = document.createElement("div");
  m.id = "p3-action-modal";
  m.className = "p3-modal";
  m.style.display = "none";
  m.innerHTML =
    '<div class="p3-modal-bg" data-close="1"></div>' +
    '<div class="p3-modal-card">' +
    '<h3 id="p3-modal-title">Triển khai P3</h3>' +
    '<label class="p3-modal-label" id="p3-pic-wrap">PIC</label>' +
    '<select id="p3-pic-select" class="p3-modal-input p3-pic-select" aria-label="Chọn PIC" style="display:none">' +
    '<option value="">— Chọn PIC —</option>' +
    "</select>" +
    '<input id="p3-pic-input" class="p3-modal-input" type="text" maxlength="60" placeholder="Nhập tên PIC" style="display:none" />' +
    '<label class="p3-modal-label">Mã PIN (4–6 số)</label>' +
    '<input id="p3-pin-input" class="p3-modal-input" type="password" inputmode="text" autocomplete="off" placeholder="VD: 0123" />' +
    '<label class="p3-modal-label">Ảnh chứng từ</label>' +
    '<input id="p3-file-input" class="p3-modal-input" type="file" accept="image/*" />' +
    '<p id="p3-modal-err" class="p3-modal-err" aria-live="polite"></p>' +
    '<div class="p3-modal-actions">' +
    '<button type="button" class="p3-btn" id="p3-modal-save">Xác nhận</button>' +
    '<button type="button" class="p3-btn p3-btn-end" data-close="1">Hủy</button>' +
    "</div></div>";
  m.addEventListener("click", (e) => {
    if (e.target instanceof Element && e.target.closest("[data-close='1']")) closeActionModal();
  });
  document.body.appendChild(m);
  return m;
}

function openActionModal(mode, payload, picOptions) {
  const m = ensureActionModal();
  m.dataset.mode = mode;
  m.dataset.payload = JSON.stringify(payload || {});
  const list = Array.isArray(picOptions) ? picOptions : [];
  const title = m.querySelector("#p3-modal-title");
  const picWrap = m.querySelector("#p3-pic-wrap");
  const picSelect = m.querySelector("#p3-pic-select");
  const picInput = m.querySelector("#p3-pic-input");
  const pinInput = m.querySelector("#p3-pin-input");
  const fileInput = m.querySelector("#p3-file-input");
  const err = m.querySelector("#p3-modal-err");
  if (title) title.textContent = mode === "start" ? "[+] Triển khai mới" : "Kết thúc lượt triển khai";
  if (picWrap) picWrap.style.display = mode === "start" ? "block" : "none";
  const useRoster = mode === "start" && list.length > 0;
  if (picSelect && picInput) {
    if (mode === "start") {
      if (useRoster) {
        picSelect.innerHTML = '<option value="">— Chọn PIC —</option>';
        for (let i = 0; i < list.length; i++) {
          const entry = list[i];
          const name =
            entry && typeof entry === "object" && typeof entry.name === "string"
              ? String(entry.name).trim()
              : String(entry ?? "").trim();
          if (!name) continue;
          const opt = document.createElement("option");
          opt.value = name;
          opt.textContent = name;
          picSelect.appendChild(opt);
        }
        picSelect.style.display = "block";
        picInput.style.display = "none";
        picInput.value = "";
        picSelect.value = "";
      } else {
        picSelect.style.display = "none";
        picInput.style.display = "block";
        picInput.value = "";
      }
    } else {
      picSelect.style.display = "none";
      picInput.style.display = "none";
    }
  }
  if (pinInput) pinInput.value = "";
  if (fileInput) fileInput.value = "";
  if (err) err.textContent = "";
  m.style.display = "block";
  if (mode === "start") {
    if (useRoster && picSelect) picSelect.focus();
    else if (picInput) picInput.focus();
  } else if (pinInput) pinInput.focus();
}

function closeActionModal() {
  const m = ensureActionModal();
  m.style.display = "none";
}

function ensureP3GuideModal() {
  let m = document.getElementById("p3-guide-modal");
  if (m) return m;
  m = document.createElement("div");
  m.id = "p3-guide-modal";
  m.className = "p3-modal p3-guide-layer";
  m.style.display = "none";
  m.setAttribute("role", "dialog");
  m.setAttribute("aria-modal", "true");
  m.setAttribute("aria-labelledby", "p3-guide-title");
  m.innerHTML =
    '<div class="p3-modal-bg" data-close="1"></div>' +
    '<div class="p3-modal-card p3-guide-card">' +
    '<div class="p3-guide-head">' +
    '<h3 id="p3-guide-title">Hướng dẫn triển khai P3</h3>' +
    '<button type="button" class="p3-btn p3-btn-end p3-guide-close" data-close="1">Đóng</button>' +
    "</div>" +
    '<p class="p3-guide-lead">Tóm tắt thao tác chính — chi tiết cấu hình xem tài liệu Worker / Noco.mkis01ab23.DB.</p>' +
    '<table class="p3-guide-table">' +
    "<thead><tr><th>Bước</th><th>Việc cần làm</th></tr></thead><tbody>" +
    "<tr><td>Triển khai mới</td><td>Bấm <strong>[+] Triển khai mới</strong> trên hạng mục → chọn PIC (hoặc nhập tay nếu được phép) → PIN 4–6 số hoặc mật khẩu master → chọn ảnh chứng từ → <strong>Xác nhận</strong>. Một PIC chỉ một lượt <em>Running</em> trên cùng hạng mục.</td></tr>" +
    "<tr><td>Kết thúc lượt</td><td>Khi lượt đang <em>Running</em>, bấm <strong>Kết thúc</strong> → nhập PIN + ảnh; hệ thống ghi T2, tỷ lệ P3 và công chuẩn cá nhân.</td></tr>" +
    "<tr><td>Lọc bảng</td><td><strong>Lọc 1</strong> và <strong>Lọc 2</strong> áp dụng đồng thời (AND). Để trống giá trị một tầng thì tầng đó không lọc. <strong>Xóa lọc</strong> đặt lại cả hai.</td></tr>" +
    "<tr><td>Làm mới</td><td>Dữ liệu tự tải theo chu kỳ; nếu báo lỗi Worker/mạng, đợi vài giây hoặc F5 trang.</td></tr>" +
    "<tr><td>Thống kê PIC</td><td>Nút <strong>Thống kê P3 theo PIC</strong> — xem tổng hợp theo tháng (cần cấu hình roster PIC trên NocoDB).</td></tr>" +
    "</tbody></table>" +
    "</div>";
  m.addEventListener("click", (e) => {
    if (e.target instanceof Element && e.target.closest("[data-close='1']")) closeP3GuideModal();
  });
  document.body.appendChild(m);
  return m;
}

function openP3GuideModal() {
  const m = ensureP3GuideModal();
  m.style.display = "block";
}

function closeP3GuideModal() {
  const m = document.getElementById("p3-guide-modal");
  if (m) m.style.display = "none";
}

function htmlPicStatsDetailRows(rows) {
  if (!rows.length) {
    return '<tr><td colspan="8" class="p3-sub-empty">Không có dữ liệu.</td></tr>';
  }
  return rows
    .map(({ item, ins }) => {
      const r = p3TyLeP3NumFromIns(ins);
      const p3cell = fmtP3(r != null ? r : "");
      const caNhan = esc(fmtCongChuanCaNhanCell(ins));
      return (
        "<tr>" +
        `<td>${esc(item.maCat)}</td>` +
        `<td>${esc(item.hangMuc)}</td>` +
        `<td class="p3-nowrap">${fmtTime(ins.t1)}</td>` +
        `<td class="p3-nowrap">${fmtTime(ins.t2)}</td>` +
        `<td class="p3-col-cong-chuan-h0">${esc(item.congChuan)}</td>` +
        `<td class="p3-nowrap p3-hdelta p3-col-cong-chuan-moi" title="T2−T1 (giờ), lưu NocoDB khi kết thúc lượt">${caNhan}</td>` +
        `<td class="p3-p3col">${p3cell}</td>` +
        `<td>${esc(String(ins.status || ""))}</td>` +
        "</tr>"
      );
    })
    .join("");
}

function ensureP3StatsModal() {
  let el = document.getElementById("p3-stats-modal");
  if (el) return el;
  el = document.createElement("div");
  el.id = "p3-stats-modal";
  el.className = "p3-modal p3-stats-layer";
  el.style.display = "none";
  el.innerHTML =
    '<div class="p3-modal-bg" data-p3-stats-close="stats"></div>' +
    '<div class="p3-modal-card p3-stats-modal-card">' +
    '<div class="p3-stats-modal-head">' +
    '<h3 class="p3-stats-modal-title">Thống kê P3 theo PIC</h3>' +
    '<button type="button" class="p3-btn p3-btn-end p3-stats-modal-close" data-p3-stats-close="stats">Đóng</button>' +
    "</div>" +
    '<p class="p3-stats-lead">Theo tháng của ngày bắt đầu (T1), chỉ các lượt <strong>done</strong>. <strong>Tổng lượt done</strong> = số dòng chi tiết. <strong>Ngưỡng</strong> và <strong>Mục tiêu</strong> lấy từ bảng khai báo PIC trên NocoDB (cùng bảng roster). <strong>Tỷ lệ P3</strong> là trung bình P3 cá nhân theo từng lượt — để đối chiếu mục tiêu KPI với thực tế.</p>' +
    '<label class="p3-modal-label" for="p3-stats-month">Tháng</label>' +
    '<input type="month" id="p3-stats-month" class="p3-modal-input" />' +
    '<div class="p3-stats-scroll">' +
    '<table class="p3-table p3-stats-table p3-stats-pic-table">' +
    '<thead><tr><th>PIC</th><th title="Số lượt kết thúc done trong tháng — bằng số dòng trong bảng chi tiết">Tổng lượt done</th><th title="KPI khai báo trên bảng PIC (NocoDB)">Ngưỡng</th><th title="KPI khai báo trên bảng PIC (NocoDB)">Mục tiêu</th><th>Tỷ lệ P3 (trung bình)</th></tr></thead>' +
    '<tbody id="p3-stats-tbody"></tbody>' +
    "</table>" +
    "</div>" +
    "</div>";
  document.body.appendChild(el);
  return el;
}

function ensureP3StatsDetailModal() {
  let el = document.getElementById("p3-stats-detail-modal");
  if (el) return el;
  el = document.createElement("div");
  el.id = "p3-stats-detail-modal";
  el.className = "p3-modal p3-stats-detail-layer";
  el.style.display = "none";
  el.innerHTML =
    '<div class="p3-modal-bg" data-p3-stats-close="detail"></div>' +
    '<div class="p3-modal-card p3-stats-detail-card">' +
    '<h3 id="p3-stats-detail-title">Chi tiết</h3>' +
    '<div class="p3-stats-scroll">' +
    '<table class="p3-table p3-stats-table">' +
    "<thead><tr><th>Mã CAT</th><th>Hạng mục kiểm tra</th><th>T1</th><th>T2</th><th>Công chuẩn (H0)</th><th title=\"T2−T1 (giờ), lưu NocoDB khi kết thúc lượt — cùng ý với cột Công chuẩn cá nhân ở bảng mở rộng\">Công chuẩn cá nhân</th><th>P3 cá nhân</th><th>Trạng thái</th></tr></thead>" +
    '<tbody id="p3-stats-detail-tbody"></tbody>' +
    "</table>" +
    "</div>" +
    '<div class="p3-modal-actions">' +
    '<button type="button" class="p3-btn p3-btn-end" data-p3-stats-close="detail">Đóng</button>' +
    "</div>" +
    "</div>";
  document.body.appendChild(el);
  return el;
}

export function renderP3(outlet) {
  outlet.innerHTML =
    '<section class="panel p3-panel"><h1>Thẻ P3_Tối ưu Công chuẩn</h1><div id="p3-root"></div></section>';

  const root = outlet.querySelector("#p3-root");
  root.innerHTML =
    '<div id="p3-loading-banner" class="p3-loading-banner" role="status" aria-live="polite">' +
    '<p class="p3-loading-text">Đang tải bảng theo dõi từ Worker…</p>' +
    '<p class="p3-loading-hint">Vui lòng đợi vài giây. Nếu màn hình đứng lâu, kiểm tra mạng, Worker hoặc cấu hình CORS trên Cloudflare.</p>' +
    "</div>";

  const expanded = new Set();
  let items = [];
  /** Roster PIC từ Worker: `{ name, nguong, mucTieu }[]`; rỗng = chưa cấu hình → fallback nhập tay */
  let picRoster = [];
  let timer = null;
  let submitting = false;
  let lastStatusMessage = "";
  const filterState = { f1: "", v1: "", f2: "", v2: "" };
  let lastPicStatsYm = "";
  let lastPicAggregates = [];

  function stripFilterSuffix(msg) {
    return String(msg || "").replace(/\s*— sau lọc:.*$/, "");
  }

  function closePicStatsDetailOnly() {
    const d = document.getElementById("p3-stats-detail-modal");
    if (d) d.style.display = "none";
  }

  function closePicStatsModalAll() {
    closePicStatsDetailOnly();
    const m = document.getElementById("p3-stats-modal");
    if (m) m.style.display = "none";
  }

  function openPicStatsDetailModal(pic, kind) {
    ensureP3StatsDetailModal();
    const row = lastPicAggregates.find((r) => r.pic === pic);
    const tit = document.getElementById("p3-stats-detail-title");
    const tb = document.getElementById("p3-stats-detail-tbody");
    const dm = document.getElementById("p3-stats-detail-modal");
    if (!row || !tb || !dm) return;
    const ratioLabel =
      row.avgRatio != null && Number.isFinite(row.avgRatio) ? fmtP3(row.avgRatio) : "—";
    const d = row.distinctItemCount;
    const n = row.doneInstanceCount;
    const hmSuffix = d !== n ? ` (${d} hạng mục khác nhau)` : "";
    const titles = {
      pic: `Chi tiết — PIC ${pic}`,
      count: `Chi tiết — ${n} lượt done${hmSuffix} — PIC ${pic}`,
      ratio: `Chi tiết — tỷ lệ P3 trung bình (${ratioLabel}) — PIC ${pic}`,
    };
    if (tit) tit.textContent = titles[kind] || titles.pic;
    tb.innerHTML = htmlPicStatsDetailRows(row.rows);
    dm.style.display = "block";
  }

  function refreshPicStatsTable() {
    const m = document.getElementById("p3-stats-modal");
    const inp = m?.querySelector("#p3-stats-month");
    const tb = document.getElementById("p3-stats-tbody");
    if (!inp || !tb) return;
    const ym = String(inp.value || "").trim() || p3CurrentYm();
    inp.value = ym;
    lastPicStatsYm = ym;
    lastPicAggregates = p3BuildPicMonthAggregates(items, ym);
    if (!lastPicAggregates.length) {
      tb.innerHTML = '<tr><td colspan="5" class="p3-sub-empty">Không có lượt done trong tháng này.</td></tr>';
      return;
    }
    tb.innerHTML = lastPicAggregates
      .map((row) => {
        const pEsc = esc(row.pic);
        const kpi = p3PicKpiFromRoster(picRoster, row.pic);
        const n = row.doneInstanceCount;
        const cnt = String(n);
        const cntTitle =
          row.distinctItemCount !== n
            ? `${n} lượt done trong tháng; ${row.distinctItemCount} hạng mục khác nhau`
            : `${n} lượt done trong tháng (khớp bảng chi tiết)`;
        const cntTitleEsc = esc(cntTitle);
        const avgDisp =
          row.avgRatio != null && Number.isFinite(row.avgRatio) ? fmtP3(row.avgRatio) : "—";
        return (
          "<tr>" +
          `<td class="p3-stats-pic-name-cell"><button type="button" class="p3-stats-cell-btn" data-p3-stats-detail data-pic="${pEsc}" data-kind="pic">${pEsc}</button></td>` +
          `<td class="p3-stats-num-cell"><button type="button" class="p3-stats-cell-btn" data-p3-stats-detail data-pic="${pEsc}" data-kind="count" title="${cntTitleEsc}">${esc(cnt)}</button></td>` +
          `<td class="p3-stats-kpi-cell">${p3KpiCellDisplay(kpi.nguong)}</td>` +
          `<td class="p3-stats-kpi-cell">${p3KpiCellDisplay(kpi.mucTieu)}</td>` +
          `<td class="p3-stats-num-cell"><button type="button" class="p3-stats-cell-btn" data-p3-stats-detail data-pic="${pEsc}" data-kind="ratio">${esc(avgDisp)}</button></td>` +
          "</tr>"
        );
      })
      .join("");
  }

  function openPicStatsModal() {
    ensureP3StatsModal();
    const m = document.getElementById("p3-stats-modal");
    const inp = m?.querySelector("#p3-stats-month");
    if (inp) {
      if (!inp.value) inp.value = lastPicStatsYm || p3CurrentYm();
      if (!inp.dataset.p3Bound) {
        inp.dataset.p3Bound = "1";
        inp.addEventListener("change", refreshPicStatsTable);
        inp.addEventListener("input", refreshPicStatsTable);
      }
    }
    refreshPicStatsTable();
    if (m) m.style.display = "block";
  }

  function onDocumentStatsClick(e) {
    const t = e.target;
    if (!(t instanceof Element)) return;
    const openB = t.closest("#p3-stats-pic-open");
    if (openB && root.contains(openB)) {
      openPicStatsModal();
      return;
    }
    const closeEl = t.closest("[data-p3-stats-close]");
    if (closeEl) {
      const which = closeEl.getAttribute("data-p3-stats-close");
      if (which === "detail") closePicStatsDetailOnly();
      else closePicStatsModalAll();
      return;
    }
    const db = t.closest("[data-p3-stats-detail]");
    if (db && document.getElementById("p3-stats-modal")?.contains(db)) {
      const pic = db.getAttribute("data-pic") || "";
      const kind = db.getAttribute("data-kind") || "pic";
      if (pic) openPicStatsDetailModal(pic, kind);
    }
  }

  document.addEventListener("click", onDocumentStatsClick);

  function statusEl() {
    return outlet.querySelector("#p3-status");
  }

  function restoreTableScroll(left, top) {
    const scroll = root.querySelector("#p3-table-mount .p3-table-scroll");
    if (!scroll) return;
    scroll.scrollLeft = left;
    scroll.scrollTop = top;
    requestAnimationFrame(() => {
      scroll.scrollLeft = left;
      scroll.scrollTop = top;
    });
  }

  function syncFilterDomFromState() {
    const s1 = root.querySelector("#p3-filter-1-field");
    if (s1) s1.value = filterState.f1;
    const s2 = root.querySelector("#p3-filter-2-field");
    if (s2) s2.value = filterState.f2;
    const v1 = root.querySelector("#p3-filter-1-val");
    if (v1) v1.value = filterState.v1;
    const v2 = root.querySelector("#p3-filter-2-val");
    if (v2) v2.value = filterState.v2;
  }

  /** Đọc lại từ DOM (tránh lệch state khi IME tiếng Việt chưa kích hoạt `input` đủ lần) */
  function syncFilterStateFromDom() {
    const s1 = root.querySelector("#p3-filter-1-field");
    const s2 = root.querySelector("#p3-filter-2-field");
    const v1 = root.querySelector("#p3-filter-1-val");
    const v2 = root.querySelector("#p3-filter-2-val");
    if (s1 && typeof s1.value === "string") filterState.f1 = s1.value;
    if (s2 && typeof s2.value === "string") filterState.f2 = s2.value;
    if (v1 && typeof v1.value === "string") filterState.v1 = v1.value;
    if (v2 && typeof v2.value === "string") filterState.v2 = v2.value;
  }

  /** Toolbar + lọc cố định; tạo lại nếu thiếu mount hoặc khối lọc (không phụ thuộc phiên bản data-p3-filter-v để tránh rebuild vô hạn khi cache lẫn bản cũ) */
  function ensureP3Chrome() {
    const mount = root.querySelector("#p3-table-mount");
    const filters = root.querySelector(".p3-filters");
    if (mount && filters) return;
    root.innerHTML = buildP3ChromeHtml(filterState);
    syncFilterDomFromState();
  }

  function updateStatusLine(displayItems) {
    syncFilterStateFromDom();
    const st = statusEl();
    if (!st || !lastStatusMessage) return;
    let line = stripFilterSuffix(lastStatusMessage);
    if (
      p3FiltersEffectivelyOn(filterState.f1, filterState.v1, filterState.f2, filterState.v2) &&
      items.length
    ) {
      const n = displayItems
        ? displayItems.length
        : p3ApplyFiltersToItems(items, filterState.f1, filterState.v1, filterState.f2, filterState.v2).length;
      line += ` — sau lọc: ${n}/${items.length} hạng mục`;
    }
    st.textContent = line;
  }

  function refreshTableMountOnly() {
    const mount = root.querySelector("#p3-table-mount");
    if (!mount) return;
    syncFilterStateFromDom();
    const prev = mount.querySelector(".p3-table-scroll");
    const left = prev ? prev.scrollLeft : 0;
    const top = prev ? prev.scrollTop : 0;
    const displayItems = p3ApplyFiltersToItems(items, filterState.f1, filterState.v1, filterState.f2, filterState.v2);
    mount.innerHTML = buildTableMountInner(
      displayItems,
      expanded,
      filterState.f1,
      filterState.v1,
      filterState.f2,
      filterState.v2,
      items,
    );
    restoreTableScroll(left, top);
    updateStatusLine(displayItems);
  }

  function renderTable() {
    ensureP3Chrome();
    refreshTableMountOnly();
  }

  let tableBodyRaf = 0;
  function scheduleRefreshTableMountOnly() {
    if (tableBodyRaf) cancelAnimationFrame(tableBodyRaf);
    tableBodyRaf = requestAnimationFrame(() => {
      tableBodyRaf = 0;
      if (!root.querySelector("#p3-table-mount")) return;
      refreshTableMountOnly();
    });
  }

  function bindFilterListeners() {
    if (root.dataset.p3FilterListeners === "1") return;
    root.dataset.p3FilterListeners = "1";
    function syncValFromTarget(t) {
      if (!(t instanceof Element) || !t.closest(".p3-filters")) return false;
      if (!("value" in t)) return false;
      const val = String(t.value);
      if (t.id === "p3-filter-1-val") {
        filterState.v1 = val;
        return true;
      }
      if (t.id === "p3-filter-2-val") {
        filterState.v2 = val;
        return true;
      }
      return false;
    }
    root.addEventListener("input", (e) => {
      const t = e.target;
      if (syncValFromTarget(t)) scheduleRefreshTableMountOnly();
    });
    root.addEventListener("keyup", (e) => {
      const t = e.target;
      if (syncValFromTarget(t)) scheduleRefreshTableMountOnly();
    });
    root.addEventListener("compositionend", (e) => {
      const t = e.target;
      if (syncValFromTarget(t)) scheduleRefreshTableMountOnly();
    });
    root.addEventListener("change", (e) => {
      const t = e.target;
      if (!(t instanceof Element) || !t.closest(".p3-filters")) return;
      if (!("value" in t)) return;
      const val = String(t.value);
      if (t.id === "p3-filter-1-field") {
        filterState.f1 = val;
        refreshTableMountOnly();
      } else if (t.id === "p3-filter-2-field") {
        filterState.f2 = val;
        refreshTableMountOnly();
      } else if (t.id === "p3-filter-1-val" || t.id === "p3-filter-2-val") {
        if (t.id === "p3-filter-1-val") filterState.v1 = val;
        else filterState.v2 = val;
        scheduleRefreshTableMountOnly();
      }
    });
  }

  bindFilterListeners();

  async function load() {
    const hadChrome = !!root.querySelector("#p3-table-mount");
    if (!hadChrome) {
      const lb = root.querySelector("#p3-loading-banner");
      if (!lb) {
        root.innerHTML =
          '<div id="p3-loading-banner" class="p3-loading-banner" role="status" aria-live="polite">' +
          '<p class="p3-loading-text">Đang tải bảng theo dõi từ Worker…</p>' +
          '<p class="p3-loading-hint">Vui lòng đợi vài giây. Nếu màn hình đứng lâu, kiểm tra mạng, Worker hoặc cấu hình CORS trên Cloudflare.</p>' +
          "</div>";
      }
    }
    try {
      const data = await p3FetchDashboard();
      items = Array.isArray(data.items) ? data.items : [];
      picRoster = normalizePicRoster(data.picList);
      lastStatusMessage = `Đã cập nhật ${new Date().toLocaleTimeString("vi-VN")} — ${items.length} hạng mục`;
      renderTable();
      const sm = document.getElementById("p3-stats-modal");
      if (sm && sm.style.display === "block") refreshPicStatsTable();
    } catch (e) {
      const msg = String(e.message || e);
      const hadData = Array.isArray(items) && items.length > 0;
      if (hadData) {
        lastStatusMessage = `Lỗi làm mới (${new Date().toLocaleTimeString("vi-VN")}): ${esc(msg)} — dữ liệu hiển thị có thể chưa mới nhất. Thử F5 hoặc đợi lượt tải sau.`;
        renderTable();
        const sm2 = document.getElementById("p3-stats-modal");
        if (sm2 && sm2.style.display === "block") refreshPicStatsTable();
      } else {
        root.innerHTML = `<p class="p3-err">${esc(msg)}</p>`;
        const st0 = statusEl();
        if (st0) st0.textContent = "";
      }
    }
  }

  async function submitAction() {
    if (submitting) return;
    const m = ensureActionModal();
    const mode = m.dataset.mode;
    const payload = JSON.parse(m.dataset.payload || "{}");
    const picSelect = m.querySelector("#p3-pic-select");
    const picInput = m.querySelector("#p3-pic-input");
    const pinInput = m.querySelector("#p3-pin-input");
    const fileInput = m.querySelector("#p3-file-input");
    const err = m.querySelector("#p3-modal-err");
    const st = statusEl();
    const saveBtn = m.querySelector("#p3-modal-save");

    const pin = (pinInput && pinInput.value ? pinInput.value : "").trim();
    const file = fileInput && fileInput.files ? fileInput.files[0] : null;

    const pinOkDigits = /^\d{4,6}$/.test(pin);
    const pinOkMaster = P3_MASTER_PIN && pin === P3_MASTER_PIN;
    if (!pinOkDigits && !pinOkMaster) {
      if (err) err.textContent = "Mã PIN không hợp lệ.";
      return;
    }
    if (!file) {
      if (err) err.textContent = "Vui lòng chọn ảnh.";
      return;
    }

    try {
      submitting = true;
      if (saveBtn) saveBtn.disabled = true;
      if (st) st.textContent = "Đang gửi dữ liệu...";
      if (mode === "start") {
        const useRoster = picRoster.length > 0;
        const pic = useRoster
          ? (picSelect && picSelect.value ? picSelect.value : "").trim()
          : (picInput && picInput.value ? picInput.value : "").trim();
        if (!pic) {
          if (err) err.textContent = useRoster ? "Vui lòng chọn PIC trong danh sách." : "Vui lòng nhập tên PIC.";
          return;
        }
        await p3StartInstance(payload.itemId, pic, pin, file);
        expanded.add(String(payload.itemId));
      } else if (mode === "end") {
        await p3EndInstance(payload.instanceId, pin, file);
      }
      closeActionModal();
      await load();
    } catch (e) {
      if (err) err.textContent = String(e.message || e);
      if (st) st.textContent = "";
    } finally {
      submitting = false;
      if (saveBtn) saveBtn.disabled = false;
    }
  }

  root.addEventListener("click", (e) => {
    const t = e.target;
    if (!(t instanceof Element)) return;

    if (t.id === "p3-filter-clear") {
      filterState.f1 = "";
      filterState.v1 = "";
      filterState.f2 = "";
      filterState.v2 = "";
      syncFilterDomFromState();
      refreshTableMountOnly();
      return;
    }

    if (t.id === "p3-help-open") {
      openP3GuideModal();
      return;
    }

    const thumb = t.closest("img.p3-thumb");
    if (thumb) {
      const src = thumb.getAttribute("src");
      if (src) openLightbox(src);
      return;
    }

    const tg = t.closest("[data-toggle]");
    if (tg) {
      const id = tg.getAttribute("data-toggle");
      if (!id) return;
      if (expanded.has(id)) expanded.delete(id);
      else expanded.add(id);
      renderTable();
      return;
    }

    const nw = t.closest("[data-new]");
    if (nw) {
      const id = nw.getAttribute("data-new");
      if (!id) return;
      openActionModal("start", { itemId: id }, picRoster);
      return;
    }

    const ed = t.closest("[data-end]");
    if (ed) {
      const insId = ed.getAttribute("data-end");
      if (!insId) return;
      openActionModal("end", { instanceId: insId });
      return;
    }
  });

  const modal = ensureActionModal();
  const saveBtn = modal.querySelector("#p3-modal-save");
  if (saveBtn) saveBtn.addEventListener("click", submitAction);

  load();
  timer = setInterval(load, Math.max(10000, Number(P3_POLL_MS || 60000)));

  return () => {
    if (timer) clearInterval(timer);
    timer = null;
    closeLightbox();
    closeActionModal();
    closeP3GuideModal();
    closePicStatsModalAll();
    document.removeEventListener("click", onDocumentStatsClick);
    if (saveBtn) saveBtn.removeEventListener("click", submitAction);
  };
}
