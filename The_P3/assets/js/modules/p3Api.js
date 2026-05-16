import { P3_WORKER_BASE } from "../config.js";

function base() {
  return String(P3_WORKER_BASE || "").replace(/\/+$/, "");
}

function ensureBase() {
  var b = base();
  if (!b) throw new Error("Chưa cấu hình P3_WORKER_BASE trong assets/js/config.js");
  return b;
}

function absUrl(pathOrUrl) {
  const b = base();
  if (!b || !pathOrUrl) return "";
  try {
    return new URL(pathOrUrl, b + "/").href;
  } catch (_) {
    return b + pathOrUrl;
  }
}

function sleep(ms) {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms);
  });
}

/** Lỗi tầng mạng / trình duyệt trước khi có HTTP response */
function isLikelyNetworkFailure(err) {
  if (!err) return false;
  var name = String(err.name || "");
  var msg = String(err.message || err || "");
  if (name === "TypeError" && /fetch|network|failed|aborted|load/i.test(msg)) return true;
  if (/networkerror|failed to fetch|network request failed|load failed|aborted/i.test(msg)) return true;
  return false;
}

function mapFetchError(err) {
  if (isLikelyNetworkFailure(err)) {
    return new Error(
      "Không gọi được API Worker P3 (trình duyệt thường chặn CORS nếu Worker chưa cho phép domain GitHub Pages, hoặc mạng / máy chủ lỗi). " +
        "Hãy deploy lại Worker (file p3-worker.js mới) hoặc trong Cloudflare đặt ALLOWED_ORIGIN=* hoặc thêm đúng URL trang (vd https://superaguero1999.github.io). " +
        "Sau đó tải lại trang."
    );
  }
  return err instanceof Error ? err : new Error(String(err || "Lỗi không xác định"));
}

/**
 * GET idempotent — thử lại vài lần khi mất mạng / cold start Worker.
 */
async function fetchGetWithRetry(url, init, options) {
  var retries = Math.max(1, Math.min(6, Number((options && options.retries) || 4)));
  var baseMs = Math.max(200, Number((options && options.baseDelayMs) || 350));
  var lastErr = null;
  for (var attempt = 0; attempt < retries; attempt++) {
    try {
      var r = await fetch(url, init);
      return r;
    } catch (e) {
      lastErr = e;
      if (attempt < retries - 1 && isLikelyNetworkFailure(e)) {
        await sleep(baseMs * Math.pow(1.7, attempt));
        continue;
      }
      throw mapFetchError(lastErr);
    }
  }
  throw mapFetchError(lastErr);
}

async function jsonOrEmpty(resp) {
  return resp.json().catch(function () {
    return {};
  });
}

export async function p3FetchDashboard() {
  const b = ensureBase();
  const r = await fetchGetWithRetry(b + "/api/p3/dashboard", {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  const data = await jsonOrEmpty(r);
  if (!r.ok) throw new Error(data.error || "Lỗi tải dashboard P3");
  return data;
}

function mapP3StartError(msg) {
  const s = String(msg || "");
  if (/PIN bắt đầu|pin\/image|PIN không hợp lệ/i.test(s)) {
    return (
      "Worker P3 trên Cloudflare chưa được cập nhật (vẫn yêu cầu PIN khi bắt đầu). " +
      "Vào Cloudflare Dashboard → Workers → the-p3-kpi-worker → Deploy lại file The_P3/workers/p3-worker.js (phiên bản v10-telegram-pin-only), sau đó F5 trang."
    );
  }
  return s || "Bắt đầu thất bại";
}

export async function p3StartInstance(itemId, pic, imageFile) {
  const b = ensureBase();
  const fd = new FormData();
  fd.set("itemId", String(itemId));
  fd.set("pic", String(pic || ""));
  fd.set("image", imageFile);
  var r;
  try {
    r = await fetch(b + "/api/p3/instances/start", { method: "POST", body: fd, cache: "no-store" });
  } catch (e) {
    throw mapFetchError(e);
  }
  const data = await jsonOrEmpty(r);
  if (!r.ok) throw new Error(mapP3StartError(data.error));
  return data;
}

export async function p3EndInstance(instanceId, pin, imageFile) {
  const b = ensureBase();
  const fd = new FormData();
  fd.set("instanceId", String(instanceId));
  fd.set("pin", String(pin || ""));
  fd.set("image", imageFile);
  var r;
  try {
    r = await fetch(b + "/api/p3/instances/end", { method: "POST", body: fd, cache: "no-store" });
  } catch (e) {
    throw mapFetchError(e);
  }
  const data = await jsonOrEmpty(r);
  if (!r.ok) throw new Error(data.error || "Kết thúc thất bại");
  return data;
}

export { absUrl as p3AbsThumbUrl };
