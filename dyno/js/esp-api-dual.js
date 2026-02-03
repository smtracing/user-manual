/* =========================================================
   esp-api-dyno.js — AP MODE ONLY (LIKE CDI: CONNECT IF FETCH OK)
   - Host tetap: http://192.168.4.1
   - "TERHUBUNG" jika GET /status OK, fallback GET /snapshot OK
   - Menyediakan API NAMA YANG DIMINTA dyno-road.js:
       DYNO_getConn_DUAL
       DYNO_getSnapshot_DUAL
       DYNO_getRowsSince_DUAL
       DYNO_setConfig_DUAL
       DYNO_arm_DUAL
       DYNO_run_DUAL
       DYNO_stop_DUAL
========================================================= */

console.log("%c[ESP-API-DYNO] AP ONLY (192.168.4.1) + FORCE CONNECT", "color:#4cff8f");

const ESP_HOST_DYNO = "http://192.168.4.1";
const ESP_FETCH_TIMEOUT_MS = 1200;

/* =========================
   FETCH HELPER (timeout + json safe)
========================= */
async function fetchJSON(url, opt = {}, timeoutMs = ESP_FETCH_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      cache: "no-store",
      ...opt,
      signal: ctrl.signal
    });

    if (!res.ok) throw new Error("HTTP_" + res.status);

    const txt = await res.text();
    try { return JSON.parse(txt); }
    catch { return { _raw: txt }; }
  } finally {
    clearTimeout(t);
  }
}

/* =========================================================
   CONNECT CHECK (DYNO_getConn_DUAL)
   - CONNECTED jika fetch berhasil (tanpa syarat rpm/pulse)
========================================================= */
window.DYNO_getConn_DUAL = async function () {
  // 1) coba /status
  try {
    await fetchJSON(`${ESP_HOST_DYNO}/status`, {}, 900);
    return { connected: true, ip: "192.168.4.1", via: "/status" };
  } catch (e) {
    // 2) fallback /snapshot
    try {
      await fetchJSON(`${ESP_HOST_DYNO}/snapshot`, {}, 900);
      return { connected: true, ip: "192.168.4.1", via: "/snapshot" };
    } catch {
      return { connected: false, ip: "192.168.4.1" };
    }
  }
};

/* =========================================================
   SNAPSHOT (DYNO_getSnapshot_DUAL)
   - dyno-road.js butuh object snap.
   - Kalau firmware kamu beda nama field, kita mapping aman.
========================================================= */
function mapSnapshotFields(sn) {
  if (!sn) return null;

  // dukung berbagai kemungkinan nama field
  const out = {};

  // state
  out.armed   = !!(sn.armed ?? sn.is_armed ?? sn.arm ?? false);
  out.running = !!(sn.running ?? sn.is_running ?? sn.run ?? false);

  // waktu / jarak / speed
  out.t       = Number(sn.t ?? sn.time_s ?? sn.time ?? 0);
  out.distM   = Number(sn.distM ?? sn.dist_m ?? sn.dist ?? 0);
  out.speedKmh= Number(sn.speedKmh ?? sn.speed_kmh ?? sn.speed ?? 0);

  // rpm / power / ign / afr
  out.rpm     = Number(sn.rpm ?? 0);
  out.tq      = Number(sn.tq ?? sn.torque ?? 0);
  out.hp      = Number(sn.hp ?? sn.power ?? 0);
  out.ign     = Number(sn.ign ?? sn.ignition ?? 0);
  out.afr     = Number(sn.afr ?? 14.7);

  // max
  out.maxTQ   = Number(sn.maxTQ ?? sn.max_tq ?? 0);
  out.maxHP   = Number(sn.maxHP ?? sn.max_hp ?? 0);

  // meta
  out.targetM   = Number(sn.targetM ?? sn.target_m ?? 0);
  out.rowsCount = Number(sn.rowsCount ?? sn.rows_count ?? 0);
  out.seq       = Number(sn.seq ?? sn.lastSeq ?? 0);

  // teks status
  out.statusText = String(sn.statusText ?? sn.status ?? "");

  return out;
}

window.DYNO_getSnapshot_DUAL = async function () {
  const sn = await fetchJSON(`${ESP_HOST_DYNO}/snapshot`, {}, 1200);
  return mapSnapshotFields(sn) || sn;
};

/* =========================================================
   ROWS INCREMENTAL (DYNO_getRowsSince_DUAL)
   - dyno-road.js akan panggil ini jika ada.
   - Jika firmware belum punya endpoint rows, kembalikan kosong
   - Endpoint yang dicoba:
       /rows?since=SEQ
       /rows-since?since=SEQ
       /log?since=SEQ
========================================================= */
window.DYNO_getRowsSince_DUAL = async function (sinceSeq = 0) {
  const s = Math.max(0, parseInt(sinceSeq, 10) || 0);

  const tries = [
    `${ESP_HOST_DYNO}/rows?since=${s}`,
    `${ESP_HOST_DYNO}/rows-since?since=${s}`,
    `${ESP_HOST_DYNO}/log?since=${s}`,
  ];

  for (const url of tries) {
    try {
      const j = await fetchJSON(url, {}, 1200);

      // format ideal: { seq:123, rows:[{t,rpm,tq,hp,ign,afr,dist,spd}, ...] }
      if (j && Array.isArray(j.rows)) {
        return {
          seq: Number(j.seq ?? s) || s,
          rows: j.rows
        };
      }
    } catch {}
  }

  return { seq: s, rows: [] };
};

/* =========================================================
   CONFIG (DYNO_setConfig_DUAL)
   - sesuai komentar kamu: GET /config?...
========================================================= */
window.DYNO_setConfig_DUAL = async function (cfg) {
  const q = new URLSearchParams({
    targetM:   String(cfg?.targetM ?? 200),
    circM:     String(cfg?.circM ?? 1.85),
    weightKg:  String(cfg?.weightKg ?? 120),
    pprFront:  String(cfg?.pprFront ?? 1),
    pprRear:   String(cfg?.pprRear ?? 1),
  }).toString();

  // jika firmware tidak ada /config, biarkan tidak meledak
  try {
    return await fetchJSON(`${ESP_HOST_DYNO}/config?${q}`, {}, 1200);
  } catch {
    return { ok: false, reason: "NO_CONFIG_ENDPOINT" };
  }
};

/* =========================================================
   ARM / RUN / STOP
   - Kita buat robust: coba beberapa endpoint umum.
   - Kalau tidak ada, tidak bikin UI crash.
========================================================= */
async function tryGET(paths, timeoutMs = 1200) {
  for (const p of paths) {
    try {
      const j = await fetchJSON(`${ESP_HOST_DYNO}${p}`, {}, timeoutMs);
      return { ok: true, j, path: p };
    } catch {}
  }
  return { ok: false };
}

window.DYNO_arm_DUAL = async function (cfg) {
  // set config dulu (kalau ada)
  try { await window.DYNO_setConfig_DUAL(cfg); } catch {}

  // coba endpoint arm / reset
  const r = await tryGET(
    ["/arm", "/reset", "/ready"],
    1400
  );

  // kalau tidak ada endpoint, tetap balikin ok=false (biar kamu tahu firmware belum lengkap)
  return r.ok ? { ok: true, ...r } : { ok: false, reason: "NO_ARM_ENDPOINT" };
};

window.DYNO_run_DUAL = async function () {
  const r = await tryGET(
    ["/run", "/start"],
    1400
  );
  return r.ok ? { ok: true, ...r } : { ok: false, reason: "NO_RUN_ENDPOINT" };
};

window.DYNO_stop_DUAL = async function (_reason = "STOP") {
  const r = await tryGET(
    ["/stop", "/halt"],
    1400
  );
  return r.ok ? { ok: true, ...r } : { ok: false, reason: "NO_STOP_ENDPOINT" };
};
