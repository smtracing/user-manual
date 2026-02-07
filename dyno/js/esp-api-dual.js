console.log("✅ esp-api-dual.js dimuat (FRONT ONLY API + SIM MODE)");

// =========================================================
// esp-api-dual.js — HTTP API Wrapper (ESP32 AP: 192.168.4.1)
// + SIM MODE untuk uji dyno-road.js tanpa ESP32
//
// - dipakai oleh dyno-road.html + dyno-road.js
// - semua request real: GET ke 192.168.4.1
//
// SIM MODE:
// - aktif jika URL mengandung ?sim=1  (dyno-road.html?sim=1)
// - snapshot akan dibuat seolah-olah ada pulsa PPR & RPM naik
// =========================================================

(function(){
  "use strict";

  // =========================
  // MODE
  // =========================
  const QS = new URLSearchParams(location.search);
  const SIM_ENABLED = (QS.get("sim") === "1");

  // base IP ESP32 AP (REAL MODE)
  const BASE_URL = "http://192.168.4.1";

  // =========================
  // REAL FETCH HELPER
  // =========================
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
  // SIM ENGINE (snapshot palsu tapi format firmware)
  // =========================================================
  const SIM = {
    enabled: SIM_ENABLED,

    // state
    online:true,
    ip:"SIM",
    armed:false,
    running:false,

    // config default
    targetM:200,
    circM:1.85,
    pprFront:1,
    weightKg:120,

    // gate
    gate_wait:false,
    gate_pulses:1,

    // motion
    t0:0,
    lastMs:0,
    t_s:0,
    dist_m:0,
    speed_kmh:0,

    // dyno outputs
    rpm:0,
    tq:0,
    hp:0,
    maxHP:0,
    maxTQ:0,

    // control
    _runStartMs:0,
    _gateEndMs:0,
    _statusText:"READY"
  };

  function nowMs(){
    return (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
  }

  function simResetAll(){
    SIM.armed = false;
    SIM.running = false;

    SIM.gate_wait = false;
    SIM.gate_pulses = Math.max(1, Math.round(SIM.pprFront || 1));

    SIM.t0 = 0;
    SIM.lastMs = 0;
    SIM.t_s = 0;
    SIM.dist_m = 0;
    SIM.speed_kmh = 0;

    SIM.rpm = 0;
    SIM.tq  = 0;
    SIM.hp  = 0;
    SIM.maxHP = 0;
    SIM.maxTQ = 0;

    SIM._runStartMs = 0;
    SIM._gateEndMs = 0;
    SIM._statusText = "READY";
  }

  function simArm(){
    SIM.armed = true;
    SIM._statusText = "ARMED (SIM)";
    return { ok:true, armed:true, running:SIM.running };
  }

  function simRun(){
    // saat RUN: set gate_wait dulu (tunggu 1 putaran)
    SIM.armed = true;
    SIM.running = true;

    const ms = nowMs();
    SIM._runStartMs = ms;

    SIM.gate_pulses = Math.max(1, Math.round(SIM.pprFront || 1));
    SIM.gate_wait = true;

    // simulasi gate selesai setelah ~0.6s
    SIM._gateEndMs = ms + 600;

    // reset timeline untuk run baru
    SIM.t0 = 0;
    SIM.lastMs = ms;
    SIM.t_s = 0;
    SIM.dist_m = 0;
    SIM.speed_kmh = 0;

    SIM.rpm = 0;
    SIM.tq  = 0;
    SIM.hp  = 0;
    SIM.maxHP = 0;
    SIM.maxTQ = 0;

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

  function simConfig(q){
    // q: {targetM,circM,pprFront,weightKg}
    if (q && typeof q === "object"){
      const t = Number(q.targetM);
      const c = Number(q.circM);
      const p = Number(q.pprFront);
      const w = Number(q.weightKg);

      if (isFinite(t) && t > 0) SIM.targetM = t;
      if (isFinite(c) && c > 0) SIM.circM = c;
      if (isFinite(p) && p > 0) SIM.pprFront = p;
      if (isFinite(w) && w > 0) SIM.weightKg = w;
    }

    SIM.gate_pulses = Math.max(1, Math.round(SIM.pprFront || 1));
    return {
      ok:true,
      targetM:SIM.targetM,
      circM:SIM.circM,
      pprFront:SIM.pprFront,
      weightKg:SIM.weightKg
    };
  }

  function clamp(v,a,b){ return Math.max(a, Math.min(b, v)); }

  // tq curve: puncak di tengah, turun di ujung
  function tqCurve(progress){
    // progress 0..1
    // contoh: 18Nm base, +10Nm peak di 0.45..0.6
    const x = clamp(progress, 0, 1);
    const peak = Math.sin(Math.PI * x); // 0..1..0
    return 18 + 10 * peak; // 18..28..18
  }

  function easeInOut(x){
    x = clamp(x, 0, 1);
    return x < 0.5 ? 2*x*x : 1 - Math.pow(-2*x + 2, 2)/2;
  }

  function simSnapshot(){
    const ms = nowMs();

    // gate_wait handling
    if (SIM.running && SIM.gate_wait && ms >= SIM._gateEndMs){
      SIM.gate_wait = false;
      SIM.lastMs = ms;
      SIM.t0 = ms;       // start timer saat gate selesai
      SIM.t_s = 0;
      SIM._statusText = "RUNNING (SIM)";
    }

    // jika belum running, tetap kirim snapshot idle
    if (!SIM.running){
      return {
        online:true,
        ip:SIM.ip,

        armed:SIM.armed,
        running:SIM.running,

        gate_wait:SIM.gate_wait,
        gate_pulses:SIM.gate_pulses,

        targetM:SIM.targetM,
        circM:SIM.circM,
        pprFront:SIM.pprFront,
        weightKg:SIM.weightKg,

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

    // running tapi masih gate_wait => snapshot gate
    if (SIM.running && SIM.gate_wait){
      return {
        online:true,
        ip:SIM.ip,

        armed:true,
        running:true,

        gate_wait:true,
        gate_pulses:SIM.gate_pulses,

        targetM:SIM.targetM,
        circM:SIM.circM,
        pprFront:SIM.pprFront,
        weightKg:SIM.weightKg,

        t_s:0,
        dist_m:0,
        speed_kmh:0,

        rpm:0,
        tq:0,
        hp:0,
        maxHP:SIM.maxHP,
        maxTQ:SIM.maxTQ,

        statusText:SIM._statusText
      };
    }

    // ==== SIMULASI DATA SAAT RUNNING (setelah gate) ====
    const dt = clamp((ms - (SIM.lastMs || ms)) / 1000, 0, 0.2);
    SIM.lastMs = ms;

    // time
    SIM.t_s = Math.max(0, (ms - SIM.t0) / 1000);

    // progress target
    const target = Math.max(1, Number(SIM.targetM) || 1);
    const prog = clamp(SIM.dist_m / target, 0, 1);

    // speed model: akselerasi awal, lalu plateau
    // vmax tergantung weight sedikit (lebih berat lebih rendah)
    const vmax = 110 - clamp((Number(SIM.weightKg)||120) - 80, 0, 200) * 0.12; // km/h
    const a = 55; // km/h per detik (kasar untuk simulasi)
    const desired = clamp(a * SIM.t_s, 0, vmax);
    // smoothing
    SIM.speed_kmh = SIM.speed_kmh + (desired - SIM.speed_kmh) * clamp(dt * 3.5, 0, 1);

    // dist integrate
    const v_mps = (SIM.speed_kmh * 1000) / 3600;
    SIM.dist_m += v_mps * dt;

    // compute progress again setelah dist update
    const prog2 = clamp(SIM.dist_m / target, 0, 1);

    // rpm naik dari 2000 ke 18000 berdasarkan progress (easing)
    const e = easeInOut(prog2);
    SIM.rpm = 2000 + e * 16000;

    // tq & hp
    SIM.tq = tqCurve(prog2);
    // HP dari tq (Nm) & RPM: hp = tq*rpm/7127
    SIM.hp = (SIM.tq * SIM.rpm) / 7127;

    // max tracking
    SIM.maxHP = Math.max(SIM.maxHP || 0, SIM.hp || 0);
    SIM.maxTQ = Math.max(SIM.maxTQ || 0, SIM.tq || 0);

    // auto stop
    if (SIM.dist_m >= target){
      SIM.dist_m = target;
      SIM.running = false;
      SIM.armed = false;
      SIM._statusText = "AUTO STOP (SIM)";
    } else {
      SIM._statusText = "RUNNING (SIM)";
    }

    return {
      online:true,
      ip:SIM.ip,

      armed:SIM.armed,
      running:SIM.running,

      gate_wait:false,
      gate_pulses:SIM.gate_pulses,

      targetM:SIM.targetM,
      circM:SIM.circM,
      pprFront:SIM.pprFront,
      weightKg:SIM.weightKg,

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

  // init sim
  if (SIM.enabled){
    simResetAll();
    console.log("🧪 SIM MODE AKTIF: snapshot palsu untuk test dyno-road.js (pakai ?sim=1)");
  }

  // =========================================================
  // API YANG DIPAKAI dyno-road.js
  // =========================================================

  // KONEKSI (indikator CONNECTED di HTML)
  // return: {connected:boolean, ip:string, online:boolean, running:boolean, armed:boolean, raw?:object}
  window.DYNO_getConn_DUAL = async function(){
    if (SIM.enabled){
      return {
        connected:true,
        online:true,
        ip:"SIM",
        running:!!SIM.running,
        armed:!!SIM.armed,
        raw:{
          online:true,
          ip:"SIM",
          running:SIM.running,
          armed:SIM.armed
        }
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

  // SNAPSHOT (polling dyno-road.js)
  window.DYNO_getSnapshot_DUAL = async function(){
    if (SIM.enabled){
      return simSnapshot();
    }
    return await fetchJson("/snapshot", 800);
  };

  // CONFIG (dipakai sebelum RUN)
  // cfg: {targetM, circM, pprFront, weightKg}
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

  // RUN / ARM / STOP / RESET
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
