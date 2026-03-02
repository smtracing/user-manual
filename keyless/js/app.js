const ESP_IP = "http://192.168.4.1";

// ===== UI sesuai HTML =====
const espStatusDiv   = document.getElementById("espStatus");
const checkResultDiv = document.getElementById("checkResult");
const idKeySpan      = document.getElementById("idKey");
const resetModal     = document.getElementById("resetModal");
const motorTypeSel   = document.getElementById("motorType");
const motorImage     = document.getElementById("motorImage");
const logDiv         = document.getElementById("log");

// ===== state =====
let st_connected = false;

// ✅ REVISI: strike counter untuk cegah status kedip saat /send sedang proses
let st_miss = 0;
const MISS_LIMIT = 3;

// ===============================
// LOG helper
// ===============================
function logLine(msg){
  if(!logDiv) return;
  const t = new Date();
  const hh = String(t.getHours()).padStart(2,'0');
  const mm = String(t.getMinutes()).padStart(2,'0');
  const ss = String(t.getSeconds()).padStart(2,'0');
  logDiv.textContent += `[${hh}:${mm}:${ss}] ${msg}\n`;
  logDiv.scrollTop = logDiv.scrollHeight;
}

// ===============================
// Enable/disable tombol aksi
// ===============================
function setActionsEnabled(enabled){
  const btnCheck = document.querySelector('button[onclick="checkECU()"]');
  const btnRead  = document.querySelector('button[onclick="readData()"]');
  const btnReset = document.querySelector('button[onclick="showResetWarning()"]');

  const apply = (btn, en) => {
    if(!btn) return;
    btn.disabled = !en;
    btn.style.opacity = en ? "1" : "0.45";
    btn.style.cursor  = en ? "pointer" : "not-allowed";
  };

  apply(btnCheck, enabled);
  apply(btnRead,  enabled);
  apply(btnReset, enabled);

  if(!enabled && resetModal) resetModal.style.display = "none";
}

function requireConnected(){
  if(!st_connected){
    logLine("❌ ESP belum CONNECTED.");
    return false;
  }
  return true;
}

// ===============================
// RESPONSE CHECK (firmware bisa balas "NO RESPONSE")
// ===============================
function isNoResponse(res){
  if(res == null) return true;
  const s = String(res).trim().toUpperCase();
  return (s.length === 0 || s === "NO RESPONSE" || s === "NO DATA" || s === "NODATA");
}

// ===============================
// STATUS ESP
// ===============================
function setEspOnline(isOnline){
  if(!espStatusDiv) return;

  if(isOnline){
    espStatusDiv.classList.remove("offline");
    espStatusDiv.classList.add("online");
    espStatusDiv.textContent = "CONNECTED";
  }else{
    espStatusDiv.classList.remove("online");
    espStatusDiv.classList.add("offline");
    espStatusDiv.textContent = "DISCONNECTED";
  }
}

async function pollConn(){

  // timeout cepat biar respon UI cepat, tapi aman karena ada strike counter
  const ctrl = new AbortController();
  const timer = setTimeout(()=> ctrl.abort(), 450);

  try{
    const r = await fetch(ESP_IP + "/status", { cache:"no-store", signal: ctrl.signal });
    if(!r.ok) throw new Error("HTTP " + r.status);
    const s = await r.json();

    const online = !!(s && (s.online === 1 || s.online === true));

    // ✅ sukses -> reset miss
    st_miss = 0;

    st_connected = online;
    setEspOnline(online);
    setActionsEnabled(online);

  }catch(e){
    // ✅ gagal -> tambah miss, baru dianggap offline kalau sudah beberapa kali
    st_miss++;

    if(st_miss >= MISS_LIMIT){
      st_connected = false;
      setEspOnline(false);
      setActionsEnabled(false);
    }
  } finally {
    clearTimeout(timer);
  }
}

// ===============================
// SEND HEX
// ===============================
async function sendHex(hex){
  try{
    const response = await fetch(ESP_IP + "/send", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: String(hex ?? "")
    });
    if(!response.ok) return null;
    return await response.text();
  }catch(e){
    return null;
  }
}

// ===============================
// HEX helpers
// ===============================
function hexToText(hex){
  const clean = (hex || "").replace(/[^0-9a-fA-F]/g, "");
  let text = "";
  for(let i=0;i+1<clean.length;i+=2){
    const byte = parseInt(clean.substr(i,2),16);
    if(byte >= 32 && byte <= 126) text += String.fromCharCode(byte);
  }
  return text.trim();
}

function hexToBytesAny(hex){
  const clean = (hex || "").replace(/[^0-9a-fA-F]/g, "");
  const out = [];
  for(let i=0;i+1<clean.length;i+=2){
    out.push(parseInt(clean.substr(i,2),16) & 0xFF);
  }
  return out;
}

function findLastSubarray(hay, needle){
  for(let i = hay.length - needle.length; i >= 0; i--){
    let ok = true;
    for(let j=0;j<needle.length;j++){
      if(hay[i+j] !== needle[j]) { ok = false; break; }
    }
    if(ok) return i;
  }
  return -1;
}

function le32(b0,b1,b2,b3){
  return (b0 | (b1<<8) | (b2<<16) | (b3<<24)) >>> 0;
}

function bytesHex4(a,b,c,d){
  return [a,b,c,d].map(v=>v.toString(16).padStart(2,'0').toUpperCase()).join(" ");
}

// ===============================
// MOTOR SELECT -> set profile + gambar
// ===============================
function changeMotor(){
  if(!motorTypeSel || !motorImage) return;

  const type = motorTypeSel.value;

  if(typeof setHondaMotorProfile === "function"){
    if(type) setHondaMotorProfile(type);
  }

  if(type === "ADV160") motorImage.src = "assets/adv160.png";
  else if(type === "VARIO160") motorImage.src = "assets/vario160.png";
  else if(type === "PCX160") motorImage.src = "assets/pcx160.png";
  else motorImage.src = "";

  if(type) logLine("Motor: " + type);
}

// ===============================
// CHECK ECU
// ===============================
async function checkECU(){
  if(!requireConnected()) return;

  logLine("CHECK ECU ...");

  const res = await sendHex(HONDA_HEX.CHECK_ECU);
  if(isNoResponse(res)){
    updateECU(false, "NO RESPONSE");
    logLine("CHECK ECU: NO RESPONSE");
    return;
  }

  const txt = hexToText(res);
  logLine("RX: " + res + (txt ? " | TXT: " + txt : ""));

  const ok = txt.includes("ECMID_OK") || txt.includes("ECMID");
  updateECU(ok, ok ? "ECU OK" : "ECU OFFLINE");
}

function updateECU(ok, msg){
  if(!checkResultDiv) return;
  checkResultDiv.innerText = msg || (ok ? "ECU OK" : "ECU OFFLINE");
  checkResultDiv.style.color = ok ? "lime" : "red";
}

// ===============================
// READ ID (valid dump only) + split offsets
// ===============================
async function readID(){
  if(!requireConnected()) return;

  logLine("READ ID ...");

  const res = await sendHex(HONDA_HEX.READ_ID);
  if(isNoResponse(res)){
    idKeySpan.innerText = "-";
    logLine("READ ID: NO RESPONSE");
    return;
  }

  const bytes = hexToBytesAny(res);

  const BACA_OK = [0x42,0x41,0x43,0x41,0x20,0x4F,0x4B,0x0D,0x0A];
  const idx = findLastSubarray(bytes, BACA_OK);
  if(idx < 0){
    idKeySpan.innerText = "-";
    logLine("READ ID: NO VALID DUMP (BACA OK not found)");
    return;
  }

  const dumpStart = idx + BACA_OK.length;

  const OFF_LO = (HONDA_HEX && typeof HONDA_HEX.ID_OFFSET_LO === "number") ? HONDA_HEX.ID_OFFSET_LO : 0x40;
  const OFF_HI = (HONDA_HEX && typeof HONDA_HEX.ID_OFFSET_HI === "number") ? HONDA_HEX.ID_OFFSET_HI : 0x50;

  const pLo = dumpStart + OFF_LO;
  const pHi = dumpStart + OFF_HI;

  if(bytes.length < pLo + 2 || bytes.length < pHi + 2){
    idKeySpan.innerText = "-";
    logLine("READ ID: DUMP TOO SHORT");
    return;
  }

  const b0 = bytes[pLo + 0];
  const b1 = bytes[pLo + 1];
  const b2 = bytes[pHi + 0];
  const b3 = bytes[pHi + 1];

  const id = le32(b0,b1,b2,b3);

  idKeySpan.innerText = String(id);
  logLine("ID: " + id + " (HEX: " + bytesHex4(b0,b1,b2,b3) + ")");
}

// ===============================
// RESET ID
// ===============================
async function resetID(){
  if(!requireConnected()) return;

  logLine("RESET ID ...");

  let res = await sendHex(HONDA_HEX.RESET_ID);
  if(isNoResponse(res)){
    logLine("RESET: NO RESPONSE");
    return;
  }

  let txt = hexToText(res);
  logLine("RESET RX: " + (txt ? txt : res));

  if(txt.toLowerCase().includes("failed konek")){
    logLine("RESET: retry ...");
    res = await sendHex(HONDA_HEX.RESET_ID);
    if(isNoResponse(res)){
      logLine("RESET RETRY: NO RESPONSE");
      return;
    }
    txt = hexToText(res);
    logLine("RESET RETRY RX: " + (txt ? txt : res));
  }

  if(txt.includes("Write Complete!")) logLine("RESET: Write Complete!");
  else logLine("RESET: belum ada konfirmasi selesai.");

  setTimeout(()=>{ readID(); }, 1000);
}

// ===============================
// WRAPPER sesuai HTML
// ===============================
function readData(){ return readID(); }

function showResetWarning(){
  if(!requireConnected()) return;
  if(resetModal) resetModal.style.display = "flex";
}
function closeResetModal(){
  if(resetModal) resetModal.style.display = "none";
}
function confirmResetID(){
  if(!requireConnected()) return;
  closeResetModal();
  return resetID();
}

// ===============================
// INIT
// ===============================
window.addEventListener("load", ()=>{
  setActionsEnabled(false);

  pollConn();
  setInterval(pollConn, 300); // sebelumnya 800ms

  if(motorTypeSel && motorTypeSel.value){
    changeMotor();
  }
});
