// honda_hex.js — HEX per tipe motor (mudah dikembangkan)

// Helper: ASCII -> HEX
function asciiToHex(str){
  let out = "";
  for(let i=0;i<str.length;i++){
    out += str.charCodeAt(i).toString(16).padStart(2,"0");
  }
  return out.toUpperCase();
}

// ===== Database HEX per motor =====
// Default saat ini sama (protokol sama) — nanti tinggal bedakan per motor.
const HONDA_HEX_DB = {
  ADV160: {
    name: "Honda ADV 160",
    CHECK_ECU: asciiToHex("MINTA_ID_ECM\n"),
    READ_ID:   asciiToHex("SMARTKEYSDGN\n"),
    RESET_ID:  asciiToHex("RESETidecmSDGN\n"),
    // offset ID di dump (kalau beda tiap motor, taruh di sini)
    ID_OFFSET: 0x40
  },

  VARIO160: {
    name: "Honda Vario 160",
    CHECK_ECU: asciiToHex("MINTA_ID_ECM\n"),
    READ_ID:   asciiToHex("SMARTKEYSDGN\n"),
    RESET_ID:  asciiToHex("RESETidecmSDGN\n"),
    ID_OFFSET: 0x40
  },

  PCX160: {
    name: "Honda PCX 160",
    CHECK_ECU: asciiToHex("MINTA_ID_ECM\n"),
    READ_ID:   asciiToHex("SMARTKEYSDGN\n"),
    RESET_ID:  asciiToHex("RESETidecmSDGN\n"),
    ID_OFFSET: 0x40
  }
};

// ===== Active profile (diisi dari pilihan dropdown) =====
let HONDA_HEX_ACTIVE_KEY = "VARIO160"; // default (bebas)
let HONDA_HEX = HONDA_HEX_DB[HONDA_HEX_ACTIVE_KEY];

// dipanggil saat user ganti motor
function setHondaMotorProfile(motorKey){
  if(HONDA_HEX_DB[motorKey]){
    HONDA_HEX_ACTIVE_KEY = motorKey;
    HONDA_HEX = HONDA_HEX_DB[motorKey];
    return true;
  }
  return false;
}

// optional: ambil info aktif
function getHondaMotorProfile(){
  return { key: HONDA_HEX_ACTIVE_KEY, ...(HONDA_HEX || {}) };
}
