/** Cấu hình tập trung — mở rộng tại đây, tránh rải magic string. */
export const APP = {
  name: "The_P3",
  defaultRoute: "#/p3",
};

/** URL Worker đã deploy (có /api/p3/*). Ví dụ: https://the-p3-kpi-worker.xxx.workers.dev */
export const P3_WORKER_BASE = "https://the-p3-kpi-worker.superaguero1999.workers.dev";

/** Tần suất làm mới bảng (ms), chỉ để đồng bộ hiển thị giữa các máy. Mặc định 60s — giảm tải lại ảnh T1/T2. Có thể tăng (vd 120000 = 2 phút). Tối thiểu 10s (ép trong p3.js). */
export const P3_POLL_MS = 60000;

/**
 * Mật khẩu dự phòng (Start/End): bỏ qua kiểm tra PIN khi khớp. Phải trùng biến môi trường Worker `P3_MASTER_PIN` (mặc định Worker = chuỗi này nếu không set).
 * Đổi mật khẩu: cập nhật cả đây và Secret/Var `P3_MASTER_PIN` trên Cloudflare.
 */
export const P3_MASTER_PIN = "01ab23";

export const ROUTES = {
  p3: "#/p3",
};
