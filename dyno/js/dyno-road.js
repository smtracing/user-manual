/* =========================================================
   dyno-road.js — UI + GRAPH + CONNECT STATUS (DUAL)
   - Ambil data dari esp-api-dual.js (DYNO_*_DUAL)
   - Kotak status koneksi (#d_connBox) diupdate dari sini
   - Tidak perlu CSS tambahan (kotak sudah inline di HTML)
========================================================= */

console.log("✅ dyno-road.js dimuat (UI + CONNECT STATUS)");

(function(){
  const UI_POLL_MS = 120;      // polling snapshot
  const CONN_POLL_MS = 400;    // polling koneksi
  const CANVAS_FPS_MS = 80;    // redraw grafis (lebih ringan di HP)

  // ===== DOM =====
  const $ = (id) => document.getElementById(id);

  const el = {
    // inputs
    targetM: $("d_targetM"),
    circM: $("d_circM"),
    weightKg: $("d_weightKg"),
    pprFront: $("d_pprFront"),
    pprRear: $("d_pprRear"),

    // status top
    statusText: $("d_status"),

    // live
    state: $("d_state"),
    time: $("d_time"),
    dist: $("d_dist"),
    speed: $("d_speedLive"),
    rpm: $("d_rpmLive"),

    // power
    tq: $("d_tqLive"),
    hp: $("d_hpLive"),
    ign: $("d_ignLive"),
    tqMax: $("d_tqMax"),
    hpMax: $("d_hpMax"),

    // info
    targetShow: $("d_targetShow"),
    circShow: $("d_circShow"),
    weightShow: $("d_weightShow"),
    pprFrontShow: $("d_pprFrontShow"),
    pprRearShow: $("d_pprRearShow"),
    logInfo: $("d_logInfo"),

    // log table
    tbody: $("d_tbody"),

    // canvas
    canvas: $("dynoCanvas"),

    // connect box
    connBox: $("d_connBox"),
  };

  // statusbar container (buat progress)
  const statusBar = document.querySelector(".statusbar");

  // ===== runtime =====
  let _uiTimer = null;
  let _connTimer = null;
  let _drawTimer = null;

  let lastSeq = 0;
  let rows = [];     // cache rows utk gambar + tabel

  // canvas ctx
  let ctx = null;
  let cw = 0, ch = 0;

  // ===== helpers =====
  function clamp(v,a,b){ return Math.max(a, Math.min(b, v)); }
  function n2(v){ return (isFinite(v)? v:0).toFixed(2); }
  function n1(v){ return (isFinite(v)? v:0).toFixed(1); }

  function safeCall(fn, fallback){
    try{ return fn(); }catch(e){ return fallback; }
  }

  // ===== CONNECT UI =====
  function setConnUI(connected){
    if (!el.connBox) return;

    if (connected){
      el.connBox.textContent = "DYNO TERHUBUNG";
      el.connBox.style.background = "#12b85a";     // hijau pekat
      el.connBox.style.borderColor = "#0ea84f";
      el.connBox.style.color = "#ffffff";
    } else {
      el.connBox.textContent = "DYNO TIDAK TERHUBUNG";
      el.connBox.style.background = "#6f6f6f";     // abu pekat
      el.connBox.style.borderColor = "rgba(255,255,255,0.15)";
      el.connBox.style.color = "#ffffff";
    }
  }

  async function pollConn(){
    // default tetap muncul walau API belum ada
    if (typeof window.DYNO_getConn_DUAL !== "function"){
      setConnUI(false);
      return;
    }
    try{
      const s = await window.DYNO_getConn_DUAL();
      setConnUI(!!(s && s.connected));
    }catch(e){
      setConnUI(false);
    }
  }

  // ===== CONFIG -> API =====
  function getCfgFromUI(){
    return {
      targetM: parseInt(el.targetM?.value || "200", 10) || 200,
      circM: parseFloat(el.circM?.value || "1.85") || 1.85,
      weightKg: parseInt(el.weightKg?.value || "120", 10) || 120,
      pprFront: parseInt(el.pprFront?.value || "1", 10) || 1,
      pprRear: parseInt(el.pprRear?.value || "1", 10) || 1,
    };
  }

  async function pushCfgToApi(){
    if (typeof window.DYNO_setConfig_DUAL !== "function") return;
    const cfg = getCfgFromUI();
    try{ await window.DYNO_setConfig_DUAL(cfg); }catch(e){}
    // update INFO panel
    if (el.targetShow) el.targetShow.textContent = String(cfg.targetM);
    if (el.circShow) el.circShow.textContent = String(cfg.circM);
    if (el.weightShow) el.weightShow.textContent = String(cfg.weightKg);
    if (el.pprFrontShow) el.pprFrontShow.textContent = String(cfg.pprFront);
    if (el.pprRearShow) el.pprRearShow.textContent = String(cfg.pprRear);
  }

  // ===== UI actions (dipanggil dari HTML) =====
  window.DYNO_arm = async function(){
    await pushCfgToApi();
    if (typeof window.DYNO_arm_DUAL !== "function"){
      if (el.statusText) el.statusText.textContent = "ERROR: esp-api-dual.js belum siap";
      return;
    }
    const cfg = getCfgFromUI();
    const r = await window.DYNO_arm_DUAL(cfg);
    if (r && r.ok){
      lastSeq = 0;
      rows = [];
      clearTable();
      if (el.statusText) el.statusText.textContent = "ARMED";
    }
  };

  window.DYNO_run = async function(){
    await pushCfgToApi();
    if (typeof window.DYNO_run_DUAL !== "function") return;
    const r = await window.DYNO_run_DUAL();
    if (r && r.ok){
      if (el.statusText) el.statusText.textContent = "RUNNING...";
    }
  };

  window.DYNO_stop = async function(){
    if (typeof window.DYNO_stop_DUAL !== "function") return;
    await window.DYNO_stop_DUAL("STOP");
    if (el.statusText) el.statusText.textContent = "STOP";
  };

  window.DYNO_saveCSV = function(){
    // export dari rows cache
    if (!rows || rows.length === 0){
      if (el.statusText) el.statusText.textContent = "Tidak ada data untuk disimpan.";
      return;
    }
    const header = ["t(s)","rpm","tq(Nm)","hp","ign(deg)","afr","dist(m)","speed(km/h)"].join(",");
    const lines = [header];
    for (const r of rows){
      lines.push([
        (r.t ?? 0),
        (r.rpm ?? 0),
        (r.tq ?? 0),
        (r.hp ?? 0),
        (r.ign ?? 0),
        (r.afr ?? 14.7),
        (r.dist ?? 0),
        (r.spd ?? 0),
      ].join(","));
    }
    const blob = new Blob([lines.join("\n")], {type:"text/csv;charset=utf-8"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "dyno-road.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(()=>URL.revokeObjectURL(url), 1000);
  };

  // ===== snapshot polling =====
  async function pollSnapshot(){
    if (typeof window.DYNO_getSnapshot_DUAL !== "function") return;

    let snap = null;
    try{ snap = await window.DYNO_getSnapshot_DUAL(); }catch(e){ return; }
    if (!snap) return;

    // status text utama (bar atas)
    if (el.statusText){
      // pakai statusText dari API kalau ada, fallback
      const txt = snap.statusText || (snap.running ? "RUNNING..." : (snap.armed ? "ARMED" : "READY"));
      el.statusText.textContent = txt;
    }

    // LIVE panel
    if (el.state) el.state.textContent = snap.running ? "RUNNING" : (snap.armed ? "ARMED" : "READY");
    if (el.time)  el.time.textContent  = n2(snap.t || 0);
    if (el.dist)  el.dist.textContent  = n1(snap.distM || 0);
    if (el.speed) el.speed.textContent = n1(snap.speedKmh || 0);
    if (el.rpm)   el.rpm.textContent   = String(Math.round(snap.rpm || 0));

    // POWER panel
    if (el.tq)    el.tq.textContent    = n1(snap.tq || 0);
    if (el.hp)    el.hp.textContent    = n1(snap.hp || 0);
    if (el.ign)   el.ign.textContent   = n1(snap.ign || 0);
    if (el.tqMax) el.tqMax.textContent = n1(snap.maxTQ || 0);
    if (el.hpMax) el.hpMax.textContent = n1(snap.maxHP || 0);

    // INFO panel
    if (el.logInfo) el.logInfo.textContent = `${snap.rowsCount || 0} rows`;

    // progress bar statusbar
    if (statusBar){
      const target = Math.max(1, snap.targetM || parseInt(el.targetM?.value || "200", 10) || 200);
      const p = clamp(((snap.distM || 0) / target) * 100, 0, 100);
      statusBar.style.setProperty("--p", p.toFixed(1) + "%");
    }

    // fetch rows incremental
    if (typeof window.DYNO_getRowsSince_DUAL === "function"){
      try{
        const r = await window.DYNO_getRowsSince_DUAL(lastSeq);
        if (r && Array.isArray(r.rows) && r.rows.length){
          lastSeq = r.seq || lastSeq;
          rows.push(...r.rows);

          // batasi cache biar hp gak berat
          if (rows.length > 3500) rows.splice(0, rows.length - 3500);

          // update tabel (append aja)
          appendTable(r.rows);
        }
      }catch(e){}
    }
  }

  function clearTable(){
    if (el.tbody) el.tbody.innerHTML = "";
  }

  function appendTable(newRows){
    if (!el.tbody) return;
    // batasi render table biar tidak berat
    const maxRowsInDOM = 600;

    for (const r of newRows){
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td style="text-align:left">${n2(r.t || 0)}</td>
        <td>${Math.round(r.rpm || 0)}</td>
        <td>${n1(r.tq || 0)}</td>
        <td>${n1(r.hp || 0)}</td>
        <td>${n1(r.ign || 0)}</td>
        <td>${n2(r.afr || 14.7)}</td>
        <td>${n1(r.dist || 0)}</td>
      `;
      el.tbody.appendChild(tr);
    }

    // pangkas DOM rows
    while (el.tbody.children.length > maxRowsInDOM){
      el.tbody.removeChild(el.tbody.firstChild);
    }
  }

  // ===== simple graph =====
  function setupCanvas(){
    if (!el.canvas) return;
    ctx = el.canvas.getContext("2d");
    resizeCanvas();
    window.addEventListener("resize", resizeCanvas, {passive:true});
  }

  function resizeCanvas(){
    if (!el.canvas || !ctx) return;
    const rect = el.canvas.getBoundingClientRect();
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    cw = Math.max(10, Math.floor(rect.width * dpr));
    ch = Math.max(10, Math.floor(rect.height * dpr));
    el.canvas.width = cw;
    el.canvas.height = ch;
  }

  function draw(){
    if (!ctx) return;

    // background clear
    ctx.clearRect(0,0,cw,ch);

    // kalau belum ada data, kasih teks
    if (!rows || rows.length < 2){
      ctx.globalAlpha = 0.75;
      ctx.fillStyle = "#ffffff";
      ctx.font = `${Math.max(12, Math.floor(cw/60))}px Arial`;
      ctx.textAlign = "center";
      ctx.fillText("ARM → RUN untuk mulai.", cw/2, ch/2);
      ctx.globalAlpha = 1;
      return;
    }

    // range
    let rpmMin = 1e9, rpmMax = 0;
    let hpMax = 0, tqMax = 0;
    for (const r of rows){
      const rpm = r.rpm || 0;
      rpmMin = Math.min(rpmMin, rpm);
      rpmMax = Math.max(rpmMax, rpm);
      hpMax = Math.max(hpMax, r.hp || 0);
      tqMax = Math.max(tqMax, r.tq || 0);
    }
    rpmMin = clamp(rpmMin, 500, 20000);
    rpmMax = clamp(rpmMax, rpmMin+1, 20000);
    hpMax = Math.max(1, hpMax);
    tqMax = Math.max(1, tqMax);

    // padding
    const padL = Math.floor(cw*0.08);
    const padR = Math.floor(cw*0.04);
    const padT = Math.floor(ch*0.08);
    const padB = Math.floor(ch*0.10);

    const x0 = padL;
    const y0 = padT;
    const w = cw - padL - padR;
    const h = ch - padT - padB;

    // grid
    ctx.globalAlpha = 0.18;
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1;
    for (let i=0;i<=10;i++){
      const x = x0 + (w*i/10);
      ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y0+h); ctx.stroke();
    }
    for (let i=0;i<=8;i++){
      const y = y0 + (h*i/8);
      ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x0+w, y); ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // axis labels simple
    ctx.fillStyle = "#ffffff";
    ctx.globalAlpha = 0.65;
    ctx.font = `${Math.max(10, Math.floor(cw/80))}px Arial`;
    ctx.textAlign = "left";
    ctx.fillText(`RPM ${Math.round(rpmMin)}..${Math.round(rpmMax)}`, x0, y0-6);
    ctx.textAlign = "right";
    ctx.fillText(`HP max ${hpMax.toFixed(1)} | TQ max ${tqMax.toFixed(1)}`, x0+w, y0-6);
    ctx.globalAlpha = 1;

    function X(rpm){ return x0 + ((rpm - rpmMin) / (rpmMax - rpmMin)) * w; }
    function Yhp(hp){ return y0 + h - (hp / hpMax) * h; }
    function Ytq(tq){ return y0 + h - (tq / tqMax) * h; }

    // HP line
    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgb(52,152,219)";
    ctx.beginPath();
    let started = false;
    for (const r of rows){
      const rpm = r.rpm || 0;
      const hp = r.hp || 0;
      const x = X(rpm);
      const y = Yhp(hp);
      if (!started){ ctx.moveTo(x,y); started=true; }
      else ctx.lineTo(x,y);
    }
    ctx.stroke();

    // TQ line
    ctx.strokeStyle = "rgb(0,255,102)";
    ctx.beginPath();
    started = false;
    for (const r of rows){
      const rpm = r.rpm || 0;
      const tq = r.tq || 0;
      const x = X(rpm);
      const y = Ytq(tq);
      if (!started){ ctx.moveTo(x,y); started=true; }
      else ctx.lineTo(x,y);
    }
    ctx.stroke();
  }

  // ===== loops =====
  function startLoops(){
    if (_uiTimer) return;

    _uiTimer = setInterval(pollSnapshot, UI_POLL_MS);
    _connTimer = setInterval(pollConn, CONN_POLL_MS);
    _drawTimer = setInterval(draw, CANVAS_FPS_MS);

    // initial
    pollConn();
    pollSnapshot();
    draw();
  }

  // init
  function init(){
    setupCanvas();
    pushCfgToApi();
    setConnUI(false);     // kotak tetap ada walau offline
    startLoops();
  }

  if (document.readyState === "loading"){
    document.addEventListener("DOMContentLoaded", init, {once:true});
  } else {
    init();
  }

})();
