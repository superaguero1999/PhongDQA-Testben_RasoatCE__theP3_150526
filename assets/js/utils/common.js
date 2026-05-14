(function initForm15Utils(global) {
  function nowMs() {
    return Date.now();
  }

  function formatTime(ts) {
    try {
      return new Date(ts).toLocaleString("vi-VN");
    } catch (_) {
      return "";
    }
  }

  function normalizeText(input) {
    return String(input || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      // đ/Đ không có dạng NFD = chữ d + dấu — nếu không đổi sang "d" thì bị xóa bởi [^a-z0-9]
      // và "đạt" thành "at", không còn khớp từ khóa "dat" / "khongdat".
      .replace(/\u0111/g, "d")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  function normalizeCompact(input) {
    return normalizeText(input).replace(/\s+/g, "");
  }

  function isSameLoose(a, b) {
    return normalizeCompact(a) === normalizeCompact(b);
  }

  function htmlEscape(str) {
    return String(str ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  /**
   * Chuyển URL dùng để tải/đọc Excel sang URL mở xem trên trình duyệt (khi có thể).
   * Google Sheets: bỏ export xlsx → mở /edit. Google Drive: /view. SP/OD: web=1, bỏ download.
   * Link .xlsx HTTPS công khai (không phải Google/MS tenant): Office Web Viewer.
   */
  function buildExcelViewUrl(rawUrl) {
    const s = String(rawUrl || "").trim();
    if (!s) return s;
    try {
      const u = new URL(s);
      const host = u.hostname.toLowerCase();

      if (u.protocol !== "http:" && u.protocol !== "https:") return s;

      if (host.includes("docs.google.com") && /\/spreadsheets\/d\//.test(u.pathname)) {
        const m = s.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
        if (m && m[1]) {
          const gid = u.searchParams.get("gid");
          let out = "https://docs.google.com/spreadsheets/d/" + m[1] + "/edit";
          if (gid) out += "?gid=" + encodeURIComponent(gid);
          return out;
        }
      }

      if (host.includes("drive.google.com")) {
        const m = s.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
        if (m && m[1]) return "https://drive.google.com/file/d/" + m[1] + "/view";
        const id = u.searchParams.get("id");
        if (id) return "https://drive.google.com/file/d/" + encodeURIComponent(id) + "/view";
      }

      if (host.includes("sharepoint.com") || host.includes("onedrive.")) {
        const next = new URL(s);
        next.searchParams.delete("download");
        next.searchParams.delete("downloadformat");
        if (!next.searchParams.has("web")) next.searchParams.set("web", "1");
        return next.toString();
      }

      const looksDirectXlsx = /\.xlsx?(\?|#|$)/i.test(u.pathname + u.search);
      const blockedOfficeViewer =
        host.includes("google.") ||
        host.includes("sharepoint.") ||
        host.includes("onedrive.") ||
        host.includes("officeapps.live.com");
      if (looksDirectXlsx && !blockedOfficeViewer) {
        return "https://view.officeapps.live.com/op/view.aspx?src=" + encodeURIComponent(s);
      }
    } catch (_) {}
    return s;
  }

  global.Form15Utils = {
    nowMs,
    formatTime,
    normalizeText,
    normalizeCompact,
    isSameLoose,
    htmlEscape,
    buildExcelViewUrl,
  };
})(window);

