/* =========================================================
   ESP API – HYBRID SIMULATION MODE (FINAL 2026)
   - READ & STATUS pakai simulasi
   - LIVE RPM realistis (idle–rev random)
   - KIRIM MAP tetap real ke ESP
   - Tanpa import/export → langsung global (window.*)
========================================================= */

const ESP_HOST = "http://cdi.local"; // alamat ESP sungguhan
const SIM_DELAY = 400;               // jeda simulasi (ms)
console.log("%c[ESP-API] MODE: HYBRID SIMULATION ACTIVE", "color:#4cff8f");

/* =========================================================
   STATUS CDI (SIMULASI)
   - Selalu aktif untuk uji coba tanpa perangkat
========================================================= */
window.getESPStatus = async function() {
  await delay(SIM_DELAY / 2);
  return {
    online: true,
    engine_running: false,
    active_cdi: "basic"
  };
};

/* =========================================================
   READ MAP DATA (SIMULASI)
   - Menghasilkan kurva dinamis dari 500–20000 RPM
   - Nilai dibuat seperti hasil pembacaan nyata
========================================================= */
window.getMapFromESP = async function() {
  await delay(SIM_DELAY); // delay biar terasa seperti koneksi asli

  const rpmPoints = [];
  for (let r = 500; r <= 20000; r += 250) rpmPoints.push(r);

  // bentuk kurva pengapian (naik lalu datar)
  const curve = rpmPoints.map((r, i) => {
    const base = 14 + Math.sin(i / 6) * 1.2;
    return r >= 9500 ? 14 : base;
  });

  return {
    pickup: 78,
    limiter: 9500,
    curve,
    status: "ACTIVE",
    live: false,
    liveRPM: 0
  };
};

/* =========================================================
   LIVE RPM (SIMULASI)
   - Menghasilkan RPM acak realistis seperti mesin hidup
   - Idle 1000–2000, naik random 3000–12000
========================================================= */
window.getLiveRPM = async function() {
  // 10% kemungkinan mesin drop → nol
  if (Math.random() < 0.1) return 0;

  const mode = Math.random();
  if (mode < 0.3) return 1000 + Math.random() * 800;  // idle
  if (mode < 0.6) return 3000 + Math.random() * 2000; // cruise
  return 6000 + Math.random() * 6000;                 // rev
};

/* =========================================================
   KIRIM MAP KE ESP (REAL)
   - Simulasi hanya READ & LIVE
   - KIRIM akan fetch ke ESP_HOST
========================================================= */
window.sendMapToESP = async function(mapData) {
  try {
    const res = await fetch(`${ESP_HOST}/map`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(mapData)
    });

    if (!res.ok) throw new Error("SEND_FAIL");

    console.log("%c[ESP SEND] MAP terkirim ke ESP", "color:#4cff8f");
    return { ok: true };
  } catch (err) {
    console.warn("[ESP SEND FAIL]", err.message);
    return { ok: false, reason: "SEND_FAIL" };
  }
};

/* =========================================================
   HELPER: DELAY PROMISE
========================================================= */
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
