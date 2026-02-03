/* =========================================================
   esp-api-dyno.js — AP MODE ONLY (FORCE CONNECT)
   - FIX host AP ESP32: http://192.168.4.1
   - KONEK TANPA SYARAT: kalau fetch /status berhasil -> online=true
   - Fallback: /snapshot (kalau /status belum ada / error)
   Endpoint firmware:
     GET /status
     GET /snapshot
     GET /reset
     GET /config?...
========================================================= */

console.log("%c[ESP-API-DYNO] MODE: AP ONLY (192.168.4.1) FORCE CONNECT", "color:#4cff8f");

const ESP_HOST_DYNO = "http://192.168.4.1";
const ESP_FETCH_TIMEOUT_MS = 1200;

/* =========================
   FETCH HELPER
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
   STATUS DYNO (FORCE)
   - online true jika /status bisa di-fetch
========================================================= */
window.getESPStatus_DYNO = async function () {
  // Default: offline
  let out = {
    online: false,
    engine_running: false,
    active_dev: "dyno",   // label bebas
    ip: "192.168.4.1"
  };

  // 1) coba /status
  try {
    const st = await fetchJSON(`${ESP_HOST_DYNO}/status`, {}, 900);

    // KONEK TANPA SYARAT: asal fetch sukses
    out.online = true;

    // engine_running kalau ada (opsional)
    if (st && typeof st.engine_running !== "undefined") {
      out.engine_running = !!st.engine_running;
    } else if (st && typeof st.rpm !== "undefined") {
      out.engine_running = (Number(st.rpm) || 0) > 0;
    }

    // ambil info tambahan kalau ada
    if (st && st.ip) out.ip = String(st.ip);
    return out;

  } catch (e) {
    // 2) fallback /snapshot (kalau firmware hanya punya snapshot)
    try {
      const sn = await fetchJSON(`${ESP_HOST_DYNO}/snapshot`, {}, 900);
      out.online = true;

      // engine_running dari rpm_valid/rpm
      if (sn) {
        const rv = (sn.rpm_valid === 1 || sn.rpm_valid === true || sn.rpm_valid === "1");
        const rpm = Number(sn.rpm) || 0;
        out.engine_running = rv && rpm > 0;
      }
      return out;

    } catch {
      return out;
    }
  }
};

/* =========================================================
   SNAPSHOT RAW (untuk dyno-road.js)
   return:
     {ts_ms, front_total, rear_total, rpm, rpm_valid, ...}
========================================================= */
window.getDynoSnapshot = async function () {
  return await fetchJSON(`${ESP_HOST_DYNO}/snapshot`, {}, 1200);
};

/* =========================================================
   OPTIONAL: reset counter
========================================================= */
window.resetDyno = async function () {
  try {
    const j = await fetchJSON(`${ESP_HOST_DYNO}/reset`, {}, 1200);
    return { ok: true, j };
  } catch (e) {
    return { ok: false, reason: (e && e.message) ? e.message : "RESET_FAIL" };
  }
};
