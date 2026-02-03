/* =========================================================
   esp-api-dual.js — DYNO AP MODE (192.168.4.1)
   - "TERHUBUNG" jika GET /status OK (fallback /snapshot)
   - API NAMA yang dipakai dyno-road.js:
       DYNO_getConn_DUAL
       DYNO_getSnapshot_DUAL
       DYNO_setConfig_DUAL
       DYNO_arm_DUAL
       DYNO_run_DUAL
       DYNO_stop_DUAL
========================================================= */

console.log("%c[ESP-API-DYNO] AP ONLY (192.168.4.1) — firmware timer gated", "color:#4cff8f");

const ESP_HOST_DYNO = "http://192.168.4.1";
const ESP_FETCH_TIMEOUT_MS = 1200;

/* =========================
   FETCH HELPER (timeout + json safe)
========================= */
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

/* =========================================================
   CONNECT CHECK
========================================================= */
window.DYNO_getConn_DUAL = async function () {
  try {
    await fetchJSON(`${ESP_HOST_DYNO}/status`, {}, 900);
    return { connected: true, ip: "192.168.4.1", via: "/status" };
  } catch {
    try {
      await fetchJSON(`${ESP_HOST_DYNO}/snapshot`, {}, 900);
      return { connected: true, ip: "192.168.4.1", via: "/snapshot" };
    } catch {
      return { connected: false, ip: "192.168.4.1" };
    }
  }
};

/* =========================================================
   SNAPSHOT MAPPER (robust)
   - Firmware mengirim camelCase + snake_case.
========================================================= */
function mapSnapshotFields(sn) {
  if (!sn) return null;

  const out = {};

  // state
  out.armed   = !!(sn.armed ?? sn.is_armed ?? sn.arm ?? false);
  out.running = !!(sn.running ?? sn.is_running ?? sn.run ?? false);

  // gate
  out.gateWait   = !!(sn.gateWait ?? sn.gate_wait ?? sn.waitGate ?? false);
  out.gatePulses = Number(sn.gatePulses ?? sn.gate_pulses ?? sn.gateP ?? 0) || 0;

  // time / dist / speed (FIRMWARE)
  out.t        = Number(sn.t ?? sn.t_s ?? sn.time_s ?? sn.time ?? 0) || 0;
  out.distM    = Number(sn.distM ?? sn.dist_m ?? sn.dist ?? 0) || 0;
  out.speedKmh = Number(sn.speedKmh ?? sn.speed_kmh ?? sn.speed ?? 0) || 0;

  // raw totals (optional; debug)
  out.front_total = Number(sn.front_total ?? sn.frontTotal ?? 0) || 0;
  out.rear_total  = Number(sn.rear_total  ?? sn.rearTotal  ?? 0) || 0;
  out.ts_ms       = Number(sn.ts_ms ?? 0) || 0;

  // rpm / power / ign / afr
  out.rpm     = Number(sn.rpm ?? 0) || 0;
  out.tq      = Number(sn.tq ?? sn.torque ?? 0) || 0;
  out.hp      = Number(sn.hp ?? sn.power ?? 0) || 0;
  out.ign     = Number(sn.ign ?? sn.ignition ?? 0) || 0;
  out.afr     = Number(sn.afr ?? 14.7);

  // max
  out.maxTQ   = Number(sn.maxTQ ?? sn.max_tq ?? 0) || 0;
  out.maxHP   = Number(sn.maxHP ?? sn.max_hp ?? 0) || 0;

  // meta
  out.targetM   = Number(sn.targetM ?? sn.target_m ?? 0) || 0;
  out.rowsCount = Number(sn.rowsCount ?? sn.rows_count ?? 0) || 0;
  out.seq       = Number(sn.seq ?? sn.lastSeq ?? 0) || 0;

  // teks status
  out.statusText = String(sn.statusText ?? sn.status ?? "");

  // =======================================================
  // ✅ SLIP (100% dari firmware)
  // Firmware disarankan mengirim:
  //  - slipPct / slip_pct (number)
  //  - slipOver / slip_over (bool) optional
  //  - slipStatus / slip_status (string) optional, contoh: "OVER"
  // =======================================================
  const slipPct = Number(sn.slipPct ?? sn.slip_pct ?? sn.slip ?? NaN);
  out.slipPct = isFinite(slipPct) ? slipPct : 0;

  const slipOver = (sn.slipOver ?? sn.slip_over);
  out.slipOver = (typeof slipOver === "boolean") ? slipOver : (out.slipPct > 500);

  const slipOn = (sn.slipOn ?? sn.slip_on);
  out.slipOn = (typeof slipOn === "boolean") ? slipOn : (out.slipPct > 5);

  out.slipStatus = String(sn.slipStatus ?? sn.slip_status ?? (out.slipOver ? "OVER" : ""));

  return out;
}

window.DYNO_getSnapshot_DUAL = async function () {
  const sn = await fetchJSON(`${ESP_HOST_DYNO}/snapshot`, {}, 1200);
  return mapSnapshotFields(sn) || sn;
};

/* =========================================================
   CONFIG
   - Firmware menerima: targetM/circM/pprFront/pprRear/weightKg
   - Kita kirim juga alias: target/circ/pprf/pprr/weight
========================================================= */
window.DYNO_setConfig_DUAL = async function (cfg) {
  const targetM  = String(cfg?.targetM ?? 200);
  const circM    = String(cfg?.circM ?? 1.85);
  const weightKg = String(cfg?.weightKg ?? 120);
  const pprFront = String(cfg?.pprFront ?? 1);
  const pprRear  = String(cfg?.pprRear  ?? 1);

  const q =
    `targetM=${encodeURIComponent(targetM)}` +
    `&target=${encodeURIComponent(targetM)}` +
    `&circM=${encodeURIComponent(circM)}` +
    `&circ=${encodeURIComponent(circM)}` +
    `&pprFront=${encodeURIComponent(pprFront)}` +
    `&pprf=${encodeURIComponent(pprFront)}` +
    `&pprRear=${encodeURIComponent(pprRear)}` +
    `&pprr=${encodeURIComponent(pprRear)}` +
    `&weightKg=${encodeURIComponent(weightKg)}` +
    `&weight=${encodeURIComponent(weightKg)}`;

  try {
    return await fetchJSON(`${ESP_HOST_DYNO}/config?${q}`, {}, 1200);
  } catch {
    return { ok: false, reason: "NO_CONFIG_ENDPOINT" };
  }
};

/* =========================================================
   ARM / RUN / STOP
========================================================= */
async function tryGET(paths, timeoutMs = 1200) {
  for (const p of paths) {
    try {
      const j = await fetchJSON(`${ESP_HOST_DYNO}${p}`, {}, timeoutMs);
      return { ok: true, j, path: p };
    } catch {}
  }
  return { ok: false };
}

window.DYNO_arm_DUAL = async function (cfg) {
  try { await window.DYNO_setConfig_DUAL(cfg); } catch {}

  const r = await tryGET(["/arm", "/reset", "/ready"], 1400);
  return r.ok ? { ok: true, ...r } : { ok: false, reason: "NO_ARM_ENDPOINT" };
};

window.DYNO_run_DUAL = async function () {
  const r = await tryGET(["/run", "/start"], 1400);
  return r.ok ? { ok: true, ...r } : { ok: false, reason: "NO_RUN_ENDPOINT" };
};

window.DYNO_stop_DUAL = async function (_reason = "STOP") {
  const r = await tryGET(["/stop", "/halt"], 1400);
  return r.ok ? { ok: true, ...r } : { ok: false, reason: "NO_STOP_ENDPOINT" };
};
