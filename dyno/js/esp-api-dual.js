console.log("✅ esp-api-dual.js dimuat (FRONT ONLY API)");

// =========================================================
// esp-api-dual.js — HTTP API Wrapper (ESP32 AP: 192.168.4.1)
// - dipakai oleh dyno-road.html + dyno-road.js
// - semua request: GET
// =========================================================

(function(){
  // base IP ESP32 AP
  const BASE_URL = "http://192.168.4.1";

  // helper: fetch JSON dengan timeout
  async function fetchJson(path, timeoutMs = 800){
    const url = BASE_URL + path;

    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);

    try{
      const r = await fetch(url, { method:"GET", cache:"no-store", signal: ctrl.signal });
      if (!r.ok) throw new Error("HTTP " + r.status);
      return await r.json();
    } finally {
      clearTimeout(t);
    }
  }

  // =========================================================
  // KONEKSI (dipakai indikator CONNECTED di HTML)
  // return: {connected:boolean, ip:string, online:boolean, running:boolean, armed:boolean, raw?:object}
  // =========================================================
  window.DYNO_getConn_DUAL = async function(){
    try{
      const s = await fetchJson("/status", 800);

      // Firmware kamu mengirim {"online":true, "ip":"...", "running":..., "armed":...}
      const online = !!(s && s.online);
      const ip = (s && s.ip) ? String(s.ip) : BASE_URL.replace("http://", "");

      return {
        connected: online,
        online,
        ip,
        running: !!(s && s.running),
        armed:   !!(s && s.armed),
        raw: s
      };
    } catch(e){
      return { connected:false, online:false, ip:"", running:false, armed:false };
    }
  };

  // =========================================================
  // SNAPSHOT (dipakai polling dyno-road.js)
  // return: JSON snapshot firmware
  // =========================================================
  window.DYNO_getSnapshot_DUAL = async function(){
    return await fetchJson("/snapshot", 800);
  };

  // =========================================================
  // CONFIG (dipakai sebelum RUN)
  // cfg: {targetM, circM, pprFront, weightKg}
  // =========================================================
  window.DYNO_setConfig_DUAL = async function(cfg){
    cfg = cfg || {};
    const targetM  = Number(cfg.targetM ?? 200);
    const circM    = Number(cfg.circM ?? 1.85);
    const pprFront = Number(cfg.pprFront ?? 1);
    const weightKg = Number(cfg.weightKg ?? 120);

    const qs =
      "?targetM="  + encodeURIComponent(targetM) +
      "&circM="    + encodeURIComponent(circM) +
      "&pprFront=" + encodeURIComponent(pprFront) +
      "&weightKg=" + encodeURIComponent(weightKg);

    return await fetchJson("/config" + qs, 1000);
  };

  // =========================================================
  // RUN / ARM / STOP / RESET
  // =========================================================
  window.DYNO_run_DUAL = async function(){
    return await fetchJson("/run", 1000);
  };

  // kompatibilitas (kalau ada UI lama yang masih panggil ARM)
  window.DYNO_arm_DUAL = async function(){
    return await fetchJson("/arm", 1000);
  };

  window.DYNO_stop_DUAL = async function(){
    return await fetchJson("/stop", 1000);
  };

  window.DYNO_reset_DUAL = async function(){
    return await fetchJson("/reset", 1000);
  };

})();
