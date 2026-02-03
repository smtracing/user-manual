/* =========================================================
   esp-api-dyno.js — AP MODE ONLY (FORCE CONNECT)
   - online=true kalau GET /status berhasil (tanpa syarat)
   - fallback: kalau /status gagal, coba /snapshot
========================================================= */

console.log("%c[ESP-API-DYNO] AP ONLY (192.168.4.1) FORCE CONNECT", "color:#4cff8f");

const ESP_HOST_DYNO = "http://192.168.4.1";
const ESP_FETCH_TIMEOUT_MS = 1200;

async function fetchJSON(url, opt = {}, timeoutMs = ESP_FETCH_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { cache:"no-store", ...opt, signal: ctrl.signal });
    if (!res.ok) throw new Error("HTTP_" + res.status);
    const txt = await res.text();
    try { return JSON.parse(txt); } catch { return { _raw: txt }; }
  } finally {
    clearTimeout(t);
  }
}

window.getESPStatus_DYNO = async function () {
  const out = { online:false, engine_running:false, active_dev:"dyno", ip:"192.168.4.1" };

  // 1) /status -> kalau tembus, online=true tanpa syarat
  try {
    const st = await fetchJSON(`${ESP_HOST_DYNO}/status`, {}, 900);
    out.online = true;

    if (st && typeof st.engine_running !== "undefined") out.engine_running = !!st.engine_running;
    else if (st && typeof st.rpm !== "undefined") out.engine_running = (Number(st.rpm) || 0) > 0;

    if (st && st.ip) out.ip = String(st.ip);
    return out;
  } catch {}

  // 2) fallback /snapshot
  try {
    const sn = await fetchJSON(`${ESP_HOST_DYNO}/snapshot`, {}, 900);
    out.online = true;

    if (sn) {
      const rv  = (sn.rpm_valid === 1 || sn.rpm_valid === true || sn.rpm_valid === "1");
      const rpm = Number(sn.rpm) || 0;
      out.engine_running = rv && rpm > 0;
    }
    return out;
  } catch {
    return out;
  }
};

window.getDynoSnapshot = async function () {
  return await fetchJSON(`${ESP_HOST_DYNO}/snapshot`, {}, 1200);
};

// opsional: kalau UI perlu rpm cepat, tinggal pakai snapshot
window.getLiveRPM_DYNO = async function () {
  try {
    const sn = await window.getDynoSnapshot();
    return Math.max(0, Math.floor(Number(sn && sn.rpm ? sn.rpm : 0) || 0));
  } catch {
    return 0;
  }
};

window.resetDyno = async function () {
  try {
    const j = await fetchJSON(`${ESP_HOST_DYNO}/reset`, {}, 1200);
    return { ok:true, j };
  } catch (e) {
    return { ok:false, reason: (e && e.message) ? e.message : "RESET_FAIL" };
  }
};
