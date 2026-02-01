/* =========================================================
   esp-api-dual.js — ESP API DUAL (REAL MODE + DEVICE PICK SUPPORT)
   - TANPA simulasi (simulasi dibuang)
   - Host ESP bisa dipilih (picker di cdi-dual.js)
   - Default pakai last host yang tersimpan di localStorage
   - Endpoint utama:
     GET  /status
     GET  /map-dual
     POST /map-dual
     GET  /live-rpm
     GET  /live-afr?rpm=xxxx   (opsional)
     GET  /scan               (opsional, kalau firmware menyediakan)
========================================================= */

console.log("%c[ESP-API-DUAL] MODE: REAL (NO SIM)", "color:#4cff8f");

/* =========================================================
   HOST MANAGEMENT
========================================================= */
// host aktif (akan di-set dari localStorage saat load)
let ESP_HOST_DUAL = "";

// key penyimpanan host terakhir
const ESP_HOST_STORE_KEY = "ESP_HOST_DUAL_LAST_OK";

// timeout default fetch
const ESP_FETCH_TIMEOUT_MS = 1200;

// helper normalize host
function normalizeHost(host) {
  if (!host) return "";
  let h = String(host).trim();
  if (!h) return "";
  // kalau user isi "192.168.1.4" -> jadikan http://192.168.1.4
  if (!/^https?:\/\//i.test(h)) h = "http://" + h;
  // buang trailing slash
  h = h.replace(/\/+$/, "");
  return h;
}

// load host terakhir (kalau ada)
(function initHostDual() {
  const saved = localStorage.getItem(ESP_HOST_STORE_KEY) || "";
  ESP_HOST_DUAL = normalizeHost(saved);
  if (!ESP_HOST_DUAL) {
    // fallback kosong: akan dianggap offline sampai user pilih ESP
    ESP_HOST_DUAL = "";
  }
  console.log("[ESP-API-DUAL] HOST =", ESP_HOST_DUAL || "(NOT SET)");
})();

// expose getter
window.getESPHost_DUAL = function () {
  return ESP_HOST_DUAL;
};

// setter dipakai oleh cdi-dual.js (tanpa reload)
window.setESPHost_DUAL = async function (host) {
  const h = normalizeHost(host);
  if (!h) throw new Error("INVALID_HOST");
  ESP_HOST_DUAL = h;
  localStorage.setItem(ESP_HOST_STORE_KEY, ESP_HOST_DUAL);

  // test cepat biar yakin
  const st = await window.getESPStatus_DUAL();
  if (!st || !st.online) {
    // tetap simpan, tapi kasih sinyal gagal
    throw new Error("HOST_UNREACHABLE");
  }
  return { ok: true, host: ESP_HOST_DUAL };
};

/* =========================================================
   FETCH HELPER (timeout + json safe)
========================================================= */
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

    // try json
    const txt = await res.text();
    try {
      return JSON.parse(txt);
    } catch {
      // kalau firmware balikin text, bungkus
      return { _raw: txt };
    }
  } finally {
    clearTimeout(t);
  }
}

// guard host
function requireHost() {
  if (!ESP_HOST_DUAL) throw new Error("HOST_NOT_SET");
}

/* =========================================================
   STATUS CDI DUAL (REAL)
   expected json contoh:
   {
     online:true,
     engine_running:false,
     active_cdi:"dual",
     ip:"192.168.1.4",
     name:"CDI POWER SMT A1",
     chip_id:"xxxx"
   }
========================================================= */
window.getESPStatus_DUAL = async function () {
  try {
    requireHost();
    const st = await fetchJSON(`${ESP_HOST_DUAL}/status`);
    // normalisasi minimal biar aman buat UI
    return {
      online: !!(st && (st.online === true || st.online === 1 || st.online === "1")),
      engine_running: !!(st && st.engine_running),
      active_cdi: (st && st.active_cdi) ? String(st.active_cdi) : "",
      ip: (st && st.ip) ? String(st.ip) : "",
      name: (st && st.name) ? String(st.name) : "",
      chip_id: (st && st.chip_id) ? String(st.chip_id) : ""
    };
  } catch (e) {
    return { online: false, engine_running: false, active_cdi: "" };
  }
};

/* =========================================================
   READ MAP DATA (REAL)
   expected json contoh:
   {
     pickup: 78,
     maps: [
       { limiter:6000, curve:[... panjang 79 utk 500-20000 step 250 ...] },
       { limiter:7000, curve:[... panjang 79 ...] }
     ],
     status:"ACTIVE"
   }
========================================================= */
window.getMapFromESP_DUAL = async function () {
  requireHost();
  const data = await fetchJSON(`${ESP_HOST_DUAL}/map-dual`);

  // validasi minimal
  if (!data || !data.maps || !Array.isArray(data.maps) || data.maps.length < 2) {
    throw new Error("BAD_MAP_DATA");
  }
  return data;
};

/* =========================================================
   SEND MAP KE ESP (REAL)
========================================================= */
window.sendMapToESP_DUAL = async function (mapData) {
  try {
    requireHost();
    const res = await fetchJSON(`${ESP_HOST_DUAL}/map-dual`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(mapData)
    }, 2500);

    // firmware boleh balikin {ok:true} atau text
    if (res && res.ok === false) throw new Error("SEND_FAIL");
    return { ok: true, res };
  } catch (err) {
    console.warn("[ESP SEND FAIL DUAL]", err && err.message ? err.message : err);
    return { ok: false, reason: (err && err.message) ? err.message : "SEND_FAIL" };
  }
};

/* =========================================================
   LIVE RPM (REAL)
   expected json contoh: { rpm: 3450 }
   atau { value: 3450 }
========================================================= */
window.getLiveRPM_DUAL = async function () {
  try {
    requireHost();
    const j = await fetchJSON(`${ESP_HOST_DUAL}/live-rpm`, {}, 900);
    const v = (j && typeof j.rpm !== "undefined") ? j.rpm :
              (j && typeof j.value !== "undefined") ? j.value : 0;
    const rpm = Math.max(0, Math.floor(Number(v) || 0));
    return rpm;
  } catch {
    return 0;
  }
};

/* =========================================================
   LIVE AFR (REAL)
   - kalau firmware punya endpoint /live-afr -> pakai
   - kalau butuh rpm sebagai parameter: /live-afr?rpm=xxxx
   expected json: { afr: 14.2 } atau { value: 14.2 }
========================================================= */
window.getLiveAFR_DUAL = async function (currentRPM = 0) {
  try {
    requireHost();

    // coba endpoint dengan param rpm (paling aman)
    const rpm = Math.max(0, Math.floor(Number(currentRPM) || 0));
    let j = await fetchJSON(`${ESP_HOST_DUAL}/live-afr?rpm=${encodeURIComponent(rpm)}`, {}, 900);

    // kalau firmware tidak support query, bisa balikin HTTP_404 -> coba tanpa query
    if (j && j._raw && /404/i.test(String(j._raw))) {
      j = await fetchJSON(`${ESP_HOST_DUAL}/live-afr`, {}, 900);
    }

    const v = (j && typeof j.afr !== "undefined") ? j.afr :
              (j && typeof j.value !== "undefined") ? j.value : 0;

    const afr = Number(v);
    if (!isFinite(afr) || afr <= 0) return 0;

    return parseFloat(afr.toFixed(1));
  } catch {
    return 0;
  }
};

/* =========================================================
   OPTIONAL: LIST ESP DEVICES (kalau firmware menyediakan /scan)
   return contoh:
   [
     { host:"http://192.168.1.10", name:"CDI POWER SMT A1", chip_id:"..." },
     ...
   ]
========================================================= */
window.listESP_DUAL = async function () {
  // kalau host belum dipilih, tidak bisa call /scan dari mana pun.
  // jadi: fallback kosong -> cdi-dual.js akan pakai scan range internal
  if (!ESP_HOST_DUAL) return [];

  try {
    const j = await fetchJSON(`${ESP_HOST_DUAL}/scan`, {}, 1800);
    if (Array.isArray(j)) {
      return j.map(it => ({
        host: normalizeHost(it.host || it.ip || ""),
        name: (it.name ? String(it.name) : ""),
        chip_id: (it.chip_id ? String(it.chip_id) : ""),
        online: true,
        active_cdi: (it.active_cdi ? String(it.active_cdi) : ""),
        engine_running: !!it.engine_running
      })).filter(x => !!x.host);
    }
    return [];
  } catch {
    return [];
  }
};
