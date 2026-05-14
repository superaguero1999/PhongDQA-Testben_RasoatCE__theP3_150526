# The_P3 — P3 đa người dùng & PIN đối ứng

## 1) Tạo 2 bảng NocoDB

### Bảng A: Hạng mục gốc (`P3_TABLE_ID`)
Giữ nguyên bảng hiện có (`mgube1qyxu78ndg`) với các cột:
- `Mã CAT`
- `Linh kiện`
- `Hạng mục kiểm tra`
- `Tiêu chuẩn`
- `Document`
- `Công chuẩn`
- `Công chuẩn (mới)` (Number, tùy chọn — Worker cập nhật khi có lượt **done**; trung bình T2−T1 theo giờ)

### Bảng B: Lượt triển khai (`P3_INSTANCE_TABLE_ID`) — BẮT BUỘC tạo mới
Tạo bảng mới, cột đúng tên:
- `P3 Source Id` (text/number) -> Id của bảng hạng mục gốc
- `P3 PIC` (text)
- `P3 PIN Hash` (long text)
- `P3 trạng thái` (text: `running` / `done`)
- `Thời gian bắt đầu` (datetime)
- `Thời gian kết thúc` (datetime)
- `Tỷ lệ P3` (number, hệ số)
- `P3 file id bắt đầu` (long text)
- `P3 file id kết thúc` (long text)
- `Công chuẩn cá nhân` (Number, tùy chọn — Worker ghi khi **End**; = T2−T1 giờ)

## 2) Cloudflare Worker variables

Trên Dashboard Worker:
- `NOCODB_HOST` = host NocoDB (vd `https://iatzhxxuk.tino.page`)
- `P3_TABLE_ID` = `mgube1qyxu78ndg`
- `P3_INSTANCE_TABLE_ID` = ID bảng mới (Lượt triển khai)
- `TELEGRAM_CHAT_ID` = id group telegram
- `ALLOWED_ORIGIN` = origin frontend (vd `http://127.0.0.1:5500`)

Secrets:
- `NOCODB_TOKEN`
- `TELEGRAM_BOT_TOKEN`
- `P3_IMAGE_SIGNING_SECRET`
- `P3_PIN_PEPPER` (khuyến nghị)

## 3) Deploy worker

Copy file `The_P3/workers/p3-worker.js` lên Cloudflare Worker và deploy.

Test:
- `/api/p3/health`
- `/api/p3/dashboard`

## 4) Frontend

`assets/js/config.js`:
- `P3_WORKER_BASE` = URL worker

Mở web local qua HTTP (Live Server / python server), vào `#/p3`.

## 5) Hành vi mới

- Mỗi hạng mục có nhiều lượt triển khai (PIC A/B/C...)
- Start: nhập PIC + PIN + ảnh T1
- End: nhập lại PIN + ảnh T2
- Sai PIN: `Mật mã không khớp với người bắt đầu`
- Hàng chính hiển thị `P3 trung bình` của các lượt `done`, và **Công chuẩn (mới)** (trung bình T2−T1; đồng bộ NocoDB khi End)
- Bảng lượt (sau khi bấm `+`) có cột **Công chuẩn cá nhân** (T2−T1; lưu NocoDB khi End)
- Bấm `+` để xổ danh sách lượt, `[+] Triển khai mới` để tạo lượt mới
