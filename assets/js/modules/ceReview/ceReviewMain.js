(function initForm15CeReviewMain(global) {
  const CFG_ROOT = global.Form15Config && global.Form15Config.CONFIG;
  const ceCfg = CFG_ROOT && CFG_ROOT.ceReview;
  const Logic = global.Form15CeReviewLogic;
  const Service = global.Form15CeReviewService;
  const DeclSvc = global.Form15CeDeclarationService;
  const htmlEscape = global.Form15Utils && global.Form15Utils.htmlEscape
    ? global.Form15Utils.htmlEscape.bind(global.Form15Utils)
    : function (s) {
        return String(s ?? "")
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;");
      };

  /**
   * Tiêu đề cột đang hiển thị (không gồm cột nút) — dùng cho dropdown lọc tùy biến.
   * Khi đổi thead trong renderTable, cập nhật đồng bộ mảng này.
   */
  const CE_FILTERABLE_COLUMNS = [
    { key: "taskCode", label: "Mã tác vụ" },
    { key: "taskName", label: "Task name" },
    { key: "ma", label: "Mã" },
    { key: "assignee", label: "Assignee" },
    { key: "completionActual", label: "Ngày hoàn thành thực tế", filterKind: "date" },
    { key: "reportCode", label: "Mã báo cáo" },
    { key: "linkBcExcel", label: "Link BCexcel" },
    { key: "jiraLinkRequest", label: "JiraLinkRequest" },
    { key: "maKoi", label: "Mã KOI" },
    { key: "ketLuan", label: "Kết luận (Khai báo hệ thống)" },
    { key: "ketLuanTrangBia", label: "Kết luận trang bìa (file báo cáo)" },
    { key: "ketQua", label: "Kết quả" },
    { key: "ceRaSoatTruoc", label: "Trạng thái cũ" },
    { key: "trangThaiCe", label: "Trạng thái khai báo CE" },
    { key: "trangThaiCeManualHistory", label: "Lịch sử thay đổi - Trạng thái" },
    { key: "ghiChu", label: "Ghi chú" },
    { key: "koiKhaiBaoCeLink", label: "Link KOI - khai báo CE" },
    {
      key: "lichSuKhaiBaoCeAt",
      label: "Lịch sử khai báo CE",
      filterKind: "date",
    },
    { key: "trangThaiGiaoMau", label: "Khai báo giao mẫu - Trạng thái" },
    { key: "linkKoiKhaiBaoGiaoMau", label: "Khai báo giao mẫu - Link KOI" },
    { key: "ghiChuGiaoMau", label: "Khai báo giao mẫu - Ghi chú" },
    {
      key: "lichSuKhaiBaoGiaoMauAt",
      label: "Lịch sử khai báo giao mẫu",
      filterKind: "date",
    },
  ];

  let cachedRows = [];
  let selectedRowSourceId = "";
  let modalRowId = "";
  let modalGhiChuRowId = "";
  let modalGiaoMauRowId = "";
  let modalTrangThaiRowId = "";
  let ceFilterTimer = null;
  let ceDetailText = "";
  let ceDetailModalEls = null;
  let ceStatsModalEls = null;
  let ceGiaoMauStatsModalEls = null;
  let ceStatsDrillModalEls = null;
  let ceStatsSortState = { key: "tiLeHoanThanhCe", dir: "desc" };
  let ceGiaoMauStatsSortState = { key: "tiLeHoanThanhGiaoMau", dir: "desc" };
  let ceShowOptionalCols = false; // mặc định ẩn nhóm cột phụ, bấm "+" để hiện tất cả
  let lastForceScanElapsedText = "";
  const CE_SOURCE_SNAPSHOT_KEY = "form15.ce.sourceSnapshot.v1";
  const CE_SCAN_OWNER_KEY = "form15.ce.scan.owner.v1";
  let ceScanHeartbeatTimer = null;
  /** Phân biệt «chưa áp mặc định tháng» vs người dùng đã chọn «Tất cả tháng». */
  let ceMonthFilterInitialized = false;

  function saveCeSourceSnapshot(rows) {
    try {
      const list = Array.isArray(rows) ? rows : [];
      localStorage.setItem(CE_SOURCE_SNAPSHOT_KEY, JSON.stringify({
        savedAt: new Date().toISOString(),
        rows: list,
      }));
    } catch (_) {}
  }

  function loadCeSourceSnapshot() {
    try {
      const raw = localStorage.getItem(CE_SOURCE_SNAPSHOT_KEY);
      if (!raw) return [];
      const obj = JSON.parse(raw);
      return Array.isArray(obj && obj.rows) ? obj.rows : [];
    } catch (_) {
      return [];
    }
  }

  function ceOwnerId() {
    try {
      let id = localStorage.getItem(CE_SCAN_OWNER_KEY);
      if (!id) {
        id = "ce-owner-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
        localStorage.setItem(CE_SCAN_OWNER_KEY, id);
      }
      return id;
    } catch (_) {
      return "ce-owner-fallback";
    }
  }

  function ceWorkerBaseUrl() {
    const dw = (ceCfg && ceCfg.declarationWorker) || {};
    const upsertUrl = String(dw.upsertUrl || "").trim();
    return upsertUrl ? upsertUrl.replace(/\/upsert$/, "") : "";
  }

  async function cePostLock(path, body) {
    const base = ceWorkerBaseUrl();
    if (!base) return { ok: true, skipped: true };
    const resp = await fetch(base + path, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body || {}),
    });
    let json = null;
    try { json = await resp.json(); } catch (_) {}
    return Object.assign({ ok: resp.ok }, json || {});
  }

  async function ceGetLockStatus() {
    const base = ceWorkerBaseUrl();
    if (!base) return { ok: true, locked: false };
    const resp = await fetch(base + "/scan-lock/status", { method: "GET", cache: "no-store" });
    let json = null;
    try { json = await resp.json(); } catch (_) {}
    return Object.assign({ ok: resp.ok }, json || {});
  }

  function isTrangThaiOverridePasswordConfigured() {
    return !!(ceCfg && String(ceCfg.trangThaiCeOverridePassword || "").trim());
  }

  function trangThaiCeOptions() {
    if (!Logic || !Logic.TRANG_THAI) return [];
    const t = Logic.TRANG_THAI;
    return [t.CHUA_GUI, t.DA_GUI, t.KHONG_CAN];
  }

  function trangThaiGiaoMauOptions() {
    return ["Chưa gửi", "Đã gửi", "Không cần"];
  }

  function normalizeTrangThaiGiaoMau(raw) {
    const t = String(raw || "").trim();
    return trangThaiGiaoMauOptions().indexOf(t) >= 0 ? t : "Chưa gửi";
  }

  function quoteTrangThaiLabel(s) {
    const t = String(s || "").trim();
    return t ? t : "—";
  }

  function appendManualTrangThaiHistory(row, fromRaw, toRaw) {
    if (!row) return;
    const fromQ = quoteTrangThaiLabel(fromRaw);
    const toQ = quoteTrangThaiLabel(toRaw);
    if (fromQ === toQ) return;
    if (!Array.isArray(row.trangThaiCeManualHistory)) row.trangThaiCeManualHistory = [];
    const n = row.trangThaiCeManualHistory.length + 1;
    row.trangThaiCeManualHistory.push(
      "Lần " +
        n +
        ': đổi từ "' +
        fromQ +
        '" → "' +
        toQ +
        '"'
    );
  }

  function renderManualHistoryHtml(row) {
    const arr = row && row.trangThaiCeManualHistory;
    if (!Array.isArray(arr) || !arr.length) {
      return '<span class="ce-ghi-chu-placeholder">—</span>';
    }
    return arr
      .map(function (line) {
        return htmlEscape(line);
      })
      .join("<br/>");
  }

  function qs(sel, root) {
    return (root || document).querySelector(sel);
  }

  function clearCeTrangThaiPasswordInlineErr(overlayEl) {
    if (!overlayEl) return;
    const errEl = qs("#ce-trang-thai-password-err", overlayEl);
    if (errEl) {
      errEl.textContent = "";
      errEl.hidden = true;
    }
  }

  function clearCeKhaiBaoLinkInlineErr(overlayEl) {
    if (!overlayEl) return;
    const errEl = qs("#ce-modal-link-err", overlayEl);
    if (errEl) {
      errEl.textContent = "";
      errEl.hidden = true;
    }
  }

  /** Hiển thị thời điểm lưu link (ISO → locale vi-VN). */
  function formatLichSuKhaiBaoCeAtDisplay(isoOrRaw) {
    const s = String(isoOrRaw || "").trim();
    if (!s) return "—";
    const isoish = s.replace(/^(\d{4}-\d{2}-\d{2})\s+(\d)/, "$1T$2");
    let ms = Date.parse(isoish);
    if (Number.isNaN(ms)) ms = Date.parse(s);
    if (Number.isNaN(ms)) return "—";
    return new Date(ms).toLocaleString("vi-VN", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
  }

  function hrefForUserLink(raw) {
    const t = String(raw || "").trim();
    if (!t) return "";
    if (/^https?:\/\//i.test(t)) return t;
    if (/^\/\//.test(t)) return "https:" + t;
    return "https://" + t.replace(/^\/+/, "");
  }

  function normalizeBcExcelOnlineUrl(raw) {
    const href = hrefForUserLink(raw);
    if (!href) return "";
    try {
      const u = new URL(href);
      const host = String(u.hostname || "").toLowerCase();
      // Link đã là dạng xem online thì giữ nguyên.
      if (host.includes("view.officeapps.live.com")) return u.toString();
      if (host.includes("docs.google.com")) return u.toString();

      // Google Drive: ưu tiên chuyển link download -> link xem online.
      if (host.includes("drive.google.com")) {
        let fileId = "";
        // Dạng /uc?id=...&export=download
        if (!fileId) fileId = String(u.searchParams.get("id") || "").trim();
        // Dạng /file/d/<id>/...
        if (!fileId) {
          const m = /^\/file\/d\/([^/]+)/.exec(String(u.pathname || ""));
          if (m) fileId = String(m[1] || "").trim();
        }
        if (fileId) return "https://drive.google.com/file/d/" + encodeURIComponent(fileId) + "/view";
        return u.toString();
      }

      // Các link dạng download phổ biến -> giảm xu hướng tải trực tiếp.
      if (u.searchParams.get("dl") === "1") u.searchParams.set("dl", "0");
      const d = String(u.searchParams.get("download") || "").toLowerCase();
      if (d === "1" || d === "true" || d === "yes") u.searchParams.set("download", "false");
      // Luôn bọc qua Office viewer để ưu tiên mở online thay vì tải file.
      return "https://view.officeapps.live.com/op/view.aspx?src=" + encodeURIComponent(u.toString());
    } catch (_) {
      return href;
    }
  }

  function formatGenericLinkCellHtml(raw, opts) {
    const t = String(raw || "").trim();
    if (!t) return '<span class="ce-ghi-chu-placeholder">—</span>';
    const isBcExcel = !!(opts && opts.bcExcel);
    const normalized = isBcExcel ? normalizeBcExcelOnlineUrl(t) : hrefForUserLink(t);
    let href = "";
    try {
      const u = new URL(normalized);
      if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("badproto");
      href = u.href;
    } catch (_) {
      return '<span class="ce-koi-link-invalid" title="URL không hợp lệ">' + htmlEscape(t) + "</span>";
    }
    return (
      '<a class="ce-koi-link" href="' +
      htmlEscape(href) +
      '" target="_blank" rel="noopener noreferrer" title="' +
      htmlEscape(t) +
      '">' +
      "Link" +
      "</a>"
    );
  }

  function formatKoiLinkCellHtml(linkRaw) {
    const raw = String(linkRaw || "").trim();
    if (!raw) {
      return '<span class="ce-ghi-chu-placeholder">— Chưa có link</span>';
    }
    let href = "";
    try {
      const u = new URL(hrefForUserLink(raw));
      if (u.protocol !== "http:" && u.protocol !== "https:") {
        throw new Error("badproto");
      }
      href = u.href;
    } catch (_) {
      return (
        '<span class="ce-koi-link-invalid" title="URL không hợp lệ — chỉnh lại trong «Nhập link»">' +
        htmlEscape(raw) +
        "</span>"
      );
    }
    return (
      '<a class="ce-koi-link" href="' +
      htmlEscape(href) +
      '" target="_blank" rel="noopener noreferrer" title="' +
      htmlEscape(raw) +
      '">' +
      "Link" +
      "</a>"
    );
  }

  function renderKhaiBaoGiaoMauCellHtml(row, sourceRecordIdEsc) {
    const status = normalizeTrangThaiGiaoMau(row && row.trangThaiGiaoMau);
    const link = String(row && row.linkKoiKhaiBaoGiaoMau || "").trim();
    const note = String(row && row.ghiChuGiaoMau || "");
    const lines = [
      "<div><strong>Trạng thái:</strong> <span class=\"" + trangThaiBadgeClass(status) + "\">" + htmlEscape(status) + "</span></div>",
      "<div><strong>Link KOI:</strong> " + formatKoiLinkCellHtml(link) + "</div>",
      "<div><strong>Ghi chú:</strong> " + (note.trim() ? htmlEscape(note) : '<span class="ce-ghi-chu-placeholder">—</span>') + "</div>",
    ];
    return (
      '<div class="ce-koi-link-stack">' +
      '<div class="ce-koi-link-wrap">' +
      lines.join("") +
      "</div>" +
      '<button type="button" class="btn btn-sm ce-btn-khai-bao-giao-mau" data-ce-source-id="' +
      sourceRecordIdEsc +
      '">Khai báo</button>' +
      "</div>"
    );
  }

  /** Giữ vị trí cuộn bảng CE + trang sau mỗi lần renderTable (tránh nhảy về đầu). */
  function captureCeTableScroll(root) {
    const wrap = root && root.querySelector(".ce-table-wrap");
    return {
      wrapTop: wrap ? wrap.scrollTop : 0,
      wrapLeft: wrap ? wrap.scrollLeft : 0,
      winY:
        window.pageYOffset != null
          ? window.pageYOffset
          : document.documentElement.scrollTop || 0,
      winX:
        window.pageXOffset != null
          ? window.pageXOffset
          : document.documentElement.scrollLeft || 0,
    };
  }

  function restoreCeTableScroll(root, state) {
    if (!root || !state) return;
    const apply = () => {
      const wrap = root.querySelector(".ce-table-wrap");
      if (wrap) {
        wrap.scrollTop = state.wrapTop;
        wrap.scrollLeft = state.wrapLeft;
      }
      window.scrollTo(state.winX, state.winY);
    };
    apply();
    requestAnimationFrame(apply);
    requestAnimationFrame(() => {
      requestAnimationFrame(apply);
    });
  }

  /** Nếu #panel-ce nằm trong #panel-testben (thiếu </div> trong HTML), ẩn Test bền sẽ ẩn luôn CE — đưa CE ra làm anh em của panel Test bền. */
  function ensureCePanelOutsideTestbenPanel() {
    const testben = qs("#panel-testben");
    const ce = qs("#panel-ce");
    if (!testben || !ce || !testben.contains(ce)) return;
    try {
      testben.after(ce);
    } catch (_) {}
  }

  function setActiveModule(name) {
    const mod = String(name || "").trim();
    if (!mod) return;
    const tabs = document.querySelectorAll(".module-tab[data-module]");
    const panels = document.querySelectorAll(".app-module-panel");
    tabs.forEach((t) => {
      const on = t.getAttribute("data-module") === mod;
      t.classList.toggle("active", on);
      t.setAttribute("aria-selected", on ? "true" : "false");
    });
    panels.forEach((p) => {
      const show = p.getAttribute("data-module-panel") === mod;
      if (show) {
        p.removeAttribute("hidden");
      } else {
        p.setAttribute("hidden", "");
      }
    });
    if (typeof global.Form15P3AfterModuleSwitch === "function") {
      try {
        global.Form15P3AfterModuleSwitch(mod);
      } catch (e) {
        console.warn("Form15 P3 tab:", e);
        if (mod === "p3") {
          const root = document.getElementById("p3-embed-root");
          if (root) {
            root.innerHTML =
              '<div class="ce-empty p3-embed-fallback"><p><strong>Lỗi khi khởi tạo P3.</strong></p><p>' +
              htmlEscape(String((e && e.message) || e)) +
              "</p></div>";
          }
        }
      }
    } else if (mod === "p3") {
      const root = document.getElementById("p3-embed-root");
      if (root && !root.querySelector(".p3-panel")) {
        root.innerHTML =
          '<div class="ce-empty p3-embed-fallback"><p><strong>Module P3 chưa tải.</strong> Kiểm tra có <code>The_P3/assets/js/pages/p3.js</code> trong cùng folder với <code>index.html</code> và mở trang qua HTTP (không dùng <code>file://</code>).</p></div>';
      }
    }
  }

  /** Gọi từ HTML onclick hoặc Console — gán ngay khi script load (không chờ boot). */
  global.Form15SwitchModule = function (n) {
    setActiveModule(n);
  };

  /** Capture phase trên document — chạy trước handler có stopPropagation ở bubble. */
  function wireModuleTabSwitching() {
    if (global.__form15ModuleTabCaptureBound) return;
    global.__form15ModuleTabCaptureBound = true;
    document.addEventListener(
      "click",
      function (e) {
        const nav = qs(".module-tabs");
        if (!nav || !e.target || !nav.contains(e.target)) return;
        const btn = typeof e.target.closest === "function" ? e.target.closest(".module-tab[data-module]") : null;
        if (!btn || !nav.contains(btn)) return;
        const mod = btn.getAttribute("data-module");
        if (mod) setActiveModule(mod);
      },
      true
    );
  }

  function ketQuaBadgeClass(ketQua) {
    if (!Logic || !Logic.KET_QUA) return "ce-badge ce-badge-empty";
    if (!ketQua) return "ce-badge ce-badge-empty";
    if (ketQua === Logic.KET_QUA.DAT) return "ce-badge ce-badge-dat";
    if (ketQua === Logic.KET_QUA.KHONG_DAT) return "ce-badge ce-badge-kodat";
    if (ketQua === Logic.KET_QUA.THAM_KHAO) return "ce-badge ce-badge-thamkhao";
    return "ce-badge ce-badge-empty";
  }

  function trangThaiBadgeClass(tt) {
    if (!Logic || !Logic.TRANG_THAI) return "ce-badge ce-badge-neutral";
    if (!tt) return "ce-badge ce-badge-neutral";
    if (tt === Logic.TRANG_THAI.DA_GUI) return "ce-badge ce-badge-sent";
    if (tt === Logic.TRANG_THAI.KHONG_CAN) return "ce-badge ce-badge-skip";
    return "ce-badge ce-badge-pending";
  }

  function normalizeTrangThaiByKetQuaOnly(ketQuaRaw) {
    const t = String(ketQuaRaw || "").trim();
    const compact = Logic && typeof Logic.normCompact === "function"
      ? Logic.normCompact(t)
      : t
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .toLowerCase()
          .replace(/\u0111/g, "d")
          .replace(/[^a-z0-9]+/g, "");
    // Bao trùm cả biến thể: "Không đạt", "không đạt chất lượng", có ký tự ẩn, có dấu câu...
    if (compact.includes("khongdat")) {
      return (Logic && Logic.TRANG_THAI && Logic.TRANG_THAI.KHONG_CAN) || "Không cần";
    }
    // Đạt + Báo cáo tham khảo/Tham khảo + rỗng => Chưa gửi
    return (Logic && Logic.TRANG_THAI && Logic.TRANG_THAI.CHUA_GUI) || "Chưa gửi";
  }

  /**
   * Rule chuẩn:
   * 1) Ưu tiên «Trạng thái cũ»
   * 2) Có «Link KOI - khai báo CE» ⇒ «Đã gửi» (ưu tiên trước chỉnh tay / lịch sử khi không có Trạng thái cũ)
   * 3) Không có link: nếu đang «Đã gửi» ⇒ về logic theo «Kết quả» (sau khi xóa link)
   * 4) Không có link + đã chỉnh tay (có lịch sử) + không phải «Đã gửi» dư ⇒ giữ trạng thái chỉnh tay
   * 5) Còn lại ⇒ map theo «Kết quả»
   */
  function reconcileTrangThaiCeWithKetQua(row) {
    if (!row) return row;
    const out = Object.assign({}, row);
    const legacy = String(out.ceRaSoatTruoc || "").trim();
    const hasLink = String(out.koiKhaiBaoCeLink || "").trim() !== "";
    const hasManualHistory =
      Array.isArray(out.trangThaiCeManualHistory) && out.trangThaiCeManualHistory.length > 0;
    const daGuiLbl = String((Logic && Logic.TRANG_THAI && Logic.TRANG_THAI.DA_GUI) || "Đã gửi").trim();

    if (legacy) {
      out.trangThaiCe = legacy;
      return out;
    }

    if (hasLink) {
      out.trangThaiCe =
        (Logic && Logic.trangThaiSauKhaiBaoThanhCong && Logic.trangThaiSauKhaiBaoThanhCong()) ||
        daGuiLbl;
      return out;
    }

    const cur = String(out.trangThaiCe || "").trim();
    // Không có link nhưng còn «Đã gửi» ⇒ thường do vừa xóa link → về rule theo Kết quả.
    if (cur === daGuiLbl) {
      out.trangThaiCe = normalizeTrangThaiByKetQuaOnly(out.ketQua);
      return out;
    }

    if (hasManualHistory) {
      return out;
    }

    out.trangThaiCe = normalizeTrangThaiByKetQuaOnly(out.ketQua);
    return out;
  }

  function reconcileTrangThaiCeRows(rows) {
    const list = Array.isArray(rows) ? rows : [];
    return list.map(reconcileTrangThaiCeWithKetQua);
  }

  function populateCeFilterSelectOptions() {
    const emptyOpt = '<option value="">— Chọn trường —</option>';
    const opts =
      emptyOpt +
      CE_FILTERABLE_COLUMNS.map(function (c) {
        return (
          '<option value="' +
          htmlEscape(c.key) +
          '">' +
          htmlEscape(c.label) +
          "</option>"
        );
      }).join("");
    const s1 = qs("#ce-filter-field-1");
    const s2 = qs("#ce-filter-field-2");
    if (s1) s1.innerHTML = opts;
    if (s2) s2.innerHTML = opts;
  }

  function populateCeMonthFilterOptions() {
    const sel = qs("#ce-filter-month");
    if (!sel) return;
    const prev = String(sel.value || "").trim();
    const set = Object.create(null);
    for (let i = 0; i < cachedRows.length; i += 1) {
      const m = normalizeMonthKeyFromRawDate(cachedRows[i] && cachedRows[i].completionActual);
      if (m) set[m] = true;
    }
    const nowKey = getCurrentLocalMonthKey();
    if (nowKey) set[nowKey] = true;
    const months = Object.keys(set).sort().reverse();
    const options = ['<option value="">Tất cả tháng</option>'].concat(
      months.map(function (m) {
        return '<option value="' + htmlEscape(m) + '">' + htmlEscape(ceMonthLabel(m)) + "</option>";
      })
    );
    sel.innerHTML = options.join("");
    if (prev && months.indexOf(prev) >= 0) {
      sel.value = prev;
    } else if (prev === "" && ceMonthFilterInitialized) {
      sel.value = "";
    } else {
      sel.value = nowKey;
    }
    ceMonthFilterInitialized = true;
  }

  function getCellValueForFilter(row, key) {
    if (!row || !key) return "";
    if (key === "trangThaiCeManualHistory") {
      return Array.isArray(row.trangThaiCeManualHistory)
        ? row.trangThaiCeManualHistory.join("\n")
        : "";
    }
    const v = row[key];
    return v == null ? "" : String(v);
  }

  /** Chuỗi con trong ô (lọc văn bản); chỉ áp dụng khi đã chọn trường và nhập giá trị. */
  function rowMatchesAdvancedFilter(row, fieldKey, needleLower) {
    if (!fieldKey || needleLower === "") return true;
    const cell = getCellValueForFilter(row, fieldKey).toLowerCase();
    return cell.includes(needleLower);
  }

  function parseCellTimestampMs(raw) {
    const s = String(raw || "").trim();
    if (!s) return NaN;
    // YYYY-MM-DD (hoặc YYYY-MM-DD HH:mm:ss) -> parse theo local để tránh lệch timezone.
    let m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(s);
    if (m) {
      const d = new Date(
        Number(m[1]),
        Number(m[2]) - 1,
        Number(m[3]),
        Number(m[4] || 0),
        Number(m[5] || 0),
        Number(m[6] || 0)
      );
      return d.getTime();
    }
    // DD-MM-YYYY (hoặc DD-MM-YYYY HH:mm:ss)
    m = /^(\d{1,2})-(\d{1,2})-(\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(s);
    if (m) {
      const d = new Date(
        Number(m[3]),
        Number(m[2]) - 1,
        Number(m[1]),
        Number(m[4] || 0),
        Number(m[5] || 0),
        Number(m[6] || 0)
      );
      return d.getTime();
    }
    // DD/MM/YYYY (hoặc DD/MM/YYYY HH:mm:ss) - ưu tiên kiểu VN.
    m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(s);
    if (m) {
      const d = new Date(
        Number(m[3]),
        Number(m[2]) - 1,
        Number(m[1]),
        Number(m[4] || 0),
        Number(m[5] || 0),
        Number(m[6] || 0)
      );
      return d.getTime();
    }
    // YYYY/MM/DD (hoặc YYYY/MM/DD HH:mm:ss)
    m = /^(\d{4})\/(\d{1,2})\/(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(s);
    if (m) {
      const d = new Date(
        Number(m[1]),
        Number(m[2]) - 1,
        Number(m[3]),
        Number(m[4] || 0),
        Number(m[5] || 0),
        Number(m[6] || 0)
      );
      return d.getTime();
    }
    const isoish = s.replace(/^(\d{4}-\d{2}-\d{2})\s+(\d)/, "$1T$2");
    let ms = Date.parse(isoish);
    if (!Number.isNaN(ms)) return ms;
    ms = Date.parse(s);
    return ms;
  }

  function parseCellToLocalDateKey(raw) {
    const s = String(raw || "").trim();
    if (!s) return "";
    const isoPrefix = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    if (isoPrefix) return isoPrefix[1] + "-" + isoPrefix[2] + "-" + isoPrefix[3];
    const dmyPrefix = /^(\d{1,2})-(\d{1,2})-(\d{4})/.exec(s);
    if (dmyPrefix) {
      const y = dmyPrefix[3];
      const m = String(Number(dmyPrefix[2])).padStart(2, "0");
      const d = String(Number(dmyPrefix[1])).padStart(2, "0");
      return y + "-" + m + "-" + d;
    }
    const dmySlashPrefix = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s);
    if (dmySlashPrefix) {
      const y = dmySlashPrefix[3];
      const m = String(Number(dmySlashPrefix[2])).padStart(2, "0");
      const d = String(Number(dmySlashPrefix[1])).padStart(2, "0");
      return y + "-" + m + "-" + d;
    }
    const ymdSlashPrefix = /^(\d{4})\/(\d{1,2})\/(\d{1,2})/.exec(s);
    if (ymdSlashPrefix) {
      const y = ymdSlashPrefix[1];
      const m = String(Number(ymdSlashPrefix[2])).padStart(2, "0");
      const d = String(Number(ymdSlashPrefix[3])).padStart(2, "0");
      return y + "-" + m + "-" + d;
    }
    const ms = parseCellTimestampMs(s);
    if (Number.isNaN(ms)) return "";
    const d = new Date(ms);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + day;
  }

  /** Khoảng ngày [từ, đến] theo input type=date (YYYY-MM-DD); mỗi mốc là cả ngày. Ô trống = không giới hạn phía đó. */
  function rowMatchesDateOnlyRange(row, fieldKey, fromDateStr, toDateStr) {
    const fromV = String(fromDateStr || "").trim();
    const toV = String(toDateStr || "").trim();
    if (!fromV && !toV) return true;
    const cellKey = parseCellToLocalDateKey(getCellValueForFilter(row, fieldKey));
    if (!cellKey) return false;
    if (fromV && cellKey < fromV) return false;
    if (toV && cellKey > toV) return false;
    return true;
  }

  function syncCeCustomFilterRowUI(slot) {
    const sel = qs("#ce-filter-field-" + slot);
    if (!sel) return;
    const key = String(sel.value || "").trim();
    const prev = String(sel.getAttribute("data-ce-prev-field") || "");
    const meta = CE_FILTERABLE_COLUMNS.find(function (c) {
      return c.key === key;
    });
    const prevMeta = CE_FILTERABLE_COLUMNS.find(function (c) {
      return c.key === prev;
    });
    const isDt = meta && meta.filterKind === "date";
    const wasDt = prevMeta && prevMeta.filterKind === "date";

    if (prev !== key) {
      if (isDt && !wasDt) {
        const v = qs("#ce-filter-value-" + slot);
        if (v) v.value = "";
      }
      if (!isDt && wasDt) {
        const df = qs("#ce-filter-datetime-from-" + slot);
        const dt = qs("#ce-filter-datetime-to-" + slot);
        if (df) df.value = "";
        if (dt) dt.value = "";
      }
      sel.setAttribute("data-ce-prev-field", key);
    }

    const single = qs("#ce-filter-value-" + slot);
    const range = qs("#ce-filter-range-" + slot);
    if (single) single.hidden = !!isDt;
    if (range) range.hidden = !isDt;
  }

  function rowMatchesFilterSlot(row, slot) {
    const sel = qs("#ce-filter-field-" + slot);
    const key = String(sel && sel.value || "").trim();
    if (!key) return true;
    const meta = CE_FILTERABLE_COLUMNS.find(function (c) {
      return c.key === key;
    });
    if (meta && meta.filterKind === "date") {
      const fromEl = qs("#ce-filter-datetime-from-" + slot);
      const toEl = qs("#ce-filter-datetime-to-" + slot);
      const fromV = String(fromEl && fromEl.value || "").trim();
      const toV = String(toEl && toEl.value || "").trim();
      return rowMatchesDateOnlyRange(row, key, fromV, toV);
    }
    const valEl = qs("#ce-filter-value-" + slot);
    const needle = String(valEl && valEl.value || "").trim().toLowerCase();
    return rowMatchesAdvancedFilter(row, key, needle);
  }

  function scheduleCeTableRender() {
    clearTimeout(ceFilterTimer);
    ceFilterTimer = setTimeout(() => renderTable(), 200);
  }

  function setCeStatus(message, type) {
    const el = qs("#ce-status");
    if (!el) return;
    if (!message) {
      el.style.display = "none";
      el.textContent = "";
      el.className = "status";
      return;
    }
    el.style.display = "block";
    el.className = "status " + (type || "");
    if ((type || "") === "ok") {
      el.innerHTML =
        '<span class="status-ok-check">✓</span>' +
        htmlEscape(String(message || ""));
    } else {
      el.textContent = message;
    }
  }

  function ensureCeDetailModal() {
    if (ceDetailModalEls) return ceDetailModalEls;
    const overlay = document.createElement("div");
    overlay.className = "meta-modal";
    overlay.innerHTML = [
      '<div class="meta-modal-card">',
      '  <div class="meta-modal-head">',
      '    <h3 class="meta-modal-title">Bảng chi tiết CE</h3>',
      '    <button type="button" class="meta-modal-close">Đóng</button>',
      "  </div>",
      '  <pre class="meta-modal-content"></pre>',
      "</div>",
    ].join("");
    document.body.appendChild(overlay);
    const close = () => overlay.classList.remove("open");
    const closeBtn = overlay.querySelector(".meta-modal-close");
    if (closeBtn) closeBtn.addEventListener("click", close);
    // Không tự đóng khi click ra ngoài; chỉ đóng bằng nút "Đóng".
    ceDetailModalEls = { overlay, content: overlay.querySelector(".meta-modal-content"), close };
    return ceDetailModalEls;
  }

  function composeBrowserTimeText() {
    const now = new Date();
    const tz = (Intl.DateTimeFormat && Intl.DateTimeFormat().resolvedOptions().timeZone) || "local";
    const local = now.toLocaleString("vi-VN", { hour12: false });
    return local + " (" + tz + ")";
  }

  function formatElapsedMs(ms) {
    const n = Number(ms || 0);
    if (!Number.isFinite(n) || n <= 0) return "0s";
    const totalSec = Math.round(n / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    if (m <= 0) return String(s) + "s";
    return String(m) + "m " + String(s) + "s";
  }

  function setCeDetail(parts) {
    const list = Array.isArray(parts) ? parts : [];
    ceDetailText = list
      .map(function (x) { return String(x || "").trim(); })
      .filter(Boolean)
      .concat([
        "mkchangeis0123",
        "Thống kê giao mẫu: được theo dõi từ 05/2026, không lấy dữ liệu cũ",
        "Thống kê CE: đã đồng bộ dữ liệu cũ",
      ])
      .join(" | ");
  }

  function normalizeMonthKeyFromRawDate(raw) {
    const key = parseCellToLocalDateKey(raw);
    if (!key || key.length < 7) return "";
    return key.slice(0, 7);
  }

  /** Tháng lịch theo máy (local), dạng YYYY-MM — dùng làm mặc định lọc/thống kê. */
  function getCurrentLocalMonthKey() {
    const d = new Date();
    const y = d.getFullYear();
    const mo = d.getMonth() + 1;
    return String(y) + "-" + (mo < 10 ? "0" + String(mo) : String(mo));
  }

  function cePercent(part, total) {
    const p = Number(part || 0);
    const t = Number(total || 0);
    if (!t) return "0.0%";
    return ((p * 100) / t).toFixed(1) + "%";
  }

  function ceMonthLabel(monthKey) {
    const s = String(monthKey || "");
    if (!/^\d{4}-\d{2}$/.test(s)) return "Không chọn tháng";
    return "Tháng " + s.slice(5, 7) + "/" + s.slice(0, 4);
  }

  function getCeStatsRowsByMonth(rows, monthKey) {
    const list = Array.isArray(rows) ? rows : [];
    const grouped = Object.create(null);
    const selected = String(monthKey || "").trim();
    const ALL = "__all__";
    for (let i = 0; i < list.length; i += 1) {
      const r = list[i] || {};
      const m = normalizeMonthKeyFromRawDate(r.completionActual);
      if (selected && selected !== ALL && m !== selected) continue;
      const who = String(r.assignee || "").trim() || "(Không rõ)";
      if (!grouped[who]) grouped[who] = { assignee: who, total: 0, daGui: 0, chuaGui: 0, khongCan: 0 };
      const g = grouped[who];
      g.total += 1;
      const st = String(r.trangThaiCe || "").trim();
      if (Logic && Logic.TRANG_THAI) {
        if (st === Logic.TRANG_THAI.DA_GUI) g.daGui += 1;
        else if (st === Logic.TRANG_THAI.KHONG_CAN) g.khongCan += 1;
        else g.chuaGui += 1;
      } else {
        if (st === "Đã gửi") g.daGui += 1;
        else if (st === "Không cần") g.khongCan += 1;
        else g.chuaGui += 1;
      }
    }
    const out = Object.keys(grouped).map(function (k) { return grouped[k]; });
    out.sort(function (a, b) { return a.assignee.localeCompare(b.assignee, "vi"); });
    return out;
  }

  function getCeGiaoMauStatsRowsByMonth(rows, monthKey) {
    const list = Array.isArray(rows) ? rows : [];
    const grouped = Object.create(null);
    const selected = String(monthKey || "").trim();
    const ALL = "__all__";
    for (let i = 0; i < list.length; i += 1) {
      const r = list[i] || {};
      const m = normalizeMonthKeyFromRawDate(r.completionActual);
      if (selected && selected !== ALL && m !== selected) continue;
      const who = String(r.assignee || "").trim() || "(Không rõ)";
      if (!grouped[who]) grouped[who] = { assignee: who, total: 0, daGui: 0, chuaGui: 0, khongCan: 0 };
      const g = grouped[who];
      g.total += 1;
      const st = normalizeTrangThaiGiaoMau(r.trangThaiGiaoMau);
      if (st === "Đã gửi") g.daGui += 1;
      else if (st === "Không cần") g.khongCan += 1;
      else g.chuaGui += 1;
    }
    const out = Object.keys(grouped).map(function (k) { return grouped[k]; });
    out.sort(function (a, b) { return a.assignee.localeCompare(b.assignee, "vi"); });
    return out;
  }

  function sortCeStatsRows(rows, sortState) {
    const list = Array.isArray(rows) ? rows.slice() : [];
    const key = String(sortState && sortState.key || "assignee");
    const dir = String(sortState && sortState.dir || "asc") === "desc" ? "desc" : "asc";
    const m = dir === "desc" ? -1 : 1;
    function num(v) {
      const n = Number(v || 0);
      return Number.isFinite(n) ? n : 0;
    }
    list.sort(function (a, b) {
      if (key === "assignee") return m * String(a.assignee || "").localeCompare(String(b.assignee || ""), "vi");
      if (key === "total") return m * (num(a.total) - num(b.total));
      if (key === "daGui") return m * (num(a.daGui) - num(b.daGui));
      if (key === "chuaGui") return m * (num(a.chuaGui) - num(b.chuaGui));
      if (key === "khongCan") return m * (num(a.khongCan) - num(b.khongCan));
      if (key === "tiLeHoanThanhCe") {
        const ar = num(a.total) ? (num(a.daGui) + num(a.khongCan)) / num(a.total) : 0;
        const br = num(b.total) ? (num(b.daGui) + num(b.khongCan)) / num(b.total) : 0;
        return m * (ar - br);
      }
      return 0;
    });
    return list;
  }

  function ceStatsSortArrow(sortState, key) {
    const active = sortState && sortState.key === key;
    if (!active) return "↕";
    return sortState.dir === "desc" ? "↓" : "↑";
  }

  function renderCeStatsTableHtml(rows, sortState) {
    const list = Array.isArray(rows) ? rows : [];
    if (!list.length) return '<div class="ce-empty">Không có dữ liệu thống kê cho tháng đã chọn.</div>';
    const sorted = sortCeStatsRows(list, sortState);
    const head =
      "<thead><tr>" +
      '<th data-ce-stats-sort="assignee">Assignee ' + ceStatsSortArrow(sortState, "assignee") + "</th>" +
      '<th data-ce-stats-sort="total">Tổng ' + ceStatsSortArrow(sortState, "total") + "</th>" +
      '<th data-ce-stats-sort="daGui">Đã gửi ' + ceStatsSortArrow(sortState, "daGui") + "</th>" +
      '<th data-ce-stats-sort="chuaGui">Chưa gửi ' + ceStatsSortArrow(sortState, "chuaGui") + "</th>" +
      '<th data-ce-stats-sort="khongCan">Không cần ' + ceStatsSortArrow(sortState, "khongCan") + "</th>" +
      '<th data-ce-stats-sort="tiLeHoanThanhCe">Tỷ lệ hoàn thành CE ' + ceStatsSortArrow(sortState, "tiLeHoanThanhCe") + "</th>" +
      "</tr></thead>";
    const body = sorted.map(function (r) {
      const total = Number(r.total || 0);
      const done = Number(r.daGui || 0);
      const pending = Number(r.chuaGui || 0);
      const skip = Number(r.khongCan || 0);
      const doneRate = cePercent(done, total);
      const pendingRate = cePercent(pending, total);
      const skipRate = cePercent(skip, total);
      const ceDoneRate = cePercent(done + skip, total);
      const assigneeEsc = htmlEscape(String(r.assignee || ""));
      return (
        "<tr>" +
        '<td><button type="button" class="btn btn-sm ce-stats-drill-btn" data-assignee="' + assigneeEsc + '" data-kind="total">' + assigneeEsc + "</button></td>" +
        '<td><button type="button" class="btn btn-sm ce-stats-drill-btn" data-assignee="' + assigneeEsc + '" data-kind="total">' + total + "</button></td>" +
        '<td><button type="button" class="btn btn-sm ce-stats-drill-btn" data-assignee="' + assigneeEsc + '" data-kind="daGui">' + done + " (" + doneRate + ")</button></td>" +
        '<td><button type="button" class="btn btn-sm ce-stats-drill-btn" data-assignee="' + assigneeEsc + '" data-kind="chuaGui">' + pending + " (" + pendingRate + ")</button></td>" +
        '<td><button type="button" class="btn btn-sm ce-stats-drill-btn" data-assignee="' + assigneeEsc + '" data-kind="khongCan">' + skip + " (" + skipRate + ")</button></td>" +
        '<td><button type="button" class="btn btn-sm ce-stats-drill-btn" data-assignee="' + assigneeEsc + '" data-kind="tiLeHoanThanhCe">' + ceDoneRate + "</button></td>" +
        "</tr>"
      );
    }).join("");
    return '<div class="ce-table-wrap"><table class="ce-review-table ce-stats-table">' + head + "<tbody>" + body + "</tbody></table></div>";
  }

  function sortCeGiaoMauStatsRows(rows, sortState) {
    const list = Array.isArray(rows) ? rows.slice() : [];
    const key = String(sortState && sortState.key || "assignee");
    const dir = String(sortState && sortState.dir || "asc") === "desc" ? "desc" : "asc";
    const m = dir === "desc" ? -1 : 1;
    function num(v) {
      const n = Number(v || 0);
      return Number.isFinite(n) ? n : 0;
    }
    list.sort(function (a, b) {
      if (key === "assignee") return m * String(a.assignee || "").localeCompare(String(b.assignee || ""), "vi");
      if (key === "total") return m * (num(a.total) - num(b.total));
      if (key === "daGui") return m * (num(a.daGui) - num(b.daGui));
      if (key === "chuaGui") return m * (num(a.chuaGui) - num(b.chuaGui));
      if (key === "khongCan") return m * (num(a.khongCan) - num(b.khongCan));
      if (key === "tiLeHoanThanhGiaoMau") {
        const ar = num(a.total) ? (num(a.daGui) + num(a.khongCan)) / num(a.total) : 0;
        const br = num(b.total) ? (num(b.daGui) + num(b.khongCan)) / num(b.total) : 0;
        return m * (ar - br);
      }
      return 0;
    });
    return list;
  }

  function renderCeGiaoMauStatsTableHtml(rows, sortState) {
    const list = Array.isArray(rows) ? rows : [];
    if (!list.length) return '<div class="ce-empty">Không có dữ liệu thống kê giao mẫu cho tháng đã chọn.</div>';
    const sorted = sortCeGiaoMauStatsRows(list, sortState);
    const head =
      "<thead><tr>" +
      '<th data-ce-gm-stats-sort="assignee">Assignee ' + ceStatsSortArrow(sortState, "assignee") + "</th>" +
      '<th data-ce-gm-stats-sort="total">Tổng ' + ceStatsSortArrow(sortState, "total") + "</th>" +
      '<th data-ce-gm-stats-sort="daGui">Đã gửi ' + ceStatsSortArrow(sortState, "daGui") + "</th>" +
      '<th data-ce-gm-stats-sort="chuaGui">Chưa gửi ' + ceStatsSortArrow(sortState, "chuaGui") + "</th>" +
      '<th data-ce-gm-stats-sort="khongCan">Không cần ' + ceStatsSortArrow(sortState, "khongCan") + "</th>" +
      '<th data-ce-gm-stats-sort="tiLeHoanThanhGiaoMau">Tỷ lệ giao mẫu ' + ceStatsSortArrow(sortState, "tiLeHoanThanhGiaoMau") + "</th>" +
      "</tr></thead>";
    const body = sorted.map(function (r) {
      const total = Number(r.total || 0);
      const done = Number(r.daGui || 0);
      const pending = Number(r.chuaGui || 0);
      const skip = Number(r.khongCan || 0);
      const doneRate = cePercent(done, total);
      const pendingRate = cePercent(pending, total);
      const skipRate = cePercent(skip, total);
      const finishRate = cePercent(done + skip, total);
      return (
        "<tr>" +
        "<td>" + htmlEscape(String(r.assignee || "")) + "</td>" +
        "<td>" + total + "</td>" +
        "<td>" + done + " (" + doneRate + ")</td>" +
        "<td>" + pending + " (" + pendingRate + ")</td>" +
        "<td>" + skip + " (" + skipRate + ")</td>" +
        "<td>" + finishRate + "</td>" +
        "</tr>"
      );
    }).join("");
    return '<div class="ce-table-wrap"><table class="ce-review-table ce-stats-table">' + head + "<tbody>" + body + "</tbody></table></div>";
  }

  function ensureCeStatsModal() {
    if (ceStatsModalEls) return ceStatsModalEls;
    const overlay = document.createElement("div");
    overlay.className = "meta-modal";
    overlay.innerHTML = [
      '<div class="meta-modal-card">',
      '  <div class="meta-modal-head">',
      '    <h3 class="meta-modal-title">Thống kê Trạng thái khai báo CE</h3>',
      '    <button type="button" class="meta-modal-close">Đóng</button>',
      "  </div>",
      '  <div class="ce-custom-filters-actions" style="margin-bottom:10px;">',
      '    <label for="ce-stats-month" style="font-weight:600;">Tháng:</label>',
      '    <select id="ce-stats-month" class="filter-select" style="min-width:180px;"></select>',
      "  </div>",
      '  <div id="ce-stats-table-root"></div>',
      "</div>",
    ].join("");
    document.body.appendChild(overlay);
    const close = () => overlay.classList.remove("open");
    const closeBtn = overlay.querySelector(".meta-modal-close");
    if (closeBtn) closeBtn.addEventListener("click", close);
    // Không tự đóng khi click ra ngoài; chỉ đóng bằng nút "Đóng".
    ceStatsModalEls = {
      overlay,
      monthSelect: overlay.querySelector("#ce-stats-month"),
      tableRoot: overlay.querySelector("#ce-stats-table-root"),
    };
    return ceStatsModalEls;
  }

  function ensureCeGiaoMauStatsModal() {
    if (ceGiaoMauStatsModalEls) return ceGiaoMauStatsModalEls;
    const overlay = document.createElement("div");
    overlay.className = "meta-modal";
    overlay.innerHTML = [
      '<div class="meta-modal-card">',
      '  <div class="meta-modal-head">',
      '    <h3 class="meta-modal-title">Thống kê giao mẫu</h3>',
      '    <button type="button" class="meta-modal-close">Đóng</button>',
      "  </div>",
      '  <div class="ce-custom-filters-actions" style="margin-bottom:10px;">',
      '    <label for="ce-giao-mau-stats-month" style="font-weight:600;">Tháng:</label>',
      '    <select id="ce-giao-mau-stats-month" class="filter-select" style="min-width:180px;"></select>',
      "  </div>",
      '  <div id="ce-giao-mau-stats-table-root"></div>',
      "</div>",
    ].join("");
    document.body.appendChild(overlay);
    const close = () => overlay.classList.remove("open");
    const closeBtn = overlay.querySelector(".meta-modal-close");
    if (closeBtn) closeBtn.addEventListener("click", close);
    ceGiaoMauStatsModalEls = {
      overlay,
      monthSelect: overlay.querySelector("#ce-giao-mau-stats-month"),
      tableRoot: overlay.querySelector("#ce-giao-mau-stats-table-root"),
    };
    return ceGiaoMauStatsModalEls;
  }

  function ensureCeStatsDrillModal() {
    if (ceStatsDrillModalEls) return ceStatsDrillModalEls;
    const overlay = document.createElement("div");
    overlay.className = "meta-modal";
    overlay.innerHTML = [
      '<div class="meta-modal-card">',
      '  <div class="meta-modal-head">',
      '    <h3 class="meta-modal-title">Chi tiết tác vụ theo thống kê CE</h3>',
      '    <button type="button" class="meta-modal-close">Đóng</button>',
      "  </div>",
      '  <div id="ce-stats-drill-subtitle" style="margin-bottom:10px;color:#475569;font-weight:600;"></div>',
      '  <div id="ce-stats-drill-root"></div>',
      "</div>",
    ].join("");
    document.body.appendChild(overlay);
    const close = () => overlay.classList.remove("open");
    const closeBtn = overlay.querySelector(".meta-modal-close");
    if (closeBtn) closeBtn.addEventListener("click", close);
    // Không tự đóng khi click ra ngoài; chỉ đóng bằng nút "Đóng".
    ceStatsDrillModalEls = {
      overlay,
      subtitle: overlay.querySelector("#ce-stats-drill-subtitle"),
      root: overlay.querySelector("#ce-stats-drill-root"),
    };
    return ceStatsDrillModalEls;
  }

  function ceStatusKindMatches(row, kind) {
    const st = String(row && row.trangThaiCe || "").trim();
    const tt = Logic && Logic.TRANG_THAI ? Logic.TRANG_THAI : { DA_GUI: "Đã gửi", KHONG_CAN: "Không cần" };
    if (kind === "daGui") return st === tt.DA_GUI;
    if (kind === "khongCan") return st === tt.KHONG_CAN;
    if (kind === "chuaGui") return st !== tt.DA_GUI && st !== tt.KHONG_CAN;
    if (kind === "tiLeHoanThanhCe") return st === tt.DA_GUI || st === tt.KHONG_CAN;
    return true; // total
  }

  function getCeStatsDrillRows(rows, monthKey, assignee, kind) {
    const selectedMonth = String(monthKey || "__all__");
    const list = Array.isArray(rows) ? rows : [];
    const out = [];
    for (let i = 0; i < list.length; i += 1) {
      const r = list[i] || {};
      const who = String(r.assignee || "").trim() || "(Không rõ)";
      if (who !== assignee) continue;
      const m = normalizeMonthKeyFromRawDate(r.completionActual);
      if (selectedMonth !== "__all__" && m !== selectedMonth) continue;
      if (!ceStatusKindMatches(r, kind)) continue;
      out.push(r);
    }
    return out;
  }

  function renderCeStatsDrillTable(rows) {
    const list = Array.isArray(rows) ? rows : [];
    if (!list.length) return '<div class="ce-empty">Không có tác vụ phù hợp.</div>';
    const head =
      "<thead><tr>" +
      "<th>Mã tác vụ</th>" +
      "<th>Task name</th>" +
      "<th>Ngày hoàn thành thực tế</th>" +
      "<th>Kết luận trang bìa</th>" +
      "<th>Trạng thái khai báo CE</th>" +
      "<th>Ghi chú</th>" +
      "<th>Link KOI - khai báo CE</th>" +
      "</tr></thead>";
    const body = list.map(function (r) {
      const href = hrefForUserLink(r.koiKhaiBaoCeLink || "");
      const linkHtml = href
        ? '<a href="' + htmlEscape(href) + '" target="_blank" rel="noopener noreferrer">' + htmlEscape(String(r.koiKhaiBaoCeLink || href)) + "</a>"
        : '<span class="ce-ghi-chu-placeholder">—</span>';
      return (
        "<tr>" +
        "<td>" + htmlEscape(String(r.taskCode || "")) + "</td>" +
        "<td>" + htmlEscape(String(r.taskName || "")) + "</td>" +
        "<td>" + htmlEscape(String(r.completionActual || "")) + "</td>" +
        "<td>" + htmlEscape(String(r.ketLuanTrangBia || "")) + "</td>" +
        "<td>" + htmlEscape(String(r.trangThaiCe || "")) + "</td>" +
        "<td>" + htmlEscape(String(r.ghiChu || "")) + "</td>" +
        "<td>" + linkHtml + "</td>" +
        "</tr>"
      );
    }).join("");
    return '<div class="ce-table-wrap"><table class="ce-review-table ce-stats-table ce-stats-drill-table">' + head + "<tbody>" + body + "</tbody></table></div>";
  }

  function openCeStatsDrillModal(assignee, kind, monthKey) {
    const modal = ensureCeStatsDrillModal();
    if (!modal) return;
    const rows = getCeStatsDrillRows(cachedRows, monthKey, assignee, kind);
    const kindLabelMap = {
      total: "Tổng",
      daGui: "Đã gửi",
      chuaGui: "Chưa gửi",
      khongCan: "Không cần",
      tiLeHoanThanhCe: "Tỷ lệ hoàn thành CE (Đã gửi + Không cần)",
    };
    const label = kindLabelMap[kind] || "Tổng";
    if (modal.subtitle) {
      modal.subtitle.textContent =
        "Assignee: " + assignee + " | Chỉ số: " + label + " | Tháng: " + ceMonthLabel(monthKey) + " | Số tác vụ: " + rows.length;
    }
    if (modal.root) modal.root.innerHTML = renderCeStatsDrillTable(rows);
    modal.overlay.classList.add("open");
  }

  function openCeStatsModal() {
    const modal = ensureCeStatsModal();
    if (!modal) return;
    const monthsSet = Object.create(null);
    for (let i = 0; i < cachedRows.length; i += 1) {
      const m = normalizeMonthKeyFromRawDate(cachedRows[i] && cachedRows[i].completionActual);
      if (m) monthsSet[m] = true;
    }
    const nowKey = getCurrentLocalMonthKey();
    if (nowKey) monthsSet[nowKey] = true;
    const months = Object.keys(monthsSet).sort().reverse();
    let selectedMonth = "__all__";
    if (months.length) {
      selectedMonth = months.indexOf(nowKey) >= 0 ? nowKey : months[0];
    }
    if (modal.monthSelect) {
      const allOpt = '<option value="__all__">Tất cả tháng</option>';
      const monthOpts = months.map(function (m) {
        return '<option value="' + htmlEscape(m) + '">' + htmlEscape(ceMonthLabel(m)) + "</option>";
      }).join("");
      modal.monthSelect.innerHTML = allOpt + monthOpts;
      modal.monthSelect.value = selectedMonth;
      const renderBySelection = () => {
        const selected = String(selectedMonth || "__all__");
        const statsRows = getCeStatsRowsByMonth(cachedRows, selected);
        modal.tableRoot.innerHTML = renderCeStatsTableHtml(statsRows, ceStatsSortState);
        modal.tableRoot.querySelectorAll("th[data-ce-stats-sort]").forEach(function (th) {
          th.style.cursor = "pointer";
          th.addEventListener("click", function () {
            const k = String(th.getAttribute("data-ce-stats-sort") || "");
            if (!k) return;
            if (ceStatsSortState.key === k) {
              ceStatsSortState.dir = ceStatsSortState.dir === "asc" ? "desc" : "asc";
            } else {
              ceStatsSortState.key = k;
              ceStatsSortState.dir = "asc";
            }
            renderBySelection();
          });
        });
        modal.tableRoot.querySelectorAll(".ce-stats-drill-btn").forEach(function (btn) {
          btn.addEventListener("click", function () {
            const assignee = String(btn.getAttribute("data-assignee") || "").trim();
            const kind = String(btn.getAttribute("data-kind") || "total").trim();
            if (!assignee) return;
            openCeStatsDrillModal(assignee, kind, selected);
          });
        });
      };
      modal.monthSelect.onchange = function () {
        const v = String(modal.monthSelect.value || "").trim();
        selectedMonth = v || "__all__";
        renderBySelection();
      };
      renderBySelection();
    }
    modal.overlay.classList.add("open");
  }

  function openCeGiaoMauStatsModal() {
    const modal = ensureCeGiaoMauStatsModal();
    if (!modal) return;
    const monthsSet = Object.create(null);
    for (let i = 0; i < cachedRows.length; i += 1) {
      const m = normalizeMonthKeyFromRawDate(cachedRows[i] && cachedRows[i].completionActual);
      if (m) monthsSet[m] = true;
    }
    const nowKey = getCurrentLocalMonthKey();
    if (nowKey) monthsSet[nowKey] = true;
    const months = Object.keys(monthsSet).sort().reverse();
    let selectedMonth = "__all__";
    if (months.length) selectedMonth = months.indexOf(nowKey) >= 0 ? nowKey : months[0];
    if (modal.monthSelect) {
      const allOpt = '<option value="__all__">Tất cả tháng</option>';
      const monthOpts = months.map(function (m) {
        return '<option value="' + htmlEscape(m) + '">' + htmlEscape(ceMonthLabel(m)) + "</option>";
      }).join("");
      modal.monthSelect.innerHTML = allOpt + monthOpts;
      modal.monthSelect.value = selectedMonth;
      const renderBySelection = () => {
        const selected = String(selectedMonth || "__all__");
        const statsRows = getCeGiaoMauStatsRowsByMonth(cachedRows, selected);
        modal.tableRoot.innerHTML = renderCeGiaoMauStatsTableHtml(statsRows, ceGiaoMauStatsSortState);
        modal.tableRoot.querySelectorAll("th[data-ce-gm-stats-sort]").forEach(function (th) {
          th.style.cursor = "pointer";
          th.addEventListener("click", function () {
            const k = String(th.getAttribute("data-ce-gm-stats-sort") || "");
            if (!k) return;
            if (ceGiaoMauStatsSortState.key === k) {
              ceGiaoMauStatsSortState.dir = ceGiaoMauStatsSortState.dir === "asc" ? "desc" : "asc";
            } else {
              ceGiaoMauStatsSortState.key = k;
              ceGiaoMauStatsSortState.dir = "asc";
            }
            renderBySelection();
          });
        });
      };
      modal.monthSelect.onchange = function () {
        const v = String(modal.monthSelect.value || "").trim();
        selectedMonth = v || "__all__";
        renderBySelection();
      };
      renderBySelection();
    }
    modal.overlay.classList.add("open");
  }

  async function persistCeDeclarationRow(row) {
    if (!DeclSvc || typeof DeclSvc.isConfigured !== "function" || !DeclSvc.isConfigured(ceCfg)) return;
    if (!row) return;
    try {
      await DeclSvc.upsertDeclaration(ceCfg, row);
      // Refresh «Rà soát CE» đọc localStorage snapshot nguồn trước — phải cập nhật để link/ghi chú CE không bị rollback.
      saveCeSourceSnapshot(cachedRows);
      // Best-effort: gợi Worker build snapshot CE mới (không chờ — tránh chặn UI).
      void (async function peekFreshCeSnapshot() {
        try {
          const dw = ceCfg && ceCfg.declarationWorker;
          const base = String(dw && dw.snapshotDataUrl || "").trim();
          if (!base) return;
          const u = new URL(base, global.location && global.location.href ? global.location.href : undefined);
          u.searchParams.set("fresh", "1");
          u.searchParams.set("_ts", String(Date.now()));
          await fetch(u.toString(), { method: "GET", cache: "no-store" });
        } catch (_) {}
      })();
      setCeStatus("Đã lưu thành công", "ok");
    } catch (err) {
      console.warn("CE persist:", err);
      setCeStatus(
        "Đã lưu cục bộ nhưng đồng bộ NocoDB thất bại: " +
          String(err && err.message ? err.message : err || "").slice(0, 200),
        "err"
      );
    }
  }

  async function warmCeSnapshotCache() {
    const dw = (ceCfg && ceCfg.declarationWorker) || {};
    const url = String(dw.snapshotDataUrl || "").trim();
    if (!url) return "";
    try {
      const resp = await fetch(url, { method: "GET", cache: "no-store" });
      if (!resp.ok) return "";
      const data = await resp.json();
      return String(data && data.builtAt || "");
    } catch (_) {
      return "";
    }
  }

  async function forceResyncAllToCe() {
    if (!DeclSvc || typeof DeclSvc.isConfigured !== "function" || !DeclSvc.isConfigured(ceCfg)) {
      setCeStatus("Chưa cấu hình Worker CE nên chưa thể quét lại từ đầu.", "warn");
      return;
    }
    if (!Service || typeof Service.fetchSourceRecordsOnly !== "function") return;
    const yes = window.confirm(
      "Quét lại từ đầu sẽ đọc lại toàn bộ bảng đích và đồng bộ tất cả dòng sang bảng CE.\n" +
      "Thao tác này có thể mất vài phút. Tiếp tục?"
    );
    if (!yes) return;

    const btnForce = qs("#ce-refresh-force-btn");
    const btnRefresh = qs("#ce-refresh-btn");
    if (btnForce) btnForce.disabled = true;
    if (btnRefresh) btnRefresh.disabled = true;
    const startedAtMs = Date.now();
    try {
      const me = ceOwnerId();
      let haveLock = false;
      try {
        const acq = await cePostLock("/scan-lock/acquire", { ownerId: me, ttlSec: 300 });
        haveLock = !!(acq && acq.ok !== false && acq.locked !== false);
      } catch (_) {
        haveLock = false;
      }
      // Ưu tiên "Quét lại từ đầu" luôn chạy được: lock chỉ là best-effort.
      // Có lock: bật heartbeat + bật scanMode (bảo vệ không ghi đè dữ liệu máy khác trong phiên quét).
      // Không có lock: vẫn chạy quét/upsert bình thường (không scanMode).
      if (haveLock) {
        ceScanHeartbeatTimer = setInterval(() => {
          void cePostLock("/scan-lock/heartbeat", { ownerId: me, ttlSec: 300 }).catch(() => {});
        }, 20000);
      } else {
        setCeStatus("Không lấy được lock quét CE (vẫn tiếp tục quét theo chế độ không-lock).", "warn");
      }

      setCeStatus("Đang quét lại từ đầu: tải nguồn…", "warn");
      const records = await Service.fetchSourceRecordsOnly();
      let rows = Service.mapRecordsToCeRows(records, Logic, ceCfg);
      if (DeclSvc && DeclSvc.isConfigured(ceCfg)) {
        try {
          const prevSnap = await DeclSvc.fetchDeclarationSnapshot(ceCfg);
          const prevMap = DeclSvc.declarationRecordsToMap(prevSnap.records, ceCfg);
          rows = DeclSvc.mergeDeclarationsIntoRows(rows, prevMap, ceCfg);
        } catch (_) {}
      }
      rows = reconcileTrangThaiCeRows(rows);
      saveCeSourceSnapshot(rows);
      cachedRows = rows.slice();
      renderTable();
      const total = rows.length;
      setCeStatus("Đang quét lại từ đầu theo chế độ an toàn (upsert theo Source Record Id): " + total + " dòng…", "warn");
      const concurrency = 6;
      let done = 0;
      let ok = 0;
      let fail = 0;
      let skippedDirty = 0;
      let firstErr = "";
      async function runOne(row) {
        try {
          const rs = await DeclSvc.upsertDeclaration(ceCfg, row, { ownerId: me, scanMode: haveLock });
          if (rs && rs.skipped && rs.reason === "DIRTY_DURING_SCAN") {
            skippedDirty += 1;
          } else {
            ok += 1;
          }
        } catch (e) {
          fail += 1;
          if (!firstErr) firstErr = String(e && e.message ? e.message : e || "").slice(0, 240);
        } finally {
          done += 1;
          if (done === total || done % 25 === 0) {
            setCeStatus(
              "Đang upsert an toàn: " + done + "/" + total + " (OK: " + ok + ", giữ dữ liệu máy khác: " + skippedDirty + ", lỗi: " + fail + ")" +
                (firstErr ? " | Lỗi mẫu: " + firstErr : ""),
              fail ? "warn" : "ok"
            );
          }
        }
      }
      for (let i = 0; i < rows.length; i += concurrency) {
        const chunk = rows.slice(i, i + concurrency);
        await Promise.all(chunk.map(runOne));
      }
      let builtAt = "";
      builtAt = builtAt || await warmCeSnapshotCache();
      setCeDetail([
        "Nguồn CE: Đồng bộ toàn bộ (quét lại từ đầu)",
        "Thời gian trình duyệt: " + composeBrowserTimeText(),
        "Tổng thời gian quét: " + formatElapsedMs(Date.now() - startedAtMs),
        "Tổng dòng nguồn: " + total,
        "Đồng bộ OK: " + ok,
        "Giữ dữ liệu máy khác: " + skippedDirty,
        "Đồng bộ lỗi: " + fail,
        builtAt ? "Snapshot CE: " + builtAt : "",
      ]);
      lastForceScanElapsedText = formatElapsedMs(Date.now() - startedAtMs);
      setCeStatus(
        "Hoàn tất quét dữ liệu",
        fail ? "warn" : "ok"
      );
      await loadLive();
    } finally {
      if (ceScanHeartbeatTimer) {
        clearInterval(ceScanHeartbeatTimer);
        ceScanHeartbeatTimer = null;
      }
      // Release lock best-effort (nếu không có lock thì gọi cũng không sao).
      try { await cePostLock("/scan-lock/release", { ownerId: ceOwnerId() }); } catch (_) {}
      if (btnForce) btnForce.disabled = false;
      if (btnRefresh) btnRefresh.disabled = false;
    }
  }

  function getFilteredRows() {
    const monthFilter = String(qs("#ce-filter-month") && qs("#ce-filter-month").value || "").trim();

    return cachedRows.filter((r) => {
      if (monthFilter) {
        const monthKey = normalizeMonthKeyFromRawDate(r && r.completionActual);
        if (monthKey !== monthFilter) return false;
      }
      if (!rowMatchesFilterSlot(r, 1)) return false;
      if (!rowMatchesFilterSlot(r, 2)) return false;
      return true;
    });
  }

  function exportFilteredCeRowsToExcel() {
    if (typeof XLSX === "undefined" || !XLSX || !XLSX.utils) {
      setCeStatus("Thiếu thư viện XLSX để xuất file.", "err");
      return;
    }
    const rows = getFilteredRows();
    if (!rows.length) {
      setCeStatus("Không có dữ liệu khớp bộ lọc để xuất excel.", "warn");
      return;
    }

    const exportRows = rows.map(function (r) {
      return {
        "Source Record Id": r.sourceRecordId || "",
        "Mã tác vụ": r.taskCode || "",
        "Task name": r.taskName || "",
        "Mã": r.ma || "",
        "Assignee": r.assignee || "",
        "Ngày hoàn thành thực tế": r.completionActual || "",
        "Mã báo cáo": r.reportCode || "",
        "Link BCexcel": r.linkBcExcel || "",
        JiraLinkRequest: r.jiraLinkRequest || "",
        "Mã KOI": r.maKoi || "",
        "Kết luận": r.ketLuan || "",
        "Kết luận trang bìa": r.ketLuanTrangBia || "",
        "Kết quả": r.ketQua || "",
        "Trạng thái cũ": r.ceRaSoatTruoc || "",
        "Trạng thái khai báo CE": r.trangThaiCe || "",
        "Lịch sử thay đổi - Trạng thái": Array.isArray(r.trangThaiCeManualHistory) ? r.trangThaiCeManualHistory.join("\n") : "",
        "Ghi chú": r.ghiChu || "",
        "Link KOI - khai báo CE": r.koiKhaiBaoCeLink || "",
        "Lịch sử khai báo CE": r.lichSuKhaiBaoCeAt || "",
        "Trạng thái giao mẫu": r.trangThaiGiaoMau || "",
        "Link KOI - Khai báo Giao mẫu": r.linkKoiKhaiBaoGiaoMau || "",
        "Ghi chú giao mẫu": r.ghiChuGiaoMau || "",
        "Lịch sử khai báo giao mẫu": r.lichSuKhaiBaoGiaoMauAt || "",
      };
    });

    const ws = XLSX.utils.json_to_sheet(exportRows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "CE_Filtered");
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    XLSX.writeFile(wb, "ce-filtered-" + stamp + ".xlsx");
    setCeStatus("Hoàn tất quét dữ liệu", "ok");
  }

  function renderTable() {
    const root = qs("#ce-review-root");
    if (!root || !Logic || !Service) return;

    const scrollState = captureCeTableScroll(root);
    populateCeMonthFilterOptions();

    const intro = "";

    const rows = getFilteredRows();
    if (!cachedRows.length) {
      root.innerHTML =
        intro +
        '<div class="ce-empty">' +
        'Chưa có dòng. Bấm <strong>Refresh dữ liệu</strong> để tải snapshot CE.</div>';
      restoreCeTableScroll(root, scrollState);
      return;
    }
    if (!rows.length) {
      root.innerHTML =
        intro +
        '<div class="ce-table-meta">Khớp lọc: <strong>0</strong> / ' +
        cachedRows.length +
        " dòng</div>" +
        '<div class="ce-empty">' +
        "Không có dòng nào khớp bộ lọc. Kiểm tra ô «Lọc nhanh», hai cặp trường/giá trị (logic <strong>VÀ</strong>), hoặc bấm <strong>Xóa lọc</strong>.</div>";
      restoreCeTableScroll(root, scrollState);
      return;
    }

    const head =
      "<thead><tr>" +
      "<th>Mã tác vụ</th>" +
      "<th>Task name</th>" +
      "<th title=\"Cột «Mã» trên bảng đích NocoDB (khác Mã tác vụ)\">Mã</th>" +
      "<th>Assignee</th>" +
      "<th>Ngày hoàn thành thực tế</th>" +
      "<th>Mã báo cáo</th>" +
      "<th>Link BCexcel</th>" +
      "<th>JiraLinkRequest</th>" +
      "<th>Mã KOI</th>" +
      "<th>Kết luận (Khai báo hệ thống)</th>" +
      "<th>Kết luận trang bìa (file báo cáo)</th>" +
      "<th>Kết quả</th>" +
      "<th title=\"Đọc từ cột «CE rà soát» trên bảng đích — Cổng tác vụ cũ\">Trạng thái cũ</th>" +
      "<th>Trạng thái khai báo CE</th>" +
      "<th>Lịch sử thay đổi - Trạng thái</th>" +
      "<th>Ghi chú</th>" +
      "<th>Link KOI - khai báo CE</th>" +
      "<th>Lịch sử khai báo CE</th>" +
      "<th>Khai báo giao mẫu</th>" +
      "<th>Lịch sử khai báo giao mẫu</th>" +
      "</tr></thead>";

    const bodyRows = rows
      .map((r) => {
        const kid = htmlEscape(r.sourceRecordId);
        const isSelected = String(selectedRowSourceId || "") === String(r.sourceRecordId || "");
        const rowClass = isSelected ? ' class="ce-row-selected"' : "";
        const kq = htmlEscape(r.ketQua || "");
        const tt = htmlEscape(r.trangThaiCe || "");
        const gc = r.ghiChu || "";
        const lsDisp = formatLichSuKhaiBaoCeAtDisplay(r.lichSuKhaiBaoCeAt);
        const lsGmDisp = formatLichSuKhaiBaoCeAtDisplay(r.lichSuKhaiBaoGiaoMauAt);
        return (
          "<tr" + rowClass + " data-ce-source-id=\"" +
          kid +
          "\">" +
          "<td class=\"ce-mono\">" +
          htmlEscape(r.taskCode) +
          "</td>" +
          "<td title=\"" +
          htmlEscape(r.taskName) +
          "\">" +
          htmlEscape(r.taskName) +
          "</td>" +
          "<td class=\"ce-mono\" title=\"" +
          htmlEscape(r.ma || "") +
          "\">" +
          htmlEscape(r.ma || "") +
          "</td>" +
          "<td title=\"" +
          htmlEscape(r.assignee) +
          "\">" +
          htmlEscape(r.assignee) +
          "</td>" +
          "<td class=\"ce-mono\" title=\"" +
          htmlEscape(r.completionActual) +
          "\">" +
          htmlEscape(r.completionActual) +
          "</td>" +
          "<td class=\"ce-mono\" title=\"" +
          htmlEscape(r.reportCode) +
          "\">" +
          htmlEscape(r.reportCode) +
          "</td>" +
          "<td class=\"ce-cell-long\" title=\"" +
          htmlEscape(r.linkBcExcel || "") +
          "\">" +
          formatGenericLinkCellHtml(r.linkBcExcel || "", { bcExcel: true }) +
          "</td>" +
          "<td class=\"ce-cell-long\" title=\"" +
          htmlEscape(r.jiraLinkRequest || "") +
          "\">" +
          formatGenericLinkCellHtml(r.jiraLinkRequest || "", {}) +
          "</td>" +
          "<td class=\"ce-mono\" title=\"" +
          htmlEscape(r.maKoi || "") +
          "\">" +
          formatGenericLinkCellHtml(r.maKoi || "", {}) +
          "</td>" +
          "<td class=\"ce-cell-long\" title=\"" +
          htmlEscape(r.ketLuan) +
          "\">" +
          htmlEscape(r.ketLuan) +
          "</td>" +
          "<td class=\"ce-cell-long\" title=\"" +
          htmlEscape(r.ketLuanTrangBia) +
          "\">" +
          htmlEscape(r.ketLuanTrangBia) +
          "</td>" +
          "<td><span class=\"" +
          ketQuaBadgeClass(r.ketQua) +
          "\">" +
          (kq || "—") +
          "</span></td>" +
          "<td class=\"ce-trang-thai-cu-cell\" title=\"" +
          htmlEscape(r.ceRaSoatTruoc || "") +
          "\">" +
          (String(r.ceRaSoatTruoc || "").trim()
            ? "<span class=\"" +
              trangThaiBadgeClass(r.ceRaSoatTruoc) +
              "\">" +
              htmlEscape(r.ceRaSoatTruoc) +
              "</span>"
            : '<span class="ce-ghi-chu-placeholder">—</span>') +
          "</td>" +
          "<td class=\"ce-trang-thai-cell\"><div class=\"ce-trang-thai-inner\">" +
          (isTrangThaiOverridePasswordConfigured()
            ? "<span class=\"" +
              trangThaiBadgeClass(r.trangThaiCe) +
              " ce-trang-thai-badge-hit\" role=\"button\" tabindex=\"0\" data-ce-source-id=\"" +
              kid +
              "\" title=\"Nhấn để đổi trạng thái (cần mật khẩu)\" aria-label=\"" +
              htmlEscape(
                "Đổi trạng thái khai báo CE — hiện tại: " + String(r.trangThaiCe || "—")
              ) +
              "\">" +
              tt +
              "</span>"
            : "<span class=\"" +
              trangThaiBadgeClass(r.trangThaiCe) +
              "\">" +
              tt +
              "</span>") +
          "</div></td>" +
          "<td class=\"ce-cell-long ce-history-cell\" title=\"" +
          htmlEscape(
            Array.isArray(r.trangThaiCeManualHistory)
              ? r.trangThaiCeManualHistory.join("\n")
              : ""
          ) +
          "\">" +
          renderManualHistoryHtml(r) +
          "</td>" +
          "<td class=\"ce-cell-long\"><div class=\"ce-ghi-chu-cell\">" +
          "<div class=\"ce-ghi-chu-display\" title=\"" +
          htmlEscape(gc) +
          "\">" +
          (gc.trim()
            ? htmlEscape(gc)
            : '<span class="ce-ghi-chu-placeholder">—</span>') +
          "</div>" +
          "<button type=\"button\" class=\"btn btn-sm ce-btn-ghi-chu\" data-ce-source-id=\"" +
          kid +
          "\">Sửa ghi chú</button>" +
          "</div></td>" +
          "<td class=\"ce-cell-long ce-koi-link-cell\"><div class=\"ce-koi-link-stack\">" +
          "<div class=\"ce-koi-link-wrap\">" +
          formatKoiLinkCellHtml(r.koiKhaiBaoCeLink) +
          "</div>" +
          "<button type=\"button\" class=\"btn btn-sm ce-btn-khai-bao\" data-ce-source-id=\"" +
          kid +
          "\">Nhập link</button>" +
          "</div></td>" +
          "<td class=\"ce-mono ce-lich-su-khai-bao-ce-at\" title=\"" +
          htmlEscape(lsDisp === "—" ? "" : lsDisp) +
          "\">" +
          (lsDisp === "—"
            ? '<span class="ce-ghi-chu-placeholder">—</span>'
            : htmlEscape(lsDisp)) +
          "</td>" +
          "<td class=\"ce-cell-long ce-koi-link-cell\">" +
          renderKhaiBaoGiaoMauCellHtml(r, kid) +
          "</td>" +
          "<td class=\"ce-mono ce-lich-su-khai-bao-ce-at\" title=\"" +
          htmlEscape(lsGmDisp === "—" ? "" : lsGmDisp) +
          "\">" +
          (lsGmDisp === "—"
            ? '<span class="ce-ghi-chu-placeholder">—</span>'
            : htmlEscape(lsGmDisp)) +
          "</td>" +
          "</tr>"
        );
      })
      .join("");

    root.innerHTML =
      intro +
      '<div class="ce-table-meta">Hiển thị: <strong>' +
      rows.length +
      "</strong> / " +
      cachedRows.length +
      ' dòng <button id="ce-toggle-optional-cols-btn" type="button" class="btn btn-sm" style="margin-left:8px;">' +
      (ceShowOptionalCols ? "−" : "+") +
      "</button></div>" +
      '<div class="ce-table-wrap">' +
      '<table class="ce-review-table ' + (ceShowOptionalCols ? "" : "ce-hide-optional-cols") + '">' +
      head +
      "<tbody>" +
      bodyRows +
      "</tbody></table></div>";

    root.querySelectorAll(".ce-btn-khai-bao").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-ce-source-id");
        openKhaiBaoModal(id);
      });
    });
    root.querySelectorAll(".ce-btn-khai-bao-giao-mau").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-ce-source-id");
        openGiaoMauModal(id);
      });
    });
    root.querySelectorAll(".ce-btn-ghi-chu").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-ce-source-id");
        openGhiChuModal(id);
      });
    });
    root.querySelectorAll(".ce-trang-thai-badge-hit").forEach((hit) => {
      function openFromHit() {
        openTrangThaiModal(hit.getAttribute("data-ce-source-id"));
      }
      hit.addEventListener("click", openFromHit);
      hit.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          openFromHit();
        }
      });
    });

    const toggleOptionalBtn = root.querySelector("#ce-toggle-optional-cols-btn");
    if (toggleOptionalBtn) {
      toggleOptionalBtn.addEventListener("click", () => {
        ceShowOptionalCols = !ceShowOptionalCols;
        renderTable();
      });
    }

    root.querySelectorAll("tbody tr[data-ce-source-id]").forEach((tr) => {
      tr.addEventListener("click", () => {
        const sid = String(tr.getAttribute("data-ce-source-id") || "").trim();
        if (!sid) return;
        selectedRowSourceId = sid;
        root.querySelectorAll("tbody tr[data-ce-source-id]").forEach((x) => x.classList.remove("ce-row-selected"));
        tr.classList.add("ce-row-selected");
      });
    });

    restoreCeTableScroll(root, scrollState);
  }

  function ensureModal() {
    let overlay = qs("#ce-khai-bao-modal");
    if (overlay) return overlay;
    overlay = document.createElement("div");
    overlay.id = "ce-khai-bao-modal";
    overlay.className = "ce-modal";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-labelledby", "ce-modal-title");
    overlay.innerHTML =
      '<div class="ce-modal-card">' +
      '  <div class="ce-modal-head">' +
      '    <h2 id="ce-modal-title" class="ce-modal-title">Link KOI - khai báo CE</h2>' +
      '    <button type="button" class="ce-modal-close" aria-label="Đóng">&times;</button>' +
      "  </div>" +
      '  <div class="ce-modal-body">' +
      '    <p id="ce-modal-summary" class="ce-modal-summary"></p>' +
      '    <label class="ce-modal-label">Đường link (URL)</label>' +
      '    <input type="url" id="ce-modal-link-url" class="ce-modal-input" placeholder="https://…" autocomplete="url" />' +
      '    <p id="ce-modal-link-err" class="ce-modal-inline-error" role="alert" aria-live="polite" hidden></p>' +
      "  </div>" +
      '  <div class="ce-modal-actions">' +
      '    <button type="button" class="btn" id="ce-modal-cancel">Hủy</button>' +
      '    <button type="button" class="btn btn-primary" id="ce-modal-submit">Lưu link</button>' +
      "  </div>" +
      "</div>";
    document.body.appendChild(overlay);

    const linkUrlInput = qs("#ce-modal-link-url", overlay);
    if (linkUrlInput) {
      linkUrlInput.addEventListener("input", function () {
        clearCeKhaiBaoLinkInlineErr(overlay);
      });
    }

    function close() {
      clearCeKhaiBaoLinkInlineErr(overlay);
      overlay.classList.remove("open");
      modalRowId = "";
    }

    overlay.querySelector(".ce-modal-close").addEventListener("click", close);
    overlay.querySelector("#ce-modal-cancel").addEventListener("click", close);
    // Không tự đóng khi click ra ngoài; chỉ đóng bằng nút "Đóng/Hủy".

    overlay.querySelector("#ce-modal-submit").addEventListener("click", () => {
      const row = cachedRows.find((x) => x.sourceRecordId === modalRowId);
      const urlRaw = String(qs("#ce-modal-link-url", overlay).value || "").trim();
      if (!urlRaw) {
        if (row) {
          row.koiKhaiBaoCeLink = "";
          row.lichSuKhaiBaoCeAt = "";
          Object.assign(row, reconcileTrangThaiCeWithKetQua(row));
        }
        close();
        renderTable();
        void persistCeDeclarationRow(row);
        return;
      }
      try {
        const u = new URL(hrefForUserLink(urlRaw));
        if (u.protocol !== "http:" && u.protocol !== "https:") {
          throw new Error("bad");
        }
      } catch (_) {
        const errEl = qs("#ce-modal-link-err", overlay);
        if (errEl) {
          errEl.textContent = "Link không hợp lệ. Dùng định dạng http:// hoặc https://…";
          errEl.hidden = false;
        }
        const urlEl = qs("#ce-modal-link-url", overlay);
        if (urlEl) urlEl.focus();
        return;
      }
      clearCeKhaiBaoLinkInlineErr(overlay);
      if (row) {
        row.koiKhaiBaoCeLink = urlRaw;
        row.lichSuKhaiBaoCeAt = new Date().toISOString();
        Object.assign(row, reconcileTrangThaiCeWithKetQua(row));
      }
      close();
      renderTable();
      void persistCeDeclarationRow(row);
    });

    return overlay;
  }

  function ensureGhiChuModal() {
    let overlay = qs("#ce-ghi-chu-modal");
    if (overlay) return overlay;
    overlay = document.createElement("div");
    overlay.id = "ce-ghi-chu-modal";
    overlay.className = "ce-modal";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-labelledby", "ce-ghi-chu-modal-title");
    overlay.innerHTML =
      '<div class="ce-modal-card">' +
      '  <div class="ce-modal-head">' +
      '    <h2 id="ce-ghi-chu-modal-title" class="ce-modal-title">Ghi chú</h2>' +
      '    <button type="button" class="ce-modal-close ce-ghi-chu-modal-close" aria-label="Đóng">&times;</button>' +
      "  </div>" +
      '  <div class="ce-modal-body">' +
      '    <p id="ce-ghi-chu-modal-summary" class="ce-modal-summary"></p>' +
      '    <label class="ce-modal-label">Nội dung ghi chú</label>' +
      '    <textarea id="ce-modal-ghi-chu-only" rows="5" class="ce-modal-textarea" placeholder="Nhập ghi chú tự do…"></textarea>' +
      "  </div>" +
      '  <div class="ce-modal-actions">' +
      '    <button type="button" class="btn" id="ce-ghi-chu-cancel">Hủy</button>' +
      '    <button type="button" class="btn btn-primary" id="ce-ghi-chu-save">Lưu</button>' +
      "  </div>" +
      "</div>";
    document.body.appendChild(overlay);

    function closeGc() {
      overlay.classList.remove("open");
      modalGhiChuRowId = "";
    }

    overlay.querySelector(".ce-ghi-chu-modal-close").addEventListener("click", closeGc);
    overlay.querySelector("#ce-ghi-chu-cancel").addEventListener("click", closeGc);
    // Không tự đóng khi click ra ngoài; chỉ đóng bằng nút "Đóng/Hủy".

    overlay.querySelector("#ce-ghi-chu-save").addEventListener("click", () => {
      const row = cachedRows.find((x) => x.sourceRecordId === modalGhiChuRowId);
      const ta = qs("#ce-modal-ghi-chu-only", overlay);
      if (row && ta) row.ghiChu = String(ta.value || "");
      closeGc();
      renderTable();
      void persistCeDeclarationRow(row);
    });

    return overlay;
  }

  function ensureGiaoMauModal() {
    let overlay = qs("#ce-giao-mau-modal");
    if (overlay) return overlay;
    overlay = document.createElement("div");
    overlay.id = "ce-giao-mau-modal";
    overlay.className = "ce-modal";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-labelledby", "ce-giao-mau-modal-title");
    overlay.innerHTML =
      '<div class="ce-modal-card">' +
      '  <div class="ce-modal-head">' +
      '    <h2 id="ce-giao-mau-modal-title" class="ce-modal-title">Khai báo giao mẫu</h2>' +
      '    <button type="button" class="ce-modal-close ce-giao-mau-modal-close" aria-label="Đóng">&times;</button>' +
      "  </div>" +
      '  <div class="ce-modal-body">' +
      '    <p id="ce-giao-mau-modal-summary" class="ce-modal-summary"></p>' +
      '    <label class="ce-modal-label" for="ce-giao-mau-status">Trạng thái giao mẫu <span class="ce-req">*</span></label>' +
      '    <select id="ce-giao-mau-status" class="ce-modal-select"></select>' +
      '    <div id="ce-giao-mau-link-wrap" hidden>' +
      '      <label class="ce-modal-label" for="ce-giao-mau-link">Link KOI - Khai báo Giao mẫu <span class="ce-req">*</span></label>' +
      '      <input type="url" id="ce-giao-mau-link" class="ce-modal-input" placeholder="https://…" autocomplete="url" />' +
      "    </div>" +
      '    <div id="ce-giao-mau-note-wrap" hidden>' +
      '      <label class="ce-modal-label" for="ce-giao-mau-note">Ghi chú <span class="ce-req">*</span></label>' +
      '      <textarea id="ce-giao-mau-note" rows="4" class="ce-modal-textarea" placeholder="Nhập lý do…"></textarea>' +
      "    </div>" +
      '    <p id="ce-giao-mau-err" class="ce-modal-inline-error" role="alert" aria-live="polite" hidden></p>' +
      "  </div>" +
      '  <div class="ce-modal-actions">' +
      '    <button type="button" class="btn" id="ce-giao-mau-cancel">Hủy</button>' +
      '    <button type="button" class="btn btn-primary" id="ce-giao-mau-save">Lưu</button>' +
      "  </div>" +
      "</div>";
    document.body.appendChild(overlay);

    const sel = qs("#ce-giao-mau-status", overlay);
    if (sel) {
      sel.innerHTML = trangThaiGiaoMauOptions()
        .map(function (opt) {
          return '<option value="' + htmlEscape(opt) + '">' + htmlEscape(opt) + "</option>";
        })
        .join("");
    }
    const errEl = qs("#ce-giao-mau-err", overlay);
    const linkWrap = qs("#ce-giao-mau-link-wrap", overlay);
    const noteWrap = qs("#ce-giao-mau-note-wrap", overlay);
    const linkInput = qs("#ce-giao-mau-link", overlay);
    const noteInput = qs("#ce-giao-mau-note", overlay);
    function clearErr() {
      if (!errEl) return;
      errEl.textContent = "";
      errEl.hidden = true;
    }
    function syncUiByStatus() {
      const st = normalizeTrangThaiGiaoMau(sel && sel.value);
      if (linkWrap) linkWrap.hidden = st !== "Đã gửi";
      if (noteWrap) noteWrap.hidden = st !== "Không cần";
      clearErr();
    }
    function close() {
      overlay.classList.remove("open");
      modalGiaoMauRowId = "";
      clearErr();
    }

    if (sel) sel.addEventListener("change", syncUiByStatus);
    if (linkInput) linkInput.addEventListener("input", clearErr);
    if (noteInput) noteInput.addEventListener("input", clearErr);
    overlay.querySelector(".ce-giao-mau-modal-close").addEventListener("click", close);
    overlay.querySelector("#ce-giao-mau-cancel").addEventListener("click", close);
    overlay.querySelector("#ce-giao-mau-save").addEventListener("click", function () {
      const row = cachedRows.find(function (x) {
        return x.sourceRecordId === modalGiaoMauRowId;
      });
      if (!row) {
        close();
        return;
      }
      const st = normalizeTrangThaiGiaoMau(sel && sel.value);
      const linkRaw = String(linkInput && linkInput.value || "").trim();
      const noteRaw = String(noteInput && noteInput.value || "").trim();
      if (st === "Đã gửi") {
        if (!linkRaw) {
          if (errEl) {
            errEl.textContent = "Trạng thái «Đã gửi» bắt buộc nhập Link KOI - Khai báo Giao mẫu.";
            errEl.hidden = false;
          }
          if (linkInput) linkInput.focus();
          return;
        }
        try {
          const u = new URL(hrefForUserLink(linkRaw));
          if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("bad");
        } catch (_) {
          if (errEl) {
            errEl.textContent = "Link KOI không hợp lệ. Dùng định dạng http:// hoặc https://…";
            errEl.hidden = false;
          }
          if (linkInput) linkInput.focus();
          return;
        }
      }
      if (st === "Không cần" && !noteRaw) {
        if (errEl) {
          errEl.textContent = "Trạng thái «Không cần» bắt buộc nhập Ghi chú.";
          errEl.hidden = false;
        }
        if (noteInput) noteInput.focus();
        return;
      }
      row.trangThaiGiaoMau = st;
      if (st === "Đã gửi") {
        row.linkKoiKhaiBaoGiaoMau = linkRaw;
        row.ghiChuGiaoMau = "";
      } else if (st === "Không cần") {
        row.linkKoiKhaiBaoGiaoMau = "";
        row.ghiChuGiaoMau = noteRaw;
      } else {
        row.linkKoiKhaiBaoGiaoMau = "";
        row.ghiChuGiaoMau = "";
      }
      row.lichSuKhaiBaoGiaoMauAt = new Date().toISOString();
      close();
      renderTable();
      void persistCeDeclarationRow(row);
    });

    overlay.__ceGiaoMauSyncUiByStatus = syncUiByStatus;
    return overlay;
  }

  function ensureTrangThaiModal() {
    let overlay = qs("#ce-trang-thai-modal");
    if (overlay) return overlay;
    if (!Logic) return null;
    overlay = document.createElement("div");
    overlay.id = "ce-trang-thai-modal";
    overlay.className = "ce-modal";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-labelledby", "ce-trang-thai-modal-title");
    overlay.innerHTML =
      '<div class="ce-modal-card">' +
      '  <div class="ce-modal-head">' +
      '    <h2 id="ce-trang-thai-modal-title" class="ce-modal-title">Đổi trạng thái khai báo CE</h2>' +
      '    <button type="button" class="ce-modal-close" aria-label="Đóng">&times;</button>' +
      "  </div>" +
      '  <div class="ce-modal-body">' +
      '    <p id="ce-trang-thai-modal-summary" class="ce-modal-summary"></p>' +
      '    <label class="ce-modal-label">Mật khẩu <span class="ce-req">*</span></label>' +
      '    <input type="password" id="ce-trang-thai-password" class="ce-modal-input" autocomplete="off" />' +
      '    <p id="ce-trang-thai-password-err" class="ce-modal-inline-error" role="alert" aria-live="polite" hidden></p>' +
      '    <label class="ce-modal-label">Trạng thái mới</label>' +
      '    <select id="ce-trang-thai-select" class="ce-modal-select"></select>' +
      "  </div>" +
      '  <div class="ce-modal-actions">' +
      '    <button type="button" class="btn" id="ce-trang-thai-cancel">Hủy</button>' +
      '    <button type="button" class="btn btn-primary" id="ce-trang-thai-apply">Áp dụng</button>' +
      "  </div>" +
      "</div>";
    document.body.appendChild(overlay);

    const pwdInputInit = qs("#ce-trang-thai-password", overlay);
    if (pwdInputInit) {
      pwdInputInit.addEventListener("input", function () {
        clearCeTrangThaiPasswordInlineErr(overlay);
      });
    }

    const sel = qs("#ce-trang-thai-select", overlay);
    if (sel) {
      sel.innerHTML = trangThaiCeOptions()
        .map(function (opt) {
          return (
            "<option value=\"" +
            htmlEscape(opt) +
            "\">" +
            htmlEscape(opt) +
            "</option>"
          );
        })
        .join("");
    }

    function close() {
      overlay.classList.remove("open");
      modalTrangThaiRowId = "";
      clearCeTrangThaiPasswordInlineErr(overlay);
      const pwd = qs("#ce-trang-thai-password", overlay);
      if (pwd) pwd.value = "";
    }

    overlay.querySelector(".ce-modal-close").addEventListener("click", close);
    overlay.querySelector("#ce-trang-thai-cancel").addEventListener("click", close);
    // Không tự đóng khi click ra ngoài; chỉ đóng bằng nút "Đóng/Hủy".

    overlay.querySelector("#ce-trang-thai-apply").addEventListener("click", function () {
      const row = cachedRows.find(function (x) {
        return x.sourceRecordId === modalTrangThaiRowId;
      });
      const pwdEl = qs("#ce-trang-thai-password", overlay);
      const selEl = qs("#ce-trang-thai-select", overlay);
      const expected = String((ceCfg && ceCfg.trangThaiCeOverridePassword) || "").trim();
      const entered = pwdEl ? String(pwdEl.value || "").trim() : "";
      if (entered !== expected) {
        const errEl = qs("#ce-trang-thai-password-err", overlay);
        if (errEl) {
          errEl.textContent = "Mật khẩu không đúng";
          errEl.hidden = false;
        }
        if (pwdEl) {
          pwdEl.value = "";
          pwdEl.focus();
        }
        return;
      }
      clearCeTrangThaiPasswordInlineErr(overlay);
      if (row && selEl) {
        const fromStatus = String(row.trangThaiCe || "");
        const toStatus = String(selEl.value || "");
        const statusSent = String((Logic && Logic.TRANG_THAI && Logic.TRANG_THAI.DA_GUI) || "Đã gửi");
        const hasLink = String(row.koiKhaiBaoCeLink || "").trim() !== "";
        if (toStatus === statusSent && !hasLink) {
          setCeStatus("Chỉ được chuyển sang «Đã gửi» khi đã khai báo «Link KOI - khai báo CE».", "warn");
          return;
        }
        appendManualTrangThaiHistory(row, fromStatus, toStatus);
        row.trangThaiCe = toStatus;
        const fixed = reconcileTrangThaiCeWithKetQua(row);
        Object.assign(row, fixed);
      }
      if (pwdEl) pwdEl.value = "";
      close();
      renderTable();
      void persistCeDeclarationRow(row);
    });

    return overlay;
  }

  function openTrangThaiModal(sourceRecordId) {
    if (!isTrangThaiOverridePasswordConfigured()) return;
    modalTrangThaiRowId = String(sourceRecordId || "");
    const row = cachedRows.find(function (x) {
      return x.sourceRecordId === modalTrangThaiRowId;
    });
    if (row && String(row.ceRaSoatTruoc || "").trim()) {
      setCeStatus("Dòng này có «Trạng thái cũ», nên trạng thái CE luôn ưu tiên theo Trạng thái cũ.", "warn");
      return;
    }
    const overlayTt = ensureTrangThaiModal();
    if (!overlayTt) return;
    const pwd = qs("#ce-trang-thai-password", overlayTt);
    const sel = qs("#ce-trang-thai-select", overlayTt);
    const sum = qs("#ce-trang-thai-modal-summary", overlayTt);
    clearCeTrangThaiPasswordInlineErr(overlayTt);
    if (pwd) pwd.value = "";
    const allowed = trangThaiCeOptions();
    if (sel && row) {
      var cur = row.trangThaiCe || "";
      sel.value = allowed.indexOf(cur) >= 0 ? cur : allowed[0] || "";
    }
    if (sum && row) {
      sum.innerHTML =
        "<strong>Mã tác vụ:</strong> " +
        htmlEscape(row.taskCode) +
        "<br/><strong>Trạng thái hiện tại:</strong> " +
        htmlEscape(row.trangThaiCe || "");
    }
    overlayTt.classList.add("open");
    if (pwd) setTimeout(function () { pwd.focus(); }, 80);
  }

  function openKhaiBaoModal(sourceRecordId) {
    modalRowId = String(sourceRecordId || "");
    const row = cachedRows.find((x) => x.sourceRecordId === modalRowId);
    const overlay = ensureModal();
    const sum = qs("#ce-modal-summary", overlay);
    const linkIn = qs("#ce-modal-link-url", overlay);
    clearCeKhaiBaoLinkInlineErr(overlay);
    if (linkIn) linkIn.value = row ? row.koiKhaiBaoCeLink || "" : "";
    if (sum && row) {
      sum.innerHTML =
        "<strong>Mã tác vụ:</strong> " +
        htmlEscape(row.taskCode) +
        " · <strong>Kết quả:</strong> " +
        htmlEscape(row.ketQua || "—") +
        "<br/><strong>Trạng thái hiện tại:</strong> " +
        htmlEscape(row.trangThaiCe || "");
    }
    overlay.classList.add("open");
    if (linkIn) setTimeout(() => linkIn.focus(), 80);
  }

  function openGhiChuModal(sourceRecordId) {
    modalGhiChuRowId = String(sourceRecordId || "");
    const row = cachedRows.find((x) => x.sourceRecordId === modalGhiChuRowId);
    const overlay = ensureGhiChuModal();
    const sum = qs("#ce-ghi-chu-modal-summary", overlay);
    const ta = qs("#ce-modal-ghi-chu-only", overlay);
    if (ta && row) ta.value = row.ghiChu || "";
    if (sum && row) {
      sum.innerHTML = "<strong>Mã tác vụ:</strong> " + htmlEscape(row.taskCode);
    }
    overlay.classList.add("open");
    if (ta) setTimeout(() => ta.focus(), 80);
  }

  function openGiaoMauModal(sourceRecordId) {
    modalGiaoMauRowId = String(sourceRecordId || "");
    const row = cachedRows.find((x) => x.sourceRecordId === modalGiaoMauRowId);
    const overlay = ensureGiaoMauModal();
    const sum = qs("#ce-giao-mau-modal-summary", overlay);
    const sel = qs("#ce-giao-mau-status", overlay);
    const linkIn = qs("#ce-giao-mau-link", overlay);
    const noteTa = qs("#ce-giao-mau-note", overlay);
    if (sel) sel.value = normalizeTrangThaiGiaoMau(row && row.trangThaiGiaoMau);
    if (linkIn) linkIn.value = row ? String(row.linkKoiKhaiBaoGiaoMau || "") : "";
    if (noteTa) noteTa.value = row ? String(row.ghiChuGiaoMau || "") : "";
    if (sum && row) {
      sum.innerHTML =
        "<strong>Mã tác vụ:</strong> " +
        htmlEscape(row.taskCode || "") +
        "<br/><strong>Trạng thái hiện tại:</strong> " +
        htmlEscape(normalizeTrangThaiGiaoMau(row.trangThaiGiaoMau));
    }
    if (typeof overlay.__ceGiaoMauSyncUiByStatus === "function") {
      overlay.__ceGiaoMauSyncUiByStatus();
    }
    overlay.classList.add("open");
    if (sel) setTimeout(function () { sel.focus(); }, 80);
  }

  async function loadLive() {
    if (!Service || typeof Service.fetchSourceRecordsOnly !== "function") return;
    const startedAtMs = Date.now();
    setCeStatus("Đang lấy dữ liệu...\nVui lòng đợi cho đến khi làm mới dữ liệu hoàn thành", "loading");
    try {
      const prevCeBySid = Object.create(null);
      for (let i = 0; i < cachedRows.length; i += 1) {
        const r0 = cachedRows[i] || {};
        const sid0 = String(r0.sourceRecordId || "").trim();
        if (!sid0) continue;
        prevCeBySid[sid0] = {
          trangThaiCe: String(r0.trangThaiCe || "").trim(),
          ghiChu: r0.ghiChu != null ? String(r0.ghiChu) : "",
          koiKhaiBaoCeLink: String(r0.koiKhaiBaoCeLink || "").trim(),
          lichSuKhaiBaoCeAt: String(r0.lichSuKhaiBaoCeAt || "").trim(),
          trangThaiGiaoMau: normalizeTrangThaiGiaoMau(r0.trangThaiGiaoMau),
          linkKoiKhaiBaoGiaoMau: String(r0.linkKoiKhaiBaoGiaoMau || "").trim(),
          ghiChuGiaoMau: r0.ghiChuGiaoMau != null ? String(r0.ghiChuGiaoMau) : "",
          lichSuKhaiBaoGiaoMauAt: String(r0.lichSuKhaiBaoGiaoMauAt || "").trim(),
          trangThaiCeManualHistory: Array.isArray(r0.trangThaiCeManualHistory) ? r0.trangThaiCeManualHistory.slice() : [],
        };
      }

      const sourceSnapshotRows = loadCeSourceSnapshot();
      if (sourceSnapshotRows.length) {
        cachedRows = sourceSnapshotRows.slice();
      } else {
        const records = await Service.fetchSourceRecordsOnly();
        cachedRows = Service.mapRecordsToCeRows(records, Logic, ceCfg);
        cachedRows = reconcileTrangThaiCeRows(cachedRows);
        saveCeSourceSnapshot(cachedRows);
      }
      if (DeclSvc && DeclSvc.isConfigured(ceCfg)) {
        try {
          const snap = await DeclSvc.fetchDeclarationSnapshot(ceCfg);
          const map = DeclSvc.declarationRecordsToMap(snap.records, ceCfg);
          const snapshotSidSet = new Set(Object.keys(map));
          cachedRows = DeclSvc.mergeDeclarationsIntoRows(cachedRows, map, ceCfg);
          // Nếu snapshot CE tạm thời rỗng/lỗi đồng bộ, không làm mất state CE đang hiển thị trước đó.
          cachedRows = cachedRows.map(function (r) {
            const sid = String(r && r.sourceRecordId || "").trim();
            if (!sid) return r;
            const prev = prevCeBySid[sid];
            if (!prev) return r;
            const merged = Object.assign({}, r);
            const curStatus = String(merged.trangThaiCe || "").trim();
            const curNote = merged.ghiChu != null ? String(merged.ghiChu) : "";
            const curLink = String(merged.koiKhaiBaoCeLink || "").trim();
            const curAt = String(merged.lichSuKhaiBaoCeAt || "").trim();
            const curGmStatus = String(merged.trangThaiGiaoMau || "").trim();
            const curGmNote = merged.ghiChuGiaoMau != null ? String(merged.ghiChuGiaoMau) : "";
            const curGmLink = String(merged.linkKoiKhaiBaoGiaoMau || "").trim();
            const curGmAt = String(merged.lichSuKhaiBaoGiaoMauAt || "").trim();
            if (!curStatus && prev.trangThaiCe) merged.trangThaiCe = prev.trangThaiCe;
            if (!curNote.trim() && prev.ghiChu !== undefined) merged.ghiChu = prev.ghiChu;
            if (!curLink && prev.koiKhaiBaoCeLink) merged.koiKhaiBaoCeLink = prev.koiKhaiBaoCeLink;
            if (!curAt && prev.lichSuKhaiBaoCeAt) merged.lichSuKhaiBaoCeAt = prev.lichSuKhaiBaoCeAt;
            if (!curGmStatus && prev.trangThaiGiaoMau) merged.trangThaiGiaoMau = prev.trangThaiGiaoMau;
            if (!curGmNote.trim() && prev.ghiChuGiaoMau !== undefined) merged.ghiChuGiaoMau = prev.ghiChuGiaoMau;
            if (!curGmLink && prev.linkKoiKhaiBaoGiaoMau) merged.linkKoiKhaiBaoGiaoMau = prev.linkKoiKhaiBaoGiaoMau;
            if (!curGmAt && prev.lichSuKhaiBaoGiaoMauAt) merged.lichSuKhaiBaoGiaoMauAt = prev.lichSuKhaiBaoGiaoMauAt;
            if ((!Array.isArray(merged.trangThaiCeManualHistory) || !merged.trangThaiCeManualHistory.length) &&
                Array.isArray(prev.trangThaiCeManualHistory) && prev.trangThaiCeManualHistory.length) {
              merged.trangThaiCeManualHistory = prev.trangThaiCeManualHistory.slice();
            }
            return merged;
          });
          cachedRows = reconcileTrangThaiCeRows(cachedRows);
          // Snapshot-first strict: chỉ hiển thị các dòng hiện có trong snapshot CE.
          cachedRows = cachedRows.filter(function (r) {
            const sid = String(r && r.sourceRecordId || "").trim();
            return sid && snapshotSidSet.has(sid);
          });
          setCeDetail([
            "Nguồn CE: Refresh dữ liệu",
            "Thời gian trình duyệt: " + composeBrowserTimeText(),
            "Tổng thời gian refresh: " + formatElapsedMs(Date.now() - startedAtMs),
            lastForceScanElapsedText ? "Tổng thời gian quét lại từ đầu gần nhất: " + lastForceScanElapsedText : "",
            "Bản ghi hiển thị theo snapshot CE: " + cachedRows.length,
            "Bản ghi snapshot CE: " + (Array.isArray(snap.records) ? snap.records.length : 0),
            snap.builtAt ? "Snapshot CE: " + snap.builtAt : "",
          ]);
          setCeStatus(
            "Hoàn tất quét dữ liệu",
            "ok"
          );
        } catch (mergeErr) {
          console.warn("CE declaration snapshot:", mergeErr);
          cachedRows = [];
          setCeDetail([
            "Nguồn CE: Refresh dữ liệu (snapshot lỗi - chặn hiển thị để tránh nhập sai)",
            "Thời gian trình duyệt: " + composeBrowserTimeText(),
            "Tổng thời gian refresh: " + formatElapsedMs(Date.now() - startedAtMs),
            lastForceScanElapsedText ? "Tổng thời gian quét lại từ đầu gần nhất: " + lastForceScanElapsedText : "",
            "Bản ghi hiển thị theo snapshot CE: 0",
            "Lỗi snapshot CE: " + String(mergeErr && mergeErr.message ? mergeErr.message : mergeErr || "").slice(0, 220),
          ]);
          setCeStatus(
            "Không đọc được snapshot CE, tạm ẩn dữ liệu để tránh nhập sai: " +
              String(mergeErr && mergeErr.message ? mergeErr.message : mergeErr || "").slice(0, 180),
            "err"
          );
        }
      } else {
        cachedRows = reconcileTrangThaiCeRows(cachedRows);
        setCeDetail([
          "Nguồn CE: Refresh dữ liệu (chưa cấu hình Worker CE)",
          "Thời gian trình duyệt: " + composeBrowserTimeText(),
          "Tổng thời gian refresh: " + formatElapsedMs(Date.now() - startedAtMs),
          lastForceScanElapsedText ? "Tổng thời gian quét lại từ đầu gần nhất: " + lastForceScanElapsedText : "",
          "Bản ghi đích: " + cachedRows.length,
        ]);
        setCeStatus(
          "Đã tải " +
            cachedRows.length +
            " bản ghi đích (chưa cấu hình Worker CE — chỉ hiển thị cục bộ).",
          "ok"
        );
      }
      renderTable();
    } catch (e) {
      console.warn("CE fetch:", e);
      setCeStatus(
        "Không tải được NocoDB: " +
          String(e && e.message ? e.message : e).slice(0, 220) +
          ".",
        "err"
      );
      cachedRows = [];
      renderTable();
    }
  }

  function wireChrome() {
    const refreshBtn = qs("#ce-refresh-btn");
    const refreshForceBtn = qs("#ce-refresh-force-btn");
    const exportExcelBtn = qs("#ce-export-excel-btn");
    const statsBtn = qs("#ce-stats-btn");
    const giaoMauStatsBtn = qs("#ce-giao-mau-stats-btn");
    const detailBtn = qs("#ce-detail-btn");
    const monthFilterSel = qs("#ce-filter-month");
    if (refreshBtn) refreshBtn.addEventListener("click", () => void loadLive().catch(() => {}));
    if (refreshForceBtn) refreshForceBtn.addEventListener("click", () => void forceResyncAllToCe().catch((e) => {
      setCeStatus("Quét lại từ đầu lỗi: " + String(e && e.message ? e.message : e || "").slice(0, 220), "err");
    }));
    if (detailBtn) {
      detailBtn.addEventListener("click", () => {
        const modal = ensureCeDetailModal();
        if (!modal) return;
        modal.content.textContent = ceDetailText || ("Thời gian trình duyệt: " + composeBrowserTimeText() + " | Chưa có dữ liệu chi tiết.");
        modal.overlay.classList.add("open");
      });
    }
    if (statsBtn) statsBtn.addEventListener("click", openCeStatsModal);
    if (giaoMauStatsBtn) giaoMauStatsBtn.addEventListener("click", openCeGiaoMauStatsModal);
    if (exportExcelBtn) exportExcelBtn.addEventListener("click", exportFilteredCeRowsToExcel);
    if (monthFilterSel) monthFilterSel.addEventListener("change", scheduleCeTableRender);

    ["ce-filter-field-1", "ce-filter-field-2"].forEach((id, idx) => {
      const el = qs("#" + id);
      if (el)
        el.addEventListener("change", () => {
          syncCeCustomFilterRowUI(idx + 1);
          scheduleCeTableRender();
        });
    });
    ["ce-filter-value-1", "ce-filter-value-2"].forEach((id) => {
      const el = qs("#" + id);
      if (el) el.addEventListener("input", scheduleCeTableRender);
    });
    [
      "ce-filter-datetime-from-1",
      "ce-filter-datetime-to-1",
      "ce-filter-datetime-from-2",
      "ce-filter-datetime-to-2",
    ].forEach((id) => {
      const el = qs("#" + id);
      if (el) {
        el.addEventListener("change", scheduleCeTableRender);
        el.addEventListener("input", scheduleCeTableRender);
      }
    });

    const resetCustom = qs("#ce-filter-custom-reset");
    if (resetCustom) {
      resetCustom.addEventListener("click", () => {
        const s1 = qs("#ce-filter-field-1");
        const s2 = qs("#ce-filter-field-2");
        const v1 = qs("#ce-filter-value-1");
        const v2 = qs("#ce-filter-value-2");
        const d1f = qs("#ce-filter-datetime-from-1");
        const d1t = qs("#ce-filter-datetime-to-1");
        const d2f = qs("#ce-filter-datetime-from-2");
        const d2t = qs("#ce-filter-datetime-to-2");
        const sm = qs("#ce-filter-month");
        if (s1) {
          s1.value = "";
          s1.removeAttribute("data-ce-prev-field");
        }
        if (s2) {
          s2.value = "";
          s2.removeAttribute("data-ce-prev-field");
        }
        if (v1) v1.value = "";
        if (v2) v2.value = "";
        if (d1f) d1f.value = "";
        if (d1t) d1t.value = "";
        if (d2f) d2f.value = "";
        if (d2t) d2t.value = "";
        if (sm) sm.value = "";
        syncCeCustomFilterRowUI(1);
        syncCeCustomFilterRowUI(2);
        scheduleCeTableRender();
      });
    }

    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      const modalKb = qs("#ce-khai-bao-modal");
      if (modalKb && modalKb.classList.contains("open")) {
        modalKb.classList.remove("open");
        modalRowId = "";
        clearCeKhaiBaoLinkInlineErr(modalKb);
        return;
      }
      const modalGc = qs("#ce-ghi-chu-modal");
      if (modalGc && modalGc.classList.contains("open")) {
        modalGc.classList.remove("open");
        modalGhiChuRowId = "";
        return;
      }
      const modalGm = qs("#ce-giao-mau-modal");
      if (modalGm && modalGm.classList.contains("open")) {
        modalGm.classList.remove("open");
        modalGiaoMauRowId = "";
        const err = qs("#ce-giao-mau-err", modalGm);
        if (err) {
          err.textContent = "";
          err.hidden = true;
        }
        return;
      }
      const modalTt = qs("#ce-trang-thai-modal");
      if (modalTt && modalTt.classList.contains("open")) {
        modalTt.classList.remove("open");
        modalTrangThaiRowId = "";
        clearCeTrangThaiPasswordInlineErr(modalTt);
        const pwdEl = qs("#ce-trang-thai-password", modalTt);
        if (pwdEl) pwdEl.value = "";
        return;
      }
    });
  }

  function boot() {
    ensureCePanelOutsideTestbenPanel();
    wireModuleTabSwitching();

    if (!ceCfg || ceCfg.enabled === false) {
      const nav = qs(".module-tabs");
      const ceTab = qs('.module-tab[data-module="ce"]');
      const cePanel = qs('.app-module-panel[data-module-panel="ce"]');
      if (nav) nav.hidden = false;
      if (ceTab) ceTab.hidden = true;
      if (cePanel) cePanel.hidden = true;
      setActiveModule("testben");
      return;
    }

    try {
      wireChrome();
      populateCeFilterSelectOptions();
      syncCeCustomFilterRowUI(1);
      syncCeCustomFilterRowUI(2);
      cachedRows = [];
      renderTable();
    } catch (err) {
      console.error("CE — lỗi khởi tạo UI (tab vẫn đổi được):", err);
    }

    setActiveModule("testben");
  }

  // Cho phép main.js trigger refresh CE sau khi refresh Test bền hoàn tất.
  global.Form15CeRefreshLive = function () {
    return loadLive();
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})(window);
