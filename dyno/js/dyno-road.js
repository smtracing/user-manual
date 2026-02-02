console.log("✅ dyno-road.js dimuat (RPM + HP + TQ + IGN + AFR + SLIP overlay)");

(function(){
  const ENGINE_TICK_MS = 2;
  const UI_POLL_MS     = 16;

  const FIXED_RPM_START = 2000;
  const FIXED_RPM_END   = 20000;

  const MAX_TABLE_ROWS = 800;

  // colors
  const AFR_COLOR  = "rgb(255,0,170)"; // pink
  const IGN_COLOR  = "rgb(255,204,0)";
  const SLIP_COLOR = "rgb(255,70,70)"; // merah slip
  const TQ_COLOR   = "rgb(0,255,102)";
  const HP_COLOR   = "rgb(52,152,219)";

  // ✅ indikator koneksi
  const CONN_ON_BG  = "rgba(46, 204, 113, 0.30)";   // hijau
  const CONN_ON_BD  = "rgba(46, 204, 113, 0.60)";
  const CONN_OFF_BG = "rgba(255,255,255,0.08)";     // abu
  const CONN_OFF_BD = "rgba(255,255,255,0.14)";
  const CONN_ON_TX  = "rgba(200,255,220,0.95)";
  const CONN_OFF_TX = "rgba(220,220,220,0.80)";

  const DYNO = {
    armed:false,
    running:false,

    targetM:200,
    circM:1.85,
    weightKg:120,
    pprFront:1,
    pprRear:1,

    rpmStart: FIXED_RPM_START,
    rpmEnd:   FIXED_RPM_END,

    t0:0,
    t:0,
    distM:0,
    speedKmh:0,
    rpm:0,
    tq:0,
    hp:0,
    ign:0,
    afr:14.7,

    // ✅ SLIP (total only)
    slipPct:0,
    slipOn:false,

    maxHP:0,
    maxTQ:0,

    rows:[],
    lastSeq:0,

    timer:null,

    statusBase:"READY",
    statusTimer:null,

    polling:false,

    // ✅ koneksi (dari esp-api-dual snapshot)
    linkOk:false,
    linkText:"DISCONNECTED",

    c:null, ctx:null, W:0,H:0
  };

  // ==========================
  // PUBLIC API
  // ==========================
  window.DYNO_init = function(){
    DYNO.c = document.getElementById("dynoCanvas");
    if (!DYNO.c) return;
    DYNO.ctx = DYNO.c.getContext("2d");

    window.addEventListener("resize", () => {
      DYNO_resizeCanvas();
      DYNO_draw();
    });

    bindInputs();
    DYNO_resizeCanvas();
    DYNO_reset(true);
    updateState("READY");

    ensureStatusProgressEl();
    setStatus("READY");

    // ✅ buat indikator koneksi + default OFF
    ensureConnBadgeEl();
    setConnBadge(false, "OFF");

    DYNO_draw();
  };

  window.DYNO_arm = function(){
    if (DYNO.running) return;
    readInputs();

    DYNO_reset(true);
    DYNO.armed = true;
    updateState("ARMED");

    ensureStatusProgressEl();
    setStatus("ARMED: siap RUN. Target = " + DYNO.targetM + " m");

    DYNO_draw();

    if (typeof window.DYNO_arm_DUAL === "function") {
      window.DYNO_arm_DUAL({
        tickMs: ENGINE_TICK_MS,
        targetM: DYNO.targetM,
        circM: DYNO.circM,
        pprFront: DYNO.pprFront,
        pprRear: DYNO.pprRear,
        weightKg: DYNO.weightKg,
        rpmStart: DYNO.rpmStart,
        rpmEnd: DYNO.rpmEnd
      });
    }
  };

  window.DYNO_run = function(){
    readInputs();

    if (!DYNO.armed){
      setStatus("HARUS ARM dulu.");
      return;
    }
    if (DYNO.running) return;

    DYNO.running = true;
    DYNO.t0 = performance.now();
    updateState("RUNNING");

    ensureStatusProgressEl();
    setStatus("RUNNING... auto stop saat target tercapai.");

    startStatusAnim();

    if (typeof window.DYNO_setConfig_DUAL === "function") {
      window.DYNO_setConfig_DUAL({
        tickMs: ENGINE_TICK_MS,
        targetM: DYNO.targetM,
        circM: DYNO.circM,
        pprFront: DYNO.pprFront,
        pprRear: DYNO.pprRear,
        weightKg: DYNO.weightKg,
        rpmStart: DYNO.rpmStart,
        rpmEnd: DYNO.rpmEnd
      });
    }
    if (typeof window.DYNO_run_DUAL === "function") {
      window.DYNO_run_DUAL();
    }

    if (DYNO.timer) clearInterval(DYNO.timer);
    DYNO.timer = setInterval(() => {
      pollFromESP();
    }, UI_POLL_MS);

    updateStatusProgress();
    DYNO_draw();
  };

  window.DYNO_stop = function(){
    if (DYNO.timer){
      clearInterval(DYNO.timer);
      DYNO.timer = null;
    }
    DYNO.running = false;
    DYNO.armed = false;

    stopStatusAnim();

    updateState("STOP");
    setStatus("STOP. Data tersimpan di tabel (belum dihapus).");

    DYNO_draw();

    if (typeof window.DYNO_stop_DUAL === "function") {
      window.DYNO_stop_DUAL("STOP");
    }
  };

  window.DYNO_saveCSV = function(){
    if (!DYNO.rows.length){
      setStatus("DATA KOSONG. RUN dulu.");
      return;
    }

    // ✅ SLIP dihapus dari CSV (hanya overlay)
    const head = ["t_s","rpm","tq_Nm","hp","ign_deg","afr","dist_m","speed_kmh"];
    const lines = [head.join(",")];

    for (const r of DYNO.rows){
      lines.push([
        r.t.toFixed(3),
        Math.round(r.rpm),
        r.tq.toFixed(2),
        r.hp.toFixed(2),
        r.ign.toFixed(2),
        (isFinite(r.afr) ? r.afr.toFixed(2) : "14.70"),
        r.dist.toFixed(2),
        (r.spd||0).toFixed(2)
      ].join(","));
    }

    const blob = new Blob([lines.join("\n")], {type:"text/csv"});
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "dyno_road.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(a.href);
    setStatus("SAVED (CSV).");
  };

  // ==========================
  // POLL DATA
  // ==========================
  async function pollFromESP(){
    if (DYNO.polling) return;
    DYNO.polling = true;

    try {
      if (typeof window.DYNO_getSnapshot_DUAL !== "function") {
        // ✅ kalau backend tidak ada = dianggap tidak terhubung
        DYNO.linkOk = false;
        DYNO.linkText = "OFF";
        setConnBadge(false, "OFF");
        return;
      }

      const snap = await window.DYNO_getSnapshot_DUAL();

      // ✅ koneksi: ambil dari snapshot (linkOk/linkText)
      // kalau backend lama tidak punya field, tetap anggap ON karena snapshot bisa diambil
      if (snap && typeof snap === "object") {
        if ("linkOk" in snap) DYNO.linkOk = !!snap.linkOk;
        else DYNO.linkOk = true;

        if ("linkText" in snap && snap.linkText) DYNO.linkText = String(snap.linkText);
        else DYNO.linkText = DYNO.linkOk ? "ON" : "OFF";
      } else {
        DYNO.linkOk = false;
        DYNO.linkText = "OFF";
      }
      setConnBadge(DYNO.linkOk, DYNO.linkText);

      DYNO.targetM  = snap.targetM || DYNO.targetM;

      DYNO.t        = snap.t || 0;
      DYNO.distM    = snap.distM || 0;
      DYNO.speedKmh = snap.speedKmh || 0;

      DYNO.rpm      = snap.rpm || 0;
      DYNO.tq       = snap.tq || 0;
      DYNO.hp       = snap.hp || 0;
      DYNO.ign      = snap.ign || 0;
      DYNO.afr      = (isFinite(snap.afr) ? snap.afr : DYNO.afr);

      // ✅ SLIP hanya ambil total dari snapshot (bukan per-row)
      DYNO.slipPct  = (isFinite(snap.slipPct) ? snap.slipPct : DYNO.slipPct);
      DYNO.slipOn   = !!snap.slipOn;

      DYNO.maxHP    = snap.maxHP || DYNO.maxHP || 0;
      DYNO.maxTQ    = snap.maxTQ || DYNO.maxTQ || 0;

      if (snap.statusText) {
        DYNO.statusBase = snap.statusText;
        renderStatus();
      }

      if (typeof window.DYNO_getRowsSince_DUAL === "function") {
        const pack = await window.DYNO_getRowsSince_DUAL(DYNO.lastSeq || 0);
        if (pack && Array.isArray(pack.rows) && pack.rows.length) {
          for (const r of pack.rows) {
            // ✅ SLIP dihapus dari data log (row)
            const row = {
              t: r.t,
              rpm: r.rpm,
              tq: r.tq,
              hp: r.hp,
              ign: r.ign,
              afr: r.afr,
              dist: r.dist,
              spd: r.spd
            };
            DYNO.rows.push(row);
            appendRowFast(row);
          }
          DYNO.lastSeq = pack.seq || DYNO.lastSeq;
        }
      }

      updateLiveUI();
      updateStatusProgress();
      DYNO_draw();

      if (!snap.running && DYNO.running) {
        setStatus(snap.statusText || ("AUTO STOP: target jarak tercapai (" + DYNO.targetM + " m)."));
        window.DYNO_stop();
      }
    } catch (e) {
      // ✅ kalau gagal ambil snapshot, anggap putus
      DYNO.linkOk = false;
      DYNO.linkText = "OFF";
      setConnBadge(false, "OFF");
    } finally {
      DYNO.polling = false;
    }
  }

  // ==========================
  // CANVAS
  // ==========================
  function DYNO_resizeCanvas(){
    if (!DYNO.c) return;
    DYNO.c.width  = DYNO.c.clientWidth;
    DYNO.c.height = DYNO.c.clientHeight;
    DYNO.W = DYNO.c.width;
    DYNO.H = DYNO.c.height;
  }

  // ==========================
  // DRAW GRAPH
  // ==========================
  function DYNO_draw(){
    if (!DYNO.ctx) return;

    const ctx = DYNO.ctx;
    const W = DYNO.W, H = DYNO.H;

    ctx.clearRect(0,0,W,H);

    const PAD_L = 97;
    const PAD_R = 70;
    const PAD_T = 14;
    const PAD_B = 42;

    const plotW = W - PAD_L - PAD_R;
    const plotH = H - PAD_T - PAD_B;

    const rMin = DYNO.rpmStart;
    const rMax = DYNO.rpmEnd;

    const dMin = 0;
    const dMax = Math.max(1, DYNO.targetM);

    const yMaxPower = niceMax(Math.max(1, DYNO.maxHP || 0, DYNO.maxTQ || 0));

    // IGN axis
    const yIgnMax = computeIgnAxisMax();
    const ignStep = pickIgnStep(yIgnMax);

    // AFR axis centered at 14.7
    const afrAxis = computeAfrAxis();
    const afrMin = afrAxis.min;
    const afrMax = afrAxis.max;
    const afrStep = afrAxis.step;
    const afrMid = afrAxis.mid;

    // plot right edge
    const xPlotRight = W - PAD_R;

    const xIgnAxis  = xPlotRight;
    const xIgnLabel = xIgnAxis + 12;

    const xAfrAxis  = Math.min(W - 46, xPlotRight + 26);
    const xAfrLabel = xAfrAxis + 12;

    // ===== POWER GRID + LEFT LABEL =====
    ctx.lineWidth = 1;
    ctx.font = "11px Arial";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";

    for (let k=0; k<=5; k++){
      const y = PAD_T + plotH - (k/5)*plotH;

      ctx.strokeStyle = "rgba(60,70,95,0.35)";
      ctx.beginPath();
      ctx.moveTo(PAD_L, y);
      ctx.lineTo(xPlotRight, y);
      ctx.stroke();

      const v = (k/5)*yMaxPower;
      ctx.fillStyle = "rgba(210,218,235,0.85)";
      ctx.fillText(v.toFixed(0), PAD_L - 25, y);
    }

    // ===== IGN GRID + RIGHT AXIS =====
    for (let ignVal = 0; ignVal <= yIgnMax + 1e-9; ignVal += ignStep){
      const y = PAD_T + plotH - (ignVal / Math.max(1e-6, yIgnMax)) * plotH;

      const major = (Math.round(ignVal) % 10 === 0);
      const gridCol = major ? "rgba(255,204,0,0.14)" : "rgba(255,204,0,0.08)";
      const tickCol = major ? "rgba(255,204,0,0.22)" : "rgba(255,204,0,0.14)";
      const textCol = major ? "rgba(255,204,0,0.88)" : "rgba(255,204,0,0.78)";

      ctx.strokeStyle = gridCol;
      ctx.beginPath();
      ctx.moveTo(PAD_L, y);
      ctx.lineTo(xPlotRight, y);
      ctx.stroke();

      ctx.strokeStyle = tickCol;
      ctx.beginPath();
      ctx.moveTo(xIgnAxis, y);
      ctx.lineTo(xIgnAxis + 8, y);
      ctx.stroke();

      ctx.fillStyle = textCol;
      ctx.font = "10px Arial";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(String(Math.round(ignVal)), xIgnLabel, y);
    }

    // ===== AFR MIDLINE (14.7) =====
    {
      const yMid = yMapMinMax(afrMid, afrMin, afrMax, PAD_T, plotH);
      ctx.strokeStyle = "rgba(255,0,170,0.20)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(PAD_L, yMid);
      ctx.lineTo(xPlotRight, yMid);
      ctx.stroke();
      // teks "AFR 14.7" sudah dihilangkan sebelumnya
    }

    // ===== AFR ticks + labels =====
    for (let afrVal = Math.ceil(afrMin/afrStep)*afrStep; afrVal <= afrMax + 1e-9; afrVal += afrStep){
      const y = yMapMinMax(afrVal, afrMin, afrMax, PAD_T, plotH);

      const tickCol = "rgba(255,0,170,0.18)";
      const textCol = "rgba(255,0,170,0.82)";

      ctx.strokeStyle = tickCol;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(xAfrAxis, y);
      ctx.lineTo(xAfrAxis + 8, y);
      ctx.stroke();

      ctx.fillStyle = textCol;
      ctx.font = "10px Arial";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(afrVal.toFixed(1), xAfrLabel, y);
    }

    // ===== RPM ticks =====
    const stepYRPM = 500;
    for (let rpm = roundUp(rMin, stepYRPM); rpm <= rMax; rpm += stepYRPM){
      const y = PAD_T + plotH - ((rpm - rMin) / Math.max(1,(rMax - rMin))) * plotH;

      ctx.strokeStyle = (rpm % 1000 === 0) ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.06)";
      ctx.beginPath();
      ctx.moveTo(PAD_L, y);
      ctx.lineTo(xPlotRight, y);
      ctx.stroke();

      ctx.strokeStyle = "rgba(255,255,255,0.16)";
      ctx.beginPath();
      ctx.moveTo(PAD_L - 54, y);
      ctx.lineTo(PAD_L - 46, y);
      ctx.stroke();

      ctx.fillStyle = "rgba(255,255,255,0.72)";
      ctx.font = "10px Arial";
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      ctx.fillText(String(Math.round(rpm)), PAD_L - 58, y);
    }

    // ===== Dist grid =====
    const stepM = 10;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";

    for (let m = roundUp(dMin, stepM); m <= dMax; m += stepM){
      const x = PAD_L + ((m - dMin) / Math.max(1,(dMax - dMin))) * plotW;

      ctx.strokeStyle = (m % 50 === 0) ? "rgba(70,85,115,0.35)" : "rgba(60,70,95,0.18)";
      ctx.beginPath();
      ctx.moveTo(x, PAD_T);
      ctx.lineTo(x, PAD_T + plotH);
      ctx.stroke();

      ctx.fillStyle = "rgba(230,230,230,0.85)";
      ctx.font = (m % 50 === 0) ? "11px Arial" : "10px Arial";
      ctx.fillText(String(Math.round(m)), x, PAD_T + plotH + 8);
    }

    if (DYNO.rows.length < 2) {
      drawInfoText(ctx, W, H, "ARM → RUN untuk mulai.");
      drawOverlayInsideGraph(ctx, PAD_L, PAD_T, plotW, plotH);
      return;
    }

    const series = buildSeriesByDist(DYNO.rows, dMin, dMax, rMin, rMax);

    // ✅ TQ normal (tanpa slip merah di grafik)
    drawCurveDist(series, p=>p.tq,  TQ_COLOR, yMaxPower, PAD_L, PAD_T, plotW, plotH, dMin, dMax);

    // HP
    drawCurveDist(series, p=>p.hp,  HP_COLOR, yMaxPower, PAD_L, PAD_T, plotW, plotH, dMin, dMax);

    // IGN
    drawCurveDist(series, p=>p.ign, IGN_COLOR, yIgnMax,  PAD_L, PAD_T, plotW, plotH, dMin, dMax);

    // AFR
    drawCurveDistMinMax(series, p=>p.afr, AFR_COLOR, afrMin, afrMax, PAD_L, PAD_T, plotW, plotH, dMin, dMax);

    // RPM overlay
    drawRPMUnifiedDist(series, PAD_L, PAD_T, plotW, plotH, dMin, dMax, rMin, rMax);

    // live marker
    const liveX = PAD_L + (clamp(DYNO.distM, dMin, dMax) - dMin) / Math.max(1,(dMax - dMin)) * plotW;
    ctx.strokeStyle = "rgba(255,0,0,0.85)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(liveX, PAD_T);
    ctx.lineTo(liveX, PAD_T + plotH);
    ctx.stroke();

    drawOverlayInsideGraph(ctx, PAD_L, PAD_T, plotW, plotH);
  }

  // ==========================
  // AXIS HELPERS
  // ==========================
  function computeIgnAxisMax(){
    let ignMaxSeen = 0;
    const start = Math.max(0, DYNO.rows.length - 2000);
    for (let i = start; i < DYNO.rows.length; i++){
      const v = DYNO.rows[i] && DYNO.rows[i].ign;
      if (isFinite(v)) ignMaxSeen = Math.max(ignMaxSeen, v);
    }
    if (isFinite(DYNO.ign)) ignMaxSeen = Math.max(ignMaxSeen, DYNO.ign);
    return niceIgnMax(ignMaxSeen);
  }

  function niceIgnMax(v){
    v = Math.max(0, v);
    if (v <= 70) return 70;
    if (v <= 100) return Math.ceil(v / 10) * 10;
    if (v <= 200) return Math.ceil(v / 20) * 20;
    return Math.ceil(v / 25) * 25;
  }

  function pickIgnStep(max){
    if (max <= 100) return 5;
    if (max <= 200) return 10;
    return 20;
  }

  function computeAfrAxis(){
    const mid = 14.7;
    let maxDev = 4.7; // default

    const start = Math.max(0, DYNO.rows.length - 2000);
    for (let i = start; i < DYNO.rows.length; i++){
      const a = DYNO.rows[i] && DYNO.rows[i].afr;
      if (!isFinite(a)) continue;
      maxDev = Math.max(maxDev, Math.abs(a - mid) * 1.15);
    }
    if (isFinite(DYNO.afr)) maxDev = Math.max(maxDev, Math.abs(DYNO.afr - mid) * 1.15);

    maxDev = clamp(maxDev, 2.0, 20.0);

    let min = mid - maxDev;
    let max = mid + maxDev;

    min = Math.floor(min * 10) / 10;
    max = Math.ceil(max * 10) / 10;

    const range = max - min;

    let step = 0.5;
    if (range > 12) step = 2.0;
    else if (range > 8) step = 1.0;
    else step = 0.5;

    return { min, max, step, mid };
  }

  function yMapMinMax(v, vMin, vMax, y0, h){
    const t = (v - vMin) / Math.max(1e-6, (vMax - vMin));
    return y0 + h - clamp(t, 0, 1) * h;
  }

  // ==========================
  // DRAW CURVES
  // ==========================
  function drawCurveDist(points, getter, color, yMax, x0, y0, w, h, dMin, dMax){
    const ctx = DYNO.ctx;
    const ym = Math.max(1e-6, yMax);

    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();

    let started = false;
    for (const p of points){
      const x = x0 + ((p.dist - dMin) / Math.max(1,(dMax - dMin))) * w;
      const v = getter(p);
      const y = y0 + h - (clamp(v / ym, 0, 1)) * h;
      if (!started){ ctx.moveTo(x,y); started = true; }
      else ctx.lineTo(x,y);
    }
    ctx.stroke();
  }

  function drawCurveDistMinMax(points, getter, color, vMin, vMax, x0, y0, w, h, dMin, dMax){
    const ctx = DYNO.ctx;

    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();

    let started = false;
    for (const p of points){
      const x = x0 + ((p.dist - dMin) / Math.max(1,(dMax - dMin))) * w;
      const v = getter(p);
      if (!isFinite(v)) continue;

      const y = yMapMinMax(v, vMin, vMax, y0, h);
      if (!started){ ctx.moveTo(x,y); started = true; }
      else ctx.lineTo(x,y);
    }
    if (started) ctx.stroke();
  }

  function drawRPMUnifiedDist(points, x0, y0, w, h, dMin, dMax, rMin, rMax){
    const ctx = DYNO.ctx;
    ctx.strokeStyle = "rgba(255,255,255,0.90)";
    ctx.lineWidth = 2;
    ctx.beginPath();

    let started = false;
    for (const p of points){
      const x = x0 + ((p.dist - dMin) / Math.max(1,(dMax - dMin))) * w;
      const y = y0 + h - ((p.rpm - rMin) / Math.max(1,(rMax - rMin))) * h;
      if (!started){ ctx.moveTo(x,y); started = true; }
      else ctx.lineTo(x,y);
    }
    ctx.stroke();
  }

  function buildSeriesByDist(rows, dMin, dMax, rMin, rMax){
    const out = [];
    let lastDist = -1e9;

    for (const r of rows){
      let dist = r.dist;
      let rpm  = r.rpm;
      let hp   = r.hp;
      let tq   = r.tq;
      let ign  = r.ign;
      let afr  = r.afr;

      if (!isFinite(dist) || !isFinite(rpm)) continue;
      if (!isFinite(hp)) hp = 0;
      if (!isFinite(tq)) tq = 0;
      if (!isFinite(ign)) ign = 0;
      if (!isFinite(afr)) afr = 14.7;

      dist = clamp(dist, dMin, dMax);
      rpm  = clamp(rpm,  rMin, rMax);

      if (dist + 1e-6 < lastDist) continue;

      if (out.length && Math.abs(dist - lastDist) < 0.05){
        out[out.length - 1].rpm = rpm;
        out[out.length - 1].hp  = hp;
        out[out.length - 1].tq  = tq;
        out[out.length - 1].ign = ign;
        out[out.length - 1].afr = afr;
        continue;
      }

      out.push({ dist, rpm, hp, tq, ign, afr });
      lastDist = dist;
    }
    return out;
  }

  function niceMax(v){
    v = Math.max(1, v);
    const pow = Math.pow(10, Math.floor(Math.log10(v)));
    const n = v / pow;
    let m = 1;
    if (n <= 1) m = 1;
    else if (n <= 2) m = 2;
    else if (n <= 5) m = 5;
    else m = 10;
    return m * pow;
  }

  function drawInfoText(ctx, W, H, s){
    ctx.save();
    ctx.font = "900 16px Arial";
    ctx.fillStyle = "rgba(255,255,255,0.80)";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(s, W/2, H/2);
    ctx.restore();
  }

  // ==========================
  // OVERLAY BOX (dipendekkan)
  // ==========================
  function drawOverlayInsideGraph(ctx, x0, y0, w, h){
    const pad = 10;

    // ✅ dipendekkan (tidak terlalu lebar ke bawah)
    const boxH = 72;

    const rpmText = "RPM  : " + String(Math.round(DYNO.rpm || 0));
    const tqText  = "TQ   : " + (DYNO.tq || 0).toFixed(1) + " Nm";
    const hpText  = "HP   : " + (DYNO.hp || 0).toFixed(1);

    const ignText = "IGN  : " + (DYNO.ign || 0).toFixed(1) + "°";
    const afrText = "AFR  : " + (isFinite(DYNO.afr) ? DYNO.afr.toFixed(2) : "14.70");

    // ✅ SLIP total (HANYA tampil di overlay, bukan di tabel/CSV)
    let slipText = "SLIP : --";
    if (isFinite(DYNO.slipPct)) {
      if (DYNO.slipPct > 500) slipText = "SLIP : OVER";
      else slipText = "SLIP : " + String(Math.round(DYNO.slipPct || 0)) + "%";
    }

    ctx.save();
    ctx.font = "900 12px Arial";
    const leftColW  = Math.max(ctx.measureText(rpmText).width, ctx.measureText(tqText).width, ctx.measureText(hpText).width);
    const rightColW = Math.max(ctx.measureText(ignText).width, ctx.measureText(afrText).width, ctx.measureText(slipText).width);
    const colGap = 22;
    const padL = 10, padR = 10;
    const boxW = Math.ceil(padL + leftColW + colGap + rightColW + padR);
    ctx.restore();

    const bx = x0 + pad;
    const by = y0 + pad;

    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.42)";
    ctx.strokeStyle = "rgba(255,255,255,0.10)";
    ctx.lineWidth = 1;
    roundRect(ctx, bx, by, boxW, boxH, 6, true, true);

    ctx.font = "900 12px Arial";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";

    const leftX  = bx + 10;
    const rightX = bx + 10 + leftColW + colGap;

    // ✅ jarak baris dirapatkan: 10 / 28 / 46
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.fillText(rpmText, leftX, by + 10);

    ctx.fillStyle = TQ_COLOR;
    ctx.fillText(tqText, leftX, by + 28);

    ctx.fillStyle = HP_COLOR;
    ctx.fillText(hpText, leftX, by + 46);

    ctx.fillStyle = IGN_COLOR;
    ctx.fillText(ignText, rightX, by + 10);

    ctx.fillStyle = AFR_COLOR;
    ctx.fillText(afrText, rightX, by + 28);

    // ✅ slip merah jika ada slip, abu jika tidak, OVER selalu merah
    ctx.fillStyle = (DYNO.slipPct > 500) ? SLIP_COLOR : (DYNO.slipOn ? SLIP_COLOR : "rgba(200,200,200,0.65)");
    ctx.fillText(slipText, rightX, by + 46);

    ctx.restore();
  }

  function roundRect(ctx, x, y, w, h, r, fill, stroke){
    const min = Math.min(w, h);
    if (r > min/2) r = min/2;

    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
    if (fill) ctx.fill();
    if (stroke) ctx.stroke();
  }

  // ==========================
  // ✅ CONNECTION BADGE (samping ARM)
  // ==========================
  function ensureConnBadgeEl(){
    if (document.getElementById("d_connBadge")) return;

    const armBtn = findArmButton();
    if (!armBtn) return;

    const badge = document.createElement("div");
    badge.id = "d_connBadge";
    badge.textContent = "OFF";
    badge.style.display = "inline-flex";
    badge.style.alignItems = "center";
    badge.style.justifyContent = "center";
    badge.style.height = "28px";
    badge.style.minWidth = "72px";
    badge.style.padding = "0 10px";
    badge.style.marginLeft = "8px";
    badge.style.borderRadius = "6px";
    badge.style.font = "900 12px Arial";
    badge.style.letterSpacing = "0.3px";
    badge.style.userSelect = "none";
    badge.style.whiteSpace = "nowrap";

    // default OFF
    badge.style.background = CONN_OFF_BG;
    badge.style.border = "1px solid " + CONN_OFF_BD;
    badge.style.color = CONN_OFF_TX;

    // insert setelah ARM button
    if (armBtn.nextSibling) armBtn.parentNode.insertBefore(badge, armBtn.nextSibling);
    else armBtn.parentNode.appendChild(badge);
  }

  function setConnBadge(ok, text){
    ensureConnBadgeEl();
    const el = document.getElementById("d_connBadge");
    if (!el) return;

    const t = (text && String(text).trim()) ? String(text).trim() : (ok ? "ON" : "OFF");
    el.textContent = t;

    if (ok){
      el.style.background = CONN_ON_BG;
      el.style.border = "1px solid " + CONN_ON_BD;
      el.style.color = CONN_ON_TX;
    } else {
      el.style.background = CONN_OFF_BG;
      el.style.border = "1px solid " + CONN_OFF_BD;
      el.style.color = CONN_OFF_TX;
    }
  }

  function findArmButton(){
    // 1) id umum
    let b = document.getElementById("btnArm") || document.getElementById("armBtn") || document.getElementById("d_armBtn");
    if (b) return b;

    // 2) onclick mengandung DYNO_arm
    b = document.querySelector('button[onclick*="DYNO_arm"]');
    if (b) return b;

    // 3) cari button teks "ARM"
    const all = Array.from(document.querySelectorAll("button"));
    for (const x of all){
      const tx = (x.textContent || "").trim().toUpperCase();
      if (tx === "ARM") return x;
    }
    return null;
  }

  // ==========================
  // UI HELPERS
  // ==========================
  function bindInputs(){
    const ids = ["d_targetM","d_circM","d_weightKg","d_pprFront","d_pprRear"];
    ids.forEach(id=>{
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener("input", () => {
        readInputs();
        updateInfoBox();
        DYNO_draw();
        updateStatusProgress();
      });
    });
    updateInfoBox();
  }

  function readInputs(){
    DYNO.targetM = clamp(Math.round(num("d_targetM", 200)), 10, 1000);
    DYNO.circM = num("d_circM", 1.85);
    DYNO.weightKg = clamp(Math.round(num("d_weightKg", 120)), 30, 400);
    DYNO.pprFront = Math.max(1, Math.round(num("d_pprFront", 1)));
    DYNO.pprRear  = Math.max(1, Math.round(num("d_pprRear", 1)));

    DYNO.rpmStart = FIXED_RPM_START;
    DYNO.rpmEnd   = FIXED_RPM_END;
  }

  function updateInfoBox(){
    setText("d_targetShow", String(DYNO.targetM));
    setText("d_circShow", DYNO.circM.toFixed(2));
    setText("d_weightShow", String(DYNO.weightKg));
    setText("d_pprFrontShow", String(DYNO.pprFront));
    setText("d_pprRearShow", String(DYNO.pprRear));
  }

  function DYNO_reset(clearTable){
    DYNO.t0 = 0;
    DYNO.t = 0;
    DYNO.distM = 0;
    DYNO.speedKmh = 0;

    DYNO.rpmStart = FIXED_RPM_START;
    DYNO.rpmEnd   = FIXED_RPM_END;

    DYNO.rpm = DYNO.rpmStart;
    DYNO.tq = 0;
    DYNO.hp = 0;
    DYNO.ign = 0;
    DYNO.afr = 14.7;

    // ✅ slip reset
    DYNO.slipPct = 0;
    DYNO.slipOn  = false;

    DYNO.maxHP = 0;
    DYNO.maxTQ = 0;

    DYNO.lastSeq = 0;

    if (clearTable){
      DYNO.rows = [];
      const tb = document.getElementById("d_tbody");
      if (tb) tb.innerHTML = "";
      setText("d_logInfo", "0 rows");
    }
    updateLiveUI();
    updateStatusProgress();
  }

  function updateLiveUI(){
    setText("d_time", DYNO.t.toFixed(2));
    setText("d_dist", DYNO.distM.toFixed(1));
    setText("d_speedLive", DYNO.speedKmh.toFixed(1));
    setText("d_rpmLive", String(Math.round(DYNO.rpm)));

    setText("d_tqLive", DYNO.tq.toFixed(1));
    setText("d_hpLive", DYNO.hp.toFixed(1));
    setText("d_ignLive", DYNO.ign.toFixed(1));
    setText("d_tqMax", DYNO.maxTQ.toFixed(1));
    setText("d_hpMax", DYNO.maxHP.toFixed(1));

    setText("d_logInfo", DYNO.rows.length + " rows");
  }

  function appendRowFast(r){
    const tb = document.getElementById("d_tbody");
    if (!tb) return;

    tb.appendChild(rowEl(r));

    while (tb.children.length > MAX_TABLE_ROWS) tb.removeChild(tb.firstChild);
    tb.parentElement.scrollTop = tb.parentElement.scrollHeight;
  }

  function rowEl(r){
    const tr = document.createElement("tr");

    const thCount = document.querySelectorAll("table thead th").length;

    if (thCount >= 7) {
      tr.innerHTML = `
        <td style="text-align:left">${r.t.toFixed(2)}</td>
        <td>${Math.round(r.rpm)}</td>
        <td>${r.tq.toFixed(1)}</td>
        <td>${r.hp.toFixed(1)}</td>
        <td>${r.ign.toFixed(1)}</td>
        <td>${(isFinite(r.afr) ? r.afr.toFixed(2) : "14.70")}</td>
        <td>${r.dist.toFixed(1)}</td>
      `;
    } else {
      tr.innerHTML = `
        <td style="text-align:left">${r.t.toFixed(2)}</td>
        <td>${Math.round(r.rpm)}</td>
        <td>${r.tq.toFixed(1)}</td>
        <td>${r.hp.toFixed(1)}</td>
        <td>${r.ign.toFixed(1)}</td>
        <td>${r.dist.toFixed(1)}</td>
      `;
    }

    return tr;
  }

  function updateState(s){ setText("d_state", s); }

  // ==========================
  // STATUS + PROGRESS
  // ==========================
  function setStatus(s){
    DYNO.statusBase = s;
    ensureStatusProgressEl();
    renderStatus();
  }

  function renderStatus(){
    const el = document.getElementById("d_status");
    if (!el) return;
    el.textContent = DYNO.statusBase;
    updateStatusProgress();
  }

  function ensureStatusProgressEl(){
    const status = document.getElementById("d_status");
    if (!status) return;

    const parent = status.parentElement;
    if (!parent) return;

    parent.style.position = parent.style.position || "relative";

    if (document.getElementById("d_statusProg")) return;

    const prog = document.createElement("div");
    prog.id = "d_statusProg";
    prog.style.position = "absolute";
    prog.style.left = "0";
    prog.style.right = "0";
    prog.style.top = "0";
    prog.style.bottom = "0";
    prog.style.borderRadius = "0";
    prog.style.overflow = "hidden";
    prog.style.background = "rgba(255,255,255,0.06)";
    prog.style.border = "1px solid rgba(255,255,255,0.10)";
    prog.style.pointerEvents = "none";
    prog.style.opacity = "0";
    prog.style.transition = "opacity 120ms linear";

    const bar = document.createElement("div");
    bar.id = "d_statusProgBar";
    bar.style.height = "100%";
    bar.style.width = "0%";
    bar.style.background = "rgba(46, 204, 113, 0.30)";
    bar.style.boxShadow = "0 0 22px rgba(46,204,113,0.45) inset";
    bar.style.transformOrigin = "left center";
    bar.style.position = "relative";

    const shine = document.createElement("div");
    shine.id = "d_statusProgShine";
    shine.style.position = "absolute";
    shine.style.top = "0";
    shine.style.bottom = "0";
    shine.style.width = "35%";
    shine.style.left = "-45%";
    shine.style.background = "linear-gradient(90deg, rgba(255,255,255,0), rgba(255,255,255,0.35), rgba(255,255,255,0))";
    shine.style.opacity = "0.85";

    bar.appendChild(shine);
    prog.appendChild(bar);
    parent.appendChild(prog);

    status.style.position = "relative";
    status.style.zIndex = "2";

    if (!document.getElementById("dynoStatusKeyframes")){
      const st = document.createElement("style");
      st.id = "dynoStatusKeyframes";
      st.textContent = `
        @keyframes dynoShineMove {
          0%   { left:-45%; }
          100% { left:105%; }
        }
      `;
      document.head.appendChild(st);
    }
  }

  function startStatusAnim(){
    if (DYNO.statusTimer) clearInterval(DYNO.statusTimer);
    DYNO.statusTimer = setInterval(() => updateStatusProgress(), 80);
    updateStatusProgress();
  }

  function stopStatusAnim(){
    if (DYNO.statusTimer){
      clearInterval(DYNO.statusTimer);
      DYNO.statusTimer = null;
    }
    updateStatusProgress(true);
  }

  function updateStatusProgress(forceStop){
    const prog = document.getElementById("d_statusProg");
    const bar  = document.getElementById("d_statusProgBar");
    const shine= document.getElementById("d_statusProgShine");
    if (!prog || !bar || !shine) return;

    if (DYNO.running && !forceStop){
      prog.style.opacity = "1";
      const p = clamp(DYNO.distM / Math.max(1, DYNO.targetM), 0, 1);
      bar.style.width = (p * 100).toFixed(1) + "%";
      shine.style.animation = "dynoShineMove 0.85s linear infinite";
    } else {
      shine.style.animation = "none";
      if (!DYNO.rows.length && !DYNO.armed) bar.style.width = "0%";
      prog.style.opacity = "0";
    }
  }

  // ==========================
  // DOM HELPERS
  // ==========================
  function setText(id, t){
    const el = document.getElementById(id);
    if (el) el.textContent = t;
  }

  function num(id, def){
    const el = document.getElementById(id);
    if (!el) return def;
    const v = parseFloat(el.value);
    return isFinite(v) ? v : def;
  }

  function clamp(v,a,b){ return Math.max(a, Math.min(b, v)); }
  function roundUp(v, step){ return Math.ceil(v/step)*step; }

})();
