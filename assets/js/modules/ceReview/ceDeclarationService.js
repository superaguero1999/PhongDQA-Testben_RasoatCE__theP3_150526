/**
 * Đồng bộ tab «Rà soát CE» với bảng CE trên NocoDB qua Worker (`/ce/snapshot.json`, `/ce/upsert`).
 * Tách riêng khỏi ceReviewService để dễ bảo trì và không ảnh hưởng luồng Test bền.
 */
(function initForm15CeDeclarationService(global) {
  const dataService = global.Form15DataService;

  function normalizeIsoTimestamp(raw) {
    const s = String(raw ?? "").trim();
    if (!s) return "";
    const isoish = s.replace(/^(\d{4}-\d{2}-\d{2})\s+(\d)/, "$1T$2");
    let ms = Date.parse(isoish);
    if (Number.isNaN(ms)) ms = Date.parse(s);
    if (!Number.isNaN(ms)) return new Date(ms).toISOString();
    const dmy = /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})(?:[\sT](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(s);
    if (dmy) {
      const d = new Date(
        Number(dmy[3]),
        Number(dmy[2]) - 1,
        Number(dmy[1]),
        Number(dmy[4] || 0),
        Number(dmy[5] || 0),
        Number(dmy[6] || 0)
      );
      if (!Number.isNaN(d.getTime())) return d.toISOString();
    }
    return "";
  }

  function getRecordFields(rec) {
    // Snapshot CE từ Worker/NocoDB thường có shape { fields: {...}, Id: ... }.
    // Ưu tiên dùng rec.fields để tránh dataService.getRecordFields (thiết kế cho bảng đích) làm lệch key.
    if (rec && rec.fields && typeof rec.fields === "object") return rec.fields;
    // NocoDB cũng có thể trả record dạng phẳng (các cột ở top-level)
    if (rec && typeof rec === "object" && (rec["Source Record Id"] != null || rec.Id != null || rec.id != null)) return rec;
    if (dataService && typeof dataService.getRecordFields === "function") return dataService.getRecordFields(rec);
    return rec || {};
  }

  function ceTableFieldNames(ceCfg) {
    const def = {
      sourceRecordId: "Source Record Id",
      trangThaiKhaiBaoCe: "Trạng thái khai báo CE",
      lichSuThayDoiTrangThai: "Lịch sử thay đổi - Trạng thái",
      ghiChu: "Ghi chú",
      koiKhaiBaoCeLink: "Link KOI - khai báo CE",
      lichSuKhaiBaoCeAt: "Lịch sử khai báo CE",
      trangThaiGiaoMau: "Trạng thái giao mẫu",
      linkKoiKhaiBaoGiaoMau: "Link KOI - Khai báo Giao mẫu",
      ghiChuGiaoMau: "Ghi chú giao mẫu",
      lichSuKhaiBaoGiaoMauAt: "Lịch sử khai báo giao mẫu",
      linkBcExcel: "Link BCexcel",
      jiraLinkRequest: "JiraLinkRequest",
      maKoi: "Mã KOI",
    };
    return Object.assign({}, def, (ceCfg && ceCfg.ceTableFieldNames) || {});
  }

  function isConfigured(ceCfg) {
    const dw = ceCfg && ceCfg.declarationWorker;
    if (!dw || typeof dw !== "object") return false;
    const dataUrl = String(dw.snapshotDataUrl || "").trim();
    const upsertUrl = String(dw.upsertUrl || "").trim();
    return !!(dataUrl && upsertUrl);
  }

  function numericRowId(rec) {
    const id = rec && (rec.Id ?? rec.id);
    const fields = rec && rec.fields;
    const n = Number(id ?? (fields && (fields.Id ?? fields.id)));
    return Number.isFinite(n) ? n : 0;
  }

  /**
   * Convert CE snapshot records → map keyed by Source Record Id.
   * Nếu NocoDB có nhiều dòng trùng Source Record Id (chưa bật Unique), ưu tiên bản có Id lớn hơn.
   */
  function declarationRecordsToMap(rawRecords, ceCfg) {
    const fn = ceTableFieldNames(ceCfg);
    const srcKey = fn.sourceRecordId;
    const map = Object.create(null);
    const list = Array.isArray(rawRecords) ? rawRecords.slice() : [];
    list.sort(function (a, b) {
      return numericRowId(b) - numericRowId(a);
    });
    for (let i = 0; i < list.length; i += 1) {
      const fields = getRecordFields(list[i]);
      const sid = String(fields[srcKey] ?? "").trim();
      if (!sid || map[sid]) continue;
      const histRaw = String(fields[fn.lichSuThayDoiTrangThai] ?? "").trim();
      const histLines = histRaw ? histRaw.split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean) : [];
      map[sid] = {
        trangThaiKhaiBaoCe: String(fields[fn.trangThaiKhaiBaoCe] ?? "").trim(),
        ghiChu: fields[fn.ghiChu] != null ? String(fields[fn.ghiChu]) : "",
        koiKhaiBaoCeLink: String(fields[fn.koiKhaiBaoCeLink] ?? "").trim(),
        lichSuKhaiBaoCeRaw: fields[fn.lichSuKhaiBaoCeAt],
        trangThaiGiaoMau: String(fields[fn.trangThaiGiaoMau] ?? "").trim(),
        linkKoiKhaiBaoGiaoMau: String(fields[fn.linkKoiKhaiBaoGiaoMau] ?? "").trim(),
        ghiChuGiaoMau: fields[fn.ghiChuGiaoMau] != null ? String(fields[fn.ghiChuGiaoMau]) : "",
        lichSuKhaiBaoGiaoMauRaw: fields[fn.lichSuKhaiBaoGiaoMauAt],
        linkBcExcel: String(fields[fn.linkBcExcel] ?? "").trim(),
        jiraLinkRequest: String(fields[fn.jiraLinkRequest] ?? "").trim(),
        maKoi: String(fields[fn.maKoi] ?? "").trim(),
        trangThaiCeManualHistory: histLines,
      };
    }
    return map;
  }

  /**
   * Ghép state đã lưu trên bảng CE vào row đã map từ bảng đích.
   * Khi có «Trạng thái cũ» (CE rà soát): không ghi đè trạng thái/ghi chú/timestamp nguồn;
   * vẫn nhận lịch sử đổi tay + link KOI (nếu có trên bảng CE).
   */
  function mergeDeclarationsIntoRows(rows, declMap, ceCfg) {
    const list = Array.isArray(rows) ? rows : [];
    if (!declMap || typeof declMap !== "object") return list.slice();

    return list.map(function (r) {
      const sid = String(r.sourceRecordId || "").trim();
      const decl = sid ? declMap[sid] : null;
      if (!decl) return r;

      const hasLegacy = String(r.ceRaSoatTruoc || "").trim() !== "";
      const merged = Object.assign({}, r);

      if (Array.isArray(decl.trangThaiCeManualHistory) && decl.trangThaiCeManualHistory.length) {
        merged.trangThaiCeManualHistory = decl.trangThaiCeManualHistory.slice();
      }

      if (hasLegacy) {
        // Ưu tiên 1: luôn lấy theo «Trạng thái cũ» khi cột này có dữ liệu.
        merged.trangThaiCe = String(merged.ceRaSoatTruoc || "").trim();
        // Các cột lưu trên bảng CE: luôn lấy từ snapshot CE (kể cả chuỗi rỗng), không fallback về cột đích.
        // Tránh falsy (`""`) làm giữ nhầm link/ghi chú cũ từ «bảng đích» sau Refresh.
        if (decl.ghiChu !== undefined) merged.ghiChu = decl.ghiChu;
        merged.koiKhaiBaoCeLink = String(decl.koiKhaiBaoCeLink ?? "").trim();
        if (decl.trangThaiGiaoMau) merged.trangThaiGiaoMau = decl.trangThaiGiaoMau;
        merged.linkKoiKhaiBaoGiaoMau = String(decl.linkKoiKhaiBaoGiaoMau ?? "").trim();
        if (decl.ghiChuGiaoMau !== undefined) merged.ghiChuGiaoMau = decl.ghiChuGiaoMau;
        merged.linkBcExcel = String(decl.linkBcExcel ?? "").trim();
        merged.jiraLinkRequest = String(decl.jiraLinkRequest ?? "").trim();
        merged.maKoi = String(decl.maKoi ?? "").trim();
        const iso = normalizeIsoTimestamp(decl.lichSuKhaiBaoCeRaw);
        if (iso) merged.lichSuKhaiBaoCeAt = iso;
        const isoGiaoMau = normalizeIsoTimestamp(decl.lichSuKhaiBaoGiaoMauRaw);
        if (isoGiaoMau) merged.lichSuKhaiBaoGiaoMauAt = isoGiaoMau;
        return merged;
      }

      if (decl.trangThaiKhaiBaoCe) merged.trangThaiCe = decl.trangThaiKhaiBaoCe;
      if (decl.ghiChu !== undefined) merged.ghiChu = decl.ghiChu;
      merged.koiKhaiBaoCeLink = String(decl.koiKhaiBaoCeLink ?? "").trim();
      if (decl.trangThaiGiaoMau) merged.trangThaiGiaoMau = decl.trangThaiGiaoMau;
      merged.linkKoiKhaiBaoGiaoMau = String(decl.linkKoiKhaiBaoGiaoMau ?? "").trim();
      if (decl.ghiChuGiaoMau !== undefined) merged.ghiChuGiaoMau = decl.ghiChuGiaoMau;
      merged.linkBcExcel = String(decl.linkBcExcel ?? "").trim();
      merged.jiraLinkRequest = String(decl.jiraLinkRequest ?? "").trim();
      merged.maKoi = String(decl.maKoi ?? "").trim();

      const iso = normalizeIsoTimestamp(decl.lichSuKhaiBaoCeRaw);
      if (iso) merged.lichSuKhaiBaoCeAt = iso;
      const isoGiaoMau = normalizeIsoTimestamp(decl.lichSuKhaiBaoGiaoMauRaw);
      if (isoGiaoMau) merged.lichSuKhaiBaoGiaoMauAt = isoGiaoMau;

      return merged;
    });
  }

  function requestTimeoutMs(ceCfg) {
    const dw = (ceCfg && ceCfg.declarationWorker) || {};
    const root = global.Form15Config && global.Form15Config.CONFIG;
    return Number(dw.requestTimeoutMs || (root && root.nocodb && root.nocodb.requestTimeoutMs) || 25000);
  }

  async function fetchDeclarationSnapshot(ceCfg) {
    const dw = (ceCfg && ceCfg.declarationWorker) || {};
    const urlRaw = String(dw.snapshotDataUrl || "").trim();
    if (!urlRaw) return { records: [], skipped: true };
    const baseUrl = (() => {
      try { return new URL(urlRaw, global.location && global.location.href ? global.location.href : undefined); }
      catch (_) { return null; }
    })();

    function withFresh(u) {
      const x = new URL(u.toString());
      x.searchParams.set("fresh", "1");
      x.searchParams.set("_ts", String(Date.now()));
      return x.toString();
    }

    async function getJson(url, timeoutMs) {
      const controller = new AbortController();
      const timer = setTimeout(function () { controller.abort(); }, timeoutMs);
      try {
        const resp = await fetch(url, { method: "GET", cache: "no-store", signal: controller.signal });
        let text = "";
        try { text = await resp.text(); } catch (_) {}
        let data = null;
        try { data = text ? JSON.parse(text) : null; } catch (_) { data = null; }
        if (!resp.ok) {
          throw new Error("CE snapshot HTTP " + resp.status + (text ? ": " + text.slice(0, 220) : ""));
        }
        return data || {};
      } finally {
        clearTimeout(timer);
      }
    }

    // Ưu tiên fresh để đúng dữ liệu, nhưng nếu Worker/NocoDB chậm thì fallback sang cache (không fresh)
    // để tránh UI bị 0 dòng + tránh abort.
    const t0 = requestTimeoutMs(ceCfg);
    const freshTimeoutMs = Math.max(12000, Math.min(25000, Number(dw.freshSnapshotTimeoutMs || 18000)));
    const cacheTimeoutMs = Math.max(freshTimeoutMs, Math.min(120000, Number(dw.cacheSnapshotTimeoutMs || t0 || 40000)));

    let data = null;
    if (baseUrl) {
      try {
        data = await getJson(withFresh(baseUrl), freshTimeoutMs);
      } catch (eFresh) {
        data = await getJson(baseUrl.toString(), cacheTimeoutMs);
      }
    } else {
      data = await getJson(urlRaw, cacheTimeoutMs);
    }

    const records = Array.isArray(data.records)
      ? data.records
      : Array.isArray(data.list)
        ? data.list
        : [];
    return { records: records, builtAt: data.builtAt || "", skipped: false };
  }

  /**
   * Payload gửi Worker `/ce/upsert`: object flat key = đúng tên cột NocoDB.
   * Khi có «Trạng thái cũ»: không gửi Trạng thái khai báo CE / Ghi chú (tránh ghi đè nguồn đích).
   */
  function buildUpsertFieldsPayload(row, ceCfg) {
    const fn = ceTableFieldNames(ceCfg);
    const hasLegacy = String(row.ceRaSoatTruoc || "").trim() !== "";
    const hist = Array.isArray(row.trangThaiCeManualHistory)
      ? row.trangThaiCeManualHistory.join("\n")
      : "";

    const out = Object.create(null);
    out[fn.sourceRecordId] = String(row.sourceRecordId || "").trim();
    if (fn.taskCode) out[fn.taskCode] = String(row.taskCode || "").trim();
    if (fn.taskName) out[fn.taskName] = String(row.taskName || "").trim();
    if (fn.ma) out[fn.ma] = String(row.ma || "").trim();
    if (fn.assignee) out[fn.assignee] = String(row.assignee || "").trim();
    if (fn.completionActual) out[fn.completionActual] = String(row.completionActual || "").trim();
    if (fn.reportCode) out[fn.reportCode] = String(row.reportCode || "").trim();
    if (fn.linkBcExcel) out[fn.linkBcExcel] = String(row.linkBcExcel || "").trim();
    if (fn.jiraLinkRequest) out[fn.jiraLinkRequest] = String(row.jiraLinkRequest || "").trim();
    if (fn.maKoi) out[fn.maKoi] = String(row.maKoi || "").trim();
    if (fn.ketLuan) out[fn.ketLuan] = String(row.ketLuan || "").trim();
    if (fn.ketLuanTrangBia) out[fn.ketLuanTrangBia] = String(row.ketLuanTrangBia || "").trim();
    if (fn.ketQua) out[fn.ketQua] = String(row.ketQua || "").trim();
    if (fn.ceRaSoatTruoc) out[fn.ceRaSoatTruoc] = String(row.ceRaSoatTruoc || "").trim();
    out[fn.lichSuThayDoiTrangThai] = hist;

    if (hasLegacy) {
      // Ưu tiên 1: khi có «Trạng thái cũ» thì lưu theo đúng giá trị này.
      out[fn.trangThaiKhaiBaoCe] = String(row.ceRaSoatTruoc || "").trim();
      out[fn.ghiChu] = String(row.ghiChu || "");
    } else {
      out[fn.trangThaiKhaiBaoCe] = String(row.trangThaiCe || "").trim();
      out[fn.ghiChu] = String(row.ghiChu || "");
    }

    out[fn.koiKhaiBaoCeLink] = String(row.koiKhaiBaoCeLink || "").trim();
    out[fn.trangThaiGiaoMau] = String(row.trangThaiGiaoMau || "").trim() || "Chưa gửi";
    out[fn.linkKoiKhaiBaoGiaoMau] = String(row.linkKoiKhaiBaoGiaoMau || "").trim();
    out[fn.ghiChuGiaoMau] = String(row.ghiChuGiaoMau || "");

    const iso = String(row.lichSuKhaiBaoCeAt || "").trim();
    if (iso) {
      out[fn.lichSuKhaiBaoCeAt] = iso;
    } else if (!hasLegacy) {
      out[fn.lichSuKhaiBaoCeAt] = "";
    }
    const isoGiaoMau = String(row.lichSuKhaiBaoGiaoMauAt || "").trim();
    out[fn.lichSuKhaiBaoGiaoMauAt] = isoGiaoMau || "";

    return out;
  }

  async function upsertDeclaration(ceCfg, row, opts) {
    const dw = (ceCfg && ceCfg.declarationWorker) || {};
    const upsertUrl = String(dw.upsertUrl || "").trim();
    if (!upsertUrl || !row) return { skipped: true };

    const payload = buildUpsertFieldsPayload(row, ceCfg);
    const ownerId = String(opts && opts.ownerId || "").trim();
    const scanMode = !!(opts && opts.scanMode);
    const timeoutMs = requestTimeoutMs(ceCfg);
    const controller = new AbortController();
    const timer = setTimeout(function () { controller.abort(); }, timeoutMs);

    try {
      const headers = { "Content-Type": "application/json", Accept: "application/json" };
      if (ownerId) headers["X-CE-Owner-Id"] = ownerId;
      if (scanMode) headers["X-CE-Scan-Mode"] = "1";
      const resp = await fetch(upsertUrl, {
        method: "POST",
        headers: headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      if (!resp.ok) {
        let body = "";
        try { body = await resp.text(); } catch (_) {}
        let parsed = null;
        try { parsed = body ? JSON.parse(body) : null; } catch (_) { parsed = null; }
        if (parsed && parsed.error === "LOCKED_BY_SCAN") {
          throw new Error("Máy khác đang Quét lại từ đầu. Tạm khóa ghi CE.");
        }
        throw new Error("CE upsert HTTP " + resp.status + (body ? ": " + body.slice(0, 280) : ""));
      }
      let json = null;
      try {
        json = await resp.json();
      } catch (_) {}
      if (json && json.skipped && json.reason === "DIRTY_DURING_SCAN") {
        return Object.assign({ ok: true }, json);
      }
      return json || { ok: true };
    } finally {
      clearTimeout(timer);
    }
  }

  async function rebuildAllDeclarations(ceCfg, rows) {
    const dw = (ceCfg && ceCfg.declarationWorker) || {};
    const upsertUrl = String(dw.upsertUrl || "").trim();
    const rebuildUrl = String(dw.rebuildUrl || "").trim() || (upsertUrl ? upsertUrl.replace(/\/upsert$/, "/rebuild") : "");
    if (!rebuildUrl) return { skipped: true };
    const list = Array.isArray(rows) ? rows : [];
    const payloadRows = list.map(function (r) { return buildUpsertFieldsPayload(r, ceCfg); });
    const timeoutMs = Number(dw.rebuildTimeoutMs || 300000);
    const controller = new AbortController();
    const timer = setTimeout(function () { controller.abort(); }, timeoutMs);
    try {
      const resp = await fetch(rebuildUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ rows: payloadRows }),
        signal: controller.signal,
      });
      if (!resp.ok) {
        let body = "";
        try { body = await resp.text(); } catch (_) {}
        if (resp.status === 404 || resp.status === 405) {
          return { ok: false, fallbackToUpsert: true, status: resp.status, detail: body };
        }
        throw new Error("CE rebuild HTTP " + resp.status + (body ? ": " + body.slice(0, 280) : ""));
      }
      let json = null;
      try { json = await resp.json(); } catch (_) {}
      return json || { ok: true, mode: "rebuild" };
    } finally {
      clearTimeout(timer);
    }
  }

  async function rebuildAllDeclarationsBySteps(ceCfg, rows, onProgress) {
    const dw = (ceCfg && ceCfg.declarationWorker) || {};
    const upsertUrl = String(dw.upsertUrl || "").trim();
    const base = upsertUrl ? upsertUrl.replace(/\/upsert$/, "") : "";
    const startUrl = base ? base + "/rebuild/start" : "";
    const stepUrl = base ? base + "/rebuild/step" : "";
    if (!startUrl || !stepUrl) return { skipped: true };
    const list = Array.isArray(rows) ? rows : [];
    const payloadRows = list.map(function (r) { return buildUpsertFieldsPayload(r, ceCfg); });
    const timeoutMs = Number(dw.rebuildTimeoutMs || 120000);

    async function postJson(url, body) {
      const controller = new AbortController();
      const timer = setTimeout(function () { controller.abort(); }, timeoutMs);
      try {
        const resp = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify(body || {}),
          signal: controller.signal,
        });
        let text = "";
        try { text = await resp.text(); } catch (_) {}
        let json = null;
        try { json = text ? JSON.parse(text) : null; } catch (_) { json = null; }
        if (!resp.ok) {
          if (resp.status === 404 || resp.status === 405) return { fallbackToUpsert: true, status: resp.status, detail: text };
          throw new Error("CE rebuild-step HTTP " + resp.status + (text ? ": " + text.slice(0, 280) : ""));
        }
        return json || { ok: true };
      } finally {
        clearTimeout(timer);
      }
    }

    const started = await postJson(startUrl, { rows: payloadRows });
    if (started && started.fallbackToUpsert) return started;
    let last = started || {};
    for (let i = 0; i < 2000; i += 1) {
      const step = await postJson(stepUrl, { jobId: started && started.jobId });
      if (step && step.fallbackToUpsert) return step;
      last = step || {};
      if (typeof onProgress === "function") onProgress(last);
      if (last.done) break;
    }
    return last;
  }

  async function rebuildAllDeclarationsByChunks(ceCfg, rows, onProgress) {
    const dw = (ceCfg && ceCfg.declarationWorker) || {};
    const upsertUrl = String(dw.upsertUrl || "").trim();
    const base = upsertUrl ? upsertUrl.replace(/\/upsert$/, "") : "";
    const chunkUrl = base ? base + "/rebuild/chunk" : "";
    if (!chunkUrl) return { skipped: true };

    const list = Array.isArray(rows) ? rows : [];
    const payloadRows = list.map(function (r) { return buildUpsertFieldsPayload(r, ceCfg); });
    const chunkSize = Math.min(100, Math.max(20, Number(dw.rebuildChunkSize || 100)));
    const timeoutMs = Number(dw.rebuildTimeoutMs || 120000);
    let created = 0;
    let deleted = 0;
    let snapshotBuiltAt = "";

    async function postChunk(body) {
      const controller = new AbortController();
      const timer = setTimeout(function () { controller.abort(); }, timeoutMs);
      try {
        const resp = await fetch(chunkUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        let text = "";
        try { text = await resp.text(); } catch (_) {}
        let json = null;
        try { json = text ? JSON.parse(text) : null; } catch (_) { json = null; }
        if (!resp.ok) {
          throw new Error("CE rebuild-chunk HTTP " + resp.status + (text ? ": " + text.slice(0, 280) : ""));
        }
        return json || { ok: true };
      } finally {
        clearTimeout(timer);
      }
    }

    let index = 0;
    let chunkNo = 0;
    const totalChunks = Math.max(1, Math.ceil(payloadRows.length / chunkSize));
    while (index < payloadRows.length) {
      const chunk = payloadRows.slice(index, index + chunkSize);
      const isFirst = index === 0;
      const isLast = index + chunkSize >= payloadRows.length;
      const res = await postChunk({
        rows: chunk,
        reset: isFirst,
        finalize: isLast,
      });
      created += Number(res && res.created || 0);
      deleted += Number(res && res.deleted || 0);
      snapshotBuiltAt = String(res && res.snapshotBuiltAt || snapshotBuiltAt || "");
      chunkNo += 1;
      if (typeof onProgress === "function") {
        onProgress({
          phase: isLast ? "finalize" : "create",
          progress: String(chunkNo) + "/" + String(totalChunks),
          created: created,
          deleted: deleted,
        });
      }
      index += chunkSize;
    }
    return {
      ok: true,
      done: true,
      created: created,
      deleted: deleted,
      inputRows: payloadRows.length,
      snapshotBuiltAt: snapshotBuiltAt,
    };
  }

  global.Form15CeDeclarationService = {
    isConfigured,
    ceTableFieldNames,
    declarationRecordsToMap,
    mergeDeclarationsIntoRows,
    fetchDeclarationSnapshot,
    buildUpsertFieldsPayload,
    upsertDeclaration,
    rebuildAllDeclarations,
    rebuildAllDeclarationsBySteps,
    rebuildAllDeclarationsByChunks,
    normalizeIsoTimestamp,
  };
})(window);
