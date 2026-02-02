/* =========================================================
   esp-api-dual.js — DYNO-ROAD ONLY (SIM) — TIME FROM FRONT PPR
   + CONNECT STATUS SIM (TERHUBUNG / TIDAK)
   - DYNO_getConn_DUAL() dipakai dyno-road.js untuk kotak status
   - Simulasi: status koneksi ON/OFF bergantian
========================================================= */

console.log("%c[ESP-API-DUAL] DYNO-ROAD SIM (TIME FROM FRONT PPR)", "color:#4cff8f");

(function () {

const SIM_DELAY_DUAL = 0;

const WATT_PER_HP = 745.699872;

// target simulasi
const TARGET_HP_PEAK = 14.0;
const TARGET_SPEED_KMH = 150.0;
const VMAX = TARGET_SPEED_KMH / 3.6; // m/s

// ✅ SIM rear dibuat halus agar grafik HP/TQ tidak zigzag
const SIM_IDEAL_REAR = true;

// smoothing knobs
const REAR_SLEW_HZ_SIM = 7.0;   // 5..10
const HP_SMOOTH_HZ     = 4.0;

// speed LIVE dari PPR depan
const FRONT_WIN_MS = 100;

// =========================
// ✅ SLIP SIM (awal start)
// =========================
const SLIP_SIM_ENABLE = true;
const SLIP_SIM_RPM_MIN = 2000;
const SLIP_SIM_RPM_MAX = 5000;
const SLIP_SIM_DIST_M  = 1.0;
const SLIP_SIM_EXTRA_MAX = 1.5;

// =========================
// ✅ CONNECT STATUS SIM
// =========================
// ON/OFF bergantian. Ini hanya indikator, tidak mengubah dyno sim.
const CONN_SIM_ENABLE = true;
const CONN_TOGGLE_MS  = 3500;     // ganti status tiap 3.5 detik

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

  // rasio wheel rpm -> engine rpm (sim)
  ratio: 9.0,

  // UI range
  rpmStart: 2000,
  rpmEnd:   20000,

  // tuning akselerasi sim
  thrustN_base: 750,

  // batas config
  minTargetM: 10,
  maxTargetM: 2001,
  minWeightKg: 30,
  maxWeightKg: 400,

  // logging
  logEveryMs: 10,
  _logAccMs: 0,

  // runtime loop
  t0: 0,
  lastNow: 0,
  _accMs: 0,
  _timer: null,

  // sensor pulse totals (SIM / nanti real)
  totalFrontPulses: 0,
  totalRearPulses:  0,
  _frontPulseFrac: 0,
  _rearPulseFrac:  0,

  // motion true internal (kontinu)
  _vTrue: 0,
  _distTrue: 0,

  // ===========================
  // ✅ TIME FROM FRONT PPR
  // ===========================
  _timeStarted: false,
  _frontRunStartPulses: 0,
  _frontStartPulses: 0,
  _frontPulseClockMs: 0,
  _t0PulseMs: 0,
  _distM_fromFront: 0,

  // ===========================
  // ✅ SLIP (TOTAL/PEAK)
  // ===========================
  _slipRevTotal: 0,
  _slipStartFrontPulses: 0,
  _slipStartRearPulses: 0,
  _slipPeakPct: 0,
  _slipFrozen: false,

  slipPct: 0,
  slipOn: false,

  // LIVE speed (front)
  _frontWinAccMs: 0,
  _frontWinStartPulses: 0,
  _vFront: 0,

  // REAR for HP
  _rearLastPulses: 0,
  _rearLastPulseMs: 0,
  _vRearTarget: 0,
  _vRear: 0,
  _vRearPrev: 0,
  _aRear: 0,

  // RPM
  _rpmTrue: 0,
  _rpmOut: 0,

  // HP smoothing
  _hpOut: 0,

  // output UI
  t: 0,
  distM: 0,
  distPulseM: 0,
  speedKmh: 0,
  rpm: 0,
  tq: 0,
  hp: 0,
  ign: 0,
  afr: 14.7,

  maxHP: 0,
  maxTQ: 0,

  rows: [],
  seq: 0,

  statusText: "READY",
  lastEvent: "",

  // ===========================
  // ✅ CONNECT INDICATOR
  // ===========================
  connected: false,          // indikator koneksi saja
  _connTimer: null
};

// ================================
// ✅ CONNECT SIM START
// ================================
function __startConnSim(){
  if (!CONN_SIM_ENABLE) return;
  if (__DYNO_DUAL._connTimer) return;

  // initial: OFF
  __DYNO_DUAL.connected = false;

  __DYNO_DUAL._connTimer = setInterval(() => {
    __DYNO_DUAL.connected = !__DYNO_DUAL.connected;
  }, Math.max(500, CONN_TOGGLE_MS));
}
__startConnSim();

// ================================
// PUBLIC API (CONNECT)
// ================================
window.DYNO_getConn_DUAL = async function(){
  await delayDual(SIM_DELAY_DUAL);
  return {
    connected: !!__DYNO_DUAL.connected,
    sim: true
  };
};

// Untuk nanti ESP32 asli: bisa set manual
window.DYNO_setConnected_DUAL = function(v){
  __DYNO_DUAL.connected = !!v;
  return { ok:true, connected: __DYNO_DUAL.connected };
};

// ================================
// PUBLIC API (DYNO)
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

  __DYNO_DUAL.logEveryMs = Math.max(8, __DYNO_DUAL.tickMs * 5);
  return { ok: true };
};

window.DYNO_arm_DUAL = async function(cfg = null) {
  await delayDual(1);
  if (cfg) window.DYNO_setConfig_DUAL(cfg);

  __DYNO_reset(true);
  __DYNO_DUAL.armed = true;
  __DYNO_DUAL.running = false;
  __DYNO_DUAL.statusText = "ARMED: siap RUN. Target = " + __DYNO_DUAL.targetM + " m";
  __DYNO_DUAL.lastEvent = "ARMED";
  return { ok: true };
};

window.DYNO_run_DUAL = async function() {
  await delayDual(1);

  if (!__DYNO_DUAL.armed) {
    __DYNO_DUAL.statusText = "HARUS ARM dulu.";
    __DYNO_DUAL.lastEvent = "NEED_ARM";
    return { ok: false, reason: "NEED_ARM" };
  }
  if (__DYNO_DUAL.running) return { ok: true };

  __DYNO_DUAL.running = true;

  // tombol RUN (safety timeout)
  __DYNO_DUAL.t0 = performance.now();
  __DYNO_DUAL.lastNow = __DYNO_DUAL.t0;
  __DYNO_DUAL._accMs = 0;
  __DYNO_DUAL._logAccMs = 0;

  // ✅ time dari PPR depan: reset gate start
  __DYNO_DUAL._timeStarted = false;
  __DYNO_DUAL.t = 0;
  __DYNO_DUAL.distM = 0;
  __DYNO_DUAL._distM_fromFront = 0;

  __DYNO_DUAL._frontRunStartPulses = __DYNO_DUAL.totalFrontPulses;
  __DYNO_DUAL._frontStartPulses = __DYNO_DUAL.totalFrontPulses;
  __DYNO_DUAL._frontPulseClockMs = performance.now();
  __DYNO_DUAL._t0PulseMs = __DYNO_DUAL._frontPulseClockMs;

  // ✅ SLIP: reset total slip (mulai dari RUN)
  __DYNO_DUAL._slipRevTotal = 0;
  __DYNO_DUAL._slipStartFrontPulses = __DYNO_DUAL.totalFrontPulses;
  __DYNO_DUAL._slipStartRearPulses  = __DYNO_DUAL.totalRearPulses;
  __DYNO_DUAL._slipPeakPct = 0;
  __DYNO_DUAL._slipFrozen = false;
  __DYNO_DUAL.slipPct = 0;
  __DYNO_DUAL.slipOn  = false;

  __DYNO_DUAL.statusText = "RUNNING... start time setelah 1 putaran roda depan.";
  __DYNO_DUAL.lastEvent = "RUNNING";

  __DYNO_pushRow(); // row awal
  __DYNO_startLoop();
  return { ok: true };
};

window.DYNO_stop_DUAL = async function(reason = "STOP") {
  await delayDual(1);

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

  __DYNO_stopLoop();
  return { ok: true };
};

window.DYNO_getSnapshot_DUAL = async function() {
  await delayDual(SIM_DELAY_DUAL);

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
    lastEvent: __DYNO_DUAL.lastEvent
  };
};

window.DYNO_getRowsSince_DUAL = async function(lastSeq = 0) {
  await delayDual(SIM_DELAY_DUAL);
  const out = [];
  for (const r of __DYNO_DUAL.rows) if (r.seq > lastSeq) out.push(r);
  return { rows: out, seq: __DYNO_DUAL.seq };
};

// ================================
// LOOP
// ================================
function __DYNO_startLoop() {
  if (__DYNO_DUAL._timer) return;
  const loopMs = 4;
  __DYNO_DUAL._timer = setInterval(() => {
    if (!__DYNO_DUAL.running) return;
    __DYNO_advanceToNow();
  }, loopMs);
}
function __DYNO_stopLoop() {
  if (__DYNO_DUAL._timer) {
    clearInterval(__DYNO_DUAL._timer);
    __DYNO_DUAL._timer = null;
  }
}

function __DYNO_reset(clearLog) {
  __DYNO_stopLoop();

  __DYNO_DUAL.t0 = 0;
  __DYNO_DUAL.lastNow = 0;
  __DYNO_DUAL._accMs = 0;
  __DYNO_DUAL._logAccMs = 0;

  __DYNO_DUAL.t = 0;

  __DYNO_DUAL.totalFrontPulses = 0;
  __DYNO_DUAL.totalRearPulses = 0;
  __DYNO_DUAL._frontPulseFrac = 0;
  __DYNO_DUAL._rearPulseFrac = 0;

  __DYNO_DUAL._vTrue = 0;
  __DYNO_DUAL._distTrue = 0;

  // time-from-front reset
  __DYNO_DUAL._timeStarted = false;
  __DYNO_DUAL._frontRunStartPulses = 0;
  __DYNO_DUAL._frontStartPulses = 0;
  __DYNO_DUAL._frontPulseClockMs = performance.now();
  __DYNO_DUAL._t0PulseMs = __DYNO_DUAL._frontPulseClockMs;
  __DYNO_DUAL._distM_fromFront = 0;

  // slip reset
  __DYNO_DUAL._slipRevTotal = 0;
  __DYNO_DUAL._slipStartFrontPulses = 0;
  __DYNO_DUAL._slipStartRearPulses  = 0;
  __DYNO_DUAL._slipPeakPct = 0;
  __DYNO_DUAL._slipFrozen = false;
  __DYNO_DUAL.slipPct = 0;
  __DYNO_DUAL.slipOn  = false;

  __DYNO_DUAL._frontWinAccMs = 0;
  __DYNO_DUAL._frontWinStartPulses = 0;
  __DYNO_DUAL._vFront = 0;

  __DYNO_DUAL._rearLastPulses = 0;
  __DYNO_DUAL._rearLastPulseMs = performance.now();
  __DYNO_DUAL._vRearTarget = 0;
  __DYNO_DUAL._vRear = 0;
  __DYNO_DUAL._vRearPrev = 0;
  __DYNO_DUAL._aRear = 0;

  __DYNO_DUAL._rpmTrue = __DYNO_DUAL.rpmStart;
  __DYNO_DUAL._rpmOut = __DYNO_DUAL.rpmStart;

  __DYNO_DUAL._hpOut = 0;

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
}

function __DYNO_advanceToNow() {
  const now = performance.now();
  let dtMs = now - (__DYNO_DUAL.lastNow || now);
  if (!isFinite(dtMs) || dtMs < 0) dtMs = 0;

  __DYNO_DUAL.lastNow = now;
  __DYNO_DUAL._accMs += dtMs;

  const stepMs = Math.max(2, __DYNO_DUAL.tickMs);
  const maxSteps = 400;
  let steps = 0;

  while (__DYNO_DUAL._accMs >= stepMs && steps < maxSteps && __DYNO_DUAL.running) {
    __DYNO_DUAL._accMs -= stepMs;
    __DYNO_step(stepMs / 1000);
    steps++;
  }
}

// ================================
// CORE SIM + MEASURE
// ================================
function __DYNO_step(dt) {
  const nowMs = performance.now();

  // safety timeout (pakai tombol run timer)
  const tSinceRun = (nowMs - __DYNO_DUAL.t0) / 1000;
  if (tSinceRun >= 60) {
    __DYNO_DUAL.running = false;
    __DYNO_DUAL.armed = false;
    __DYNO_DUAL.lastEvent = "TIMEOUT";
    __DYNO_DUAL.statusText = "AUTO STOP: TIMEOUT.";
    __DYNO_stopLoop();
    return;
  }

  const m = Math.max(1, __DYNO_DUAL.weightKg);
  const circ = Math.max(0.2, __DYNO_DUAL.circM);

  // 1) SIMULASI GERAK (TRUE)
  const v = __DYNO_DUAL._vTrue;
  const vKmh = v * 3.6;

  const drop = clamp(1.0 - (vKmh / TARGET_SPEED_KMH) * 0.25, 0.65, 1.0);
  const thrustN = __DYNO_DUAL.thrustN_base * drop;

  const aTrue = thrustN / m;

  __DYNO_DUAL._vTrue = clamp(v + aTrue * dt, 0, VMAX);
  const distStep = __DYNO_DUAL._vTrue * dt;
  __DYNO_DUAL._distTrue += distStep;

  // 2) GENERATE PULSES (SIM)
  const rev = distStep / circ;

  const pf = Math.max(1, __DYNO_DUAL.pprFront);
  __DYNO_DUAL._frontPulseFrac += rev * pf;

  let addFront = 0;
  if (__DYNO_DUAL._frontPulseFrac >= 1) {
    addFront = Math.floor(__DYNO_DUAL._frontPulseFrac);
    __DYNO_DUAL.totalFrontPulses += addFront;
    __DYNO_DUAL._frontPulseFrac -= addFront;

    // time source: pulse clock hanya maju kalau ada pulse
    __DYNO_DUAL._frontPulseClockMs = nowMs;
  }

  const rpmEst = clamp(((__DYNO_DUAL._vTrue / circ) * 60) * __DYNO_DUAL.ratio, __DYNO_DUAL.rpmStart, __DYNO_DUAL.rpmEnd);

  const pr = Math.max(1, __DYNO_DUAL.pprRear);

  // SLIP SIM hanya awal start
  let slipFactor = 0;
  if (SLIP_SIM_ENABLE && !__DYNO_DUAL._slipFrozen) {
    const frontRevRun = (__DYNO_DUAL.totalFrontPulses - __DYNO_DUAL._slipStartFrontPulses) / pf;
    const distRun = Math.max(0, frontRevRun) * circ;
    if (distRun < SLIP_SIM_DIST_M && rpmEst >= SLIP_SIM_RPM_MIN && rpmEst <= SLIP_SIM_RPM_MAX) {
      const k = clamp(1.0 - (distRun / Math.max(0.001, SLIP_SIM_DIST_M)), 0, 1);
      slipFactor = SLIP_SIM_EXTRA_MAX * k;
    }
  }

  __DYNO_DUAL._rearPulseFrac += (rev * pr) * (1.0 + slipFactor);
  if (__DYNO_DUAL._rearPulseFrac >= 1) {
    const addRear = Math.floor(__DYNO_DUAL._rearPulseFrac);
    __DYNO_DUAL.totalRearPulses += addRear;
    __DYNO_DUAL._rearPulseFrac -= addRear;
  }

  // 3) LIVE SPEED dari PPR DEPAN (window)
  __DYNO_DUAL._frontWinAccMs += dt * 1000;
  if (__DYNO_DUAL._frontWinAccMs >= FRONT_WIN_MS) {
    const winSec = FRONT_WIN_MS / 1000;
    const pulsesNow = __DYNO_DUAL.totalFrontPulses;
    const dPulses = pulsesNow - __DYNO_DUAL._frontWinStartPulses;

    const distWin = (dPulses / pf) * circ;
    const vInst = distWin / Math.max(0.001, winSec);

    const alpha = 0.35;
    __DYNO_DUAL._vFront = __DYNO_DUAL._vFront + (vInst - __DYNO_DUAL._vFront) * alpha;

    __DYNO_DUAL._frontWinAccMs -= FRONT_WIN_MS;
    __DYNO_DUAL._frontWinStartPulses = pulsesNow;
  }

  // SLIP TOTAL (peak)
  {
    const frontRevRun = (__DYNO_DUAL.totalFrontPulses - __DYNO_DUAL._slipStartFrontPulses) / pf;
    const rearRevRun  = (__DYNO_DUAL.totalRearPulses  - __DYNO_DUAL._slipStartRearPulses)  / pr;
    const slipRevNow  = Math.max(0, rearRevRun - frontRevRun);
    const slipPctNow  = isFinite(slipRevNow) ? slipRevNow : 0;

    if (!__DYNO_DUAL._slipFrozen) {
      __DYNO_DUAL._slipPeakPct = Math.max(__DYNO_DUAL._slipPeakPct, slipPctNow);
      const distRun = Math.max(0, frontRevRun) * circ;
      if (distRun >= 10 || rpmEst > SLIP_SIM_RPM_MAX) {
        __DYNO_DUAL._slipFrozen = true;
      }
    }

    __DYNO_DUAL.slipPct = clamp(__DYNO_DUAL._slipPeakPct, 0, 9999);
    __DYNO_DUAL.slipOn  = (__DYNO_DUAL._slipPeakPct > 1e-6);
  }

  // START TIME setelah 1 putaran roda depan
  if (!__DYNO_DUAL._timeStarted) {
    const pulsesSinceRun = __DYNO_DUAL.totalFrontPulses - __DYNO_DUAL._frontRunStartPulses;
    const revSinceRun = pulsesSinceRun / pf;

    if (revSinceRun >= 1.0) {
      __DYNO_DUAL._timeStarted = true;

      __DYNO_DUAL._t0PulseMs = __DYNO_DUAL._frontPulseClockMs || nowMs;
      __DYNO_DUAL._frontStartPulses = __DYNO_DUAL.totalFrontPulses;

      __DYNO_DUAL.t = 0;
      __DYNO_DUAL.distM = 0;
      __DYNO_DUAL._distM_fromFront = 0;

      __DYNO_DUAL.statusText = "RUNNING... (time start setelah 1 putaran depan)";
      __DYNO_DUAL.lastEvent = "TIME_START";
    } else {
      __DYNO_DUAL.t = 0;
      __DYNO_DUAL.distM = 0;
      __DYNO_DUAL._distM_fromFront = 0;
    }
  }

  // 4) REAR SPEED untuk HP
  if (SIM_IDEAL_REAR) {
    __DYNO_DUAL._vRearTarget = __DYNO_DUAL._vTrue;
    const beta = clamp(1.0 - Math.exp(-dt * REAR_SLEW_HZ_SIM), 0.02, 0.45);
    __DYNO_DUAL._vRear = __DYNO_DUAL._vRear + (__DYNO_DUAL._vRearTarget - __DYNO_DUAL._vRear) * beta;
    __DYNO_DUAL._vRear = clamp(__DYNO_DUAL._vRear, 0, VMAX);
  } else {
    const rearNow = __DYNO_DUAL.totalRearPulses;
    const dRear = rearNow - __DYNO_DUAL._rearLastPulses;

    if (dRear > 0) {
      const dtPulse = Math.max(0.001, (nowMs - __DYNO_DUAL._rearLastPulseMs) / 1000);
      const distPulse = (dRear / pr) * circ;
      const vTarget = distPulse / dtPulse;

      __DYNO_DUAL._vRearTarget = clamp(vTarget, 0, VMAX);
      __DYNO_DUAL._rearLastPulseMs = nowMs;
      __DYNO_DUAL._rearLastPulses = rearNow;
    }

    const beta = clamp(1.0 - Math.exp(-dt * 10.0), 0.02, 0.45);
    __DYNO_DUAL._vRear = __DYNO_DUAL._vRear + (__DYNO_DUAL._vRearTarget - __DYNO_DUAL._vRear) * beta;
    __DYNO_DUAL._vRear = clamp(__DYNO_DUAL._vRear, 0, VMAX);
  }

  // accel rear (halus)
  const aInst = (__DYNO_DUAL._vRear - __DYNO_DUAL._vRearPrev) / Math.max(1e-6, dt);
  __DYNO_DUAL._vRearPrev = __DYNO_DUAL._vRear;

  const aAlpha = clamp(0.10 + dt * 8.0, 0.12, 0.40);
  __DYNO_DUAL._aRear = __DYNO_DUAL._aRear + (aInst - __DYNO_DUAL._aRear) * aAlpha;

  // 5) RPM mesin (halus)
  const wheelRpmTrue = (__DYNO_DUAL._vTrue / circ) * 60;
  const rpmTrue = wheelRpmTrue * __DYNO_DUAL.ratio;

  __DYNO_DUAL._rpmTrue = clamp(rpmTrue, __DYNO_DUAL.rpmStart, __DYNO_DUAL.rpmEnd);

  const rpmAlpha = clamp(0.10 + dt * 6.0, 0.12, 0.55);
  __DYNO_DUAL._rpmOut = __DYNO_DUAL._rpmOut + (__DYNO_DUAL._rpmTrue - __DYNO_DUAL._rpmOut) * rpmAlpha;

  // 6) HP dari m*a*v (tanpa aero)
  const vUse = __DYNO_DUAL._vRear;
  const aUse = Math.max(0, __DYNO_DUAL._aRear);
  const P_watt = Math.max(0, (m * aUse) * vUse);

  let hpRaw = P_watt / WATT_PER_HP;
  hpRaw = clamp(hpRaw, 0, TARGET_HP_PEAK);

  const hpBeta = clamp(1.0 - Math.exp(-dt * HP_SMOOTH_HZ), 0.03, 0.35);
  __DYNO_DUAL._hpOut = __DYNO_DUAL._hpOut + (hpRaw - __DYNO_DUAL._hpOut) * hpBeta;

  const hp = clamp(__DYNO_DUAL._hpOut, 0, TARGET_HP_PEAK);

  // 7) TQ dari HP + RPM
  const rpm = clamp(__DYNO_DUAL._rpmOut, __DYNO_DUAL.rpmStart, __DYNO_DUAL.rpmEnd);
  const tq = (hp * 7127) / Math.max(1, rpm);

  // 8) IGN & AFR SIM
  const ign = clamp(12 + (rpm / 20000) * 18, 0, 70);
  const afr = clamp(14.7 + (rpm / 20000) * 1.8 - (hp / TARGET_HP_PEAK) * 1.0, 10.0, 22.0);

  // output time/dist dari FRONT PPR
  __DYNO_DUAL.distPulseM = (__DYNO_DUAL.totalFrontPulses / pf) * circ;

  if (__DYNO_DUAL._timeStarted) {
    const pulsesSinceStart = __DYNO_DUAL.totalFrontPulses - __DYNO_DUAL._frontStartPulses;
    __DYNO_DUAL._distM_fromFront = (pulsesSinceStart / pf) * circ;

    const tPulse = ((__DYNO_DUAL._frontPulseClockMs || nowMs) - __DYNO_DUAL._t0PulseMs) / 1000;
    __DYNO_DUAL.t = Math.max(0, tPulse);

    __DYNO_DUAL.distM = Math.max(0, __DYNO_DUAL._distM_fromFront);
  } else {
    __DYNO_DUAL.t = 0;
    __DYNO_DUAL.distM = 0;
  }

  // SPEED LIVE tetap dari front window
  __DYNO_DUAL.speedKmh = clamp(__DYNO_DUAL._vFront, 0, VMAX) * 3.6;

  __DYNO_DUAL.rpm = rpm;
  __DYNO_DUAL.hp  = __DYNO_DUAL._timeStarted ? hp : 0;
  __DYNO_DUAL.tq  = __DYNO_DUAL._timeStarted ? tq : 0;
  __DYNO_DUAL.ign = __DYNO_DUAL._timeStarted ? ign : 0;
  __DYNO_DUAL.afr = __DYNO_DUAL._timeStarted ? afr : 14.7;

  if (__DYNO_DUAL.hp > __DYNO_DUAL.maxHP) __DYNO_DUAL.maxHP = __DYNO_DUAL.hp;
  if (__DYNO_DUAL.tq > __DYNO_DUAL.maxTQ) __DYNO_DUAL.maxTQ = __DYNO_DUAL.tq;

  // logging
  __DYNO_DUAL._logAccMs += dt * 1000;
  if (__DYNO_DUAL._logAccMs >= __DYNO_DUAL.logEveryMs) {
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
    __DYNO_stopLoop();
  }
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

// helpers
function delayDual(ms) {
  ms = Math.max(0, ms || 0);
  if (!ms) return Promise.resolve();
  return new Promise(resolve => setTimeout(resolve, ms));
}
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

})();
