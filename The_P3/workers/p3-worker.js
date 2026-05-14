export default {
  async fetch(request, env, ctx) {
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,PATCH,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type,Authorization,xc-token,x-auto-publish-secret",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const host = (env.NOCO_HOST || "").replace(/\/+$/, "");
    const tableId = (env.NOCO_TABLE_ID || "").trim();
    const recordsUrl = (env.NOCO_RECORDS_URL || "").trim();
    const token = (env.NOCO_TOKEN || "").trim();

    const targetHost = (env.TARGET_NOCO_HOST || host || "").replace(/\/+$/, "");
    const targetTableId = (env.TARGET_NOCO_TABLE_ID || "").trim();
    const targetRecordsUrl = (env.TARGET_NOCO_RECORDS_URL || "").trim();
    const targetToken = (env.TARGET_NOCO_TOKEN || "").trim();

    const reqUrl = new URL(request.url);

    // ===== Lock + Publish endpoints =====
    if (request.method === "POST" && reqUrl.pathname === "/snapshot/lock/acquire") {
      return handleLockAcquire(request, env, corsHeaders);
    }
    if (request.method === "POST" && reqUrl.pathname === "/snapshot/lock/heartbeat") {
      return handleLockHeartbeat(request, env, corsHeaders);
    }
    if (request.method === "POST" && reqUrl.pathname === "/snapshot/lock/release") {
      return handleLockRelease(request, env, corsHeaders);
    }
    if (request.method === "POST" && reqUrl.pathname === "/snapshot/publish") {
      return handleSnapshotPublish(request, env, ctx, corsHeaders, reqUrl);
    }
    if (request.method === "POST" && reqUrl.pathname === "/snapshot/publish/auto") {
      return handleSnapshotPublishAuto(request, env, ctx, corsHeaders, reqUrl);
    }
    // ===== End Lock + Publish endpoints =====

    // ===== Snapshot endpoints =====
    if (request.method === "GET" && reqUrl.pathname === "/snapshot.json") {
      try {
        const fromStore = await readPublishedSnapshotFromStore(env);
        if (fromStore) {
          return new Response(JSON.stringify(fromStore), {
            status: 200,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json; charset=utf-8",
              "Cache-Control": `public, max-age=${getDataTtlSec(env)}`,
            },
          });
        }
      } catch (_) {}

      if ((!targetRecordsUrl && (!targetHost || !targetTableId)) || !targetToken) {
        return json(
          {
            error:
              "Missing target env vars for snapshot. Required: TARGET_NOCO_TOKEN and either TARGET_NOCO_RECORDS_URL or (TARGET_NOCO_HOST + TARGET_NOCO_TABLE_ID).",
          },
          500,
          corsHeaders
        );
      }

      const forceRefresh = reqUrl.searchParams.get("refresh") === "1";
      const snapshot = await getOrBuildFinalSnapshot({
        reqUrl,
        env,
        ctx,
        corsHeaders,
        forceRefresh,
        host: targetHost,
        tableId: targetTableId,
        recordsUrl: targetRecordsUrl,
        token: targetToken,
      });

      return new Response(JSON.stringify(snapshot), {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": `public, max-age=${getDataTtlSec(env)}`,
        },
      });
    }

    if (request.method === "GET" && reqUrl.pathname === "/snapshot.meta.json") {
      try {
        const fromStore = await readPublishedSnapshotMetaFromStore(env, reqUrl.origin);
        if (fromStore) {
          return new Response(JSON.stringify(fromStore), {
            status: 200,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json; charset=utf-8",
              "Cache-Control": `public, max-age=${getMetaTtlSec(env)}`,
            },
          });
        }
      } catch (_) {}

      if ((!targetRecordsUrl && (!targetHost || !targetTableId)) || !targetToken) {
        return json(
          {
            error:
              "Missing target env vars for snapshot meta. Required: TARGET_NOCO_TOKEN and either TARGET_NOCO_RECORDS_URL or (TARGET_NOCO_HOST + TARGET_NOCO_TABLE_ID).",
          },
          500,
          corsHeaders
        );
      }

      const forceRefresh = reqUrl.searchParams.get("refresh") === "1";
      const snapshot = await getOrBuildFinalSnapshot({
        reqUrl,
        env,
        ctx,
        corsHeaders,
        forceRefresh,
        host: targetHost,
        tableId: targetTableId,
        recordsUrl: targetRecordsUrl,
        token: targetToken,
      });

      const meta = {
        version: snapshot.snapshotVersion,
        builtAt: snapshot.builtAt,
        hash: snapshot.hash,
        rowsCount: snapshot.rowsCount,
        dataUrl: reqUrl.origin + "/snapshot.json",
        snapshotReady: true,
        excelFilesScannedTotal: Number(snapshot.excelFilesScannedTotal || 0),
        excelFilesErrorTotal: Number(snapshot.excelFilesErrorTotal || 0),
        excelFilesOkWithTestBen: Number(snapshot.excelFilesOkWithTestBen || 0),
        nocoSourceRecordsTotal: Number(snapshot.nocoSourceRecordsTotal || 0),
      };

      return new Response(JSON.stringify(meta), {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": `public, max-age=${getMetaTtlSec(env)}`,
        },
      });
    }
    // ===== End Snapshot endpoints =====

    if ((!recordsUrl && (!host || !tableId)) || !token) {
      return json(
        {
          error:
            "Missing env vars. Required: NOCO_TOKEN and either NOCO_RECORDS_URL or (NOCO_HOST + NOCO_TABLE_ID).",
        },
        500,
        corsHeaders
      );
    }

    const fileUrl = reqUrl.searchParams.get("fileUrl") || "";
    const mode = (reqUrl.searchParams.get("mode") || "").trim();
    const action = (reqUrl.searchParams.get("action") || "").trim();

    // Proxy binary file
    if (fileUrl) {
      try {
        const upstream = await fetch(fileUrl, { method: "GET" });
        if (!upstream.ok) {
          return json(
            { error: "File proxy failed", detail: `HTTP ${upstream.status} from ${fileUrl}` },
            502,
            corsHeaders
          );
        }
        const contentType = upstream.headers.get("content-type") || "application/octet-stream";
        return new Response(upstream.body, {
          status: 200,
          headers: {
            ...corsHeaders,
            "Content-Type": contentType,
            "Cache-Control": "no-store",
          },
        });
      } catch (err) {
        return json(
          { error: "File proxy fetch error", detail: String(err?.message || err || "") },
          502,
          corsHeaders
        );
      }
    }

    // Target table proxy
    if (mode === "target") {
      if ((!targetRecordsUrl && (!targetHost || !targetTableId)) || !targetToken) {
        return json(
          {
            error:
              "Missing target env vars. Required: TARGET_NOCO_TOKEN and either TARGET_NOCO_RECORDS_URL or (TARGET_NOCO_HOST + TARGET_NOCO_TABLE_ID).",
          },
          500,
          corsHeaders
        );
      }

      const baseEndpoint = targetRecordsUrl || `${targetHost}/api/v2/tables/${targetTableId}/records`;

      if (request.method === "GET") {
        const offset = reqUrl.searchParams.get("offset") || "0";
        const limit = reqUrl.searchParams.get("limit") || "100";
        const viewId = reqUrl.searchParams.get("viewId") || "";
        const where = reqUrl.searchParams.get("where") || "";

        const target = new URL(baseEndpoint);
        target.searchParams.set("offset", offset);
        target.searchParams.set("limit", limit);
        target.searchParams.set("where", where);
        if (viewId) target.searchParams.set("viewId", viewId);

        const upstream = await fetch(target.toString(), {
          method: "GET",
          headers: {
            "xc-token": targetToken,
            "xc-auth": targetToken,
            Accept: "application/json",
          },
        });
        const body = await upstream.text();
        if (!upstream.ok) {
          return json(
            { error: "Target list failed", detail: `HTTP ${upstream.status}: ${body.slice(0, 500)}` },
            502,
            corsHeaders
          );
        }
        return new Response(body, {
          status: 200,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store",
          },
        });
      }

      if (request.method === "POST" && (action === "create" || !action)) {
        const raw = await request.text();
        const upstream = await fetch(baseEndpoint, {
          method: "POST",
          headers: {
            "xc-token": targetToken,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: raw,
        });
        const body = await upstream.text();
        if (!upstream.ok) {
          return json(
            { error: "Target create failed", detail: `HTTP ${upstream.status}: ${body.slice(0, 500)}` },
            502,
            corsHeaders
          );
        }
        return new Response(body, {
          status: 200,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store",
          },
        });
      }

      if (request.method === "PATCH" && action === "update") {
        const recordId = reqUrl.searchParams.get("recordId") || "";
        if (!recordId) return json({ error: "Missing recordId for update" }, 400, corsHeaders);

        const raw = await request.text();
        let parsed = {};
        try {
          parsed = JSON.parse(raw || "{}");
        } catch (_) {}

        const idNum = Number(recordId);
        const idValue = Number.isFinite(idNum) ? idNum : recordId;
        const patchObj = Object.assign({ Id: idValue }, parsed && typeof parsed === "object" ? parsed : {});
        const patchArr = [patchObj];

        const candidates = [
          { url: baseEndpoint + "/" + encodeURIComponent(recordId), body: raw || JSON.stringify(parsed || {}) },
          { url: baseEndpoint, body: JSON.stringify(patchObj) },
          { url: baseEndpoint, body: JSON.stringify(patchArr) },
        ];

        let lastFail = "";
        for (const c of candidates) {
          const upstream = await fetch(c.url, {
            method: "PATCH",
            headers: {
              "xc-token": targetToken,
              "xc-auth": targetToken,
              "Content-Type": "application/json",
              Accept: "application/json",
            },
            body: c.body,
          });
          const body = await upstream.text();
          if (upstream.ok) {
            return new Response(body, {
              status: 200,
              headers: {
                ...corsHeaders,
                "Content-Type": "application/json; charset=utf-8",
                "Cache-Control": "no-store",
              },
            });
          }
          lastFail = `HTTP ${upstream.status} @ ${c.url}: ${body.slice(0, 500)}`;
        }

        return json(
          { error: "Target update failed", detail: lastFail || "No patch strategy succeeded" },
          502,
          corsHeaders
        );
      }

      return json({ error: "Unsupported target operation", method: request.method, action }, 405, corsHeaders);
    }

    if (request.method !== "GET") {
      return json({ error: "Method not allowed. Use GET (or mode=target for write)." }, 405, corsHeaders);
    }

    // Source proxy
    const offset = reqUrl.searchParams.get("offset") || "0";
    const limit = reqUrl.searchParams.get("limit") || "100";
    const viewId = reqUrl.searchParams.get("viewId") || "";
    const where = reqUrl.searchParams.get("where") || "";

    const directTargets = [];
    if (recordsUrl) directTargets.push(recordsUrl);
    if (host && tableId) {
      directTargets.push(`${host}/api/v2/tables/${tableId}/records`);
      directTargets.push(`${host}/nc/api/v2/tables/${tableId}/records`);
    }

    let lastError = "";
    for (const endpoint of directTargets) {
      const target = new URL(endpoint);
      target.searchParams.set("offset", offset);
      target.searchParams.set("limit", limit);
      target.searchParams.set("where", where);
      if (viewId) target.searchParams.set("viewId", viewId);

      try {
        const upstream = await fetch(target.toString(), {
          method: "GET",
          headers: {
            "xc-token": token,
            "xc-auth": token,
            Accept: "application/json",
          },
        });

        const body = await upstream.text();
        if (!upstream.ok) {
          lastError = `HTTP ${upstream.status} from ${target.origin + target.pathname}: ${body.slice(0, 300)}`;
          continue;
        }

        return new Response(body, {
          status: 200,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store",
          },
        });
      } catch (err) {
        lastError = `Fetch error from ${target.origin + target.pathname}: ${String(err?.message || err)}`;
      }
    }

    return json({ error: "All upstream NocoDB paths failed", detail: lastError }, 502, corsHeaders);
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(runAutoPublishJob(event, env, ctx));
  },
};

// ================= Auto publish =================

async function runAutoPublishJob(event, env, ctx) {
  const enabled = String(env.SNAPSHOT_AUTO_PUBLISH_ENABLED || "true").trim().toLowerCase() !== "false";
  if (!enabled) {
    console.log("[auto-publish] disabled");
    return;
  }

  const ownerId = "cron-" + String(event?.scheduledTime || Date.now());
  const builtAt = new Date(event?.scheduledTime || Date.now()).toISOString();
  const retryDelays = [0, 1500, 5000];
  let lastErr = "";

  for (let i = 0; i < retryDelays.length; i += 1) {
    if (retryDelays[i] > 0) await sleep(retryDelays[i]);
    try {
      const result = await publishSnapshotAutoInternal({
        env,
        ctx,
        ownerId,
        builtAt,
        reqOrigin: safeText(env.PUBLIC_BASE_URL) || safeText(env.WORKER_BASE_URL) || "",
      });

      if (result && result.skipped) {
        console.warn("[auto-publish] skipped", JSON.stringify(result).slice(0, 500));
        return;
      }

      console.log("[auto-publish] success", JSON.stringify(result).slice(0, 500));
      return;
    } catch (e) {
      lastErr = String(e?.message || e || "");
      console.error("[auto-publish] failed attempt", i + 1, lastErr);
    }
  }

  console.error("[auto-publish] final failed:", lastErr);
}

async function handleSnapshotPublishAuto(request, env, ctx, corsHeaders, reqUrl) {
  try {
    const configuredSecret = safeText(env.SNAPSHOT_AUTO_PUBLISH_SECRET);
    if (configuredSecret) {
      const gotSecret = safeText(request.headers.get("x-auto-publish-secret"));
      if (gotSecret !== configuredSecret) {
        return json({ error: "UNAUTHORIZED_AUTO_PUBLISH" }, 401, corsHeaders);
      }
    }

    const body = await readJsonBody(request);
    const ownerId = safeText(body?.ownerId) || ("auto-" + crypto.randomUUID());
    const builtAt = safeText(body?.builtAt) || new Date().toISOString();

    const result = await publishSnapshotAutoInternal({
      env,
      ctx,
      ownerId,
      builtAt,
      reqOrigin: reqUrl.origin,
    });

    return json({ ok: true, mode: "auto", ...result }, 200, corsHeaders);
  } catch (e) {
    return json({ error: "SNAPSHOT_AUTO_PUBLISH_FAILED", detail: String(e?.message || e) }, 500, corsHeaders);
  }
}

async function publishSnapshotAutoInternal({ env, ctx, ownerId, builtAt, reqOrigin }) {
  const { host, token } = getNocoAdminConn(env);
  const lockTableId = mustEnv(env.LOCK_TABLE_ID, "LOCK_TABLE_ID");
  const snapshotTableId = mustEnv(env.SNAPSHOT_STORE_TABLE_ID, "SNAPSHOT_STORE_TABLE_ID");
  const kv = env.SNAPSHOT_KV;
  if (!kv) throw new Error("Missing KV binding: SNAPSHOT_KV");

  const targetHost = (env.TARGET_NOCO_HOST || env.NOCO_HOST || "").replace(/\/+$/, "");
  const targetTableId = safeText(env.TARGET_NOCO_TABLE_ID);
  const targetRecordsUrl = safeText(env.TARGET_NOCO_RECORDS_URL);
  const targetToken = safeText(env.TARGET_NOCO_TOKEN || env.NOCO_TOKEN);
  if ((!targetRecordsUrl && (!targetHost || !targetTableId)) || !targetToken) {
    throw new Error("Missing target env vars for auto publish");
  }

  const lockRow = await nocodbListOneByWhere({
    host,
    token,
    tableId: lockTableId,
    where: "(lockKey,eq,form15-publish-lock)",
  });
  if (!lockRow) throw new Error("Missing lock seed row");

  const lf = unwrapRecordFields(lockRow);
  const lockRecId = getRecordId(lockRow);
  if (!lockRecId) throw new Error("Cannot resolve lock record Id");

  const lockStatus = safeText(lf.status).toLowerCase() || "free";
  const lockOwner = safeText(lf.ownerId);
  const lockExpiresAt = safeText(lf.expiresAt);
  if (lockStatus === "locked" && !isExpiredIso(lockExpiresAt) && lockOwner !== ownerId) {
    throw new Error(`LOCKED by ${lockOwner} until ${lockExpiresAt}`);
  }

  const nowIso = new Date().toISOString();
  const lockTtlSec = Math.max(60, Number(env.LOCK_TTL_SEC || 600));
  const nextExpires = addSecondsIso(nowIso, lockTtlSec);

  await nocodbPatchById({
    host,
    token,
    tableId: lockTableId,
    recordId: lockRecId,
    payload: {
      status: "locked",
      ownerId,
      acquiredAt: nowIso,
      heartbeatAt: nowIso,
      expiresAt: nextExpires,
    },
  });

  try {
    const rowsRaw = await fetchAllRowsFromNoco({
      host: targetHost,
      tableId: targetTableId,
      recordsUrl: targetRecordsUrl,
      token: targetToken,
      viewId: "",
      where: "",
      limit: 500,
    });

    const rows = normalizeTargetRecordsToFinalRows(rowsRaw);

    if (!rows.length) {
      return {
        skipped: true,
        reason: "EMPTY_AFTER_FILTER",
        nocoSourceRecordsTotal: rowsRaw.length,
      };
    }

    const hash = await buildRowsHash(rows);
    const excelFilesOkWithTestBen = computeUniqueExcelFileCount(rows);

    const snapshot = {
      snapshotVersion: builtAt,
      builtAt,
      hash,
      rowsCount: rows.length,
      rows,
      snapshotReady: true,
      excelFilesScannedTotal: 0,
      excelFilesErrorTotal: 0,
      excelFilesOkWithTestBen,
      nocoSourceRecordsTotal: rowsRaw.length,
    };

    const kvKey = "form15-main:" + builtAt;
    await kv.put(kvKey, JSON.stringify(snapshot));

    const snapshotRow = await nocodbListOneByWhere({
      host,
      token,
      tableId: snapshotTableId,
      where: "(snapshotKey,eq,form15-main)",
    });
    if (!snapshotRow) throw new Error("Missing snapshot seed row");

    const snapshotRecId = getRecordId(snapshotRow);
    if (!snapshotRecId) throw new Error("Cannot resolve snapshot record Id");

    await nocodbPatchById({
      host,
      token,
      tableId: snapshotTableId,
      recordId: snapshotRecId,
      payload: {
        snapshotKey: "form15-main",
        builtAt,
        version: builtAt,
        hash,
        rowsCount: rows.length,
        payload: "",
        kvKey,
        excelFilesScannedTotal: 0,
        excelFilesErrorTotal: 0,
        excelFilesOkWithTestBen,
        nocoSourceRecordsTotal: rowsRaw.length,
      },
    });

    try {
      const base = String(reqOrigin || "").trim().replace(/\/+$/, "");
      if (base) {
        const cache = caches.default;
        const legacyCacheKey = new Request(base + "/__snapshot_final_target_v1__.json", { method: "GET" });
        ctx.waitUntil(cache.delete(legacyCacheKey));
      }
    } catch (_) {}

    return {
      version: builtAt,
      builtAt,
      hash,
      rowsCount: rows.length,
      kvKey,
      nocoSourceRecordsTotal: rowsRaw.length,
      excelFilesOkWithTestBen,
    };
  } finally {
    try {
      await nocodbPatchById({
        host,
        token,
        tableId: lockTableId,
        recordId: lockRecId,
        payload: {
          status: "free",
          ownerId: "",
          acquiredAt: "",
          heartbeatAt: "",
          expiresAt: "",
        },
      });
    } catch (_) {}
  }
}

// ================= Lock + Snapshot Store helpers =================

function mustEnv(v, name) {
  const s = String(v || "").trim();
  if (!s) throw new Error("Missing env: " + name);
  return s;
}

function unwrapRecordFields(rec) {
  if (rec && rec.fields && typeof rec.fields === "object") return rec.fields;
  return rec || {};
}

function getRecordId(rec) {
  return rec?.Id ?? rec?.id ?? rec?._id ?? null;
}

function addSecondsIso(iso, sec) {
  const base = new Date(iso).getTime();
  return new Date(base + Number(sec || 0) * 1000).toISOString();
}

function isExpiredIso(iso) {
  if (!iso) return true;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return true;
  return Date.now() >= t;
}

async function readJsonBody(request) {
  try {
    return await request.json();
  } catch (_) {
    return {};
  }
}

async function nocodbListOneByWhere({ host, token, tableId, where }) {
  const endpoint = `${host}/api/v2/tables/${tableId}/records`;
  const url = new URL(endpoint);
  url.searchParams.set("limit", "1");
  url.searchParams.set("offset", "0");
  if (where) url.searchParams.set("where", where);

  const resp = await fetch(url.toString(), {
    method: "GET",
    headers: {
      "xc-token": token,
      "xc-auth": token,
      Accept: "application/json",
    },
  });

  const text = await resp.text();
  if (!resp.ok) throw new Error(`List failed HTTP ${resp.status}: ${text.slice(0, 500)}`);

  let data = {};
  try {
    data = JSON.parse(text || "{}");
  } catch (_) {}
  const list = Array.isArray(data?.list) ? data.list : Array.isArray(data) ? data : [];
  return list[0] || null;
}

async function nocodbPatchById({ host, token, tableId, recordId, payload }) {
  const baseEndpoint = `${host}/api/v2/tables/${tableId}/records`;
  const idNum = Number(recordId);
  const idValue = Number.isFinite(idNum) ? idNum : recordId;
  const patchObj = Object.assign({ Id: idValue }, payload && typeof payload === "object" ? payload : {});
  const patchArr = [patchObj];

  const candidates = [
    { url: `${baseEndpoint}/${encodeURIComponent(String(recordId))}`, body: JSON.stringify(payload || {}) },
    { url: baseEndpoint, body: JSON.stringify(patchObj) },
    { url: baseEndpoint, body: JSON.stringify(patchArr) },
  ];

  let lastError = "";
  for (const c of candidates) {
    const resp = await fetch(c.url, {
      method: "PATCH",
      headers: {
        "xc-token": token,
        "xc-auth": token,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: c.body,
    });

    const text = await resp.text();
    if (resp.ok) {
      try {
        return JSON.parse(text || "{}");
      } catch (_) {
        return {};
      }
    }
    lastError = `HTTP ${resp.status} @ ${c.url}: ${text.slice(0, 500)}`;
  }

  throw new Error(`Patch failed. ${lastError}`);
}

function getNocoAdminConn(env) {
  const host = mustEnv(env.TARGET_NOCO_HOST || env.NOCO_HOST, "TARGET_NOCO_HOST|NOCO_HOST").replace(/\/+$/, "");
  const token = mustEnv(env.TARGET_NOCO_TOKEN || env.NOCO_TOKEN, "TARGET_NOCO_TOKEN|NOCO_TOKEN");
  return { host, token };
}

async function handleLockAcquire(request, env, corsHeaders) {
  try {
    const { host, token } = getNocoAdminConn(env);
    const lockTableId = mustEnv(env.LOCK_TABLE_ID, "LOCK_TABLE_ID");
    const lockTtlSec = Math.max(60, Number(env.LOCK_TTL_SEC || 1800));

    const body = await readJsonBody(request);
    const ownerId = String(body?.ownerId || crypto.randomUUID()).trim();
    if (!ownerId) return json({ error: "Missing ownerId" }, 400, corsHeaders);

    const row = await nocodbListOneByWhere({
      host,
      token,
      tableId: lockTableId,
      where: "(lockKey,eq,form15-publish-lock)",
    });

    if (!row) {
      return json({ error: "Missing lock seed row. Create row with lockKey=form15-publish-lock" }, 500, corsHeaders);
    }

    const f = unwrapRecordFields(row);
    const recId = getRecordId(row);
    if (!recId) return json({ error: "Cannot resolve lock record Id" }, 500, corsHeaders);

    const status = String(f.status || "free").toLowerCase();
    const currentOwner = String(f.ownerId || "").trim();
    const expiresAt = String(f.expiresAt || "").trim();

    if (status === "locked" && !isExpiredIso(expiresAt)) {
      return json({ ok: false, error: "LOCKED", ownerId: currentOwner, expiresAt }, 409, corsHeaders);
    }

    const now = new Date().toISOString();
    const nextExpires = addSecondsIso(now, lockTtlSec);

    await nocodbPatchById({
      host,
      token,
      tableId: lockTableId,
      recordId: recId,
      payload: {
        status: "locked",
        ownerId,
        acquiredAt: now,
        heartbeatAt: now,
        expiresAt: nextExpires,
      },
    });

    return json({ ok: true, ownerId, acquiredAt: now, expiresAt: nextExpires }, 200, corsHeaders);
  } catch (e) {
    return json({ error: "LOCK_ACQUIRE_FAILED", detail: String(e?.message || e) }, 500, corsHeaders);
  }
}

async function handleLockHeartbeat(request, env, corsHeaders) {
  try {
    const { host, token } = getNocoAdminConn(env);
    const lockTableId = mustEnv(env.LOCK_TABLE_ID, "LOCK_TABLE_ID");
    const lockTtlSec = Math.max(60, Number(env.LOCK_TTL_SEC || 1800));

    const body = await readJsonBody(request);
    const ownerId = String(body?.ownerId || "").trim();
    if (!ownerId) return json({ error: "Missing ownerId" }, 400, corsHeaders);

    const row = await nocodbListOneByWhere({
      host,
      token,
      tableId: lockTableId,
      where: "(lockKey,eq,form15-publish-lock)",
    });
    if (!row) return json({ error: "Missing lock seed row" }, 500, corsHeaders);

    const f = unwrapRecordFields(row);
    const recId = getRecordId(row);
    if (!recId) return json({ error: "Cannot resolve lock record Id" }, 500, corsHeaders);

    const currentOwner = String(f.ownerId || "").trim();
    const status = String(f.status || "free").toLowerCase();
    const expiresAt = String(f.expiresAt || "").trim();

    if (status !== "locked" || currentOwner !== ownerId || isExpiredIso(expiresAt)) {
      return json({ ok: false, error: "NOT_LOCK_OWNER_OR_EXPIRED", ownerId: currentOwner, expiresAt }, 409, corsHeaders);
    }

    const now = new Date().toISOString();
    const nextExpires = addSecondsIso(now, lockTtlSec);

    await nocodbPatchById({
      host,
      token,
      tableId: lockTableId,
      recordId: recId,
      payload: {
        heartbeatAt: now,
        expiresAt: nextExpires,
      },
    });

    return json({ ok: true, ownerId, expiresAt: nextExpires }, 200, corsHeaders);
  } catch (e) {
    return json({ error: "LOCK_HEARTBEAT_FAILED", detail: String(e?.message || e) }, 500, corsHeaders);
  }
}

async function handleLockRelease(request, env, corsHeaders) {
  try {
    const { host, token } = getNocoAdminConn(env);
    const lockTableId = mustEnv(env.LOCK_TABLE_ID, "LOCK_TABLE_ID");

    const body = await readJsonBody(request);
    const ownerId = String(body?.ownerId || "").trim();
    if (!ownerId) return json({ error: "Missing ownerId" }, 400, corsHeaders);

    const row = await nocodbListOneByWhere({
      host,
      token,
      tableId: lockTableId,
      where: "(lockKey,eq,form15-publish-lock)",
    });
    if (!row) return json({ error: "Missing lock seed row" }, 500, corsHeaders);

    const f = unwrapRecordFields(row);
    const recId = getRecordId(row);
    if (!recId) return json({ error: "Cannot resolve lock record Id" }, 500, corsHeaders);

    const currentOwner = String(f.ownerId || "").trim();
    if (currentOwner && currentOwner !== ownerId) {
      return json({ ok: false, error: "NOT_LOCK_OWNER", ownerId: currentOwner }, 409, corsHeaders);
    }

    await nocodbPatchById({
      host,
      token,
      tableId: lockTableId,
      recordId: recId,
      payload: {
        status: "free",
        ownerId: "",
        acquiredAt: "",
        heartbeatAt: "",
        expiresAt: "",
      },
    });

    return json({ ok: true }, 200, corsHeaders);
  } catch (e) {
    return json({ error: "LOCK_RELEASE_FAILED", detail: String(e?.message || e) }, 500, corsHeaders);
  }
}

async function handleSnapshotPublish(request, env, ctx, corsHeaders, reqUrl) {
  try {
    const { host, token } = getNocoAdminConn(env);
    const snapshotTableId = mustEnv(env.SNAPSHOT_STORE_TABLE_ID, "SNAPSHOT_STORE_TABLE_ID");
    const lockTableId = mustEnv(env.LOCK_TABLE_ID, "LOCK_TABLE_ID");
    const kv = env.SNAPSHOT_KV;
    if (!kv) throw new Error("Missing KV binding: SNAPSHOT_KV");

    const body = await readJsonBody(request);
    const ownerId = safeText(body?.ownerId);
    const rows = Array.isArray(body?.rows) ? body.rows : [];
    const builtAt = safeText(body?.builtAt) || new Date().toISOString();

    const publisherStats = body && typeof body.publisherStats === "object" ? body.publisherStats : {};
    const excelFilesScannedTotal = toNonNegInt(publisherStats.excelFilesScannedTotal);
    const excelFilesErrorTotal = toNonNegInt(publisherStats.excelFilesErrorTotal);
    const excelFilesOkWithTestBen = toNonNegInt(publisherStats.excelFilesOkWithTestBen);
    const nocoSourceRecordsTotal = toNonNegInt(publisherStats.nocoSourceRecordsTotal);

    if (!ownerId) return json({ error: "Missing ownerId" }, 400, corsHeaders);
    if (!rows.length) return json({ error: "Missing rows (non-empty array required)" }, 400, corsHeaders);

    const lockRow = await nocodbListOneByWhere({
      host,
      token,
      tableId: lockTableId,
      where: "(lockKey,eq,form15-publish-lock)",
    });
    if (!lockRow) return json({ error: "Missing lock seed row" }, 500, corsHeaders);

    const lf = unwrapRecordFields(lockRow);
    const lockOwner = safeText(lf.ownerId);
    const lockStatus = safeText(lf.status).toLowerCase() || "free";
    const lockExpiresAt = safeText(lf.expiresAt);

    if (lockStatus !== "locked" || lockOwner !== ownerId || isExpiredIso(lockExpiresAt)) {
      return json(
        { ok: false, error: "NOT_LOCK_OWNER_OR_EXPIRED", ownerId: lockOwner, expiresAt: lockExpiresAt },
        409,
        corsHeaders
      );
    }

    const hash = await buildRowsHash(rows);
    const snapshot = {
      snapshotVersion: builtAt,
      builtAt,
      hash,
      rowsCount: rows.length,
      rows,
      snapshotReady: true,
      excelFilesScannedTotal,
      excelFilesErrorTotal,
      excelFilesOkWithTestBen,
      nocoSourceRecordsTotal,
    };

    const kvKey = "form15-main:" + builtAt;
    await kv.put(kvKey, JSON.stringify(snapshot));

    const snapshotRow = await nocodbListOneByWhere({
      host,
      token,
      tableId: snapshotTableId,
      where: "(snapshotKey,eq,form15-main)",
    });

    if (!snapshotRow) {
      return json({ error: "Missing snapshot seed row. Create row with snapshotKey=form15-main" }, 500, corsHeaders);
    }

    const snapshotRecId = getRecordId(snapshotRow);
    if (!snapshotRecId) return json({ error: "Cannot resolve snapshot record Id" }, 500, corsHeaders);

    await nocodbPatchById({
      host,
      token,
      tableId: snapshotTableId,
      recordId: snapshotRecId,
      payload: {
        snapshotKey: "form15-main",
        builtAt,
        version: builtAt,
        hash,
        rowsCount: rows.length,
        payload: "",
        kvKey,
        excelFilesScannedTotal,
        excelFilesErrorTotal,
        excelFilesOkWithTestBen,
        nocoSourceRecordsTotal,
      },
    });

    try {
      const cache = caches.default;
      const base = reqUrl.origin.replace(/\/+$/, "");
      const legacyCacheKey = new Request(base + "/__snapshot_final_target_v1__.json", { method: "GET" });
      ctx.waitUntil(cache.delete(legacyCacheKey));
    } catch (_) {}

    return json(
      {
        ok: true,
        version: builtAt,
        builtAt,
        hash,
        rowsCount: rows.length,
        kvKey,
        excelFilesScannedTotal,
        excelFilesErrorTotal,
        excelFilesOkWithTestBen,
        nocoSourceRecordsTotal,
      },
      200,
      corsHeaders
    );
  } catch (e) {
    return json({ error: "SNAPSHOT_PUBLISH_FAILED", detail: String(e?.message || e) }, 500, corsHeaders);
  }
}

async function readPublishedSnapshotRow(env) {
  const snapshotTableId = String(env.SNAPSHOT_STORE_TABLE_ID || "").trim();
  if (!snapshotTableId) return null;

  const { host, token } = getNocoAdminConn(env);
  const row = await nocodbListOneByWhere({
    host,
    token,
    tableId: snapshotTableId,
    where: "(snapshotKey,eq,form15-main)",
  });

  return row || null;
}

async function readPublishedSnapshotFromStore(env) {
  const row = await readPublishedSnapshotRow(env);
  if (!row) return null;

  const kv = env.SNAPSHOT_KV;
  if (!kv) throw new Error("Missing KV binding: SNAPSHOT_KV");

  const f = unwrapRecordFields(row);
  const kvKey = String(f.kvKey || "").trim();
  if (!kvKey) return null;

  const raw = await kv.get(kvKey);
  if (!raw) throw new Error("Snapshot not found in KV: " + kvKey);

  let payload = {};
  try {
    payload = JSON.parse(raw);
  } catch (_) {
    throw new Error("Invalid JSON in KV snapshot");
  }

  const rows = Array.isArray(payload?.rows) ? payload.rows : [];
  const builtAt = safeText(payload?.builtAt || f.builtAt || "");
  const version = safeText(payload?.snapshotVersion || f.version || builtAt || "");
  const hash = safeText(payload?.hash || f.hash || "");
  const rowsCount = Number(payload?.rowsCount || f.rowsCount || rows.length || 0);
  const excelFilesScannedTotal = Number(payload?.excelFilesScannedTotal || f.excelFilesScannedTotal || 0);
  const excelFilesErrorTotal = Number(payload?.excelFilesErrorTotal || f.excelFilesErrorTotal || 0);
  const excelFilesOkWithTestBen = Number(payload?.excelFilesOkWithTestBen || f.excelFilesOkWithTestBen || 0);
  const nocoSourceRecordsTotal = Number(payload?.nocoSourceRecordsTotal || f.nocoSourceRecordsTotal || 0);

  return {
    snapshotVersion: version,
    builtAt,
    hash,
    rowsCount,
    rows,
    snapshotReady: true,
    excelFilesScannedTotal,
    excelFilesErrorTotal,
    excelFilesOkWithTestBen,
    nocoSourceRecordsTotal,
  };
}

async function readPublishedSnapshotMetaFromStore(env, origin) {
  const row = await readPublishedSnapshotRow(env);
  if (!row) return null;

  const f = unwrapRecordFields(row);
  const kvKey = String(f.kvKey || "").trim();
  if (!kvKey) return null;

  const publicBase = String(env.PUBLIC_BASE_URL || "").trim().replace(/\/+$/, "") || origin;

  return {
    version: safeText(f.version || ""),
    builtAt: safeText(f.builtAt || ""),
    hash: safeText(f.hash || ""),
    rowsCount: Number(f.rowsCount || 0),
    dataUrl: publicBase + "/snapshot.json",
    snapshotReady: true,
    excelFilesScannedTotal: Number(f.excelFilesScannedTotal || 0),
    excelFilesErrorTotal: Number(f.excelFilesErrorTotal || 0),
    excelFilesOkWithTestBen: Number(f.excelFilesOkWithTestBen || 0),
    nocoSourceRecordsTotal: Number(f.nocoSourceRecordsTotal || 0),
  };
}

// ================= Snapshot fallback builder =================

async function getOrBuildFinalSnapshot({ reqUrl, env, ctx, corsHeaders, forceRefresh, host, tableId, recordsUrl, token }) {
  const cache = caches.default;
  const cacheKey = new Request(reqUrl.origin + "/__snapshot_final_target_v1__.json", { method: "GET" });

  if (!forceRefresh) {
    const cached = await cache.match(cacheKey);
    if (cached) {
      try {
        const c = await cached.json();
        return { ...c, snapshotReady: true };
      } catch (_) {}
    }
  }

  const rowsRaw = await fetchAllRowsFromNoco({
    host,
    tableId,
    recordsUrl,
    token,
    viewId: "",
    where: "",
    limit: 500,
  });

  const rows = normalizeTargetRecordsToFinalRows(rowsRaw);
  const builtAt = new Date().toISOString();
  const hash = await buildRowsHash(rows);
  const excelFilesOkWithTestBen = computeUniqueExcelFileCount(rows);

  const snapshot = {
    snapshotVersion: builtAt,
    builtAt,
    hash,
    rowsCount: rows.length,
    rows,
    snapshotReady: true,
    excelFilesScannedTotal: 0,
    excelFilesErrorTotal: 0,
    excelFilesOkWithTestBen,
    nocoSourceRecordsTotal: rowsRaw.length,
  };

  const resp = new Response(JSON.stringify(snapshot), {
    status: 200,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": `public, max-age=${getDataTtlSec(env)}`,
    },
  });

  ctx.waitUntil(cache.put(cacheKey, resp.clone()));
  return snapshot;
}

function pickDanhGiaValue(fields) {
  const f = fields || {};
  const norm = (s) =>
    String(s || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "");

  const aliases = [
    "Đánh giá",
    "Danh gia",
    "Đánh giá ",
    "Danh_gia",
    "Mục đích đánh giá",
    "Muc dich danh gia",
    "Kết quả đánh giá",
    "Ket qua danh gia",
    "Kết quả",
    "Ket qua",
    "Result",
    "result",
  ];

  const index = {};
  for (const k of Object.keys(f)) index[norm(k)] = k;

  for (const alias of aliases) {
    const realKey = index[norm(alias)];
    if (!realKey) continue;
    const v = safeText(f[realKey]);
    if (v) return v;
  }
  return "";
}

function normalizeTargetRecordsToFinalRows(rawRows) {
  const list = Array.isArray(rawRows) ? rawRows : [];
  const out = [];

  const norm = (s) =>
    String(s || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "");

  function pickByAliases(fields, aliases) {
    if (!fields || typeof fields !== "object") return "";
    const index = {};
    for (const k of Object.keys(fields)) index[norm(k)] = k;
    for (const alias of aliases) {
      const realKey = index[norm(alias)];
      if (!realKey) continue;
      const v = safeText(fields[realKey]);
      if (v) return v;
    }
    return "";
  }

  for (const rec of list) {
    const f = rec && rec.fields && typeof rec.fields === "object" ? rec.fields : rec || {};
    const get = (k) => safeText(f[k]);

    const danhGia = pickDanhGiaValue(f);
    if (danhGia && !isTestBenValue(danhGia)) continue;

    const taskCode = pickByAliases(f, ["Mã tác vụ", "Ma tac vu", "Task code", "Task ID", "TaskId", "Mã"]);
    const taskName = pickByAliases(f, ["Tên tác vụ", "Ten tac vu", "Task Name", "Task name", "Task", "Title"]);
    const assignee = pickByAliases(f, ["Asignee", "Assignee", "Tên NCC", "Nguoi phu trach", "Người phụ trách"]);
    const completionActual = pickByAliases(f, [
      "Ngày trả báo cáo tức thời",
      "Ngay tra bao cao tuc thoi",
      "Ngày hoàn thành thực tế",
      "Ngay hoan thanh thuc te",
      "UpdatedAt",
      "Updated At",
    ]);

    const sheetName = pickByAliases(f, ["Sheet", "sheetName"]);
    const sourceSheetName = pickByAliases(f, ["sourceSheetName", "Sheet", "sheetName"]);
    const fileUrl = pickByAliases(f, ["Link file", "Link BCexcel", "File attachment", "Link"]);
    const excelRowIndex = toNumber(
      pickByAliases(f, ["excelRowIndex", "Excel Row Index", "row index", "STT"]) || 0
    );

    const rowData = {
      STT: pickByAliases(f, ["STT"]),
      "Công chuẩn": get("Công chuẩn"),
      "Mã danh mục": get("Mã danh mục"),
      "Hạng mục kiểm tra (Index)": pickByAliases(f, [
        "Hạng mục kiểm tra (Index)",
        "Hang muc kiem tra (Index)",
        "Hạng mục kiểm tra",
        "Hang muc kiem tra",
      ]),
      "Tiêu chuẩn (Standard)": pickByAliases(f, [
        "Tiêu chuẩn (Standard)",
        "Tieu chuan (Standard)",
        "Tiêu chuẩn",
        "Tieu chuan",
        "Standard",
      ]),
      "Công cụ (Tool)": pickByAliases(f, [
        "Công cụ (Tool)",
        "Cong cu (Tool)",
        "Công cụ",
        "Cong cu",
        "Tool",
      ]),
      "Hướng dẫn / Phương pháp (Document)": pickByAliases(f, [
        "Hướng dẫn / Phương pháp (Document)",
        "Huong dan / Phuong phap (Document)",
        "Hướng dẫn / Phương pháp",
        "Huong dan / Phuong phap",
        "Document",
      ]),
      "Đánh giá": danhGia,
    };

    const manual_test_start_date = pickByAliases(f, ["manual_test_start_date", "Thời gian bắt đầu", "Thoi gian bat dau"]);
    const manual_eta_date = pickByAliases(f, ["manual_eta_date", "Thời gian dự kiến hoàn thành", "Thoi gian du kien hoan thanh"]);
    const manual_so_luong_mau = pickByAliases(f, ["manual_so_luong_mau", "Số lượng mẫu", "So luong mau"]);
    const manual_test_area = pickByAliases(f, ["manual_test_area", "Khu vực test", "Khu vuc test"]);
    const manual_test_area_detail = pickByAliases(f, ["manual_test_area_detail", "Chi tiết vị trí test", "Chi tiet vi tri test"]);
    const manual_jig_code = pickByAliases(f, ["manual_jig_code", "Mã / Tên Jig test", "Ma / Ten Jig test"]);
    const manual_actual_done_date = pickByAliases(f, ["manual_actual_done_date", "Thời gian hoàn thành thực tế", "Thoi gian hoan thanh thuc te"]);
    const manual_status = pickByAliases(f, ["manual_status", "Trạng thái", "Trang thai"]) || "Pending";
    const manual_ket_qua = pickByAliases(f, ["manual_ket_qua", "Kết quả", "Ket qua"]);
    const manual_ghi_chu = pickByAliases(f, ["manual_ghi_chu", "Ghi chú", "Ghi chu"]);
    const manual_updated_at = safeText(f.manual_updated_at);
    const manual_updated_by = safeText(f.manual_updated_by);
    const manual_version = toNumber(f.manual_version);

    out.push({
      rowKey: safeText(f.rowKey) || buildRowKey(taskCode, sheetName, excelRowIndex, fileUrl),
      targetRecordId: safeText(rec?.Id ?? rec?.id ?? rec?._id ?? f?.Id ?? f?.id ?? ""),
      taskCode,
      taskName,
      assignee,
      completionActual,
      sheetName,
      sourceSheetName,
      fileUrl,
      excelRowIndex,
      danhGiaValue: rowData["Đánh giá"],
      rowData,

      manual_test_start_date,
      manual_eta_date,
      manual_so_luong_mau,
      manual_test_area,
      manual_test_area_detail,
      manual_jig_code,
      manual_actual_done_date,
      manual_status,
      manual_ket_qua,
      manual_ghi_chu,
      manual_updated_at,
      manual_updated_by,
      manual_version,
    });
  }

  return out;
}

// ================= Generic helpers =================

async function fetchAllRowsFromNoco({ host, tableId, recordsUrl, token, viewId, where, limit }) {
  const directTargets = [];
  if (recordsUrl) directTargets.push(recordsUrl);
  if (host && tableId) {
    directTargets.push(`${host}/api/v2/tables/${tableId}/records`);
    directTargets.push(`${host}/nc/api/v2/tables/${tableId}/records`);
  }

  let offset = 0;
  const out = [];
  let endpointOk = null;
  let lastError = "";

  for (const endpoint of directTargets) {
    try {
      const probe = new URL(endpoint);
      probe.searchParams.set("offset", "0");
      probe.searchParams.set("limit", "1");
      probe.searchParams.set("where", where || "");
      if (viewId) probe.searchParams.set("viewId", viewId);

      const upstream = await fetch(probe.toString(), {
        method: "GET",
        headers: {
          "xc-token": token,
          "xc-auth": token,
          Accept: "application/json",
        },
      });

      if (upstream.ok) {
        endpointOk = endpoint;
        break;
      }

      const body = await upstream.text();
      lastError = `Probe failed HTTP ${upstream.status}: ${body.slice(0, 300)}`;
    } catch (e) {
      lastError = String(e?.message || e || "");
    }
  }

  if (!endpointOk) throw new Error("Cannot resolve upstream endpoint for snapshot. " + lastError);

  for (;;) {
    const target = new URL(endpointOk);
    target.searchParams.set("offset", String(offset));
    target.searchParams.set("limit", String(limit || 500));
    target.searchParams.set("where", where || "");
    if (viewId) target.searchParams.set("viewId", viewId);

    const upstream = await fetch(target.toString(), {
      method: "GET",
      headers: {
        "xc-token": token,
        "xc-auth": token,
        Accept: "application/json",
      },
    });

    const body = await upstream.text();
    if (!upstream.ok) throw new Error(`Snapshot page fetch failed HTTP ${upstream.status}: ${body.slice(0, 400)}`);

    let data;
    try {
      data = JSON.parse(body);
    } catch (_) {
      throw new Error("Snapshot page parse JSON failed");
    }

    const rows = Array.isArray(data?.list) ? data.list : Array.isArray(data) ? data : [];
    out.push(...rows);

    if (!rows.length || rows.length < Number(limit || 500)) break;
    offset += Number(limit || 500);
  }

  return out;
}

async function buildRowsHash(rows) {
  const fp = (Array.isArray(rows) ? rows : [])
    .map((r) => {
      const id = String(r?.targetRecordId ?? r?.rowKey ?? "");
      const updated = String(r?.manual_updated_at ?? "");
      return id + "|" + updated;
    })
    .join("\n");

  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(fp));
  const bytes = Array.from(new Uint8Array(digest));
  const hex = bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
  return "sha256:" + hex;
}

function getDataTtlSec(env) {
  const v = Number(env.SNAPSHOT_TTL_SEC || 300);
  if (!Number.isFinite(v) || v < 10) return 300;
  return Math.floor(v);
}

function getMetaTtlSec(env) {
  const v = Number(env.SNAPSHOT_META_TTL_SEC || 30);
  if (!Number.isFinite(v) || v < 5) return 30;
  return Math.floor(v);
}

function isTestBenValue(v) {
  const s = normalizeCompact(v);
  return s.includes("testben") || s.includes("testbend") || s.includes("durabilitytest");
}

function normalizeCompact(v) {
  return String(v || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function safeText(v) {
  return String(v ?? "").trim();
}

function toNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function toNonNegInt(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

function computeUniqueExcelFileCount(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const seen = new Set();
  for (const r of list) {
    const u = safeText(r && r.fileUrl);
    if (u) seen.add(u);
  }
  return seen.size;
}

function buildRowKey(taskCode, sheetName, excelRowIndex, fileUrl) {
  const stableTask = safeText(taskCode);
  const stableSheet = safeText(sheetName);
  const stableIdx = String(toNumber(excelRowIndex));

  if (stableTask) return stableTask + "__" + stableSheet + "__" + stableIdx;
  return safeText(fileUrl) + "__" + stableSheet + "__" + stableIdx;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms || 0))));
}

function json(data, status, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...extraHeaders,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}