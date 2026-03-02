// honda_hex.js — HEX per tipe motor + offset split untuk ID (LO/H I)

function asciiToHex(str){
  let out = "";
  for(let i=0;i<str.length;i++){
    out += str.charCodeAt(i).toString(16).padStart(2,"0");
  }
  return out.toUpperCase();
}

const HONDA_HEX_DB = {
  ADV160: {
    name: "Honda ADV 160",
    CHECK_ECU: asciiToHex("MINTA_ID_ECM\n"),
    READ_ID:   asciiToHex("SMARTKEYSDGN\n"),
    RESET_ID:  asciiToHex("RESETidecmSDGN\n"),
    // ID split: 2 byte di 0x40, 2 byte di 0x50
    ID_OFFSET_LO: 0x40,
    ID_OFFSET_HI: 0x50
  },

  VARIO160: {
    name: "Honda Vario 160",
    CHECK_ECU: asciiToHex("MINTA_ID_ECM\n"),
    READ_ID:   asciiToHex("SMARTKEYSDGN\n"),
    RESET_ID:  asciiToHex("RESETidecmSDGN\n"),
    ID_OFFSET_LO: 0x40,
    ID_OFFSET_HI: 0x50
  },

  PCX160: {
    name: "Honda PCX 160",
    CHECK_ECU: asciiToHex("MINTA_ID_ECM\n"),
    READ_ID:   asciiToHex("SMARTKEYSDGN\n"),
    RESET_ID:  asciiToHex("RESETidecmSDGN\n"),
    ID_OFFSET_LO: 0x40,
    ID_OFFSET_HI: 0x50
  }
};

let HONDA_HEX_ACTIVE_KEY = "VARIO160";
let HONDA_HEX = HONDA_HEX_DB[HONDA_HEX_ACTIVE_KEY];

function setHondaMotorProfile(motorKey){
  if(HONDA_HEX_DB[motorKey]){
    HONDA_HEX_ACTIVE_KEY = motorKey;
    HONDA_HEX = HONDA_HEX_DB[motorKey];
    return true;
  }
  return false;
}

function getHondaMotorProfile(){
  return { key: HONDA_HEX_ACTIVE_KEY, ...(HONDA_HEX || {}) };
}
