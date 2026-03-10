const BASE_URL = "";
const SIMULATION_MODE = true;

// =====================================================
// MASTER DATA
// volt = volt total signal
// =====================================================
const MASTER_DATA = {
  3: {
    1000: { signalVolt: 4.90, ch1: { rpm: 1000, hz: 83.3 }, ch2: { rpm: 1000, hz: 83.3 }, ch3: { rpm: 1000, hz: 83.3 } },
    2000: { signalVolt: 4.90, ch1: { rpm: 2000, hz: 166.7 }, ch2: { rpm: 2000, hz: 166.7 }, ch3: { rpm: 2000, hz: 166.7 } },
    3000: { signalVolt: 4.90, ch1: { rpm: 3000, hz: 250.0 }, ch2: { rpm: 3000, hz: 250.0 }, ch3: { rpm: 3000, hz: 250.0 } },
    4000: { signalVolt: 4.90, ch1: { rpm: 4000, hz: 333.3 }, ch2: { rpm: 4000, hz: 333.3 }, ch3: { rpm: 4000, hz: 333.3 } },
    5000: { signalVolt: 4.90, ch1: { rpm: 5000, hz: 416.7 }, ch2: { rpm: 5000, hz: 416.7 }, ch3: { rpm: 5000, hz: 416.7 } },
    6000: { signalVolt: 4.90, ch1: { rpm: 6000, hz: 500.0 }, ch2: { rpm: 6000, hz: 500.0 }, ch3: { rpm: 6000, hz: 500.0 } },
    7000: { signalVolt: 4.90, ch1: { rpm: 7000, hz: 583.3 }, ch2: { rpm: 7000, hz: 583.3 }, ch3: { rpm: 7000, hz: 583.3 } },
    8000: { signalVolt: 4.90, ch1: { rpm: 8000, hz: 666.7 }, ch2: { rpm: 8000, hz: 666.7 }, ch3: { rpm: 8000, hz: 666.7 } },
    9000: { signalVolt: 4.90, ch1: { rpm: 9000, hz: 750.0 }, ch2: { rpm: 9000, hz: 750.0 }, ch3: { rpm: 9000, hz: 750.0 } },
    10000: { signalVolt: 4.90, ch1: { rpm: 10000, hz: 833.3 }, ch2: { rpm: 10000, hz: 833.3 }, ch3: { rpm: 10000, hz: 833.3 } }
  },

  4: {
    1000: { signalVolt: 4.90, ch1: { rpm: 1000, hz: 83.3 }, ch2: { rpm: 1000, hz: 83.3 }, ch3: { rpm: 1000, hz: 83.3 }, ch4: { rpm: 1000, hz: 83.3 } },
    2000: { signalVolt: 4.90, ch1: { rpm: 2000, hz: 166.7 }, ch2: { rpm: 2000, hz: 166.7 }, ch3: { rpm: 2000, hz: 166.7 }, ch4: { rpm: 2000, hz: 166.7 } },
    3000: { signalVolt: 4.90, ch1: { rpm: 3000, hz: 250.0 }, ch2: { rpm: 3000, hz: 250.0 }, ch3: { rpm: 3000, hz: 250.0 }, ch4: { rpm: 3000, hz: 250.0 } },
    4000: { signalVolt: 4.90, ch1: { rpm: 4000, hz: 333.3 }, ch2: { rpm: 4000, hz: 333.3 }, ch3: { rpm: 4000, hz: 333.3 }, ch4: { rpm: 4000, hz: 333.3 } },
    5000: { signalVolt: 4.90, ch1: { rpm: 5000, hz: 416.7 }, ch2: { rpm: 5000, hz: 416.7 }, ch3: { rpm: 5000, hz: 416.7 }, ch4: { rpm: 5000, hz: 416.7 } },
    6000: { signalVolt: 4.90, ch1: { rpm: 6000, hz: 500.0 }, ch2: { rpm: 6000, hz: 500.0 }, ch3: { rpm: 6000, hz: 500.0 }, ch4: { rpm: 6000, hz: 500.0 } },
    7000: { signalVolt: 4.90, ch1: { rpm: 7000, hz: 583.3 }, ch2: { rpm: 7000, hz: 583.3 }, ch3: { rpm: 7000, hz: 583.3 }, ch4: { rpm: 7000, hz: 583.3 } },
    8000: { signalVolt: 4.90, ch1: { rpm: 8000, hz: 666.7 }, ch2: { rpm: 8000, hz: 666.7 }, ch3: { rpm: 8000, hz: 666.7 }, ch4: { rpm: 8000, hz: 666.7 } },
    9000: { signalVolt: 4.90, ch1: { rpm: 9000, hz: 750.0 }, ch2: { rpm: 9000, hz: 750.0 }, ch3: { rpm: 9000, hz: 750.0 }, ch4: { rpm: 9000, hz: 750.0 } },
    10000: { signalVolt: 4.90, ch1: { rpm: 10000, hz: 833.3 }, ch2: { rpm: 10000, hz: 833.3 }, ch3: { rpm: 10000, hz: 833.3 }, ch4: { rpm: 10000, hz: 833.3 } }
  }
};

// =====================================================
// ELEMENT
// =====================================================
const channelModeEl = document.getElementById("channelMode");
const rpmEl = document.getElementById("rpm");
const testMinutesEl = document.getElementById("testMinutes");
const btnRun = document.getElementById("btnRun");
const batteryVoltEl = document.getElementById("batteryVolt");
const masterSignalVoltEl = document.getElementById("masterSignalVolt");
const actualSignalVoltEl = document.getElementById("actualSignalVolt");
const statusSignalVoltEl = document.getElementById("statusSignalVolt");
const masterContainer = document.getElementById("masterContainer");
const actualContainer = document.getElementById("actualContainer");
const progressFillEl = document.getElementById("progressFill");
const progressPercentEl = document.getElementById("progressPercent");
const timeRemainEl = document.getElementById("timeRemain");
const runStatusTextEl = document.getElementById("runStatusText");

// =====================================================
// STATE
// =====================================================
let testRunning = false;
let progressTimer = null;
let pollingTimer = null;
let endTimeMs = 0;

// =====================================================
// HELPER
// =====================================================
function formatNumber(value, digits = 2) {
  const num = Number(value);
  if (Number.isNaN(num)) return "-";
  return num.toFixed(digits);
}

function statusClass(text) {
  if (text === "NORMAL") return "ok";
  if (text === "TIDAK NORMAL") return "ng";
  return "";
}

function getMasterPoint() {
  const mode = Number(channelModeEl.value);
  const rpm = Number(rpmEl.value);
  return MASTER_DATA[mode]?.[rpm] || null;
}

function makeStatus(actual, master, tolPct = 8) {
  if (!master) return "-";
  const err = Math.abs(actual - master) / master * 100;
  return err <= tolPct ? "NORMAL" : "TIDAK NORMAL";
}

function randomAround(base, percent) {
  const dev = base * (percent / 100);
  return base + ((Math.random() * 2 - 1) * dev);
}

function formatRemain(ms) {
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

// =====================================================
// BUILD MENIT 1-60
// =====================================================
function buildMinuteOptions() {
  let html = "";
  for (let i = 1; i <= 60; i++) {
    html += `<option value="${i}" ${i === 1 ? "selected" : ""}>${i} menit</option>`;
  }
  testMinutesEl.innerHTML = html;
}

// =====================================================
// MASTER
// =====================================================
function renderMaster() {
  const mode = Number(channelModeEl.value);
  const master = getMasterPoint();

  if (!master) {
    masterContainer.innerHTML = "";
    masterSignalVoltEl.textContent = "-";
    return;
  }

  masterSignalVoltEl.textContent = formatNumber(master.signalVolt, 2);

  let html = "";

  for (let i = 1; i <= mode; i++) {
    const ch = master[`ch${i}`];

    html += `
      <div class="channel-block">
        <div class="channel-title">CH${i}</div>
        <div class="grid2">
          <div class="card mini-card">
            <div class="small">RPM</div>
            <div class="big">${formatNumber(ch.rpm, 1)}</div>
          </div>
          <div class="card mini-card">
            <div class="small">HZ</div>
            <div class="big">${formatNumber(ch.hz, 2)}</div>
          </div>
        </div>
      </div>
    `;
  }

  masterContainer.innerHTML = html;
}

// =====================================================
// AKTUAL KOSONG
// =====================================================
function renderActualEmpty() {
  const mode = Number(channelModeEl.value);

  actualSignalVoltEl.textContent = "-";
  statusSignalVoltEl.textContent = "-";
  statusSignalVoltEl.className = "";

  let html = "";

  for (let i = 1; i <= mode; i++) {
    html += `
      <div class="channel-block">
        <div class="channel-title">CH${i}</div>
        <div class="grid2">
          <div class="card mini-card">
            <div class="small">RPM</div>
            <div class="big">-</div>
            <div>-</div>
          </div>
          <div class="card mini-card">
            <div class="small">HZ</div>
            <div class="big">-</div>
            <div>-</div>
          </div>
        </div>
      </div>
    `;
  }

  actualContainer.innerHTML = html;
}

// =====================================================
// RENDER AKTUAL
// =====================================================
function renderActual(data) {
  const mode = Number(channelModeEl.value);
  const master = getMasterPoint();

  actualSignalVoltEl.textContent = formatNumber(data.signalVolt, 2);
  const signalStatus = makeStatus(data.signalVolt, master.signalVolt, 8);
  statusSignalVoltEl.textContent = signalStatus;
  statusSignalVoltEl.className = statusClass(signalStatus);

  let html = "";

  for (let i = 1; i <= mode; i++) {
    const ch = data[`ch${i}`] || {};
    const ref = master[`ch${i}`];

    const statusRPM = makeStatus(ch.rpm, ref.rpm, 8);
    const statusHz = makeStatus(ch.hz, ref.hz, 8);

    html += `
      <div class="channel-block">
        <div class="channel-title">CH${i}</div>
        <div class="grid2">
          <div class="card mini-card">
            <div class="small">RPM</div>
            <div class="big">${formatNumber(ch.rpm, 1)}</div>
            <div class="${statusClass(statusRPM)}">${statusRPM}</div>
          </div>
          <div class="card mini-card">
            <div class="small">HZ</div>
            <div class="big">${formatNumber(ch.hz, 2)}</div>
            <div class="${statusClass(statusHz)}">${statusHz}</div>
          </div>
        </div>
      </div>
    `;
  }

  actualContainer.innerHTML = html;
}

// =====================================================
// SIMULASI
// =====================================================
function simulateBattery() {
  return randomAround(12.6, 3);
}

function simulateStatusData() {
  const mode = Number(channelModeEl.value);
  const master = getMasterPoint();

  const out = {
    running: testRunning,
    remainSec: Math.max(0, Math.ceil((endTimeMs - Date.now()) / 1000)),
    battery: simulateBattery(),
    signalVolt: randomAround(master.signalVolt, 4)
  };

  for (let i = 1; i <= mode; i++) {
    const ref = master[`ch${i}`];
    out[`ch${i}`] = {
      rpm: randomAround(ref.rpm, 3),
      hz: randomAround(ref.hz, 4)
    };
  }

  return out;
}

// =====================================================
// API / SIMULASI
// =====================================================
async function fetchStatus() {
  if (SIMULATION_MODE) {
    return simulateStatusData();
  }

  const response = await fetch(`${BASE_URL}/api/status`);
  return await response.json();
}

async function startRunOnEsp() {
  if (SIMULATION_MODE) return { ok: true };

  const rpm = rpmEl.value;
  const mode = channelModeEl.value;
  const minutes = testMinutesEl.value;

  const response = await fetch(`${BASE_URL}/api/run?rpm=${rpm}&mode=${mode}&minutes=${minutes}`);
  return await response.json();
}

// =====================================================
// IDLE INFO
// =====================================================
async function refreshIdleInfo() {
  try {
    const data = await fetchStatus();
    batteryVoltEl.textContent = `${formatNumber(data.battery, 2)} V`;
  } catch {
    batteryVoltEl.textContent = "-";
  }
}

// =====================================================
// PROGRESS
// =====================================================
function setProgress(percent) {
  const p = Math.max(0, Math.min(100, percent));
  progressFillEl.style.width = `${p}%`;
  progressPercentEl.textContent = `${Math.floor(p)}%`;
}

function startProgressAnimation() {
  progressFillEl.classList.add("running");
}

function stopProgressAnimation() {
  progressFillEl.classList.remove("running");
}

function finishRun() {
  testRunning = false;
  btnRun.disabled = false;
  channelModeEl.disabled = false;
  rpmEl.disabled = false;
  testMinutesEl.disabled = false;

  runStatusTextEl.textContent = "Selesai";
  stopProgressAnimation();
  setProgress(100);
  timeRemainEl.textContent = "00:00";

  if (progressTimer) {
    clearInterval(progressTimer);
    progressTimer = null;
  }

  if (pollingTimer) {
    clearInterval(pollingTimer);
    pollingTimer = null;
  }
}

function startProgressCountdown(totalMinutes) {
  const totalMs = totalMinutes * 60 * 1000;
  endTimeMs = Date.now() + totalMs;

  if (progressTimer) clearInterval(progressTimer);

  progressTimer = setInterval(() => {
    const remain = endTimeMs - Date.now();

    if (remain <= 0) {
      finishRun();
      return;
    }

    const done = totalMs - remain;
    const percent = (done / totalMs) * 100;

    setProgress(percent);
    timeRemainEl.textContent = formatRemain(remain);
    runStatusTextEl.textContent = "Sedang berjalan";
  }, 250);
}

// =====================================================
// RUN
// =====================================================
async function runTest() {
  if (testRunning) return;

  testRunning = true;

  btnRun.disabled = true;
  channelModeEl.disabled = true;
  rpmEl.disabled = true;
  testMinutesEl.disabled = true;

  renderMaster();
  startProgressAnimation();
  setProgress(0);

  const totalMinutes = Number(testMinutesEl.value);
  startProgressCountdown(totalMinutes);

  await startRunOnEsp();

  const firstData = await fetchStatus();
  batteryVoltEl.textContent = `${formatNumber(firstData.battery, 2)} V`;
  renderActual(firstData);

  if (pollingTimer) clearInterval(pollingTimer);

  pollingTimer = setInterval(async () => {
    if (!testRunning) return;

    try {
      const data = await fetchStatus();
      batteryVoltEl.textContent = `${formatNumber(data.battery, 2)} V`;
      renderActual(data);

      if (!SIMULATION_MODE && data.running === false) {
        finishRun();
      }
    } catch {}
  }, 1000);
}

// =====================================================
// INIT
// =====================================================
document.addEventListener("DOMContentLoaded", () => {
  buildMinuteOptions();
  renderMaster();
  renderActualEmpty();
  refreshIdleInfo();

  setProgress(0);
  timeRemainEl.textContent = "00:00";
  runStatusTextEl.textContent = "Siap";

  channelModeEl.addEventListener("change", () => {
    renderMaster();
    renderActualEmpty();
  });

  rpmEl.addEventListener("change", () => {
    renderMaster();
    renderActualEmpty();
  });

  btnRun.addEventListener("click", runTest);

  setInterval(() => {
    if (!testRunning) {
      refreshIdleInfo();
    }
  }, 1000);
});