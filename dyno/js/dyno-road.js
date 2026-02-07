/* =========================================================
   dyno-road.js — WEB UI (LOGS + RESET + READ FROM ESP32)
   - UI dipertahankan (HTML tidak perlu diubah)
   - Logs: max 20, newest di atas
   - STOP jadi RESET (hapus semua history web + hapus logs ESP32 RAM)
   - READ: tombol baru di kiri RUN, ambil semua log dari ESP32 RAM
========================================================= */

console.log("✅ dyno-road.js dimuat (LOGS + RESET + READ)");


(function(){
  "use strict";

  const UI_POLL_MS     = 16;
  const MAX_TABLE_ROWS = 800;

  // LOGS
  const MAX_LOGS = 20;
  const MAX_ROWS_PER_LOG = 800;

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

    // logs list
    logs:[],
    currentLog:null,
    logSeq:0,

    // ui timers
    timer:null,
    polling:false,

    // status base
    statusBase:"READY",

    // for config debounce
    cfgPushTimer:null,

    // status progress bar
    statusProgressEl:null,
    statusAnimTimer:null,
    statusAnimPhase:0,

    // canvas
    cv:null,
    ctx:null
  };

  // ==========================
  // CONNECTION GUARD (WAJIB TERHUBUNG)
  // ==========================
  async function requireConnected(actionLabel){
    // Semua tombol harus terhubung ke modul dulu.
    // Kalau tidak terhubung, tampilkan pesan setiap klik tombol.
    try{
      ensureStatusProgressEl();
    }catch(e){}

    // kalau API conn tidak ada, fallback: coba snapshot
    let connected = false;
    let ip = "";

    try{
      if (typeof window.DYNO_getConn_DUAL === "function"){
        const c = await window.DYNO_getConn_DUAL();
        connected = !!(c && (c.connected || c.online));
        ip = (c && c.ip) ? String(c.ip) : "";
      } else if (typeof window.DYNO_getSnapshot_DUAL === "function"){
        const s = await window.DYNO_getSnapshot_DUAL();
        connected = !!s;
      }
    }catch(e){
      connected = false;
    }

    if (!connected){
      updateState("OFFLINE");
      const lbl = (actionLabel ? String(actionLabel).toUpperCase() : "AKSI");
      setStatus(lbl + ": MODUL TIDAK TERHUBUNG.");
      updateStatusProgress();
      DYNO_draw();
      return false;
    }

    // kalau terhubung, boleh lanjut
    return true;
  }


  // ==========================
  // INIT + DOM HOOK
  // ==========================
  window.DYNO_init = function(){
    hookInputs();
    hookButtons();
    injectReadButtonNearRun();
    hookLogUI();

    ensureStatusProgressEl();
    setStatus("READY");

    updateStatusProgress();
    updateLogInfo();
    DYNO_draw();
  };

  // kompatibilitas (kalau ada UI lama)
  window.DYNO_arm = async function(){
    if (!(await requireConnected("ARM"))) return;
    if (DYNO.running) return;

    readInputs();
    DYNO_reset(true);

    DYNO.armed = true;
    updateState("ARMED");

    ensureStatusProgressEl();
    setStatus("ARMED: siap RUN. Target = " + DYNO.targetM + " m");

    // kirim config + arm (opsional)
    if (typeof window.DYNO_setConfig_DUAL === "function") {
      try{
        await window.DYNO_setConfig_DUAL({
          targetM: DYNO.targetM,
          circM: DYNO.circM,
          pprFront: DYNO.pprFront,
          weightKg: DYNO.weightKg
        });
      }catch(e){}
    }

    if (typeof window.DYNO_arm_DUAL === "function") {
      try{ await window.DYNO_arm_DUAL(); }catch(e){}
    }

    await pollFromESP(true);
    updateStatusProgress();
    DYNO_draw();
  };

  window.DYNO_read = async function(){
    if (!(await requireConnected("READ"))) return;
    // READ: ambil semua log dari ESP32 (atau simulator) dan tampilkan di web
    ensureStatusProgressEl();
    setStatus("PROSES READ...");
    updateState("READ");

    try{
      if (typeof window.DYNO_getLogsMeta_DUAL !== "function" || typeof window.DYNO_getLog_DUAL !== "function"){
        setStatus("READ GAGAL: API logs belum ada (esp-api-dual.js).");
        updateState("READY");
        return;
      }

      // hentikan polling dulu biar tidak tabrakan
      if (DYNO.timer){
        clearInterval(DYNO.timer);
        DYNO.timer = null;
      }
      DYNO.polling = false;

      // bersihkan web logs dulu
      hardResetAll(true);

      const meta = await window.DYNO_getLogsMeta_DUAL();
      const list = (meta && meta.logs && Array.isArray(meta.logs)) ? meta.logs : [];

      if (!list.length){
        setStatus("READ: tidak ada history di ESP32.");
        updateState("READY");
        updateStatusProgress();
        DYNO_draw();
        return;
      }

      // tampilkan newest -> oldest
      const logsSorted = list.slice().sort((a,b)=> (Number(b.id||0)-Number(a.id||0)));

      DYNO.logs = [];
      DYNO.currentLog = null;
      DYNO.logSeq = 0;

      for (let i=0; i<logsSorted.length && i<MAX_LOGS; i++){
        const L = logsSorted[i];
        const id = Number(L.id || (i+1));
        if (id > DYNO.logSeq) DYNO.logSeq = id;

        const data = await window.DYNO_getLog_DUAL(id);
        const rows = (data && Array.isArray(data.rows)) ? data.rows : [];

        const log = {
          id: id,
          rows: rows.slice(0, MAX_ROWS_PER_LOG),
          maxHP: Number(L.maxHP ?? data.maxHP ?? 0) || 0,
          maxTQ: Number(L.maxTQ ?? data.maxTQ ?? 0) || 0,
          endTime: Number(L.endTime_s ?? (rows.length? (rows[rows.length-1].t_s ?? rows[rows.length-1].t ?? 0) : 0)) || 0,
          endDist: Number(L.endDist_m ?? (rows.length? (rows[rows.length-1].dist_m ?? rows[rows.length-1].dist ?? 0) : 0)) || 0,
          ts: Date.now()
        };

        DYNO.logs.push(log);
      }

      // set currentLog ke yang terbaru
      DYNO.currentLog = DYNO.logs.length ? DYNO.logs[0] : null;

      setStatus("READ OK: " + DYNO.logs.length + " log dibaca.");
      updateState("READY");
      updateStatusProgress();
      updateLogInfo();
      DYNO_draw();

    }catch(e){
      setStatus("READ GAGAL.");
      updateState("READY");
      updateStatusProgress();
      DYNO_draw();
    }
  };

  // HTML kamu pakai RUN langsung
  window.DYNO_run = async function(){
    if (!(await requireConnected("RUN"))) return;
    readInputs();

    // kalau user tidak klik ARM, tetap boleh RUN
    DYNO.armed = true;

    if (DYNO.running) return;

    // Saat RUN: buat log baru hanya kalau sebelumnya ada data
    startNewLogIfNeeded();

    DYNO.running = true;

    updateState("RUN");
    ensureStatusProgressEl();
    setStatus("RUN: firmware mulai timer setelah 1 putaran roda depan.");

    startStatusAnim();

    // kirim config
    if (typeof window.DYNO_setConfig_DUAL === "function") {
      try{
        await window.DYNO_setConfig_DUAL({
          targetM: DYNO.targetM,
          circM: DYNO.circM,
          pprFront: DYNO.pprFront,
          weightKg: DYNO.weightKg
        });
      }catch(e){}
    }

    if (typeof window.DYNO_run_DUAL === "function") {
      try{ await window.DYNO_run_DUAL(); }catch(e){}
    }

    if (DYNO.timer) clearInterval(DYNO.timer);
    DYNO.timer = setInterval(() => pollFromESP(false), UI_POLL_MS);

    updateStatusProgress();
    updateLogInfo();
    DYNO_draw();
  };

  window.DYNO_stop = async function(){
    if (!(await requireConnected("RESET"))) return;
    // STOP jadi RESET: hapus semua history (web + ESP32 logs RAM)
    if (DYNO.timer){
      clearInterval(DYNO.timer);
      DYNO.timer = null;
    }

    DYNO.running = false;
    DYNO.armed = false;

    stopStatusAnim();

    updateState("RESET");
    setStatus("RESET: hapus semua history.");

    updateStatusProgress();
    DYNO_draw();

    if (typeof window.DYNO_stop_DUAL === "function") {
      try{ await window.DYNO_stop_DUAL(); }catch(e){}
    }
    if (typeof window.DYNO_reset_DUAL === "function") {
      try{ await window.DYNO_reset_DUAL(); }catch(e){}
    }

    // hapus history/log di ESP32 (RAM)
    if (typeof window.DYNO_clearLogs_DUAL === "function") {
      try{ await window.DYNO_clearLogs_DUAL(); }catch(e){}
    }

    // hapus semua log di web
    hardResetAll(false);
  };

  window.DYNO_reset = async function(quiet){
    // legacy: dipanggil internal
    DYNO_reset(!!quiet);
    if (!quiet) setStatus("RESET.");
    updateStatusProgress();
    updateLogInfo();
    DYNO_draw();

    if (typeof window.DYNO_reset_DUAL === "function") {
      try{ await window.DYNO_reset_DUAL(); }catch(e){}
    }
  };

  window.DYNO_saveCSV = function(){
    // SAVE ALL LOGS (1..N) sekaligus
    if (!DYNO.logs.length){
      setStatus("DATA KOSONG. RUN atau READ dulu.");
      return;
    }

    const lines = [];
    lines.push(["log_id","no","time_s","rpm","hp","tq_nm","speed_kmh","dist_m"].join(","));

    DYNO.logs.forEach(log => {
      const rows = log.rows || [];
      for (let i=0; i<rows.length; i++){
        const r = rows[i];
        const t   = Number(r.t_s ?? r.t ?? 0) || 0;
        const rpm = Number(r.rpm ?? 0) || 0;
        const hp  = Number(r.hp ?? 0) || 0;
        const tq  = Number(r.tq ?? 0) || 0;
        const spd = Number(r.speed_kmh ?? r.spd ?? r.speed ?? 0) || 0;
        const dist= Number(r.dist_m ?? r.dist ?? 0) || 0;
        lines.push([log.id, i+1, t.toFixed(3), rpm.toFixed(0), hp.toFixed(3), tq.toFixed(3), spd.toFixed(2), dist.toFixed(2)].join(","));
      }
    });

    const csv = lines.join("\n");
    downloadText("dyno_logs.csv", csv);
    setStatus("CSV disimpan: dyno_logs.csv");
  };

  // ==========================
  // INTERNAL STATE
  // ==========================
  function DYNO_reset(quiet){
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

    if (!quiet){
      updateState("READY");
      ensureStatusProgressEl();
      setStatus("READY");
    }
  }

  function hardResetAll(quiet){
    DYNO_reset(quiet);
    DYNO.logs = [];
    DYNO.currentLog = null;
    DYNO.logSeq = 0;
    updateLogInfo();
  }

  function startNewLogIfNeeded(){
    // buat log baru kalau logs kosong atau log terakhir sudah punya data
    const last = DYNO.logs.length ? DYNO.logs[0] : null;
    if (!last || (last.rows && last.rows.length)){
      DYNO.logSeq = (DYNO.logSeq || 0) + 1;

      const log = {
        id: DYNO.logSeq,
        rows: [],
        maxHP: 0,
        maxTQ: 0,
        endTime: 0,
        endDist: 0,
        ts: Date.now()
      };

      DYNO.logs.unshift(log);
      if (DYNO.logs.length > MAX_LOGS) DYNO.logs.length = MAX_LOGS;

      DYNO.currentLog = log;
    }
  }

  // ==========================
  // HOOK UI
  // ==========================
  function hookInputs(){
    const ids = ["in_target","in_circ","in_weight","in_ppr"];
    ids.forEach(id => {
      const el = document.getElementById(id);
      if (el){
        el.addEventListener("change", onConfigChanged);
        el.addEventListener("input",  onConfigChanged);
      }
    });
  }

  function hookButtons(){
    // tidak ubah HTML, hanya pastikan tombol memanggil fungsi global
    // ARM / RUN / STOP sudah ada onclick di HTML kamu
  }

  function injectReadButtonNearRun(){
    // sisipkan tombol READ sebelum RUN (tanpa ubah HTML file)
    try{
      const btns = document.querySelector(".btns");
      if (!btns) return;

      let runBtn = null;
      const candidates = btns.querySelectorAll("button");
      candidates.forEach(b => {
        const t = (b.textContent || "").trim().toUpperCase();
        const oc = (b.getAttribute("onclick") || "").toLowerCase();
        if (!runBtn && (t === "RUN" || oc.includes("dyno_run"))) runBtn = b;
      });
      if (!runBtn) return;

      if (btns.querySelector("#btnReadLogs")) return;

      const b = document.createElement("button");
      b.id = "btnReadLogs";
      b.className = runBtn.className; // samakan style box
      b.textContent = "READ";
      b.type = "button";
      b.onclick = () => { try{ window.DYNO_read(); }catch(e){} };

      btns.insertBefore(b, runBtn);
    }catch(e){}
  }

  function onConfigChanged(){
    readInputs();
    updateInfoBox();
    updateStatusProgress();
    DYNO_draw();

    // optional: push config ke ESP meskipun belum RUN
    debouncePushConfigToESP();
  }

  function debouncePushConfigToESP(){
    if (DYNO.cfgPushTimer) clearTimeout(DYNO.cfgPushTimer);
    DYNO.cfgPushTimer = setTimeout(async () => {
      DYNO.cfgPushTimer = null;

      if (typeof window.DYNO_setConfig_DUAL !== "function") return;

      // kalau lagi RUN, jangan ganggu
      if (DYNO.running) return;

      try{
        await window.DYNO_setConfig_DUAL({
          targetM: DYNO.targetM,
          circM: DYNO.circM,
          pprFront: DYNO.pprFront,
          weightKg: DYNO.weightKg
        });
      }catch(e){}
    }, 450);
  }

  function readInputs(){
    const a = document.getElementById("in_target");
    const b = document.getElementById("in_circ");
    const c = document.getElementById("in_weight");
    const d = document.getElementById("in_ppr");

    if (a) DYNO.targetM  = clampNum(parseFloat(a.value), 1, 5000, DYNO.targetM);
    if (b) DYNO.circM    = clampNum(parseFloat(b.value), 0.1, 10,  DYNO.circM);
    if (c) DYNO.weightKg = clampNum(parseFloat(c.value), 1,  500,  DYNO.weightKg);
    if (d) DYNO.pprFront = clampNum(parseFloat(d.value), 1,  200,  DYNO.pprFront);
  }

  function updateInfoBox(){
    // update info text kecil kalau ada
    const el = document.getElementById("d_info");
    if (!el) return;
    el.textContent =
      "Target " + DYNO.targetM + "m | Circ " + DYNO.circM.toFixed(2) + "m | W " + DYNO.weightKg + "kg | PPR " + DYNO.pprFront;
  }

  // ==========================
  // LOG UI
  // ==========================
  function hookLogUI(){
    // dropdown/select log (kalau ada)
    const sel = document.getElementById("logSelect");
    if (sel){
      sel.addEventListener("change", () => {
        const id = Number(sel.value || 0);
        const log = DYNO.logs.find(x => Number(x.id) === id) || null;
        DYNO.currentLog = log;
        updateLogInfo();
        DYNO_draw();
      });
    }

    // tombol CSV (kalau ada)
    const b = document.getElementById("btnCSV");
    if (b){
      b.addEventListener("click", () => window.DYNO_saveCSV());
    }
  }

  function updateLogInfo(){
    // render select & info
    const sel = document.getElementById("logSelect");
    if (sel){
      // build options
      sel.innerHTML = "";
      DYNO.logs.forEach((log, idx) => {
        const opt = document.createElement("option");
        opt.value = String(log.id);
        opt.textContent = "LOG " + log.id + (idx===0 ? " (NEWEST)" : "");
        sel.appendChild(opt);
      });

      // set selected
      if (DYNO.currentLog){
        sel.value = String(DYNO.currentLog.id);
      } else if (DYNO.logs.length){
        sel.value = String(DYNO.logs[0].id);
        DYNO.currentLog = DYNO.logs[0];
      }
    }

    const info = document.getElementById("logInfo");
    if (info){
      if (!DYNO.currentLog){
        info.textContent = "Tidak ada LOG.";
      } else {
        const log = DYNO.currentLog;
        info.textContent =
          "LOG " + log.id +
          " | rows " + ((log.rows && log.rows.length) ? log.rows.length : 0) +
          " | maxHP " + (Number(log.maxHP||0).toFixed(2)) +
          " | maxTQ " + (Number(log.maxTQ||0).toFixed(2));
      }
    }
  }

  // ==========================
  // POLLING FROM ESP (LIVE)
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

      DYNO.armed   = fwArmed;
      DYNO.running = fwRunning;

      // ---- CONFIG echo dari firmware
      if (isFinite(Number(snap.targetM)) && Number(snap.targetM) > 0)  DYNO.targetM  = Math.max(1, Number(snap.targetM));
      if (isFinite(Number(snap.circM))   && Number(snap.circM) > 0)    DYNO.circM    = Number(snap.circM);
      if (isFinite(Number(snap.pprFront))&& Number(snap.pprFront)>0)   DYNO.pprFront = Math.max(1, Math.round(Number(snap.pprFront)));
      if (isFinite(Number(snap.weightKg))&& Number(snap.weightKg)>0)   DYNO.weightKg = Math.max(1, Math.round(Number(snap.weightKg)));

      // ---- LIVE computed FROM FIRMWARE
      const t_s      = Number(snap.t_s ?? snap.t ?? 0);
      const dist_m   = Number(snap.dist_m ?? snap.distM ?? snap.dist ?? 0);
      const spd_kmh  = Number(snap.speed_kmh ?? snap.speedKmh ?? snap.spd ?? snap.speed ?? 0);
      const rpm      = Number(snap.rpm ?? 0);
      const tq       = Number(snap.tq ?? 0);
      const hp       = Number(snap.hp ?? 0);

      DYNO.t        = isFinite(t_s)     ? t_s     : DYNO.t;
      DYNO.distM    = isFinite(dist_m)  ? dist_m  : DYNO.distM;
      DYNO.speedKmh = isFinite(spd_kmh) ? spd_kmh : DYNO.speedKmh;
      DYNO.rpm      = isFinite(rpm)     ? rpm     : DYNO.rpm;
      DYNO.tq       = isFinite(tq)      ? tq      : DYNO.tq;
      DYNO.hp       = isFinite(hp)      ? hp      : DYNO.hp;

      // max
      DYNO.maxHP = Math.max(DYNO.maxHP || 0, DYNO.hp || 0);
      DYNO.maxTQ = Math.max(DYNO.maxTQ || 0, DYNO.tq || 0);

      // ---- status text
      if (fwRunning){
        if (gateWait){
          setStatus("RUN: menunggu 1 putaran roda depan (gate) ...");
        } else {
          setStatus("RUNNING: " + DYNO.distM.toFixed(1) + " / " + DYNO.targetM + " m");
        }
      } else if (fwArmed){
        setStatus("ARMED: siap RUN. Target = " + DYNO.targetM + " m");
      } else {
        // tetap READY kalau tidak running
        // jangan override status kalau sedang READ/RESET
        const st = (document.getElementById("d_state")?.textContent || "").toUpperCase();
        if (st !== "READ" && st !== "RESET") setStatus("READY");
      }

      // ---- append log row saat RUNNING & gate lewat
      if (fwRunning && !gateWait){
        startNewLogIfNeeded();

        const log = DYNO.logs.length ? DYNO.logs[0] : null;
        if (log){
          const row = {
            t_s: DYNO.t,
            dist_m: DYNO.distM,
            speed_kmh: DYNO.speedKmh,
            rpm: DYNO.rpm,
            tq: DYNO.tq,
            hp: DYNO.hp
          };

          log.rows.push(row);
          if (log.rows.length > MAX_ROWS_PER_LOG) log.rows.shift();

          log.maxHP = Math.max(Number(log.maxHP||0), Number(DYNO.hp||0));
          log.maxTQ = Math.max(Number(log.maxTQ||0), Number(DYNO.tq||0));
          log.endTime = DYNO.t;
          log.endDist = DYNO.distM;

          DYNO.currentLog = log;
        }
      }

      // stop anim jika firmware stop
      if (!fwRunning) stopStatusAnim();

      updateLiveUI();
      updateStatusProgress();
      updateLogInfo();
      DYNO_draw();

    }catch(e){
      // diam
    } finally {
      DYNO.polling = false;
    }
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
    setText("d_speed",     (DYNO.speedKmh||0).toFixed(1));
    setText("d_rpm",       Math.round(DYNO.rpm||0));
    setText("d_hp",        (DYNO.hp||0).toFixed(2));
    setText("d_tq",        (DYNO.tq||0).toFixed(2));

    setText("d_maxhp",     (DYNO.maxHP||0).toFixed(2));
    setText("d_maxtq",     (DYNO.maxTQ||0).toFixed(2));
  }

  function setText(id, v){
    const el = document.getElementById(id);
    if (el) el.textContent = String(v);
  }

  // ==========================
  // STATUS PROGRESS BAR (UI)
  // ==========================
  function ensureStatusProgressEl(){
    if (DYNO.statusProgressEl) return;

    const st = document.getElementById("d_status");
    if (!st) return;

    let wrap = document.getElementById("statusWrap");
    if (!wrap){
      wrap = document.createElement("div");
      wrap.id = "statusWrap";
      wrap.style.position = "relative";
      wrap.style.width = "100%";
      wrap.style.marginTop = "8px";
      st.parentNode.insertBefore(wrap, st.nextSibling);
    }

    let bar = document.getElementById("statusBar");
    if (!bar){
      bar = document.createElement("div");
      bar.id = "statusBar";
      bar.style.height = "6px";
      bar.style.width = "100%";
      bar.style.borderRadius = "6px";
      bar.style.opacity = "0.85";
      bar.style.background = "rgba(255,255,255,0.15)";

      let fill = document.createElement("div");
      fill.id = "statusFill";
      fill.style.height = "100%";
      fill.style.width = "0%";
      fill.style.borderRadius = "6px";
      fill.style.background = "rgba(0,255,102,0.8)";
      fill.style.transition = "width 120ms linear";
      bar.appendChild(fill);

      wrap.appendChild(bar);
    }

    DYNO.statusProgressEl = bar;
  }

  function startStatusAnim(){
    if (DYNO.statusAnimTimer) return;
    DYNO.statusAnimPhase = 0;
    DYNO.statusAnimTimer = setInterval(() => {
      DYNO.statusAnimPhase = (DYNO.statusAnimPhase + 1) % 16;
      updateStatusProgress(true);
    }, 80);
  }

  function stopStatusAnim(){
    if (DYNO.statusAnimTimer){
      clearInterval(DYNO.statusAnimTimer);
      DYNO.statusAnimTimer = null;
      DYNO.statusAnimPhase = 0;
      updateStatusProgress(false);
    }
  }

  function updateStatusProgress(animated){
    ensureStatusProgressEl();
    const fill = document.getElementById("statusFill");
    if (!fill) return;

    // progress = dist/target (kalau target ada)
    const target = Math.max(1e-6, Number(DYNO.targetM)||1);
    let p = clamp01((Number(DYNO.distM)||0) / target);

    // kalau RUN tapi gate_wait, bikin anim bolak-balik
    const snap = DYNO.lastSnap || {};
    const gateWait = !!(snap.gate_wait ?? snap.gateWait);

    if (DYNO.running && gateWait){
      // anim 0..1..0
      const phase = (DYNO.statusAnimPhase||0) / 15;
      p = 0.2 + 0.6 * (phase < 0.5 ? phase*2 : (1-phase)*2);
    } else if (DYNO.running && animated){
      // sedikit shimmer
      const phase = (DYNO.statusAnimPhase||0) / 15;
      p = clamp01(p + 0.03 * Math.sin(phase * Math.PI * 2));
    }

    fill.style.width = Math.round(p * 100) + "%";
  }

  // ==========================
  // CANVAS DRAW
  // ==========================
  function DYNO_draw(){
    ensureCanvas();

    if (!DYNO.ctx) return;

    const ctx = DYNO.ctx;
    const w = DYNO.cv.width;
    const h = DYNO.cv.height;

    ctx.clearRect(0,0,w,h);

    // draw axis (RPM fixed)
    drawAxis(ctx, w, h);

    // draw current log or live
    if (DYNO.currentLog && DYNO.currentLog.rows && DYNO.currentLog.rows.length){
      drawLog(ctx, w, h, DYNO.currentLog.rows);
    } else {
      // no log yet: draw empty
      drawEmpty(ctx, w, h);
    }
  }

  function ensureCanvas(){
    if (DYNO.cv && DYNO.ctx) return;

    const cv = document.getElementById("dynoCanvas") || document.querySelector("canvas");
    if (!cv) return;

    DYNO.cv = cv;
    DYNO.ctx = cv.getContext("2d");

    // auto resize to parent
    resizeCanvasToParent();
    window.addEventListener("resize", resizeCanvasToParent);

    function resizeCanvasToParent(){
      const p = cv.parentElement;
      if (!p) return;
      const r = p.getBoundingClientRect();
      const ww = Math.max(320, Math.floor(r.width));
      const hh = Math.max(220, Math.floor(r.height));
      cv.width = ww;
      cv.height = hh;
      DYNO_draw();
    }
  }

  function drawAxis(ctx, w, h){
    const padL = 55;
    const padR = 20;
    const padT = 14;
    const padB = 28;

    // background grid
    ctx.save();
    ctx.globalAlpha = 0.22;
    ctx.strokeStyle = "rgba(255,255,255,0.25)";
    ctx.lineWidth = 1;

    const gridN = 8;
    for (let i=0; i<=gridN; i++){
      const y = padT + (h-padT-padB) * (i/gridN);
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(w-padR, y);
      ctx.stroke();
    }
    for (let i=0; i<=gridN; i++){
      const x = padL + (w-padL-padR) * (i/gridN);
      ctx.beginPath();
      ctx.moveTo(x, padT);
      ctx.lineTo(x, h-padB);
      ctx.stroke();
    }
    ctx.restore();

    // axis frame
    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.55)";
    ctx.lineWidth = 1.2;
    ctx.strokeRect(padL, padT, w-padL-padR, h-padT-padB);
    ctx.restore();

    // rpm labels left
    ctx.save();
    ctx.fillStyle = RPM_COLOR;
    ctx.font = "12px sans-serif";

    const rpmMin = FIXED_RPM_START;
    const rpmMax = FIXED_RPM_END;

    const labelN = 6;
    for (let i=0; i<=labelN; i++){
      const y = padT + (h-padT-padB) * (i/labelN);
      const rpm = Math.round(rpmMax - (rpmMax-rpmMin) * (i/labelN));
      ctx.fillText(String(rpm), 6, y+4);
    }
    ctx.restore();
  }

  function drawEmpty(ctx, w, h){
    ctx.save();
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.font = "14px sans-serif";
    ctx.fillText("Belum ada data. Klik ARM lalu RUN, atau READ.", 20, 40);
    ctx.restore();
  }

  function drawLog(ctx, w, h, rows){
    const padL = 55;
    const padR = 20;
    const padT = 14;
    const padB = 28;

    const plotW = w - padL - padR;
    const plotH = h - padT - padB;

    // x axis by rpm
    const rpmMin = FIXED_RPM_START;
    const rpmMax = FIXED_RPM_END;

    // scale y by max of hp/tq in rows
    let maxHP = 0, maxTQ = 0;
    for (let i=0; i<rows.length; i++){
      const r = rows[i];
      maxHP = Math.max(maxHP, Number(r.hp||0) || 0);
      maxTQ = Math.max(maxTQ, Number(r.tq||0) || 0);
    }
    const yMax = Math.max(1, Math.max(maxHP, maxTQ) * 1.05);

    // draw HP
    ctx.save();
    ctx.strokeStyle = HP_COLOR;
    ctx.lineWidth = 2;

    ctx.beginPath();
    let moved = false;
    for (let i=0; i<rows.length; i++){
      const r = rows[i];
      const rpm = Number(r.rpm||0) || 0;
      if (rpm <= 0) continue;

      const x = padL + plotW * clamp01((rpm - rpmMin) / (rpmMax - rpmMin));
      const y = padT + plotH * (1 - clamp01((Number(r.hp||0) || 0) / yMax));

      if (!moved){ ctx.moveTo(x,y); moved = true; }
      else ctx.lineTo(x,y);
    }
    ctx.stroke();
    ctx.restore();

    // draw TQ
    ctx.save();
    ctx.strokeStyle = TQ_COLOR;
    ctx.lineWidth = 2;

    ctx.beginPath();
    moved = false;
    for (let i=0; i<rows.length; i++){
      const r = rows[i];
      const rpm = Number(r.rpm||0) || 0;
      if (rpm <= 0) continue;

      const x = padL + plotW * clamp01((rpm - rpmMin) / (rpmMax - rpmMin));
      const y = padT + plotH * (1 - clamp01((Number(r.tq||0) || 0) / yMax));

      if (!moved){ ctx.moveTo(x,y); moved = true; }
      else ctx.lineTo(x,y);
    }
    ctx.stroke();
    ctx.restore();

    // legend
    ctx.save();
    ctx.font = "12px sans-serif";
    ctx.fillStyle = HP_COLOR;
    ctx.fillText("HP", w-70, 18);
    ctx.fillStyle = TQ_COLOR;
    ctx.fillText("TQ", w-40, 18);
    ctx.restore();
  }

  // ==========================
  // HELPERS
  // ==========================
  function clamp01(v){ return Math.max(0, Math.min(1, v)); }
  function clampNum(v, a, b, fallback){
    if (!isFinite(v)) return fallback;
    return Math.max(a, Math.min(b, v));
  }

  function downloadText(name, text){
    const blob = new Blob([text], {type:"text/plain"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
      a.remove();
    }, 200);
  }

})();
