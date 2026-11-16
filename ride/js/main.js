import { Game } from './game.js';
import { PoseController } from './pose.js';
import { createShell } from '../../common/shell.js';
import { createSound } from '../../common/fx.js';

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
  ? { maxTilt: 45, deadZone: 3, turnSpeed: 1, response: 7, lives: 3 }
  : { maxTilt: 30, deadZone: 4, turnSpeed: 1, response: 9, lives: 3 };
const INFINITE_LIVES = 11; // the last step of the Lives slider means infinite
const maxLivesOf = (v) => (v >= INFINITE_LIVES ? Infinity : v);
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
  {
    key: 'lives',
    label: 'Lives',
    min: 1,
    max: INFINITE_LIVES,
    step: 1,
    fmt: (v) => (v >= INFINITE_LIVES ? '∞' : String(v)),
    help: 'Crashes allowed before the game ends. Slide all the way right for infinite. Applies from the next start.',
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
  big: $('big'),
};

let pose = null; // PoseController (made by the shell on the first camera start; keeps the model)
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
const sound = createSound();
const audio = () => sound.unlock();
const tone = (freq, dur, { delay = 0, ...o } = {}) => sound.tone(freq, dur, { vol: 0.12, ...o, at: delay });
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
  game.maxLives = maxLivesOf(settings.lives);
  if (pose) {
    pose.deadZone = settings.deadZone;
    pose.maxTilt = Math.max(settings.maxTilt, settings.deadZone + 1);
  }
}

function showSettings() {
  settingsOpen = true;
  const panel = $('settings-panel');
  panel.innerHTML = `
    <h2>Settings</h2>
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
  if (camOn()) {
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

// The main menu is the shared start screen in the page (#start); the shell
// (../../common/shell.js) runs the camera picker, phone pairing, loading and errors.
function showBest() {
  $('best').textContent = best ? `Best score: ${best}` : '';
}
showBest();
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
    <p class="fine">Tip: the yellow line in the camera preview joins your hands. Try turning it to steer the ${T.noun} now. Too twitchy or too slow? Open <b>⚙ Settings</b>.</p>
  `);
}

function showPaused() {
  showPanel(
    mode === 'camera'
      ? `<h2>Paused</h2>
         <p>Lost sight of your hands. Hold them out in front of you to keep ${T.verb}.</p>
         <p class="hint bad" id="pause-hint">Show both hands</p>
         <p class="fine">Playing with the phone camera? If it disconnected, tap Reconnect on the phone.</p>
         <div class="buttons"><button id="btn-settings">Settings</button><button id="btn-menu">Quit to menu</button></div>`
      : `<h2>Paused</h2>
         <div class="buttons"><button class="primary" id="btn-resume">Resume</button><button id="btn-settings">Settings</button><button id="btn-menu">Quit to menu</button></div>
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

const camOn = () => shell.mode === 'camera' && !!pose;

const shell = createShell({
  lang: 'en',
  touch: true,
  preview: true,
  unlock: audio,
  tracker: (video, preview) => {
    pose = new PoseController(video, preview);
    applySettings();
    return pose;
  },
  badge: () => {
    const ok = pose.handsVisible();
    return [ok ? 'Hands ✓' : pose.status === 'body' ? 'Show both hands' : 'Step into view', ok];
  },
  onPlay: ({ camera }) => {
    game.reset();
    if (camera) {
      mode = 'camera';
      setState('calibrate');
      showCalibrate();
    } else {
      mode = 'keyboard';
      beginCountdown();
    }
  },
  onHome: () => {
    game.reset();
    ui.big.classList.add('hidden');
    hidePanel();
    setState('menu');
    showBest();
  },
});
$('play').addEventListener('click', () => shell.play());
$('play-keys').addEventListener('click', () => shell.playTouch());

function beginCountdown() {
  hidePanel();
  countdownShown = -1;
  setState('countdown');
}

function restart() {
  audio();
  game.reset();
  beginCountdown();
}

function resume() {
  hidePanel();
  setState('playing');
}

function toMenu() {
  shell.home(); // onHome above resets the game
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
    const hearts =
      game.maxLives === Infinity
        ? '♥ ∞'
        : '♥'.repeat(Math.max(0, game.lives)) + `<span class="lost">${'♥'.repeat(Math.max(0, game.maxLives - game.lives))}</span>`;
    if (hudCache.lives !== hearts) {
      hudCache.lives = hearts;
      ui.lives.innerHTML = hearts;
    }
  }

  if (camOn() && shell.preview) {
    // The preview keeps the camera's shape (a phone on its side or upright).
    const v = shell.video;
    if (v.videoWidth && hudCache.aspect !== v.videoWidth / v.videoHeight) {
      hudCache.aspect = v.videoWidth / v.videoHeight;
      shell.preview.style.aspectRatio = `${v.videoWidth} / ${v.videoHeight}`;
      shell.preview.classList.toggle('portrait', v.videoHeight > v.videoWidth);
    }
  }
}

function loop(now) {
  requestAnimationFrame(loop);
  const dt = clamp((now - last) / 1000, 0, 0.05);
  last = now;
  stateTime += dt;

  let handsOk = false;
  let steerIn = 0;
  if (camOn()) {
    try {
      shell.track(now); // runs the pose model and updates the preview badge
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
          hint.textContent = handsOk ? 'Hands found, resuming…' : shell.video.srcObject ? 'Show both hands' : 'Camera lost. Reconnect the phone';
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
      if (camOn()) {
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

requestAnimationFrame(loop);
