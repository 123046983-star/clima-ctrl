// ── Config ─────────────────────────────────────────────────────────────────
const DEFAULT_CONFIG = {
  broker: 'broker.hivemq.com',
  port:   8884,               // WebSocket seguro (wss) de HiveMQ
  path:   '/mqtt',
  device: 'AC-CTRL-7F3A2C'
}

const SETPOINT_MIN = 16
const SETPOINT_MAX = 30
const CONFIRM_MS   = 5000      // tiempo para que el equipo confirme un comando
const HISTORY_MS   = 10 * 60 * 1000

function loadConfig() {
  try { return { ...DEFAULT_CONFIG, ...JSON.parse(localStorage.getItem('clima-config') || '{}') } }
  catch (_) { return { ...DEFAULT_CONFIG } }
}
let config = loadConfig()

function topics() {
  return {
    telemetry: `clima/ctrl/${config.device}/telemetry`,
    command:   `clima/ctrl/${config.device}/command`
  }
}

// ── Estado ─────────────────────────────────────────────────────────────────
let client      = null
let isConnected = false

// Último estado confirmado por la telemetría del equipo
const confirmed = { power: false, mode: 'cool', setpoint: null, fan: 'auto', swing: false }

// Comandos enviados que esperan confirmación: { key: { value, timer } }
const pending = {}

// Lo que se muestra = pendiente (optimista) o confirmado
const shown = key => (key in pending ? pending[key].value : confirmed[key])

const history = []   // { t, temp, setpoint }

// ── DOM ────────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id)
const dom = {
  statusDot: $('statusDot'), statusText: $('statusText'),
  setpoint: $('setpointValue'), dialFill: $('dialFill'), acState: $('acState'),
  temp: $('tempValue'), hum: $('humValue'),
  power: $('powerBtn'), modeGroup: $('modeGroup'),
  fanWrapper: $('fanWrapper'), fanFill: $('fanFill'), swing: $('swingInput'),
  chart: $('chart'), toast: $('toast'),
  connectBtn: $('connectBtn'), installPrompt: $('installPrompt'), installBtn: $('installBtn'),
  sheet: $('settingsSheet')
}

// ── Toast ──────────────────────────────────────────────────────────────────
let toastTimer = null
function showToast(msg) {
  dom.toast.textContent = msg
  dom.toast.classList.add('visible')
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => dom.toast.classList.remove('visible'), 3000)
}

// ── MQTT ───────────────────────────────────────────────────────────────────
function connectMQTT() {
  if (client) disconnectMQTT()
  const url = `wss://${config.broker}:${config.port}${config.path}`
  const clientId = `clima-app-${Math.random().toString(16).slice(2, 8)}`

  client = mqtt.connect(url, { clientId, reconnectPeriod: 5000, connectTimeout: 10000, keepalive: 60 })

  client.on('connect', () => {
    client.subscribe(topics().telemetry, { qos: 0 })
    updateStatus(true)
  })
  client.on('message', (_topic, payload) => {
    let data
    try { data = JSON.parse(payload.toString()) } catch (_) { return }  // mensaje mal formado
    handleTelemetry(data)
  })
  client.on('offline', () => updateStatus(false))
  client.on('error',   () => updateStatus(false))
  client.on('close',   () => updateStatus(false))
}

function disconnectMQTT() {
  if (client) { client.end(true); client = null }
  updateStatus(false)
}

function toggleConnect() { isConnected ? disconnectMQTT() : connectMQTT() }

function publishCommand(payload) {
  if (!isConnected || !client) return false
  client.publish(topics().command, JSON.stringify(payload), { qos: 0 })
  return true
}

// ── Telemetría ─────────────────────────────────────────────────────────────
// Ejemplo: {"power":true,"mode":"cool","setpoint":24,"fan":"auto","swing":false,
//           "temp":26.4,"hum":55,"running":true}
function handleTelemetry(data) {
  if (data.temp !== undefined) dom.temp.textContent = Number(data.temp).toFixed(1)
  if (data.hum  !== undefined) dom.hum.textContent  = Math.round(Number(data.hum))

  for (const key of Object.keys(confirmed)) {
    if (data[key] === undefined) continue
    const value = key === 'fan' && data.fan !== 'auto' ? Number(data.fan) : data[key]
    confirmed[key] = value
    if (key in pending && pending[key].value === value) {
      clearTimeout(pending[key].timer)
      delete pending[key]
    }
  }

  if (data.temp !== undefined) {
    const now = Date.now()
    history.push({ t: now, temp: Number(data.temp), setpoint: confirmed.setpoint })
    while (history.length && now - history[0].t > HISTORY_MS) history.shift()
    drawChart()
  }

  render(data.running)
}

// ── Comandos (con confirmación) ────────────────────────────────────────────
function sendCommand(key, value, failMsg, extra = {}) {
  if (!isConnected) { showToast('Primero conecta'); return }
  if (shown(key) === value) return

  if (pending[key]) clearTimeout(pending[key].timer)
  pending[key] = {
    value,
    timer: setTimeout(() => {
      delete pending[key]
      showToast(failMsg)
      render()
    }, CONFIRM_MS)
  }
  publishCommand({ [key]: value, ...extra })
  render()
}

function togglePower() {
  sendCommand('power', !shown('power'), 'No se pudo encender/apagar')
}

function setMode(mode) {
  sendCommand('mode', mode, 'No se pudo cambiar el modo', { power: true })
}

function setFan(level) {
  sendCommand('fan', level, 'No se pudo cambiar el ventilador')
}

function setSwing(on) {
  sendCommand('swing', on, 'No se pudo cambiar la oscilación')
  dom.swing.checked = shown('swing')
}

// El objetivo se agrupa: varios toques seguidos mandan un solo comando
let setpointDraft = null
let setpointDebounce = null
function nudgeSetpoint(delta) {
  if (!isConnected) { showToast('Primero conecta'); return }
  const base = setpointDraft ?? shown('setpoint') ?? 24
  setpointDraft = Math.min(SETPOINT_MAX, Math.max(SETPOINT_MIN, base + delta))
  renderSetpoint(setpointDraft)
  clearTimeout(setpointDebounce)
  setpointDebounce = setTimeout(() => {
    const v = setpointDraft
    setpointDraft = null
    sendCommand('setpoint', v, 'No se pudo cambiar la temperatura')
  }, 600)
}

// ── UI ─────────────────────────────────────────────────────────────────────
function updateStatus(connected) {
  isConnected = connected
  dom.statusDot.className    = 'status-dot' + (connected ? ' connected' : '')
  dom.statusText.textContent = connected ? 'Conectado' : 'Desconectado'
  dom.connectBtn.textContent = connected ? 'Desconectar' : 'Conectar'
  dom.connectBtn.className   = 'connect-btn' + (connected ? ' connected' : '')
}

const MODE_TEXT = {
  auto: 'Automático', cool: 'Enfriando', heat: 'Calentando', dry: 'Deshumidificando', fan: 'Solo ventilador'
}

function renderSetpoint(v) {
  dom.setpoint.textContent = v ?? '--'
  const pct = v == null ? 0 : ((v - SETPOINT_MIN) / (SETPOINT_MAX - SETPOINT_MIN)) * 100
  dom.dialFill.style.strokeDasharray = `${pct * 0.75} 100`
}

function render(running) {
  const power = shown('power')
  const mode  = shown('mode')
  const fan   = shown('fan')

  document.body.dataset.mode = mode
  document.body.classList.toggle('off', !power)

  if (setpointDraft === null) renderSetpoint(shown('setpoint'))

  dom.power.classList.toggle('on', power)
  dom.power.classList.toggle('pending', 'power' in pending)

  if (!power) dom.acState.textContent = 'Apagado'
  else if (running === false) dom.acState.textContent = 'En espera'
  else dom.acState.textContent = MODE_TEXT[mode] || mode

  dom.modeGroup.querySelectorAll('button').forEach(b => {
    b.classList.toggle('active', b.dataset.mode === mode)
    b.classList.toggle('pending', 'mode' in pending && b.dataset.mode === mode)
  })

  const fanIndex = fan === 'auto' ? 0 : Number(fan)
  document.querySelectorAll('.step').forEach((s, i) => s.classList.toggle('active', i === fanIndex))
  dom.fanFill.style.width = `${(fanIndex / 3) * 100}%`
  dom.fanWrapper.classList.toggle('disabled', !power)

  dom.swing.checked  = shown('swing')
  dom.swing.disabled = !power
}

// ── Gráfica ────────────────────────────────────────────────────────────────
function drawChart() {
  const c = dom.chart
  const dpr = window.devicePixelRatio || 1
  const w = c.clientWidth, h = c.clientHeight
  if (c.width !== w * dpr) { c.width = w * dpr; c.height = h * dpr }
  const ctx = c.getContext('2d')
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, w, h)
  if (history.length < 2) return

  const css = getComputedStyle(document.body)
  const vals = history.flatMap(p => [p.temp, p.setpoint])
  let lo = Math.floor(Math.min(...vals) - 0.5), hi = Math.ceil(Math.max(...vals) + 0.5)
  const now = Date.now(), pad = 6
  const span = Math.min(HISTORY_MS, Math.max(60000, now - history[0].t))  // crece hasta 10 min
  const x = t => pad + 28 + (1 - (now - t) / span) * (w - 2 * pad - 28)
  const y = v => h - pad - ((v - lo) / (hi - lo)) * (h - 2 * pad)

  ctx.font = '10px system-ui'
  ctx.fillStyle = css.getPropertyValue('--muted')
  ctx.fillText(`${hi}°`, pad, 12)
  ctx.fillText(`${lo}°`, pad, h - 4)

  const line = (key, color, dash) => {
    ctx.beginPath()
    history.forEach((p, i) => (i ? ctx.lineTo(x(p.t), y(p[key])) : ctx.moveTo(x(p.t), y(p[key]))))
    ctx.strokeStyle = color
    ctx.lineWidth = 2
    ctx.setLineDash(dash)
    ctx.stroke()
    ctx.setLineDash([])
  }
  line('setpoint', css.getPropertyValue('--muted'), [4, 4])
  line('temp', css.getPropertyValue('--accent'), [])
}
window.addEventListener('resize', drawChart)

// ── Ajustes ────────────────────────────────────────────────────────────────
function openSettings() {
  $('cfgBroker').value = config.broker
  $('cfgPort').value   = config.port
  $('cfgPath').value   = config.path
  $('cfgDevice').value = config.device
  const t = topics()
  $('hintTele').textContent = t.telemetry
  $('hintCmd').textContent  = t.command
  dom.sheet.showModal()
}
function closeSettings() { dom.sheet.close() }
function saveSettings() {
  config = {
    broker: $('cfgBroker').value.trim(),
    port:   Number($('cfgPort').value),
    path:   $('cfgPath').value.trim(),
    device: $('cfgDevice').value.trim()
  }
  localStorage.setItem('clima-config', JSON.stringify(config))
  history.length = 0
  drawChart()
  if (isConnected) connectMQTT()
  showToast('Ajustes guardados')
}

// ── PWA ────────────────────────────────────────────────────────────────────
let deferredInstallPrompt = null
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault()
  deferredInstallPrompt = e
  dom.installPrompt.hidden = false
})
dom.installBtn.addEventListener('click', () => {
  if (!deferredInstallPrompt) return
  deferredInstallPrompt.prompt()
  deferredInstallPrompt.userChoice.then(() => {
    deferredInstallPrompt = null
    dom.installPrompt.hidden = true
  })
})

// iOS cierra el WebSocket cuando la app pasa a segundo plano: al volver, reconecta ya
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && client && !client.connected) client.reconnect()
})

// ── Inicio ─────────────────────────────────────────────────────────────────
render()
if (location.hash === '#auto') connectMQTT()   // index.html#auto se conecta al abrir
