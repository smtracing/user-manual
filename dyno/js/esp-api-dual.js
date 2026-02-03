/* =========================================================
   esp-api-dual.js — DYNO ONLY (AP 192.168.4.1)
   - Untuk dyno-road.js (nama fungsi DUAL tetap sama)
   - Murni DYNO: status/snapshot/config/arm/run/stop/reset/rows
========================================================= */

console.log("%c[ESP-API-DUAL] DYNO ONLY @192.168.4.1", "color:#4cff8f");

const ESP_HOST = "http://192.168.4.1";
const ESP_FETCH_TIMEOUT_MS = 1200;

async function fetchJSON(url, opt = {}, timeoutMs = ESP_FETCH_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { cache:"no-store", ...opt, signal: ctrl.signal });
    if (!res.ok) throw new Error("HTTP_" + res.status);
    const txt = await res.text();
    try { return JSON.parse(txt); } catch { return { _raw: txt }; }
  } finally { clearTimeout(t); }
}

/* CONNECT CHECK */
window.DYNO_getConn_DUAL = async function () {
  try {
    await fetchJSON(`${ESP_HOST}/status`, {}, 900);
    return { connected: true, ip: "192.168.4.1", via: "/status" };
  } catch {
    try {
      await fetchJSON(`${ESP_HOST}/snapshot`, {}, 900);
      return { connected: true, ip: "192.168.4.1", via: "/snapshot" };
    } catch {
      return { connected: false, ip: "192.168.4.1" };
    }
  }
};

/* SNAPSHOT */
function mapSnapshot(sn){
  if (!sn) return null;

  return {
    ts_ms: Number(sn.ts_ms ?? 0),
    front_total: Number(sn.front_total ?? 0),
    rear_total:  Number(sn.rear_total ?? 0),
    rpm:         Number(sn.rpm ?? 0),
    rpm_valid:   Number(sn.rpm_valid ?? 0),

    armed:   !!(sn.armed ?? false),
    running: !!(sn.running ?? false),

    t:       Number(sn.t ?? 0),
    distM:   Number(sn.distM ?? 0),
    speedKmh:Number(sn.speedKmh ?? 0),

    tq:  Number(sn.tq ?? 0),
    hp:  Number(sn.hp ?? 0),
    ign: Number(sn.ign ?? 0),
    afr: Number(sn.afr ?? 14.7),

    maxTQ: Number(sn.maxTQ ?? 0),
    maxHP: Number(sn.maxHP ?? 0),

    targetM:  Number(sn.targetM ?? 0),
    weightKg: Number(sn.weightKg ?? 0),

    circ_m: Number(sn.circ_m ?? 0),
    ppr_f:  Number(sn.ppr_f ?? 0),
    ppr_r:  Number(sn.ppr_r ?? 0),

    rowsCount: Number(sn.rowsCount ?? 0),
    seq:       Number(sn.seq ?? 0),
    statusText: String(sn.statusText ?? sn.status ?? "")
  };
}

window.DYNO_getSnapshot_DUAL = async function () {
  const sn = await fetchJSON(`${ESP_HOST}/snapshot`, {}, 1200);
  return mapSnapshot(sn) || sn;
};

/* ROWS incremental */
window.DYNO_getRowsSince_DUAL = async function (sinceSeq = 0) {
  const s = Math.max(0, parseInt(sinceSeq, 10) || 0);
  try {
    const j = await fetchJSON(`${ESP_HOST}/rows?since=${s}`, {}, 1400);
    if (j && Array.isArray(j.rows)) {
      return { seq: Number(j.seq ?? s) || s, rows: j.rows };
    }
  } catch {}
  return { seq: s, rows: [] };
};

/* CONFIG */
window.DYNO_setConfig_DUAL = async function (cfg) {
  const q = new URLSearchParams({
    targetM:  String(cfg?.targetM ?? 200),
    circM:    String(cfg?.circM ?? 1.85),
    weightKg: String(cfg?.weightKg ?? 120),
    pprFront: String(cfg?.pprFront ?? 1),
    pprRear:  String(cfg?.pprRear ?? 1),
  }).toString();
  return await fetchJSON(`${ESP_HOST}/config?${q}`, {}, 1400);
};

async function tryGET(path){
  const j = await fetchJSON(`${ESP_HOST}${path}`, {}, 1400);
  return j;
}

window.DYNO_arm_DUAL = async function(cfg){
  try { await window.DYNO_setConfig_DUAL(cfg); } catch {}
  try { const j = await tryGET("/arm"); return { ok:true, j, path:"/arm" }; }
  catch(e){ return { ok:false, reason:(e?.message||"ARM_FAIL") }; }
};

window.DYNO_run_DUAL = async function(){
  try { const j = await tryGET("/run"); return { ok:true, j, path:"/run" }; }
  catch(e){ return { ok:false, reason:(e?.message||"RUN_FAIL") }; }
};

window.DYNO_stop_DUAL = async function(reason="STOP"){
  try { const j = await tryGET("/stop"); return { ok:true, j, path:"/stop", reason }; }
  catch(e){ return { ok:false, reason:(e?.message||"STOP_FAIL") }; }
};

window.DYNO_reset_DUAL = async function(){
  try { const j = await tryGET("/reset"); return { ok:true, j, path:"/reset" }; }
  catch(e){ return { ok:false, reason:(e?.message||"RESET_FAIL") }; }
};
