(function initForm15RenderService(global) {
  const { htmlEscape, buildExcelViewUrl } = global.Form15Utils;
  const LAB_MAP_ZONES_KEY = "form15.labMap.zones.v1";

  function labMapHasUsableZones(cfg) {
    if (!cfg || !cfg.enabled || !cfg.imageUrl) return false;
    try {
      const raw = localStorage.getItem(LAB_MAP_ZONES_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length) return true;
      }
    } catch (_) {}
    return Array.isArray(cfg.zones) && cfg.zones.length > 0;
  }

  function setStatus(ui, message, type) {
    ui.statusBox.classList.remove("ok", "err", "warn", "info", "loading");
    const isLoading = !type || type === "loading";
    if (type === "ok") ui.statusBox.classList.add("ok");
    if (type === "err") ui.statusBox.classList.add("err");
    if (type === "warn") ui.statusBox.classList.add("warn");
    if (type === "info") ui.statusBox.classList.add("info");
    if (isLoading) ui.statusBox.classList.add("loading");

    ui.statusBox.innerHTML = "";
    if (isLoading) {
      const spinner = document.createElement("span");
      spinner.className = "status-spinner";
      ui.statusBox.appendChild(spinner);
    }
    if (type === "ok") {
      const check = document.createElement("span");
      check.className = "status-ok-check";
      check.textContent = "\u2713";
      ui.statusBox.appendChild(check);
    }
    ui.statusBox.appendChild(document.createTextNode(String(message ?? "")));
    if (isLoading) {
      const hint = document.createElement("span");
      hint.className = "status-hint";
      hint.textContent = "Vui lòng đợi cho đến khi làm mới dữ liệu hoàn thành";
      ui.statusBox.appendChild(hint);
    }
  }

  /** Một dòng tóm tắt cho cột «Thông tin Test bền» (bảng chính — chi tiết trong pop-up). */
  function formatDateToDdMmYyyy(raw) {
    const s = String(raw || "").trim();
    if (!s) return "";
    if (/^invalid date$/i.test(s)) return "";
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
      const parts = s.split("-");
      return parts[2] + "-" + parts[1] + "-" + parts[0];
    }
    if (/^\d{4}\/\d{2}\/\d{2}$/.test(s)) {
      const parts = s.split("/");
      return parts[2] + "-" + parts[1] + "-" + parts[0];
    }
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) {
      const parts = s.split("/");
      return parts[0] + "-" + parts[1] + "-" + parts[2];
    }
    if (/^\d{2}-\d{2}-\d{4}$/.test(s)) return s;
    return s;
  }

  function buildManualSummaryText(item) {
    const row = item && typeof item === "object" ? item : {};
    const st = String(row.manual_status || "Pending").trim();
    const area = String(row.manual_test_area || "").trim();
    const etaView = formatDateToDdMmYyyy(row.manual_eta_date);
    const bits = [st || "Pending", area || "-", etaView || "-"];
    return bits.join(" - ");
  }

  function buildManualViewCell(fieldKey, text, extraClass) {
    const fk = String(fieldKey || "");
    let raw = String(text == null ? "" : text);
    if (
      fk === "manual_test_start_date" ||
      fk === "manual_eta_date" ||
      fk === "manual_actual_done_date"
    ) {
      raw = formatDateToDdMmYyyy(raw);
    }
    const view = raw.trim() ? htmlEscape(raw).replace(/\n/g, "<br>") : '<span class="muted">-</span>';
    const cls = "col-fixed col-manual col-manual-view" + (extraClass ? " " + extraClass : "");
    const isStatus = fk === "manual_status";
    const st = isStatus ? String(raw || "Pending").trim().toLowerCase() : "";
    const statusClass = isStatus && st ? (" status-" + htmlEscape(st)) : "";
    return '<td class="' + cls + '"><div class="manual-view-val' + statusClass + '" data-manual-view="' + htmlEscape(fk) + '">' + view + "</div></td>";
  }

  /** Gom HTML mot dong — dung cho ca ve 1 lan va ve theo lo. */
  function buildSingleRowHtml(item, dynamicColsVisible) {
    let html = '<tr data-row-key="' + htmlEscape(item.rowKey || "") + '" data-record-id="' + htmlEscape(item.targetRecordId || "") + '">';
    html += '<td class="col-fixed col-task-code">' + htmlEscape(item.taskCode) + "</td>";
    html += '<td class="col-fixed col-task-name">' + htmlEscape(item.taskName) + "</td>";
    html += '<td class="col-fixed">' + htmlEscape(item.assignee || "") + "</td>";
    html += '<td class="col-fixed">' + htmlEscape(item.completionActual || "") + "</td>";
    html += '<td class="col-fixed col-sheet">' + htmlEscape(item.sheetName) + "<small>Nguồn: " + htmlEscape(item.sourceSheetName) + "</small></td>";
    {
      const viewUrl = buildExcelViewUrl(item.fileUrl);
      const safeHref = htmlEscape(viewUrl);
      const title = htmlEscape("Mở xem trên trình duyệt (Excel Online / Google)");
      html +=
        '<td class="col-fixed col-link-file"><a class="excel-view-link" href="' +
        safeHref +
        '" target="_blank" rel="noopener noreferrer" title="' +
        title +
        '">Xem online</a></td>';
    }
    for (const col of dynamicColsVisible) {
      let tdClass = "mono col-dynamic";
      if (col === "STT") tdClass += " col-stt";
      if (col === "Công chuẩn") tdClass += " col-standard-work";
      if (col === "Mã danh mục") tdClass += " col-category-code";
      if (col === "Hướng dẫn / Phương pháp (Document)") tdClass += " col-guide-doc";
      if (col === "Đánh giá" || col === "Danh gia") tdClass += " col-danh-gia";
      html += '<td class="' + tdClass + '">' + htmlEscape(item.rowData[col] ?? "") + "</td>";
    }
    {
      const sum = buildManualSummaryText(item);
      const sumT = htmlEscape(sum);
      html +=
        '<td class="col-fixed col-manual col-dur-manual-summary">' +
        '<div class="dur-manual-cell">' +
        '<div class="dur-manual-summary" title="' +
        sumT +
        '">' +
        sumT +
        "</div>" +
        '<button type="button" class="btn btn-primary manual-row-edit-btn dur-manual-control">Nhập / sửa</button>' +
        "</div></td>";
    }
    html += buildManualViewCell("manual_status", item.manual_status || "Pending", "col-manual-status");
    html += buildManualViewCell("manual_test_start_date", item.manual_test_start_date || "", "col-manual-date");
    html += buildManualViewCell("manual_eta_date", item.manual_eta_date || "", "col-manual-date");
    html += buildManualViewCell("manual_so_luong_mau", item.manual_so_luong_mau || "", "col-so-luong-mau");
    html += buildManualViewCell("manual_test_area", item.manual_test_area || "");
    html += buildManualViewCell("manual_test_area_detail", item.manual_test_area_detail || "", "col-chi-tiet-vi-tri");
    html += buildManualViewCell("manual_jig_code", item.manual_jig_code || "");
    html += buildManualViewCell("manual_actual_done_date", item.manual_actual_done_date || "", "col-manual-date");
    html += buildManualViewCell("manual_ket_qua", item.manual_ket_qua || "", "col-ket-qua");
    html += buildManualViewCell("manual_ghi_chu", item.manual_ghi_chu || "", "col-ghi-chu");
    html += "</tr>";
    return html;
  }

  /**
   * @param {{ afterPartial?: () => void }} [hooks] — gọi sau mỗi phần vẽ tbody (bảng lớn) để khóa/mở ô nhập khớp trạng thái refresh.
   */
  async function renderTable(ui, rows, hooks) {
    const yieldToMain = global.Form15Utils && typeof global.Form15Utils.yieldToMain === "function"
      ? global.Form15Utils.yieldToMain
      : function () {
          return Promise.resolve();
        };

    const afterPartial = hooks && typeof hooks.afterPartial === "function" ? hooks.afterPartial : null;
    /** Test bền: ẩn nhóm cột tùy chọn khi không bật (hooks.durabilityShowOptionalCols). */
    const durabilityShowOptional = !!(hooks && hooks.durabilityShowOptionalCols);
    const durabilityTableClass = "form15-durability-table" + (durabilityShowOptional ? "" : " dur-hide-optional-cols");

    if (!rows.length) {
      ui.tableRoot.innerHTML = '<div class="empty">Không tìm thấy dòng nào có "Đánh giá = Test bền".</div>';
      if (afterPartial) afterPartial();
      return;
    }
    /** Nhuong luong truoc vong lap nang — tranh modal/nut Refresh khong nhan click luc mo trang. */
    await yieldToMain();
    const dynamicCols = [];
    const seenCols = new Set();
    for (const item of rows) {
      for (const key of Object.keys(item.rowData || {})) {
        if (!seenCols.has(key)) {
          seenCols.add(key);
          dynamicCols.push(key);
        }
      }
    }
    const cfg = global.Form15Config && global.Form15Config.CONFIG;
    const hideExcel = new Set(Array.isArray(cfg && cfg.tableHideExcelColumns) ? cfg.tableHideExcelColumns : []);
    const dynamicColsVisible = dynamicCols.filter((c) => !hideExcel.has(c));
    const baseHeaders = ["Mã tác vụ", "Tên tác vụ", "Asignee", "Ngày trả báo cáo tức thời", "Sheet", "Link file"];
    const manualHeaders = [
      "PIC khai báo thông tin Test bền",
      "Trạng thái",
      "Thời gian bắt đầu",
      "Thời gian dự kiến hoàn thành",
      "Số lượng mẫu",
      "Khu vực test",
      "Chi tiết vị trí test",
      "Mã / Tên Jig test",
      "Thời gian hoàn thành thực tế",
      "Kết quả",
      "Ghi chú",
    ];
    const allHeaders = baseHeaders.concat(dynamicColsVisible).concat(manualHeaders);

    const manualHeaderSet = new Set(manualHeaders);

    let theadHtml = '<table class="' + durabilityTableClass + '"><thead><tr>';
    for (const h of allHeaders) {
      let thClass = "col-fixed";
      if (h === "Mã tác vụ") thClass += " col-task-code";
      if (h === "Tên tác vụ") thClass += " col-task-name";
      if (h === "Sheet") thClass += " col-sheet";
      if (h === "Link file") thClass += " col-link-file";
      if (h === "STT") thClass += " col-stt";
      if (h === "Công chuẩn") thClass += " col-standard-work";
      if (h === "Mã danh mục") thClass += " col-category-code";
      if (h === "Hướng dẫn / Phương pháp (Document)") thClass += " col-guide-doc";
      if (h === "Đánh giá" || h === "Danh gia") thClass += " col-danh-gia";
      if (h.indexOf("PIC khai báo thông tin Test bền") === 0) thClass += " col-dur-manual-summary";
      if (h === "Kết quả") thClass += " col-ket-qua";
      if (h === "Ghi chú") thClass += " col-ghi-chu";
      if (h === "Chi tiết vị trí test") thClass += " col-chi-tiet-vi-tri";
      if (h === "Số lượng mẫu") thClass += " col-so-luong-mau";
      if (h === "Thời gian bắt đầu" || h === "Thời gian dự kiến hoàn thành" || h === "Thời gian hoàn thành thực tế") {
        thClass += " col-manual-date";
      }
      if (h === "Trạng thái") thClass += " col-manual-status";
      if (manualHeaderSet.has(h)) thClass += " col-manual";
      theadHtml += '<th class="' + thClass + '">' + htmlEscape(h) + "</th>";
    }
    theadHtml += "</tr></thead>";

    const ROW_SYNC_MAX = 48;
    const ROW_CHUNK = 24;

    if (rows.length <= ROW_SYNC_MAX) {
      let html = theadHtml + "<tbody>";
      for (let i = 0; i < rows.length; i += 1) {
        html += buildSingleRowHtml(rows[i], dynamicColsVisible);
      }
      html += "</tbody></table>";
      ui.tableRoot.innerHTML = html;
      if (afterPartial) afterPartial();
      return;
    }

    ui.tableRoot.innerHTML = theadHtml + "<tbody></tbody></table>";
    const tbody = ui.tableRoot.querySelector("tbody");
    if (!tbody) {
      if (afterPartial) afterPartial();
      return;
    }

    await yieldToMain();

    for (let i = 0; i < rows.length; i += ROW_CHUNK) {
      const end = Math.min(i + ROW_CHUNK, rows.length);
      let chunkHtml = "";
      for (let j = i; j < end; j += 1) {
        chunkHtml += buildSingleRowHtml(rows[j], dynamicColsVisible);
      }
      tbody.insertAdjacentHTML("beforeend", chunkHtml);
      if (afterPartial) afterPartial();
      await yieldToMain();
    }
  }

  global.Form15RenderService = {
    setStatus,
    renderTable,
  };
})(window);

