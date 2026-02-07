/* =========================================================
   dyno-road.js — WEB UI (READ FROM FIRMWARE SNAPSHOT) [FRONT ONLY] — LOG BLOCKS
   - Sesuai firmware A3.ino: PPR hanya FRONT, AFR/IGN/SLIP tidak ada
   - UI dipertahankan (dyno-road.html tidak perlu diubah)
   - TIME/DIST/SPEED/RPM/HP/TQ diambil dari FIRMWARE snapshot
   - START GATE: web hanya menampilkan gate_wait dari firmware
   - FIX: target jarak di grafik ikut berubah saat input jarak diubah
   - NEW: LOG BLOCKS (maks 20 log)
       * Setiap klik RUN / RUN dari firmware (running false->true) membuat LOG baru di paling atas
       * Setiap log punya tombol SAVE sendiri
       * Tombol SAVE bawaan = SAVE ALL (log 1..20)
   - NEW: Tombol STOP di UI dijadikan RESET (hapus semua history/log di web)
========================================================= */

console.log("✅ dyno-road.js dimuat (FRONT ONLY — LOG BLOCKS — NO AFR/IGN/SLIP)");

(function(){
  "use strict";

  const UI_POLL_MS       = 16;
  const MAX_ROWS_PER_LOG = 800;
  const MAX_LOGS         = 20;

  // RPM range (untuk axis)
  const FIXED_RPM_START = 2000;
  const FIXED_RPM_END   = 20000;

  // colors (jangan ubah UI feel)
  const TQ_COLOR   = "rgb(0,255,102)";
  const HP_COLOR   = "rgb(52,152,219)";
  const RPM_COLOR  = "rgba(255,255,255,0.85)";

  const DYNO = {
    armed:false,
    running:false,

    targetM:200,
    circM:1.85,
    weightKg:120,
    pprFront:1,

    rpmStart: FIXED_RPM_START,
    rpmEnd:   FIXED_RPM_END,

    // live from firmware
    t:0,
    distM:0,
    speedKmh:0,
    rpm:0,
    tq:0,
    hp:0,

    maxHP:0,
    maxTQ:0,

    // raw snapshot cache
    lastSnap:null,

    timer:null,
    polling:false,

    statusBase:"READY",
    statusTimer:null,

    // canvas
    c:null, ctx:null, W:0, H:0,

    // config push debounce
    cfgPushTimer:null,

    // ===== LOG SYSTEM =====
    logSeq:0,          // auto increment
    logs:[],           // newest first
    currentLog:null,   // log object
    prevFwRunning:false
  };

  // ==========================
  // PUBLIC API (dipanggil dari HTML)
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

    // reset UI state + bersihkan history awal
    hardResetAll(true);

    updateState("READY");
    ensureStatusProgressEl();
    setStatus("READY");
    updateStatusProgress();
    DYNO_draw();
  };

  // kompatibilitas (kalau ada UI lama)
  window.DYNO_arm = async function(){
    // ARM opsional; jika dipakai, tidak menghapus log (karena user mau log tetap)
    if (DYNO.running) return;

    readInputs();

    DYNO.armed = true;
    updateState("ARMED");

    ensureStatusProgressEl();
    setStatus("ARMED: siap RUN. Target = " + DYNO.targetM + " m");

    // kirim config + arm (opsional)
    await pushConfigToESP();

    if (typeof window.DYNO_arm_DUAL === "function") {
      try{ await window.DYNO_arm_DUAL(); }catch(e){}
    }

    await pollFromESP(true);
    updateStatusProgress();
    DYNO_draw();
  };

  // HTML kamu pakai RUN langsung
  window.DYNO_run = async function(){
    readInputs();

    // kalau user tidak klik ARM, tetap boleh RUN
    DYNO.armed = true;

    if (DYNO.running) return;

    // ===== NEW LOG dibuat saat RUN diklik =====
    startNewLog("WEB RUN");

    DYNO.running = true;
    updateState("RUN");
    ensureStatusProgressEl();
    setStatus("RUN: firmware mulai timer setelah 1 putaran roda depan.");

    startStatusAnim();

    // kirim config + run
    await pushConfigToESP();

    if (typeof window.DYNO_run_DUAL === "function") {
      try{ await window.DYNO_run_DUAL(); }catch(e){}
    }

    if (DYNO.timer) clearInterval(DYNO.timer);
    DYNO.timer = setInterval(() => pollFromESP(false), UI_POLL_MS);

    updateStatusProgress();
    DYNO_draw();
  };

  // ===== STOP BUTTON DIJADIKAN RESET HISTORY (WEB) =====
  // Tombol STOP di HTML memanggil DYNO_stop(). Sekarang fungsinya = RESET total history.
  window.DYNO_stop = async function(){
    // kalau sedang running, stop firmware dulu
    if (DYNO.timer){
      clearInterval(DYNO.timer);
      DYNO.timer = null;
    }

    // flag UI
    DYNO.running = false;
    DYNO.armed = false;

    stopStatusAnim();
    updateState("RESET");
    setStatus("RESET: semua history/log dihapus.");

    // stop/reset di firmware (aman dipanggil walau sudah stop)
    if (typeof window.DYNO_stop_DUAL === "function") {
      try{ await window.DYNO_stop_DUAL(); }catch(e){}
    }
    if (typeof window.DYNO_reset_DUAL === "function") {
      try{ await window.DYNO_reset_DUAL(); }catch(e){}
    }

    // hapus semua log di web
    hardResetAll(false);
  };

  // RESET API masih ada kalau kamu panggil manual dari console
  window.DYNO_reset = async function(quiet){
    hardResetAll(!!quiet);
    if (!quiet) setStatus("RESET: semua history/log dihapus.");
    updateStatusProgress();
    DYNO_draw();

    if (typeof window.DYNO_reset_DUAL === "function") {
      try{ await window.DYNO_reset_DUAL(); }catch(e){}
    }
  };

  // SAVE ALL = gabung semua log (log 1..20)
  window.DYNO_saveCSV = function(){
    if (!DYNO.logs.length){
      setStatus("DATA KOSONG. RUN dulu.");
      return;
    }

    // susun log ID naik (log1 paling awal)
    const asc = DYNO.logs.slice().sort((a,b)=>a.id-b.id);

    const lines = [];
    for (let li=0; li<asc.length; li++){
      const log = asc[li];

      lines.push("LOG DATA " + log.id);
      lines.push(["no","time_s","rpm","hp","tq_nm","speed_kmh","dist_m"].join(","));

      for (let i=0; i<log.rows.length; i++){
        const r = log.rows[i];
        lines.push([
          (i+1),
          (r.t||0).toFixed(3),
          Math.round(r.rpm||0),
          (r.hp||0).toFixed(2),
          (r.tq||0).toFixed(2),
          (r.spd||0).toFixed(3),
          (r.dist||0).toFixed(3)
        ].join(","));
      }

      if (li !== asc.length-1) lines.push(""); // spacer antar log
    }

    downloadCSV(lines.join("\n"), "dyno_road_ALL_LOGS.csv");
    setStatus("SAVED: ALL LOGS (1.." + asc[asc.length-1].id + ").");
  };

  // SAVE PER LOG (dipanggil dari tombol log header)
  window.DYNO_saveLogCSV = function(logId){
    const log = findLogById(logId);
    if (!log || !log.rows.length){
      setStatus("LOG KOSONG.");
      return;
    }

    const lines = [];
    lines.push("LOG DATA " + log.id);
    lines.push(["no","time_s","rpm","hp","tq_nm","speed_kmh","dist_m"].join(","));

    for (let i=0; i<log.rows.length; i++){
      const r = log.rows[i];
      lines.push([
        (i+1),
        (r.t||0).toFixed(3),
        Math.round(r.rpm||0),
        (r.hp||0).toFixed(2),
        (r.tq||0).toFixed(2),
        (r.spd||0).toFixed(3),
        (r.dist||0).toFixed(3)
      ].join(","));
    }

    downloadCSV(lines.join("\n"), "dyno_road_LOG_" + log.id + ".csv");
    setStatus("SAVED: LOG " + log.id + ".");
  };

  // ==========================
  // INPUTS
  // ==========================
  function bindInputs(){
    const ids = ["d_targetM","d_circM","d_weightKg","d_pprFront"];
    ids.forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;

      // FIX: saat input berubah, grafik ikut update sekarang juga
      el.addEventListener("input", onConfigChanged);
      el.addEventListener("change", onConfigChanged);
    });

    // set initial box values
    readInputs();
    updateInfoBox();
    updateStatusProgress();
  }

  function onConfigChanged(){
    readInputs();
    updateInfoBox();
    updateStatusProgress();
    DYNO_draw();

    // optional: push config ke ESP meskipun belum RUN (biar firmware echo ikut update)
    debouncePushConfigToESP();
  }

  function debouncePushConfigToESP(){
    if (DYNO.cfgPushTimer) clearTimeout(DYNO.cfgPushTimer);
    DYNO.cfgPushTimer = setTimeout(async () => {
      DYNO.cfgPushTimer = null;
      await pushConfigToESP();
    }, 250);
  }

  async function pushConfigToESP(){
    if (typeof window.DYNO_setConfig_DUAL !== "function") return;
    try{
      await window.DYNO_setConfig_DUAL({
        targetM: DYNO.targetM,
        circM: DYNO.circM,
        pprFront: DYNO.pprFront,
        weightKg: DYNO.weightKg
      });
    }catch(e){}
  }

  function readInputs(){
    const targetM  = Number(getVal("d_targetM", DYNO.targetM));
    const circM    = Number(getVal("d_circM", DYNO.circM));
    const weightKg = Number(getVal("d_weightKg", DYNO.weightKg));
    const pprFront = Number(getVal("d_pprFront", DYNO.pprFront));

    DYNO.targetM  = clampInt(targetM, 10, 5000, 200);
    DYNO.circM    = clampNum(circM, 0.2, 10.0, 1.85);
    DYNO.weightKg = clampInt(weightKg, 30, 500, 120);
    DYNO.pprFront = clampInt(pprFront, 1, 2000, 1);
  }

  function getVal(id, def){
    const el = document.getElementById(id);
    if (!el) return def;
    const v = Number(el.value);
    return isFinite(v) ? v : def;
  }

  // ==========================
  // POLL DATA (FIRMWARE SNAPSHOT MASTER)
  // ==========================
  async function pollFromESP(forceOnce){
    if (DYNO.polling && !forceOnce) return;
    DYNO.polling = true;

    try{
      if (typeof window.DYNO_getSnapshot_DUAL !== "function") return;

      const snap = await window.DYNO_getSnapshot_DUAL();
      if (!snap) return;
      DYNO.lastSnap = snap;

      // ---- STATE dari firmware
      const fwArmed   = !!snap.armed;
      const fwRunning = !!snap.running;
      const gateWait  = !!(snap.gate_wait ?? snap.gateWait);

      // ===== NEW LOG jika firmware start (pin RUN / /run) =====
      // Deteksi start baru: sebelumnya false, sekarang true
      if (!DYNO.prevFwRunning && fwRunning){
        const now = Date.now();

        // aturan anti double:
        // - Jika barusan klik RUN di web, kita sudah bikin log baru.
        //   Saat firmware benar-benar mulai running, cukup tandai _fwSeen tanpa bikin log baru lagi.
        const cur = DYNO.currentLog;
        const recentlyWebRun = !!(cur &&
          cur._startedBy === "WEB RUN" &&
          !cur._fwSeen &&
          (now - (cur._createdAt || 0) < 4000));

        if (recentlyWebRun){
          cur._fwSeen = true;
        } else {
          startNewLog("FIRMWARE RUN");
          if (DYNO.currentLog) DYNO.currentLog._fwSeen = true;
        }
      }

      DYNO.prevFwRunning = fwRunning;

      DYNO.armed   = fwArmed;
      DYNO.running = fwRunning;

      // ---- CONFIG echo dari firmware (optional)
      if (isFinite(Number(snap.targetM)) && Number(snap.targetM) > 0)  DYNO.targetM  = Math.max(1, Number(snap.targetM));
      if (isFinite(Number(snap.circM))   && Number(snap.circM) > 0)    DYNO.circM    = Number(snap.circM);
      if (isFinite(Number(snap.pprFront))&& Number(snap.pprFront)>0)   DYNO.pprFront = Math.max(1, Math.round(Number(snap.pprFront)));
      if (isFinite(Number(snap.weightKg))&& Number(snap.weightKg)>0)   DYNO.weightKg = Math.max(1, Math.round(Number(snap.weightKg)));

      // ---- LIVE computed FROM FIRMWARE
      const t_s      = Number(snap.t_s ?? snap.t ?? 0);
      const dist_m   = Number(snap.dist_m ?? snap.distM ?? 0);
      const speed_km = Number(snap.speed_kmh ?? snap.speedKmh ?? 0);

      DYNO.t        = isFinite(t_s) ? Math.max(0, t_s) : 0;
      DYNO.distM    = isFinite(dist_m) ? Math.max(0, dist_m) : 0;
      DYNO.speedKmh = isFinite(speed_km) ? Math.max(0, speed_km) : 0;

      // ---- RPM/HP/TQ from firmware
      DYNO.rpm = Number(snap.rpm || 0) || 0;
      DYNO.tq  = Number(snap.tq  || snap.torque || 0) || 0;
      DYNO.hp  = Number(snap.hp  || snap.power  || 0) || 0;

      // max from firmware jika tersedia, else track dari web
      const fwMaxHP = Number(snap.maxHP);
      const fwMaxTQ = Number(snap.maxTQ);
      if (isFinite(fwMaxHP)) DYNO.maxHP = Math.max(0, fwMaxHP);
      else DYNO.maxHP = Math.max(DYNO.maxHP || 0, DYNO.hp || 0);

      if (isFinite(fwMaxTQ)) DYNO.maxTQ = Math.max(0, fwMaxTQ);
      else DYNO.maxTQ = Math.max(DYNO.maxTQ || 0, DYNO.tq || 0);

      // ---- STATUS text
      const st = String(snap.statusText || "").trim();
      if (DYNO.running && gateWait){
        updateState("RUN (WAIT 1 REV)");
        setStatus("RUN: tunggu 1 putaran roda depan (" + String(snap.gate_pulses ?? snap.gatePulses ?? DYNO.pprFront) + " pulsa)...");
      } else if (DYNO.running){
        updateState("RUNNING");
        if (st) setStatus(st);
        else setStatus("RUNNING...");
      } else if (DYNO.armed){
        updateState("ARMED");
      } else {
        if (st) setStatus(st);
      }

      // ---- LOG ROW (hanya saat firmware sudah mulai t berjalan)
      if (DYNO.running && !gateWait){
        if (!DYNO.currentLog){
          // safety: kalau log belum ada (misal web refresh saat run), buat log baru
          startNewLog("AUTO LOG");
        }

        const row = {
          t: DYNO.t,
          rpm: DYNO.rpm,
          tq: DYNO.tq || 0,
          hp: DYNO.hp || 0,
          dist: DYNO.distM,
          spd: DYNO.speedKmh
        };

        appendRowToCurrentLog(row);

        // AUTO STOP dari firmware: saat fwRunning false, stop polling tapi JANGAN hapus log
        if (!fwRunning){
          setStatus("AUTO STOP (firmware).");
          softStopKeepLogs();
        }
      } else {
        // kalau firmware sudah stop, pastikan polling berhenti
        if (!fwRunning && DYNO.timer){
          softStopKeepLogs();
        }
      }

      updateInfoBox();
      updateLiveUI();
      updateStatusProgress();
      DYNO_draw();

    }catch(e){
      // ignore polling errors
    }finally{
      DYNO.polling = false;
    }
  }

  // berhenti polling + update status, tapi tidak menghapus log
  function softStopKeepLogs(){
    if (DYNO.timer){
      clearInterval(DYNO.timer);
      DYNO.timer = null;
    }
    DYNO.running = false;
    stopStatusAnim();
    updateState("STOP");
  }

  // ==========================
  // LOG SYSTEM
  // ==========================
  function startNewLog(startReason){
    DYNO.logSeq += 1;

    const log = {
      id: DYNO.logSeq,
      rows: [],
      _startedBy: String(startReason || "RUN"),
      _fwSeen:false,
      _createdAt: Date.now(),
      _headTr:null,
      _sepTr:null
    };

    DYNO.currentLog = log;
    DYNO.logs.unshift(log);

    // limit logs (hapus yang paling lama)
    while (DYNO.logs.length > MAX_LOGS){
      const old = DYNO.logs.pop();
      removeLogDom(old);
    }

    // render dom for log (header + separator) di paling atas
    createLogDomAtTop(log);

    setStatus("LOG DATA " + log.id + " dibuat (" + log._startedBy + ").");
    updateLogInfo();
  }

  function findLogById(id){
    id = Number(id);
    for (let i=0; i<DYNO.logs.length; i++){
      if (DYNO.logs[i].id === id) return DYNO.logs[i];
    }
    return null;
  }

  function removeLogDom(log){
    if (!log) return;
    try{
      if (log._headTr && log._headTr.parentNode) log._headTr.parentNode.removeChild(log._headTr);
      if (log._sepTr && log._sepTr.parentNode) log._sepTr.parentNode.removeChild(log._sepTr);
      if (log._rowsTr && log._rowsTr.length){
        for (let i=0; i<log._rowsTr.length; i++){
          const tr = log._rowsTr[i];
          if (tr && tr.parentNode) tr.parentNode.removeChild(tr);
        }
      }
    }catch(e){}
  }

  function createLogDomAtTop(log){
    const tb = document.getElementById("d_tbody");
    if (!tb) return;

    // header row
    const head = document.createElement("tr");
    head.className = "log-head";

    const td = document.createElement("td");
    td.colSpan = 7;
    td.style.padding = "10px 8px";
    td.style.background = "rgba(255,255,255,0.04)";
    td.style.borderTop = "1px solid rgba(255,255,255,0.10)";
    td.style.borderBottom = "1px solid rgba(255,255,255,0.08)";

    const wrap = document.createElement("div");
    wrap.style.display = "flex";
    wrap.style.alignItems = "center";
    wrap.style.justifyContent = "space-between";
    wrap.style.gap = "10px";

    const left = document.createElement("div");
    left.textContent = "Log data " + log.id;
    left.style.fontWeight = "800";
    left.style.letterSpacing = "0.3px";
    left.style.color = "rgba(255,255,255,0.92)";

    const right = document.createElement("div");
    right.style.display = "flex";
    right.style.alignItems = "center";
    right.style.gap = "8px";

    const small = document.createElement("div");
    small.textContent = "(rows: 0)";
    small.style.fontSize = "12px";
    small.style.color = "rgba(255,255,255,0.55)";
    small.id = "log_rows_" + log.id;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = "SAVE LOG";
    btn.style.cursor = "pointer";
    btn.style.padding = "6px 10px";
    btn.style.borderRadius = "8px";
    btn.style.border = "1px solid rgba(255,255,255,0.18)";
    btn.style.background = "rgba(10,12,18,0.35)";
    btn.style.color = "rgba(255,255,255,0.88)";
    btn.onclick = () => { try{ window.DYNO_saveLogCSV(log.id); }catch(e){} };

    right.appendChild(small);
    right.appendChild(btn);

    wrap.appendChild(left);
    wrap.appendChild(right);
    td.appendChild(wrap);
    head.appendChild(td);

    // separator row
    const sep = document.createElement("tr");
    sep.className = "log-sep";
    const sd = document.createElement("td");
    sd.colSpan = 7;
    sd.style.padding = "0";
    sd.style.background = "transparent";

    const line = document.createElement("div");
    line.style.height = "10px";
    line.style.borderBottom = "1px solid rgba(255,255,255,0.06)";
    line.style.background = "rgba(0,0,0,0)";
    sd.appendChild(line);
    sep.appendChild(sd);

    // insert at top: head then (rows will insert before sep) then sep
    const first = tb.firstChild;
    if (first){
      tb.insertBefore(sep, first);
      tb.insertBefore(head, sep);
    }else{
      tb.appendChild(head);
      tb.appendChild(sep);
    }

    log._headTr = head;
    log._sepTr  = sep;
    log._rowsTr = [];
  }

  function appendRowToCurrentLog(r){
    const log = DYNO.currentLog;
    if (!log) return;

    // limit rows per log
    if (log.rows.length >= MAX_ROWS_PER_LOG){
      // kalau penuh, jangan tambah lagi (biar ringan)
      return;
    }

    const last = log.rows.length ? log.rows[log.rows.length - 1] : null;
    const changed = !last ||
      (Math.abs((r.t||0) - (last.t||0)) > 0.005) ||
      (Math.abs((r.dist||0) - (last.dist||0)) > 0.01);

    if (!changed) return;

    log.rows.push(r);

    // append DOM row tepat di bawah header log (sebelum separator)
    const tb = document.getElementById("d_tbody");
    if (!tb || !log._sepTr) return;

    const tr = document.createElement("tr");

    const idx = log.rows.length; // 1-based
    const cells = [
      String(idx),
      (r.t||0).toFixed(3),
      String(Math.round(r.rpm||0)),
      (r.hp||0).toFixed(2),
      (r.tq||0).toFixed(2),
      (r.spd||0).toFixed(2),
      (r.dist||0).toFixed(2)
    ];

    for (let i=0; i<cells.length; i++){
      const td = document.createElement("td");
      td.textContent = cells[i];
      if (i === 0) td.style.textAlign = "left";
      tr.appendChild(td);
    }

    tb.insertBefore(tr, log._sepTr);
    log._rowsTr.push(tr);

    updateLogRowsLabel(log);
    updateLogInfo();
  }

  function updateLogRowsLabel(log){
    const el = document.getElementById("log_rows_" + log.id);
    if (el) el.textContent = "(rows: " + String(log.rows.length) + ")";
  }

  function updateLogInfo(){
    // tampilkan jumlah log + total rows
    let totalRows = 0;
    for (let i=0; i<DYNO.logs.length; i++) totalRows += DYNO.logs[i].rows.length;
    setText("d_logInfo", String(totalRows) + " rows / " + String(DYNO.logs.length) + " logs");
  }

  // hard reset all logs + UI live
  function hardResetAll(quiet){
    if (DYNO.timer){
      clearInterval(DYNO.timer);
      DYNO.timer = null;
    }

    DYNO.armed = false;
    DYNO.running = false;

    DYNO.t = 0;
    DYNO.distM = 0;
    DYNO.speedKmh = 0;
    DYNO.rpm = 0;
    DYNO.tq = 0;
    DYNO.hp = 0;

    DYNO.maxHP = 0;
    DYNO.maxTQ = 0;

    DYNO.lastSnap = null;

    DYNO.logs = [];
    DYNO.currentLog = null;
    DYNO.prevFwRunning = false;

    const tb = document.getElementById("d_tbody");
    if (tb) tb.innerHTML = "";

    updateInfoBox();
    updateLiveUI();
    updateState("READY");

    if (!quiet) setStatus("READY");
    updateLogInfo();
  }

  // ==========================
  // UI UPDATE
  // ==========================
  function updateState(s){
    const el = document.getElementById("d_state");
    if (el) el.textContent = String(s || "READY");
  }

  function setStatus(s){
    const el = document.getElementById("d_status");
    if (el) el.textContent = String(s || "");
    DYNO.statusBase = String(s || "");
  }

  function updateLiveUI(){
    setText("d_time",      (DYNO.t||0).toFixed(2));
    setText("d_dist",      (DYNO.distM||0).toFixed(1));
    setText("d_speedLive", (DYNO.speedKmh||0).toFixed(1));
    setText("d_rpmLive",   String(Math.round(DYNO.rpm||0)));

    setText("d_tqLive", (DYNO.tq||0).toFixed(1));
    setText("d_hpLive", (DYNO.hp||0).toFixed(1));

    setText("d_tqMax", (DYNO.maxTQ||0).toFixed(1));
    setText("d_hpMax", (DYNO.maxHP||0).toFixed(1));

    updateLogInfo();
  }

  function updateInfoBox(){
    setText("d_targetShow", String(DYNO.targetM));
    setText("d_circShow",   Number(DYNO.circM).toFixed(2));
    setText("d_weightShow", String(DYNO.weightKg));
    setText("d_pprFrontShow", String(DYNO.pprFront));
  }

  function setText(id, txt){
    const el = document.getElementById(id);
    if (el) el.textContent = String(txt);
  }

  // ==========================
  // STATUSBAR PROGRESS (tetap dipertahankan)
  // ==========================
  function ensureStatusProgressEl(){
    const bar = document.getElementById("d_status");
    if (!bar) return;

    if (!document.getElementById("d_status_prog")){
      const prog = document.createElement("div");
      prog.id = "d_status_prog";
      prog.style.height = "2px";
      prog.style.marginTop = "6px";
      prog.style.background = "rgba(255,255,255,0.10)";
      prog.style.position = "relative";
      prog.style.overflow = "hidden";

      const inner = document.createElement("div");
      inner.id = "d_status_prog_in";
      inner.style.position = "absolute";
      inner.style.left = "0";
      inner.style.top = "0";
      inner.style.bottom = "0";
      inner.style.width = "0%";
      inner.style.background = "rgba(0,255,100,0.65)";
      prog.appendChild(inner);

      bar.parentNode.appendChild(prog);
    }
  }

  function updateStatusProgress(){
    const inner = document.getElementById("d_status_prog_in");
    if (!inner) return;

    const target = Math.max(1, DYNO.targetM || 1);
    const pct = clampNum((DYNO.distM / target) * 100, 0, 100, 0);
    inner.style.width = pct.toFixed(1) + "%";
  }

  function startStatusAnim(){
    if (DYNO.statusTimer) return;
    DYNO.statusTimer = setInterval(() => {
      updateStatusProgress();
    }, 200);
  }

  function stopStatusAnim(){
    if (DYNO.statusTimer){
      clearInterval(DYNO.statusTimer);
      DYNO.statusTimer = null;
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

  function drawInfoText(ctx, W, H, s){
    ctx.save();
    ctx.font = "900 16px Arial";
    ctx.fillStyle = "rgba(255,255,255,0.80)";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(s, W/2, H/2);
    ctx.restore();
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

  function DYNO_draw(){
    if (!DYNO.ctx) return;

    const ctx = DYNO.ctx;
    const W = DYNO.W, H = DYNO.H;

    ctx.clearRect(0,0,W,H);

    const PAD_L = 97;
    const PAD_R = 18;
    const PAD_T = 14;
    const PAD_B = 44;

    const plotW = Math.max(10, W - PAD_L - PAD_R);
    const plotH = Math.max(10, H - PAD_T - PAD_B);

    // bg
    ctx.save();
    ctx.fillStyle = "rgba(18,22,32,0.35)";
    ctx.fillRect(PAD_L, PAD_T, plotW, plotH);
    ctx.restore();

    const rMin = DYNO.rpmStart;
    const rMax = DYNO.rpmEnd;

    const dMin = 0;
    const dMax = Math.max(1, DYNO.targetM); // ikut target input

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
      ctx.lineTo(PAD_L + plotW, y);
      ctx.stroke();

      const v = (k/5)*yMaxPower;
      ctx.fillStyle = "rgba(210,218,235,0.85)";
      ctx.fillText(v.toFixed(0), PAD_L - 25, y);
    }

    // ===== RPM ticks (horizontal light grid) =====
    const stepYRPM = 500;
    for (let rpm = roundUp(rMin, stepYRPM); rpm <= rMax; rpm += stepYRPM){
      const y = PAD_T + plotH - ((rpm - rMin) / Math.max(1,(rMax - rMin))) * plotH;

      ctx.strokeStyle = (rpm % 1000 === 0) ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.06)";
      ctx.beginPath();
      ctx.moveTo(PAD_L, y);
      ctx.lineTo(PAD_L + plotW, y);
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

    // ===== Dist grid + bottom labels =====
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

    // info text for gate wait / empty
    const gateWait = !!(DYNO.lastSnap && (DYNO.lastSnap.gate_wait ?? DYNO.lastSnap.gateWait));
    if (DYNO.running && gateWait){
      const gp = DYNO.lastSnap ? (DYNO.lastSnap.gate_pulses ?? DYNO.lastSnap.gatePulses ?? DYNO.pprFront) : DYNO.pprFront;
      drawInfoText(ctx, W, H, "WAIT: " + String(gp) + " pulsa (1 putaran) ...");
      drawOverlayInsideGraph(ctx, PAD_L, PAD_T, plotW, plotH);
      return;
    }

    // untuk grafik, pakai log terbaru (currentLog) kalau ada, fallback log newest
    const logForGraph = DYNO.currentLog || (DYNO.logs.length ? DYNO.logs[0] : null);
    const rows = logForGraph ? logForGraph.rows : [];

    if (!rows || rows.length < 2) {
      drawInfoText(ctx, W, H, "RUN untuk mulai.");
      drawOverlayInsideGraph(ctx, PAD_L, PAD_T, plotW, plotH);
      return;
    }

    const series = buildSeriesByDist(rows, dMin, dMax, rMin, rMax);

    // curves
    drawCurveDist(series, p=>p.tq,  TQ_COLOR, yMaxPower, PAD_L, PAD_T, plotW, plotH, dMin, dMax);
    drawCurveDist(series, p=>p.hp,  HP_COLOR, yMaxPower, PAD_L, PAD_T, plotW, plotH, dMin, dMax);

    // RPM curve
    drawCurveDistRPM(series, p=>p.rpm, RPM_COLOR, rMin, rMax, PAD_L, PAD_T, plotW, plotH, dMin, dMax);

    drawOverlayInsideGraph(ctx, PAD_L, PAD_T, plotW, plotH);
  }

  function drawOverlayInsideGraph(ctx, x0, y0, w, h){
    const pad = 10;
    const boxH = 58;

    const rpmText = "RPM : " + String(Math.round(DYNO.rpm || 0));
    const tqText  = "TQ  : " + (DYNO.tq || 0).toFixed(1) + " Nm";
    const hpText  = "HP  : " + (DYNO.hp || 0).toFixed(1);

    ctx.save();
    ctx.font = "900 12px Arial";

    const boxW = 168;
    const x = x0 + w - boxW - pad;
    const y = y0 + pad;

    // box bg
    ctx.fillStyle = "rgba(10,12,18,0.55)";
    ctx.strokeStyle = "rgba(255,255,255,0.14)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    roundRect(ctx, x, y, boxW, boxH, 6);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "rgba(255,255,255,0.86)";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";

    ctx.fillText(rpmText, x + 10, y + 10);
    ctx.fillStyle = "rgba(0,255,102,0.90)";
    ctx.fillText(tqText,  x + 10, y + 26);
    ctx.fillStyle = "rgba(52,152,219,0.92)";
    ctx.fillText(hpText,  x + 10, y + 42);

    ctx.restore();
  }

  // ==========================
  // SERIES + DRAW HELPERS
  // ==========================
  function buildSeriesByDist(rows, dMin, dMax, rMin, rMax){
    const out = [];
    let lastDist = -1e9;

    for (let i=0; i<rows.length; i++){
      let dist = Number(rows[i].dist);
      let rpm  = Number(rows[i].rpm);
      let hp   = Number(rows[i].hp);
      let tq   = Number(rows[i].tq);

      if (!isFinite(dist) || !isFinite(rpm)) continue;
      if (!isFinite(hp)) hp = 0;
      if (!isFinite(tq)) tq = 0;

      dist = clampNum(dist, dMin, dMax, dMin);
      rpm  = clampNum(rpm,  rMin, rMax, rMin);

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

  function drawCurveDist(series, getter, color, yMax, x0, y0, w, h, dMin, dMax){
    if (!series || series.length < 2) return;

    const yMin = 0;
    const scaleY = (v) => {
      v = clampNum(v, yMin, yMax, yMin);
      const t = (v - yMin) / Math.max(1e-6, (yMax - yMin));
      return y0 + h - t*h;
    };
    const scaleX = (d) => {
      d = clampNum(d, dMin, dMax, dMin);
      const t = (d - dMin) / Math.max(1e-6, (dMax - dMin));
      return x0 + t*w;
    };

    const ctx = DYNO.ctx;
    ctx.save();
    ctx.lineWidth = 2;
    ctx.strokeStyle = color;
    ctx.beginPath();

    for (let i=0; i<series.length; i++){
      const p = series[i];
      const x = scaleX(p.dist);
      const y = scaleY(getter(p) || 0);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.restore();
  }

  function drawCurveDistRPM(series, getter, color, rMin, rMax, x0, y0, w, h, dMin, dMax){
    if (!series || series.length < 2) return;

    const scaleY = (rpm) => {
      rpm = clampNum(rpm, rMin, rMax, rMin);
      const t = (rpm - rMin) / Math.max(1e-6, (rMax - rMin));
      return y0 + h - t*h;
    };
    const scaleX = (d) => {
      d = clampNum(d, dMin, dMax, dMin);
      const t = (d - dMin) / Math.max(1e-6, (dMax - dMin));
      return x0 + t*w;
    };

    const ctx = DYNO.ctx;
    ctx.save();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = color;
    ctx.beginPath();

    for (let i=0; i<series.length; i++){
      const p = series[i];
      const x = scaleX(p.dist);
      const y = scaleY(getter(p) || rMin);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.restore();
  }

  // ==========================
  // UTIL
  // ==========================
  function downloadCSV(text, filename){
    const blob = new Blob([text], {type:"text/csv"});
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename || "dyno.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(a.href);
  }

  function clampNum(v, a, b, def){
    v = Number(v);
    if (!isFinite(v)) return def;
    if (v < a) return a;
    if (v > b) return b;
    return v;
  }

  function clampInt(v, a, b, def){
    v = Math.round(Number(v));
    if (!isFinite(v)) return def;
    if (v < a) return a;
    if (v > b) return b;
    return v;
  }

  function roundUp(v, step){
    return Math.ceil(v / step) * step;
  }

  function roundRect(ctx, x, y, w, h, r){
    const rr = Math.max(0, Math.min(r, Math.min(w, h)/2));
    ctx.moveTo(x+rr, y);
    ctx.arcTo(x+w, y, x+w, y+h, rr);
    ctx.arcTo(x+w, y+h, x, y+h, rr);
    ctx.arcTo(x, y+h, x, y, rr);
    ctx.arcTo(x, y, x+w, y, rr);
    ctx.closePath();
  }

  // kick init
  if (document.readyState === "complete" || document.readyState === "interactive"){
    setTimeout(() => { try{ window.DYNO_init(); }catch(e){} }, 0);
  } else {
    document.addEventListener("DOMContentLoaded", () => {
      try{ window.DYNO_init(); }catch(e){}
    }, { once:true });
  }

})();
