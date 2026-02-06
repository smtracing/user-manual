console.log("✅ dyno-road.js dimuat (RPM + HP + TQ) — FRONT ONLY");

/* =========================================================
   dyno-road.js — UI Logic (FRONT ONLY)
   - Ambil data dari firmware lewat esp-api-dual.js
   - Tidak ada AFR/IGN
   - RUN: setConfig -> /run (firmware reset + WAIT_GATE)
   - TABLE: 7 kolom sesuai HTML (#, time, rpm, hp, tq, speed, dist)
========================================================= */

(function(){
  const UI_POLL_MS   = 60;
  const LOG_STEP_MS  = 80;
  const MAX_LOG_ROWS = 800;

  const DYNO = {
    running:false,
    armed:false,

    // config
    targetM:200,
    circM:1.85,
    weightKg:120,
    pprFront:1,

    // live
    t_s:0,
    dist_m:0,
    speed_kmh:0,
    rpm:0,
    hp:0,
    tq:0,
    maxHP:0,
    maxTQ:0,

    // log rows: {t,rpm,hp,tq,speed,dist}
    log:[],
    lastLogMs:0
  };

  const $ = (id) => document.getElementById(id);
  const pick = (...ids) => {
    for (const id of ids){
      const n = $(id);
      if (n) return n;
    }
    return null;
  };

  const el = {
    // inputs (cocok HTML: in_*)
    targetM:  pick("in_targetM",  "d_targetM"),
    circM:    pick("in_circM",    "d_circM"),
    weightKg: pick("in_weightKg", "d_weightKg"),
    pprFront: pick("in_pprFront", "d_pprFront"),

    // status
    status: $("d_status"),
    state:  $("d_state"),
    gate:   $("d_gate"),

    // live
    time:  $("d_time"),
    dist:  $("d_dist"),
    speed: $("d_speedLive"),
    rpm:   $("d_rpmLive"),
    tq:    $("d_tqLive"),
    hp:    $("d_hpLive"),
    tqMax: $("d_tqMax"),
    hpMax: $("d_hpMax"),

    // info
    targetShow:   $("d_targetShow"),
    circShow:     $("d_circShow"),
    weightShow:   $("d_weightShow"),
    pprFrontShow: $("d_pprFrontShow"),
    logInfo:      $("d_logInfo"),

    // table
    tbody: $("d_tbody"),

    // canvas
    canvas: $("dynoCanvas")
  };

  function setText(node, v){
    if (!node) return;
    node.textContent = (v == null) ? "" : String(v);
  }

  function readConfigFromUI(){
    const t = parseInt(el.targetM && el.targetM.value, 10);
    const c = parseFloat(el.circM && el.circM.value);
    const w = parseInt(el.weightKg && el.weightKg.value, 10);
    const p = parseInt(el.pprFront && el.pprFront.value, 10);

    if (Number.isFinite(t)) DYNO.targetM  = Math.max(10, Math.min(5000, t));
    if (Number.isFinite(c)) DYNO.circM    = Math.max(0.20, Math.min(10.0, c));
    if (Number.isFinite(w)) DYNO.weightKg = Math.max(30, Math.min(500, w));
    if (Number.isFinite(p)) DYNO.pprFront = Math.max(1, Math.min(2000, p));

    setText(el.targetShow, DYNO.targetM);
    setText(el.circShow, DYNO.circM.toFixed(2));
    setText(el.weightShow, DYNO.weightKg);
    setText(el.pprFrontShow, DYNO.pprFront);
  }

  function clearLog(){
    DYNO.log.length = 0;
    DYNO.lastLogMs = 0;
    if (el.tbody) el.tbody.innerHTML = "";
    setText(el.logInfo, "log: 0 rows");
    drawDyno();
  }

  function setStatus(txt){
    setText(el.status, txt || "");
    setText(el.state, txt || "");
  }

  function setGateUI(s){
    if (!el.gate) return;
    if (!s){ setText(el.gate, "-"); return; }

    const gateWait  = !!(s.gate_wait ?? s.gateWait ?? false);
    const pulsesReq = Number(s.gate_pulses ?? s.gatePulses ?? 0) || 0;

    if (gateWait){
      setText(el.gate, pulsesReq > 0 ? ("WAIT " + pulsesReq) : "WAIT");
    } else {
      setText(el.gate, pulsesReq > 0 ? ("OK " + pulsesReq) : "OK");
    }
  }

  function applySnapshot(s){
    if (!s) return;

    DYNO.armed   = !!s.armed;
    DYNO.running = !!s.running;

    DYNO.t_s       = Number(s.t_s ?? s.t ?? 0) || 0;
    DYNO.dist_m    = Number(s.dist_m ?? s.distM ?? 0) || 0;
    DYNO.speed_kmh = Number(s.speed_kmh ?? s.speedKmh ?? 0) || 0;

    DYNO.rpm = Number(s.rpm ?? 0) || 0;
    DYNO.hp  = Number(s.hp ?? 0) || 0;
    DYNO.tq  = Number(s.tq ?? 0) || 0;

    DYNO.maxHP = Number(s.maxHP ?? DYNO.maxHP ?? 0) || 0;
    DYNO.maxTQ = Number(s.maxTQ ?? DYNO.maxTQ ?? 0) || 0;

    setText(el.time, DYNO.t_s.toFixed(2));
    setText(el.dist, DYNO.dist_m.toFixed(1));
    setText(el.speed, DYNO.speed_kmh.toFixed(1));
    setText(el.rpm, Math.round(DYNO.rpm).toString());

    setText(el.hp, DYNO.hp.toFixed(1));
    setText(el.tq, DYNO.tq.toFixed(1));

    setText(el.hpMax, DYNO.maxHP.toFixed(1));
    setText(el.tqMax, DYNO.maxTQ.toFixed(1));

    setGateUI(s);

    const st = (s.statusText != null) ? String(s.statusText) : (DYNO.running ? "RUNNING" : "READY");
    setStatus(st);
  }

  function pushLogRow(){
    const now = Date.now();
    if (DYNO.lastLogMs && (now - DYNO.lastLogMs) < LOG_STEP_MS) return;
    DYNO.lastLogMs = now;

    const row = {
      t: DYNO.t_s,
      rpm: DYNO.rpm,
      hp: DYNO.hp,
      tq: DYNO.tq,
      speed: DYNO.speed_kmh,
      dist: DYNO.dist_m
    };

    DYNO.log.push(row);
    if (DYNO.log.length > MAX_LOG_ROWS) DYNO.log.shift();

    // TABLE: 7 kolom sesuai HTML (#, time, rpm, hp, tq, speed, dist)
    if (el.tbody){
      const tr = document.createElement("tr");

      const tdIdx = document.createElement("td");
      tdIdx.style.textAlign = "left";
      tdIdx.textContent = String(DYNO.log.length);

      const tdT = document.createElement("td");
      tdT.textContent = row.t.toFixed(2);

      const tdR = document.createElement("td");
      tdR.textContent = String(Math.round(row.rpm));

      const tdHP = document.createElement("td");
      tdHP.textContent = row.hp.toFixed(1);

      const tdTQ = document.createElement("td");
      tdTQ.textContent = row.tq.toFixed(1);

      const tdS = document.createElement("td");
      tdS.textContent = row.speed.toFixed(1);

      const tdD = document.createElement("td");
      tdD.textContent = row.dist.toFixed(1);

      tr.appendChild(tdIdx);
      tr.appendChild(tdT);
      tr.appendChild(tdR);
      tr.appendChild(tdHP);
      tr.appendChild(tdTQ);
      tr.appendChild(tdS);
      tr.appendChild(tdD);

      el.tbody.appendChild(tr);

      while (el.tbody.children.length > MAX_LOG_ROWS){
        el.tbody.removeChild(el.tbody.firstChild);
      }
    }

    setText(el.logInfo, "log: " + DYNO.log.length + " rows");
  }

  function drawDyno(){
    const canvas = el.canvas;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const dpr = Math.max(1, Math.floor(window.devicePixelRatio || 1));
    const w = Math.max(10, Math.floor(rect.width));
    const h = Math.max(10, Math.floor(rect.height));

    if (canvas.width !== w*dpr || canvas.height !== h*dpr){
      canvas.width = w*dpr;
      canvas.height = h*dpr;
    }

    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr,0,0,dpr,0,0);

    ctx.clearRect(0,0,w,h);
    ctx.fillStyle = "#0e0f13";
    ctx.fillRect(0,0,w,h);

    const padL = 46, padR = 18, padT = 18, padB = 34;
    const gx0 = padL, gy0 = padT;
    const gx1 = w - padR, gy1 = h - padB;

    // grid
    ctx.strokeStyle = "rgba(255,255,255,0.10)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    const vLines = 6, hLines = 5;
    for (let i=0;i<=vLines;i++){
      const x = gx0 + (gx1-gx0)*i/vLines;
      ctx.moveTo(x, gy0);
      ctx.lineTo(x, gy1);
    }
    for (let j=0;j<=hLines;j++){
      const y = gy0 + (gy1-gy0)*j/hLines;
      ctx.moveTo(gx0, y);
      ctx.lineTo(gx1, y);
    }
    ctx.stroke();

    // axes
    ctx.strokeStyle = "rgba(255,255,255,0.25)";
    ctx.beginPath();
    ctx.moveTo(gx0, gy0);
    ctx.lineTo(gx0, gy1);
    ctx.lineTo(gx1, gy1);
    ctx.stroke();

    // scale X (RPM fixed)
    const RPM_MIN = 2000;
    const RPM_MAX = 20000;

    // scale Y (auto)
    let maxHP = 1, maxTQ = 1;
    for (const r of DYNO.log){
      if (r.hp > maxHP) maxHP = r.hp;
      if (r.tq > maxTQ) maxTQ = r.tq;
    }
    maxHP = Math.max(1, maxHP * 1.15);
    maxTQ = Math.max(1, maxTQ * 1.15);

    const xOfRpm = (rpm) => gx0 + (gx1-gx0) * ((rpm - RPM_MIN) / (RPM_MAX - RPM_MIN));
    const yOfHP  = (hp)  => gy1 - (gy1-gy0) * (hp / maxHP);
    const yOfTQ  = (tq)  => gy1 - (gy1-gy0) * (tq / maxTQ);

    // labels
    ctx.fillStyle = "rgba(255,255,255,0.70)";
    ctx.font = "12px system-ui, -apple-system, Segoe UI, Roboto, Arial";
    ctx.fillText("RPM", gx1-30, gy1+24);
    ctx.fillText("HP",  gx0-30, gy0+10);
    ctx.fillText("TQ",  gx0-30, gy0+26);

    // plot
    if (DYNO.log.length >= 2){
      ctx.lineWidth = 2;

      // HP (putih)
      ctx.strokeStyle = "rgba(255,255,255,0.90)";
      ctx.beginPath();
      for (let i=0;i<DYNO.log.length;i++){
        const r = DYNO.log[i];
        const x = xOfRpm(r.rpm);
        const y = yOfHP(r.hp);
        if (i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
      }
      ctx.stroke();

      // TQ (hijau)
      ctx.strokeStyle = "rgba(0,255,140,0.90)";
      ctx.beginPath();
      for (let i=0;i<DYNO.log.length;i++){
        const r = DYNO.log[i];
        const x = xOfRpm(r.rpm);
        const y = yOfTQ(r.tq);
        if (i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
      }
      ctx.stroke();
    }
  }

  window.DYNO_redraw = function(){ drawDyno(); };

  function buildCSV(){
    const rows = [];
    rows.push(["idx","t_s","rpm","hp","tq_Nm","speed_kmh","dist_m"].join(","));
    for (let i=0;i<DYNO.log.length;i++){
      const r = DYNO.log[i];
      rows.push([
        (i+1),
        r.t.toFixed(3),
        Math.round(r.rpm),
        r.hp.toFixed(2),
        r.tq.toFixed(2),
        r.speed.toFixed(2),
        r.dist.toFixed(3)
      ].join(","));
    }
    return rows.join("\n");
  }

  window.DYNO_saveCSV = function(){
    const csv = buildCSV();
    const blob = new Blob([csv], {type:"text/csv;charset=utf-8"});
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    const ts = new Date();
    const pad = (n) => (n<10 ? "0"+n : ""+n);
    const name = "dyno_log_" +
      ts.getFullYear() + pad(ts.getMonth()+1) + pad(ts.getDate()) + "_" +
      pad(ts.getHours()) + pad(ts.getMinutes()) + pad(ts.getSeconds()) + ".csv";

    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 500);
  };

  window.DYNO_run = async function(){
    try{
      readConfigFromUI();

      // UI reset (firmware /run juga reset)
      clearLog();
      setStatus("SENDING CONFIG...");

      if (typeof window.DYNO_setConfig_DUAL === "function"){
        await window.DYNO_setConfig_DUAL({
          targetM: DYNO.targetM,
          circM: DYNO.circM,
          pprFront: DYNO.pprFront,
          weightKg: DYNO.weightKg
        });
      }

      setStatus("RUN (WAIT_GATE)...");
      if (typeof window.DYNO_run_DUAL === "function"){
        await window.DYNO_run_DUAL();
      } else if (typeof window.DYNO_arm_DUAL === "function"){
        await window.DYNO_arm_DUAL();
      }

    }catch(e){
      console.error(e);
      setStatus("ERROR RUN");
    }
  };

  window.DYNO_arm = async function(){
    return await window.DYNO_run();
  };

  window.DYNO_stop = async function(){
    try{
      setStatus("STOPPING...");
      if (typeof window.DYNO_stop_DUAL === "function"){
        await window.DYNO_stop_DUAL();
      }
      setStatus("STOP");
      drawDyno();
    }catch(e){
      console.error(e);
      setStatus("ERROR STOP");
    }
  };

  async function poll(){
    try{
      if (typeof window.DYNO_getSnapshot_DUAL !== "function") return;

      const s = await window.DYNO_getSnapshot_DUAL();
      applySnapshot(s);

      if (DYNO.running){
        // simpan log hanya setelah gate lewat
        if (DYNO.t_s > 0.0001){
          pushLogRow();
          drawDyno();
        }
      }
    }catch(e){
      setStatus("OFFLINE");
      setGateUI(null);
    }
  }

  function init(){
    readConfigFromUI();
    clearLog();
    setStatus("READY");
    setGateUI({gate_wait:true, gate_pulses:(DYNO.pprFront||1)});
    drawDyno();

    setInterval(poll, UI_POLL_MS);

    window.addEventListener("resize", () => {
      try{ drawDyno(); }catch(e){}
    }, {passive:true});
  }

  if (document.readyState === "loading"){
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
