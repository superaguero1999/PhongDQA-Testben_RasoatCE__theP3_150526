/**
 * Worker P3 Multi-user: item goc + nhieu luot trien khai theo PIC.
 *
 * Vars:
 * - NOCODB_HOST, NOCODB_TOKEN
 * - P3_TABLE_ID                (bang hạng mục gốc)
 * - P3_INSTANCE_TABLE_ID       (bang luot trien khai)
 * - TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
 * - P3_IMAGE_SIGNING_SECRET, ALLOWED_ORIGIN
 * - P3_PIC_TABLE_ID (optional: bảng danh sách PIC — nếu có thì chỉ chấp nhận PIC trong danh sách)
 *   Khuyến nghị thêm cột Number/Text: "Ngưỡng", "Mục tiêu" (KPI) — Worker trả về dashboard để hiển thị modal thống kê.
 * - P3_PIN_PEPPER (optional secret)
 *
 * NocoDB — cột bổ sung (khuyến nghị):
 * - Bảng lượt: "Công chuẩn cá nhân" (Number) = T2−T1 giờ, ghi khi End
 * - Bảng hạng mục: "Công chuẩn (mới)" (Number) = trung bình cá nhân các lượt done
 */

var P3_WORKER_VERSION = "p3-worker-2026-05-13-v6-pic-kpi";

var ITEM_COL = {
  maCat: "Mã CAT",
  linhKien: "Linh kiện",
  hangMuc: "Hạng mục kiểm tra",
  tieuChuan: "Tiêu chuẩn",
  document: "Document",
  congChuan: "Công chuẩn",
  /** Trung bình (T2−T1) giờ — cập nhật khi kết thúc lượt; thêm cột Number/Text trên NocoDB */
  congChuanMoi: "Công chuẩn (mới)",
};

var INS_COL = {
  sourceId: "P3 Source Id",
  pic: "P3 PIC",
  pinHash: "P3 PIN Hash",
  status: "P3 trạng thái",
  t1: "Thời gian bắt đầu",
  t2: "Thời gian kết thúc",
  tyLeP3: "Tỷ lệ P3",
  fileIdStart: "P3 file id bắt đầu",
  fileIdEnd: "P3 file id kết thúc",
  /** T2−T1 (giờ) — ghi khi End; thêm cột Number trên NocoDB */
  congChuanCaNhan: "Công chuẩn cá nhân",
};

/** Bảng roster PIC (NocoDB): cột tên đúng như dưới — thêm/xóa dòng hoặc bỏ tích Kích hoạt để ẩn */
var PIC_COL = {
  ten: "Tên PIC",
  kichHoat: "Kích hoạt",
  /** KPI đăng ký — hiển thị trên modal thống kê PIC (so với tỷ lệ P3 thực tế) */
  nguong: "Ngưỡng",
  mucTieu: "Mục tiêu",
};

function p3Host(env) {
  return String(env.NOCODB_HOST || "").replace(/\/+$/, "");
}
function p3Token(env) {
  return String(env.NOCODB_TOKEN || env.NOCODB_API_TOKEN || env.XC_TOKEN || "").trim();
}
function p3ItemTableId(env) {
  return String(env.P3_TABLE_ID || "mgube1qyxu78ndg").trim();
}
function p3InstanceTableId(env) {
  return String(env.P3_INSTANCE_TABLE_ID || "").trim();
}
function p3PicTableId(env) {
  return String(env.P3_PIC_TABLE_ID || "").trim();
}

function picRowIsActive(m) {
  var kh = m[PIC_COL.kichHoat];
  if (kh === false || kh === 0 || kh === "0") return false;
  var s = String(kh || "").trim().toLowerCase();
  if (s === "false" || s === "no" || s === "không") return false;
  return true;
}

function picMetaCellToString(v) {
  if (v == null || v === "") return "";
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return String(v).trim();
}

async function fetchPicList(env) {
  var host = p3Host(env);
  var token = p3Token(env);
  var tid = p3PicTableId(env);
  if (!host || !token || !tid) return [];
  var rows = await nocoListAllRecords(host, token, tid, 500);
  var out = [];
  var seen = {};
  for (var i = 0; i < rows.length; i++) {
    var m = recordMap(rows[i]);
    if (!picRowIsActive(m)) continue;
    var name = String(m[PIC_COL.ten] || "").trim();
    if (!name || seen[name]) continue;
    seen[name] = true;
    out.push({
      name: name,
      nguong: picMetaCellToString(m[PIC_COL.nguong]),
      mucTieu: picMetaCellToString(m[PIC_COL.mucTieu]),
    });
  }
  out.sort(function (a, b) {
    return a.name.localeCompare(b.name, "vi");
  });
  return out;
}

function corsHeaders(env, req) {
  var allowed = String(env.ALLOWED_ORIGIN || "*").trim();
  var origin = req.headers.get("Origin") || "";
  if (allowed === "*" || !origin) {
    return {
      "Access-Control-Allow-Origin": allowed || "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Accept",
      "Access-Control-Max-Age": "86400",
    };
  }
  if (origin === allowed) {
    return {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Accept",
      "Access-Control-Max-Age": "86400",
    };
  }
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Accept",
    "Access-Control-Max-Age": "86400",
  };
}

function json(env, req, data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: Object.assign({ "Content-Type": "application/json; charset=utf-8" }, corsHeaders(env, req)),
  });
}

async function nocoFetch(url, token, init) {
  var headers = Object.assign({}, (init && init.headers) || {});
  if (token) headers["xc-token"] = token;
  headers["Accept"] = "application/json";
  var resp = await fetch(url, Object.assign({}, init || {}, { headers: headers }));
  var text = await resp.text();
  var data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (_) {
    data = null;
  }
  return { resp: resp, text: text, data: data };
}

function recordMap(rec) {
  if (!rec || typeof rec !== "object") return {};
  var nested = rec.fields && typeof rec.fields === "object" ? rec.fields : {};
  var out = Object.assign({}, rec, nested);
  delete out.fields;
  if (rec.Id != null) out.Id = rec.Id;
  if (rec.id != null && out.Id == null) out.Id = rec.id;
  return out;
}

async function nocoListAllRecords(host, token, tableId, limit) {
  var lim = Math.max(1, Math.min(500, Number(limit || 300)));
  var out = [];
  var offset = 0;
  for (var i = 0; i < 50; i++) {
    var u = new URL(host + "/api/v2/tables/" + encodeURIComponent(tableId) + "/records");
    u.searchParams.set("limit", String(lim));
    u.searchParams.set("offset", String(offset));
    u.searchParams.set("sort", "Id");
    var r = await nocoFetch(u.toString(), token, { method: "GET" });
    if (!r.resp.ok) throw new Error("NocoDB list HTTP " + r.resp.status + " " + String(r.text || "").slice(0, 300));
    var d = r.data || {};
    var list = Array.isArray(d.list) ? d.list : Array.isArray(d.records) ? d.records : [];
    for (var j = 0; j < list.length; j++) out.push(recordMap(list[j]));
    if (list.length < lim) break;
    offset += list.length;
  }
  return out;
}

async function nocoGetRow(host, token, tableId, rowId) {
  var u = host + "/api/v2/tables/" + encodeURIComponent(tableId) + "/records/" + encodeURIComponent(rowId);
  var r = await nocoFetch(u, token, { method: "GET" });
  if (!r.resp.ok) throw new Error("NocoDB GET HTTP " + r.resp.status);
  var d = r.data || {};
  if (Array.isArray(d.list) && d.list[0]) return recordMap(d.list[0]);
  return recordMap(d);
}

async function nocoPatchRow(host, token, tableId, rowId, patch) {
  var idNum = Number(rowId);
  var idVal = Number.isFinite(idNum) ? idNum : rowId;
  var body = [Object.assign({ Id: idVal }, patch)];
  var u = host + "/api/v2/tables/" + encodeURIComponent(tableId) + "/records";
  var r = await nocoFetch(u, token, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.resp.ok) throw new Error("NocoDB PATCH HTTP " + r.resp.status + " " + String(r.text || "").slice(0, 300));
  return r.data;
}

async function nocoDeleteRow(host, token, tableId, rowId) {
  var rid = String(rowId || "").trim();
  if (!rid) return;
  var u = host + "/api/v2/tables/" + encodeURIComponent(tableId) + "/records/" + encodeURIComponent(rid);
  var r = await nocoFetch(u, token, { method: "DELETE" });
  if (!r.resp.ok) {
    throw new Error("NocoDB DELETE HTTP " + r.resp.status + " " + String(r.text || "").slice(0, 220));
  }
}

async function nocoCreateRow(host, token, tableId, fields) {
  var u = host + "/api/v2/tables/" + encodeURIComponent(tableId) + "/records";
  var clean = {};
  var src = fields && typeof fields === "object" ? fields : {};
  var keys = Object.keys(src);
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    if (k === "Id" || k === "id") continue;
    if (src[k] === undefined) continue;
    clean[k] = src[k];
  }

  // Một số bản NocoDB chấp nhận object, một số yêu cầu mảng records.
  // Thử object trước, nếu lỗi PK thì fallback sang mảng.
  var r = await nocoFetch(u, token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(clean),
  });
  if (!r.resp.ok) {
    var txt = String(r.text || "");
    var shouldRetryArray =
      r.resp.status === 422 &&
      (txt.indexOf("ERR_INVALID_PK_VALUE") >= 0 ||
        txt.indexOf("Primary key value") >= 0 ||
        txt.indexOf("column 'Id'") >= 0 ||
        txt.indexOf("column \"Id\"") >= 0);
    if (shouldRetryArray) {
      r = await nocoFetch(u, token, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([clean]),
      });
    }
  }

  if (!r.resp.ok) {
    throw new Error("NocoDB POST HTTP " + r.resp.status + " " + String(r.text || "").slice(0, 300));
  }
  var d = r.data;
  if (Array.isArray(d) && d[0]) return recordMap(d[0]);
  if (d && Array.isArray(d.list) && d.list[0]) return recordMap(d.list[0]);
  return recordMap(d || {});
}

function parseHours(raw) {
  if (raw == null || raw === "") return NaN;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  var s = String(raw).replace(/,/g, ".").replace(/[^\d.\-]/g, "");
  return parseFloat(s);
}

function computeP3Ratio(t1Iso, t2Iso, congChuanHours) {
  var t1 = new Date(t1Iso).getTime();
  var t2 = new Date(t2Iso).getTime();
  if (!Number.isFinite(t1) || !Number.isFinite(t2) || t2 <= t1) return null;
  if (!Number.isFinite(congChuanHours) || congChuanHours <= 0) return null;
  var d = (t2 - t1) / 3600000;
  return (d - congChuanHours) / congChuanHours;
}

/** Khoảng T2 − T1 (giờ) */
function hoursBetweenT1T2(t1Iso, t2Iso) {
  var t1 = new Date(String(t1Iso || "")).getTime();
  var t2 = new Date(String(t2Iso || "")).getTime();
  if (!Number.isFinite(t1) || !Number.isFinite(t2) || t2 <= t1) return null;
  return (t2 - t1) / 3600000;
}

function round4(n) {
  if (n == null || !Number.isFinite(n)) return null;
  return Math.round(n * 10000) / 10000;
}

/** Đồng bộ trung bình Công chuẩn (mới) lên bảng hạng mục (bỏ qua lỗi nếu chưa tạo cột NocoDB) */
async function syncItemCongChuanMoi(host, token, itemTableId, insTableId, sourceId) {
  var all = await nocoListAllRecords(host, token, insTableId, 500);
  var vals = [];
  var sid = String(sourceId || "").trim();
  for (var i = 0; i < all.length; i++) {
    var m = recordMap(all[i]);
    if (String(m[INS_COL.sourceId] || "").trim() !== sid) continue;
    if (String(m[INS_COL.status] || "").trim().toLowerCase() !== "done") continue;
    var pv = parseFloat(m[INS_COL.congChuanCaNhan]);
    if (Number.isFinite(pv)) vals.push(pv);
    else {
      var hb = hoursBetweenT1T2(m[INS_COL.t1], m[INS_COL.t2]);
      if (hb != null && Number.isFinite(hb)) vals.push(hb);
    }
  }
  var patch = {};
  if (vals.length) {
    patch[ITEM_COL.congChuanMoi] = round4(vals.reduce(function (s, v) { return s + v; }, 0) / vals.length);
  } else {
    patch[ITEM_COL.congChuanMoi] = null;
  }
  await nocoPatchRow(host, token, itemTableId, sourceId, patch);
}

async function sha256Hex(text) {
  var enc = new TextEncoder();
  var buf = await crypto.subtle.digest("SHA-256", enc.encode(String(text || "")));
  var arr = new Uint8Array(buf);
  var out = "";
  for (var i = 0; i < arr.length; i++) out += arr[i].toString(16).padStart(2, "0");
  return out;
}

function normalizePin(pinRaw) {
  var pin = String(pinRaw || "").trim();
  if (!/^\d{4,6}$/.test(pin)) return "";
  return pin;
}

/** Mật khẩu dự phòng: ưu tiên env P3_MASTER_PIN; mặc định 01ab23 nếu không cấu hình. */
function p3MasterPin(env) {
  var s = String(env.P3_MASTER_PIN || "").trim();
  return s || "01ab23";
}

function isP3MasterPin(env, pinRaw) {
  var m = p3MasterPin(env);
  if (!m) return false;
  return String(pinRaw || "").trim() === m;
}

async function hashPin(env, pin) {
  var pepper = String(env.P3_PIN_PEPPER || "").trim();
  return sha256Hex(pin + "|" + pepper);
}

async function hmacSha256Hex(secret, message) {
  var enc = new TextEncoder();
  var key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  var sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  var hex = "";
  var u8 = new Uint8Array(sig);
  for (var i = 0; i < u8.length; i++) hex += u8[i].toString(16).padStart(2, "0");
  return hex;
}

async function signImageToken(env, fileId, ttlSec) {
  var secret = String(env.P3_IMAGE_SIGNING_SECRET || "change-me").trim();
  var exp = Math.floor(Date.now() / 1000) + Math.max(120, Math.min(86400, Number(ttlSec || 7200)));
  var payload = JSON.stringify({ f: String(fileId || ""), exp: exp });
  var sig = await hmacSha256Hex(secret, payload);
  var b64 = btoa(unescape(encodeURIComponent(payload))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  return b64 + "." + sig;
}

async function verifyImageToken(env, token) {
  var secret = String(env.P3_IMAGE_SIGNING_SECRET || "change-me").trim();
  var p = String(token || "").split(".");
  if (p.length !== 2) return null;
  var b64 = p[0].replace(/-/g, "+").replace(/_/g, "/");
  var pad = b64.length % 4 ? "=".repeat(4 - (b64.length % 4)) : "";
  var payload = "";
  try {
    payload = decodeURIComponent(escape(atob(b64 + pad)));
  } catch (_) {
    return null;
  }
  var sig = await hmacSha256Hex(secret, payload);
  if (sig !== p[1]) return null;
  var obj = null;
  try {
    obj = JSON.parse(payload);
  } catch (_) {
    return null;
  }
  if (!obj || !obj.f || typeof obj.exp !== "number") return null;
  if (obj.exp < Math.floor(Date.now() / 1000)) return null;
  return String(obj.f);
}

async function telegramSendPhoto(botToken, chatId, fileBlob, caption) {
  var fd = new FormData();
  fd.set("chat_id", String(chatId));
  if (caption) fd.set("caption", String(caption).slice(0, 900));
  fd.set("photo", fileBlob, "p3.jpg");
  var url = "https://api.telegram.org/bot" + encodeURIComponent(botToken) + "/sendPhoto";
  var r = await fetch(url, { method: "POST", body: fd });
  var txt = await r.text();
  var d = null;
  try {
    d = JSON.parse(txt);
  } catch (_) {}
  if (!r.ok || !d || !d.ok) throw new Error("Telegram sendPhoto: " + String((d && d.description) || txt).slice(0, 280));
  var photos = d.result && d.result.photo;
  if (!Array.isArray(photos) || !photos.length) throw new Error("Telegram: không có photo trong phản hồi");
  var last = photos[photos.length - 1];
  return { file_id: String(last.file_id || ""), message_id: d.result.message_id };
}

async function telegramGetFilePath(botToken, fileId) {
  var u =
    "https://api.telegram.org/bot" +
    encodeURIComponent(botToken) +
    "/getFile?file_id=" +
    encodeURIComponent(String(fileId));
  var r = await fetch(u);
  var d = await r.json();
  if (!d.ok || !d.result || !d.result.file_path) throw new Error("getFile thất bại");
  return String(d.result.file_path);
}

function numOrZero(v) {
  var n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function parseTimeMs(v) {
  var ms = new Date(String(v || "")).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function isLikelyDuplicateRunningInstance(instances, sourceId, pic, nowMs, windowMs) {
  var sid = String(sourceId || "").trim();
  var p = String(pic || "").trim().toLowerCase();
  for (var i = 0; i < instances.length; i++) {
    var m = recordMap(instances[i]);
    var s = String(m[INS_COL.status] || "").trim().toLowerCase();
    if (s !== "running") continue;
    if (String(m[INS_COL.sourceId] || "").trim() !== sid) continue;
    if (String(m[INS_COL.pic] || "").trim().toLowerCase() !== p) continue;
    var t1ms = parseTimeMs(m[INS_COL.t1]);
    if (!t1ms) continue;
    if (Math.abs(nowMs - t1ms) <= windowMs) return true;
  }
  return false;
}

function findRunningInstanceBySourcePic(instances, sourceId, pic) {
  var sid = String(sourceId || "").trim();
  var p = String(pic || "").trim().toLowerCase();
  var found = [];
  for (var i = 0; i < instances.length; i++) {
    var m = recordMap(instances[i]);
    var st = String(m[INS_COL.status] || "").trim().toLowerCase();
    if (st !== "running") continue;
    if (String(m[INS_COL.sourceId] || "").trim() !== sid) continue;
    if (String(m[INS_COL.pic] || "").trim().toLowerCase() !== p) continue;
    found.push(m);
  }
  if (!found.length) return null;
  found.sort(function (a, b) {
    return numOrZero(a.Id) - numOrZero(b.Id);
  });
  return found[0];
}

function sameRunningKey(m, sourceId, pic) {
  return (
    String(m[INS_COL.status] || "").trim().toLowerCase() === "running" &&
    String(m[INS_COL.sourceId] || "").trim() === String(sourceId || "").trim() &&
    String(m[INS_COL.pic] || "").trim().toLowerCase() === String(pic || "").trim().toLowerCase()
  );
}

async function dedupeRunningBySourcePic(host, token, insTableId, sourceId, pic) {
  var all = await nocoListAllRecords(host, token, insTableId, 500);
  var match = [];
  for (var i = 0; i < all.length; i++) {
    var m = recordMap(all[i]);
    if (!sameRunningKey(m, sourceId, pic)) continue;
    match.push(m);
  }
  if (match.length <= 1) {
    return match.length === 1 ? String(match[0].Id != null ? match[0].Id : "") : "";
  }
  // Giữ bản ghi có Id nhỏ nhất (coi là request tạo trước), xóa phần còn lại.
  match.sort(function (a, b) {
    return numOrZero(a.Id) - numOrZero(b.Id);
  });
  var keepId = String(match[0].Id != null ? match[0].Id : "");
  for (var j = 1; j < match.length; j++) {
    var delId = String(match[j].Id != null ? match[j].Id : "");
    if (!delId || delId === keepId) continue;
    try {
      await nocoDeleteRow(host, token, insTableId, delId);
    } catch (_) {
      // Nếu token không có quyền DELETE thì hạ cấp bằng PATCH trạng thái duplicate.
      try {
        var mark = {};
        mark[INS_COL.status] = "duplicate";
        await nocoPatchRow(host, token, insTableId, delId, mark);
      } catch (_) {}
    }
  }
  return keepId;
}

async function mapInstanceForClient(env, m) {
  var fidS = String(m[INS_COL.fileIdStart] || "").trim();
  var fidE = String(m[INS_COL.fileIdEnd] || "").trim();
  var tokS = fidS ? await signImageToken(env, fidS, 7200) : "";
  var tokE = fidE ? await signImageToken(env, fidE, 7200) : "";
  var rawPersonal = m[INS_COL.congChuanCaNhan];
  var pParsed = parseFloat(rawPersonal);
  var hoursPersonal = null;
  if (Number.isFinite(pParsed)) hoursPersonal = pParsed;
  else if (String(m[INS_COL.status] || "").trim().toLowerCase() === "done") {
    hoursPersonal = hoursBetweenT1T2(m[INS_COL.t1], m[INS_COL.t2]);
  }
  var r4 = round4(hoursPersonal);
  return {
    id: String(m.Id != null ? m.Id : ""),
    sourceId: String(m[INS_COL.sourceId] || ""),
    pic: String(m[INS_COL.pic] || ""),
    status: String(m[INS_COL.status] || "idle").toLowerCase(),
    t1: m[INS_COL.t1] != null ? String(m[INS_COL.t1]) : "",
    t2: m[INS_COL.t2] != null ? String(m[INS_COL.t2]) : "",
    tyLeP3: m[INS_COL.tyLeP3] != null ? String(m[INS_COL.tyLeP3]) : "",
    congChuanCaNhan: r4 == null ? "" : String(r4),
    thumbStart: tokS ? "/api/p3/image?token=" + encodeURIComponent(tokS) : "",
    thumbEnd: tokE ? "/api/p3/image?token=" + encodeURIComponent(tokE) : "",
  };
}

async function handleDashboard(env, req) {
  var host = p3Host(env);
  var token = p3Token(env);
  var itemTableId = p3ItemTableId(env);
  var insTableId = p3InstanceTableId(env);
  if (!host || !token || !itemTableId || !insTableId) {
    return json(env, req, { ok: false, error: "Thiếu NOCODB_HOST / NOCODB_TOKEN / P3_TABLE_ID / P3_INSTANCE_TABLE_ID" }, 500);
  }

  var items = await nocoListAllRecords(host, token, itemTableId, 400);
  var instancesRaw = await nocoListAllRecords(host, token, insTableId, 500);

  var grouped = {};
  for (var i = 0; i < instancesRaw.length; i++) {
    var im = recordMap(instancesRaw[i]);
    var st = String(im[INS_COL.status] || "").trim().toLowerCase();
    if (st === "duplicate") continue; // Ẩn bản ghi trùng đã bị hợp nhất
    var sid = String(im[INS_COL.sourceId] || "");
    if (!sid) continue;
    if (!grouped[sid]) grouped[sid] = [];
    grouped[sid].push(im);
  }

  var outItems = [];
  for (var j = 0; j < items.length; j++) {
    var it = recordMap(items[j]);
    var id = String(it.Id != null ? it.Id : "");
    var ins = grouped[id] || [];
    var done = [];
    var mappedInstances = [];
    for (var k = 0; k < ins.length; k++) {
      var m = await mapInstanceForClient(env, ins[k]);
      mappedInstances.push(m);
      if (String(m.status || "") === "done") done.push(numOrZero(m.tyLeP3));
    }
    mappedInstances.sort(function (a, b) {
      return numOrZero(b.id) - numOrZero(a.id);
    });
    var avg = done.length ? done.reduce(function (s, v) { return s + v; }, 0) / done.length : null;
    var storedMoi = it[ITEM_COL.congChuanMoi];
    var congChuanMoiAvg = "";
    if (storedMoi != null && String(storedMoi).trim() !== "") {
      congChuanMoiAvg = String(storedMoi).trim();
    } else {
      var dh = [];
      for (var mi = 0; mi < mappedInstances.length; mi++) {
        var x = mappedInstances[mi];
        if (String(x.status || "") !== "done") continue;
        var pv = parseFloat(x.congChuanCaNhan);
        if (Number.isFinite(pv)) dh.push(pv);
        else {
          var hb = hoursBetweenT1T2(x.t1, x.t2);
          if (hb != null && Number.isFinite(hb)) dh.push(hb);
        }
      }
      if (dh.length) {
        var am = dh.reduce(function (s, v) { return s + v; }, 0) / dh.length;
        congChuanMoiAvg = String(round4(am));
      }
    }
    outItems.push({
      id: id,
      maCat: it[ITEM_COL.maCat] != null ? String(it[ITEM_COL.maCat]) : "",
      linhKien: it[ITEM_COL.linhKien] != null ? String(it[ITEM_COL.linhKien]) : "",
      hangMuc: it[ITEM_COL.hangMuc] != null ? String(it[ITEM_COL.hangMuc]) : "",
      tieuChuan: it[ITEM_COL.tieuChuan] != null ? String(it[ITEM_COL.tieuChuan]) : "",
      document: it[ITEM_COL.document] != null ? String(it[ITEM_COL.document]) : "",
      congChuan: it[ITEM_COL.congChuan] != null ? String(it[ITEM_COL.congChuan]) : "",
      congChuanMoiAvg: congChuanMoiAvg,
      p3Avg: avg == null ? "" : String(Math.round(avg * 10000) / 10000),
      runningCount: mappedInstances.filter(function (x) { return x.status === "running"; }).length,
      instanceCount: mappedInstances.length,
      instances: mappedInstances,
    });
  }

  outItems.sort(function (a, b) {
    return numOrZero(a.id) - numOrZero(b.id);
  });

  var picList = await fetchPicList(env);
  return json(env, req, { ok: true, version: P3_WORKER_VERSION, items: outItems, picList: picList });
}

async function handleStartInstance(env, req) {
  var host = p3Host(env);
  var token = p3Token(env);
  var itemTableId = p3ItemTableId(env);
  var insTableId = p3InstanceTableId(env);
  var bot = String(env.TELEGRAM_BOT_TOKEN || "").trim();
  var chatId = String(env.TELEGRAM_CHAT_ID || "").trim();
  if (!host || !token || !itemTableId || !insTableId || !bot || !chatId) {
    return json(env, req, { ok: false, error: "Thiếu cấu hình Worker" }, 500);
  }

  var fd = await req.formData();
  var itemId = String(fd.get("itemId") || "").trim();
  var pic = String(fd.get("pic") || "").trim();
  var pinRaw = String(fd.get("pin") || "").trim();
  var pin = normalizePin(fd.get("pin"));
  var pinMaster = isP3MasterPin(env, pinRaw);
  var file = fd.get("image");

  if (!itemId || !pic || !file || typeof file.arrayBuffer !== "function" || (!pin && !pinMaster)) {
    return json(env, req, { ok: false, error: "Thiếu itemId/pic/pin/image hoặc PIN không hợp lệ." }, 400);
  }

  if (p3PicTableId(env)) {
    var allowedPic = await fetchPicList(env);
    if (!allowedPic.length) {
      return json(
        env,
        req,
        {
          ok: false,
          error: "Danh sách PIC trống hoặc không có dòng được Kích hoạt. Thêm hoặc bật PIC trên bảng NocoDB.",
        },
        400
      );
    }
    var picOk = false;
    for (var pi = 0; pi < allowedPic.length; pi++) {
      var row = allowedPic[pi];
      var nm = row && row.name != null ? String(row.name).trim() : "";
      if (nm === pic) {
        picOk = true;
        break;
      }
    }
    if (!picOk) {
      return json(env, req, { ok: false, error: "PIC không nằm trong danh sách được phép." }, 400);
    }
  }

  var item = await nocoGetRow(host, token, itemTableId, itemId);
  var allInsBefore = await nocoListAllRecords(host, token, insTableId, 500);
  // Chặn cứng: với cùng item + PIC chỉ cho phép tối đa 1 lượt running tại một thời điểm.
  var existingRunning = findRunningInstanceBySourcePic(allInsBefore, itemId, pic);
  if (existingRunning) {
    return json(env, req, {
      ok: false,
      error: "PIC này đang có lượt Running cho hạng mục này. Vui lòng bấm Kết thúc lượt hiện tại.",
    }, 409);
  }

  var caption =
    "P3 START | Item " +
    itemId +
    " | PIC " +
    pic +
    " | " +
    ITEM_COL.maCat +
    ": " +
    String(item[ITEM_COL.maCat] || "").slice(0, 80);
  var tg = await telegramSendPhoto(bot, chatId, file, caption);
  var t1 = new Date().toISOString();
  var pinForHash = pinMaster ? pinRaw : pin;
  var pinHash = await hashPin(env, pinForHash);

  // Re-check sau gửi Telegram để giảm race condition khi submit đồng thời từ nhiều client.
  var allInsAfter = await nocoListAllRecords(host, token, insTableId, 500);
  if (findRunningInstanceBySourcePic(allInsAfter, itemId, pic)) {
    return json(env, req, { ok: false, error: "Đã tồn tại lượt Running trùng PIC cho hạng mục này (chặn nhân bản)." }, 409);
  }

  var payload = {};
  payload[INS_COL.sourceId] = String(itemId);
  payload[INS_COL.pic] = pic;
  payload[INS_COL.pinHash] = pinHash;
  payload[INS_COL.status] = "running";
  payload[INS_COL.t1] = t1;
  payload[INS_COL.fileIdStart] = tg.file_id;

  var created = await nocoCreateRow(host, token, insTableId, payload);
  var winnerId = await dedupeRunningBySourcePic(host, token, insTableId, itemId, pic);
  return json(env, req, {
    ok: true,
    instanceId: winnerId || String(created.Id != null ? created.Id : ""),
    t1: t1,
  });
}

async function handleEndInstance(env, req) {
  var host = p3Host(env);
  var token = p3Token(env);
  var itemTableId = p3ItemTableId(env);
  var insTableId = p3InstanceTableId(env);
  var bot = String(env.TELEGRAM_BOT_TOKEN || "").trim();
  var chatId = String(env.TELEGRAM_CHAT_ID || "").trim();
  if (!host || !token || !itemTableId || !insTableId || !bot || !chatId) {
    return json(env, req, { ok: false, error: "Thiếu cấu hình Worker" }, 500);
  }

  var fd = await req.formData();
  var instanceId = String(fd.get("instanceId") || "").trim();
  var pinRaw = String(fd.get("pin") || "").trim();
  var pin = normalizePin(fd.get("pin"));
  var pinMaster = isP3MasterPin(env, pinRaw);
  var file = fd.get("image");
  if (!instanceId || !file || typeof file.arrayBuffer !== "function" || (!pin && !pinMaster)) {
    return json(env, req, { ok: false, error: "Thiếu instanceId/pin/image hoặc PIN không hợp lệ." }, 400);
  }

  var ins = await nocoGetRow(host, token, insTableId, instanceId);
  var status = String(ins[INS_COL.status] || "").toLowerCase();
  if (status !== "running") {
    return json(env, req, { ok: false, error: "Lượt này không ở trạng thái Running" }, 409);
  }

  var expectedHash = String(ins[INS_COL.pinHash] || "").trim();
  var inputHash = pin ? await hashPin(env, pin) : "";
  var pinOk = expectedHash && inputHash === expectedHash;
  if (!pinOk && !pinMaster) {
    return json(env, req, { ok: false, error: "Mật mã không khớp với người bắt đầu" }, 403);
  }

  var sourceId = String(ins[INS_COL.sourceId] || "").trim();
  if (!sourceId) return json(env, req, { ok: false, error: "Lượt này thiếu liên kết hạng mục gốc" }, 409);

  var item = await nocoGetRow(host, token, itemTableId, sourceId);
  var t1 = String(ins[INS_COL.t1] || "").trim();
  if (!t1) return json(env, req, { ok: false, error: "Thiếu Thời gian bắt đầu trong lượt" }, 409);

  var caption =
    "P3 END | Instance " +
    instanceId +
    " | PIC " +
    String(ins[INS_COL.pic] || "") +
    " | Item " +
    sourceId;
  var tg = await telegramSendPhoto(bot, chatId, file, caption);
  var t2 = new Date().toISOString();
  var ratio = computeP3Ratio(t1, t2, parseHours(item[ITEM_COL.congChuan]));
  var ratioStr = ratio == null ? "" : String(Math.round(ratio * 10000) / 10000);
  var actualH = hoursBetweenT1T2(t1, t2);
  var actualRounded = round4(actualH);

  var patch = {};
  patch[INS_COL.t2] = t2;
  patch[INS_COL.fileIdEnd] = tg.file_id;
  patch[INS_COL.tyLeP3] = ratioStr;
  patch[INS_COL.status] = "done";
  if (actualRounded != null && Number.isFinite(actualRounded)) {
    patch[INS_COL.congChuanCaNhan] = actualRounded;
  }
  try {
    await nocoPatchRow(host, token, insTableId, instanceId, patch);
  } catch (patchErr) {
    if (patch[INS_COL.congChuanCaNhan] !== undefined) {
      var p2 = Object.assign({}, patch);
      delete p2[INS_COL.congChuanCaNhan];
      await nocoPatchRow(host, token, insTableId, instanceId, p2);
    } else {
      throw patchErr;
    }
  }

  try {
    await syncItemCongChuanMoi(host, token, itemTableId, insTableId, sourceId);
  } catch (syncErr) {
    // Cột "Công chuẩn (mới)" chưa tạo trên bảng hạng mục — lượt vẫn done, chỉ không cập nhật aggregate
  }

  return json(env, req, { ok: true, t2: t2, tyLeP3: ratioStr, congChuanCaNhan: actualRounded == null ? "" : String(actualRounded) });
}

async function handleImage(env, req, url) {
  var tokenQ = url.searchParams.get("token");
  var bot = String(env.TELEGRAM_BOT_TOKEN || "").trim();
  if (!tokenQ || !bot) return new Response("Forbidden", { status: 403 });
  var fileId = await verifyImageToken(env, tokenQ);
  if (!fileId) return new Response("Forbidden", { status: 403 });
  try {
    var path = await telegramGetFilePath(bot, fileId);
    var imgUrl = "https://api.telegram.org/file/bot" + encodeURIComponent(bot) + "/" + path.replace(/^\/+/, "");
    var imgResp = await fetch(imgUrl);
    if (!imgResp.ok) return new Response("Upstream", { status: 502 });
    var headers = new Headers();
    headers.set("Content-Type", imgResp.headers.get("Content-Type") || "image/jpeg");
    headers.set("Cache-Control", "private, max-age=300");
    return new Response(imgResp.body, { status: 200, headers: headers });
  } catch (e) {
    return new Response(String(e.message || e), { status: 502 });
  }
}

export default {
  async fetch(req, env) {
    var url = new URL(req.url);
    var path = url.pathname;

    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(env, req) });
    }

    try {
      if (path === "/api/p3/health" && req.method === "GET") {
        return json(env, req, { ok: true, version: P3_WORKER_VERSION });
      }
      if (path === "/api/p3/dashboard" && req.method === "GET") {
        return await handleDashboard(env, req);
      }
      if (path === "/api/p3/instances/start" && req.method === "POST") {
        return await handleStartInstance(env, req);
      }
      if (path === "/api/p3/instances/end" && req.method === "POST") {
        return await handleEndInstance(env, req);
      }
      if (path === "/api/p3/image" && req.method === "GET") {
        return await handleImage(env, req, url);
      }
      return json(env, req, { ok: false, error: "Not found", hint: "/api/p3/health" }, 404);
    } catch (e) {
      return json(env, req, { ok: false, error: String(e.message || e) }, 500);
    }
  },
};
