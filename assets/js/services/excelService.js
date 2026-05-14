(function initForm15ExcelService(global) {
  const { isSameLoose, normalizeCompact } = global.Form15Utils;

  function getSheetAliasMap(config) {
    const map = new Map();
    for (const sheet of config.sheetNames) map.set(normalizeCompact(sheet), sheet);
    return map;
  }

  function findDanhGiaColumnIndex(config, headers) {
    for (let i = 0; i < headers.length; i += 1) {
      for (const candidate of config.danhGiaHeaderCandidates) {
        if (isSameLoose(headers[i], candidate)) return i;
      }
    }
    return -1;
  }

  function getSheetRange(worksheet) {
    const ref = worksheet && worksheet["!ref"];
    if (!ref) return null;
    try {
      return XLSX.utils.decode_range(ref);
    } catch (_) {
      return null;
    }
  }

  function getCellText(worksheet, rowIndex, colIndex) {
    const cell = worksheet[XLSX.utils.encode_cell({ r: rowIndex, c: colIndex })];
    if (!cell) return "";
    if (cell.w != null && String(cell.w).trim() !== "") return String(cell.w).trim();
    if (cell.v == null) return "";
    return String(cell.v).trim();
  }

  function getRowValues(worksheet, rowIndex, startCol, endCol) {
    const row = [];
    for (let colIndex = startCol; colIndex <= endCol; colIndex += 1) {
      row.push(getCellText(worksheet, rowIndex, colIndex));
    }
    return row;
  }

  function detectHeaderRow(config, worksheet, range) {
    const maxProbeRow = Math.min(range.e.r, range.s.r + 19);
    for (let rowIndex = range.s.r; rowIndex <= maxProbeRow; rowIndex += 1) {
      const headers = getRowValues(worksheet, rowIndex, range.s.c, range.e.c);
      const danhGiaColOffset = findDanhGiaColumnIndex(config, headers);
      if (danhGiaColOffset >= 0) {
        return {
          headerRowIndex: rowIndex,
          headers,
          danhGiaColIndex: range.s.c + danhGiaColOffset,
        };
      }
    }
    return null;
  }

  function buildDisplayColumnIndexByKey(config, headers) {
    const displayColumns = Array.isArray(config?.excelDisplayColumns) ? config.excelDisplayColumns : [];
    const candidatesMap = config?.excelColumnHeaderCandidates || {};
    const out = {};

    for (const key of displayColumns) {
      const candidates = Array.isArray(candidatesMap[key]) && candidatesMap[key].length ? candidatesMap[key] : [key];
      let idx = -1;
      for (let i = 0; i < headers.length; i += 1) {
        for (const cand of candidates) {
          if (isSameLoose(headers[i], cand)) {
            idx = i;
            break;
          }
        }
        if (idx >= 0) break;
      }
      out[key] = idx;
    }
    return out;
  }

  function rowToObject(config, displayColumnIndexByKey, worksheet, rowIndex) {
    const obj = {};
    const displayColumns = Array.isArray(config?.excelDisplayColumns) ? config.excelDisplayColumns : [];
    for (const key of displayColumns) {
      const idx = displayColumnIndexByKey?.[key];
      obj[key] = idx >= 0 ? getCellText(worksheet, rowIndex, idx) : "";
    }
    return obj;
  }

  function buildDriveDirectCandidates(url) {
    const out = [url];
    try {
      const u = new URL(url);
      const isGoogleDrive = /drive\.google\.com$/i.test(u.hostname);
      if (!isGoogleDrive) return out;
      const id = u.searchParams.get("id");
      if (id) {
        out.push("https://drive.usercontent.google.com/download?id=" + encodeURIComponent(id) + "&export=download");
        out.push("https://docs.google.com/uc?export=download&id=" + encodeURIComponent(id));
      }
    } catch (_) {}
    return out;
  }

  function buildGoogleSheetsDirectCandidates(url) {
    const out = [];
    try {
      const u = new URL(url);
      const isGoogleSheets = /docs\.google\.com$/i.test(u.hostname) && u.pathname.includes("/spreadsheets/");
      if (!isGoogleSheets) return out;

      // URL dang: /spreadsheets/d/<ID>/...
      const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
      const id = match && match[1] ? match[1] : "";
      if (!id) return out;

      // Export to xlsx includes all sheets => keep existing scan logic.
      out.push("https://docs.google.com/spreadsheets/d/" + id + "/export?format=xlsx");
      // Also try via "uc?export=download" style (sometimes works with different share configs).
      out.push("https://docs.google.com/spreadsheets/d/" + id + "/export?format=xlsx&download=1");
    } catch (_) {}
    return out;
  }

  function buildProxyFileUrl(config, sourceUrl) {
    try {
      const proxyBase = String(config?.nocodb?.proxyUrl || "").trim();
      if (!proxyBase) return "";
      const u = new URL(proxyBase);
      u.searchParams.set("fileUrl", sourceUrl);
      return u.toString();
    } catch (_) {
      return "";
    }
  }

  async function downloadWorkbookArrayBuffer(config, fileUrl) {
    const directCandidates = buildDriveDirectCandidates(fileUrl).concat(buildGoogleSheetsDirectCandidates(fileUrl));
    const proxyBase = String(config?.nocodb?.proxyUrl || "").trim();
    // Neu da co proxy, tranh thu link truc tiep (thuong bi CORS) => chi goi qua proxy truoc.
    let candidates = directCandidates;
    if (proxyBase) {
      candidates = [];
      for (const u of directCandidates) {
        const proxyU = buildProxyFileUrl(config, u);
        if (proxyU) candidates.push(proxyU);
      }
      if (!candidates.length) candidates = directCandidates;
    }

    // Dedupe
    candidates = Array.from(new Set(candidates));

    let lastErr = "";
    for (const candidate of candidates) {
      try {
        const response = await fetch(candidate);
        if (!response.ok) {
          lastErr = "HTTP " + response.status + " from " + candidate;
          continue;
        }
        return await response.arrayBuffer();
      } catch (err) {
        lastErr = String(err?.message || err || "");
      }
    }

    throw new Error("Khong tai duoc file Excel. " + lastErr);
  }

  async function scanWorkbook(config, dataService, fileUrl, taskMeta, globalResult, progress, scanStats) {
    const arrayBuffer = await downloadWorkbookArrayBuffer(config, fileUrl);
    const workbook = XLSX.read(arrayBuffer, {
      type: "array",
      cellStyles: false,
      sheetStubs: false,
    });
    const sheetAliasMap = getSheetAliasMap(config);

    for (const sheetName of workbook.SheetNames) {
      const canonicalSheet = sheetAliasMap.get(normalizeCompact(sheetName));
      if (!canonicalSheet) continue;

      const worksheet = workbook.Sheets[sheetName];
      const range = getSheetRange(worksheet);
      if (!range) continue;
      const headerInfo = detectHeaderRow(config, worksheet, range);
      if (!headerInfo) {
        if (scanStats) scanStats.sheetsMissingDanhGia += 1;
        continue;
      }

      const headers = headerInfo.headers;
      const danhGiaColIndex = headerInfo.danhGiaColIndex;
      const rowStart = headerInfo.headerRowIndex + 1;
      if (scanStats) scanStats.sheetsMatched += 1;

      const displayColumnIndexByKey = buildDisplayColumnIndexByKey(config, headers);
      for (let rowIndex = rowStart; rowIndex <= range.e.r; rowIndex += 1) {
        const danhGiaValue = getCellText(worksheet, rowIndex, danhGiaColIndex);
        if (!dataService.isTestBenValue(config, danhGiaValue)) continue;
        const excelRowIndex = rowIndex + 1; // 1-based (Excel style)
        globalResult.push({
          taskCode: taskMeta.taskCode,
          taskName: taskMeta.taskName,
          assignee: taskMeta.assignee || "",
          completionActual: taskMeta.completionActual || "",
          sheetName: canonicalSheet,
          sourceSheetName: sheetName,
          fileUrl,
          excelRowIndex,
          danhGiaValue: getCellText(worksheet, rowIndex, danhGiaColIndex),
          rowData: rowToObject(config, displayColumnIndexByKey, worksheet, rowIndex),
        });
        if (scanStats) scanStats.matchedRows += 1;
      }
    }
    if (typeof progress === "function") progress();
  }

  global.Form15ExcelService = {
    scanWorkbook,
  };
})(window);

