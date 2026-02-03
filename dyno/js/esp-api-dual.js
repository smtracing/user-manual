/* =========================================================
   esp-api-dual.js — DYNO AP MODE (192.168.4.1)
   - CONNECT: GET /status OK, fallback /snapshot OK
   - SNAPSHOT: ambil RAW (ts_ms, front_total, rear_total, rpm, dll)
   - CONFIG: kirim dua gaya param (circ/circM, pprf/pprFront, pprr/pprRear)
   - ARM/RUN/STOP: /arm /run /stop (fallback /reset untuk ARM)
========================================================= */

console.log("%c[ESP-API-DYNO] AP ONLY (192.168.4.1) READY", "color:#4cff8f");

const ESP_HOST = "http://192.168.4.1";
const ESP_FETCH_TIMEOUT_MS = 1400;

async function fetchJSON(url, opt = {}, timeoutMs = ESP_FETCH_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      cache: "no-store",
      ...opt,
      signal: ctrl.signal
    });

    if (!res.ok) throw new Error("HTTP_" + res.status);

    const txt = await res.text();
    try { return JSON.parse(txt); }
    catch { return { _raw: txt }; }
  } finally {
    clearTimeout(t);
  }
}

function mapSnapshot(sn){
  if (!sn) return null;

  // RAW dari firmware (dipertahankan)
  const out = { ...sn };

  // Normalisasi field yang sering dipakai dyno-road
  out.ts_ms       = Number(sn.ts_ms ?? sn.tsMs ?? 0) || 0;
  out.front_total = Number(sn.front_total ?? sn.frontTotal ?? 0) || 0;
  out.rear_total  = Number(sn.rear_total  ?? sn.rearTotal  ?? 0) || 0;

  out.rpm         = Number(sn.rpm ?? 0) || 0;
  out.rpm_valid   = !!(sn.rpm_valid ?? sn.rpmValid ?? false);

  // config normalize
  out.circM     = Number(sn.circM ?? sn.circ_m ?? sn.circ ?? 0) || 0;
  out.pprFront  = Number(sn.pprFront ?? sn.ppr_f ?? sn.pprf ?? 0) || 0;
  out.pprRear   = Number(sn.pprRear  ?? sn.ppr_r ?? sn.pprr ?? 0) || 0;

  // state (kalau firmware kirim)
  out.armed   = !!(sn.armed ?? sn.arm ?? false);
  out.running = !!(sn.running ?? sn.run ?? false);
  out.waitGate= !!(sn.waitGate ?? false);

  // kalau firmware sudah hitung (opsional)
  out.t        = Number(sn.t ?? sn.time_s ?? 0) || 0;
  out.distM    = Number(sn.distM ?? sn.dist_m ?? 0) || 0;
  out.speedKmh = Number(sn.speedKmh ?? sn.speed_kmh ?? 0) || 0;

  out.slipPct  = Number(sn.slipPct ?? sn.slip_pct ?? 0) || 0;
  out.slipOn   = !!(sn.slipOn ?? sn.slip_on ?? false);

  out.statusText = String(sn.statusText ?? sn.status ?? "");

  return out;
}

/* =========================
   CONNECT CHECK
========================= */
window.DYNO_getConn_DUAL = async function(){
  try{
    await fetchJSON(`${ESP_HOST}/status`, {}, 900);
    return { connected:true, ip:"192.168.4.1", via:"/status" };
  }catch(e){
    try{
      await fetchJSON(`${ESP_HOST}/snapshot`, {}, 900);
      return { connected:true, ip:"192.168.4.1", via:"/snapshot" };
    }catch{
      return { connected:false, ip:"192.168.4.1" };
    }
  }
};

/* =========================
   SNAPSHOT
========================= */
window.DYNO_getSnapshot_DUAL = async function(){
  const sn = await fetchJSON(`${ESP_HOST}/snapshot`, {}, 1200);
  return mapSnapshot(sn) || sn;
};

/* =========================
   ROWS (optional)
========================= */
window.DYNO_getRowsSince_DUAL = async function(sinceSeq = 0){
  return { seq: Number(sinceSeq)||0, rows: [] };
};

/* =========================
   CONFIG
   - kirim dua gaya param agar cocok semua firmware
========================= */
window.DYNO_setConfig_DUAL = async function(cfg){
  const targetM  = Number(cfg?.targetM ?? 200) || 200;
  const circM    = Number(cfg?.circM ?? 1.85) || 1.85;
  const weightKg = Number(cfg?.weightKg ?? 120) || 120;
  const pprFront = Number(cfg?.pprFront ?? 1) || 1;
  const pprRear  = Number(cfg?.pprRear  ?? 1) || 1;

  const q = new URLSearchParams({
    // gaya “baru” (yang web kamu pakai)
    targetM:  String(targetM),
    circM:    String(circM),
    weightKg: String(weightKg),
    pprFront: String(pprFront),
    pprRear:  String(pprRear),

    // gaya “lama” (firmware kamu sebelumnya)
    circ: String(circM),
    pprf: String(pprFront),
    pprr: String(pprRear),
  }).toString();

  try{
    return await fetchJSON(`${ESP_HOST}/config?${q}`, {}, 1400);
  }catch{
    return { ok:false, reason:"NO_CONFIG_ENDPOINT" };
  }
};

async function tryGET(paths, timeoutMs = 1400){
  for (const p of paths){
    try{
      const j = await fetchJSON(`${ESP_HOST}${p}`, {}, timeoutMs);
      return { ok:true, path:p, j };
    }catch{}
  }
  return { ok:false };
}

/* =========================
   ARM / RUN / STOP
========================= */
window.DYNO_arm_DUAL = async function(cfg){
  try{ await window.DYNO_setConfig_DUAL(cfg); }catch{}
  const r = await tryGET(["/arm", "/reset"], 1400);
  return r.ok ? { ok:true, ...r } : { ok:false, reason:"NO_ARM_ENDPOINT" };
};

window.DYNO_run_DUAL = async function(){
  const r = await tryGET(["/run", "/start"], 1400);
  return r.ok ? { ok:true, ...r } : { ok:false, reason:"NO_RUN_ENDPOINT" };
};

window.DYNO_stop_DUAL = async function(){
  const r = await tryGET(["/stop", "/halt"], 1400);
  return r.ok ? { ok:true, ...r } : { ok:false, reason:"NO_STOP_ENDPOINT" };
};
