/* =========================================================
   esp-api-dual.js — AP MODE ONLY (NO SIM)
   - FIX host AP ESP32: http://192.168.4.1
   - Cocok untuk mode ESP32 AP (gateway selalu 192.168.4.1)
   - Endpoint sesuai firmware kamu:
     GET  /status
     GET  /map-dual
     POST /map-dual
     GET  /live          (rpm, map, degree, ign_us, scr_us, limiter, dll)
========================================================= */

console.log("%c[ESP-API-DUAL] MODE: AP ONLY (192.168.4.1)", "color:#4cff8f");

const ESP_HOST_DUAL = "http://192.168.4.1";
const ESP_FETCH_TIMEOUT_MS = 1200;

/* =========================================================
   FETCH HELPER (timeout + json safe)
========================================================= */
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
   STATUS CDI DUAL (REAL - AP)
   expected minimal:
   { online:true, engine_running:false, active_cdi:"dual" }
========================================================= */
window.getESPStatus_DUAL = async function () {
  try {
    const st = await fetchJSON(`${ESP_HOST_DUAL}/status`);
    return {
      online: !!(st && (st.online === true || st.online === 1 || st.online === "1")),
      engine_running: !!(st && st.engine_running),
      active_cdi: (st && st.active_cdi) ? String(st.active_cdi) : ""
    };
  } catch {
    return { online: false, engine_running: false, active_cdi: "" };
  }
};

/* =========================================================
   READ MAP DATA (REAL - AP)
   expected:
   {
     pickup: 78,
     maps: [
       { limiter: xxxx, curve:[...79 points (500..20000 step 250)] },
       { limiter: xxxx, curve:[...79 points] }
     ],
     status:"ACTIVE"
   }
========================================================= */
window.getMapFromESP_DUAL = async function () {
  const data = await fetchJSON(`${ESP_HOST_DUAL}/map-dual`, {}, 1800);

  if (!data || !Array.isArray(data.maps) || data.maps.length < 2) {
    throw new Error("BAD_MAP_DATA");
  }
  return data;
};

/* =========================================================
   SEND MAP KE ESP (REAL - AP)
========================================================= */
window.sendMapToESP_DUAL = async function (mapData) {
  try {
    const res = await fetchJSON(`${ESP_HOST_DUAL}/map-dual`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(mapData)
    }, 2500);

    if (res && res.ok === false) throw new Error("SEND_FAIL");
    return { ok: true, res };
  } catch (err) {
    console.warn("[ESP SEND FAIL DUAL]", err && err.message ? err.message : err);
    return { ok: false, reason: (err && err.message) ? err.message : "SEND_FAIL" };
  }
};

/* =========================================================
   LIVE RPM (REAL - AP)
   - firmware kamu pakai GET /live
   - return rpm integer (0 kalau offline)
========================================================= */
window.getLiveRPM_DUAL = async function () {
  try {
    const j = await fetchJSON(`${ESP_HOST_DUAL}/live`, {}, 900);
    const v = (j && typeof j.rpm !== "undefined") ? j.rpm : 0;
    const rpm = Math.max(0, Math.floor(Number(v) || 0));
    return rpm;
  } catch {
    return 0;
  }
};

/* =========================================================
   LIVE AFR (AP)
   - Kalau firmware belum punya AFR endpoint, kembalikan 0
   - (cdi-dual.js kamu aman: kalau 0 dianggap tidak ada AFR)
========================================================= */
window.getLiveAFR_DUAL = async function (_currentRPM = 0) {
  return 0;
};

/* =========================================================
   OPTIONAL: info live detail (kalau kamu butuh)
   - dipakai kalau mau baca degree/ign/scr/limiter dari /live
========================================================= */
window.getLiveDetail_DUAL = async function () {
  try {
    return await fetchJSON(`${ESP_HOST_DUAL}/live`, {}, 900);
  } catch {
    return null;
  }
};
