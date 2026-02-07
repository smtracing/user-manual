/* =========================================================
   esp-api-dual.js — REAL + AUTO SIM (HARD PULSE) [FRONT ONLY] + READ SIM
   - Tidak perlu ?sim=1
   - Tidak perlu ubah dyno-road.html
   - AUTO:
      * Jika ESP32 (192.168.4.1) bisa diakses => REAL mode
      * Jika gagal beberapa kali => SIM mode (connected palsu)
      * Jika ESP32 kembali online => balik REAL mode

   UPDATE:
   ✅ Tambah API tombol READ:
      - window.DYNO_readAll_DUAL()  (utama)
      - window.DYNO_read_DUAL()     (alias kompatibilitas)

   ✅ SIM dipercepat & SKIP gate_wait (tidak nunggu 1 putaran)
========================================================= */

console.log("✅ esp-api-dual.js dimuat (REAL + AUTO SIM HARD PULSE + READ SIM)");

(function(){
  "use strict";

  const BASE_URL = "http://192.168.4.1";

  // ===== Auto mode switching =====
  const AUTO = {
    mode: "real",          // "real" | "sim"
    failCount: 0,
    successCount: 0,

    // switching thresholds
    FAIL_TO_SIM: 2,        // gagal beruntun berapa kali -> masuk SIM
    SUCCESS_TO_REAL: 2,    // sukses beruntun berapa kali -> balik REAL

    // status cache
    lastRealStatus: null,
    lastRealSnapshot: null,
    lastConn: { connected:false, online:false, ip:"", running:false, armed:false }
  };

  // ---- Real fetch helper (GET json)
  async function fetchJson(path, timeoutMs = 900){
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

  function nowMs(){
    return (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
  }
  function clamp(v,a,b){ return Math.max(a, Math.min(b, v)); }

  function setMode(newMode){
    if (AUTO.mode === newMode) return;
    AUTO.mode = newMode;
    if (newMode === "sim"){
      console.log("🧪 AUTO-SIM AKTIF (ESP tidak terjangkau) => grafik & log jalan pakai SIM");
      simResetAll(); // mulai dari bersih saat masuk SIM
    } else {
      console.log("🔌 REAL MODE AKTIF (ESP terjangkau) => data dari firmware");
    }
  }

  function onRealSuccess(){
    AUTO.failCount = 0;
    AUTO.successCount++;
    if (AUTO.mode === "sim" && AUTO.successCount >= AUTO.SUCCESS_TO_REAL){
      setMode("real");
      AUTO.successCount = 0;
    }
  }

  function onRealFail(){
    AUTO.successCount = 0;
    AUTO.failCount++;
    if (AUTO.mode === "real" && AUTO.failCount >= AUTO.FAIL_TO_SIM){
      setMode("sim");
      AUTO.failCount = 0;
    }
  }

  // =========================================================
  // SIM ENGINE (HARD PULSE / DISCRETE)
  // =========================================================
  const SIM = {
    // connection
    online:true,
    ip:"SIM",

    // state
    armed:false,
    running:false,

    // config
    targetM:200,
    circM:1.85,
    pprFront:1,
    weightKg:120,

    // gate (SIM: kita SKIP gate_wait)
    gate_wait:false,
    gate_pulses:1,
    gate_count:0,

    // timing
    t0ms:0,
    t_s:0,

    // motion
    dist_m:0,
    speed_kmh:0,
    rpm:0,

    // outputs
    tq:0,
    hp:0,
    maxHP:0,
    maxTQ:0,

    // internal
    _runStartMs:0,
    _lastMs:0,

    // pulse accumulators
    _wheelPulseFrac:0,
    _rpmPulseFrac:0,

    // measurement windows (lebih cepat update biar UI hidup)
    _wWinMs:50,
    _rWinMs:50,
    _wWinStart:0,
    _rWinStart:0,
    _wPulseCount:0,
    _rPulseCount:0,

    // rpm pulse per rev (SIM only)
    rpmPPR:1,

    // speed multiplier (SIM dipercepat)
    SPEEDUP: 3.0,

    statusText:"READY (SIM)"
  };

  // ===== SIM LOG STORAGE (untuk tombol READ) =====
  const SIMLOG = {
    maxLogs: 20,
    logs: [],        // array of { id, ts_ms, meta:{targetM,circM,pprFront,weightKg}, rows:[...] }
    current: null,   // log yang sedang berjalan
    nextId: 1
  };

  function simNewLog(){
    const id = SIMLOG.nextId++;
    const meta = {
      targetM: SIM.targetM,
      circM: SIM.circM,
      pprFront: SIM.pprFront,
      weightKg: SIM.weightKg
    };
    SIMLOG.current = {
      id,
      ts_ms: Date.now(),
      meta,
      rows: []
    };
  }

  function simPushRow(){
    if (!SIMLOG.current) return;
    // format row “umum” supaya gampang dipakai dyno-road.js
    SIMLOG.current.rows.push({
      t: SIM.t_s,
      t_s: SIM.t_s,
      dist: SIM.dist_m,
      dist_m: SIM.dist_m,
      spd: SIM.speed_kmh,
      speed: SIM.speed_kmh,
      speed_kmh: SIM.speed_kmh,
      rpm: SIM.rpm,
      hp: SIM.hp,
      tq: SIM.tq
    });
  }

  function simFinalizeLog(){
    if (!SIMLOG.current) return;
    // jangan simpan log kosong
    if (SIMLOG.current.rows.length > 2){
      SIMLOG.logs.unshift(SIMLOG.current); // taruh paling atas (terbaru dulu)
      if (SIMLOG.logs.length > SIMLOG.maxLogs) SIMLOG.logs.length = SIMLOG.maxLogs;
    }
    SIMLOG.current = null;
  }

  function simResetAll(){
    SIM.armed = false;
    SIM.running = false;

    SIM.targetM   = Number(SIM.targetM) || 200;
    SIM.circM     = Number(SIM.circM) || 1.85;
    SIM.pprFront  = Math.max(1, Math.round(Number(SIM.pprFront) || 1));
    SIM.weightKg  = Math.max(1, Math.round(Number(SIM.weightKg) || 120));

    SIM.gate_pulses = Math.max(1, Math.round(SIM.pprFront));
    SIM.gate_wait = false;      // SIM: selalu false
    SIM.gate_count = 0;

    SIM.t0ms = 0;
    SIM.t_s = 0;

    SIM.dist_m = 0;
    SIM.speed_kmh = 0;
    SIM.rpm = 0;

    SIM.tq = 0;
    SIM.hp = 0;
    SIM.maxHP = 0;
    SIM.maxTQ = 0;

    SIM._runStartMs = 0;
    SIM._lastMs = 0;

    SIM._wheelPulseFrac = 0;
    SIM._rpmPulseFrac = 0;

    SIM._wWinStart = 0;
    SIM._rWinStart = 0;
    SIM._wPulseCount = 0;
    SIM._rPulseCount = 0;

    SIM.statusText = "READY (SIM)";

    // reset logs juga (biar reset di web bersih total)
    SIMLOG.logs = [];
    SIMLOG.current = null;
    SIMLOG.nextId = 1;
  }

  function simConfig(cfg){
    cfg = cfg || {};
    const t = Number(cfg.targetM);
    const c = Number(cfg.circM);
    const p = Number(cfg.pprFront);
    const w = Number(cfg.weightKg);

    if (isFinite(t) && t > 0) SIM.targetM = t;
    if (isFinite(c) && c > 0) SIM.circM = c;
    if (isFinite(p) && p > 0) SIM.pprFront = Math.max(1, Math.round(p));
    if (isFinite(w) && w > 0) SIM.weightKg = Math.max(1, Math.round(w));

    SIM.gate_pulses = Math.max(1, Math.round(SIM.pprFront));
    SIM.gate_wait = false; // SIM: tetap skip gate
    return { ok:true, targetM:SIM.targetM, circM:SIM.circM, pprFront:SIM.pprFront, weightKg:SIM.weightKg };
  }

  function simArm(){
    SIM.armed = true;
    SIM.statusText = "ARMED (SIM)";
    return { ok:true, armed:true, running:SIM.running };
  }

  function simRun(){
    const ms = nowMs();

    // kalau ada log sebelumnya yang masih "current", finalize dulu
    simFinalizeLog();

    SIM.armed = true;
    SIM.running = true;

    SIM._runStartMs = ms;
    SIM._lastMs = ms;

    SIM.gate_pulses = Math.max(1, Math.round(SIM.pprFront || 1));
    SIM.gate_wait = false;      // ✅ SKIP gate_wait untuk SIM
    SIM.gate_count = 0;

    SIM.t0ms = ms;              // ✅ time langsung mulai
    SIM.t_s = 0;

    SIM.dist_m = 0;
    SIM.speed_kmh = 0;
    SIM.rpm = 0;

    SIM.tq = 0;
    SIM.hp = 0;
    SIM.maxHP = 0;
    SIM.maxTQ = 0;

    SIM._wheelPulseFrac = 0;
    SIM._rpmPulseFrac = 0;

    SIM._wWinStart = ms;
    SIM._rWinStart = ms;
    SIM._wPulseCount = 0;
    SIM._rPulseCount = 0;

    SIM.statusText = "RUNNING (SIM)";

    // ✅ buat log baru untuk RUN ini
    simNewLog();

    return { ok:true, armed:true, running:true, gate_wait:false, gate_pulses:SIM.gate_pulses };
  }

  function simStop(){
    SIM.running = false;
    SIM.armed = false;
    SIM.gate_wait = false;
    SIM.statusText = "STOP (SIM)";

    // finalize log saat stop
    simFinalizeLog();

    return { ok:true, armed:false, running:false };
  }

  function torqueFromRPM(rpm){
    rpm = clamp(rpm, 0, 22000);
    const x = clamp(rpm / 20000, 0, 1);
    const bump = Math.sin(Math.PI * x);
    return 16 + 14 * bump; // 16..30..16
  }

  function speedTargetKmh(runT_s, weightKg){
    const w = clamp(Number(weightKg)||120, 30, 500);
    const vmax = 120 - clamp((w - 80) * 0.10, 0, 60);
    const a = 100; // ✅ lebih agresif dari sebelumnya biar cepat
    return clamp(a * runT_s, 0, vmax);
  }

  function rpmTargetFromSpeed(vKmh){
    const x = clamp(vKmh / 120, 0, 1);
    const e = x < 0.5 ? 2*x*x : 1 - Math.pow(-2*x + 2, 2)/2;
    return 2000 + e * 16000;
  }

  function simStep(dt_s, msNow){
    const circ = Math.max(0.05, Number(SIM.circM) || 1.85);
    const ppr  = Math.max(1, Math.round(Number(SIM.pprFront) || 1));
    const targetM = Math.max(1, Number(SIM.targetM) || 200);

    // ✅ SPEEDUP supaya run makin cepat
    const runT = Math.max(0, (msNow - SIM._runStartMs) / 1000) * (SIM.SPEEDUP || 1.0);
    const vTargetKmh = speedTargetKmh(runT, SIM.weightKg);

    // wheel pulses
    const v_mps = (vTargetKmh * 1000) / 3600;
    const wheelRevPerSec = v_mps / circ;
    const wheelPps = wheelRevPerSec * ppr;

    SIM._wheelPulseFrac += wheelPps * dt_s;

    let newWheelPulses = 0;
    if (SIM._wheelPulseFrac >= 1){
      newWheelPulses = Math.floor(SIM._wheelPulseFrac);
      SIM._wheelPulseFrac -= newWheelPulses;
    }

    if (newWheelPulses > 0){
      const distPerPulse = circ / ppr;
      SIM.dist_m += newWheelPulses * distPerPulse;

      SIM._wPulseCount += newWheelPulses;
    }

    // time
    SIM.t_s = Math.max(0, (msNow - SIM.t0ms) / 1000);

    // rpm pulses
    const rpmTarget = rpmTargetFromSpeed(vTargetKmh);
    const rpmPPR = Math.max(1, Math.round(Number(SIM.rpmPPR) || 1));
    const rpmRevPerSec = rpmTarget / 60;
    const rpmPps = rpmRevPerSec * rpmPPR;

    SIM._rpmPulseFrac += rpmPps * dt_s;

    let newRpmPulses = 0;
    if (SIM._rpmPulseFrac >= 1){
      newRpmPulses = Math.floor(SIM._rpmPulseFrac);
      SIM._rpmPulseFrac -= newRpmPulses;
    }
    if (newRpmPulses > 0){
      SIM._rPulseCount += newRpmPulses;
    }

    // speed window
    if ((msNow - SIM._wWinStart) >= SIM._wWinMs){
      const winDt = (msNow - SIM._wWinStart) / 1000;
      const pulses = SIM._wPulseCount;
      const distWin = (pulses / ppr) * circ;
      const vWin_mps = distWin / Math.max(1e-6, winDt);
      SIM.speed_kmh = vWin_mps * 3.6;

      SIM._wWinStart = msNow;
      SIM._wPulseCount = 0;
    }

    // rpm window
    if ((msNow - SIM._rWinStart) >= SIM._rWinMs){
      const winDt = (msNow - SIM._rWinStart) / 1000;
      const pulses = SIM._rPulseCount;

      const rev = pulses / rpmPPR;
      const rps = rev / Math.max(1e-6, winDt);
      SIM.rpm = rps * 60;

      SIM._rWinStart = msNow;
      SIM._rPulseCount = 0;
    }

    // outputs
    SIM.tq = torqueFromRPM(SIM.rpm);
    SIM.hp = (SIM.tq * SIM.rpm) / 7127;

    SIM.maxHP = Math.max(SIM.maxHP || 0, SIM.hp || 0);
    SIM.maxTQ = Math.max(SIM.maxTQ || 0, SIM.tq || 0);

    // ✅ push row ke log (biar READ punya data)
    simPushRow();

    if (SIM.dist_m >= targetM){
      SIM.dist_m = targetM;
      SIM.running = false;
      SIM.armed = false;
      SIM.gate_wait = false;
      SIM.statusText = "AUTO STOP (SIM)";

      // finalize log saat auto stop
      simFinalizeLog();
    } else {
      SIM.statusText = "RUNNING (SIM)";
    }
  }

  function simSnapshot(){
    const ms = nowMs();

    if (!SIM.running){
      return {
        online:true, ip:SIM.ip,
        armed:SIM.armed, running:SIM.running,
        gate_wait:false, gate_pulses:SIM.gate_pulses,

        targetM:SIM.targetM, circM:SIM.circM, pprFront:SIM.pprFront, weightKg:SIM.weightKg,

        t_s:SIM.t_s,
        dist_m:SIM.dist_m,
        speed_kmh:SIM.speed_kmh,

        rpm:SIM.rpm,
        tq:SIM.tq,
        hp:SIM.hp,
        maxHP:SIM.maxHP,
        maxTQ:SIM.maxTQ,

        statusText:SIM.statusText
      };
    }

    const last = SIM._lastMs || ms;
    const dt = clamp((ms - last) / 1000, 0, 0.2);
    SIM._lastMs = ms;

    simStep(dt, ms);

    return {
      online:true, ip:SIM.ip,
      armed:SIM.armed, running:SIM.running,
      gate_wait:false, gate_pulses:SIM.gate_pulses,

      targetM:SIM.targetM, circM:SIM.circM, pprFront:SIM.pprFront, weightKg:SIM.weightKg,

      t_s:SIM.t_s,
      dist_m:SIM.dist_m,
      speed_kmh:SIM.speed_kmh,

      rpm:SIM.rpm,
      tq:SIM.tq,
      hp:SIM.hp,
      maxHP:SIM.maxHP,
      maxTQ:SIM.maxTQ,

      statusText:SIM.statusText
    };
  }

  // =========================================================
  // READ (SIM + REAL)
  // =========================================================
  function simReadAll(){
    // hasil READ: semua logs (terbaru dulu)
    return {
      ok:true,
      sim:true,
      count: SIMLOG.logs.length,
      logs: SIMLOG.logs
    };
  }

  async function realReadAll(){
    // Asumsi firmware nanti punya endpoint /read atau /history.
    // Kita coba beberapa opsi supaya fleksibel.
    const tries = ["/read", "/history", "/logs", "/readAll", "/dump"];
    let lastErr = null;
    for (let i=0; i<tries.length; i++){
      try{
        const r = await fetchJson(tries[i], 1500);
        return r;
      }catch(e){
        lastErr = e;
      }
    }
    return { ok:false, err:"read failed", detail: String(lastErr || "") };
  }

  // =========================================================
  // PUBLIC API (dipakai dyno-road.js)
  // =========================================================

  window.DYNO_getConn_DUAL = async function(){
    if (AUTO.mode === "sim"){
      return {
        connected:true,
        online:true,
        ip:"SIM",
        running:!!SIM.running,
        armed:!!SIM.armed,
        raw:{ online:true, ip:"SIM", running:SIM.running, armed:SIM.armed }
      };
    }

    try{
      const s = await fetchJson("/status", 900);
      AUTO.lastRealStatus = s;
      onRealSuccess();

      const online = !!(s && s.online);
      const ip = (s && s.ip) ? String(s.ip) : BASE_URL.replace("http://","");

      const conn = {
        connected: online,
        online,
        ip,
        running: !!(s && s.running),
        armed:   !!(s && s.armed),
        raw: s
      };
      AUTO.lastConn = conn;
      return conn;

    } catch(e){
      onRealFail();
      if (AUTO.mode === "sim"){
        return {
          connected:true,
          online:true,
          ip:"SIM",
          running:!!SIM.running,
          armed:!!SIM.armed,
          raw:{ online:true, ip:"SIM", running:SIM.running, armed:SIM.armed }
        };
      }
      return { connected:false, online:false, ip:"", running:false, armed:false };
    }
  };

  window.DYNO_getSnapshot_DUAL = async function(){
    if (AUTO.mode === "sim"){
      return simSnapshot();
    }

    try{
      const snap = await fetchJson("/snapshot", 900);
      AUTO.lastRealSnapshot = snap;
      onRealSuccess();
      return snap;
    } catch(e){
      onRealFail();
      if (AUTO.mode === "sim"){
        return simSnapshot();
      }
      return null;
    }
  };

  window.DYNO_setConfig_DUAL = async function(cfg){
    cfg = cfg || {};
    simConfig(cfg);

    if (AUTO.mode === "sim"){
      return { ok:true, targetM:SIM.targetM, circM:SIM.circM, pprFront:SIM.pprFront, weightKg:SIM.weightKg, sim:true };
    }

    try{
      const targetM  = Number(cfg.targetM ?? 200);
      const circM    = Number(cfg.circM ?? 1.85);
      const pprFront = Number(cfg.pprFront ?? 1);
      const weightKg = Number(cfg.weightKg ?? 120);

      const qs =
        "?targetM="  + encodeURIComponent(targetM) +
        "&circM="    + encodeURIComponent(circM) +
        "&pprFront=" + encodeURIComponent(pprFront) +
        "&weightKg=" + encodeURIComponent(weightKg);

      const r = await fetchJson("/config" + qs, 1200);
      onRealSuccess();
      return r;
    } catch(e){
      onRealFail();
      if (AUTO.mode === "sim"){
        return { ok:true, targetM:SIM.targetM, circM:SIM.circM, pprFront:SIM.pprFront, weightKg:SIM.weightKg, sim:true };
      }
      return { ok:false, err:"config failed" };
    }
  };

  window.DYNO_run_DUAL = async function(){
    if (AUTO.mode === "sim"){
      return simRun();
    }
    try{
      const r = await fetchJson("/run", 1200);
      onRealSuccess();
      return r;
    } catch(e){
      onRealFail();
      if (AUTO.mode === "sim") return simRun();
      return { ok:false, err:"run failed" };
    }
  };

  window.DYNO_arm_DUAL = async function(){
    if (AUTO.mode === "sim"){
      return simArm();
    }
    try{
      const r = await fetchJson("/arm", 1200);
      onRealSuccess();
      return r;
    } catch(e){
      onRealFail();
      if (AUTO.mode === "sim") return simArm();
      return { ok:false, err:"arm failed" };
    }
  };

  window.DYNO_stop_DUAL = async function(){
    if (AUTO.mode === "sim"){
      return simStop();
    }
    try{
      const r = await fetchJson("/stop", 1200);
      onRealSuccess();
      return r;
    } catch(e){
      onRealFail();
      if (AUTO.mode === "sim") return simStop();
      return { ok:false, err:"stop failed" };
    }
  };

  window.DYNO_reset_DUAL = async function(){
    simResetAll();

    if (AUTO.mode === "sim"){
      return { ok:true, reset:true, sim:true };
    }
    try{
      const r = await fetchJson("/reset", 1200);
      onRealSuccess();
      return r;
    } catch(e){
      onRealFail();
      if (AUTO.mode === "sim") return { ok:true, reset:true, sim:true };
      return { ok:false, err:"reset failed" };
    }
  };

  // ✅ READ API untuk tombol READ di dyno-road.js
  window.DYNO_readAll_DUAL = async function(){
    if (AUTO.mode === "sim"){
      return simReadAll();
    }
    try{
      const r = await realReadAll();
      onRealSuccess();
      return r;
    } catch(e){
      onRealFail();
      if (AUTO.mode === "sim") return simReadAll();
      return { ok:false, err:"read failed" };
    }
  };

  // alias kompatibilitas kalau dyno-road.js manggil nama lain
  window.DYNO_read_DUAL = window.DYNO_readAll_DUAL;

  // init mode decision cepat: coba ping status sekali
  (async () => {
    try{
      await fetchJson("/status", 700);
      setMode("real");
      onRealSuccess();
    } catch(e){
      setMode("sim");
    }
  })();

})();
