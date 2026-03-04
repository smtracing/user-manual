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

// strike counter untuk cegah status kedip saat /status timeout sesaat
let st_miss = 0;
const MISS_LIMIT = 3;

// ✅ state busy: true saat /send sedang diproses
let st_busy = false;

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
// LOADING UI (progress 0-100% di checkResult)
// ===============================
let loadingTimer = null;
let loadingPct = 0;

function startLoading(title){
  if(!checkResultDiv) return;

  if(loadingTimer) clearInterval(loadingTimer);
  loadingPct = 0;

  checkResultDiv.style.color = "#00ff88";
  checkResultDiv.innerHTML = `
    <div class="loading-wrap">
      <div class="loading-title">${title}</div>
      <div class="progress-rail">
        <div class="progress-fill" id="progFill"></div>
      </div>
      <div class="loading-percent" id="progPct">0%</div>
    </div>
  `;

  const fill = document.getElementById("progFill");
  const pct  = document.getElementById("progPct");

  // naik cepat ke 90%, lalu nunggu selesai
  loadingTimer = setInterval(()=>{
    if(loadingPct < 90){
      loadingPct += (loadingPct < 30) ? 5 : (loadingPct < 60 ? 3 : 1);
      if(loadingPct > 90) loadingPct = 90;
      if(fill) fill.style.width = loadingPct + "%";
      if(pct)  pct.textContent = loadingPct + "%";
    }
  }, 120);
}

function finishLoading(finalText, ok=true){
  if(!checkResultDiv) return;

  const fill = document.getElementById("progFill");
  const pct  = document.getElementById("progPct");

  if(fill) fill.style.width = "100%";
  if(pct)  pct.textContent = "100%";

  if(loadingTimer){
    clearInterval(loadingTimer);
    loadingTimer = null;
  }

  setTimeout(()=>{
    checkResultDiv.textContent = finalText;
    checkResultDiv.style.color = ok ? "lime" : "red";
  }, 200);
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

  // ✅ PAUSE polling saat /send sedang berjalan (biar tidak kedip)
  if(st_busy) return;

  const ctrl = new AbortController();
  const timer = setTimeout(()=> ctrl.abort(), 450);

  try{
    const r = await fetch(ESP_IP + "/status", { cache:"no-store", signal: ctrl.signal });
    if(!r.ok) throw new Error("HTTP " + r.status);
    const s = await r.json();

    const online = !!(s && (s.online === 1 || s.online === true));

    st_miss = 0;
    st_connected = online;

    setEspOnline(online);
    setActionsEnabled(online);

  }catch(e){
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
// SEND HEX  (set st_busy + refresh status setelah selesai)
// ===============================
async function sendHex(hex){
  st_busy = true;
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
  } finally {
    st_busy = false;
    pollConn(); // refresh status sekali setelah /send selesai
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

  startLoading("CHECK ECU ...");
  logLine("CHECK ECU ...");

  const res = await sendHex(HONDA_HEX.CHECK_ECU);
  if(isNoResponse(res)){
    logLine("CHECK ECU: NO RESPONSE");
    finishLoading("NO RESPONSE", false);
    return;
  }

  const txt = hexToText(res);
  logLine("RX: " + res + (txt ? " | TXT: " + txt : ""));

  const ok = txt.includes("ECMID_OK") || txt.includes("ECMID");
  finishLoading(ok ? "ECU OK" : "ECU OFFLINE", ok);
}

// ===============================
// READ ID (valid dump only) + split offsets
// ===============================
async function readID(){
  if(!requireConnected()) return;

  startLoading("READ ID ...");
  logLine("READ ID ...");

  const res = await sendHex(HONDA_HEX.READ_ID);
  if(isNoResponse(res)){
    idKeySpan.innerText = "-";
    logLine("READ ID: NO RESPONSE");
    finishLoading("NO RESPONSE", false);
    return;
  }

  const bytes = hexToBytesAny(res);

  const BACA_OK = [0x42,0x41,0x43,0x41,0x20,0x4F,0x4B,0x0D,0x0A];
  const idx = findLastSubarray(bytes, BACA_OK);
  if(idx < 0){
    idKeySpan.innerText = "-";
    logLine("READ ID: NO VALID DUMP (BACA OK not found)");
    finishLoading("NO VALID DUMP", false);
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
    finishLoading("DUMP TOO SHORT", false);
    return;
  }

  const b0 = bytes[pLo + 0];
  const b1 = bytes[pLo + 1];
  const b2 = bytes[pHi + 0];
  const b3 = bytes[pHi + 1];

  const id = le32(b0,b1,b2,b3);

  idKeySpan.innerText = String(id);
  logLine("ID: " + id + " (HEX: " + bytesHex4(b0,b1,b2,b3) + ")");

  finishLoading("READ ID OK", true);
}

// ===============================
// RESET ID
// ===============================
async function resetID(){
  if(!requireConnected()) return;

  startLoading("RESET ID ...");
  logLine("RESET ID ...");

  let res = await sendHex(HONDA_HEX.RESET_ID);
  if(isNoResponse(res)){
    logLine("RESET: NO RESPONSE");
    finishLoading("NO RESPONSE", false);
    return;
  }

  let txt = hexToText(res);
  logLine("RESET RX: " + (txt ? txt : res));

  if(txt.toLowerCase().includes("failed konek")){
    logLine("RESET: retry ...");
    res = await sendHex(HONDA_HEX.RESET_ID);
    if(isNoResponse(res)){
      logLine("RESET RETRY: NO RESPONSE");
      finishLoading("NO RESPONSE", false);
      return;
    }
    txt = hexToText(res);
    logLine("RESET RETRY RX: " + (txt ? txt : res));
  }

  if(txt.includes("Write Complete!")){
    logLine("RESET: Write Complete!");
    finishLoading("Write Complete!", true);
  }else{
    logLine("RESET: belum ada konfirmasi selesai.");
    finishLoading("RESET NOT CONFIRMED", false);
  }

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
  setInterval(pollConn, 300);

  if(motorTypeSel && motorTypeSel.value){
    changeMotor();
  }
});
