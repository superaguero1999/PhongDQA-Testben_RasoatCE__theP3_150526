(function initForm15CeReviewService(global) {
  const dataService = global.Form15DataService;
  const { CONFIG } = global.Form15Config || {};

  function pickFromFields(fields, candidates) {
    const list = Array.isArray(candidates) ? candidates : [];
    if (!fields || typeof fields !== "object") return "";
    for (const c of list) {
      if (Object.prototype.hasOwnProperty.call(fields, c)) {
        const v = fields[c];
        if (v != null && String(v).trim() !== "") return String(v);
      }
    }
    const isSameLoose = global.Form15Utils && global.Form15Utils.isSameLoose;
    const entries = Object.entries(fields);
    for (const [fKey, fVal] of entries) {
      for (const cand of list) {
        if (typeof isSameLoose === "function" && isSameLoose(fKey, cand)) {
          if (fVal != null && String(fVal).trim() !== "") return String(fVal);
        }
      }
    }
    return "";
  }

  /**
   * Chuẩn hóa các định dạng thời gian thường gặp trên NocoDB / Excel về ISO 8601.
   * Hỗ trợ:
   *  - ISO 8601 (`2026-05-01T08:30:00.000Z`, `2026-05-01 08:30:00+07:00`).
   *  - `yyyy-MM-dd[ HH:mm[:ss]]`.
   *  - `dd/MM/yyyy[ HH:mm[:ss]]`, `dd-MM-yyyy[ HH:mm[:ss]]` (VN locale).
   */
  function normalizeIsoTimestampFromSource(raw) {
    const s = String(raw ?? "").trim();
    if (!s) return "";
    // 1) Thử parse trực tiếp (ISO hoặc các format Date.parse hiểu được).
    const isoish = s.replace(/^(\d{4}-\d{2}-\d{2})\s+(\d)/, "$1T$2");
    let ms = Date.parse(isoish);
    if (Number.isNaN(ms)) ms = Date.parse(s);
    if (!Number.isNaN(ms)) return new Date(ms).toISOString();
    // 2) dd/MM/yyyy hoặc dd-MM-yyyy, có/không kèm giờ.
    const dmy = /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})(?:[\sT](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(s);
    if (dmy) {
      const dd = Number(dmy[1]);
      const mm = Number(dmy[2]);
      const yyyy = Number(dmy[3]);
      const hh = Number(dmy[4] || 0);
      const mi = Number(dmy[5] || 0);
      const ss = Number(dmy[6] || 0);
      const d = new Date(yyyy, mm - 1, dd, hh, mi, ss);
      if (!Number.isNaN(d.getTime())) return d.toISOString();
    }
    return "";
  }

  /** Danh sách bản ghi nguồn — chỉ đọc; dùng CONFIG.nocodb (trùng table/view CE). */
  async function fetchSourceRecordsOnly() {
    if (!dataService || typeof dataService.fetchAllRecords !== "function") {
      throw new Error("Thiếu Form15DataService.fetchAllRecords.");
    }
    if (!CONFIG) throw new Error("Thiếu CONFIG.");
    const res = await dataService.fetchAllRecords(CONFIG);
    return Array.isArray(res.rows) ? res.rows : [];
  }

  function mapRecordsToCeRows(records, Logic, ceCfg) {
    const logic = Logic || global.Form15CeReviewLogic;
    const cfg = ceCfg || CONFIG.ceReview || {};
    const cand = cfg.sourceFieldCandidates || {};
    const list = Array.isArray(records) ? records : [];
    return list.map((rec) => {
      const fields = dataService.getRecordFields(rec);
      let srcId = String(fields.Id ?? fields.id ?? "").trim();
      if (!srcId) srcId = String(rec.Id ?? rec.id ?? "").trim();
      const taskName = pickFromFields(fields, cand.taskName || []);
      const taskCode = pickFromFields(fields, cand.taskCode || []);
      const ma = pickFromFields(fields, cand.ma || []);
      const assignee = pickFromFields(fields, cand.assignee || []);
      const completionActual = pickFromFields(fields, cand.completionActual || []);
      const reportCode = pickFromFields(fields, cand.reportCode || []);
      const linkBcExcel = pickFromFields(fields, cand.linkBcExcel || []);
      const jiraLinkRequest = pickFromFields(fields, cand.jiraLinkRequest || []);
      const maKoi = pickFromFields(fields, cand.maKoi || []);
      const ketLuan = pickFromFields(fields, cand.ketLuan || []);
      const ketLuanTrangBia = pickFromFields(fields, cand.ketLuanTrangBia || []);
      const koiKhaiBaoCeLink = pickFromFields(fields, cand.koiKhaiBaoCeLink || []);
      const ceRaSoatTruoc = pickFromFields(fields, cand.ceRaSoatTruoc || []).trim();
      const ketQua = logic.computeKetQua(ketLuan, ketLuanTrangBia);
      const trangThaiCe = ceRaSoatTruoc
        ? ceRaSoatTruoc
        : logic.defaultTrangThaiKhaiBaoCe(ketQua);
      const ghiChu = ceRaSoatTruoc
        ? pickFromFields(fields, cand.ghiChuNopCe || [])
        : "";
      const ngayKhaiBaoCeSrc = pickFromFields(fields, cand.ngayKhaiBaoCe || []);
      const lichSuKhaiBaoCeSrc = pickFromFields(fields, cand.lichSuKhaiBaoCeAt || []);
      const lichSuKhaiBaoCeAtRaw = ceRaSoatTruoc
        ? ngayKhaiBaoCeSrc || lichSuKhaiBaoCeSrc
        : lichSuKhaiBaoCeSrc || ngayKhaiBaoCeSrc;
      const lichSuKhaiBaoCeAt = normalizeIsoTimestampFromSource(lichSuKhaiBaoCeAtRaw);
      const trangThaiGiaoMau = "Chưa gửi";
      return {
        sourceRecordId: srcId,
        taskName,
        taskCode,
        ma,
        assignee,
        completionActual,
        reportCode,
        linkBcExcel,
        jiraLinkRequest,
        maKoi,
        ketLuan,
        ketLuanTrangBia,
        ketQua,
        /** «CE rà soát» trên bảng đích — Cổng tác vụ cũ; nếu có thì là nguồn ưu tiên cho trangThaiCe. */
        ceRaSoatTruoc,
        trangThaiCe,
        /** Chuỗi từng dòng: Lần n: đổi từ "…" → "…" (chỉ khi đổi bằng mật khẩu trên UI). */
        trangThaiCeManualHistory: [],
        ghiChu,
        koiKhaiBaoCeLink,
        /** ISO 8601 — ghi khi user lưu link trên UI hoặc đọc từ NocoDB khi có link. */
        lichSuKhaiBaoCeAt,
        /** Khai báo giao mẫu (lưu bảng CE): mặc định Chưa gửi. */
        trangThaiGiaoMau,
        linkKoiKhaiBaoGiaoMau: "",
        ghiChuGiaoMau: "",
        lichSuKhaiBaoGiaoMauAt: "",
      };
    });
  }

  /** Bản ghi giả lập để xem UI không cần NocoDB. */
  function buildDemoRecords() {
    return [
      {
        Id: "ce-demo-1",
        fields: {
          Id: "ce-demo-1",
          "Mã tác vụ": "QA.DEMO-001",
          "Tên tác vụ": "Mẫu — một cột Đạt",
          "Mã": "SP-DEMO-001",
          Assignee: "Nguyễn Văn A",
          "Ngày hoàn thành thực tế": "2026-02-01",
          "Mã báo cáo": "BC-DEMO-01",
          "Kết luận": "   Sản phẩm đạt chất lượng  ",
          "Kết luận trang bìa": "Báo cáo tham khảo",
          "Link KOI - khai báo CE": "https://example.com/koi-demo",
          "Lịch sử khai báo CE": "2026-05-01T08:30:00.000Z",
        },
      },
      {
        Id: "ce-demo-2",
        fields: {
          Id: "ce-demo-2",
          "Mã tác vụ": "QA.DEMO-002",
          "Tên tác vụ": "Mẫu — Không đạt + Tham khảo",
          "Mã": "SP-DEMO-002",
          Assignee: "Trần Thị B",
          "Ngày hoàn thành thực tế": "2026-02-02",
          "Mã báo cáo": "BC-DEMO-02",
          "Kết luận": "san pham KHONG DAT chat luong",
          "Kết luận trang bìa": "\tbao cao tham khao\n",
          "CE rà soát": "Đã gửi",
          "Ghi chú nộp CE": "Đã nộp tại Cổng tác vụ cũ - hồ sơ HS-2024-0027",
          "Ngày khai báo CE": "2025-11-20T03:15:00.000Z",
        },
      },
      {
        Id: "ce-demo-3",
        fields: {
          Id: "ce-demo-3",
          "Mã tác vụ": "QA.DEMO-003",
          "Tên tác vụ": "Mẫu — cả hai Tham khảo",
          "Mã": "SP-DEMO-003",
          Assignee: "Lê Văn C",
          "Ngày hoàn thành thực tế": "2026-02-03",
          "Mã báo cáo": "BC-DEMO-03",
          "Kết luận": "Báo cáo tham khảo",
          "Kết luận trang bìa": "tham khao",
        },
      },
      {
        Id: "ce-demo-4",
        fields: {
          Id: "ce-demo-4",
          "Mã tác vụ": "QA.DEMO-004",
          "Tên tác vụ": "Mẫu — cả hai Không đạt",
          "Mã": "SP-DEMO-004",
          Assignee: "Phạm Thị D",
          "Ngày hoàn thành thực tế": "2026-02-04",
          "Mã báo cáo": "BC-DEMO-04",
          "Kết luận": "KHONG DAT",
          "Kết luận trang bìa": "Không đạt chất lượng",
        },
      },
    ];
  }

  function buildDemoCeRows(Logic, ceCfg) {
    return mapRecordsToCeRows(buildDemoRecords(), Logic, ceCfg);
  }

  global.Form15CeReviewService = {
    pickFromFields,
    fetchSourceRecordsOnly,
    mapRecordsToCeRows,
    buildDemoCeRows,
    buildDemoRecords,
  };
})(window);
