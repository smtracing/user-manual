/* =========================================================
   CDI BASIC – FINAL STABLE (2026 STRONG FIX)
   - Status watcher auto berhenti saat pindah menu
   - Tidak ganggu LIVE (dikontrol cdi-basic-live.js)
   - READ / KIRIM / GRAFIK tidak diubah
   - ✅ Tambahan: pembatasan input manual (pickup & limiter)
========================================================= */

/* =========================================================
   KONFIGURASI DASAR
========================================================= */
const RPM_MIN = 500;
const RPM_MAX = 20000;
const RPM_STEP = 250;
const TIMING_MIN = 0;
const TIMING_MAX = 80;
const PICKUP_MIN = 10;
const PICKUP_MAX = 100;
const LABEL_WIDTH = 55;
const PLOT_LEFT = LABEL_WIDTH + 10;
const AXIS_BOTTOM = 30;
const AXIS_TOP_PADDING = 10;
const AXIS_RIGHT_PADDING = 20;
const COLOR_BASIC = "#4cff8f";
const COLOR_LIVE  = "#ff0000";

/* =========================================================
   TITIK RPM
========================================================= */
const rpmPoints_BASIC = [];
for (let r = RPM_MIN; r <= RPM_MAX; r += RPM_STEP) rpmPoints_BASIC.push(r);

/* =========================================================
   STRUKTUR DATA CDI BASIC
========================================================= */
window.BASIC = {
  pickup: 80,
  limiter: 20000,
  curve: rpmPoints_BASIC.map(() => 15),
  live: false,
  liveRPM: 0,
  liveTimer: null,
  status: "UNKNOWN",
  statusTimer: null,
  hasReadOnce: false
};

/* =========================================================
   LOAD CDI BASIC (INISIALISASI UI)
========================================================= */
window.loadCDI_BASIC = function() {
  console.log("⚙️ loadCDI_BASIC() dijalankan");

  // 🧩 Matikan watcher CDI lain (dual / racing)
  if (typeof stopStatusWatcher_DUAL === "function") stopStatusWatcher_DUAL();
  if (typeof stopStatusWatcher_RACING === "function") stopStatusWatcher_RACING();

  // 🔄 Matikan watcher lama jika masih hidup
  stopStatusWatcher_BASIC();

  const area = document.getElementById("contentArea");
  area.classList.remove("empty");

  area.innerHTML = `
    <div class="map-toolbar">
      <div class="toolbar-right">
        <label>LEBAR PICK UP (°)
          <input id="pickupWidth" type="number"
            min="${PICKUP_MIN}" max="${PICKUP_MAX}"
            value="${BASIC.pickup ?? ""}">
        </label>
        <label>TARGET LIMITER (RPM)
          <input id="rpmLimiter" type="number"
            step="250" min="500" max="20000"
            value="${BASIC.limiter ?? ""}">
        </label>

        <button id="readBtn" class="send-btn"
          style="height:32px;padding:0 14px;font-size:13px;border:none"
          onclick="read_BASIC()">READ</button>

        <button id="liveBtn" class="send-btn"
          style="height:32px;padding:0 14px;font-size:13px;background:#2ecc71;border:none"
          onclick="toggleLive_BASIC()">LIVE</button>

        <button id="sendBtn" class="send-btn"
          style="height:32px;padding:0 14px;font-size:13px;border:none"
          onclick="send_BASIC()">KIRIM</button>

        <span id="sendStatus" class="send-status"></span>
      </div>
    </div>

    <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">
      <h3 style="margin:0">CDI BASIC – Ignition Curve</h3>
      <div id="cdiStatusBox"
        style="font-size:11px;padding:4px 10px;border-radius:4px;background:#555;color:#fff;user-select:none">
        STATUS: CEK...
      </div>
    </div>

    <div class="curve-layout">
      <div class="curve-left">
        <table class="rpm-table" id="rpmTable"></table>
      </div>
      <canvas id="curveCanvas" class="curve-canvas"></canvas>
    </div>
  `;

  bindInputs_BASIC();
  buildTable_BASIC();
  initCurve_BASIC();
  enableDrag_BASIC();
  startStatusWatcher_BASIC();
};

/* =========================================================
   STATUS CDI AUTO REFRESH
========================================================= */
function startStatusWatcher_BASIC() {
  stopStatusWatcher_BASIC();
  BASIC.statusTimer = setInterval(async () => {
    try {
      const status = await getESPStatus();
      updateCDIStatus_BASIC(status.online && status.active_cdi === "basic");
    } catch {
      updateCDIStatus_BASIC(false);
    }
  }, 1500);
}

function stopStatusWatcher_BASIC() {
  if (BASIC.statusTimer) {
    clearInterval(BASIC.statusTimer);
    BASIC.statusTimer = null;
    console.log("🛑 Watcher CDI BASIC dimatikan");
  }
}

/* =========================================================
   NONAKTIFKAN CDI BASIC
========================================================= */
window.deactivateCDI_BASIC = function() {
  stopStatusWatcher_BASIC();
  if (BASIC.liveTimer) {
    clearInterval(BASIC.liveTimer);
    BASIC.liveTimer = null;
    BASIC.live = false;
  }
  BASIC.status = "UNAVAILABLE";
  const box = document.getElementById("cdiStatusBox");
  if (box) {
    box.textContent = "CDI BASIC TIDAK TERSEDIA";
    box.style.background = "#555";
  }
  console.log("🚫 CDI BASIC dinonaktifkan total");
};

function updateCDIStatus_BASIC(isActive) {
  const box = document.getElementById("cdiStatusBox");
  if (!box) return;
  if (isActive) {
    BASIC.status = "ACTIVE";
    box.textContent = "CDI BASIC AKTIF";
    box.style.background = "#2ecc71";
  } else {
    BASIC.status = "UNAVAILABLE";
    box.textContent = "CDI TIDAK TERSEDIA";
    box.style.background = "#555";
  }
  box.style.color = "#ffffff";
}

/* =========================================================
   READ DATA DARI ESP
========================================================= */
async function read_BASIC() {
  const s = document.getElementById("sendStatus");
  if (!s) return;
  s.textContent = "Membaca data CDI...";
  s.className = "send-status send-prog";

  try {
    const espData = await getMapFromESP();
    BASIC.pickup   = espData.pickup;
    BASIC.limiter  = espData.limiter;
    BASIC.curve    = rpmPoints_BASIC.map((_, i) => espData.curve[i] ?? espData.curve.at(-1) ?? 0);
    BASIC.status   = espData.status;
    BASIC.liveRPM  = espData.liveRPM;
    BASIC.hasReadOnce = true;

    document.getElementById("pickupWidth").value = BASIC.pickup;
    document.getElementById("rpmLimiter").value  = BASIC.limiter;

    buildTable_BASIC();
    redraw_BASIC();

    updateCDIStatus_BASIC(BASIC.status === "ACTIVE");

    s.textContent = "Data CDI berhasil dibaca dari alat";
    s.className = "send-status send-ok";
  } catch (err) {
    console.error("READ BASIC ERROR:", err);
    s.textContent = "Gagal membaca dari alat";
    s.className = "send-status send-fail";
  }
}

/* =========================================================
   INPUT HANDLER + VALIDASI BATAS
========================================================= */
function bindInputs_BASIC() {
  const pickup = document.getElementById("pickupWidth");
  const limiter = document.getElementById("rpmLimiter");

  // Input pickup
  pickup.oninput = e => {
    const v = Number(e.target.value);
    if (!isNaN(v)) BASIC.pickup = v;
    redraw_BASIC();
  };
  pickup.onblur = e => {
    let v = Number(e.target.value);
    if (isNaN(v)) v = BASIC.pickup;
    if (v < PICKUP_MIN) v = PICKUP_MIN;
    if (v > PICKUP_MAX) v = PICKUP_MAX;
    BASIC.pickup = v;
    e.target.value = v;
    redraw_BASIC();
  };

  // Input limiter
  limiter.oninput = e => {
    const v = parseInt(e.target.value, 10);
    if (!isNaN(v)) BASIC.limiter = v;
    buildTable_BASIC();
    redraw_BASIC();
  };
  limiter.onblur = e => {
    let v = parseInt(e.target.value, 10);
    if (isNaN(v)) v = BASIC.limiter;
    if (v < RPM_MIN) v = RPM_MIN;
    if (v > RPM_MAX) v = RPM_MAX;
    BASIC.limiter = v;
    e.target.value = v;
    buildTable_BASIC();
    redraw_BASIC();
  };
}

/* =========================================================
   TABEL DATA RPM
========================================================= */
function buildTable_BASIC() {
  const table = document.getElementById("rpmTable");
  let html = `<tr><th>RPM</th><th>°</th></tr>`;
  rpmPoints_BASIC.forEach((rpm, i) => {
    const lock = BASIC.limiter && rpm > BASIC.limiter;
    html += `
      <tr style="opacity:${lock ? 0.35 : 1}">
        <td>${rpm}</td>
        <td>
          <input type="number" step="0.1"
            value="${BASIC.curve[i].toFixed(1)}"
            ${lock ? "disabled" : ""}
            onchange="tableChange_BASIC(${i},this.value)">
        </td>
      </tr>`;
  });
  table.innerHTML = html;
}

/* =========================================================
   EDIT NILAI TABEL
========================================================= */
function tableChange_BASIC(i, val) {
  const v = parseFloat(val);
  if (isNaN(v)) return;
  const cap = BASIC.pickup ?? TIMING_MAX;
  BASIC.curve[i] = Math.max(TIMING_MIN, Math.min(cap, v));
  redraw_BASIC();
}

/* =========================================================
   GAMBAR GRAFIK KURVA + GARIS LIVE
========================================================= */
function redraw_BASIC() {
  const c = document.getElementById("curveCanvas");
  const ctx = c.getContext("2d");
  c.width = c.clientWidth;
  c.height = c.clientHeight;

  const plotW = c.width - PLOT_LEFT - AXIS_RIGHT_PADDING;
  const plotH = c.height - AXIS_BOTTOM - AXIS_TOP_PADDING;
  const cap = BASIC.pickup ?? TIMING_MAX;

  ctx.clearRect(0, 0, c.width, c.height);
  ctx.font = "11px Arial";

  // grid horizontal
  ctx.strokeStyle = "#2a2f45";
  ctx.fillStyle = "#9fa8ff";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (let t = 0; t <= cap; t += 5) {
    const y = AXIS_TOP_PADDING + plotH - (t / cap) * plotH;
    ctx.beginPath();
    ctx.moveTo(PLOT_LEFT, y);
    ctx.lineTo(c.width - AXIS_RIGHT_PADDING, y);
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

  // garis kurva
  ctx.strokeStyle = COLOR_BASIC;
  ctx.lineWidth = 2;
  ctx.beginPath();
  BASIC.curve.forEach((v, i) => {
    if (BASIC.limiter && rpmPoints_BASIC[i] > BASIC.limiter) return;
    const val = Math.min(v, cap);
    const x = PLOT_LEFT + (i / (BASIC.curve.length - 1)) * plotW;
    const y = AXIS_TOP_PADDING + plotH - (val / cap) * plotH;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.stroke();

  // titik kurva
  ctx.fillStyle = COLOR_BASIC;
  BASIC.curve.forEach((v, i) => {
    if (BASIC.limiter && rpmPoints_BASIC[i] > BASIC.limiter) return;
    const val = Math.min(v, cap);
    const x = PLOT_LEFT + (i / (BASIC.curve.length - 1)) * plotW;
    const y = AXIS_TOP_PADDING + plotH - (val / cap) * plotH;
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fill();
  });

  // garis LIVE
  if (BASIC.live) {
    const rpmLive = BASIC.liveRPM > 0 ? BASIC.liveRPM : RPM_MIN;
    const idx = Math.round((rpmLive - RPM_MIN) / RPM_STEP);
    const x = PLOT_LEFT + (idx / (rpmPoints_BASIC.length - 1)) * plotW;
    ctx.strokeStyle = COLOR_LIVE;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, AXIS_TOP_PADDING);
    ctx.lineTo(x, AXIS_TOP_PADDING + plotH);
    ctx.stroke();
  }
}

/* =========================================================
   DRAG TITIK
========================================================= */
function enableDrag_BASIC(){
  const c = document.getElementById("curveCanvas_BASIC");
  if(!c) return;

  // HP: supaya titik bisa di-drag (tanpa halaman ikut geser)
  c.style.touchAction = "none";

  let dragging = false;
  let idx = null;
  let activePointerId = null;

  // pointer -> koordinat canvas (memperhitungkan zoom CSS / rotate wrapper)
  function pointerToCanvas(e){
    const rect = c.getBoundingClientRect();
    const sx = c.width  / rect.width;
    const sy = c.height / rect.height;
    return {
      x: (e.clientX - rect.left) * sx,
      y: (e.clientY - rect.top)  * sy
    };
  }

  function dxStep(){
    return (c.width - PLOT_LEFT - AXIS_RIGHT_PADDING) / (rpmPoints_BASIC.length - 1);
  }

  function pickIndexAt(x){
    const dx = dxStep();
    const i = Math.round((x - PLOT_LEFT) / dx);
    if (i < 0 || i >= rpmPoints_BASIC.length) return null;
    return i;
  }

  function setFromY(i, y){
    const cap = (BASIC.pickup ?? TIMING_MAX);
    let val = cap * (1 - (y - AXIS_TOP_PADDING) / (c.height - AXIS_BOTTOM - AXIS_TOP_PADDING));
    val = Math.max(TIMING_MIN, Math.min(cap, val));

    BASIC.curve[i] = val;

    const inp = document.querySelector(`#rpmTable tr:nth-child(${i + 2}) input`);
    if (inp) inp.value = val.toFixed(1);

    redraw_BASIC();
    redrawAFRDetail_BASIC();
  }

  function onDown(e){
    // hanya primary button / touch
    if (e.button !== undefined && e.button !== 0) return;

    const p = pointerToCanvas(e);
    const i = pickIndexAt(p.x);
    if (i === null) return;

    // wajib dekat titik, supaya tidak salah drag
    const dx = dxStep();
    const cap = (BASIC.pickup ?? TIMING_MAX);
    const px = PLOT_LEFT + i * dx;

    const curVal = BASIC.curve[i];
    const py = AXIS_TOP_PADDING + (1 - (curVal / cap)) * (c.height - AXIS_BOTTOM - AXIS_TOP_PADDING);

    const hitR = (navigator.maxTouchPoints && navigator.maxTouchPoints > 0) ? 18 : 12;
    if (Math.hypot(p.x - px, p.y - py) > hitR) return;

    e.preventDefault();
    e.stopPropagation();

    dragging = true;
    idx = i;
    activePointerId = (e.pointerId !== undefined) ? e.pointerId : null;

    try {
      if (c.setPointerCapture && activePointerId !== null) c.setPointerCapture(activePointerId);
    } catch(_){}

    setFromY(idx, p.y);
  }

  function onMove(e){
    if (!dragging) return;
    if (activePointerId !== null && e.pointerId !== activePointerId) return;

    e.preventDefault();
    e.stopPropagation();

    const p = pointerToCanvas(e);
    setFromY(idx, p.y);
  }

  function end(e){
    if (!dragging) return;
    if (activePointerId !== null && e.pointerId !== undefined && e.pointerId !== activePointerId) return;

    dragging = false;
    idx = null;

    try {
      if (c.releasePointerCapture && activePointerId !== null) c.releasePointerCapture(activePointerId);
    } catch(_){}

    activePointerId = null;
  }

  // jangan pakai window.onmouseup / onmousemove (biar tidak bentrok)
  c.onmousedown = null;
  c.onmousemove = null;

  c.addEventListener("pointerdown", onDown, { passive:false });
  c.addEventListener("pointermove", onMove, { passive:false });
  window.addEventListener("pointerup", end, { passive:false });
  window.addEventListener("pointercancel", end, { passive:false });
}


/* =========================================================
   SEND DATA MAP KE ESP
========================================================= */
async function send_BASIC() {
  const s = document.getElementById("sendStatus");
  s.textContent = "Mengirim...";
  s.className = "send-status send-prog";
  const result = await sendMapToESP(BASIC);
  if (result.ok) {
    s.textContent = "Kirim sukses";
    s.className = "send-status send-ok";
  } else {
    s.textContent = `Gagal kirim (${result.reason})`;
    s.className = "send-status send-fail";
  }
}

/* =========================================================
   INISIALISASI
========================================================= */
function initCurve_BASIC() {
  redraw_BASIC();
}
