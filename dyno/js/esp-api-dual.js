/* =========================================================
   esp-api-dual.js — DYNO-ROAD ONLY (REAL ESP32 AP + FALLBACK SAFE)
   - CONNECT ke ESP32 asli via HTTP JSON:
       GET http://192.168.4.1/snapshot
       -> { ts_ms, front_total, rear_total, rpm, rpm_valid, espReady, circ_m, ppr_f, ppr_r }

   - Data yang dipakai UI:
       front_total, rear_total, rpm (jika valid)
       AFR: belum ada -> dibekukan 14.7

   - TIME(s) & DIST(m) tetap gaya kamu:
       START time setelah 1 putaran roda depan sejak RUN
       STOP saat dist (dari front_total) mencapai targetM

   - SLIP: peak (puncak), freeze setelah start lewat

   - KONEK WIFI "KAYAK CDI":
       Host AP dikunci: http://192.168.4.1
       fetchJSON helper (timeout + json safe)
       Event status koneksi: window "DYNO_CONN" (optional, tidak ganggu file lain)

   Penting:
   - File lain tidak disentuh.
   - Interface fungsi yang sudah dipakai dyno-road.js tetap ada:
       DYNO_setConfig_DUAL, DYNO_arm_DUAL, DYNO_run_DUAL, DYNO_stop_DUAL
       DYNO_getSnapshot_DUAL, DYNO_getRowsSince_DUAL
========================================================= */

console.log("%c[ESP-API-DUAL] DYNO-ROAD REAL ESP32 (AP HTTP) + AFR HOLD", "color:#4cff8f");

(function () {

  // =========================
  // ESP32 ENDPOINT (AP)
  // =========================
  const ESP_BASE_URL   = "http://192.168.4.1";
  const ESP_SNAPSHOT   = "/snapshot";
  const ESP_POLL_MS    = 80;     // 50..120ms aman (UI tetap halus)
  const ESP_TIMEOUT_MS = 350;    // timeout fetch

  const WATT_PER_HP = 745.699872;

  // smoothing knobs (real)
  const FRONT_SMOOTH_ALPHA = 0.35;   // speed front smoothing
  const REAR_SMOOTH_ALPHA  = 0.35;   // speed rear smoothing
  const HP_SMOOTH_HZ       = 4.0;    // hp smoothing (low pass)
  const ACC_SMOOTH_ALPHA   = 0.25;   // accel smoothing

  // =========================
  // SLIP (peak + freeze)
  // =========================
  const SLIP_FREEZE_DIST_M = 10;   // freeze slip peak setelah 10m
  const SLIP_FREEZE_RPM    = 5000; // atau rpm lewat batas ini

  /* =========================================================
     FETCH HELPER (timeout + json safe) — gaya CDI
  ========================================================= */
  async function fetchJSON(url, opt = {}, timeoutMs = ESP_TIMEOUT_MS) {
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

  // Optional helper untuk “cek online” cepat (tanpa ubah file lain)
  window.getESPStatus_DUAL = async function () {
    try {
      const j = await fetchJSON(ESP_BASE_URL + ESP_SNAPSHOT, {}, 250);
      const ok = !!(j && (j.espReady === true || j.espReady === 1 || j.espReady === "1" || typeof j.front_total !== "undefined"));
      return { online: ok, host: ESP_BASE_URL };
    } catch {
      return { online: false, host: ESP_BASE_URL };
    }
  };

  const __DYNO_DUAL = {
    armed: false,
    running: false,

    // config dari dyno-road
    tickMs: 2,
    targetM: 200,
    circM: 1.85,

    pprFront: 1,
    pprRear:  1,
    weightKg: 120,

    // ratio untuk fallback rpm estimasi (kalau rpm valid = 0)
    ratio: 9.0,

    // UI range
    rpmStart: 2000,
    rpmEnd:   20000,

    // batas config
    minTargetM: 10,
    maxTargetM: 2001,
    minWeightKg: 30,
    maxWeightKg: 400,

    // logging
    logEveryMs: 20,
    _logAccMs: 0,

    // runtime
    t0: 0,          // tombol run (safety)
    lastNow: 0,

    // raw totals (from ESP)
    totalFrontPulses: 0,
    totalRearPulses:  0,

    // for dt from ESP packets
    _lastEspTsMs: 0,
    _lastEspPerfMs: 0,
    _lastFrontTotal: 0,
    _lastRearTotal: 0,

    // ===========================
    // TIME FROM FRONT PPR (same style)
    // ===========================
    _timeStarted: false,
    _frontRunStartPulses: 0,
    _frontStartPulses: 0,
    _frontPulseClockMs: 0,   // update ketika front_total naik
    _t0PulseMs: 0,
    _distM_fromFront: 0,

    // ===========================
    // SLIP (TOTAL/PEAK)
    // ===========================
    _slipStartFrontPulses: 0,
    _slipStartRearPulses: 0,
    _slipPeakPct: 0,
    _slipFrozen: false,

    slipPct: 0,
    slipOn: false,

    // SPEED live (front/rear)
    _vFront: 0, // m/s
    _vRear:  0, // m/s

    // accel + hp smoothing
    _vRearPrev: 0,
    _aRear: 0,
    _hpOut: 0,

    // RPM
    _rpmOut: 0,

    // output UI
    t: 0,
    distM: 0,
    distPulseM: 0,
    speedKmh: 0,
    rpm: 0,
    tq: 0,
    hp: 0,
    ign: 0,
    afr: 14.7,   // HOLD dulu

    maxHP: 0,
    maxTQ: 0,

    rows: [],
    seq: 0,

    // status utama (bukan status koneksi kecil)
    statusText: "READY",
    lastEvent: "",

    // koneksi indicator (untuk kotak status kecil di samping tombol ARM)
    linkOk: false,
    linkText: "DYNO TIDAK TERHUBUNG",
    _espPollTimer: null,
    _espInFlight: false,
    _espFailCount: 0
  };

  // ================================
  // PUBLIC API (dipakai dyno-road.js)
  // ================================
  window.DYNO_setConfig_DUAL = function(cfg = {}) {
    if (typeof cfg !== "object") return { ok: false };

    if (isFinite(cfg.tickMs)) __DYNO_DUAL.tickMs = Math.max(2, Math.round(cfg.tickMs));

    if (isFinite(cfg.targetM)) {
      __DYNO_DUAL.targetM = clamp(Math.round(cfg.targetM), __DYNO_DUAL.minTargetM, __DYNO_DUAL.maxTargetM);
    }

    if (isFinite(cfg.circM)) __DYNO_DUAL.circM = Math.max(0.2, parseFloat(cfg.circM) || __DYNO_DUAL.circM);

    // backward compat
    if (isFinite(cfg.ppr) && !isFinite(cfg.pprRear)) cfg.pprRear = cfg.ppr;
    if (isFinite(cfg.ppr) && !isFinite(cfg.pprFront)) cfg.pprFront = cfg.ppr;

    if (isFinite(cfg.pprFront)) __DYNO_DUAL.pprFront = Math.max(1, Math.round(cfg.pprFront));
    if (isFinite(cfg.pprRear))  __DYNO_DUAL.pprRear  = Math.max(1, Math.round(cfg.pprRear));

    if (isFinite(cfg.weightKg)) {
      __DYNO_DUAL.weightKg = clamp(Math.round(cfg.weightKg), __DYNO_DUAL.minWeightKg, __DYNO_DUAL.maxWeightKg);
    }

    if (isFinite(cfg.ratio)) __DYNO_DUAL.ratio = clamp(parseFloat(cfg.ratio), 1.0, 30.0);

    if (isFinite(cfg.rpmStart)) __DYNO_DUAL.rpmStart = clamp(Math.round(cfg.rpmStart), 500, 50000);
    if (isFinite(cfg.rpmEnd))   __DYNO_DUAL.rpmEnd   = clamp(Math.round(cfg.rpmEnd),  500, 50000);

    __DYNO_DUAL.logEveryMs = Math.max(12, __DYNO_DUAL.tickMs * 6);
    return { ok: true };
  };

  window.DYNO_arm_DUAL = async function(cfg = null) {
    if (cfg) window.DYNO_setConfig_DUAL(cfg);

    __DYNO_reset(true);
    __DYNO_DUAL.armed = true;
    __DYNO_DUAL.running = false;
    __DYNO_DUAL.statusText = "ARMED: siap RUN. Target = " + __DYNO_DUAL.targetM + " m";
    __DYNO_DUAL.lastEvent = "ARMED";

    __DYNO_startEspPoll(); // cek koneksi walau belum RUN
    return { ok: true };
  };

  window.DYNO_run_DUAL = async function() {
    if (!__DYNO_DUAL.armed) {
      __DYNO_DUAL.statusText = "HARUS ARM dulu.";
      __DYNO_DUAL.lastEvent = "NEED_ARM";
      return { ok: false, reason: "NEED_ARM" };
    }
    if (__DYNO_DUAL.running) return { ok: true };

    __DYNO_DUAL.running = true;

    // safety timeout pakai tombol RUN
    __DYNO_DUAL.t0 = performance.now();
    __DYNO_DUAL.lastNow = __DYNO_DUAL.t0;

    // gate start time (front ppr)
    __DYNO_DUAL._timeStarted = false;
    __DYNO_DUAL.t = 0;
    __DYNO_DUAL.distM = 0;
    __DYNO_DUAL._distM_fromFront = 0;

    __DYNO_DUAL._frontRunStartPulses = __DYNO_DUAL.totalFrontPulses;
    __DYNO_DUAL._frontStartPulses = __DYNO_DUAL.totalFrontPulses;
    __DYNO_DUAL._frontPulseClockMs = performance.now();
    __DYNO_DUAL._t0PulseMs = __DYNO_DUAL._frontPulseClockMs;

    // slip reset (mulai dari RUN)
    __DYNO_DUAL._slipStartFrontPulses = __DYNO_DUAL.totalFrontPulses;
    __DYNO_DUAL._slipStartRearPulses  = __DYNO_DUAL.totalRearPulses;
    __DYNO_DUAL._slipPeakPct = 0;
    __DYNO_DUAL._slipFrozen = false;
    __DYNO_DUAL.slipPct = 0;
    __DYNO_DUAL.slipOn  = false;

    // reset hp smoothing
    __DYNO_DUAL._logAccMs = 0;
    __DYNO_DUAL._hpOut = 0;
    __DYNO_DUAL._aRear = 0;
    __DYNO_DUAL._vRearPrev = __DYNO_DUAL._vRear;

    __DYNO_DUAL.statusText = "RUNNING... start time setelah 1 putaran roda depan.";
    __DYNO_DUAL.lastEvent = "RUNNING";

    __DYNO_pushRow(); // row awal (t=0 dist=0)
    __DYNO_startEspPoll(); // pastikan polling jalan
    return { ok: true };
  };

  window.DYNO_stop_DUAL = async function(reason = "STOP") {
    __DYNO_DUAL.running = false;
    __DYNO_DUAL.armed = false;
    __DYNO_DUAL.lastEvent = reason;

    if (reason === "AUTO_STOP") {
      __DYNO_DUAL.statusText = "AUTO STOP: target jarak tercapai (" + __DYNO_DUAL.targetM + " m).";
    } else if (reason === "TIMEOUT") {
      __DYNO_DUAL.statusText = "AUTO STOP: TIMEOUT.";
    } else {
      __DYNO_DUAL.statusText = "STOP. Data tersimpan (belum dihapus).";
    }

    __DYNO_stopEspPoll();
    return { ok: true };
  };

  window.DYNO_getSnapshot_DUAL = async function() {
    return {
      armed: __DYNO_DUAL.armed,
      running: __DYNO_DUAL.running,

      tickMs: __DYNO_DUAL.tickMs,
      targetM: __DYNO_DUAL.targetM,
      circM: __DYNO_DUAL.circM,
      pprFront: __DYNO_DUAL.pprFront,
      pprRear: __DYNO_DUAL.pprRear,
      weightKg: __DYNO_DUAL.weightKg,

      t: __DYNO_DUAL.t,
      distM: __DYNO_DUAL.distM,

      speedKmh: __DYNO_DUAL.speedKmh,
      rpm: __DYNO_DUAL.rpm,
      tq: __DYNO_DUAL.tq,
      hp: __DYNO_DUAL.hp,
      ign: __DYNO_DUAL.ign,
      afr: __DYNO_DUAL.afr,

      slipPct: __DYNO_DUAL.slipPct,
      slipOn:  __DYNO_DUAL.slipOn,

      maxHP: __DYNO_DUAL.maxHP,
      maxTQ: __DYNO_DUAL.maxTQ,

      rowsCount: __DYNO_DUAL.rows.length,
      seq: __DYNO_DUAL.seq,

      statusText: __DYNO_DUAL.statusText,
      lastEvent: __DYNO_DUAL.lastEvent,

      // ✅ koneksi indicator (untuk kotak status kecil)
      linkOk: __DYNO_DUAL.linkOk,
      linkText: __DYNO_DUAL.linkText
    };
  };

  window.DYNO_getRowsSince_DUAL = async function(lastSeq = 0) {
    const out = [];
    for (const r of __DYNO_DUAL.rows) if (r.seq > lastSeq) out.push(r);
    return { rows: out, seq: __DYNO_DUAL.seq };
  };

  // ================================
  // ESP POLLING
  // ================================
  function __DYNO_startEspPoll(){
    if (__DYNO_DUAL._espPollTimer) return;

    __DYNO_DUAL._lastEspPerfMs = performance.now();
    __DYNO_DUAL._espFailCount = 0;

    __DYNO_DUAL._espPollTimer = setInterval(() => {
      __DYNO_pollESP();
    }, ESP_POLL_MS);

    __DYNO_pollESP();
  }

  function __DYNO_stopEspPoll(){
    if (__DYNO_DUAL._espPollTimer){
      clearInterval(__DYNO_DUAL._espPollTimer);
      __DYNO_DUAL._espPollTimer = null;
    }
    __DYNO_DUAL._espInFlight = false;
  }

  async function __DYNO_pollESP(){
    if (__DYNO_DUAL._espInFlight) return;
    __DYNO_DUAL._espInFlight = true;

    const url = ESP_BASE_URL + ESP_SNAPSHOT;

    try{
      const j = await fetchJSON(url, {}, ESP_TIMEOUT_MS);

      // validasi minimal supaya “online” tidak false-positive
      const hasFront = j && (typeof j.front_total !== "undefined");
      const hasRear  = j && (typeof j.rear_total  !== "undefined");
      if (!hasFront || !hasRear) throw new Error("BAD_SNAPSHOT");

      __DYNO_DUAL._espFailCount = 0;
      __DYNO_setLink(true);

      __DYNO_applyEspSnapshot(j);
    }catch(e){
      __DYNO_DUAL._espFailCount++;

      if (__DYNO_DUAL._espFailCount >= 2) {
        __DYNO_setLink(false);
      }
      // tidak reset data: keep last-known
    }finally{
      __DYNO_DUAL._espInFlight = false;
    }

    // safety timeout kalau running tapi koneksi putus lama
    if (__DYNO_DUAL.running){
      const tSinceRun = (performance.now() - __DYNO_DUAL.t0) / 1000;
      if (tSinceRun >= 60) {
        __DYNO_DUAL.running = false;
        __DYNO_DUAL.armed = false;
        __DYNO_DUAL.lastEvent = "TIMEOUT";
        __DYNO_DUAL.statusText = "AUTO STOP: TIMEOUT.";
        __DYNO_stopEspPoll();
      }
    }
  }

  // Event optional untuk UI (kalau dyno-road.js mau dengar)
  function __DYNO_emitConn(){
    try{
      window.dispatchEvent(new CustomEvent("DYNO_CONN", {
        detail: {
          ok: __DYNO_DUAL.linkOk,
          text: __DYNO_DUAL.linkText,
          host: ESP_BASE_URL,
          ts: Date.now()
        }
      }));
    }catch(e){}
  }

  function __DYNO_setLink(isOk){
    const next = !!isOk;
    if (next === __DYNO_DUAL.linkOk) return;

    __DYNO_DUAL.linkOk = next;
    __DYNO_DUAL.linkText = __DYNO_DUAL.linkOk ? "DYNO TERHUBUNG" : "DYNO TIDAK TERHUBUNG";

    __DYNO_emitConn();
  }

  function __DYNO_applyEspSnapshot(j){
    // Ambil mentah
    const tsMs       = isFinite(j.ts_ms) ? +j.ts_ms : 0;
    const frontTotal = isFinite(j.front_total) ? Math.max(0, Math.floor(+j.front_total)) : __DYNO_DUAL.totalFrontPulses;
    const rearTotal  = isFinite(j.rear_total)  ? Math.max(0, Math.floor(+j.rear_total))  : __DYNO_DUAL.totalRearPulses;

    const rpmValid   = (isFinite(j.rpm_valid) ? (+j.rpm_valid) : 0) ? 1 : 0;
    const rpmIn      = isFinite(j.rpm) ? (+j.rpm) : 0;

    // Optional: sync dari ESP (disabled by default)
    if (isFinite(j.circ_m) && j.circ_m > 0.2 && j.circ_m < 10) {
      // __DYNO_DUAL.circM = +j.circ_m;
    }
    if (isFinite(j.ppr_f) && j.ppr_f >= 1 && j.ppr_f <= 2000) {
      // __DYNO_DUAL.pprFront = Math.round(+j.ppr_f);
    }
    if (isFinite(j.ppr_r) && j.ppr_r >= 1 && j.ppr_r <= 2000) {
      // __DYNO_DUAL.pprRear = Math.round(+j.ppr_r);
    }

    const pf = Math.max(1, __DYNO_DUAL.pprFront);
    const pr = Math.max(1, __DYNO_DUAL.pprRear);
    const circ = Math.max(0.2, __DYNO_DUAL.circM);

    // dt untuk speed calc
    const nowPerf = performance.now();
    const lastPerf = __DYNO_DUAL._lastEspPerfMs || nowPerf;
    let dtSec = (nowPerf - lastPerf) / 1000;
    if (!isFinite(dtSec) || dtSec <= 0) dtSec = ESP_POLL_MS / 1000;

    __DYNO_DUAL._lastEspPerfMs = nowPerf;
    __DYNO_DUAL._lastEspTsMs = tsMs || __DYNO_DUAL._lastEspTsMs;

    // delta pulses
    const dFront = frontTotal - (__DYNO_DUAL._lastFrontTotal || 0);
    const dRear  = rearTotal  - (__DYNO_DUAL._lastRearTotal  || 0);

    __DYNO_DUAL._lastFrontTotal = frontTotal;
    __DYNO_DUAL._lastRearTotal  = rearTotal;

    // set totals
    __DYNO_DUAL.totalFrontPulses = frontTotal;
    __DYNO_DUAL.totalRearPulses  = rearTotal;

    // pulse clock update kalau ada pulse depan
    if (dFront > 0) {
      __DYNO_DUAL._frontPulseClockMs = nowPerf;
    }

    // 1) speed front
    {
      const distStep = (dFront / pf) * circ;
      const vInst = distStep / Math.max(0.001, dtSec);
      __DYNO_DUAL._vFront = __DYNO_DUAL._vFront + (vInst - __DYNO_DUAL._vFront) * FRONT_SMOOTH_ALPHA;
      __DYNO_DUAL._vFront = clamp(__DYNO_DUAL._vFront, 0, 200);
    }

    // 2) speed rear
    {
      const distStep = (dRear / pr) * circ;
      const vInst = distStep / Math.max(0.001, dtSec);
      __DYNO_DUAL._vRear = __DYNO_DUAL._vRear + (vInst - __DYNO_DUAL._vRear) * REAR_SMOOTH_ALPHA;
      __DYNO_DUAL._vRear = clamp(__DYNO_DUAL._vRear, 0, 200);
    }

    // 3) accel rear (smooth)
    {
      const aInst = (__DYNO_DUAL._vRear - __DYNO_DUAL._vRearPrev) / Math.max(1e-6, dtSec);
      __DYNO_DUAL._vRearPrev = __DYNO_DUAL._vRear;
      __DYNO_DUAL._aRear = __DYNO_DUAL._aRear + (aInst - __DYNO_DUAL._aRear) * ACC_SMOOTH_ALPHA;
    }

    // 4) RPM
    {
      let rpm = 0;
      if (rpmValid && isFinite(rpmIn) && rpmIn > 0) {
        rpm = rpmIn;
      } else {
        const wheelRpm = (__DYNO_DUAL._vFront / circ) * 60;
        rpm = wheelRpm * __DYNO_DUAL.ratio;
      }
      rpm = clamp(rpm, __DYNO_DUAL.rpmStart, __DYNO_DUAL.rpmEnd);

      const rpmAlpha = clamp(0.10 + dtSec * 6.0, 0.12, 0.55);
      __DYNO_DUAL._rpmOut = __DYNO_DUAL._rpmOut + (rpm - __DYNO_DUAL._rpmOut) * rpmAlpha;
      __DYNO_DUAL.rpm = __DYNO_DUAL._rpmOut;
    }

    // 5) SLIP peak + freeze (sejak RUN)
    {
      const frontRevRun = (__DYNO_DUAL.totalFrontPulses - __DYNO_DUAL._slipStartFrontPulses) / pf;
      const rearRevRun  = (__DYNO_DUAL.totalRearPulses  - __DYNO_DUAL._slipStartRearPulses)  / pr;
      const slipRevNow  = Math.max(0, rearRevRun - frontRevRun);
      const slipPctNow  = isFinite(slipRevNow) ? slipRevNow : 0;

      if (!__DYNO_DUAL._slipFrozen) {
        __DYNO_DUAL._slipPeakPct = Math.max(__DYNO_DUAL._slipPeakPct, slipPctNow);

        const distRun = Math.max(0, frontRevRun) * circ;
        if (distRun >= SLIP_FREEZE_DIST_M || __DYNO_DUAL.rpm > SLIP_FREEZE_RPM) {
          __DYNO_DUAL._slipFrozen = true;
        }
      }

      __DYNO_DUAL.slipPct = clamp(__DYNO_DUAL._slipPeakPct, 0, 9999);
      __DYNO_DUAL.slipOn  = (__DYNO_DUAL._slipPeakPct > 1e-6);
    }

    // 6) START TIME setelah 1 putaran roda depan sejak RUN
    if (__DYNO_DUAL.running) {
      if (!__DYNO_DUAL._timeStarted) {
        const pulsesSinceRun = __DYNO_DUAL.totalFrontPulses - __DYNO_DUAL._frontRunStartPulses;
        const revSinceRun = pulsesSinceRun / pf;

        if (revSinceRun >= 1.0) {
          __DYNO_DUAL._timeStarted = true;

          __DYNO_DUAL._t0PulseMs = __DYNO_DUAL._frontPulseClockMs || nowPerf;
          __DYNO_DUAL._frontStartPulses = __DYNO_DUAL.totalFrontPulses;

          __DYNO_DUAL.t = 0;
          __DYNO_DUAL.distM = 0;
          __DYNO_DUAL._distM_fromFront = 0;

          __DYNO_DUAL.lastEvent = "TIME_START";
        } else {
          __DYNO_DUAL.t = 0;
          __DYNO_DUAL.distM = 0;
          __DYNO_DUAL._distM_fromFront = 0;
        }
      }

      // 7) OUTPUT time/dist dari FRONT PPR
      __DYNO_DUAL.distPulseM = (__DYNO_DUAL.totalFrontPulses / pf) * circ;

      if (__DYNO_DUAL._timeStarted) {
        const pulsesSinceStart = __DYNO_DUAL.totalFrontPulses - __DYNO_DUAL._frontStartPulses;
        __DYNO_DUAL._distM_fromFront = (pulsesSinceStart / pf) * circ;

        const tPulse = ((__DYNO_DUAL._frontPulseClockMs || nowPerf) - __DYNO_DUAL._t0PulseMs) / 1000;
        __DYNO_DUAL.t = Math.max(0, tPulse);
        __DYNO_DUAL.distM = Math.max(0, __DYNO_DUAL._distM_fromFront);
      } else {
        __DYNO_DUAL.t = 0;
        __DYNO_DUAL.distM = 0;
      }

      // 8) SPEED LIVE dari front
      __DYNO_DUAL.speedKmh = Math.max(0, __DYNO_DUAL._vFront) * 3.6;

      // 9) HP dari m*a*v, hanya setelah start time
      if (__DYNO_DUAL._timeStarted) {
        const m = Math.max(1, __DYNO_DUAL.weightKg);
        const vUse = Math.max(0, __DYNO_DUAL._vRear);
        const aUse = Math.max(0, __DYNO_DUAL._aRear);
        const P_watt = Math.max(0, (m * aUse) * vUse);

        let hpRaw = P_watt / WATT_PER_HP;
        hpRaw = clamp(hpRaw, 0, 999);

        const hpBeta = clamp(1.0 - Math.exp(-dtSec * HP_SMOOTH_HZ), 0.03, 0.35);
        __DYNO_DUAL._hpOut = __DYNO_DUAL._hpOut + (hpRaw - __DYNO_DUAL._hpOut) * hpBeta;

        __DYNO_DUAL.hp = clamp(__DYNO_DUAL._hpOut, 0, 999);

        const rpmNow = clamp(__DYNO_DUAL.rpm, __DYNO_DUAL.rpmStart, __DYNO_DUAL.rpmEnd);
        __DYNO_DUAL.tq = (__DYNO_DUAL.hp * 7127) / Math.max(1, rpmNow);

        __DYNO_DUAL.ign = clamp(12 + (rpmNow / 20000) * 18, 0, 70);
        __DYNO_DUAL.afr = 14.7; // HOLD
      } else {
        __DYNO_DUAL.hp  = 0;
        __DYNO_DUAL.tq  = 0;
        __DYNO_DUAL.ign = 0;
        __DYNO_DUAL.afr = 14.7;
      }

      if (__DYNO_DUAL.hp > __DYNO_DUAL.maxHP) __DYNO_DUAL.maxHP = __DYNO_DUAL.hp;
      if (__DYNO_DUAL.tq > __DYNO_DUAL.maxTQ) __DYNO_DUAL.maxTQ = __DYNO_DUAL.tq;

      // logging rows (hanya setelah start time)
      __DYNO_DUAL._logAccMs += dtSec * 1000;
      if (__DYNO_DUAL._timeStarted && __DYNO_DUAL._logAccMs >= __DYNO_DUAL.logEveryMs) {
        __DYNO_DUAL._logAccMs = 0;
        __DYNO_pushRow();
      }

      // AUTO STOP dari jarak FRONT PPR
      if (__DYNO_DUAL._timeStarted && __DYNO_DUAL.distM >= __DYNO_DUAL.targetM) {
        __DYNO_DUAL.distM = __DYNO_DUAL.targetM;
        __DYNO_DUAL.running = false;
        __DYNO_DUAL.armed = false;
        __DYNO_DUAL.lastEvent = "AUTO_STOP";
        __DYNO_DUAL.statusText = "AUTO STOP: target jarak tercapai (" + __DYNO_DUAL.targetM + " m).";
        __DYNO_stopEspPoll();
      }

    } else {
      __DYNO_DUAL.speedKmh = Math.max(0, __DYNO_DUAL._vFront) * 3.6;
      __DYNO_DUAL.distPulseM = (__DYNO_DUAL.totalFrontPulses / pf) * circ;
    }
  }

  // ================================
  // INTERNAL HELPERS
  // ================================
  function __DYNO_reset(clearLog) {
    __DYNO_stopEspPoll();

    __DYNO_DUAL.t0 = 0;
    __DYNO_DUAL.lastNow = 0;
    __DYNO_DUAL._logAccMs = 0;

    __DYNO_DUAL.t = 0;

    __DYNO_DUAL.totalFrontPulses = 0;
    __DYNO_DUAL.totalRearPulses = 0;

    __DYNO_DUAL._lastEspTsMs = 0;
    __DYNO_DUAL._lastEspPerfMs = performance.now();
    __DYNO_DUAL._lastFrontTotal = 0;
    __DYNO_DUAL._lastRearTotal  = 0;

    // time-from-front reset
    __DYNO_DUAL._timeStarted = false;
    __DYNO_DUAL._frontRunStartPulses = 0;
    __DYNO_DUAL._frontStartPulses = 0;
    __DYNO_DUAL._frontPulseClockMs = performance.now();
    __DYNO_DUAL._t0PulseMs = __DYNO_DUAL._frontPulseClockMs;
    __DYNO_DUAL._distM_fromFront = 0;

    // slip reset
    __DYNO_DUAL._slipStartFrontPulses = 0;
    __DYNO_DUAL._slipStartRearPulses  = 0;
    __DYNO_DUAL._slipPeakPct = 0;
    __DYNO_DUAL._slipFrozen = false;
    __DYNO_DUAL.slipPct = 0;
    __DYNO_DUAL.slipOn  = false;

    __DYNO_DUAL._vFront = 0;
    __DYNO_DUAL._vRear  = 0;

    __DYNO_DUAL._vRearPrev = 0;
    __DYNO_DUAL._aRear = 0;
    __DYNO_DUAL._hpOut = 0;

    __DYNO_DUAL._rpmOut = __DYNO_DUAL.rpmStart;

    __DYNO_DUAL.distM = 0;
    __DYNO_DUAL.distPulseM = 0;
    __DYNO_DUAL.speedKmh = 0;
    __DYNO_DUAL.rpm = __DYNO_DUAL.rpmStart;
    __DYNO_DUAL.tq = 0;
    __DYNO_DUAL.hp = 0;
    __DYNO_DUAL.ign = 0;
    __DYNO_DUAL.afr = 14.7;

    __DYNO_DUAL.maxHP = 0;
    __DYNO_DUAL.maxTQ = 0;

    if (clearLog) {
      __DYNO_DUAL.rows = [];
      __DYNO_DUAL.seq = 0;
    }

    __DYNO_DUAL.statusText = "READY";
    __DYNO_DUAL.lastEvent = "READY";

    __DYNO_DUAL.linkOk = false;
    __DYNO_DUAL.linkText = "DYNO TIDAK TERHUBUNG";
    __DYNO_emitConn();
  }

  function __DYNO_pushRow() {
    __DYNO_DUAL.seq++;
    __DYNO_DUAL.rows.push({
      seq: __DYNO_DUAL.seq,
      t: __DYNO_DUAL.t,
      rpm: __DYNO_DUAL.rpm,
      tq: __DYNO_DUAL.tq,
      hp: __DYNO_DUAL.hp,
      ign: __DYNO_DUAL.ign,
      afr: __DYNO_DUAL.afr,
      dist: __DYNO_DUAL.distM,
      spd: __DYNO_DUAL.speedKmh
    });

    if (__DYNO_DUAL.rows.length > 6000) {
      __DYNO_DUAL.rows.splice(0, __DYNO_DUAL.rows.length - 6000);
    }
  }

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

})();
