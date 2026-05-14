/**
 * Rà soát CE — logic phân loại kết luận (độc lập module, không import Test bền).
 * Chuẩn hóa chuỗi: bỏ dấu, chữ thường, bỏ ký tự đặc biệt/khoảng trắng (normalizeCompact).
 */
(function initForm15CeReviewLogic(global) {
  const { normalizeCompact } = global.Form15Utils || {};

  function normCompact(s) {
    if (typeof normalizeCompact === "function") return normalizeCompact(s);
    return String(s || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/\u0111/g, "d")
      .replace(/[^a-z0-9]+/g, "")
      .trim();
  }

  /**
   * Keyword sau normalizeCompact — phải kiểm tra "khongdat" TRƯỚC "dat"
   * vì chuỗi khongdat vẫn chứa substring "dat".
   */
  const KW = {
    KHONG_DAT: "khongdat",
    THAM_KHAO: "thamkhao",
    DAT: "dat",
  };

  const CELL = {
    DAT: "DAT",
    KHONG_DAT: "KHONG_DAT",
    THAM_KHAO: "THAM_KHAO",
    UNKNOWN: "UNKNOWN",
  };

  const KET_QUA = {
    DAT: "Đạt",
    KHONG_DAT: "Không đạt",
    THAM_KHAO: "Tham khảo",
  };

  const TRANG_THAI = {
    CHUA_GUI: "Chưa gửi",
    DA_GUI: "Đã gửi",
    KHONG_CAN: "Không cần",
  };

  /** Phân loại một ô "Kết luận" / "Kết luận trang bìa". */
  function classifyCell(raw) {
    const s = normCompact(raw);
    if (!s) return CELL.UNKNOWN;
    if (s.includes(KW.KHONG_DAT)) return CELL.KHONG_DAT;
    if (s.includes(KW.THAM_KHAO)) return CELL.THAM_KHAO;
    if (s.includes(KW.DAT)) return CELL.DAT;
    return CELL.UNKNOWN;
  }

  function cellToKetQua(c) {
    if (c === CELL.DAT) return KET_QUA.DAT;
    if (c === CELL.KHONG_DAT) return KET_QUA.KHONG_DAT;
    if (c === CELL.THAM_KHAO) return KET_QUA.THAM_KHAO;
    return "";
  }

  /**
   * Ghép hai cột:
   * - Một cột Không đạt + một cột Tham khảo → Không đạt
   * - Chỉ cần một cột Đạt (đã loại Không đạt trong ô đó) → Đạt
   * - Cả hai Không đạt → Không đạt
   * - Cả hai Tham khảo → Tham khảo
   * - Một cột trống / không phân loại được → lấy ý nghĩa cột còn lại (Đạt + trống → Đạt, …)
   * - Hai cột đều trống hoặc không đọc được → "" (Trạng thái khai báo CE mặc định Chưa gửi)
   */
  function computeKetQua(ketLuanRaw, ketLuanTrangBiaRaw) {
    const a = classifyCell(ketLuanRaw);
    const b = classifyCell(ketLuanTrangBiaRaw);
    if (a === CELL.UNKNOWN && b === CELL.UNKNOWN) return "";

    if (
      (a === CELL.KHONG_DAT && b === CELL.THAM_KHAO) ||
      (a === CELL.THAM_KHAO && b === CELL.KHONG_DAT)
    ) {
      return KET_QUA.KHONG_DAT;
    }
    if (a === CELL.DAT || b === CELL.DAT) return KET_QUA.DAT;
    if (a === CELL.KHONG_DAT && b === CELL.KHONG_DAT) return KET_QUA.KHONG_DAT;
    if (a === CELL.THAM_KHAO && b === CELL.THAM_KHAO) return KET_QUA.THAM_KHAO;

    if (a === CELL.UNKNOWN) return cellToKetQua(b);
    if (b === CELL.UNKNOWN) return cellToKetQua(a);

    return "";
  }

  /** Trạng thái mặc định trước khi có file khai báo. Không phân loại được → Chưa gửi. */
  function defaultTrangThaiKhaiBaoCe(ketQua) {
    if (!ketQua) return TRANG_THAI.CHUA_GUI;
    if (ketQua === KET_QUA.DAT) return TRANG_THAI.CHUA_GUI;
    if (ketQua === KET_QUA.KHONG_DAT) return TRANG_THAI.KHONG_CAN;
    if (ketQua === KET_QUA.THAM_KHAO) return TRANG_THAI.CHUA_GUI;
    return TRANG_THAI.CHUA_GUI;
  }

  function trangThaiSauKhaiBaoThanhCong() {
    return TRANG_THAI.DA_GUI;
  }

  global.Form15CeReviewLogic = {
    computeKetQua,
    classifyCell,
    defaultTrangThaiKhaiBaoCe,
    trangThaiSauKhaiBaoThanhCong,
    KET_QUA,
    TRANG_THAI,
    CELL,
    KW,
    normCompact,
  };
})(window);
