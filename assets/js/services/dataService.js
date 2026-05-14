(function initForm15DataService(global) {
  const { isSameLoose, normalizeCompact } = global.Form15Utils;

  function buildNocoDbUrl(config, apiPath, offset, limit, authMode) {
    const base = config.nocodb.host.replace(/\/+$/, "");
    const path = String(apiPath || "").startsWith("/") ? apiPath : "/" + apiPath;
    const url = new URL(base + path);
    url.searchParams.set("offset", String(offset));
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("where", "");
    if (config.nocodb.viewId) url.searchParams.set("viewId", config.nocodb.viewId);
    if (authMode === "query_xc_token") url.searchParams.set("xc_token", config.nocodb.token);
    if (authMode === "query_token") url.searchParams.set("token", config.nocodb.token);
    return url.toString();
  }

  function getApiPathCandidates(config) {
    const raw = config.nocodb.apiPathCandidates;
    if (Array.isArray(raw) && raw.length) return raw;
    return ["/api/v2/tables/mnwnhukgbu8zs9o/records"];
  }

  async function fetchWithTimeout(config, url, options) {
    const timeoutMs = Number(config.nocodb.requestTimeoutMs || 25000);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, Object.assign({}, options || {}, { signal: controller.signal }));
    } finally {
      clearTimeout(timer);
    }
  }

  function getRecordFields(record) {
    if (record && record.fields && typeof record.fields === "object") return record.fields;
    return record || {};
  }

  function getExcelFieldValue(config, fields) {
    const candidates =
      Array.isArray(config.excelFieldCandidates) && config.excelFieldCandidates.length
        ? config.excelFieldCandidates
        : [config.excelFieldId];

    for (const key of candidates) {
      if (Object.prototype.hasOwnProperty.call(fields, key)) return fields[key];
    }

    const entries = Object.entries(fields);
    for (const [fKey, fVal] of entries) {
      for (const cKey of candidates) {
        if (isSameLoose(fKey, cKey)) return fVal;
      }
    }

    if (config.excelFieldId && Object.prototype.hasOwnProperty.call(fields, config.excelFieldId)) {
      return fields[config.excelFieldId];
    }
    return undefined;
  }

  function collectExcelUrls(rawValue) {
    const urls = new Set();
    const addFromText = (text) => {
      const found = String(text || "").match(/https?:\/\/[^\s"'<>\]]+/g) || [];
      for (const u of found) urls.add(u);
    };
    const walk = (value) => {
      if (value === null || value === undefined) return;
      if (Array.isArray(value)) return value.forEach(walk);
      if (typeof value === "object") {
        for (const [k, v] of Object.entries(value)) {
          if (["url", "signedUrl", "path", "downloadUrl", "title", "name"].includes(k)) addFromText(v);
          walk(v);
        }
        return;
      }
      addFromText(value);
    };
    walk(rawValue);
    return [...urls].filter((u) => {
      const url = String(u || "").trim();
      if (!url) return false;
      if (/\.(xlsx?|xlsm|xlsb)(\?|#|$)/i.test(url)) return true;
      if (/drive\.google\.com\/uc\?/i.test(url) && /[?&]id=/i.test(url)) return true;
      if (/docs\.google\.com\/spreadsheets/i.test(url)) return true;
      return false;
    });
  }

  function getTaskMetaFromRecord(config, record) {
    const fields = getRecordFields(record);
    const entries = Object.entries(fields);
    const pickByCandidates = (candidates) => {
      for (const [key, value] of entries) {
        for (const cand of candidates) {
          if (isSameLoose(key, cand) && value != null && String(value).trim() !== "") return String(value);
        }
      }
      return "";
    };
    const taskCode = pickByCandidates(config.taskCodeCandidates) || String(record?.id || record?.Id || "");
    const taskName = pickByCandidates(config.taskNameCandidates) || "";
    const assignee = pickByCandidates(config.assigneeCandidates || []);
    const completionActual = pickByCandidates(config.completionActualCandidates || []);
    return { taskCode, taskName, assignee, completionActual };
  }

  function isTestBenValue(config, value) {
    return normalizeCompact(value).includes(normalizeCompact(config.testBenKeyword));
  }

  async function fetchAllRecordsByPath(config, apiPath, authMode) {
    const allRows = [];
    let offset = 0;
    const limit = config.nocodb.limit;
    for (;;) {
      const requestUrl = buildNocoDbUrl(config, apiPath, offset, limit, authMode);
      const headers = authMode === "header" ? { "xc-token": config.nocodb.token } : {};
      let resp;
      try {
        resp = await fetchWithTimeout(config, requestUrl, { method: "GET", headers });
      } catch (networkError) {
        const err = new Error("Khong goi duoc NocoDB.\nEndpoint dang goi: " + requestUrl + "\nAuth mode: " + authMode);
        err.cause = networkError;
        throw err;
      }
      if (!resp.ok) {
        let body = "";
        try { body = await resp.text(); } catch (_) {}
        throw new Error("NocoDB tra loi HTTP " + resp.status + ". Endpoint: " + requestUrl + "\nAuth mode: " + authMode + (body ? "\nResponse: " + body.slice(0, 300) : ""));
      }
      const data = await resp.json();
      const list = Array.isArray(data?.list) ? data.list : Array.isArray(data) ? data : [];
      allRows.push(...list);
      if (list.length < limit) break;
      offset += limit;
    }
    return allRows;
  }

  async function fetchAllRecordsViaProxy(config) {
    const allRows = [];
    let offset = 0;
    const limit = config.nocodb.limit;
    const proxyBase = String(config.nocodb.proxyUrl || "").trim();
    if (!proxyBase) throw new Error("Proxy URL trong CONFIG.nocodb.proxyUrl dang rong.");
    for (;;) {
      const url = new URL(proxyBase);
      url.searchParams.set("offset", String(offset));
      url.searchParams.set("limit", String(limit));
      if (config.nocodb.viewId) url.searchParams.set("viewId", config.nocodb.viewId);
      url.searchParams.set("tableFieldId", config.excelFieldId);
      const resp = await fetchWithTimeout(config, url.toString(), { method: "GET" });
      if (!resp.ok) {
        let body = "";
        try { body = await resp.text(); } catch (_) {}
        throw new Error("Proxy tra loi HTTP " + resp.status + ". URL: " + url.toString() + (body ? "\nResponse: " + body.slice(0, 300) : ""));
      }
      const data = await resp.json();
      const list = Array.isArray(data?.list) ? data.list : Array.isArray(data) ? data : [];
      allRows.push(...list);
      if (list.length < limit) break;
      offset += limit;
    }
    return { rows: allRows, apiPath: "proxy", authMode: "proxy" };
  }

  async function fetchAllRecords(config) {
    if (String(config.nocodb.proxyUrl || "").trim()) return fetchAllRecordsViaProxy(config);
    const candidates = getApiPathCandidates(config);
    const authModes = Array.isArray(config.nocodb.authModes) && config.nocodb.authModes.length ? config.nocodb.authModes : ["header"];
    const failedMessages = [];
    for (const apiPath of candidates) {
      for (const authMode of authModes) {
        try {
          const rows = await fetchAllRecordsByPath(config, apiPath, authMode);
          return { rows, apiPath, authMode };
        } catch (error) {
          failedMessages.push("[" + apiPath + " | " + authMode + "] " + String(error?.message || error || ""));
        }
      }
    }
    throw new Error("Khong ket noi duoc NocoDB voi tat ca endpoint da cau hinh.\n" + failedMessages.join("\n\n"));
  }

  global.Form15DataService = {
    getRecordFields,
    getExcelFieldValue,
    collectExcelUrls,
    getTaskMetaFromRecord,
    isTestBenValue,
    fetchAllRecords,
  };
})(window);

