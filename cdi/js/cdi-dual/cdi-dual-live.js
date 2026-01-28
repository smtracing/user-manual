/* =========================================================
   CDI DUAL – LIVE MODULE (FINAL 2026 - RAF ULTRA SMOOTH + FAST + SNAP + NO GAP 100RPM)
   REVISI:
   - Garis merah super smooth & cepat (requestAnimationFrame + easing)
   - Balik arah benar-benar mentok ke RPM_MIN/RPM_MAX (snap)
   - AFR diambil dari getLiveAFR_DUAL(rpm) (esp-api-dual) -> simulasi sekarang
   - AFR PANEL 100rpm TIDAK BOLOS:
     jika lompatan rpm besar, semua step 100rpm yang terlewati otomatis terisi
========================================================= */

console.log("✅ cdi-dual-live.js dimuat (RAF SMOOTH+FAST+SNAP+NO GAP 100RPM)");

/* =========================================================
   CONFIG
========================================================= */
const LIVE_CFG = {
  RPM_MIN: 500,
  RPM_MAX: 15000,

  // kecepatan gerak (lebih besar = lebih cepat)
  SPEED_RPM_PER_SEC: 15000,

  // interval update AFR (ms) - lebih kecil = lebih rapat, tapi lebih berat
  AFR_UPDATE_MS: 80,

  // easing (lebih besar = lebih "nempel")
  EASE: 0.20,

  // toleransi snap supaya benar-benar mentok ke batas
  SNAP_RPM: 40
};

let _liveRunning = false;
let _dir = 1;

// rpm target bergerak cepat, rpm visual ikut halus (easing)
let _rpmTarget = LIVE_CFG.RPM_MIN;
let _rpmVisual = LIVE_CFG.RPM_MIN;

// timing
let _lastFrameTs = 0;
let _lastAfrTs = 0;

// record per 100rpm (hindari bolong)
let _lastRecorded100 = null;

// hindari overlap fetch AFR
let _afrBusy = false;

/* =========================================================
   TOGGLE LIVE
========================================================= */
window.toggleLive_DUAL = function () {
  if (!window.DUAL || !DUAL.active) {
    console.warn("[LIVE_DUAL] Tidak bisa LIVE — CDI DUAL belum aktif");
    return;
  }

  DUAL.live = !DUAL.live;

  const btn = document.getElementById("liveBtn");
  if (btn) {
    if (DUAL.live) {
      btn.textContent = "LIVE ON";
      btn.style.background = "#e74c3c";
    } else {
      btn.textContent = "LIVE";
      btn.style.background = "#2ecc71";
    }
  }

  if (DUAL.live) startLive_DUAL();
  else stopDualLive();
};

function startLive_DUAL() {
  if (_liveRunning) return;
  _liveRunning = true;

  _dir = 1;
  _rpmTarget = LIVE_CFG.RPM_MIN;
  _rpmVisual = LIVE_CFG.RPM_MIN;

  _lastFrameTs = 0;
  _lastAfrTs = 0;
  _lastRecorded100 = null;
  _afrBusy = false;

  DUAL.liveRPM = _rpmVisual;
  DUAL.liveAFR = null;

  requestAnimationFrame(_rafLoop);
}

/* =========================================================
   RAF LOOP (SMOOTH + FAST + SNAP)
========================================================= */
function _rafLoop(ts) {
  if (!DUAL.live || !DUAL.active) {
    _liveRunning = false;
    return;
  }

  if (!_lastFrameTs) _lastFrameTs = ts;
  const dt = Math.max(0.001, (ts - _lastFrameTs) / 1000);
  _lastFrameTs = ts;

  // gerakkan target rpm
  _rpmTarget += _dir * LIVE_CFG.SPEED_RPM_PER_SEC * dt;

  // balik arah & PAKSA target + visual mentok di batas
  if (_rpmTarget >= LIVE_CFG.RPM_MAX) {
    _rpmTarget = LIVE_CFG.RPM_MAX;
    _dir = -1;
    _rpmVisual = LIVE_CFG.RPM_MAX;
  } else if (_rpmTarget <= LIVE_CFG.RPM_MIN) {
    _rpmTarget = LIVE_CFG.RPM_MIN;
    _dir = 1;
    _rpmVisual = LIVE_CFG.RPM_MIN;
  } else {
    // easing hanya saat di tengah (bukan di batas)
    _rpmVisual = _rpmVisual + (_rpmTarget - _rpmVisual) * LIVE_CFG.EASE;

    // clamp visual
    if (_rpmVisual < LIVE_CFG.RPM_MIN) _rpmVisual = LIVE_CFG.RPM_MIN;
    if (_rpmVisual > LIVE_CFG.RPM_MAX) _rpmVisual = LIVE_CFG.RPM_MAX;

    // SNAP dekat batas
    if (Math.abs(_rpmVisual - LIVE_CFG.RPM_MIN) <= LIVE_CFG.SNAP_RPM) _rpmVisual = LIVE_CFG.RPM_MIN;
    if (Math.abs(_rpmVisual - LIVE_CFG.RPM_MAX) <= LIVE_CFG.SNAP_RPM) _rpmVisual = LIVE_CFG.RPM_MAX;
  }

  // kirim ke UI (float -> garis merah halus)
  DUAL.liveRPM = _rpmVisual;

  // update AFR berkala
  _maybeUpdateAFR(ts);

  // redraw tiap frame
  if (typeof window.redraw_DUAL === "function") window.redraw_DUAL();

  requestAnimationFrame(_rafLoop);
}

/* =========================================================
   AFR UPDATE (THROTTLED) + RECORD 100RPM NO GAP
========================================================= */
function _maybeUpdateAFR(ts) {
  if (ts - _lastAfrTs < LIVE_CFG.AFR_UPDATE_MS) return;
  if (_afrBusy) return;

  _lastAfrTs = ts;
  _afrBusy = true;

  (async () => {
    try {
      const rpmForAfr = Math.round(_rpmVisual);
      let afr = null;

      // ambil AFR dari ESP-API-DUAL (simulasi sekarang)
      if (typeof window.getLiveAFR_DUAL === "function") {
        afr = await window.getLiveAFR_DUAL(rpmForAfr);
      }

      // fallback kalau API belum ada / nilai invalid
      if (!isFinite(afr) || afr <= 0) afr = fallbackAFRSim(rpmForAfr);

      afr = Number(parseFloat(afr).toFixed(1));
      DUAL.liveAFR = afr;

      // ===== RECORD AFR PANEL PER 100RPM TANPA BOLOS =====
      // isi semua step 100rpm yang terlewati antara record terakhir dan rpm sekarang
      if (typeof window.recordAFRSample100_DUAL === "function") {
        const r100 = Math.round(rpmForAfr / 100) * 100;

        if (_lastRecorded100 == null) {
          _lastRecorded100 = r100;
          if (r100 >= LIVE_CFG.RPM_MIN && r100 <= LIVE_CFG.RPM_MAX) {
            window.recordAFRSample100_DUAL(r100, afr);
          }
        } else if (_lastRecorded100 !== r100) {
          const step = (r100 > _lastRecorded100) ? 100 : -100;

          for (let rr = _lastRecorded100 + step; rr !== r100 + step; rr += step) {
            if (rr < LIVE_CFG.RPM_MIN || rr > LIVE_CFG.RPM_MAX) continue;
            window.recordAFRSample100_DUAL(rr, afr);
          }

          _lastRecorded100 = r100;
        } else {
          // rpm100 sama: refresh nilai terbaru (biar warna/value ikut update)
          if (r100 >= LIVE_CFG.RPM_MIN && r100 <= LIVE_CFG.RPM_MAX) {
            window.recordAFRSample100_DUAL(r100, afr);
          }
        }
      }
    } catch (err) {
      console.warn("[LIVE_DUAL] AFR update error:", err && err.message ? err.message : err);
    } finally {
      _afrBusy = false;
    }
  })();
}

/* =========================================================
   STOP LIVE MODE
========================================================= */
function stopDualLive() {
  _liveRunning = false;
  _afrBusy = false;

  const btn = document.getElementById("liveBtn");
  if (btn) {
    btn.textContent = "LIVE";
    btn.style.background = "#2ecc71";
  }

  DUAL.live = false;
  DUAL.liveRPM = 0;
  DUAL.liveAFR = null;

  if (typeof window.redraw_DUAL === "function") window.redraw_DUAL();
}

/* =========================================================
   FALLBACK AFR SIM
========================================================= */
function fallbackAFRSim(rpm) {
  let afr;
  if (rpm < 1500) afr = 12.2 + Math.random() * 0.6;
  else if (rpm < 3000) afr = 13.0 + Math.random() * 0.9;
  else if (rpm < 6000) afr = 14.0 + Math.random() * 0.9;
  else if (rpm < 9000) afr = 15.0 + Math.random() * 0.7;
  else afr = 15.6 + Math.random() * 0.9;

  afr = Math.min(17.5, Math.max(11.5, afr));
  return Number(afr.toFixed(1));
}
