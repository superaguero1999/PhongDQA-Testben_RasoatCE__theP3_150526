(function initForm15CacheService(global) {
  const { nowMs } = global.Form15Utils;

  function saveCache(cacheConfig, payload) {
    try {
      localStorage.setItem(cacheConfig.key, JSON.stringify(payload));
    } catch (_) {}
  }

  function loadCache(cacheConfig) {
    try {
      const raw = localStorage.getItem(cacheConfig.key);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.results)) return null;
      return parsed;
    } catch (_) {
      return null;
    }
  }

  function isCacheFresh(cacheConfig, cache) {
    if (!cache || !cache.savedAt) return false;
    return nowMs() - Number(cache.savedAt) <= cacheConfig.ttlMs;
  }

  function loadFileCacheMap(cacheConfig) {
    try {
      const raw = localStorage.getItem(cacheConfig.fileKey);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (_) {
      return {};
    }
  }

  function saveFileCacheMap(cacheConfig, map) {
    try {
      localStorage.setItem(cacheConfig.fileKey, JSON.stringify(map || {}));
    } catch (_) {}
  }

  function getFileCacheSignature(config) {
    return JSON.stringify({
      sheetNames: config?.sheetNames || [],
      testBenKeyword: config?.testBenKeyword || "",
      danhGiaHeaderCandidates: config?.danhGiaHeaderCandidates || [],
      excelDisplayColumns: config?.excelDisplayColumns || [],
      excelColumnHeaderCandidates: config?.excelColumnHeaderCandidates || {},
    });
  }

  function pruneFileCacheMap(cacheConfig, map, signature) {
    const ttlMs = Number(cacheConfig.fileTtlMs || 0);
    const current = nowMs();
    const nextMap = {};
    for (const [fileUrl, entry] of Object.entries(map || {})) {
      if (!entry || typeof entry !== "object") continue;
      if (signature && entry.signature !== signature) continue;
      if (!entry.savedAt) continue;
      if (ttlMs > 0 && current - Number(entry.savedAt) > ttlMs) continue;
      nextMap[fileUrl] = entry;
    }
    return nextMap;
  }

  function getFreshFileCache(cacheConfig, config, fileUrl) {
    const map = loadFileCacheMap(cacheConfig);
    const signature = getFileCacheSignature(config);
    const entry = map[fileUrl];
    if (!entry || entry.signature !== signature || !entry.savedAt) return null;
    if (Number(cacheConfig.fileTtlMs || 0) > 0 && nowMs() - Number(entry.savedAt) > cacheConfig.fileTtlMs) return null;
    if (!Array.isArray(entry.results)) return null;
    return entry;
  }

  function saveFileCache(cacheConfig, config, fileUrl, payload) {
    const signature = getFileCacheSignature(config);
    const existingMap = loadFileCacheMap(cacheConfig);
    const nextMap = pruneFileCacheMap(cacheConfig, existingMap, signature);
    nextMap[fileUrl] = {
      savedAt: nowMs(),
      signature,
      results: Array.isArray(payload?.results) ? payload.results : [],
      stats: payload?.stats && typeof payload.stats === "object" ? payload.stats : {},
    };
    saveFileCacheMap(cacheConfig, nextMap);
  }

  function clearFileCache(cacheConfig) {
    try {
      localStorage.removeItem(cacheConfig.fileKey);
    } catch (_) {}
  }

  global.Form15CacheService = {
    saveCache,
    loadCache,
    isCacheFresh,
    getFreshFileCache,
    saveFileCache,
    clearFileCache,
  };
})(window);

