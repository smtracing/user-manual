console.log("✅ esp-api-dual.js dimuat (FRONT ONLY API + FAST SIM)");

// =========================================================
// esp-api-dual.js — HTTP API Wrapper (ESP32 AP: 192.168.4.1)
// + SIMULATOR (SIM=1) untuk test UI dyno-road tanpa ESP32
//
// Cara pakai SIM:
// - Buka dyno-road.html pakai URL: .../dyno-road.html?sim=1
// - Optional speed: ...?sim=1&simx=15  (default 10)
// =========================================================

(function(){
  "use strict";

  // =========================
  // REAL ESP32 BASE
  // =========================
  const BASE_URL = "http://192.168.4.1";

  // helper parse query
  function getQueryParam(name, def){
    try{
      const u = new URL(window.location.href);
      const v = u.searchParams.get(name);
      if (v === null || v === "") return def;
      return v;
    }catch(e){
      return def;
    }
  }

  const SIM_ON = String(getQueryParam("sim","0")) === "1";

  // Time scale simulator: 1 detik real = SIM_X detik simulasi
  // default 10x (lebih cepat). bisa override ?simx=15
  const SIM_X = (function(){
    const v = Number(getQueryParam("simx", "10"));
    if (!isFinite(v)) return 10;
    return Math.max(1, Math.min(60, v));
  })();

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
  // =========================
  // SIMULATOR CORE (FRONT ONLY)
  // =========================
  // =========================================================
  const SIM = {
    // config from web
    cfg_targetM: 200,
    cfg_circM: 1.85,
    cfg_pprFront: 1,
    cfg_weightKg: 120,

    // runtime state (mirip firmware)
    armed:false,
    running:false,
    gate_wait:false,
    gate_pulses:1,

    front_total:0,

    t_s:0,
    dist_m:0,
    speed_kmh:0,

    rpm:0,
    rpm_valid:1,

    hp:0,
    tq:0,
    maxHP:0,
    maxTQ:0,

    statusText:"READY",

    // internal sim physics
    _lastRealMs:0,
    _simUs:0,

    _baseFront:0,
    _startFront:0,
    _startSimUs:0,

    _v_ms:0,
    _v_ms_filt:0,
    _v_ms_prev:0,

    // tuning
    _accel_ms2: 10.0,    // percepatan (sim)
    _vmax_ms:   85.0,    // batas speed
    _alpha:     0.85,    // filter speed
    _accelMax:  20.0     // clamp accel (mirip firmware)
  };

  function simResetAll(keepConfig){
    SIM.armed = false;
    SIM.running = false;
    SIM.gate_wait = false;

    SIM.gate_pulses = Math.max(1, Math.round(SIM.cfg_pprFront || 1));

    SIM.front_total = 0;

    SIM.t_s = 0;
    SIM.dist_m = 0;
    SIM.speed_kmh = 0;

    SIM.rpm = 0;
    SIM.rpm_valid = 1;

    SIM.hp = 0;
    SIM.tq = 0;
    SIM.maxHP = 0;
    SIM.maxTQ = 0;

    SIM.statusText = "READY";

    SIM._simUs = 0;
    SIM._lastRealMs = 0;

    SIM._baseFront = 0;
    SIM._startFront = 0;
    SIM._startSimUs = 0;

    SIM._v_ms = 0;
    SIM._v_ms_filt = 0;
    SIM._v_ms_prev = 0;

    if (!keepConfig){
      SIM.cfg_targetM = 200;
      SIM.cfg_circM = 1.85;
      SIM.cfg_pprFront = 1;
      SIM.cfg_weightKg = 120;
    }
  }

  function simStartRun(){
    // reset state, keep config
    simResetAll(true);

    SIM.armed = true;
    SIM.running = true;
    SIM.gate_wait = true;
    SIM.gate_pulses = Math.max(1, Math.round(SIM.cfg_pprFront || 1));

    SIM._baseFront = SIM.front_total;
    SIM._startSimUs = 0;
    SIM._startFront = 0;

    SIM.statusText = "WAIT_GATE";
  }

  function clampf(v,a,b){
    if (v < a) return a;
    if (v > b) return b;
    return v;
  }

  // distance -> pulses helper
  function distToPulses(dist_m){
    const circ = Math.max(0.0001, Number(SIM.cfg_circM || 1.85));
    const ppr  = Math.max(1, Math.round(SIM.cfg_pprFront || 1));
    // pulses = revolutions * ppr = (dist/circ)*ppr
    return Math.floor((dist_m / circ) * ppr);
  }

  // mapping speed->rpm (cuma untuk demo UI)
  function speedToRpm(v_ms){
    // dibuat naik cepat sampai 20000 rpm, tanpa terlalu liar
    // 0..85 m/s -> 1200..20000 rpm
    const r = 1200 + (v_ms / 85.0) * (20000 - 1200);
    return clampf(r, 0, 20000);
  }

  function simTick(){
    const nowMs = Date.now();
    if (!SIM._lastRealMs) SIM._lastRealMs = nowMs;

    const dtReal_s = (nowMs - SIM._lastRealMs) / 1000.0;
    SIM._lastRealMs = nowMs;

    // dt simulasi dipercepat
    const dt_s = dtReal_s * SIM_X;
    if (!isFinite(dt_s) || dt_s <= 0) return;

    // update "sim time"
    SIM._simUs += Math.floor(dt_s * 1e6);

    // update RPM dummy terus walau belum running (biar hidup)
    SIM.rpm = SIM.running ? SIM.rpm : 0;

    if (!SIM.running){
      SIM.t_s = 0;
      SIM.dist_m = 0;
      SIM.speed_kmh = 0;
      SIM.hp = 0;
      SIM.tq = 0;
      SIM.statusText = SIM.statusText || "READY";
      return;
    }

    // ======= WAIT_GATE =======
    if (SIM.gate_wait){
      // selama wait gate, kita belum hitung t/dist/speed/hp/tq (seperti firmware)
      // tapi kita tetap "menggerakkan roda" agar segera lewat gate
      const a = SIM._accel_ms2; // m/s^2
      SIM._v_ms = clampf(SIM._v_ms + a * dt_s, 0, SIM._vmax_ms);

      // distance accum (internal), tapi firmware membekukan output saat gate_wait
      const dAdd = SIM._v_ms * dt_s;
      const dTotalInternal = SIM.dist_m + dAdd;

      // pulses
      const pulses = distToPulses(dTotalInternal);
      SIM.front_total = SIM._baseFront + pulses;

      const deltaFront = SIM.front_total - SIM._baseFront;
      if (deltaFront < SIM.gate_pulses){
        // output freeze
        SIM.t_s = 0;
        SIM.dist_m = 0;
        SIM.speed_kmh = 0;
        SIM.hp = 0;
        SIM.tq = 0;
        SIM.rpm = 0;
        SIM.statusText = "WAIT_GATE";
        return;
      }

      // gate pass
      SIM.gate_wait = false;
      SIM._startSimUs = SIM._simUs;
      SIM._startFront = SIM._baseFront + SIM.gate_pulses;

      // reset outputs after gate
      SIM.t_s = 0;
      SIM.dist_m = 0;
      SIM.speed_kmh = 0;
      SIM.hp = 0;
      SIM.tq = 0;
      SIM.maxHP = 0;
      SIM.maxTQ = 0;

      SIM._v_ms_filt = 0;
      SIM._v_ms_prev = 0;

      SIM.statusText = "RUNNING";
      return;
    }

    // ======= RUNNING =======
    // percepatan simulasi
    const aCmd = SIM._accel_ms2; // bisa dianggap "gas"
    SIM._v_ms = clampf(SIM._v_ms + aCmd * dt_s, 0, SIM._vmax_ms);

    // distance update
    const dAdd = SIM._v_ms * dt_s;

    // pulses based on distance after startFront (mirip firmware)
    // kita simpan internal dist_m sebagai "after gate" (output)
    const newDist = SIM.dist_m + dAdd;
    SIM.dist_m = newDist;

    // update front_total relative to startFront
    const pulsesAfter = distToPulses(SIM.dist_m);
    SIM.front_total = SIM._startFront + pulsesAfter;

    // time after gate
    SIM.t_s = (SIM._simUs - SIM._startSimUs) / 1e6;

    // compute speed from filtered v
    // filter ala firmware: v_filt = 0.85 prev + 0.15 v
    SIM._v_ms_filt = (SIM._alpha * SIM._v_ms_filt) + ((1.0 - SIM._alpha) * SIM._v_ms);

    // accel estimate
    let a = (SIM._v_ms_filt - SIM._v_ms_prev) / Math.max(1e-6, dt_s);
    if (!isFinite(a)) a = 0;
    if (a < 0) a = 0;
    a = clampf(a, 0, SIM._accelMax);

    // dyno formula sama konsep firmware:
    // F = m*a
    // tq = F * rWheel
    // P  = F * v
    // hp = P / 745.699872
    const m = Math.max(1, Number(SIM.cfg_weightKg || 120));
    const F = m * a;

    const circ = Math.max(0.0001, Number(SIM.cfg_circM || 1.85));
    const rWheel = circ / (2.0 * Math.PI);

    let tq = F * rWheel;
    let P  = F * SIM._v_ms_filt;
    let hp = P / 745.699872;

    if (!isFinite(tq)) tq = 0;
    if (!isFinite(hp)) hp = 0;
    if (tq < 0) tq = 0;
    if (hp < 0) hp = 0;

    SIM.tq = tq;
    SIM.hp = hp;

    SIM.speed_kmh = SIM._v_ms_filt * 3.6;

    // rpm dummy
    SIM.rpm = speedToRpm(SIM._v_ms_filt);

    if (SIM.hp > SIM.maxHP) SIM.maxHP = SIM.hp;
    if (SIM.tq > SIM.maxTQ) SIM.maxTQ = SIM.tq;

    SIM._v_ms_prev = SIM._v_ms_filt;

    // AUTO STOP ketika dist >= target
    const target = Math.max(1, Math.round(SIM.cfg_targetM || 200));
    if (SIM.dist_m >= target){
      SIM.running = false;
      SIM.armed = false;
      SIM.gate_wait = false;
      SIM.statusText = "AUTO STOP";
      // biarkan nilai terakhir tampil
    } else {
      SIM.statusText = "RUNNING";
    }
  }

  function simSnapshot(){
    // tick on each call (UI polling -> update)
    simTick();

    const tsMs = Date.now();
    const tsUs = (SIM._simUs >>> 0);

    const s = {
      ts_ms: tsMs,
      ts_us: tsUs,

      front_total: SIM.front_total,

      rpm: Number(SIM.rpm.toFixed(1)),
      rpm_valid: 1,

      armed: !!SIM.armed,
      running: !!SIM.running,
      gate_wait: !!SIM.gate_wait,
      gate_pulses: Math.max(1, Math.round(SIM.gate_pulses || 1)),

      t_s: Number((SIM.t_s || 0).toFixed(3)),
      dist_m: Number((SIM.dist_m || 0).toFixed(3)),
      speed_kmh: Number((SIM.speed_kmh || 0).toFixed(3)),

      // alias untuk web lama
      t: Number((SIM.t_s || 0).toFixed(3)),
      distM: Number((SIM.dist_m || 0).toFixed(3)),
      speedKmh: Number((SIM.speed_kmh || 0).toFixed(3)),
      gateWait: !!SIM.gate_wait,
      gatePulses: Math.max(1, Math.round(SIM.gate_pulses || 1)),

      hp: Number((SIM.hp || 0).toFixed(2)),
      tq: Number((SIM.tq || 0).toFixed(2)),
      maxHP: Number((SIM.maxHP || 0).toFixed(2)),
      maxTQ: Number((SIM.maxTQ || 0).toFixed(2)),

      targetM: Math.max(1, Math.round(SIM.cfg_targetM || 200)),
      circM: Number((SIM.cfg_circM || 1.85).toFixed(3)),
      pprFront: Math.max(1, Math.round(SIM.cfg_pprFront || 1)),
      weightKg: Math.max(1, Math.round(SIM.cfg_weightKg || 120)),

      speedMaxKmh: 432.0,
      accelMax: SIM._accelMax,

      statusText: String(SIM.statusText || "READY")
    };

    return s;
  }

  // =========================================================
  // KONEKSI
  // =========================================================
  window.DYNO_getConn_DUAL = async function(){
    if (SIM_ON){
      // "connected" always true in sim
      return {
        connected:true,
        online:true,
        ip:"SIM",
        running: !!SIM.running,
        armed: !!SIM.armed,
        raw:{ online:true, ip:"SIM", running:SIM.running, armed:SIM.armed, sim:1, simx:SIM_X }
      };
    }

    try{
      const s = await fetchJson("/status", 800);
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
  // SNAPSHOT
  // =========================================================
  window.DYNO_getSnapshot_DUAL = async function(){
    if (SIM_ON) return simSnapshot();
    return await fetchJson("/snapshot", 800);
  };

  // =========================================================
  // CONFIG
  // cfg: {targetM, circM, pprFront, weightKg}
  // =========================================================
  window.DYNO_setConfig_DUAL = async function(cfg){
    cfg = cfg || {};
    const targetM  = Number(cfg.targetM ?? 200);
    const circM    = Number(cfg.circM ?? 1.85);
    const pprFront = Number(cfg.pprFront ?? 1);
    const weightKg = Number(cfg.weightKg ?? 120);

    if (SIM_ON){
      // apply config in sim
      if (isFinite(targetM))  SIM.cfg_targetM  = Math.max(10, Math.min(5000, Math.round(targetM)));
      if (isFinite(circM))    SIM.cfg_circM    = Math.max(0.2, Math.min(10.0, circM));
      if (isFinite(pprFront)) SIM.cfg_pprFront = Math.max(1, Math.min(2000, Math.round(pprFront)));
      if (isFinite(weightKg)) SIM.cfg_weightKg = Math.max(30, Math.min(500, Math.round(weightKg)));

      SIM.gate_pulses = Math.max(1, Math.round(SIM.cfg_pprFront || 1));

      return {
        ok:1,
        targetM: SIM.cfg_targetM,
        circM: Number(SIM.cfg_circM.toFixed(3)),
        pprFront: SIM.cfg_pprFront,
        weightKg: SIM.cfg_weightKg,
        sim:1,
        simx: SIM_X
      };
    }

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
    if (SIM_ON){
      simStartRun();
      return { ok:1, run:1, sim:1, simx:SIM_X };
    }
    return await fetchJson("/run", 1000);
  };

  window.DYNO_arm_DUAL = async function(){
    if (SIM_ON){
      // firmware arm alias run
      simStartRun();
      return { ok:1, armed:1, note:"ARM_ALIAS_RUN", sim:1, simx:SIM_X };
    }
    return await fetchJson("/arm", 1000);
  };

  window.DYNO_stop_DUAL = async function(){
    if (SIM_ON){
      SIM.running = false;
      SIM.armed = false;
      SIM.gate_wait = false;
      SIM.statusText = "STOP";
      return { ok:1, stop:1, sim:1, simx:SIM_X };
    }
    return await fetchJson("/stop", 1000);
  };

  window.DYNO_reset_DUAL = async function(){
    if (SIM_ON){
      simResetAll(true);
      return { ok:1, reset:1, sim:1, simx:SIM_X };
    }
    return await fetchJson("/reset", 1000);
  };

  // init sim state once
  if (SIM_ON){
    simResetAll(true);
    console.log("🧪 SIM ON (sim=1) — speed x" + SIM_X);
  }

})();
