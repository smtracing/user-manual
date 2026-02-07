console.log("✅ esp-api-dual.js dimuat (FRONT ONLY API + HARD PULSE SIM)");

// =========================================================
// esp-api-dual.js — HTTP API Wrapper (ESP32 AP: 192.168.4.1)
// + HARD PULSE SIM MODE untuk uji dyno-road.js tanpa ESP32
//
// SIM MODE:
// - aktif jika URL mengandung ?sim=1  (dyno-road.html?sim=1)
// - simulasi keras:
//    * pulsa roda (PPR FRONT) diskrit -> dist & speed dihitung dari pulsa
//    * pulsa rpm diskrit -> rpm dihitung dari pulsa
//    * gate_wait: timer mulai setelah 1 putaran (pprFront pulsa)
// =========================================================

(function(){
  "use strict";

  const QS = new URLSearchParams(location.search);
  const SIM_ENABLED = (QS.get("sim") === "1");

  const BASE_URL = "http://192.168.4.1";

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

  function nowMs(){
    return (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
  }

  function clamp(v,a,b){ return Math.max(a, Math.min(b, v)); }

  // =========================================================
  // HARD SIM ENGINE (DISCRETE PULSES)
  // =========================================================
  const SIM = {
    enabled: SIM_ENABLED,

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

    // gate (1 wheel revolution = pprFront pulses)
    gate_wait:false,
    gate_pulses:1,
    gate_count:0,

    // timer
    t0ms:0,         // start time when gate passes
    t_s:0,

    // pulses + accumulators
    _lastMs:0,

    // wheel pulse simulation
    _wheelPulseFrac:0,
    dist_m:0,

    // rpm pulse simulation
    rpm:0,
    _rpmPulseFrac:0,

    // measurement windows (mirip firmware-style)
    _wWinMs:100,     // speed window
    _rWinMs:100,     // rpm window
    _wWinStart:0,
    _rWinStart:0,
    _wPulseCount:0,
    _rPulseCount:0,
    speed_kmh:0,

    // dyno outputs
    tq:0,
    hp:0,
    maxHP:0,
    maxTQ:0,

    // control
    _runStartMs:0,
    _statusText:"READY",

    // sim profile
    // - speed profile akan naik cepat lalu plateau
    // - rpm profile ikut naik (bisa lebih agresif)
    _vKmhTarget:0,
    _rpmTarget:0,

    // rpm pulse per rev crank (untuk SIM saja)
    // 1 = 1 pulsa per 1 putaran, 2 = 2 pulsa/putaran, dst.
    rpmPPR: 1
  };

  function simResetAll(){
    SIM.armed = false;
    SIM.running = false;

    SIM.gate_pulses = Math.max(1, Math.round(SIM.pprFront || 1));
    SIM.gate_wait = false;
    SIM.gate_count = 0;

    SIM.t0ms = 0;
    SIM.t_s = 0;

    SIM._lastMs = 0;

    SIM._wheelPulseFrac = 0;
    SIM.dist_m = 0;

    SIM.rpm = 0;
    SIM._rpmPulseFrac = 0;

    SIM._wWinStart = 0;
    SIM._rWinStart = 0;
    SIM._wPulseCount = 0;
    SIM._rPulseCount = 0;

    SIM.speed_kmh = 0;

    SIM.tq = 0;
    SIM.hp = 0;
    SIM.maxHP = 0;
    SIM.maxTQ = 0;

    SIM._runStartMs = 0;
    SIM._statusText = "READY";

    SIM._vKmhTarget = 0;
    SIM._rpmTarget = 0;
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

    SIM.gate_pulses = Math.max(1, Math.round(SIM.pprFront || 1));

    return {
      ok:true,
      targetM:SIM.targetM,
      circM:SIM.circM,
      pprFront:SIM.pprFront,
      weightKg:SIM.weightKg
    };
  }

  function simArm(){
    SIM.armed = true;
    SIM._statusText = "ARMED (SIM)";
    return { ok:true, armed:true, running:SIM.running };
  }

  function simRun(){
    // start RUN: gate_wait until 1 wheel revolution (pprFront pulses)
    const ms = nowMs();

    SIM.armed = true;
    SIM.running = true;

    SIM._runStartMs = ms;
    SIM._lastMs = ms;

    SIM.gate_pulses = Math.max(1, Math.round(SIM.pprFront || 1));
    SIM.gate_wait = true;
    SIM.gate_count = 0;

    // reset timeline for run
    SIM.t0ms = 0;
    SIM.t_s = 0;

    // reset dist & windows
    SIM.dist_m = 0;
    SIM.speed_kmh = 0;

    SIM._wheelPulseFrac = 0;
    SIM._wWinStart = ms;
    SIM._wPulseCount = 0;

    SIM.rpm = 0;
    SIM._rpmPulseFrac = 0;
    SIM._rWinStart = ms;
    SIM._rPulseCount = 0;

    SIM.tq = 0;
    SIM.hp = 0;
    SIM.maxHP = 0;
    SIM.maxTQ = 0;

    SIM._vKmhTarget = 0;
    SIM._rpmTarget = 0;

    SIM._statusText = "RUN: gate_wait (SIM)";

    return { ok:true, armed:true, running:true, gate_wait:true, gate_pulses:SIM.gate_pulses };
  }

  function simStop(){
    SIM.running = false;
    SIM.armed = false;
    SIM.gate_wait = false;
    SIM._statusText = "STOP (SIM)";
    return { ok:true, armed:false, running:false };
  }

  // torque curve vs RPM (kasar tapi “dyno-like”)
  function torqueFromRPM(rpm){
    // puncak torsi di tengah
    // baseline + bump, turun di rpm tinggi
    rpm = clamp(rpm, 0, 22000);
    const x = rpm / 20000; // 0..1
    const bump = Math.sin(Math.PI * clamp(x,0,1)); // 0..1..0
    const base = 16; // Nm
    const peak = 14; // tambahan
    return base + peak * bump;
  }

  // speed profile target (km/h) vs time (detik) + weight
  function speedTargetKmh(t_s){
    // cepat naik lalu melandai
    const w = clamp((Number(SIM.weightKg)||120), 30, 500);
    const vmax = 120 - clamp((w - 80) * 0.10, 0, 60); // beban naik => vmax turun
    const a = 70; // km/h per detik (agresif)
    const v = a * t_s;
    return clamp(v, 0, vmax);
  }

  // rpm target vs speed (biar “keras” ikut naik)
  function rpmTargetFromSpeed(vKmh){
    // 2000 -> 18000
    const x = clamp(vKmh / 120, 0, 1);
    // easing
    const e = x < 0.5 ? 2*x*x : 1 - Math.pow(-2*x + 2, 2)/2;
    return 2000 + e * 16000;
  }

  // HARD pulse generator step
  function simStep(dt, msNow){
    // dt in seconds

    // jika gate_wait: kita tetap generate pulsa roda,
    // tapi timer t_s belum berjalan sampai gate_count mencapai gate_pulses
    // jadi: selama gate_wait, speed & dist tetap bisa bergerak (opsional),
    // namun firmware kamu biasanya mulai timer setelah 1 rev.
    // Di sini: dist dihitung tetap, tetapi t_s = 0 sampai gate selesai.
    // (dyno-road.js kamu hanya log saat gate_wait false, jadi aman)
    const circ = Math.max(0.01, Number(SIM.circM)||1.85);
    const ppr = Math.max(1, Math.round(Number(SIM.pprFront)||1));

    // update target speed (agresif) berdasarkan "waktu run total"
    const runT = Math.max(0, (msNow - SIM._runStartMs) / 1000);
    SIM._vKmhTarget = speedTargetKmh(runT);

    // convert to wheel rev/s
    const v_mps = (SIM._vKmhTarget * 1000) / 3600;
    const wheelRevPerSec = v_mps / circ; // rev/s

    // pulses per second = wheelRevPerSec * ppr
    const wheelPps = wheelRevPerSec * ppr;

    // accumulate fractional pulses
    SIM._wheelPulseFrac += wheelPps * dt;

    // generate integer pulses
    let newWheelPulses = 0;
    if (SIM._wheelPulseFrac >= 1){
      newWheelPulses = Math.floor(SIM._wheelPulseFrac);
      SIM._wheelPulseFrac -= newWheelPulses;
    }

    // apply wheel pulses
    if (newWheelPulses > 0){
      // distance per pulse
      const distPerPulse = circ / ppr;
      SIM.dist_m += newWheelPulses * distPerPulse;

      // window count for speed measurement
      SIM._wPulseCount += newWheelPulses;

      // gate counting
      if (SIM.gate_wait){
        SIM.gate_count += newWheelPulses;
        if (SIM.gate_count >= SIM.gate_pulses){
          // gate selesai -> start timer
          SIM.gate_wait = false;
          SIM.t0ms = msNow;
          SIM.t_s = 0;
          SIM._statusText = "RUNNING (SIM)";
          // reset measurement windows at gate start (biar lebih mirip)
          SIM._wWinStart = msNow;
          SIM._wPulseCount = 0;

          SIM._rWinStart = msNow;
          SIM._rPulseCount = 0;
        }
      }
    }

    // update timer if gate passed
    if (!SIM.gate_wait && SIM.t0ms > 0){
      SIM.t_s = Math.max(0, (msNow - SIM.t0ms) / 1000);
    } else {
      SIM.t_s = 0;
    }

    // compute RPM target
    SIM._rpmTarget = rpmTargetFromSpeed(SIM._vKmhTarget);

    // RPM pulse generation (discrete)
    // pulses per second = (rpm/60 rev/s) * rpmPPR
    const rpmPPR = Math.max(1, Math.round(Number(SIM.rpmPPR)||1));
    const rpmRevPerSec = (SIM._rpmTarget / 60);
    const rpmPps = rpmRevPerSec * rpmPPR;

    SIM._rpmPulseFrac += rpmPps * dt;

    let newRpmPulses = 0;
    if (SIM._rpmPulseFrac >= 1){
      newRpmPulses = Math.floor(SIM._rpmPulseFrac);
      SIM._rpmPulseFrac -= newRpmPulses;
    }

    if (newRpmPulses > 0){
      SIM._rPulseCount += newRpmPulses;
    }

    // ===== measurement window update for SPEED =====
    if ((msNow - SIM._wWinStart) >= SIM._wWinMs){
      const winDt = (msNow - SIM._wWinStart) / 1000;
      const pulses = SIM._wPulseCount;

      // speed from pulses in window:
      // dist = pulses/ppr * circ
      const distWin = (pulses / ppr) * circ;
      const vWin_mps = distWin / Math.max(1e-6, winDt);
      SIM.speed_kmh = vWin_mps * 3.6;

      SIM._wWinStart = msNow;
      SIM._wPulseCount = 0;
    }

    // ===== measurement window update for RPM =====
    if ((msNow - SIM._rWinStart) >= SIM._rWinMs){
      const winDt = (msNow - SIM._rWinStart) / 1000;
      const pulses = SIM._rPulseCount;

      // rpm from pulses in window:
      // rev = pulses / rpmPPR
      // rps = rev / dt
      // rpm = rps*60
      const rev = pulses / rpmPPR;
      const rps = rev / Math.max(1e-6, winDt);
      SIM.rpm = rps * 60;

      SIM._rWinStart = msNow;
      SIM._rPulseCount = 0;
    }

    // dyno outputs (tq curve + hp from tq/rpm)
    const tq = torqueFromRPM(SIM.rpm);
    SIM.tq = tq;

    // HP = tq(Nm) * rpm / 7127
    SIM.hp = (SIM.tq * SIM.rpm) / 7127;

    SIM.maxHP = Math.max(SIM.maxHP || 0, SIM.hp || 0);
    SIM.maxTQ = Math.max(SIM.maxTQ || 0, SIM.tq || 0);

    // auto stop at target distance
    const target = Math.max(1, Number(SIM.targetM)||1);
    if (SIM.dist_m >= target){
      SIM.dist_m = target;
      SIM.running = false;
      SIM.armed = false;
      SIM.gate_wait = false;
      SIM._statusText = "AUTO STOP (SIM)";
    } else {
      if (SIM.running){
        SIM._statusText = SIM.gate_wait ? "RUN: gate_wait (SIM)" : "RUNNING (SIM)";
      }
    }
  }

  function simSnapshot(){
    const ms = nowMs();

    if (!SIM.running){
      return {
        online:true, ip:SIM.ip,
        armed:SIM.armed, running:SIM.running,
        gate_wait:SIM.gate_wait, gate_pulses:SIM.gate_pulses,

        targetM:SIM.targetM, circM:SIM.circM, pprFront:SIM.pprFront, weightKg:SIM.weightKg,

        t_s:SIM.t_s,
        dist_m:SIM.dist_m,
        speed_kmh:SIM.speed_kmh,

        rpm:SIM.rpm,
        tq:SIM.tq,
        hp:SIM.hp,
        maxHP:SIM.maxHP,
        maxTQ:SIM.maxTQ,

        statusText:SIM._statusText
      };
    }

    // running
    const last = SIM._lastMs || ms;
    const dt = clamp((ms - last) / 1000, 0, 0.2);
    SIM._lastMs = ms;

    // step simulation
    simStep(dt, ms);

    return {
      online:true, ip:SIM.ip,
      armed:SIM.armed, running:SIM.running,
      gate_wait:SIM.gate_wait, gate_pulses:SIM.gate_pulses,

      targetM:SIM.targetM, circM:SIM.circM, pprFront:SIM.pprFront, weightKg:SIM.weightKg,

      t_s:SIM.t_s,
      dist_m:SIM.dist_m,
      speed_kmh:SIM.speed_kmh,

      rpm:SIM.rpm,
      tq:SIM.tq,
      hp:SIM.hp,
      maxHP:SIM.maxHP,
      maxTQ:SIM.maxTQ,

      statusText:SIM._statusText
    };
  }

  if (SIM.enabled){
    simResetAll();
    console.log("🧪 SIM MODE AKTIF (HARD PULSE): pakai ?sim=1");
  }

  // =========================================================
  // API YANG DIPAKAI dyno-road.js
  // =========================================================
  window.DYNO_getConn_DUAL = async function(){
    if (SIM.enabled){
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
    }catch(e){
      return { connected:false, online:false, ip:"", running:false, armed:false };
    }
  };

  window.DYNO_getSnapshot_DUAL = async function(){
    if (SIM.enabled){
      return simSnapshot();
    }
    return await fetchJson("/snapshot", 800);
  };

  window.DYNO_setConfig_DUAL = async function(cfg){
    cfg = cfg || {};

    if (SIM.enabled){
      return simConfig(cfg);
    }

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

  window.DYNO_run_DUAL = async function(){
    if (SIM.enabled){
      return simRun();
    }
    return await fetchJson("/run", 1000);
  };

  window.DYNO_arm_DUAL = async function(){
    if (SIM.enabled){
      return simArm();
    }
    return await fetchJson("/arm", 1000);
  };

  window.DYNO_stop_DUAL = async function(){
    if (SIM.enabled){
      return simStop();
    }
    return await fetchJson("/stop", 1000);
  };

  window.DYNO_reset_DUAL = async function(){
    if (SIM.enabled){
      simResetAll();
      return { ok:true, reset:true };
    }
    return await fetchJson("/reset", 1000);
  };

})();
