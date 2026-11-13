import { Game } from './game.js';

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// Same engine for both games; the page picks the vehicle with <body data-vehicle>.
const VEHICLE = document.body.dataset.vehicle === 'car' ? 'car' : 'bike';
const CAR = VEHICLE === 'car';
const T = CAR
  ? {
      title: 'Pose Driver',
      storage: 'pose-driver',
      noun: 'car',
      go: 'Drive with camera',
      verb: 'driving',
      steerDeg: 95, // rotation of the 2D steering-wheel indicator at full lock
    }
  : {
      title: 'Pose Rider',
      storage: 'pose-rider',
      noun: 'bike',
      go: 'Ride with camera',
      verb: 'riding',
      steerDeg: 32,
    };

// Steering sensitivity. maxTilt/deadZone apply to camera steering; turnSpeed and
// response apply to every input (camera, keyboard, touch).
const DEFAULTS = CAR
  ? { maxTilt: 45, deadZone: 3, turnSpeed: 1, response: 7 }
  : { maxTilt: 30, deadZone: 4, turnSpeed: 1, response: 9 };
const SETTINGS_SPEC = [
  {
    key: 'maxTilt',
    label: 'Full turn at',
    min: 10,
    max: 80,
    step: 1,
    fmt: (v) => `${v}°`,
    help: `How far you turn your hands for a full turn. Lower = more sensitive.`,
  },
  {
    key: 'deadZone',
    label: 'Dead zone',
    min: 0,
    max: 15,
    step: 0.5,
    fmt: (v) => `${v}°`,
    help: 'Small hand tilts below this count as going straight.',
  },
  {
    key: 'turnSpeed',
    label: 'Turn speed',
    min: 0.4,
    max: 2,
    step: 0.05,
    fmt: (v) => `${v.toFixed(2)}×`,
    help: `How fast the ${CAR ? 'car' : 'bike'} moves sideways at full turn (also keyboard and touch).`,
  },
  {
    key: 'response',
    label: 'Responsiveness',
    min: 2,
    max: 20,
    step: 0.5,
    fmt: (v) => String(v),
    help: 'Higher reacts faster; lower is smoother but lags a little.',
  },
];

const game = new Game($('scene'), { vehicle: VEHICLE });
const ui = {
  overlay: $('overlay'),
  panel: $('panel'),
  hud: $('hud'),
  score: $('hud-score'),
  dist: $('hud-dist'),
  speed: $('hud-speed'),
  lives: $('hud-lives'),
  steer: $('steer'),
  steerBar: $('steer-bar'),
  cam: $('cam'),
  camBadge: $('cam-badge'),
  big: $('big'),
};

let pose = null; // PoseController (created once; keeps the loaded model)
let source = null; // video source feeding pose: null | 'webcam' | 'phone'
let phoneLink = null; // PhoneLink while a phone is paired / being paired
let mode = 'keyboard'; // 'camera' (webcam or phone) | 'keyboard'
let state = 'menu'; // menu | loading | calibrate | countdown | playing | paused | crashing | over
let stateTime = 0;
let holdTime = 0; // generic "hold this gesture" timer
let handsLost = 0;
let countdownShown = -1;
let best = loadBest();
let settings = loadSettings();
let settingsOpen = false;
let liveSteer = 0; // last raw steering input, shown in the settings panel
game.setView(loadView());
updateViewButton();
applySettings();
let last = performance.now();

const keys = { left: false, right: false };
let touchDir = 0;

// ------------------------------------------------------------------ audio
let actx = null;
function audio() {
  if (!actx) {
    try {
      actx = new (window.AudioContext || window.webkitAudioContext)();
    } catch {
      return null;
    }
  }
  if (actx.state === 'suspended') actx.resume();
  return actx;
}
function tone(freq, dur, { type = 'sine', vol = 0.12, slide = 0, delay = 0 } = {}) {
  const ctx = audio();
  if (!ctx) return;
  const t = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t + dur);
  gain.gain.setValueAtTime(vol, t);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}
const sfx = {
  coin: () => {
    tone(988, 0.08, { type: 'square', vol: 0.06 });
    tone(1319, 0.14, { type: 'square', vol: 0.06, delay: 0.07 });
  },
  hit: () => tone(220, 0.35, { type: 'sawtooth', vol: 0.12, slide: -160 }),
  tick: () => tone(660, 0.12, { type: 'triangle', vol: 0.12 }),
  go: () => tone(990, 0.3, { type: 'triangle', vol: 0.14 }),
  over: () => {
    tone(392, 0.2, { type: 'triangle', vol: 0.12 });
    tone(311, 0.2, { type: 'triangle', vol: 0.12, delay: 0.18 });
    tone(196, 0.45, { type: 'triangle', vol: 0.12, delay: 0.36 });
  },
};

game.on('coin', sfx.coin);
game.on('hit', sfx.hit);
game.on('over', () => {
  setState('crashing');
});

// ---------------------------------------------------------------- storage
function loadBest() {
  try {
    return Number(localStorage.getItem(`${T.storage}-best`)) || 0;
  } catch {
    return 0;
  }
}
function saveBest(v) {
  try {
    localStorage.setItem(`${T.storage}-best`, String(v));
  } catch {
    /* storage unavailable: best score just won't persist */
  }
}

function loadView() {
  try {
    return localStorage.getItem(`${T.storage}-view`) || 'third';
  } catch {
    return 'third';
  }
}
function toggleView() {
  const view = game.toggleView();
  try {
    localStorage.setItem(`${T.storage}-view`, view);
  } catch {
    /* storage unavailable: view choice just won't persist */
  }
  updateViewButton();
}
function updateViewButton() {
  // The button names the view you switch *to*.
  $('view-btn').textContent = game.view === 'fpv' ? '3rd' : 'FPV';
  $('view-btn').title = game.view === 'fpv' ? 'Switch to view from behind (V)' : 'Switch to first-person view (V)';
}
$('view-btn').addEventListener('click', (e) => {
  toggleView();
  e.currentTarget.blur(); // keep Space/Enter from re-toggling via focus
});

// --------------------------------------------------------------- settings
function loadSettings() {
  const out = { ...DEFAULTS };
  try {
    const saved = JSON.parse(localStorage.getItem(`${T.storage}-settings`) || '{}');
    for (const spec of SETTINGS_SPEC) {
      const v = Number(saved[spec.key]);
      if (Number.isFinite(v)) out[spec.key] = clamp(v, spec.min, spec.max);
    }
  } catch {
    /* corrupt or unavailable storage: use defaults */
  }
  return out;
}
function saveSettings() {
  try {
    localStorage.setItem(`${T.storage}-settings`, JSON.stringify(settings));
  } catch {
    /* storage unavailable: settings last for this visit only */
  }
}
function applySettings() {
  game.turnSpeed = settings.turnSpeed;
  game.response = settings.response;
  if (pose) {
    pose.deadZone = settings.deadZone;
    pose.maxTilt = Math.max(settings.maxTilt, settings.deadZone + 1);
  }
}

function showSettings() {
  settingsOpen = true;
  const panel = $('settings-panel');
  panel.innerHTML = `
    <h2>Steering settings</h2>
    ${SETTINGS_SPEC.map(
      (sp) => `
      <label class="setting">
        <span class="set-head"><span>${sp.label}</span><output id="out-${sp.key}"></output></span>
        <input type="range" id="set-${sp.key}" min="${sp.min}" max="${sp.max}" step="${sp.step}">
        <span class="fine">${sp.help}</span>
      </label>`,
    ).join('')}
    <div class="meter" aria-hidden="true"><div id="set-meter"></div></div>
    <p class="fine" id="set-live"></p>
    <div class="buttons">
      <button class="primary" id="set-done">Done</button>
      <button id="set-reset">Reset to defaults</button>
    </div>`;
  const sync = () => {
    for (const sp of SETTINGS_SPEC) {
      $(`set-${sp.key}`).value = settings[sp.key];
      $(`out-${sp.key}`).textContent = sp.fmt(settings[sp.key]);
    }
  };
  for (const sp of SETTINGS_SPEC) {
    $(`set-${sp.key}`).addEventListener('input', (e) => {
      settings[sp.key] = Number(e.target.value);
      $(`out-${sp.key}`).textContent = sp.fmt(settings[sp.key]);
      applySettings();
      saveSettings();
    });
  }
  $('set-done').onclick = hideSettings;
  $('set-reset').onclick = () => {
    settings = { ...DEFAULTS };
    applySettings();
    saveSettings();
    sync();
  };
  sync();
  $('settings').classList.remove('hidden');
  $('set-done').focus();
}
function hideSettings() {
  settingsOpen = false;
  $('settings').classList.add('hidden');
}
function updateSettingsLive(handsOk) {
  const meter = $('set-meter');
  const live = $('set-live');
  if (!meter || !live) return;
  meter.style.left = `${50 + clamp(liveSteer, -1, 1) * 50}%`;
  let text;
  if (pose && source) {
    text = handsOk
      ? `Your tilt: ${Math.round(pose.tiltDeg)}° → steering ${Math.round(pose.steer * 100)}%`
      : 'Show both hands to the camera to try your settings.';
  } else {
    text = 'Start the camera to see your live hand tilt here. Arrow keys work too.';
  }
  if (live.textContent !== text) live.textContent = text;
}
$('settings-btn').addEventListener('click', (e) => {
  if (settingsOpen) hideSettings();
  else showSettings();
  e.currentTarget.blur();
});

// ----------------------------------------------------------------- panels
function showPanel(html) {
  ui.panel.innerHTML = html;
  ui.overlay.classList.remove('hidden');
}
function hidePanel() {
  ui.overlay.classList.add('hidden');
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function showMenu(error = '') {
  showPanel(`
    <h1>${T.title}</h1>
    ${
      CAR
        ? `<p class="tag">Drive down the country road, steering with an imaginary wheel. Your webcam tracks your body with MediaPipe, right in the browser.</p>
    <ol class="how">
      <li>Stand back so your head, shoulders and hands are in view.</li>
      <li>Hold both hands out in front of you as if gripping a steering wheel at <b>10 and 2</b>.</li>
      <li>Turn the wheel: <b>right hand down = right</b>, <b>left hand down = left</b>.</li>
      <li>Dodge cones, rocks and barriers. Grab the coins!</li>
    </ol>`
        : `<p class="tag">Ride through the countryside, steering the bike with your hands. Your webcam tracks your body with MediaPipe, right in the browser.</p>
    <ol class="how">
      <li>Stand back so your head, shoulders and hands are in view.</li>
      <li>Hold both fists out in front of you, about shoulder-width apart, as if gripping handlebars.</li>
      <li>Tilt them like a steering wheel: <b>right hand down = right</b>, <b>left hand down = left</b>.</li>
      <li>Dodge cones, rocks and barriers. Grab the coins!</li>
    </ol>`
    }
    <div class="buttons">
      <button class="primary" id="btn-camera">${T.go}</button>
      <button id="btn-phone">Use phone as camera</button>
      <button id="btn-keys">Use keyboard</button>
      <button id="btn-settings">Steering settings</button>
    </div>
    <p class="fine">No webcam? Use your phone's camera over Wi-Fi. Video goes directly from phone to computer, and nothing is uploaded. Keyboard: ← → or A / D. Touch: hold the left or right side of the screen. Press V or the FPV button for a first-person view.</p>
    ${best ? `<p class="best">Best score: ${best}</p>` : ''}
    ${error ? `<p class="error">${esc(error)}</p>` : ''}
    <p class="switch-game">${CAR ? '<a href="./">← Play Pose Rider (bike)</a>' : '<a href="car.html">Play Pose Driver, the car version →</a>'}</p>
  `);
  $('btn-settings').onclick = showSettings;
  $('btn-camera').onclick = startCamera;
  $('btn-phone').onclick = startPhone;
  $('btn-keys').onclick = startKeyboard;
  $('btn-camera').focus();
}

function showCalibrate() {
  showPanel(`
    ${
      CAR
        ? `<h2>Grab the wheel</h2>
    <p>Hold both hands out in front of you at the same height, as if holding a steering wheel at 10 and 2. Keep them still.</p>`
        : `<h2>Grab the handlebars</h2>
    <p>Hold both hands out in front of you, shoulder-width apart and at the same height, like gripping a handlebar. Keep them still.</p>`
    }
    <div class="progress"><div id="calib-bar"></div></div>
    <p class="hint" id="calib-hint">Looking for you…</p>
    <p class="fine">Tip: the yellow line in the camera preview joins your hands. Try turning it to steer the ${T.noun} now. Too twitchy or too slow? Open <b>⚙ Steering settings</b>.</p>
  `);
}

function showPaused() {
  showPanel(
    mode === 'camera'
      ? `<h2>Paused</h2>
         <p>Lost sight of your hands. Hold them out in front of you to keep ${T.verb}.</p>
         <p class="hint bad" id="pause-hint">Show both hands</p>
         <div class="buttons"><button id="btn-settings">Steering settings</button><button id="btn-menu">Quit to menu</button></div>`
      : `<h2>Paused</h2>
         <div class="buttons"><button class="primary" id="btn-resume">Resume</button><button id="btn-settings">Steering settings</button><button id="btn-menu">Quit to menu</button></div>
         <p class="fine">Press P or Esc to resume.</p>`,
  );
  $('btn-menu').onclick = toMenu;
  $('btn-settings').onclick = showSettings;
  const r = $('btn-resume');
  if (r) {
    r.onclick = resume;
    r.focus();
  }
}

function showOver() {
  const score = game.score;
  const isBest = score > best;
  if (isBest) {
    best = score;
    saveBest(best);
  }
  showPanel(`
    <h2>Crashed!</h2>
    <div class="stats">
      <div>${score}<span>Score</span></div>
      <div>${Math.floor(game.distance)} m<span>Distance</span></div>
      <div>${game.coins}<span>Coins</span></div>
    </div>
    <p class="best">${isBest ? 'New best score!' : `Best: ${best}`}</p>
    ${
      mode === 'camera'
        ? `<p><b>Raise both hands above your head</b> to ride again.</p><div class="progress"><div id="raise-bar"></div></div>`
        : ''
    }
    <div class="buttons">
      <button class="primary" id="btn-again">Ride again</button>
      <button id="btn-menu">Menu</button>
    </div>
  `);
  $('btn-again').onclick = restart;
  $('btn-menu').onclick = toMenu;
  $('btn-again').focus();
}

// ------------------------------------------------------------------ flow
function setState(s) {
  state = s;
  stateTime = 0;
  holdTime = 0;
}

async function ensurePose() {
  if (!pose) {
    const { PoseController } = await import('./pose.js');
    pose = new PoseController($('cam-video'), $('cam-canvas'));
    applySettings();
  }
  return pose;
}

function setLoadStatus(msg) {
  const el = $('load-status');
  if (el) el.textContent = msg;
}

async function startCamera() {
  audio();
  stopSources();
  mode = 'camera';
  setState('loading');
  showPanel(`<div class="spinner"></div><h2>Getting ready</h2><p id="load-status">Loading…</p>`);
  try {
    await ensurePose();
    await pose.init(setLoadStatus);
    source = 'webcam';
    ui.cam.classList.remove('hidden');
    game.reset();
    setState('calibrate');
    showCalibrate();
  } catch (err) {
    console.error(err);
    stopSources();
    let msg = err?.message || String(err);
    if (err?.name === 'NotAllowedError') msg = 'Camera permission was denied. Allow camera access in your browser and try again.';
    if (err?.name === 'NotFoundError') msg = 'No camera was found on this device. Try "Use phone as camera".';
    setState('menu');
    showMenu(`Couldn't start the camera: ${msg}`);
  }
}

// ----- phone camera over WebRTC
async function startPhone() {
  audio();
  stopSources();
  mode = 'camera';
  setState('pairing');
  showPanel(`<div class="spinner"></div><h2>Phone camera</h2><p id="load-status">Connecting to the pairing service…</p>`);
  try {
    await ensurePose();
    pose.loadModel().catch((err) => console.error(err)); // load while the phone connects
    const { PhoneLink, qrSvg } = await import('./phonelink.js');
    const link = (phoneLink = new PhoneLink());
    link.onStream = (stream) => link === phoneLink && phoneConnected(stream);
    link.onDisconnect = () => link === phoneLink && phoneDisconnected();
    await link.open();
    if (link !== phoneLink) return; // user left meanwhile
    link.qr = await qrSvg(link.phoneUrl).catch(() => '');
    if (link !== phoneLink) return;
    showPairing();
  } catch (err) {
    console.error(err);
    stopSources();
    setState('menu');
    showMenu(`Couldn't set up the phone link: ${err?.message || err?.type || err}`);
  }
}

function showPairing(note = '') {
  const url = phoneLink.phoneUrl;
  const qr = phoneLink.qr || '';
  const local = ['localhost', '127.0.0.1', ''].includes(location.hostname) || location.protocol !== 'https:';
  showPanel(`
    <h2>Use your phone as the camera</h2>
    ${note ? `<p class="error">${esc(note)}</p>` : ''}
    <div class="pair">
      <div class="qr">${qr}</div>
      <div class="pair-info">
        <p>Scan with your phone's camera, or open the link below and enter the code:</p>
        <div class="code">${esc(phoneLink.code)}</div>
        <a class="link" href="${esc(url)}" target="_blank" rel="noopener">${esc(url.replace(/#.*/, ''))}</a>
      </div>
    </div>
    <p class="fine">Phone and computer should be on the same Wi-Fi. Allow camera access on the phone, then prop it up 1.5–2 m away facing you.</p>
    ${
      local
        ? `<p class="error">This page isn't on https, so the phone may refuse to open its camera. Use the GitHub Pages version.</p>`
        : ''
    }
    <p class="hint" id="pair-status">Waiting for phone…</p>
    <div class="buttons"><button id="btn-menu">Cancel</button></div>
  `);
  $('btn-menu').onclick = toMenu;
}

async function phoneConnected(stream) {
  await pose.setStream(stream);
  source = 'phone';
  ui.cam.classList.remove('hidden');
  const status = $('pair-status');
  if (status) {
    status.textContent = 'Phone connected! Loading body tracking…';
    status.className = 'hint good';
  }
  try {
    await pose.loadModel();
  } catch (err) {
    console.error(err);
    stopSources();
    setState('menu');
    showMenu(`Couldn't load body tracking: ${err?.message || err}`);
    return;
  }
  if (state === 'pairing' || state === 'calibrate') {
    game.reset();
    setState('calibrate');
    showCalibrate();
  } else if (state === 'paused') {
    // Reconnected mid-ride: the pause screen resumes once hands are visible again.
    showPaused();
  }
}

const PHONE_LOST = 'The phone disconnected. Scan the code again (or tap Reconnect on the phone).';

function phoneDisconnected() {
  pose?.stopStream();
  source = null;
  ui.cam.classList.add('hidden');
  if (['countdown', 'playing', 'paused'].includes(state)) {
    ui.big.classList.add('hidden');
    if (state === 'countdown' && !game.running) {
      setState('pairing');
    } else {
      setState('paused');
    }
  } else if (state !== 'over' && state !== 'crashing') {
    setState('pairing');
  }
  if (state !== 'over' && state !== 'crashing') showPairing(PHONE_LOST);
}

function stopSources() {
  phoneLink?.close();
  phoneLink = null;
  pose?.stopStream();
  source = null;
  ui.cam.classList.add('hidden');
}

function startKeyboard() {
  audio();
  mode = 'keyboard';
  game.reset();
  beginCountdown();
}

function beginCountdown() {
  hidePanel();
  countdownShown = -1;
  setState('countdown');
}

function restart() {
  audio();
  if (mode === 'camera' && phoneLink && !source) {
    // Phone dropped while on the game-over screen: pair again first.
    game.reset();
    setState('pairing');
    showPairing(PHONE_LOST);
    return;
  }
  game.reset();
  beginCountdown();
}

function resume() {
  hidePanel();
  setState('playing');
}

function toMenu() {
  stopSources();
  game.reset();
  ui.big.classList.add('hidden');
  setState('menu');
  showMenu();
}

// ------------------------------------------------------------------ input
const LEFT_KEYS = ['ArrowLeft', 'a', 'A'];
const RIGHT_KEYS = ['ArrowRight', 'd', 'D'];
window.addEventListener('keydown', (e) => {
  if (LEFT_KEYS.includes(e.key)) keys.left = true;
  if (RIGHT_KEYS.includes(e.key)) keys.right = true;
  if ((e.key === 'v' || e.key === 'V') && !e.repeat) toggleView();
  if (settingsOpen) {
    if (e.key === 'Escape') hideSettings();
    return;
  }
  if (e.key === 'p' || e.key === 'P' || e.key === 'Escape') {
    if (state === 'playing') {
      setState('paused');
      showPaused();
    } else if (state === 'paused' && mode === 'keyboard') resume();
  }
});
window.addEventListener('keyup', (e) => {
  if (LEFT_KEYS.includes(e.key)) keys.left = false;
  if (RIGHT_KEYS.includes(e.key)) keys.right = false;
});
window.addEventListener('blur', () => {
  keys.left = keys.right = false;
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && state === 'playing') {
    setState('paused');
    showPaused();
  }
});

const sceneEl = $('scene');
const pointers = new Map();
function updateTouch() {
  let dir = 0;
  for (const x of pointers.values()) dir += x < window.innerWidth / 2 ? -1 : 1;
  touchDir = clamp(dir, -1, 1);
}
sceneEl.addEventListener('pointerdown', (e) => {
  pointers.set(e.pointerId, e.clientX);
  updateTouch();
});
sceneEl.addEventListener('pointermove', (e) => {
  if (pointers.has(e.pointerId)) {
    pointers.set(e.pointerId, e.clientX);
    updateTouch();
  }
});
for (const evt of ['pointerup', 'pointercancel', 'pointerleave']) {
  sceneEl.addEventListener(evt, (e) => {
    pointers.delete(e.pointerId);
    updateTouch();
  });
}

// ------------------------------------------------------------------- loop
let hudCache = {};
function setText(el, key, value) {
  if (hudCache[key] !== value) {
    hudCache[key] = value;
    el.textContent = value;
  }
}

function updateHud(handsOk) {
  const inRun = ['countdown', 'playing', 'paused', 'crashing'].includes(state);
  ui.hud.classList.toggle('hidden', !inRun);
  // In first-person the real handlebars are on screen, so skip the 2D indicator.
  ui.steer.classList.toggle('hidden', !(inRun || state === 'calibrate') || game.view === 'fpv');
  ui.steerBar.style.transform = `rotate(${(game.steer * T.steerDeg).toFixed(1)}deg)`;

  if (inRun) {
    setText(ui.score, 'score', String(game.score));
    setText(ui.dist, 'dist', `${Math.floor(game.distance)} m`);
    setText(ui.speed, 'speed', `${game.kmh} km/h`);
    const hearts = '♥'.repeat(Math.max(0, game.lives)) + `<span class="lost">${'♥'.repeat(3 - Math.max(0, game.lives))}</span>`;
    if (hudCache.lives !== hearts) {
      hudCache.lives = hearts;
      ui.lives.innerHTML = hearts;
    }
  }

  if (pose && source) {
    const v = pose.video;
    if (v.videoWidth && hudCache.aspect !== v.videoWidth / v.videoHeight) {
      hudCache.aspect = v.videoWidth / v.videoHeight;
      ui.cam.style.aspectRatio = `${v.videoWidth} / ${v.videoHeight}`;
      ui.cam.classList.toggle('portrait', v.videoHeight > v.videoWidth);
    }
    const label = handsOk ? 'Hands ✓' : pose.status === 'body' ? 'Show both hands' : 'Step into view';
    setText(ui.camBadge, 'badge', label);
    ui.camBadge.classList.toggle('ok', handsOk);
  }
}

function loop(now) {
  requestAnimationFrame(loop);
  const dt = clamp((now - last) / 1000, 0, 0.05);
  last = now;
  stateTime += dt;

  let handsOk = false;
  let steerIn = 0;
  if (pose && source) {
    try {
      pose.update(now);
    } catch (err) {
      console.error(err);
    }
    handsOk = pose.handsVisible(now);
    if (handsOk) steerIn = pose.steer;
  }
  const manual = clamp((keys.right ? 1 : 0) - (keys.left ? 1 : 0) + touchDir, -1, 1);
  if (manual) steerIn = manual;
  liveSteer = steerIn;

  // Settings opened mid-run: pause underneath so nothing happens unseen.
  if (settingsOpen && state === 'playing') {
    setState('paused');
    showPaused();
  }

  let gameMode = 'idle';
  switch (state) {
    case 'menu':
    case 'loading':
    case 'pairing':
      // Attract mode: gently weave down the road.
      steerIn = manual || Math.sin(now / 1500) * 0.35 - game.bikeX * 0.08;
      break;

    case 'calibrate': {
      const level = handsOk && Math.abs(pose.steer) < 0.35;
      holdTime = level && !settingsOpen ? holdTime + dt : Math.max(0, holdTime - dt * 2);
      const bar = $('calib-bar');
      const hint = $('calib-hint');
      if (bar) bar.style.width = `${clamp(holdTime / 1.2, 0, 1) * 100}%`;
      if (hint) {
        if (!pose || pose.status === 'none') {
          hint.textContent = 'Step into view of the camera';
          hint.className = 'hint bad';
        } else if (!handsOk) {
          hint.textContent = 'Can’t see both hands. Step back a little';
          hint.className = 'hint bad';
        } else if (!level) {
          hint.textContent = 'Level your hands to start';
          hint.className = 'hint';
        } else {
          hint.textContent = 'Great, hold still…';
          hint.className = 'hint good';
        }
      }
      if (holdTime >= 1.2) beginCountdown();
      break;
    }

    case 'countdown': {
      const n = 3 - Math.floor(stateTime);
      if (n !== countdownShown) {
        countdownShown = n;
        ui.big.classList.remove('hidden', 'pop');
        void ui.big.offsetWidth; // restart animation
        ui.big.textContent = n > 0 ? String(n) : 'GO!';
        ui.big.classList.add('pop');
        if (n > 0) sfx.tick();
        else sfx.go();
      }
      if (n <= 0 && !game.running) game.startRun();
      if (game.running) gameMode = 'run';
      if (stateTime > 3.7) {
        ui.big.classList.add('hidden');
        setState('playing');
      }
      break;
    }

    case 'playing':
      gameMode = 'run';
      if (mode === 'camera' && !manual) {
        handsLost = handsOk ? 0 : handsLost + dt;
        if (handsLost > 0.8) {
          handsLost = 0;
          setState('paused');
          showPaused();
          gameMode = 'pause';
        }
      }
      break;

    case 'paused':
      gameMode = 'pause';
      if (mode === 'camera') {
        holdTime = handsOk && !settingsOpen ? holdTime + dt : 0;
        const hint = $('pause-hint');
        if (hint) {
          hint.textContent = handsOk ? 'Hands found, resuming…' : 'Show both hands';
          hint.className = handsOk ? 'hint good' : 'hint bad';
        }
        if (holdTime > 0.6) resume();
      }
      break;

    case 'crashing':
      if (stateTime > 1.4) {
        sfx.over();
        setState('over');
        showOver();
      }
      break;

    case 'over':
      if (pose && source) {
        holdTime = pose.handsUp && !settingsOpen ? holdTime + dt : Math.max(0, holdTime - dt * 2);
        const bar = $('raise-bar');
        if (bar) bar.style.width = `${clamp(holdTime, 0, 1) * 100}%`;
        if (holdTime >= 1) restart();
      }
      break;
  }

  game.update(dt, steerIn, gameMode);
  game.render();
  updateHud(handsOk);
  if (settingsOpen) updateSettingsLive(handsOk);
}

showMenu();
requestAnimationFrame(loop);
