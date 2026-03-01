const ESP_IP = "http://192.168.4.1";

const ecuStatusSpan = document.getElementById("ecuStatus");
const idKeySpan     = document.getElementById("idKey");

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

    hex = hex.replace(/\s/g,'');

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

    hex = hex.replace(/\s/g,'');

    if(hex.length === 0) return 0;

    return parseInt(hex,16);
}

// ===============================
// CHECK ECU
// ===============================
async function checkECU(){

    const res = await sendHex(HONDA_HEX.CHECK_ECU);

    if(!res){
        updateECU(false);
        return;
    }

    const text = hexToText(res);

    if(text === "ECMID_OK"){
        updateECU(true);
    }else{
        updateECU(false);
    }
}

// ===============================
function updateECU(ok){

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

    const res = await sendHex(HONDA_HEX.READ_ID);

    if(!res){
        idKeySpan.innerText = "0";
        return;
    }

    const number = hexToDecimal(res);

    if(isNaN(number) || number === 0){

        let clean = res.replace(/\s/g,'');
        let zeroCount = clean.length / 2;

        idKeySpan.innerText = "0".repeat(zeroCount);

    }else{
        idKeySpan.innerText = number;
    }
}

// ===============================
// RESET ID
// ===============================
async function resetID(){

    await sendHex(HONDA_HEX.RESET_ID);

    setTimeout(()=>{
        readID();
    },1000);
}

window.addEventListener("load",()=>{
    checkECU();
});