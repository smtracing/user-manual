/* =========================================================
   esp-api-dual.js — REAL ONLY (NO SIM)
   Target firmware: A3M.ino (ESP32-S3 AP 192.168.4.1)

   ✅ Endpoint yang dipakai (sesuai A3M.ino):
      GET /status
      GET /snapshot
      GET /config?targetM=&circM=&pprFront=&weightKg=
      GET /arm
      GET /run
      GET /stop
      GET /reset

   ✅ History log (RAM):
      GET /logs_meta
      GET /logs?id=N      (firmware kirim: "samples":[...])
      GET /logs_clear

   ✅ Kompatibel dengan dyno-road.js:
      - window.DYNO_getLogsMeta_DUAL()
      - window.DYNO_getLog_DUAL(id)  -> return { ok, id, rows:[...] }
      - window.DYNO_clearLogs_DUAL()
========================================================= */

console.log("✅ esp-api-dual.js dimuat (REAL ONLY / NO SIM)");

(function(){
  "use strict";

  const BASE_URL = "http://192.168.4.1";

  async function fetchJson(path, timeoutMs = 1200){
    const url = BASE_URL + path;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);

    try{
      const r = await fetch(url, {
        method: "GET",
        cache: "no-store",
        mode: "cors",
        signal: ctrl.signal
      });
      if (!r.ok) throw new Error("HTTP " + r.status);
      return await r.json();
    } finally {
      clearTimeout(t);
    }
  }

  // =========================================================
  // Conn / Snapshot
  // =========================================================

  // OPTIONAL (tidak dipakai dyno-road.js saat ini, tapi aman disediakan)
  window.DYNO_getConn_DUAL = async function(){
    try{
      const s = await fetchJson("/status", 900);
      const online = !!(s && s.online);
      const ip = (s && s.ip) ? String(s.ip) : "192.168.4.1";
      return {
        connected: online,
        online,
        ip,
        running: !!(s && s.running),
        armed:   !!(s && s.armed),
        raw: s
      };
    } catch(e){
      return { connected:false, online:false, ip:"", running:false, armed:false, err:String(e && e.message || e) };
    }
  };

  window.DYNO_getSnapshot_DUAL = async function(){
    try{
      return await fetchJson("/snapshot", 900);
    } catch(e){
      return null;
    }
  };

  // =========================================================
  // Control (config / arm / run / stop / reset)
  // =========================================================

  window.DYNO_setConfig_DUAL = async function(cfg){
    try{
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

      return await fetchJson("/config" + qs, 1500);
    } catch(e){
      return { ok:false, err:"config_failed", detail:String(e && e.message || e) };
    }
  };

  window.DYNO_arm_DUAL = async function(){
    try{
      return await fetchJson("/arm", 1200);
    } catch(e){
      return { ok:false, err:"arm_failed", detail:String(e && e.message || e) };
    }
  };

  window.DYNO_run_DUAL = async function(){
    try{
      return await fetchJson("/run", 1200);
    } catch(e){
      return { ok:false, err:"run_failed", detail:String(e && e.message || e) };
    }
  };

  window.DYNO_stop_DUAL = async function(){
    try{
      return await fetchJson("/stop", 1200);
    } catch(e){
      return { ok:false, err:"stop_failed", detail:String(e && e.message || e) };
    }
  };

  window.DYNO_reset_DUAL = async function(){
    try{
      return await fetchJson("/reset", 1200);
    } catch(e){
      return { ok:false, err:"reset_failed", detail:String(e && e.message || e) };
    }
  };

  // =========================================================
  // LOGS API (A3M.ino)
  // =========================================================

  window.DYNO_getLogsMeta_DUAL = async function(){
    try{
      // firmware: {ok:1,count:n,logs:[{id,rows,startMs,endTime_s,endDist_m,maxHP,maxTQ},...]}
      return await fetchJson("/logs_meta", 1500);
    } catch(e){
      return { ok:false, err:"logs_meta_failed", detail:String(e && e.message || e), logs:[] };
    }
  };

  window.DYNO_getLog_DUAL = async function(id){
    try{
      const nid = Number(id || 0);
      if (!nid) return { ok:false, err:"bad_id", id:id, rows:[] };

      // firmware: {ok:1,id,rows,maxHP,maxTQ,samples:[{t_s,dist_m,speed_kmh,rpm,hp,tq},...]}
      const data = await fetchJson("/logs?id=" + encodeURIComponent(String(nid)), 2500);

      if (!data || !data.ok){
        return { ok:false, err:(data && data.err) ? data.err : "log_fetch_failed", id:nid, rows:[] };
      }

      // ✅ dyno-road.js butuh data.rows (array). Firmware kirim "samples".
      const samples = Array.isArray(data.samples) ? data.samples : [];
      const rows = samples.map(s => ({
        t_s: Number(s.t_s ?? 0) || 0,
        t:   Number(s.t_s ?? 0) || 0,
        dist_m: Number(s.dist_m ?? 0) || 0,
        dist:   Number(s.dist_m ?? 0) || 0,
        speed_kmh: Number(s.speed_kmh ?? 0) || 0,
        spd:       Number(s.speed_kmh ?? 0) || 0,
        rpm: Number(s.rpm ?? 0) || 0,
        hp:  Number(s.hp ?? 0) || 0,
        tq:  Number(s.tq ?? 0) || 0
      }));

      return {
        ok:true,
        id: Number(data.id ?? nid) || nid,
        rows,
        maxHP: Number(data.maxHP ?? 0) || 0,
        maxTQ: Number(data.maxTQ ?? 0) || 0,
        raw: data
      };

    } catch(e){
      return { ok:false, err:"log_failed", detail:String(e && e.message || e), id:Number(id||0), rows:[] };
    }
  };

  window.DYNO_clearLogs_DUAL = async function(){
    try{
      // firmware: {ok:1,logs_clear:1}
      return await fetchJson("/logs_clear", 1500);
    } catch(e){
      return { ok:false, err:"logs_clear_failed", detail:String(e && e.message || e) };
    }
  };

  // =========================================================
  // OPTIONAL: baca semua log sekali jalan (kalau nanti dibutuhkan)
  // =========================================================
  window.DYNO_readAll_DUAL = async function(){
    try{
      const meta = await window.DYNO_getLogsMeta_DUAL();
      const list = (meta && Array.isArray(meta.logs)) ? meta.logs : [];
      const logsSorted = list.slice().sort((a,b)=> (Number(b.id||0)-Number(a.id||0)));

      const out = [];
      for (let i=0; i<logsSorted.length; i++){
        const id = Number(logsSorted[i].id || 0);
        if (!id) continue;
        const data = await window.DYNO_getLog_DUAL(id);
        out.push({ id, rows: Array.isArray(data.rows) ? data.rows : [] });
      }
      return { ok:true, count: out.length, logs: out, meta };
    } catch(e){
      return { ok:false, err:"read_failed", detail:String(e && e.message || e) };
    }
  };

  window.DYNO_read_DUAL = window.DYNO_readAll_DUAL;

})();
