/* =========================================================
   dyno-road.js — UI (VERSI KAMU) + FRONT ONLY + NO IGN/AFR
   - Cocok dengan A3 firmware: /status /snapshot /config /run /stop /reset
   - Log table: No, time(s), rpm, hp, tq, speed, dist
========================================================= */

console.log("✅ dyno-road.js dimuat (RPM + HP + TQ) — NO IGN/AFR");

(function(){
  const UI_POLL_MS = 16;
  const SNAP_POLL_MS = 50;

  const MAX_TABLE_ROWS = 800;

  // ===== state =====
  const DYNO = {
    armed:false,
    running:false,
    gate_wait:false,
    gate_pulses:1,

    targetM:200,
    circM:1.85,
    weightKg:120,
    pprFront:1,

    t0:0,
    t:0,
    distM:0,
    speedKmh:0,
    rpm:0,
    tq:0,
    hp:0,

    maxHP:0,
    maxTQ:0,

    rows:[],
    statusText:"READY",
    lastSnapTs:0,

    // untuk smoothing / status
    _lastUI:0,
    _lastSnap:0,
    _connected:false,
    _connLastMs:0
  };

  // ===== helpers DOM =====
  const $ = (id)=>document.getElementById(id);

  function setText(id, v){
    const el = $(id);
    if (!el) return;
    el.textContent = v;
  }

  function setStatus(text){
    DYNO.statusText = text || "READY";
    setText("d_status", DYNO.statusText);
    setText("d_state", DYNO.statusText);
  }

  function numInput(id, def){
    const el = $(id);
    if (!el) return def;
    const v = parseFloat(el.value);
    return Number.isFinite(v) ? v : def;
  }

  function clamp(v,a,b){ return Math.max(a, Math.min(b,v)); }

  // ===== read inputs =====
  function readInputs(){
    DYNO.targetM  = clamp(Math.round(numInput("d_targetM", DYNO.targetM)), 10, 5000);
    DYNO.circM    = clamp(numInput("d_circM", DYNO.circM), 0.20, 10.0);
    DYNO.weightKg = clamp(Math.round(numInput("d_weightKg", DYNO.weightKg)), 30, 500);
    DYNO.pprFront = clamp(Math.round(numInput("d_pprFront", DYNO.pprFront)), 1, 2000);

    setText("d_targetShow", String(DYNO.targetM));
    setText("d_circShow",   DYNO.circM.toFixed(2));
    setText("d_weightShow", String(DYNO.weightKg));
    setText("d_pprFrontShow", String(DYNO.pprFront));
  }

  // ===== log table =====
  const tbody = $("d_tbody");

  function rowEl(r){
    const tr = document.createElement("tr");

    // Kolom sesuai HTML: No | time(s) | rpm | hp | tq | speed | dist
    const no = (typeof r.no === "number") ? r.no : 0;
    const t  = (r.t || 0);
    const rpm = (r.rpm || 0);
    const hp  = (r.hp || 0);
    const tq  = (r.tq || 0);
    const spd = (r.speed || 0);
    const dist= (r.dist || 0);

    tr.innerHTML = `
      <td style="text-align:left">${no}</td>
      <td style="text-align:left">${t.toFixed(2)}</td>
      <td>${Math.round(rpm)}</td>
      <td>${hp.toFixed(1)}</td>
      <td>${tq.toFixed(1)}</td>
      <td>${spd.toFixed(1)}</td>
      <td>${dist.toFixed(1)}</td>
    `;
    return tr;
  }

  function appendRowFast(r){
    if (!tbody) return;
    tbody.appendChild(rowEl(r));

    // trim
    while (DYNO.rows.length > MAX_TABLE_ROWS){
      DYNO.rows.shift();
      if (tbody.firstChild) tbody.removeChild(tbody.firstChild);
      // renumber (optional) biar rapi
      for (let i=0;i<DYNO.rows.length;i++){
        DYNO.rows[i].no = i+1;
      }
      // rebuild cepat kalau sudah keburu banyak
      if (DYNO.rows.length < 50) break;
    }

    setText("d_logInfo", DYNO.rows.length + " rows");
  }

  function clearLog(){
    DYNO.rows = [];
    if (tbody) tbody.innerHTML = "";
    setText("d_logInfo","0 rows");
  }

  // ===== CSV =====
  window.DYNO_saveCSV = function(){
    if (!DYNO.rows.length){
      setStatus("LOG KOSONG");
      setTimeout(()=>setStatus(DYNO.running ? "RUNNING":"READY"), 800);
      return;
    }

    const header = ["no","time_s","rpm","hp","tq","speed_kmh","dist_m"];
    const lines = [header.join(",")];

    for (const r of DYNO.rows){
      const row = [
        (r.no||0),
        (r.t||0).toFixed(3),
        Math.round(r.rpm||0),
        (r.hp||0).toFixed(2),
        (r.tq||0).toFixed(2),
        (r.speed||0).toFixed(2),
        (r.dist||0).toFixed(3)
      ];
      lines.push(row.join(","));
    }

    const blob = new Blob([lines.join("\n")], {type:"text/csv;charset=utf-8"});
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "dyno_log.csv";
    document.body.appendChild(a);
    a.click();
    setTimeout(()=>{
      URL.revokeObjectURL(a.href);
      document.body.removeChild(a);
    }, 0);
  };

  // ===== run/stop =====
  async function sendConfigToESP(){
    readInputs();
    if (typeof window.DYNO_setConfig_DUAL === "function"){
      await window.DYNO_setConfig_DUAL({
        targetM: DYNO.targetM,
        circM:   DYNO.circM,
        pprFront:DYNO.pprFront,
        weightKg:DYNO.weightKg
      });
    }
  }

  window.DYNO_run = async function(){
    try{
      await sendConfigToESP();
      if (typeof window.DYNO_run_DUAL === "function"){
        await window.DYNO_run_DUAL();
      }
      clearLog();
      DYNO.maxHP = 0; DYNO.maxTQ = 0;
      DYNO.t = 0; DYNO.distM=0; DYNO.speedKmh=0; DYNO.hp=0; DYNO.tq=0;
      setStatus("RUN: siap start, tunggu 1 putaran roda depan (gate firmware)...");
    }catch(e){
      setStatus("RUN ERROR");
      console.error(e);
    }
  };

  window.DYNO_stop = async function(){
    try{
      if (typeof window.DYNO_stop_DUAL === "function"){
        await window.DYNO_stop_DUAL();
      }
      setStatus("STOP");
    }catch(e){
      setStatus("STOP ERROR");
      console.error(e);
    }
  };

  // ===== snapshot apply =====
  function applySnapshot(snap){
    if (!snap) return;

    // connected marker
    DYNO._connected = true;
    DYNO._connLastMs = Date.now();

    DYNO.armed     = !!snap.armed;
    DYNO.running   = !!snap.running;
    DYNO.gate_wait = !!snap.gate_wait;
    DYNO.gate_pulses = snap.gate_pulses || snap.gatePulses || 1;

    DYNO.t       = (snap.t_s!=null) ? snap.t_s : (snap.t!=null ? snap.t : DYNO.t);
    DYNO.distM   = (snap.dist_m!=null) ? snap.dist_m : (snap.distM!=null ? snap.distM : DYNO.distM);
    DYNO.speedKmh= (snap.speed_kmh!=null) ? snap.speed_kmh : (snap.speedKmh!=null ? snap.speedKmh : DYNO.speedKmh);

    DYNO.rpm     = (snap.rpm!=null) ? snap.rpm : DYNO.rpm;
    DYNO.hp      = (snap.hp!=null) ? snap.hp : DYNO.hp;
    DYNO.tq      = (snap.tq!=null) ? snap.tq : DYNO.tq;

    DYNO.maxHP   = (snap.maxHP!=null) ? snap.maxHP : DYNO.maxHP;
    DYNO.maxTQ   = (snap.maxTQ!=null) ? snap.maxTQ : DYNO.maxTQ;

    if (typeof snap.statusText === "string") DYNO.statusText = snap.statusText;

    // status text dari firmware
    if (DYNO.statusText){
      setStatus(DYNO.statusText);
    } else {
      setStatus(DYNO.running ? "RUNNING" : "READY");
    }

    // auto log saat RUNNING (dan gate sudah lewat)
    if (DYNO.running && !DYNO.gate_wait){
      // supaya tidak spam log kalau speed=0 terus
      const shouldLog = (DYNO.speedKmh > 0.01) || (DYNO.distM > 0.01) || (DYNO.t > 0.05);

      if (shouldLog){
        // log tiap naik dist sedikit / waktu
        const last = DYNO.rows.length ? DYNO.rows[DYNO.rows.length-1] : null;
        const okGap = !last || (DYNO.distM - last.dist) >= 0.10 || (DYNO.t - last.t) >= 0.05;

        if (okGap){
          const r = {
            no: DYNO.rows.length + 1,
            t: DYNO.t,
            rpm: DYNO.rpm,
            hp: DYNO.hp,
            tq: DYNO.tq,
            speed: DYNO.speedKmh,
            dist: DYNO.distM
          };
          DYNO.rows.push(r);

          if (DYNO.hp > DYNO.maxHP) DYNO.maxHP = DYNO.hp;
          if (DYNO.tq > DYNO.maxTQ) DYNO.maxTQ = DYNO.tq;

          appendRowFast(r);
        }
      }
    }
  }

  // ===== UI update =====
  function updateLiveUI(){
    setText("d_time", DYNO.t.toFixed(2));
    setText("d_dist", DYNO.distM.toFixed(1));
    setText("d_speedLive", DYNO.speedKmh.toFixed(1));
    setText("d_rpmLive", String(Math.round(DYNO.rpm)));

    setText("d_hpLive", DYNO.hp.toFixed(1));
    setText("d_tqLive", DYNO.tq.toFixed(1));

    setText("d_hpMax", DYNO.maxHP.toFixed(1));
    setText("d_tqMax", DYNO.maxTQ.toFixed(1));
  }

  // ===== CANVAS GRAPH (HP/TQ) =====
  const canvas = $("dynoCanvas");
  const ctx = canvas ? canvas.getContext("2d") : null;

  function resizeCanvas(){
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width  = Math.max(10, Math.floor(rect.width  * dpr));
    canvas.height = Math.max(10, Math.floor(rect.height * dpr));
    if (ctx) ctx.setTransform(dpr,0,0,dpr,0,0);
  }

  function drawGrid(w,h){
    if (!ctx) return;
    ctx.clearRect(0,0,w,h);

    // background
    ctx.fillStyle = "rgba(0,0,0,0.18)";
    ctx.fillRect(0,0,w,h);

    // grid
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.lineWidth = 1;

    const gx = 10, gy = 8;
    for (let i=0;i<=gx;i++){
      const x = (w/gx)*i;
      ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,h); ctx.stroke();
    }
    for (let j=0;j<=gy;j++){
      const y = (h/gy)*j;
      ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(w,y); ctx.stroke();
    }

    // labels
    ctx.fillStyle = "rgba(255,255,255,0.65)";
    ctx.font = "12px system-ui, -apple-system, Segoe UI, Roboto, Arial";
    ctx.fillText("HP", 10, 16);
    ctx.fillText("TQ", 10, 32);

    ctx.textAlign = "right";
    ctx.fillText("RPM", w-10, h-10);
    ctx.textAlign = "left";
  }

  function mapX(rpm, w){
    const r0 = 2000, r1 = 20000;
    const t = (rpm - r0) / (r1 - r0);
    return clamp(t,0,1) * (w-20) + 10;
  }

  function mapY(v, vmax, h){
    const t = (v / vmax);
    return (1 - clamp(t,0,1)) * (h-20) + 10;
  }

  function drawCurve(rows, key, vmax, w, h, strokeStyle){
    if (!ctx || rows.length < 2) return;
    ctx.strokeStyle = strokeStyle;
    ctx.lineWidth = 2;
    ctx.beginPath();
    let started=false;

    for (const r of rows){
      const x = mapX(r.rpm||0, w);
      const y = mapY(r[key]||0, vmax, h);
      if (!started){ ctx.moveTo(x,y); started=true; }
      else ctx.lineTo(x,y);
    }
    ctx.stroke();
  }

  function drawOverlay(w,h){
    if (!ctx) return;

    // box info di dalam grafik (seperti UI kamu)
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.fillRect(22, 18, 220, 86);

    ctx.fillStyle = "rgba(255,255,255,0.90)";
    ctx.font = "12px system-ui, -apple-system, Segoe UI, Roboto, Arial";

    const rpm = Math.round(DYNO.rpm||0);
    const spd = (DYNO.speedKmh||0).toFixed(1);
    const dist = (DYNO.distM||0).toFixed(1);
    const t = (DYNO.t||0).toFixed(2);
    const tq = (DYNO.tq||0).toFixed(1);
    const hp = (DYNO.hp||0).toFixed(1);

    ctx.fillText(`RPM : ${rpm}`, 32, 38);
    ctx.fillText(`SPD : ${spd} km/h`, 32, 56);
    ctx.fillText(`DIST : ${dist} m`, 32, 74);
    ctx.fillText(`TIME : ${t} s`, 32, 92);

    // TQ/HP warna seperti UI kamu
    ctx.fillStyle = "rgba(0,255,120,0.90)";
    ctx.fillText(`TQ  : ${tq} Nm`, 32, 110);

    ctx.fillStyle = "rgba(80,190,255,0.95)";
    ctx.fillText(`HP  : ${hp}`, 32, 128);

    // center note
    ctx.fillStyle = "rgba(255,255,255,0.60)";
    ctx.font = "14px system-ui, -apple-system, Segoe UI, Roboto, Arial";
    ctx.textAlign = "center";

    if (!DYNO.running){
      ctx.fillText("RUN untuk mulai.", w/2, h/2);
    } else if (DYNO.gate_wait){
      ctx.fillText("RUN: tunggu gate 1 putaran roda depan...", w/2, h/2);
    }
    ctx.textAlign = "left";
  }

  function DYNO_redraw(){
    if (!canvas || !ctx) return;
    resizeCanvas();

    const w = canvas.clientWidth;
    const h = canvas.clientHeight;

    drawGrid(w,h);

    // cari max skala biar enak (pakai max dari data / max realtime)
    let vmax = 1;
    for (const r of DYNO.rows){
      vmax = Math.max(vmax, r.hp||0, r.tq||0);
    }
    vmax = Math.max(vmax, DYNO.maxHP||0, DYNO.maxTQ||0, DYNO.hp||0, DYNO.tq||0);
    vmax = Math.max(5, vmax * 1.15);

    // HP curve (biru) & TQ curve (hijau)
    drawCurve(DYNO.rows, "hp", vmax, w, h, "rgba(80,190,255,0.95)");
    drawCurve(DYNO.rows, "tq", vmax, w, h, "rgba(0,255,120,0.90)");

    drawOverlay(w,h);
  }

  // expose for zoom dock
  window.DYNO_redraw = DYNO_redraw;

  // ===== polling snapshot =====
  async function pollSnapshot(){
    const now = Date.now();

    // detect disconnect jika lama tidak ada snapshot
    if (DYNO._connected && (now - DYNO._connLastMs) > 1800){
      DYNO._connected = false;
      setStatus("OFFLINE");
    }

    if (typeof window.DYNO_getSnapshot_DUAL !== "function"){
      DYNO._connected = false;
      return;
    }

    try{
      const snap = await window.DYNO_getSnapshot_DUAL();
      applySnapshot(snap);
    }catch(e){
      DYNO._connected = false;
      // jangan spam
    }
  }

  // ===== init =====
  function init(){
    readInputs();
    setStatus("READY");
    updateLiveUI();
    DYNO_redraw();

    // input listeners
    ["d_targetM","d_circM","d_weightKg","d_pprFront"].forEach(id=>{
      const el = $(id);
      if (!el) return;
      el.addEventListener("change", ()=>{
        readInputs();
        sendConfigToESP().catch(()=>{});
      });
    });

    // loop UI
    setInterval(()=>{
      updateLiveUI();
      DYNO_redraw();
    }, UI_POLL_MS);

    // loop snapshot
    setInterval(()=>{
      pollSnapshot();
    }, SNAP_POLL_MS);

    window.addEventListener("resize", ()=>{
      DYNO_redraw();
    });
  }

  document.addEventListener("DOMContentLoaded", init);

})();
