const BLE = {
  service: '6e400001-b5a3-f393-e0a9-e50e24dcca9e',
  telemetry: '6e400003-b5a3-f393-e0a9-e50e24dcca9e',
  command: '6e400002-b5a3-f393-e0a9-e50e24dcca9e'
};

const $ = (id) => document.getElementById(id);
const state = {
  mode: 'demo', connected: true, charging: false, startedAt: Date.now(), energy: 0,
  telemetry: { voltage: 397.8, current: 0, maxTemp: 28.4, soc: 64, socAvailable: true, maxCell: 4.151, minCell: 4.137, avgCell: 4.144, rfe: true, canOnline: true, bmsOk: true, imdOk: true, interlock: true, chargerOk: true, estopOk: true, fault: 0 },
  samples: [], bleCommand: null, bleBuffer: '', wifiUrl: '', remoteUrl: '', token: '', pendingMode: ''
};

const checks = [
  ['BMS healthy', 'bmsOk'], ['Insulation monitor', 'imdOk'], ['Charging interlock', 'interlock'],
  ['Charger communication', 'chargerOk'], ['Emergency stop', 'estopOk'], ['RFE permission', 'rfe']
];

function clamp(v, min, max) { return Math.min(max, Math.max(min, Number(v))); }
function fmtTime(date = new Date()) { return date.toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }); }
function toast(message) { const el = $('toast'); el.textContent = message; el.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('show'), 2600); }
function log(message) {
  const li = document.createElement('li'); li.innerHTML = `<time>${fmtTime()}</time><span></span>`; li.lastElementChild.textContent = message;
  $('eventLog').prepend(li); while ($('eventLog').children.length > 10) $('eventLog').lastElementChild.remove();
}

function updateRange(el) {
  const pct = ((el.value - el.min) / (el.max - el.min)) * 100;
  el.style.setProperty('--fill', `${pct}%`);
}

function renderCells(t) {
  $('maxCell').textContent = `${t.maxCell.toFixed(3)} V`;
  $('minCell').textContent = `${t.minCell.toFixed(3)} V`;
  $('avgCell').textContent = `${t.avgCell.toFixed(3)} V`;
  $('cellDelta').textContent = `${Math.round((t.maxCell - t.minCell) * 1000)} mV`;
  $('cellDataLabel').textContent = state.mode === 'demo' ? 'DEMO' : 'SUMMARY';
  $('cellCaption').textContent = state.mode === 'demo' ? 'ILLUSTRATIVE CELL DISTRIBUTION' : 'BMS MIN / MAX / AVERAGE';
  if (state.mode !== 'demo') {
    $('cellBars').className = 'cell-bars no-data';
    $('cellBars').textContent = 'Individual cell readings not supplied';
    return;
  }
  if ($('cellBars').classList.contains('no-data')) $('cellBars').textContent = '';
  $('cellBars').className = 'cell-bars';
  if (!$('cellBars').children.length) {
    for (let i = 0; i < 24; i++) $('cellBars').append(document.createElement('span'));
  }
  [...$('cellBars').children].forEach((bar, i) => {
    const wave = Math.sin(i * .91 + Date.now() / 6000) * .004;
    const voltage = clamp(t.avgCell + wave, t.minCell, t.maxCell);
    bar.style.height = `${38 + ((voltage - t.minCell) / Math.max(.001, t.maxCell - t.minCell)) * 45}px`;
    bar.className = voltage > t.maxCell - .002 ? 'hot' : voltage < t.minCell + .002 ? 'low' : '';
  });
}

function renderChecks(t) {
  const list = $('checksList'); list.textContent = '';
  let passed = 0;
  checks.forEach(([label, key]) => {
    const ok = Boolean(t[key]); passed += ok ? 1 : 0;
    const row = document.createElement('div'); row.className = `check-item ${ok ? '' : 'fail'}`;
    row.innerHTML = `<span class="check-icon">${ok ? '✓' : '!'}</span><span>${label}</span>`; list.append(row);
  });
  $('checkCount').textContent = `${passed}/${checks.length}`;
}

function renderChart() {
  const canvas = $('telemetryChart'); const rect = canvas.getBoundingClientRect(); const dpr = window.devicePixelRatio || 1;
  canvas.width = rect.width * dpr; canvas.height = rect.height * dpr;
  const ctx = canvas.getContext('2d'); ctx.scale(dpr, dpr); const w = rect.width, h = rect.height;
  ctx.clearRect(0, 0, w, h);
  const left = 44, right = w - 32, top = 18, bottom = h - 27;
  const volts = state.samples.length ? state.samples.map(s => s.voltage) : [state.telemetry.voltage];
  const minV = Math.floor(Math.min(...volts) - 2), maxV = Math.ceil(Math.max(...volts) + 2);
  ctx.font = '10px Segoe UI'; ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = top + i * (bottom - top) / 4;
    ctx.strokeStyle = '#40313b'; ctx.setLineDash([3, 5]); ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(right, y); ctx.stroke();
    ctx.fillStyle = '#b99aaa'; ctx.textAlign = 'right'; ctx.fillText((maxV - i * (maxV - minV) / 4).toFixed(0), left - 9, y + 3);
    ctx.textAlign = 'left'; ctx.fillText((6 - i * 1.5).toFixed(1), right + 9, y + 3);
  }
  ctx.setLineDash([]); ctx.fillStyle = '#baa1b0'; ctx.textAlign = 'left'; ctx.fillText('V', left, 9); ctx.textAlign = 'right'; ctx.fillText('A', right, 9);
  for (let i = 0; i <= 4; i++) { ctx.textAlign = i === 0 ? 'left' : i === 4 ? 'right' : 'center'; ctx.fillText(i === 4 ? 'now' : `${60 - i * 15}s`, left + i * (right - left) / 4, h - 5); }
  if (state.samples.length < 2) return;
  const now = Date.now();
  const draw = (key, color, min, max) => {
    ctx.beginPath(); ctx.strokeStyle = color; ctx.lineWidth = 2;
    state.samples.forEach((s, i) => { const x = left + clamp(1 - (now - s.time) / 60000, 0, 1) * (right - left); const y = bottom - clamp((s[key] - min) / (max - min), 0, 1) * (bottom - top); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.stroke();
  };
  draw('voltage', '#ff516f', minV, maxV); draw('current', '#d9bbcc', 0, 6);
}

function render() {
  const t = state.telemetry; const power = t.voltage * t.current / 1000;
  const displaySoc = t.socAvailable ? clamp(t.soc, 0, 100) : 0;
  $('socValue').textContent = t.socAvailable ? Math.round(displaySoc) : '—'; $('socRing').style.setProperty('--soc', displaySoc);
  $('chargeProgress').style.width = `${displaySoc}%`; $('powerValue').innerHTML = `${power.toFixed(2)} <small>kW</small>`;
  $('progressCaption').textContent = t.socAvailable ? `${Math.round(displaySoc)} / 100%` : 'SOC UNAVAILABLE';
  $('chartVoltage').innerHTML = `${t.voltage.toFixed(1)} <small>V</small>`;
  $('chartCurrent').innerHTML = `${t.current.toFixed(1)} <small>A</small>`;
  $('powerContext').textContent = !state.connected ? 'Waiting for a connection' : state.charging ? 'Energy flowing to the accumulator' : 'Standing by for your next session';
  $('energyValue').textContent = `${state.energy.toFixed(2)} kWh`; $('voltageValue').innerHTML = `${t.voltage.toFixed(1)}<small> V</small>`;
  $('currentValue').innerHTML = `${t.current.toFixed(1)}<small> A</small>`; $('temperatureValue').innerHTML = `${t.maxTemp.toFixed(1)}<small> °C</small>`;
  $('rfeLabel').textContent = t.rfe ? 'ARMED' : 'OPEN'; $('rfeLabel').style.color = t.rfe ? 'var(--green)' : 'var(--red)';
  const fault = t.fault || checks.some(([, key]) => !t[key]);
  const badge = $('stateBadge'); badge.className = `state-badge ${fault ? 'fault' : state.charging ? 'charging' : 'ready'}`;
  badge.textContent = fault ? 'FAULT' : state.charging ? 'CHARGING' : 'READY';
  $('chargeState').textContent = fault ? 'Charging inhibited' : state.charging ? 'Charging accumulator' : 'Ready to charge';
  $('startButton').disabled = !state.connected || state.charging || fault; $('stopButton').disabled = !state.charging;
  renderCells(t); renderChecks(t); renderChart();
}

function applyTelemetry(data) {
  const t = state.telemetry;
  if ('soc' in data) t.socAvailable = Number(data.soc) >= 0;
  ['voltage','current','maxTemp','soc','maxCell','minCell','avgCell','fault'].forEach(k => { if (Number.isFinite(Number(data[k]))) t[k] = Number(data[k]); });
  ['rfe','canOnline','bmsOk','imdOk','interlock','chargerOk','estopOk'].forEach(k => { if (k in data) t[k] = Boolean(data[k]); });
  if ('charging' in data) state.charging = Boolean(data.charging);
  state.samples.push({ voltage: t.voltage, current: t.current, time: Date.now() });
  state.samples = state.samples.filter(sample => Date.now() - sample.time <= 60000);
  $('chartEmpty').classList.toggle('hidden', state.samples.length > 1); render();
}

async function sendCommand(command, value) {
  const payload = { command, value, timestamp: Date.now() };
  if (state.mode === 'demo') return true;
  if (state.mode === 'ble' && state.bleCommand) {
    const compact = command === 'start' ? 'START' : command === 'stop' ? 'STOP' : command === 'set_current' ? `CURRENT:${value}` : command === 'power_limit' ? `PL:${value ? 1 : 0}` : '';
    await state.bleCommand.writeValue(new TextEncoder().encode(compact)); return true;
  }
  const base = state.mode === 'wifi' ? state.wifiUrl : state.remoteUrl;
  const response = await fetch(`${base.replace(/\/$/, '')}/api/command`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}) }, body: JSON.stringify(payload) });
  if (!response.ok) throw new Error(`Command rejected (${response.status})`); return true;
}

async function connectBle() {
  if (!navigator.bluetooth) throw new Error('Web Bluetooth is unavailable. Use Chrome or Edge on desktop/Android.');
  const device = await navigator.bluetooth.requestDevice({ filters: [{ namePrefix: 'ARJUNA Charge' }], optionalServices: [BLE.service] });
  const server = await device.gatt.connect(); const service = await server.getPrimaryService(BLE.service);
  const telemetry = await service.getCharacteristic(BLE.telemetry); state.bleCommand = await service.getCharacteristic(BLE.command);
  await telemetry.startNotifications(); telemetry.addEventListener('characteristicvaluechanged', e => {
    state.bleBuffer += new TextDecoder().decode(e.target.value);
    let newline;
    while ((newline = state.bleBuffer.indexOf('\n')) >= 0) {
      const packet = state.bleBuffer.slice(0, newline); state.bleBuffer = state.bleBuffer.slice(newline + 1);
      if (!packet) continue;
      try { applyTelemetry(JSON.parse(packet)); } catch { log('Ignored malformed BLE telemetry'); }
    }
  });
  device.addEventListener('gattserverdisconnected', () => setConnection('ble', false)); setConnection('ble', true); log('Bluetooth charger connected');
}

function setConnection(mode, connected) {
  state.mode = mode; state.connected = connected;
  const labels = { demo: 'DEMO MODE', ble: 'BLUETOOTH', wifi: 'LOCAL WI-FI', remote: 'REMOTE' };
  $('connectionLabel').textContent = connected ? labels[mode] : 'DISCONNECTED';
  $('connectionLight').className = `status-light ${mode === 'demo' ? 'demo' : connected ? 'connected' : 'disconnected'}`;
  $('sessionType').textContent = mode === 'demo' ? 'SIMULATION SESSION' : connected ? 'HARDWARE SESSION' : 'DISCONNECTED';
  $('sessionHint').textContent = mode === 'demo' ? 'Explore the controls. No hardware connected.' : connected ? `Receiving telemetry through ${labels[mode].toLowerCase()}.` : 'Waiting for the charger to reconnect.';
  $('chartFeed').textContent = mode === 'demo' ? 'SIMULATED TELEMETRY' : connected ? 'CHARGER TELEMETRY' : 'LAST RECEIVED DATA';
  $('controlNote').textContent = mode === 'demo' ? 'Demo is active. Connect a charger to send commands.' : connected ? `Connected through ${labels[mode].toLowerCase()}.` : 'Connection lost. Controls are disabled.';
  render();
}

async function pollHttp() {
  if (!state.connected || !['wifi','remote'].includes(state.mode)) return;
  const base = state.mode === 'wifi' ? state.wifiUrl : state.remoteUrl;
  try {
    const response = await fetch(`${base.replace(/\/$/, '')}/api/telemetry`, { headers: state.token ? { Authorization: `Bearer ${state.token}` } : {} });
    if (!response.ok) throw new Error(String(response.status)); applyTelemetry(await response.json());
  } catch { setConnection(state.mode, false); log('Telemetry connection lost'); }
}

function demoTick() {
  if (state.mode !== 'demo') return;
  const t = state.telemetry;
  if (state.charging) {
    const limit = Number($('currentLimit').value); t.current += (limit - t.current) * .16; t.voltage += .006; t.soc = clamp(t.soc + .008, 0, 100); t.maxTemp += .002; state.energy += t.voltage * t.current / 3600000;
    if (t.soc >= Number($('socTarget').value)) stopCharging('SOC target reached');
  } else t.current *= .72;
  applyTelemetry(t);
}

async function startCharging() {
  $('startButton').classList.remove('holding');
  if ($('startButton').disabled) return;
  try {
    await sendCommand('set_current', Number($('currentLimit').value)); await sendCommand('power_limit', $('powerLimit').checked); await sendCommand('start', true);
    state.charging = true; log(`Charging started at ${$('currentLimit').value} A`); toast('Charging started'); render();
  } catch (e) { toast(e.message); log(`Start failed: ${e.message}`); }
}

async function stopCharging(reason = 'Stopped by operator') {
  try { await sendCommand('stop', true); } catch (e) { toast(e.message); }
  state.charging = false; log(reason); toast('Charging stopped'); render();
}

function bind() {
  ['currentLimit','socTarget'].forEach(id => { const el = $(id); updateRange(el); el.addEventListener('input', () => { updateRange(el); $(id + 'Output').textContent = id === 'currentLimit' ? `${el.value}.0 A` : `${el.value}%`; if (id === 'socTarget') $('targetSocLabel').textContent = `${el.value}%`; }); });
  $('currentLimit').addEventListener('change', () => sendCommand('set_current', Number($('currentLimit').value)).catch(e => toast(e.message)));
  $('powerLimit').addEventListener('change', () => sendCommand('power_limit', $('powerLimit').checked).catch(e => toast(e.message)));
  $('connectionButton').addEventListener('click', () => $('connectionDialog').showModal());
  const beginHold = () => { if ($('startButton').disabled) return; clearTimeout(startCharging.hold); $('startButton').classList.add('holding'); startCharging.hold = setTimeout(startCharging, 1000); };
  const endHold = () => { clearTimeout(startCharging.hold); $('startButton').classList.remove('holding'); };
  $('startButton').addEventListener('pointerdown', event => { if (event.button === 0) beginHold(); });
  ['pointerup','pointerleave','pointercancel','blur'].forEach(ev => $('startButton').addEventListener(ev, endHold));
  $('startButton').addEventListener('keydown', event => { if ((event.key === 'Enter' || event.key === ' ') && !event.repeat) { event.preventDefault(); beginHold(); } });
  $('startButton').addEventListener('keyup', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); endHold(); } });
  window.addEventListener('blur', endHold);
  document.querySelectorAll('.top-nav a').forEach(link => link.addEventListener('click', () => { document.querySelectorAll('.top-nav a').forEach(item => item.classList.toggle('active', item === link)); }));
  $('stopButton').addEventListener('click', () => stopCharging()); $('clearLog').addEventListener('click', () => { $('eventLog').textContent = ''; log('Event log cleared'); });
  document.querySelectorAll('[data-connect]').forEach(btn => btn.addEventListener('click', async () => {
    const mode = btn.dataset.connect; $('dialogStatus').textContent = '';
    if (mode === 'demo') { setConnection('demo', true); $('connectionDialog').close(); log('Demo mode enabled'); return; }
    if (mode === 'ble') { try { $('dialogStatus').textContent = 'Waiting for Bluetooth device…'; await connectBle(); $('connectionDialog').close(); } catch (e) { $('dialogStatus').textContent = e.message; } return; }
    state.pendingMode = mode; $('endpointForm').hidden = false; $('tokenField').hidden = mode === 'wifi'; $('endpointLabel').textContent = mode === 'wifi' ? 'ESP32 address' : 'Remote gateway URL'; $('endpointInput').value = mode === 'wifi' ? (state.wifiUrl || 'http://192.168.4.1') : state.remoteUrl;
  }));
  $('endpointConnect').addEventListener('click', async () => {
    const url = $('endpointInput').value.trim(); if (!url) return;
    if (state.pendingMode === 'wifi' && location.protocol === 'https:' && url.startsWith('http://')) {
      location.assign(url); return;
    }
    if (state.pendingMode === 'wifi') state.wifiUrl = url; else { state.remoteUrl = url; state.token = $('tokenInput').value; }
    setConnection(state.pendingMode, true); await pollHttp(); if (state.connected) { $('connectionDialog').close(); log(`${state.pendingMode === 'wifi' ? 'Local Wi-Fi' : 'Remote gateway'} connected`); }
  });
  window.addEventListener('resize', renderChart);
}

bind(); setConnection('demo', true); render(); log('Dashboard ready in demo mode');
setInterval(() => { $('sessionClock').textContent = new Date(Date.now() - state.startedAt).toISOString().slice(11, 19); demoTick(); }, 1000);
setInterval(pollHttp, 1200);
