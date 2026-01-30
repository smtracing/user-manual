/* =========================================================
   cdi-dual.js — CDI DUAL – FINAL 2026 (REALTIME AFR VISUAL MAP + AFR DETAIL PANEL)
   FIX UTAMA:
   ✅ Grafik tidak hilang setelah drag / zoom UI / rotate HP
      - Canvas sizing pakai getBoundingClientRect + devicePixelRatio
      - Semua hitungan pakai koordinat CSS (konsisten dengan pointer)
   ✅ Drag titik pakai Pointer Events (HP + PC)
   ✅ Safety:
      - BLOK semua aksi kalau CDI DUAL tidak aktif
      - BLOK READ & KIRIM jika LIVE ON atau RPM berjalan
      - LIVE boleh OFF walau RPM berjalan
      - AFR PANEL & OVERLAY boleh dipakai walau RPM berjalan (asal status aktif)
========================================================= */

console.log("✅ cdi-dual.js dimuat");

/* =========================================================
   DATA CDI DUAL
========================================================= */
window.DUAL = window.DUAL || {
  pickup: 80,
  activeMap: 0,
  active: false,
  maps: [
    { limiter: 8000, curve: rpmPoints_BASIC.map(() => 18) },
    { limiter: 9000, curve: rpmPoints_BASIC.map(() => 14) }
  ],

  live: false,
  liveRPM: 0,
  liveAFR: null,

  // overlay kasar (basis 500rpm)
  afrZones: {},
  afrEnabled: true,

  // AFR DETAIL PANEL
  afrPanelOpen: false,
  centerAFR: false,
  afrRangeMin: 500,
  afrRangeMax: 5000,
  afrStep: 100,
  afrSamples100: {},
  afrSource: "LIVE",

  status: "UNKNOWN",
  statusTimer: null,
  liveTimer: null,

  // internal
  _ro: null
};

/* =========================================================
   DEACTIVATE
========================================================= */
window.deactivateCDI_DUAL = function () {
  if (!window.DUAL) return;
  DUAL.active = false;
  stopStatusWatcher_DUAL();
  try { if (DUAL._ro) { DUAL._ro.disconnect(); DUAL._ro = null; } } catch(e){}
  if (typeof stopDualLive === "function") stopDualLive();
};

/* =========================================================
   UI STATUS HELPER
========================================================= */
function setActionStatus_DUAL(text, timeoutMs = 1000) {
  const el = document.getElementById("sendStatus");
  if (!el) return;
  el.textContent = text || "";
  if (timeoutMs && timeoutMs > 0) {
    setTimeout(() => {
      const el2 = document.getElementById("sendStatus");
      if (el2) el2.textContent = "";
    }, timeoutMs);
  }
}

/* =========================================================
   STATUS ACTIVE CHECK (blok semua jika tidak aktif)
========================================================= */
async function ensureCDIActive_DUAL(actionName) {
  if (!DUAL || !DUAL.active) return { ok: false, engine_running: false };

  if (typeof getESPStatus_DUAL !== "function") {
    setActionStatus_DUAL("NO STATUS API", 1200);
    return { ok: false, engine_running: false };
  }

  try {
    const st = await getESPStatus_DUAL();
    const okDual = !!(st && st.online && st.active_cdi === "dual");
    if (!okDual) {
      setActionStatus_DUAL("CDI DUAL TIDAK AKTIF", 1300);
      return { ok: false, engine_running: !!(st && st.engine_running) };
    }
    return { ok: true, engine_running: !!(st && st.engine_running) };
  } catch {
    setActionStatus_DUAL("STATUS FAIL", 1200);
    return { ok: false, engine_running: false };
  }
}

/* =========================================================
   RPM RUNNING CHECK (untuk READ/KIRIM saja)
========================================================= */
function isRPMRunningFallback_DUAL() {
  return Number(DUAL && DUAL.liveRPM ? DUAL.liveRPM : 0) > 0;
}

async function shouldBlockReadSend_DUAL(actionName) {
  // 1) wajib aktif
  const st = await ensureCDIActive_DUAL(actionName);
  if (!st.ok) return true;

  // 2) blok READ/KIRIM jika LIVE ON
  if (DUAL.live) {
    setActionStatus_DUAL(`LIVE ON - ${actionName} DIBLOK`, 1400);
    return true;
  }

  // 3) blok READ/KIRIM jika RPM berjalan
  if (st.engine_running || isRPMRunningFallback_DUAL()) {
    setActionStatus_DUAL(`RPM BERJALAN - ${actionName} DIBLOK`, 1400);
    return true;
  }

  return false;
}

/* =========================================================
   CANVAS FIT (ANTI HILANG SETELAH DRAG/ZOOM/ROTATE)
   - gambar & pointer pakai koordinat CSS
========================================================= */
function fitCanvasToRect(canvas, ctx) {
  const r = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;

  if (r.width <= 2 || r.height <= 2) return null;

  const w = Math.round(r.width * dpr);
  const h = Math.round(r.height * dpr);

  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;

  // gambar pakai koordinat CSS px
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  return { W: r.width, H: r.height, dpr };
}

/* =========================================================
   LOAD CDI DUAL
========================================================= */
window.loadCDI_DUAL = function () {
  DUAL.active = true;

  if (typeof deactivateCDI_BASIC === "function") deactivateCDI_BASIC();
  if (typeof deactivateCDI_RACING === "function") deactivateCDI_RACING();

  const area = document.getElementById("contentArea");
  if (!area) return;
  area.classList.remove("empty");

  area.innerHTML = `
    <style>
      .map-btn{
        height:30px;padding:0 12px;border:none;border-radius:0;
        font-weight:600;cursor:pointer;display:inline-flex;
        align-items:center;justify-content:center;
        transition:filter .15s ease, opacity .15s ease;
      }
      .map-btn:hover{ filter:brightness(1.15); }

      .afr-btn{
        height:30px;padding:0 12px;border:none;
        font-size:13px;font-weight:700;cursor:pointer;
        transition:filter .15s ease, opacity .15s ease;
      }
      .afr-btn:hover{ filter:brightness(1.12); }

      .badge-btn{
        font-size:11px;padding:4px 10px;color:#fff;font-weight:800;
        background:#555;border:1px solid rgba(255,255,255,0.08);
        border-radius:2px;line-height:1;cursor:pointer;
        display:inline-flex;align-items:center;justify-content:center;
        transition:filter .15s ease, opacity .15s ease;
      }
      .badge-btn:hover{ filter:brightness(1.10); }

      .afr-panel{
        margin-top:10px;
        border:1px solid rgba(255,255,255,0.08);
        background:rgba(0,0,0,0.15);
        padding:10px;
      }
      .afr-panel-head{
        display:flex;align-items:center;justify-content:space-between;
        gap:10px;margin-bottom:8px;
      }
      .afr-panel-controls{
        display:flex;align-items:center;gap:10px;flex-wrap:wrap;
      }
      .afr-panel-controls label{
        font-size:11px;color:#ddd;display:flex;align-items:center;gap:6px;
      }
      .afr-panel-controls input, .afr-panel-controls select{
        height:28px;padding:0 8px;border:1px solid rgba(255,255,255,0.15);
        background:#111;color:#fff;outline:none;
      }
      .afr-panel-title{
        font-weight:900;font-size:12px;color:#fff;letter-spacing:.2px;
      }

      #afrDetailCanvas{
        width:100%;
        height:330px;
        display:block;
        background:rgba(0,0,0,0.12);
        border:1px solid rgba(255,255,255,0.08);
      }

      .afr-hint{
        font-size:11px;color:#bbb;margin-top:6px;line-height:1.35;
      }
    </style>

    <div class="map-toolbar">
      <div class="toolbar-right">
        <label>LEBAR PICK UP (°)
          <input id="dualPickup" type="number"
            min="${PICKUP_MIN}" max="${PICKUP_MAX}"
            value="${DUAL.pickup}">
        </label>

        <button class="map-btn" id="mapBtn1"
          style="background:#4cff8f;opacity:${DUAL.activeMap===0?1:0.6}"
          onclick="switchDualMap(0)">MAP 1</button>

        <input id="dualLimiter0" type="number"
          step="250" min="${RPM_MIN}" max="${RPM_MAX}"
          value="${DUAL.maps[0].limiter}">

        <button class="map-btn" id="mapBtn2"
          style="background:#ffb347;opacity:${DUAL.activeMap===1?1:0.6}"
          onclick="switchDualMap(1)">MAP 2</button>

        <input id="dualLimiter1" type="number"
          step="250" min="${RPM_MIN}" max="${RPM_MAX}"
          value="${DUAL.maps[1].limiter}">

        <button id="readBtn" class="send-btn"
          style="height:30px;padding:0 14px;font-size:13px;border:none"
          onclick="read_DUAL()">READ</button>

        <button id="liveBtn" class="send-btn"
          style="height:30px;padding:0 14px;font-size:13px;background:#2ecc71;border:none"
          onclick="toggleLive_DUAL_SAFE()">LIVE</button>

        <button id="afrBtn" class="afr-btn"
          style="background:${DUAL.afrPanelOpen ? "#3498db" : "#555"};opacity:${DUAL.afrPanelOpen ? 1 : 0.85}"
          onclick="toggleAFRPanel_DUAL_SAFE()">${DUAL.afrPanelOpen ? "AFR PANEL" : "AFR"}</button>

        <button id="sendBtn" class="send-btn"
          style="height:30px;padding:0 14px;font-size:13px;border:none"
          onclick="send_DUAL()">KIRIM</button>

        <span id="sendStatus" class="send-status"></span>
      </div>
    </div>

    <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">
      <h3 style="margin:0">CDI POWER SMT A2</h3>

      <div id="cdiStatusBox"
        style="font-size:11px;padding:4px 10px;background:#555;color:#fff">
        STATUS: CEK...
      </div>

      <button id="overlayBtn" class="badge-btn"
        style="background:${DUAL.afrEnabled ? "#2ecc71" : "#555"};opacity:${DUAL.afrEnabled ? 1 : 0.85}"
        onclick="toggleAFROverlay_DUAL_SAFE()">${DUAL.afrEnabled ? "OVERLAY ON" : "OVERLAY OFF"}</button>
    </div>

    <div class="curve-layout">
      <div class="curve-left">
        <table class="rpm-table" id="rpmTable"></table>
      </div>
      <canvas id="curveCanvas" class="curve-canvas"></canvas>
    </div>

    <div id="afrPanel" class="afr-panel" style="display:${DUAL.afrPanelOpen ? "block" : "none"}">
      <div class="afr-panel-head">
        <div class="afr-panel-title">AFR DETAIL (per 100 RPM) + IGNITION SYNC</div>
        <div class="afr-panel-controls">
          <label>RPM MIN
            <input id="afrMin" type="number" step="100" min="${RPM_MIN}" max="${RPM_MAX}" value="${DUAL.afrRangeMin}">
          </label>
          <label>RPM MAX
            <input id="afrMax" type="number" step="100" min="${RPM_MIN}" max="${RPM_MAX}" value="${DUAL.afrRangeMax}">
          </label>
          <label>SOURCE
            <select id="afrSource">
              <option value="LIVE" ${DUAL.afrSource==="LIVE"?"selected":""}>LIVE</option>
              <option value="HISTORY" ${DUAL.afrSource==="HISTORY"?"selected":""}>HISTORY</option>
            </select>
          </label>
          <button class="afr-btn" style="background:#666" onclick="clearAFRHistory_DUAL()">CLEAR</button>
        </div>
      </div>

      <canvas id="afrDetailCanvas"></canvas>

      <div class="afr-hint">
        - LIVE: ambil AFR dari live sekarang + otomatis rekam history per 100rpm.<br>
        - HISTORY: tampilkan hasil rekaman live yang sudah pernah lewat di range itu.<br>
        - Kurva ignition di panel ini selalu ikut perubahan di tab ignition (drag/tabel).
      </div>
    </div>
  `;

  bindDualInputs();
  bindAFRPanelInputs_DUAL();

  buildTable_DUAL();
  initCurve_DUAL();
  enableDrag_DUAL();
  startStatusWatcher_DUAL();

  // ResizeObserver biar selalu redraw kalau layout berubah (zoom UI / rotate / dll)
  setupResizeObserver_DUAL();

  redrawAFRDetail_DUAL();
};

/* =========================================================
   STATUS WATCHER
========================================================= */
function startStatusWatcher_DUAL() {
  stopStatusWatcher_DUAL();
  DUAL.statusTimer = setInterval(async () => {
    if (!DUAL.active) return;
    try {
      if (typeof getESPStatus_DUAL !== "function") {
        updateCDIStatus_DUAL(false);
        return;
      }
      const status = await getESPStatus_DUAL();
      updateCDIStatus_DUAL(status && status.online && status.active_cdi === "dual");
    } catch {
      updateCDIStatus_DUAL(false);
    }
  }, 1500);
}

function stopStatusWatcher_DUAL() {
  if (DUAL.statusTimer) {
    clearInterval(DUAL.statusTimer);
    DUAL.statusTimer = null;
  }
}

function updateCDIStatus_DUAL(isActive) {
  if (!DUAL.active) return;
  const box = document.getElementById("cdiStatusBox");
  if (!box) return;
  if (isActive) {
    DUAL.status = "ACTIVE";
    box.textContent = "CDI DUAL AKTIF";
    box.style.background = "#2ecc71";
  } else {
    DUAL.status = "UNAVAILABLE";
    box.textContent = "CDI DUAL TIDAK TERSEDIA";
    box.style.background = "#555";
  }
}

/* =========================================================
   SWITCH MAP
========================================================= */
window.switchDualMap = function (i) {
  DUAL.activeMap = i;

  const b1 = document.getElementById("mapBtn1");
  const b2 = document.getElementById("mapBtn2");
  if (b1) b1.style.opacity = i === 0 ? 1 : 0.6;
  if (b2) b2.style.opacity = i === 1 ? 1 : 0.6;

  const lim0 = document.getElementById("dualLimiter0");
  const lim1 = document.getElementById("dualLimiter1");
  if (lim0) lim0.value = DUAL.maps[0].limiter;
  if (lim1) lim1.value = DUAL.maps[1].limiter;

  buildTable_DUAL();
  redraw_DUAL();
  redrawAFRDetail_DUAL();
};

/* =========================================================
   INPUT HANDLER + VALIDASI
========================================================= */
function bindDualInputs() {
  const pickup = document.getElementById("dualPickup");
  if (!pickup) return;

  pickup.oninput = e => {
    const v = Number(e.target.value);
    if (!isNaN(v)) DUAL.pickup = v;
    redraw_DUAL();
    redrawAFRDetail_DUAL();
  };
  pickup.onblur = e => {
    let v = Number(e.target.value);
    if (isNaN(v)) v = DUAL.pickup;
    if (v < PICKUP_MIN) v = PICKUP_MIN;
    if (v > PICKUP_MAX) v = PICKUP_MAX;
    DUAL.pickup = v;
    e.target.value = v;
    redraw_DUAL();
    redrawAFRDetail_DUAL();
  };

  DUAL.maps.forEach((_, i) => {
    const el = document.getElementById(`dualLimiter${i}`);
    if (!el) return;

    el.oninput = e => {
      const v = parseInt(e.target.value, 10);
      if (!isNaN(v)) DUAL.maps[i].limiter = v;
      if (i === DUAL.activeMap) {
        buildTable_DUAL();
        redraw_DUAL();
        redrawAFRDetail_DUAL();
      }
    };
    el.onblur = e => {
      let v = parseInt(e.target.value, 10);
      if (isNaN(v)) v = DUAL.maps[i].limiter;
      if (v < RPM_MIN) v = RPM_MIN;
      if (v > RPM_MAX) v = RPM_MAX;
      DUAL.maps[i].limiter = v;
      e.target.value = v;
      if (i === DUAL.activeMap) {
        buildTable_DUAL();
        redraw_DUAL();
        redrawAFRDetail_DUAL();
      }
    };
  });
}

/* =========================================================
   BUILD TABEL
========================================================= */
function buildTable_DUAL() {
  const table = document.getElementById("rpmTable");
  if (!table) return;

  const map = DUAL.maps[DUAL.activeMap];
  let html = `<tr><th>RPM</th><th>°</th></tr>`;

  rpmPoints_BASIC.forEach((rpm, i) => {
    const lock = map.limiter && rpm > map.limiter;
    html += `<tr style="opacity:${lock ? 0.35 : 1}">
      <td>${rpm}</td>
      <td><input type="number" step="0.1"
        value="${Number(map.curve[i]).toFixed(1)}"
        ${lock ? "disabled" : ""}
        onchange="dualTableChange(${i},this.value)"></td>
    </tr>`;
  });

  table.innerHTML = html;
}

/* =========================================================
   TABLE CHANGE
========================================================= */
window.dualTableChange = function (idx, value) {
  const map = DUAL.maps[DUAL.activeMap];
  const cap = DUAL.pickup ?? TIMING_MAX;

  let v = parseFloat(value);
  if (isNaN(v)) return;

  v = Math.max(TIMING_MIN, Math.min(cap, v));
  map.curve[idx] = v;

  redraw_DUAL();
  redrawAFRDetail_DUAL();
};

/* =========================================================
   SAFE WRAPPERS
========================================================= */
window.toggleLive_DUAL_SAFE = async function () {
  // kalau LIVE ON -> izinkan OFF walau rpm jalan
  if (DUAL.live) {
    if (typeof toggleLive_DUAL === "function") toggleLive_DUAL();
    return;
  }

  const st = await ensureCDIActive_DUAL("LIVE");
  if (!st.ok) return;

  if (typeof toggleLive_DUAL === "function") toggleLive_DUAL();
};

window.toggleAFRPanel_DUAL_SAFE = async function () {
  const st = await ensureCDIActive_DUAL("AFR PANEL");
  if (!st.ok) return;
  toggleAFRPanel_DUAL();
};

window.toggleAFROverlay_DUAL_SAFE = async function () {
  const st = await ensureCDIActive_DUAL("OVERLAY");
  if (!st.ok) return;
  toggleAFROverlay_DUAL();
};

/* =========================================================
   AFR OVERLAY TOGGLE
========================================================= */
window.toggleAFROverlay_DUAL = function () {
  if (!DUAL || !DUAL.active) return;

  DUAL.afrEnabled = !DUAL.afrEnabled;

  if (DUAL.afrEnabled) {
    DUAL.centerAFR = false;
  } else {
    DUAL.afrZones = {};
    if (DUAL.afrPanelOpen) DUAL.centerAFR = true;
  }

  const btn = document.getElementById("overlayBtn");
  if (btn) {
    btn.textContent = DUAL.afrEnabled ? "OVERLAY ON" : "OVERLAY OFF";
    btn.style.background = DUAL.afrEnabled ? "#2ecc71" : "#555";
    btn.style.opacity = DUAL.afrEnabled ? 1 : 0.85;
  }

  redraw_DUAL();
};

/* =========================================================
   AFR PANEL TOGGLE
========================================================= */
window.toggleAFRPanel_DUAL = function () {
  if (!DUAL || !DUAL.active) return;

  DUAL.afrPanelOpen = !DUAL.afrPanelOpen;

  const panel = document.getElementById("afrPanel");
  if (panel) panel.style.display = DUAL.afrPanelOpen ? "block" : "none";

  const btn = document.getElementById("afrBtn");
  if (btn) {
    btn.textContent = DUAL.afrPanelOpen ? "AFR PANEL" : "AFR";
    btn.style.background = DUAL.afrPanelOpen ? "#3498db" : "#555";
    btn.style.opacity = DUAL.afrPanelOpen ? 1 : 0.85;
  }

  if (DUAL.afrPanelOpen) {
    DUAL.centerAFR = true;
    if (DUAL.afrEnabled) {
      DUAL.afrEnabled = false;
      DUAL.afrZones = {};
    }
  } else {
    DUAL.centerAFR = false;
  }

  const ov = document.getElementById("overlayBtn");
  if (ov) {
    ov.textContent = DUAL.afrEnabled ? "OVERLAY ON" : "OVERLAY OFF";
    ov.style.background = DUAL.afrEnabled ? "#2ecc71" : "#555";
    ov.style.opacity = DUAL.afrEnabled ? 1 : 0.85;
  }

  redraw_DUAL();
  redrawAFRDetail_DUAL();
};

/* =========================================================
   AFR PANEL INPUTS
========================================================= */
function bindAFRPanelInputs_DUAL() {
  const minEl = document.getElementById("afrMin");
  const maxEl = document.getElementById("afrMax");
  const srcEl = document.getElementById("afrSource");

  if (minEl) {
    minEl.oninput = e => {
      const v = clampTo100(parseInt(e.target.value, 10));
      if (!isNaN(v)) DUAL.afrRangeMin = v;
      redrawAFRDetail_DUAL();
    };
    minEl.onblur = e => {
      let v = clampTo100(parseInt(e.target.value, 10));
      if (isNaN(v)) v = DUAL.afrRangeMin;
      v = clamp(v, RPM_MIN, RPM_MAX);
      DUAL.afrRangeMin = v;
      e.target.value = v;
      if (DUAL.afrRangeMax <= DUAL.afrRangeMin) {
        DUAL.afrRangeMax = clampTo100(DUAL.afrRangeMin + 100);
        const maxEl2 = document.getElementById("afrMax");
        if (maxEl2) maxEl2.value = DUAL.afrRangeMax;
      }
      redrawAFRDetail_DUAL();
    };
  }

  if (maxEl) {
    maxEl.oninput = e => {
      const v = clampTo100(parseInt(e.target.value, 10));
      if (!isNaN(v)) DUAL.afrRangeMax = v;
      redrawAFRDetail_DUAL();
    };
    maxEl.onblur = e => {
      let v = clampTo100(parseInt(e.target.value, 10));
      if (isNaN(v)) v = DUAL.afrRangeMax;
      v = clamp(v, RPM_MIN, RPM_MAX);
      DUAL.afrRangeMax = v;
      e.target.value = v;
      if (DUAL.afrRangeMax <= DUAL.afrRangeMin) {
        DUAL.afrRangeMin = clampTo100(DUAL.afrRangeMax - 100);
        const minEl2 = document.getElementById("afrMin");
        if (minEl2) minEl2.value = DUAL.afrRangeMin;
      }
      redrawAFRDetail_DUAL();
    };
  }

  if (srcEl) {
    srcEl.onchange = e => {
      DUAL.afrSource = e.target.value === "HISTORY" ? "HISTORY" : "LIVE";
      redrawAFRDetail_DUAL();
    };
  }
}

window.clearAFRHistory_DUAL = function () {
  if (!DUAL) return;
  DUAL.afrSamples100 = {};
  redrawAFRDetail_DUAL();
};

// dipanggil oleh cdi-dual-live.js (atau kamu bisa panggil manual)
window.recordAFRSample100_DUAL = function (rpm, afr) {
  if (!DUAL) return;
  if (rpm <= 0 || afr == null || isNaN(afr)) return;

  const r = clampTo100(Math.round(rpm));
  if (r < RPM_MIN || r > RPM_MAX) return;

  DUAL.afrSamples100[String(r)] = { afr: Number(Number(afr).toFixed(1)), t: Date.now() };

  if (DUAL.afrPanelOpen) redrawAFRDetail_DUAL();
};

/* =========================================================
   AFR COLOR (4 WARNA, STEP 1.0 AFR)
========================================================= */
function getAFRColor(value) {
  const v = Number(value);
  if (!isFinite(v)) return "#555";
  if (v < 13.0) return "#ff0000";
  if (v < 14.0) return "#ffcc00";
  if (v < 15.0) return "#00ff66";
  return "#00bfff";
}

/* =========================================================
   CENTER AFR TEXT
========================================================= */
function shouldShowCenterAFR_DUAL() {
  return !!(DUAL && DUAL.active && DUAL.afrPanelOpen && DUAL.centerAFR && !DUAL.afrEnabled);
}

function drawCenterAFRText_DUAL(ctx, W, plotW) {
  if (!shouldShowCenterAFR_DUAL()) return;
  if (!DUAL.live || DUAL.liveAFR == null) return;

  const v = Number(Number(DUAL.liveAFR).toFixed(1));
  const text = `AFR : ${v}`;
  const x = PLOT_LEFT + (plotW / 2);
  const y = AXIS_TOP_PADDING + 14;

  ctx.save();
  ctx.font = "900 28px Arial";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";

  ctx.lineWidth = 6;
  ctx.strokeStyle = "rgba(0,0,0,0.65)";
  ctx.strokeText(text, x, y);

  ctx.fillStyle = getAFRColor(v);
  ctx.fillText(text, x, y);
  ctx.restore();
}

/* =========================================================
   MAIN CANVAS AFR ZONES (kasar per 500rpm)
========================================================= */
function drawAFRZones(ctx, W, plotW, plotH) {
  const rpmCount = rpmPoints_BASIC.length;
  const zoneW = plotW / (rpmCount - 1);

  if (DUAL.afrEnabled && DUAL.live && DUAL.liveAFR != null && DUAL.liveRPM > 0) {
    const afrValue = Number(Number(DUAL.liveAFR).toFixed(1));
    const color = getAFRColor(afrValue);
    const rpm = DUAL.liveRPM;

    const base = Math.floor(rpm / 500) * 500;
    const next = base + 500;

    const idxStart = Math.floor((base - RPM_MIN) / RPM_STEP);
    const idxEnd = Math.floor((next - RPM_MIN) / RPM_STEP);

    for (let i = idxStart; i < idxEnd; i++) {
      if (i >= 0 && i < rpmCount) DUAL.afrZones[i] = { color, value: afrValue };
    }
  }

  if (DUAL.afrEnabled) {
    for (let i = 0; i < rpmCount; i++) {
      const zone = DUAL.afrZones[i];
      if (!zone) continue;
      const rpmValue = rpmPoints_BASIC[i];
      const x = PLOT_LEFT + ((rpmValue - RPM_MIN) / (RPM_MAX - RPM_MIN)) * plotW;
      ctx.fillStyle = zone.color + "50";
      ctx.fillRect(x, AXIS_TOP_PADDING, zoneW, plotH);
    }
  }

  ctx.font = "bold 11px Arial";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  const afrTextY = AXIS_TOP_PADDING + 3;

  if (DUAL.afrEnabled) {
    for (let rpm = RPM_MIN; rpm <= RPM_MAX; rpm += 500) {
      const midRPM = rpm + 250;
      const zoneIdx = Math.floor((rpm - RPM_MIN) / RPM_STEP);
      const zone = DUAL.afrZones[zoneIdx];
      if (!zone) continue;

      const x = PLOT_LEFT + ((midRPM - RPM_MIN) / (RPM_MAX - RPM_MIN)) * plotW;
      const text = String(zone.value);

      ctx.strokeStyle = "rgba(0,0,0,0.6)";
      ctx.fillStyle = "rgba(255,255,255,0.92)";
      ctx.lineWidth = 2;
      ctx.strokeText(text, x, afrTextY);
      ctx.fillText(text, x, afrTextY);
    }
  }
}

/* =========================================================
   REDRAW MAIN CANVAS (FIXED)
========================================================= */
function redraw_DUAL() {
  const c = document.getElementById("curveCanvas");
  if (!c) return;
  const ctx = c.getContext("2d");

  const dim = fitCanvasToRect(c, ctx);
  if (!dim) return;

  const W = dim.W;
  const H = dim.H;

  const plotW = W - PLOT_LEFT - AXIS_RIGHT_PADDING;
  const plotH = H - AXIS_BOTTOM - AXIS_TOP_PADDING;

  const capRaw = (DUAL.pickup ?? TIMING_MAX);
  const cap = Number(capRaw);
  if (!isFinite(cap) || cap <= 0) return;

  ctx.clearRect(0, 0, W, H);
  ctx.font = "11px Arial";

  // AFR overlay
  if (DUAL.live) drawAFRZones(ctx, W, plotW, plotH);

  // grid horizontal
  ctx.strokeStyle = "#2a2f45";
  ctx.fillStyle = "#9fa8ff";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (let t = 0; t <= cap; t += 5) {
    const y = AXIS_TOP_PADDING + plotH - (t / cap) * plotH;
    ctx.beginPath();
    ctx.moveTo(PLOT_LEFT, y);
    ctx.lineTo(W - AXIS_RIGHT_PADDING, y);
    ctx.stroke();
    ctx.fillText(`${t}°`, LABEL_WIDTH - 5, y);
  }

  // grid vertikal
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  rpmPoints_BASIC.forEach((rpm, i) => {
    if (rpm % 1000 !== 0) return;
    const x = PLOT_LEFT + (i / (rpmPoints_BASIC.length - 1)) * plotW;
    ctx.beginPath();
    ctx.moveTo(x, AXIS_TOP_PADDING);
    ctx.lineTo(x, AXIS_TOP_PADDING + plotH);
    ctx.stroke();
    ctx.fillText(rpm, x, AXIS_TOP_PADDING + plotH + 5);
  });

  // gambar kurva
  DUAL.maps.forEach((m, i) => {
    if (i !== DUAL.activeMap) drawDualCurve(ctx, m, i, 0.4, W, H, cap);
  });
  drawDualCurve(ctx, DUAL.maps[DUAL.activeMap], DUAL.activeMap, 1, W, H, cap);

  // garis LIVE
  if (DUAL.live) {
    const rpmLive = DUAL.liveRPM > 0 ? DUAL.liveRPM : RPM_MIN;
    const idx = Math.round((rpmLive - RPM_MIN) / RPM_STEP);
    const x = PLOT_LEFT + (idx / (rpmPoints_BASIC.length - 1)) * plotW;
    ctx.strokeStyle = "#ff0000";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, AXIS_TOP_PADDING);
    ctx.lineTo(x, AXIS_TOP_PADDING + plotH);
    ctx.stroke();
  }

  // AFR tengah (hanya saat panel open)
  drawCenterAFRText_DUAL(ctx, W, plotW);

  if (DUAL.afrPanelOpen) redrawAFRDetail_DUAL();
}

/* =========================================================
   DRAW CURVE
========================================================= */
function drawDualCurve(ctx, map, index, alpha, W, H, cap) {
  const plotW = W - PLOT_LEFT - AXIS_RIGHT_PADDING;
  const plotH = H - AXIS_BOTTOM - AXIS_TOP_PADDING;
  const colors = ["#4cff8f", "#ffb347"];
  const isActive = index === DUAL.activeMap;

  ctx.globalAlpha = alpha;
  ctx.strokeStyle = colors[index];
  ctx.lineWidth = 2;

  ctx.beginPath();
  map.curve.forEach((v, i) => {
    if (map.limiter && rpmPoints_BASIC[i] > map.limiter) return;
    const val = Math.min(Number(v), cap);
    const x = PLOT_LEFT + (i / (map.curve.length - 1)) * plotW;
    const y = AXIS_TOP_PADDING + plotH - (val / cap) * plotH;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.stroke();

  if (isActive) {
    ctx.fillStyle = colors[index];
    map.curve.forEach((v, i) => {
      if (map.limiter && rpmPoints_BASIC[i] > map.limiter) return;
      const val = Math.min(Number(v), cap);
      const x = PLOT_LEFT + (i / (map.curve.length - 1)) * plotW;
      const y = AXIS_TOP_PADDING + plotH - (val / cap) * plotH;
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  ctx.globalAlpha = 1;
}

/* =========================================================
   DRAG TITIK (Pointer Events, FIX)
========================================================= */
function enableDrag_DUAL() {
  const c = document.getElementById("curveCanvas");
  if (!c) return;

  c.style.touchAction = "none";

  let idx = null;
  let dragging = false;

  function posToCanvas(ev) {
    const r = c.getBoundingClientRect();
    return { x: (ev.clientX - r.left), y: (ev.clientY - r.top), W: r.width, H: r.height };
  }

  function findPointIndex(mx, my, W, H) {
    const cap = Number(DUAL.pickup ?? TIMING_MAX);
    if (!isFinite(cap) || cap <= 0) return null;

    const plotW = W - PLOT_LEFT - AXIS_RIGHT_PADDING;
    const plotH = H - AXIS_BOTTOM - AXIS_TOP_PADDING;

    const map = DUAL.maps[DUAL.activeMap];

    for (let i = 0; i < map.curve.length; i++) {
      if (map.limiter && rpmPoints_BASIC[i] > map.limiter) continue;

      const x = PLOT_LEFT + (i / (rpmPoints_BASIC.length - 1)) * plotW;
      const val = Math.min(Number(map.curve[i]), cap);
      const y = AXIS_TOP_PADDING + plotH - (val / cap) * plotH;

      if (Math.hypot(mx - x, my - y) < 14) return i;
    }
    return null;
  }

  function applyValueFromY(i, my, H) {
    const cap = Number(DUAL.pickup ?? TIMING_MAX);
    if (!isFinite(cap) || cap <= 0) return;

    const denom = (H - AXIS_BOTTOM - AXIS_TOP_PADDING);
    if (denom <= 5) return;

    let val = cap * (1 - (my - AXIS_TOP_PADDING) / denom);
    val = Math.max(TIMING_MIN, Math.min(cap, val));

    DUAL.maps[DUAL.activeMap].curve[i] = val;

    const inp = document.querySelector(`#rpmTable tr:nth-child(${i + 2}) input`);
    if (inp) inp.value = Number(val).toFixed(1);

    redraw_DUAL();
    redrawAFRDetail_DUAL();
  }

  function onDown(ev) {
    const p = posToCanvas(ev);
    const hit = findPointIndex(p.x, p.y, p.W, p.H);
    if (hit !== null) {
      idx = hit;
      dragging = true;
      try { c.setPointerCapture(ev.pointerId); } catch(e){}
      ev.preventDefault();
      ev.stopPropagation();
    } else {
      idx = null;
      dragging = false;
    }
  }

  function onMove(ev) {
    if (!dragging || idx === null) return;
    const p = posToCanvas(ev);
    applyValueFromY(idx, p.y, p.H);
    ev.preventDefault();
    ev.stopPropagation();
  }

  function onUp(ev) {
    if (!dragging) return;
    dragging = false;
    idx = null;
    try { c.releasePointerCapture(ev.pointerId); } catch(e){}
    ev.preventDefault();
    ev.stopPropagation();
  }

  c.addEventListener("pointerdown", onDown, { passive: false });
  c.addEventListener("pointermove", onMove, { passive: false });
  c.addEventListener("pointerup", onUp, { passive: false });
  c.addEventListener("pointercancel", onUp, { passive: false });
}

/* =========================================================
   INIT
========================================================= */
function initCurve_DUAL() {
  redraw_DUAL();
  redrawAFRDetail_DUAL();
}

/* =========================================================
   AFR PANEL RENDER (DETAIL PER 100 RPM) — FIXED CANVAS
========================================================= */
function redrawAFRDetail_DUAL() {
  if (!DUAL || !DUAL.active) return;
  if (!DUAL.afrPanelOpen) return;

  const canvas = document.getElementById("afrDetailCanvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");

  const dim = fitCanvasToRect(canvas, ctx);
  if (!dim) return;

  const W = dim.W;
  const H = dim.H;

  const PAD_L = 55;
  const PAD_R = 12;
  const PAD_T = 14;
  const PAD_B = 26;

  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;

  let rMin = clampTo100(DUAL.afrRangeMin);
  let rMax = clampTo100(DUAL.afrRangeMax);
  rMin = clamp(rMin, RPM_MIN, RPM_MAX);
  rMax = clamp(rMax, RPM_MIN, RPM_MAX);
  if (rMax <= rMin) rMax = clampTo100(rMin + 100);

  DUAL.afrRangeMin = rMin;
  DUAL.afrRangeMax = rMax;

  ctx.clearRect(0, 0, W, H);
  ctx.font = "11px Arial";

  const cap = Number(DUAL.pickup ?? TIMING_MAX);
  if (!isFinite(cap) || cap <= 0) return;

  // grid horizontal
  ctx.strokeStyle = "rgba(70,80,110,0.35)";
  ctx.fillStyle = "rgba(180,190,255,0.9)";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (let t = 0; t <= cap; t += 5) {
    const y = PAD_T + plotH - (t / cap) * plotH;
    ctx.beginPath();
    ctx.moveTo(PAD_L, y);
    ctx.lineTo(W - PAD_R, y);
    ctx.stroke();
    ctx.fillText(`${t}°`, PAD_L - 6, y);
  }

  const step = 100;
  const count = Math.floor((rMax - rMin) / step) + 1;
  const cellW = plotW / count;
  const afrTextY = PAD_T + 2;

  ctx.textAlign = "center";
  ctx.textBaseline = "top";

  for (let i = 0; i < count; i++) {
    const rpm = rMin + i * step;
    const xLeft = PAD_L + i * cellW;
    const xMid  = xLeft + cellW / 2;

    let afrVal = null;

    if (DUAL.afrSource === "LIVE") {
      const liveR = clampTo100(Math.round(DUAL.liveRPM || 0));
      if (DUAL.live && DUAL.liveAFR != null && liveR === rpm) {
        afrVal = Number(Number(DUAL.liveAFR).toFixed(1));
      } else {
        const s = DUAL.afrSamples100[String(rpm)];
        if (s) afrVal = s.afr;
      }
    } else {
      const s = DUAL.afrSamples100[String(rpm)];
      if (s) afrVal = s.afr;
    }

    ctx.fillStyle = "rgba(255,255,255,0.025)";
    ctx.fillRect(xLeft, PAD_T, cellW, plotH);

    if (afrVal != null) {
      const color = getAFRColor(afrVal);
      ctx.fillStyle = color + "B0";
      ctx.fillRect(xLeft, PAD_T, cellW, plotH);

      ctx.strokeStyle = "rgba(0,0,0,0.75)";
      ctx.fillStyle = "rgba(255,255,255,0.98)";
      ctx.lineWidth = 2.4;
      ctx.strokeText(String(afrVal), xMid, afrTextY);
      ctx.fillText(String(afrVal), xMid, afrTextY);
    }

    const strong = (rpm % 500 === 0);
    ctx.strokeStyle = strong ? "rgba(255,255,255,0.20)" : "rgba(255,255,255,0.10)";
    ctx.lineWidth = strong ? 1.1 : 0.7;
    ctx.strokeRect(xLeft, PAD_T, cellW, plotH);
  }

  // label rpm bawah
  ctx.fillStyle = "rgba(230,230,230,0.9)";
  ctx.textBaseline = "top";
  for (let i = 0; i < count; i++) {
    const rpm = rMin + i * step;
    if (rpm % 200 !== 0) continue;
    const xLeft = PAD_L + i * cellW;
    const xMid = xLeft + cellW / 2;
    ctx.fillText(String(rpm), xMid, PAD_T + plotH + 6);
  }

  // ignition sync (garis putih)
  const map = DUAL.maps[DUAL.activeMap];
  const maxLimiter = map.limiter || RPM_MAX;

  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 2;
  ctx.beginPath();

  let started = false;
  for (let i = 0; i < count; i++) {
    const rpm = rMin + i * step;
    if (maxLimiter && rpm > maxLimiter) continue;

    const ign = getIgnitionAtRPM_DUAL(map, rpm, cap);
    const xLeft = PAD_L + i * cellW;
    const xMid  = xLeft + cellW / 2;
    const y = PAD_T + plotH - (ign / cap) * plotH;

    if (!started) {
      ctx.moveTo(xMid, y);
      started = true;
    } else {
      ctx.lineTo(xMid, y);
    }
  }
  ctx.stroke();

  ctx.fillStyle = "#ffffff";
  for (let i = 0; i < count; i++) {
    const rpm = rMin + i * step;
    if (maxLimiter && rpm > maxLimiter) continue;

    const ign = getIgnitionAtRPM_DUAL(map, rpm, cap);
    const xLeft = PAD_L + i * cellW;
    const xMid  = xLeft + cellW / 2;
    const y = PAD_T + plotH - (ign / cap) * plotH;

    ctx.beginPath();
    ctx.arc(xMid, y, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  // garis LIVE merah
  if (DUAL.live && DUAL.liveRPM > 0) {
    const liveR = clamp(DUAL.liveRPM, rMin, rMax);
    const x = PAD_L + ((liveR - rMin) / (rMax - rMin)) * plotW;

    ctx.strokeStyle = "#ff0000";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, PAD_T);
    ctx.lineTo(x, PAD_T + plotH);
    ctx.stroke();
  }
}

/* =========================================================
   Interpolasi ignition dari curve 250rpm
========================================================= */
function getIgnitionAtRPM_DUAL(map, rpm, cap) {
  const r = clamp(rpm, RPM_MIN, RPM_MAX);
  const idxFloat = (r - RPM_MIN) / RPM_STEP;
  const i0 = Math.floor(idxFloat);
  const i1 = Math.min(map.curve.length - 1, i0 + 1);
  const t = idxFloat - i0;

  const v0 = Number(map.curve[clamp(i0, 0, map.curve.length - 1)]);
  const v1 = Number(map.curve[i1]);
  const v = v0 + (v1 - v0) * t;

  return Math.max(TIMING_MIN, Math.min(cap, v));
}

/* =========================================================
   UTIL
========================================================= */
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function clampTo100(v) {
  if (isNaN(v)) return 0;
  return Math.round(v / 100) * 100;
}

/* =========================================================
   RESIZE OBSERVER (BIAR STABIL)
========================================================= */
function setupResizeObserver_DUAL() {
  try {
    if (DUAL._ro) { DUAL._ro.disconnect(); DUAL._ro = null; }
    const c1 = document.getElementById("curveCanvas");
    const c2 = document.getElementById("afrDetailCanvas");

    DUAL._ro = new ResizeObserver(() => {
      if (!DUAL || !DUAL.active) return;
      redraw_DUAL();
      redrawAFRDetail_DUAL();
    });

    if (c1) DUAL._ro.observe(c1);
    if (c2) DUAL._ro.observe(c2);

    // tambahan: saat orientasi/resize window
    window.addEventListener("resize", () => {
      if (!DUAL || !DUAL.active) return;
      redraw_DUAL();
      redrawAFRDetail_DUAL();
    }, { passive: true });
  } catch(e) {
    // kalau ResizeObserver tidak ada, tetap aman (manual redraw masih jalan)
  }
}

/* =========================================================
   READ / SEND (FIX SAFETY)
========================================================= */
window.read_DUAL = async function () {
  if (!DUAL || !DUAL.active) return;

  const blocked = await shouldBlockReadSend_DUAL("READ");
  if (blocked) return;

  const statusEl = document.getElementById("sendStatus");
  const btn = document.getElementById("readBtn");
  if (btn) btn.disabled = true;
  if (statusEl) statusEl.textContent = "READ...";

  try {
    if (typeof getMapFromESP_DUAL !== "function") throw new Error("NO_API");
    const data = await getMapFromESP_DUAL();

    if (typeof data.pickup === "number") DUAL.pickup = data.pickup;

    if (data.maps && data.maps.length >= 2) {
      for (let i = 0; i < 2; i++) {
        if (typeof data.maps[i].limiter === "number") DUAL.maps[i].limiter = data.maps[i].limiter;
        if (Array.isArray(data.maps[i].curve) && data.maps[i].curve.length === rpmPoints_BASIC.length) {
          DUAL.maps[i].curve = data.maps[i].curve.map(v => Number(v));
        }
      }
    }

    const pickupEl = document.getElementById("dualPickup");
    if (pickupEl) pickupEl.value = DUAL.pickup;

    const lim0 = document.getElementById("dualLimiter0");
    const lim1 = document.getElementById("dualLimiter1");
    if (lim0) lim0.value = DUAL.maps[0].limiter;
    if (lim1) lim1.value = DUAL.maps[1].limiter;

    buildTable_DUAL();
    redraw_DUAL();
    redrawAFRDetail_DUAL();

    if (statusEl) statusEl.textContent = "READ OK";
    setTimeout(() => { const s = document.getElementById("sendStatus"); if (s) s.textContent = ""; }, 800);
  } catch (e) {
    console.warn("[READ_DUAL FAIL]", e && e.message ? e.message : e);
    if (statusEl) statusEl.textContent = "READ FAIL";
    setTimeout(() => { const s = document.getElementById("sendStatus"); if (s) s.textContent = ""; }, 1200);
  } finally {
    if (btn) btn.disabled = false;
  }
};

window.send_DUAL = async function () {
  if (!DUAL || !DUAL.active) return;

  const blocked = await shouldBlockReadSend_DUAL("KIRIM");
  if (blocked) return;

  const statusEl = document.getElementById("sendStatus");
  const btn = document.getElementById("sendBtn");
  if (btn) btn.disabled = true;
  if (statusEl) statusEl.textContent = "KIRIM...";

  try {
    if (typeof sendMapToESP_DUAL !== "function") throw new Error("NO_API");

    const payload = {
      pickup: DUAL.pickup,
      maps: [
        { limiter: DUAL.maps[0].limiter, curve: DUAL.maps[0].curve },
        { limiter: DUAL.maps[1].limiter, curve: DUAL.maps[1].curve }
      ]
    };

    const res = await sendMapToESP_DUAL(payload);
    if (!res || !res.ok) throw new Error((res && res.reason) ? res.reason : "SEND_FAIL");

    if (statusEl) statusEl.textContent = "KIRIM OK";
    setTimeout(() => { const s = document.getElementById("sendStatus"); if (s) s.textContent = ""; }, 900);
  } catch (e) {
    console.warn("[SEND_DUAL FAIL]", e && e.message ? e.message : e);
    if (statusEl) statusEl.textContent = "KIRIM FAIL";
    setTimeout(() => { const s = document.getElementById("sendStatus"); if (s) s.textContent = ""; }, 1400);
  } finally {
    if (btn) btn.disabled = false;
  }
};
