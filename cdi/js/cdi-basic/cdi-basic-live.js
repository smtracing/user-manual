/* =========================================================
   CDI BASIC – LIVE MODULE (FINAL VERSION)
   - Menampilkan garis merah RPM real-time di grafik
   - Terhubung ke ESP (via getLiveRPM)
   - Otomatis fallback simulasi jika ESP offline
   - Tidak menyentuh UI tabel atau kurva lainnya
========================================================= */

window.toggleLive_BASIC = async function() {
  BASIC.live = !BASIC.live;
  const btn = document.getElementById("liveBtn");

  if (!btn) return;

  if (BASIC.live) {
    btn.textContent = "LIVE ON";
    btn.style.background = "#e74c3c";
    BASIC.liveTimer = setInterval(async () => {
      try {
        BASIC.liveRPM = await getLiveRPM();
      } catch {
        BASIC.liveRPM = 0;
      }
      redraw_BASIC();
    }, 200);
  } else {
    btn.textContent = "LIVE";
    btn.style.background = "#2ecc71";
    clearInterval(BASIC.liveTimer);
    BASIC.liveTimer = null;
    BASIC.liveRPM = 0;
    redraw_BASIC();
  }
};
