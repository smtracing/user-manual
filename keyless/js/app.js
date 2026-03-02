const ESP_IP = "http://192.168.4.1";

// ===== UI sesuai HTML kamu =====
const espStatusDiv   = document.getElementById("espStatus");
const ecuStatusSpan  = document.getElementById("checkResult") || document.getElementById("ecuStatus");
const idKeySpan      = document.getElementById("idKey");
const resetModal     = document.getElementById("resetModal");
const motorTypeSel   = document.getElementById("motorType");
const motorImage     = document.getElementById("motorImage");
const logDiv         = document.getElementById("log");

// ===============================
// LOG helper (aman kalau log tidak ada)
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
// STATUS ESP (hijau/abu-abu)
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

// ambil status dari firmware: GET /status
async function pollConn(){
  try{
    const r = await fetch(ESP_IP + "/status", { cache:"no-store" });
    if(!r.ok) throw new Error("HTTP " + r.status);
    const s = await r.json();
    const online = !!(s && (s.online === 1 || s.online === true));
    setEspOnline(online);
  }catch(e){
    setEspOnline(false);
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
      body: hex
    });

    if(!response.ok) return null;

    return await response.text();

  }catch(e){
    return null;
  }
}

// ===============================
// HEX → TEXT
// ===============================
function hexToText(hex){

  hex = (hex || "").replace(/\s/g,'');

  let text = "";

  for(let i=0;i<hex.length;i+=2){

    let byte = parseInt(hex.substr(i,2),16);

    if(byte >= 32 && byte <= 126){
      text += String.fromCharCode(byte);
    }
  }

  return text.trim();
}

// ===============================
// HEX → DECIMAL
// ===============================
function hexToDecimal(hex){

  hex = (hex || "").replace(/\s/g,'');

  if(hex.length === 0) return 0;

  return parseInt(hex,16);
}

// ===============================
// CHECK ECU (jalan hanya jika tombol diklik)
// ===============================
async function checkECU(){

  logLine("CHECK ECU ...");

  const res = await sendHex(HONDA_HEX.CHECK_ECU);

  if(!res){
    updateECU(false);
    logLine("NO RESPONSE");
    return;
  }

  const text = hexToText(res);
  logLine("RX: " + res + (text ? " | TXT: " + text : ""));

  if(text === "ECMID_OK"){
    updateECU(true);
  }else{
    updateECU(false);
  }
}

// ===============================
function updateECU(ok){

  if(!ecuStatusSpan) return;

  if(ok){
    ecuStatusSpan.innerText = "ECU OK";
    ecuStatusSpan.style.color = "lime";
  }else{
    ecuStatusSpan.innerText = "ECU OFFLINE";
    ecuStatusSpan.style.color = "red";
  }
}

// ===============================
// READ ID
// ===============================
async function readID(){

  logLine("READ ID ...");

  const res = await sendHex(HONDA_HEX.READ_ID);

  if(!res){
    idKeySpan.innerText = "-";
    logLine("NO RESPONSE");
    return;
  }

  logLine("RX: " + res);

  const number = hexToDecimal(res);

  if(isNaN(number) || number === 0){

    let clean = res.replace(/\s/g,'');
    let zeroCount = clean.length / 2;

    idKeySpan.innerText = "0".repeat(zeroCount);

  }else{
    idKeySpan.innerText = String(number);
  }
}

// ===============================
// RESET ID
// ===============================
async function resetID(){

  logLine("RESET ID ...");

  await sendHex(HONDA_HEX.RESET_ID);

  setTimeout(()=>{
    readID();
  },1000);
}

// ===============================
// WRAPPER sesuai UI HTML kamu
// ===============================
function readData(){
  return readID();
}

function showResetWarning(){
  if(resetModal) resetModal.style.display = "flex";
}

function closeResetModal(){
  if(resetModal) resetModal.style.display = "none";
}

function confirmResetID(){
  closeResetModal();
  return resetID();
}

// ===============================
// MOTOR IMAGE (kalau kamu pakai)
// ===============================
function changeMotor(){
  if(!motorTypeSel || !motorImage) return;

  const type = motorTypeSel.value;

  if(type === "ADV160") motorImage.src = "assets/adv160.png";
  else if(type === "VARIO160") motorImage.src = "assets/vario160.png";
  else if(type === "PCX160") motorImage.src = "assets/pcx160.png";
  else motorImage.src = "";
}

// ✅ Saat load: hanya cek koneksi ESP (JANGAN auto checkECU)
window.addEventListener("load", ()=>{
  pollConn();
  setInterval(pollConn, 800);
});
