import { Game } from './game.js';

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

const game = new Game($('scene'));
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

let pose = null; // PoseController once the camera is running
let mode = 'keyboard'; // 'camera' | 'keyboard'
let state = 'menu'; // menu | loading | calibrate | countdown | playing | paused | crashing | over
let stateTime = 0;
let holdTime = 0; // generic "hold this gesture" timer
let handsLost = 0;
let countdownShown = -1;
let best = loadBest();
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
    return Number(localStorage.getItem('pose-rider-best')) || 0;
  } catch {
    return 0;
  }
}
function saveBest(v) {
  try {
    localStorage.setItem('pose-rider-best', String(v));
  } catch {
    /* storage unavailable: best score just won't persist */
  }
}

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
    <h1>Pose Rider</h1>
    <p class="tag">Ride through the countryside, steering the bike with your hands. Your webcam tracks your body with MediaPipe, right in the browser.</p>
    <ol class="how">
      <li>Stand back so your head, shoulders and hands are in view.</li>
      <li>Hold both fists out in front of you, about shoulder-width apart, as if gripping handlebars.</li>
      <li>Tilt them like a steering wheel: <b>right hand down = right</b>, <b>left hand down = left</b>.</li>
      <li>Dodge cones, rocks and barriers. Grab the coins!</li>
    </ol>
    <div class="buttons">
      <button class="primary" id="btn-camera">Ride with camera</button>
      <button id="btn-keys">Use keyboard</button>
    </div>
    <p class="fine">The video stays on your device; nothing is uploaded. Keyboard: ← → or A / D. Touch: hold the left or right side of the screen.</p>
    ${best ? `<p class="best">Best score: ${best}</p>` : ''}
    ${error ? `<p class="error">${esc(error)}</p>` : ''}
  `);
  $('btn-camera').onclick = startCamera;
  $('btn-keys').onclick = startKeyboard;
  $('btn-camera').focus();
}

function showCalibrate() {
  showPanel(`
    <h2>Grab the handlebars</h2>
    <p>Hold both hands out in front of you, shoulder-width apart and at the same height, like gripping a handlebar. Keep them still.</p>
    <div class="progress"><div id="calib-bar"></div></div>
    <p class="hint" id="calib-hint">Looking for you…</p>
    <p class="fine">Tip: the yellow line in the camera preview is your handlebar. Try tilting it to steer the bike now.</p>
  `);
}

function showPaused() {
  showPanel(
    mode === 'camera'
      ? `<h2>Paused</h2>
         <p>Lost sight of your hands. Hold them out in front of you to keep riding.</p>
         <p class="hint bad" id="pause-hint">Show both hands</p>
         <div class="buttons"><button id="btn-menu">Quit to menu</button></div>`
      : `<h2>Paused</h2>
         <div class="buttons"><button class="primary" id="btn-resume">Resume</button><button id="btn-menu">Quit to menu</button></div>
         <p class="fine">Press P or Esc to resume.</p>`,
  );
  $('btn-menu').onclick = toMenu;
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

async function startCamera() {
  audio();
  mode = 'camera';
  setState('loading');
  showPanel(`<div class="spinner"></div><h2>Getting ready</h2><p id="load-status">Loading…</p>`);
  try {
    if (!pose) {
      const { PoseController } = await import('./pose.js');
      pose = new PoseController($('cam-video'), $('cam-canvas'));
      ui.cam.classList.remove('hidden');
      await pose.init((msg) => {
        const el = $('load-status');
        if (el) el.textContent = msg;
      });
    }
    game.reset();
    setState('calibrate');
    showCalibrate();
  } catch (err) {
    console.error(err);
    ui.cam.classList.add('hidden');
    stopCamera();
    let msg = err?.message || String(err);
    if (err?.name === 'NotAllowedError') msg = 'Camera permission was denied. Allow camera access in your browser and try again.';
    if (err?.name === 'NotFoundError') msg = 'No camera was found on this device.';
    setState('menu');
    showMenu(`Couldn't start the camera: ${msg}`);
  }
}

function stopCamera() {
  const stream = $('cam-video').srcObject;
  stream?.getTracks().forEach((t) => t.stop());
  $('cam-video').srcObject = null;
  pose = null;
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
  game.reset();
  beginCountdown();
}

function resume() {
  hidePanel();
  setState('playing');
}

function toMenu() {
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
  ui.steer.classList.toggle('hidden', !(inRun || state === 'calibrate'));
  ui.steerBar.style.transform = `rotate(${(game.steer * 32).toFixed(1)}deg)`;

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

  if (pose) {
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
  if (pose) {
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

  let gameMode = 'idle';
  switch (state) {
    case 'menu':
    case 'loading':
      // Attract mode: gently weave down the road.
      steerIn = manual || Math.sin(now / 1500) * 0.35 - game.bikeX * 0.08;
      break;

    case 'calibrate': {
      const level = handsOk && Math.abs(pose.steer) < 0.35;
      holdTime = level ? holdTime + dt : Math.max(0, holdTime - dt * 2);
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
        holdTime = handsOk ? holdTime + dt : 0;
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
      if (pose) {
        holdTime = pose.handsUp ? holdTime + dt : Math.max(0, holdTime - dt * 2);
        const bar = $('raise-bar');
        if (bar) bar.style.width = `${clamp(holdTime, 0, 1) * 100}%`;
        if (holdTime >= 1) restart();
      }
      break;
  }

  game.update(dt, steerIn, gameMode);
  game.render();
  updateHud(handsOk);
}

showMenu();
requestAnimationFrame(loop);
