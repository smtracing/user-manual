console.log("✅ dyno-road.js dimuat (RUN=ARM+RUN, 1 PPR SAJA, TANPA SLIP/AFR/IGN)");

(function(){
  const UI_POLL_MS = 16;
  const FIXED_RPM_START = 2000;
  const FIXED_RPM_END   = 20000;
  const MAX_TABLE_ROWS  = 800;

  // colors
  const TQ_COLOR = "rgb(0,255,102)";
  const HP_COLOR = "rgb(52,152,219)";

  const DYNO = {
    // state
    running:false,
    armed:false, // dipertahankan supaya UI lama tidak bingung, tapi ARM button tidak dipakai lagi

    // config (from UI)
    targetM:200,
    circM:1.85,
    weightKg:120,
    pprFront:1,

    rpmStart: FIXED_RPM_START,
    rpmEnd:   FIXED_RPM_END,

    // live computed/from firmware
    t:0,
    distM:0,
    speedKmh:0,
    rpm:0,
    tq:0,
    hp:0,

    maxHP:0,
    maxTQ:0,

    rows:[],
    timer:null,
    polling:false,

    // gate info (from firmware)
    gateWait:false,
    gatePulses:1,

    // canvas
    c:null, ctx:null, W:0,H:0,

    // status
    statusBase:"READY",
    statusTimer:null
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

    DYNO_draw();
  };

  // ARM DIHAPUS: kalau UI lama masih memanggil, arahkan ke RUN
  window.DYNO_arm = async function(){
    await window.DYNO_run();
  };

  window.DYNO_run = async function(){
    if (DYNO.running) return;

    // baca input terbaru
    readInputs();

    // HAPUS DATA LAMA DI WEB
    DYNO_reset(true);

    // anggap armed (kompatibilitas UI lama)
    DYNO.armed = true;
    DYNO.running = true;

    updateState("RUN");
    ensureStatusProgressEl();
    setStatus("RUN: siap start, tunggu 1 putaran roda depan (gate firmware)...");

    startStatusAnim();

    // kirim config ke ESP + jalankan (firmware yang tentukan start setelah 1 putaran)
    if (typeof window.DYNO_setConfig_DUAL === "function") {
      try{
        await window.DYNO_setConfig_DUAL({
          targetM: DYNO.targetM,
          circM: DYNO.circM,
          pprFront: DYNO.pprFront,
          weightKg: DYNO.weightKg,
          rpmStart: DYNO.rpmStart,
          rpmEnd: DYNO.rpmEnd
        });
      }catch(e){}
    }

    // supaya firmware lama yang masih butuh /arm tetap aman:
    if (typeof window.DYNO_arm_DUAL === "function") {
      try{
        await window.DYNO_arm_DUAL({
          targetM: DYNO.targetM,
          circM: DYNO.circM,
          pprFront: DYNO.pprFront,
          weightKg: DYNO.weightKg,
          rpmStart: DYNO.rpmStart,
          rpmEnd: DYNO.rpmEnd
        });
      }catch(e){}
    }

    if (typeof window.DYNO_run_DUAL === "function") {
      try{ await window.DYNO_run_DUAL(); }catch(e){}
    }

    // start polling snapshot
    if (DYNO.timer) clearInterval(DYNO.timer);
    DYNO.timer = setInterval(() => {
      pollFromESP(false);
    }, UI_POLL_MS);

    // ambil snapshot pertama biar UI langsung hidup
    await pollFromESP(true);

    updateStatusProgress();
    DYNO_draw();
  };

  window.DYNO_stop = async function(){
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
      try{ await window.DYNO_stop_DUAL("STOP"); }catch(e){}
    }
  };

  window.DYNO_saveCSV = function(){
    if (!DYNO.rows.length){
      setStatus("DATA KOSONG. RUN dulu.");
      return;
    }

    // TANPA AFR/IGN/SLIP/PPR REAR
    const head = ["t_s","rpm","tq_Nm","hp","dist_m","speed_kmh"];
    const lines = [head.join(",")];

    for (const r of DYNO.rows){
      lines.push([
        (r.t||0).toFixed(3),
        Math.round(r.rpm||0),
        (r.tq||0).toFixed(2),
        (r.hp||0).toFixed(2),
        (r.dist||0).toFixed(2),
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
  // POLL DATA (FROM FIRMWARE)
  // ==========================
  async function pollFromESP(forceOnce){
    if (DYNO.polling && !forceOnce) return;
    DYNO.polling = true;

    try {
      if (typeof window.DYNO_getSnapshot_DUAL !== "function") return;

      const snap = await window.DYNO_getSnapshot_DUAL();
      if (!snap) return;

      // ambil dari firmware (yang akurat)
      const t_s     = Number(snap.t_s ?? snap.t ?? 0) || 0;
      const dist_m  = Number(snap.dist_m ?? snap.distM ?? 0) || 0;
      const spd_kmh = Number(snap.speed_kmh ?? snap.speedKmh ?? 0) || 0;

      const rpm     = Number(snap.rpm ?? 0) || 0;
      const hp      = Number(snap.hp ?? snap.power ?? 0) || 0;
      const tq      = Number(snap.tq ?? snap.torque ?? 0) || 0;

      const gateWait   = !!(snap.gate_wait ?? snap.gateWait);
      const gatePulses = Number(snap.gate_pulses ?? snap.gatePulses ?? 1) || 1;

      DYNO.rpm = rpm;
      DYNO.t   = Math.max(0, t_s);
      DYNO.distM = Math.max(0, dist_m);
      DYNO.speedKmh = Math.max(0, spd_kmh);

      DYNO.hp  = isFinite(hp) ? hp : 0;
      DYNO.tq  = isFinite(tq) ? tq : 0;

      DYNO.gateWait   = gateWait;
      DYNO.gatePulses = Math.max(1, gatePulses|0);

      // status gate
      if (DYNO.running && DYNO.gateWait){
        updateState("RUN (WAIT GATE)");
        setStatus("RUN: tunggu 1 putaran roda depan (" + DYNO.gatePulses + " pulsa)...");
      } else if (DYNO.running) {
        updateState("RUNNING");
      }

      // max tracking
      DYNO.maxHP = Math.max(DYNO.maxHP || 0, DYNO.hp || 0);
      DYNO.maxTQ = Math.max(DYNO.maxTQ || 0, DYNO.tq || 0);

      // log row hanya kalau sudah lewat gate (dist/time sudah jalan)
      if (DYNO.running && !DYNO.gateWait){
        const row = {
          t: DYNO.t,
          rpm: DYNO.rpm,
          tq: DYNO.tq,
          hp: DYNO.hp,
          dist: DYNO.distM,
          spd: DYNO.speedKmh
        };
        DYNO.rows.push(row);
        appendRowFast(row);

        // auto stop saat target tercapai (firmware biasanya sudah stop, tapi web juga aman)
        if (DYNO.distM >= Math.max(1, DYNO.targetM)) {
          setStatus("AUTO STOP: target tercapai (" + DYNO.targetM + " m)");
          window.DYNO_stop();
        }
      }

      updateLiveUI();
      updateStatusProgress();
      DYNO_draw();

    } catch (e) {
      // ignore
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
  // DRAW GRAPH (HP + TQ + RPM)
  // ==========================
  function DYNO_draw(){
    if (!DYNO.ctx) return;

    const ctx = DYNO.ctx;
    const W = DYNO.W, H = DYNO.H;
    ctx.clearRect(0,0,W,H);

    const PAD_L = 97;
    const PAD_R = 30;   // kanan dipersempit karena IGN/AFR dihapus
    const PAD_T = 14;
    const PAD_B = 42;

    const plotW = W - PAD_L - PAD_R;
    const plotH = H - PAD_T - PAD_B;

    const rMin = DYNO.rpmStart;
    const rMax = DYNO.rpmEnd;

    const dMin = 0;
    const dMax = Math.max(1, DYNO.targetM);

    const yMaxPower = niceMax(Math.max(1, DYNO.maxHP || 0, DYNO.maxTQ || 0, 1));

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
      ctx.lineTo(W - PAD_R, y);
      ctx.stroke();

      const v = (k/5)*yMaxPower;
      ctx.fillStyle = "rgba(210,218,235,0.85)";
      ctx.fillText(v.toFixed(0), PAD_L - 25, y);
    }

    // ===== RPM ticks =====
    const stepYRPM = 500;
    for (let rpm = roundUp(rMin, stepYRPM); rpm <= rMax; rpm += stepYRPM){
      const y = PAD_T + plotH - ((rpm - rMin) / Math.max(1,(rMax - rMin))) * plotH;

      ctx.strokeStyle = (rpm % 1000 === 0) ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.06)";
      ctx.beginPath();
      ctx.moveTo(PAD_L, y);
      ctx.lineTo(W - PAD_R, y);
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

    // info text when waiting gate
    if (DYNO.running && DYNO.gateWait){
      drawInfoText(ctx, W, H, "WAIT: " + DYNO.gatePulses + " pulsa (1 putaran) ...");
      drawOverlayInsideGraph(ctx, PAD_L, PAD_T, plotW, plotH);
      return;
    }

    if (DYNO.rows.length < 2) {
      drawInfoText(ctx, W, H, "RUN untuk mulai.");
      drawOverlayInsideGraph(ctx, PAD_L, PAD_T, plotW, plotH);
      return;
    }

    const series = buildSeriesByDist(DYNO.rows, dMin, dMax, rMin, rMax);

    // TQ
    drawCurveDist(series, p=>p.tq,  TQ_COLOR, yMaxPower, PAD_L, PAD_T, plotW, plotH, dMin, dMax);

    // HP
    drawCurveDist(series, p=>p.hp,  HP_COLOR, yMaxPower, PAD_L, PAD_T, plotW, plotH, dMin, dMax);

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

      if (!isFinite(dist) || !isFinite(rpm)) continue;
      if (!isFinite(hp)) hp = 0;
      if (!isFinite(tq)) tq = 0;

      dist = clamp(dist, dMin, dMax);
      rpm  = clamp(rpm,  rMin, rMax);

      if (dist + 1e-6 < lastDist) continue;

      if (out.length && Math.abs(dist - lastDist) < 0.05){
        out[out.length - 1].rpm = rpm;
        out[out.length - 1].hp  = hp;
        out[out.length - 1].tq  = tq;
        continue;
      }

      out.push({ dist, rpm, hp, tq });
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
  // OVERLAY BOX (NO AFR/IGN/SLIP)
  // ==========================
  function drawOverlayInsideGraph(ctx, x0, y0, w, h){
    const pad = 10;
    const boxH = 72;

    const rpmText = "RPM  : " + String(Math.round(DYNO.rpm || 0));
    const tqText  = "TQ   : " + (DYNO.tq || 0).toFixed(1) + " Nm";
    const hpText  = "HP   : " + (DYNO.hp || 0).toFixed(1);

    const spdText = "SPD  : " + (DYNO.speedKmh || 0).toFixed(1) + " km/h";
    const dstText = "DIST : " + (DYNO.distM || 0).toFixed(1) + " m";
    const timText = "TIME : " + (DYNO.t || 0).toFixed(2) + " s";

    ctx.save();
    ctx.font = "900 12px Arial";
    const leftColW  = Math.max(ctx.measureText(rpmText).width, ctx.measureText(tqText).width, ctx.measureText(hpText).width);
    const rightColW = Math.max(ctx.measureText(spdText).width, ctx.measureText(dstText).width, ctx.measureText(timText).width);
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

    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.fillText(rpmText, leftX, by + 10);

    ctx.fillStyle = TQ_COLOR;
    ctx.fillText(tqText, leftX, by + 28);

    ctx.fillStyle = HP_COLOR;
    ctx.fillText(hpText, leftX, by + 46);

    ctx.fillStyle = "rgba(200,200,200,0.85)";
    ctx.fillText(spdText, rightX, by + 10);
    ctx.fillText(dstText, rightX, by + 28);
    ctx.fillText(timText, rightX, by + 46);

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
  // UI HELPERS
  // ==========================
  function bindInputs(){
    // PPR REAR DIHAPUS
    const ids = ["d_targetM","d_circM","d_weightKg","d_pprFront"];
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
    DYNO.targetM  = clamp(Math.round(num("d_targetM", 200)), 10, 5000);
    DYNO.circM    = num("d_circM", 1.85);
    DYNO.weightKg = clamp(Math.round(num("d_weightKg", 120)), 30, 500);
    DYNO.pprFront = Math.max(1, Math.round(num("d_pprFront", 1)));

    DYNO.rpmStart = FIXED_RPM_START;
    DYNO.rpmEnd   = FIXED_RPM_END;
  }

  function updateInfoBox(){
    setText("d_targetShow", String(DYNO.targetM));
    setText("d_circShow", DYNO.circM.toFixed(2));
    setText("d_weightShow", String(DYNO.weightKg));
    setText("d_pprFrontShow", String(DYNO.pprFront));

    // kalau UI lama masih punya elemen ini, biarin aman:
    // (jangan error, tapi juga jangan dipakai)
    // d_pprRearShow tidak disentuh.
  }

  function DYNO_reset(clearTable){
    DYNO.t = 0;
    DYNO.distM = 0;
    DYNO.speedKmh = 0;

    DYNO.rpmStart = FIXED_RPM_START;
    DYNO.rpmEnd   = FIXED_RPM_END;

    DYNO.rpm = DYNO.rpmStart;
    DYNO.tq = 0;
    DYNO.hp = 0;

    DYNO.maxHP = 0;
    DYNO.maxTQ = 0;

    DYNO.gateWait = false;
    DYNO.gatePulses = Math.max(1, DYNO.pprFront|0);

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
    setText("d_tqMax", DYNO.maxTQ.toFixed(1));
    setText("d_hpMax", DYNO.maxHP.toFixed(1));

    setText("d_logInfo", DYNO.rows.length + " rows");
  }

  function appendRowFast(r){
    const tb = document.getElementById("d_tbody");
    if (!tb) return;

    tb.appendChild(rowEl(r));

    while (tb.children.length > MAX_TABLE_ROWS) tb.removeChild(tb.firstChild);
    if (tb.parentElement) tb.parentElement.scrollTop = tb.parentElement.scrollHeight;
  }

  function rowEl(r){
    const tr = document.createElement("tr");

    // table dibuat mengikuti jumlah th di HTML (biar UI kamu tidak ancur)
    const thCount = document.querySelectorAll("table thead th").length;

    // ideal kolom baru: time,rpm,tq,hp,dist
    // tapi kalau HTML masih punya th ekstra (IGN/AFR/SLIP), kita isi kosong supaya layout tidak geser
    if (thCount >= 7) {
      // buat 7 kolom minimal: TIME RPM TQ HP (kosong) (kosong) DIST
      tr.innerHTML = `
        <td style="text-align:left">${(r.t||0).toFixed(2)}</td>
        <td>${Math.round(r.rpm||0)}</td>
        <td>${(r.tq||0).toFixed(1)}</td>
        <td>${(r.hp||0).toFixed(1)}</td>
        <td></td>
        <td></td>
        <td>${(r.dist||0).toFixed(1)}</td>
      `;
    } else if (thCount === 6) {
      // TIME RPM TQ HP (kosong) DIST
      tr.innerHTML = `
        <td style="text-align:left">${(r.t||0).toFixed(2)}</td>
        <td>${Math.round(r.rpm||0)}</td>
        <td>${(r.tq||0).toFixed(1)}</td>
        <td>${(r.hp||0).toFixed(1)}</td>
        <td></td>
        <td>${(r.dist||0).toFixed(1)}</td>
      `;
    } else {
      // fallback: TIME RPM TQ HP DIST
      tr.innerHTML = `
        <td style="text-align:left">${(r.t||0).toFixed(2)}</td>
        <td>${Math.round(r.rpm||0)}</td>
        <td>${(r.tq||0).toFixed(1)}</td>
        <td>${(r.hp||0).toFixed(1)}</td>
        <td>${(r.dist||0).toFixed(1)}</td>
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

    // progress jalan saat running DAN gate sudah lewat
    if (DYNO.running && !DYNO.gateWait && !forceStop){
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
