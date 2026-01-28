/* =========================================================
   esp-api-dual.js — ESP API DUAL (HYBRID SIMULATION MODE)
   (kode kamu: tidak diubah)
========================================================= */

const ESP_HOST_DUAL = "http://cdi.local"; // alamat ESP sungguhan
const SIM_DELAY_DUAL = 400;
console.log("%c[ESP-API-DUAL] MODE: HYBRID SIMULATION ACTIVE", "color:#4cff8f");

/* =========================================================
   STATUS CDI DUAL (SIMULASI)
========================================================= */
window.getESPStatus_DUAL = async function() {
  await delayDual(SIM_DELAY_DUAL / 2);
  return {
    online: true,
    engine_running: false,
    active_cdi: "dual"
  };
};

/* =========================================================
   READ MAP DATA (SIMULASI)
========================================================= */
window.getMapFromESP_DUAL = async function() {
  await delayDual(SIM_DELAY_DUAL);

  const rpmPoints = [];
  for (let r = 500; r <= 20000; r += 250) rpmPoints.push(r);

  // ===== MAP 1 =====
  const limiter1 = 6000;
  const curve1 = rpmPoints.map((r, i) => {
    if (r <= 1000) return 10 + Math.sin(i / 5) * 1.5;
    if (r <= limiter1) return 12 + (r / limiter1) * 10;
    return 22;
  });

  // ===== MAP 2 =====
  const limiter2 = 7000;
  const curve2 = rpmPoints.map((r, i) => {
    if (r <= 1000) return 11 + Math.sin(i / 6) * 1.2;
    if (r <= limiter2) return 13 + (r / limiter2) * 11;
    return 24;
  });

  return {
    pickup: 78,
    maps: [
      { limiter: limiter1, curve: curve1 },
      { limiter: limiter2, curve: curve2 }
    ],
    status: "ACTIVE",
    live: false,
    liveRPM: 0
  };
};

/* =========================================================
   KIRIM MAP KE ESP (REAL / SIMULASI)
========================================================= */
window.sendMapToESP_DUAL = async function(mapData) {
  try {
    const res = await fetch(`${ESP_HOST_DUAL}/map-dual`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(mapData)
    });

    if (!res.ok) throw new Error("SEND_FAIL");

    console.log("%c[ESP SEND] MAP-DUAL terkirim ke ESP", "color:#4cff8f");
    return { ok: true };
  } catch (err) {
    console.warn("[ESP SEND FAIL DUAL]", err.message);
    return { ok: false, reason: "SEND_FAIL" };
  }
};

/* =========================================================
   LIVE RPM DUAL (REALISTIC SIMULATION)
========================================================= */
window.getLiveRPM_DUAL = async function() {
  if (Math.random() < 0.1) return 0;

  const mode = Math.random();
  if (mode < 0.3) return 1000 + Math.random() * 800;  // idle
  if (mode < 0.6) return 3000 + Math.random() * 2000; // cruising
  return 6000 + Math.random() * 6000;                 // revving
};

/* =========================================================
   LIVE AFR DUAL (REALISTIC SIMULATION)
========================================================= */
window.getLiveAFR_DUAL = async function(currentRPM = 0) {
  await delayDual(100); // sedikit jeda biar smooth

  if (currentRPM <= 0) return 0;

  let afr;
  if (currentRPM < 2000) {
    afr = 12.2 + Math.random() * 1.0; // idle → boros
  } else if (currentRPM < 5000) {
    afr = 13.8 + Math.random() * 1.2; // cruising → ideal
  } else if (currentRPM < 9000) {
    afr = 14.8 + Math.random() * 1.5; // mid-high
  } else {
    afr = 15.8 + Math.random() * 1.7; // high rev → lean
  }

  afr = Math.min(17.5, Math.max(11.5, afr));
  return parseFloat(afr.toFixed(1));
};

/* =========================================================
   HELPER: DELAY
========================================================= */
function delayDual(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
