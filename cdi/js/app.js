/* =========================================================
   APP CONTROLLER
   - Hanya mengatur menu & load CDI
   - Tambahan: menonaktifkan CDI sebelumnya saat pindah menu
========================================================= */

function toggleMenu(){
  const menu = document.getElementById("menuDropdown");
  menu.classList.toggle("hidden");
}

function clearMapArea(){
  const area = document.getElementById("contentArea");
  area.innerHTML = "";
  area.classList.remove("empty");
}

function selectCDI(type){
  toggleMenu();
  clearMapArea();

  // 🆕 Tambahkan: pastikan CDI lain dimatikan sebelum load baru
  if (typeof deactivateCDI_BASIC === "function") deactivateCDI_BASIC();
  if (typeof deactivateCDI_DUAL === "function") deactivateCDI_DUAL();
  if (typeof deactivateCDI_RACING === "function") deactivateCDI_RACING();

  // 🔽 Setelah semua off, baru muat CDI yang dipilih
  if(type === "basic"){
    if(typeof loadCDI_BASIC === "function"){
      loadCDI_BASIC();
    } else {
      console.error("Fungsi loadCDI_BASIC() tidak ditemukan");
    }
  }

  if(type === "dual"){
    if(typeof loadCDI_DUAL === "function"){
      loadCDI_DUAL();
    } else {
      console.error("Fungsi loadCDI_DUAL() tidak ditemukan");
    }
  }

  if(type === "racing"){
    if(typeof loadCDI_RACING === "function"){
      loadCDI_RACING();
    } else {
      console.error("Fungsi loadCDI_RACING() tidak ditemukan");
    }
  }
}

document.addEventListener("DOMContentLoaded", ()=>{
  const area = document.getElementById("contentArea");
  area.classList.add("empty");
  area.innerHTML = `
    <div class="empty-text">
      Pilih tipe CDI melalui menu ☰
    </div>
  `;
});
