/* =========================================================
   esp-api-dual.js — ESP32 DYNO API + AUTO SIMULATOR (NO PARAM REQUIRED)
   - Jika ESP32 tidak bisa diakses, otomatis masuk SIM mode
   - Dipakai oleh dyno-road.js (poll /snapshot 16ms)
   - Tambahan LOGS API:
       GET /logs_meta
       GET /logs?id=123
       GET /logs_clear
========================================================= */

(function(){
  "use strict";

  const DEFAULT_BASE = "http://192.168.4.1";
  const FETCH_TIMEOUT_MS = 900;

  const BASE = DEFAULT_BASE;

  let netEverOk = false;
  let forceSim = false;

  function withTimeout(promise, ms){
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("timeout")), ms);
      promise.then(v => { clearTimeout(t); resolve(v); })
             .catch(e => { clearTimeout(t); reject(e); });
    });
  }

  async function fetchJson(path, opt){
    const url = BASE + path;
    const options = opt || {};
    options.method = options.method || "GET";
    options.headers = options.headers || {};
    options.headers["Accept"] = "application/json";

    if (!forceSim){
      try{
        const r = await withTimeout(fetch(url, options), FETCH_TIMEOUT_MS);
        if (!r.ok) throw new Error("http_" + r.status);
        const j = await r.json();
        netEverOk = true;
        return j;
      }catch(e){
        if (netEverOk) throw e;
      }
    }

    return SIM.handle(path, options);
  }

  // ===== PUBLIC API =====
  window.DYNO_getStatus_DUAL = async function(){
    return fetchJson("/status");
  };

  window.DYNO_getSnapshot_DUAL = async function(){
    return fetchJson("/snapshot");
  };

  window.DYNO_setConfig_DUAL = async function(cfg){
    const qs = new URLSearchParams();
    if (cfg && cfg.targetM != null)  qs.set("targetM",  String(cfg.targetM));
    if (cfg && cfg.circM != null)    qs.set("circM",    String(cfg.circM));
    if (cfg && cfg.pprFront != null) qs.set("pprFront", String(cfg.pprFront));
    if (cfg && cfg.weightKg != null) qs.set("weightKg", String(cfg.weightKg));
    return fetchJson("/config?" + qs.toString());
  };

  window.DYNO_arm_DUAL = async function(){
    return fetchJson("/arm");
  };

  window.DYNO_run_DUAL = async function(){
    return fetchJson("/run");
  };

  window.DYNO_stop_DUAL = async function(){
    return fetchJson("/stop");
  };

  window.DYNO_reset_DUAL = async function(){
    return fetchJson("/reset");
  };

  // ===== LOGS API =====
  window.DYNO_getLogsMeta_DUAL = async function(){
    return fetchJson("/logs_meta");
  };

  window.DYNO_getLog_DUAL = async function(id){
    const qs = new URLSearchParams();
    if (id != null) qs.set("id", String(id));
    return fetchJson("/logs?" + qs.toString());
  };

  window.DYNO_clearLogs_DUAL = async function(){
    return fetchJson("/logs_clear");
  };

  // =========================================================
  // SIMULATOR
  // =========================================================
  const SIM = {
    cfg:{ targetM:200, circM:1.85, pprFront:1, weightKg:120 },

    armed:false,
    running:false,
    gate_wait:false,

    t_s:0,
    dist_m:0,
    speed_kmh:0,
    rpm:0,
    hp:0,
    tq:0,
    maxHP:0,
    maxTQ:0,

    _lastMs:0,
    _status:"SIM READY",

    logs:[],      // newest-first: [{id, rows:[{t,rpm,hp,tq,spd,dist}]}]
    _nextId:1,
    _active:null,
    _logLastSampleMs:0,

    _now(){
      return (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
    },

    _resetRunState(){
      this.t_s = 0;
      this.dist_m = 0;
      this.speed_kmh = 0;
      this.rpm = 0;
      this.hp = 0;
      this.tq = 0;
      this.maxHP = 0;
      this.maxTQ = 0;
    },

    _startNewLog(){
      this._active = { id: this._nextId++, rows: [] };
      this._logLastSampleMs = this._now();
    },

    _finalizeLog(){
      if (!this._active) return;
      if (!this._active.rows.length){
        this._active = null;
        return;
      }
      this.logs.unshift(this._active);
      if (this.logs.length > 20) this.logs.length = 20;
      this._active = null;
    },

    _appendRow(){
      if (!this._active) return;
      if (this._active.rows.length >= 800) return;

      this._active.rows.push({
        t: this.t_s,
        rpm: this.rpm,
        hp: this.hp,
        tq: this.tq,
        spd: this.speed_kmh,
        dist: this.dist_m
      });
    },

    _smoothStep(x){
      x = Math.max(0, Math.min(1, x));
      return x*x*(3 - 2*x);
    },

    _update(){
      const now = this._now();
      if (!this._lastMs) this._lastMs = now;
      let dt = (now - this._lastMs) / 1000;
      if (!isFinite(dt) || dt <= 0) dt = 0.016;
      if (dt > 0.1) dt = 0.1;
      this._lastMs = now;

      if (this.running && this.gate_wait){
        if (this.t_s >= 0.25){
          this.gate_wait = false;
          this._status = "SIM RUNNING";
        } else {
          this.t_s += dt;
          return;
        }
      }

      if (!this.running) return;

      this.t_s += dt;

      const target = Math.max(10, Number(this.cfg.targetM) || 200);

      const a = this._smoothStep( Math.min(1, this.t_s / 1.2) );
      const cruise = this._smoothStep( Math.min(1, (this.t_s-1.2)/2.0) );

      const vMax = 115;
      const v = vMax * (0.25*a + 0.75*cruise);
      const ripple = 1.0 + 0.015*Math.sin(this.t_s*7.0) + 0.01*Math.sin(this.t_s*13.0);
      this.speed_kmh = Math.max(0, v * ripple);

      const v_ms = this.speed_kmh / 3.6;
      this.dist_m += v_ms * dt;

      const rpmStart = 2600;
      const rpmEnd   = 18500;
      const rp = this._smoothStep( Math.min(1, this.t_s / 1.1) );
      this.rpm = rpmStart + (rpmEnd - rpmStart)*rp + 120*Math.sin(this.t_s*8.0);
      if (this.rpm < 0) this.rpm = 0;

      const hpMax = 55.0;
      const tqMax = 30.0;

      const hpShape = (0.55*a + 0.45*cruise);
      const tqShape = (0.75 - 0.25*cruise) * (0.85 + 0.15*a);

      this.hp = hpMax * hpShape * (0.98 + 0.03*Math.sin(this.t_s*5.2));
      this.tq = tqMax * tqShape * (0.98 + 0.03*Math.sin(this.t_s*4.1));

      if (this.hp > this.maxHP) this.maxHP = this.hp;
      if (this.tq > this.maxTQ) this.maxTQ = this.tq;

      if (this._active){
        const now2 = this._now();
        if ((now2 - this._logLastSampleMs) >= 20){
          this._logLastSampleMs = now2;
          this._appendRow();
        }
      }

      if (this.dist_m >= target){
        this.dist_m = target;
        this.running = false;
        this.armed = false;
        this.gate_wait = false;
        this._status = "SIM AUTO STOP";
        this._finalizeLog();
      }
    },

    async handle(path){
      this._update();

      const qPos = path.indexOf("?");
      const basePath = (qPos >= 0) ? path.slice(0, qPos) : path;

      if (basePath === "/status"){
        return { ok:1, sim:1, armed:this.armed, running:this.running, statusText:this._status };
      }

      if (basePath === "/config"){
        if (qPos >= 0){
          const qs = new URLSearchParams(path.slice(qPos+1));
          if (qs.has("targetM"))  this.cfg.targetM  = Number(qs.get("targetM")) || this.cfg.targetM;
          if (qs.has("circM"))    this.cfg.circM    = Number(qs.get("circM")) || this.cfg.circM;
          if (qs.has("pprFront")) this.cfg.pprFront = Number(qs.get("pprFront")) || this.cfg.pprFront;
          if (qs.has("weightKg")) this.cfg.weightKg = Number(qs.get("weightKg")) || this.cfg.weightKg;
        }
        return { ok:1, sim:1, ...this.cfg };
      }

      if (basePath === "/arm"){
        this.armed = true;
        this._status = "SIM ARMED";
        return { ok:1, sim:1, armed:this.armed };
      }

      if (basePath === "/run"){
        this.armed = true;
        this.running = true;
        this.gate_wait = true;
        this._status = "SIM RUN (WAIT 1 REV)";
        this._resetRunState();
        this._startNewLog();
        return { ok:1, sim:1, running:this.running };
      }

      if (basePath === "/stop"){
        this.running = false;
        this.armed = false;
        this.gate_wait = false;
        this._status = "SIM STOP";
        this._finalizeLog();
        return { ok:1, sim:1, running:this.running };
      }

      if (basePath === "/reset"){
        this.running = false;
        this.armed = false;
        this.gate_wait = false;
        this._status = "SIM RESET";
        this._resetRunState();
        return { ok:1, sim:1 };
      }

      if (basePath === "/snapshot"){
        return {
          ok:1,
          sim:1,
          armed:this.armed,
          running:this.running,
          gate_wait:this.gate_wait,
          gate_pulses:this.cfg.pprFront,

          targetM:this.cfg.targetM,
          circM:this.cfg.circM,
          pprFront:this.cfg.pprFront,
          weightKg:this.cfg.weightKg,

          t_s:this.t_s,
          dist_m:this.dist_m,
          speed_kmh:this.speed_kmh,

          rpm:this.rpm,
          hp:this.hp,
          tq:this.tq,
          maxHP:this.maxHP,
          maxTQ:this.maxTQ,

          statusText:this._status
        };
      }

      // LOGS
      if (basePath === "/logs_meta"){
        const logs = this.logs.map(L => ({
          id: L.id,
          rows: L.rows.length,
          targetM:this.cfg.targetM,
          circM:this.cfg.circM,
          pprFront:this.cfg.pprFront,
          weightKg:this.cfg.weightKg
        }));
        return { ok:1, sim:1, count: logs.length, logs };
      }

      if (basePath === "/logs"){
        let id = 0;
        if (qPos >= 0){
          const qs = new URLSearchParams(path.slice(qPos+1));
          if (qs.has("id")) id = Number(qs.get("id")) || 0;
        }
        if (!id && this.logs.length) id = this.logs[0].id;

        const L = this.logs.find(x => x.id === id);
        if (!L) return { ok:0, sim:1, err:"not_found" };
        return { ok:1, sim:1, id:L.id, rows: L.rows };
      }

      if (basePath === "/logs_clear"){
        this.logs = [];
        this._status = "SIM LOGS CLEARED";
        return { ok:1, sim:1, logs_cleared:1 };
      }

      return { ok:0, sim:1, err:"unknown_path", path: basePath };
    }
  };

})();
