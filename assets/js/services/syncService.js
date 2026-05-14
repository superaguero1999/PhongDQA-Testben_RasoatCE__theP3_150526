(function initForm15SyncService(global) {
  const { nowMs, normalizeCompact } = global.Form15Utils;

  const ROWKEY_MAP_STORAGE_KEY = "form15.sync.targetRowKeyMap.v1";
  const ROWKEY_MAP_TTL_MS = 1000 * 60 * 60 * 6;

  function safeText(v) {
    return String(v ?? "").trim();
  }

  function buildRowKey(item) {
    // Stable key to avoid duplicates across refreshes
    // Format: <fileUrl>__<sheetName>__<excelRowIndex>
    return safeText(item.fileUrl) + "__" + safeText(item.sheetName) + "__" + String(item.excelRowIndex ?? "");
  }

  function chunk(arr, size) {
    const out = [];
    const n = Math.max(1, Number(size || 50));
    for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
    return out;
  }

  function loadRowKeyMap() {
    try {
      const raw = localStorage.getItem(ROWKEY_MAP_STORAGE_KEY);
      if (!raw) return { savedAt: 0, map: {} };
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return { savedAt: 0, map: {} };
      const savedAt = Number(parsed.savedAt || 0);
      const map = parsed.map && typeof parsed.map === "object" ? parsed.map : {};
      return { savedAt, map };
    } catch (_) {
      return { savedAt: 0, map: {} };
    }
  }

  function saveRowKeyMap(savedAt, map) {
    try {
      localStorage.setItem(ROWKEY_MAP_STORAGE_KEY, JSON.stringify({ savedAt, map }));
    } catch (_) {}
  }

  function isRowKeyMapFresh(savedAt) {
    if (!savedAt) return false;
    return nowMs() - savedAt <= ROWKEY_MAP_TTL_MS;
  }

  function buildTargetRecordsBaseUrl(config) {
    const base = String(config?.syncTarget?.host || config?.nocodb?.host || "").replace(/\/+$/, "");
    const tableId = String(config?.syncTarget?.tableId || "").trim();
    if (!base || !tableId) return "";
    return base + "/api/v2/tables/" + tableId + "/records";
  }

  function buildTargetProxyUrl(config, action) {
    try {
      const proxyBase = String(config?.syncTarget?.proxyUrl || config?.nocodb?.proxyUrl || "").trim();
      if (!proxyBase) return "";
      const u = new URL(proxyBase);
      u.searchParams.set("mode", "target");
      u.searchParams.set("action", action || "list");
      return u.toString();
    } catch (_) {
      return "";
    }
  }

  async function fetchJson(url, options) {
    const resp = await fetch(url, options || {});
    const text = await resp.text();
    if (!resp.ok) {
      throw new Error("HTTP " + resp.status + " from " + url + (text ? "\n" + text.slice(0, 500) : ""));
    }
    try {
      return JSON.parse(text);
    } catch (_) {
      return text;
    }
  }

  async function listAllTargetRecords(config) {
    // We only need id + rowKey to upsert, but NocoDB returns full records; it's okay.
    const proxyUrlBase = buildTargetProxyUrl(config, "list");
    const directBase = buildTargetRecordsBaseUrl(config);
    const viewId = String(config?.syncTarget?.viewId || "").trim();
    const token = String(config?.syncTarget?.token || "").trim();
    const limit = Math.min(500, Math.max(50, Number(config?.nocodb?.limit) || 100));
    let offset = 0;
    const out = [];

    for (;;) {
      let url = "";
      let options = { method: "GET", headers: {} };
      if (proxyUrlBase) {
        const u = new URL(proxyUrlBase);
        u.searchParams.set("offset", String(offset));
        u.searchParams.set("limit", String(limit));
        if (viewId) u.searchParams.set("viewId", viewId);
        url = u.toString();
      } else if (directBase) {
        const u = new URL(directBase);
        u.searchParams.set("offset", String(offset));
        u.searchParams.set("limit", String(limit));
        u.searchParams.set("where", "");
        if (viewId) u.searchParams.set("viewId", viewId);
        url = u.toString();
        options.headers = { "xc-token": token, Accept: "application/json" };
      } else {
        throw new Error("Thiếu cấu hình syncTarget (host/tableId hoặc proxyUrl).");
      }

      const data = await fetchJson(url, options);
      const list = Array.isArray(data?.list) ? data.list : Array.isArray(data) ? data : [];
      out.push(...list);
      if (list.length < limit) break;
      offset += limit;
    }

    return out;
  }

  function buildTargetFields(config, item) {
    const tech = config?.syncTarget?.technicalColumns || {};
    const fields = {};

    // Columns the user created (titles)
    fields["Mã tác vụ"] = safeText(item.taskCode);
    fields["Tên tác vụ"] = safeText(item.taskName);
    fields["Asignee"] = safeText(item.assignee);
    fields["Ngày trả báo cáo tức thời"] = safeText(item.completionActual);
    fields["Sheet"] = safeText(item.sheetName);
    fields["Link file"] = safeText(item.fileUrl);

    const rowData = item.rowData || {};
    fields["STT"] = safeText(rowData["STT"]);
    fields["Công chuẩn"] = safeText(rowData["Công chuẩn"]);
    fields["Mã danh mục"] = safeText(rowData["Mã danh mục"]);
    fields["Hạng mục kiểm tra (Index)"] = safeText(rowData["Hạng mục kiểm tra (Index)"]);
    fields["Tiêu chuẩn (Standard)"] = safeText(rowData["Tiêu chuẩn (Standard)"]);
    fields["Công cụ (Tool)"] = safeText(rowData["Công cụ (Tool)"]);
    fields["Hướng dẫn / Phương pháp (Document)"] = safeText(rowData["Hướng dẫn / Phương pháp (Document)"]);
    fields["Đánh giá"] = safeText(item.danhGiaValue != null ? item.danhGiaValue : rowData["Đánh giá"]);

    // Technical fields (you need to create these columns in the target table)
    if (tech.rowKey) fields[tech.rowKey] = safeText(item.rowKey);
    if (tech.excelRowIndex) fields[tech.excelRowIndex] = Number(item.excelRowIndex || 0);
    if (tech.lastScannedAt) fields[tech.lastScannedAt] = new Date().toISOString();
    if (tech.syncSource) fields[tech.syncSource] = "form15-web-scan";

    return fields;
  }

  async function createTargetRecords(config, items) {
    if (!items.length) return { created: 0, records: [] };
    const proxyUrl = buildTargetProxyUrl(config, "create");
    const directBase = buildTargetRecordsBaseUrl(config);
    const token = String(config?.syncTarget?.token || "").trim();

    const payload = items.map((it) => buildTargetFields(config, it));
    if (proxyUrl) {
      const data = await fetchJson(proxyUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      return { created: items.length, records: normalizeCreatedResponse(data) };
    }

    if (!directBase) throw new Error("Thiếu cấu hình syncTarget.host/tableId để tạo record.");
    const data = await fetchJson(directBase, {
      method: "POST",
      headers: { "Content-Type": "application/json", "xc-token": token, Accept: "application/json" },
      body: JSON.stringify(payload),
    });
    return { created: items.length, records: normalizeCreatedResponse(data) };
  }

  async function updateTargetRecord(config, recordId, item) {
    const proxyUrlBase = buildTargetProxyUrl(config, "update");
    const directBase = buildTargetRecordsBaseUrl(config);
    const token = String(config?.syncTarget?.token || "").trim();

    const fields = buildTargetFields(config, item);
    // NEVER overwrite future manual fields; we only send scan fields + technical columns.

    if (proxyUrlBase) {
      const u = new URL(proxyUrlBase);
      u.searchParams.set("recordId", String(recordId));
      await fetchJson(u.toString(), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fields),
      });
      return;
    }

    if (!directBase) throw new Error("Thiếu cấu hình syncTarget.host/tableId để update record.");
    await fetchJson(directBase + "/" + encodeURIComponent(String(recordId)), {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "xc-token": token, Accept: "application/json" },
      body: JSON.stringify(fields),
    });
  }

  async function updateManyWithConcurrency(config, updates, concurrency) {
    const limit = Math.max(1, Number(concurrency || 4));
    let cursor = 0;
    const workers = Array.from({ length: Math.min(limit, updates.length) }, async () => {
      while (true) {
        const idx = cursor;
        cursor += 1;
        if (idx >= updates.length) break;
        const u = updates[idx];
        await updateTargetRecord(config, u.recordId, u.item);
      }
    });
    await Promise.all(workers);
  }

  function extractRowKeyValue(config, record) {
    const tech = config?.syncTarget?.technicalColumns || {};
    const keyName = tech.rowKey || "rowKey";
    const fields = record?.fields && typeof record.fields === "object" ? record.fields : record || {};
    return safeText(fields[keyName]);
  }

  function extractRecordId(record) {
    if (!record) return "";
    const fields = record.fields && typeof record.fields === "object" ? record.fields : {};
    return String(record.id ?? record.Id ?? record._id ?? fields.Id ?? fields.id ?? "");
  }

  function normalizeCreatedResponse(data) {
    if (Array.isArray(data?.list)) return data.list;
    if (Array.isArray(data)) return data;
    if (data && typeof data === "object" && (data.id != null || data.Id != null)) return [data];
    return [];
  }

  function buildRowKeyMapFromList(config, list) {
    const map = {};
    const rows = Array.isArray(list) ? list : [];
    for (const rec of rows) {
      const rk = extractRowKeyValue(config, rec);
      const id = extractRecordId(rec);
      if (!rk || !id) continue;
      map[normalizeCompact(rk)] = String(id);
    }
    return map;
  }

  async function refreshRowKeyMapInPlace(config, rowKeyMap) {
    const list = await listAllTargetRecords(config);
    const m = buildRowKeyMapFromList(config, list);
    for (const k of Object.keys(rowKeyMap)) delete rowKeyMap[k];
    Object.assign(rowKeyMap, m);
  }

  function tryMergeCreatedRecordsIntoMap(config, part, records, rowKeyMap) {
    if (!Array.isArray(records) || records.length !== part.length) return false;
    for (let i = 0; i < part.length; i += 1) {
      const id = extractRecordId(records[i]);
      if (!id) return false;
      rowKeyMap[normalizeCompact(part[i].rowKey)] = String(id);
    }
    return true;
  }

  async function ensureRowKeyMap(config, forceRefresh) {
    const local = loadRowKeyMap();
    if (!forceRefresh && isRowKeyMapFresh(local.savedAt) && local.map && Object.keys(local.map).length) return local.map;

    const list = await listAllTargetRecords(config);
    const map = buildRowKeyMapFromList(config, list);

    saveRowKeyMap(nowMs(), map);
    return map;
  }

  function persistSessionRowKeyMap(map) {
    if (!map || typeof map !== "object") return;
    saveRowKeyMap(nowMs(), map);
  }

  async function syncResultsToTarget(config, results, options) {
    const enabled = !!config?.syncTarget?.enabled;
    if (!enabled) return { skipped: true, reason: "syncTarget disabled" };

    const opts = options || {};
    const useSessionRowKeyMap = opts.rowKeyMap && typeof opts.rowKeyMap === "object";

    const batchSize = Math.max(1, Number(config?.syncTarget?.batchSize || 50));
    const updateConcurrency = Math.max(1, Number(config?.syncTarget?.updateConcurrency || 4));

    const items = (results || []).map((r) => {
      const rowKey = buildRowKey(r);
      return Object.assign({}, r, { rowKey });
    });

    // Build rowKey -> id map: dùng snapshot phiên (main.js) để tránh list lại bảng đích mỗi lần flush.
    const rowKeyMap = useSessionRowKeyMap ? opts.rowKeyMap : await ensureRowKeyMap(config, false);

    const toCreate = [];
    const toUpdate = [];
    for (const item of items) {
      const norm = normalizeCompact(item.rowKey);
      const recordId = rowKeyMap[norm];
      if (recordId) {
        toUpdate.push({ recordId, item });
      } else {
        toCreate.push(item);
      }
    }

    let created = 0;
    let updated = 0;
    let createErrors = 0;
    let updateErrors = 0;
    let createMergeFailed = false;

    for (const part of chunk(toCreate, batchSize)) {
      try {
        const res = await createTargetRecords(config, part);
        created += Number(res?.created || part.length);
        if (useSessionRowKeyMap && part.length) {
          const recs = Array.isArray(res.records) ? res.records : [];
          if (!recs.length) {
            createMergeFailed = true;
          } else {
            const ok = tryMergeCreatedRecordsIntoMap(config, part, recs, rowKeyMap);
            if (!ok) createMergeFailed = true;
          }
        }
      } catch (_) {
        createErrors += part.length;
      }
    }

    if (useSessionRowKeyMap && createMergeFailed && toCreate.length) {
      try {
        await refreshRowKeyMapInPlace(config, rowKeyMap);
      } catch (_) {}
    }

    if (!useSessionRowKeyMap) {
      try {
        await ensureRowKeyMap(config, true);
      } catch (_) {}
    }

    if (toUpdate.length) {
      try {
        await updateManyWithConcurrency(config, toUpdate, updateConcurrency);
        updated += toUpdate.length;
      } catch (_) {
        // If some updates fail, we count all as error (best-effort). For detailed per-record stats, we'd need finer tracking.
        updateErrors += toUpdate.length;
      }
    }

    return { skipped: false, created, updated, createErrors, updateErrors, total: items.length };
  }

  global.Form15SyncService = {
    buildRowKey,
    syncResultsToTarget,
    listAllTargetRecords,
    buildRowKeyMapFromList,
    persistSessionRowKeyMap,
  };
})(window);

