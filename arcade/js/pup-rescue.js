// Pup Rescue Run — a full-body runner for small children, using MediaPipe Pose.
// Pick a firefighter pup or a police pup; the pup copies your body. Step
// left/right to switch lanes around the cones, duck under the bridges, and
// collect bones. Slower than Neon Dash, with infinite lives by default.
import { FilesetResolver, PoseLandmarker } from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.3/vision_bundle.mjs';
import { createCamera } from './camera.js';
import { livesPicker, heartsText } from './lives.js';

const WASM_PATH = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.3/wasm';
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task';

// Pose landmark indices
const NOSE = 0, L_SH = 11, R_SH = 12, L_WR = 15, R_WR = 16, L_HIP = 23, R_HIP = 24, L_ANK = 27, R_ANK = 28;
const KEY_POINTS = [NOSE, L_SH, R_SH, L_HIP, R_HIP, L_ANK, R_ANK];
const BONES = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24],
  [23, 25], [25, 27], [24, 26], [26, 28], [27, 31], [28, 32],
];

// ---- tuning ----
const LANE_ENTER = 0.75;   // hip offset (in shoulder widths) to move into a side lane
const LANE_EXIT = 0.45;    // ...and to come back to the middle
const LANE_STEP = 1.0;     // hip offset (in shoulder widths) that puts the avatar in the middle of a side lane
const MOVE_SMOOTH = 10;    // how quickly the avatar follows you sideways (higher = snappier)
const POSE_SMOOTH = 0.5;   // 0..1, how much of each new pose frame to take (lower = smoother, laggier)
const ENABLE_JUMP = false; // jumping is switched off for now (no hurdles, no high coins)
const JUMP_RISE = 0.14;    // hip rise (in torso lengths) that counts as a jump
const DUCK_DROP = 0.30;    // head drop (in torso lengths) that counts as a squat
const WINDOW = 0.22;       // seconds of leeway around each hurdle/bar
const SPAWN_Z = 80;        // how far ahead (world units) obstacles appear
const LANE_W = 2;          // world units between lane centers
const COLORS = {
  cyan: '#3a86ff', magenta: '#ff5a5f', orange: '#ff8c42', yellow: '#ffd43b', red: '#ff4d6d', ok: '#2fbf71',
};
const BEST_KEY = 'puprescue.best';
const PUP_KEY = 'puprescue.pup';

const video = document.getElementById('cam');
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const overlay = document.getElementById('overlay');
const msg = document.getElementById('msg');
const startBtn = document.getElementById('start');
const hud = document.getElementById('hud');
const scoreEl = document.getElementById('score');
const distEl = document.getElementById('dist');
const livesEl = document.getElementById('lives');
const getMaxLives = livesPicker(document.getElementById('lives-pick'), 'puprescue.lives', Infinity);
let maxLives = getMaxLives();

let landmarker = null;
let looping = false;
let wantStart = false;
let lastVideoTime = -1;

// Tracking
// Coordinates are in units of the video height (x: 0..aspect, y: 0..1), so they
// don't change when the camera resolution does (a phone stream over Wi-Fi starts
// small and sharpens after a few seconds).
let pose = null;   // smoothed, mirrored landmarks: {x, y, v, inFrame}
let m = null;      // current body measurements
let base = null;   // calibrated standing pose
let calib = [];    // samples while calibrating
let lane = 0, laneVis = 0, bodyX = 0, jumping = false, ducking = false;

// Game
let state = 'idle'; // idle | frame | calibrate | countdown | play | over
let stateTime = 0, lostFor = 0;
let gt = 0, speed = 0, distance = 0, nextRowIn = 0;
let score = 0, bonus = 0, coins = 0, lives = maxLives, invul = 0, shake = 0, flash = 0;
let objects = [], effects = [], decorIn = 0;

// Pup choice (buttons on the start screen, each with a little preview of the pup)
let pupKind = 'fire';
try { if (localStorage.getItem(PUP_KEY) === 'police') pupKind = 'police'; } catch {}
const PREVIEW_POSE = {
  0: [0, -1.68], 2: [-0.07, -1.72], 5: [0.07, -1.72], 11: [-0.24, -1.38], 12: [0.24, -1.38],
  13: [-0.36, -1.05], 14: [0.36, -1.05], 15: [-0.4, -0.75], 16: [0.4, -0.75],
  23: [-0.15, -0.9], 24: [0.15, -0.9], 25: [-0.17, -0.48], 26: [0.17, -0.48], 27: [-0.18, -0.08], 28: [0.18, -0.08],
};
const pupButtons = [...document.querySelectorAll('.pup-pick button')];
function choosePup(kind) {
  pupKind = kind;
  try { localStorage.setItem(PUP_KEY, kind); } catch {}
  for (const b of pupButtons) b.setAttribute('aria-pressed', String(b.dataset.pup === kind));
}
for (const b of pupButtons) {
  b.addEventListener('click', () => choosePup(b.dataset.pup));
  const cv = b.querySelector('canvas');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  cv.width = 120 * dpr; cv.height = 150 * dpr;
  const c = cv.getContext('2d');
  const u = 54 * dpr;
  const draw = (t) => {
    c.clearRect(0, 0, cv.width, cv.height);
    const wave = Math.sin(t * 3) * 0.12; // a little wave of the paw
    drawPup(c, (i) => {
      const [x, y] = PREVIEW_POSE[i] || [0, -1];
      const dy = i === 16 ? -0.55 + wave : i === 14 ? -0.25 : 0;
      const dx = i === 16 ? 0.08 : 0;
      return { x: cv.width / 2 + (x + dx) * u, y: cv.height - 10 * dpr + (y + dy) * u };
    }, u, b.dataset.pup, t);
  };
  const tick = (now) => { if (!overlay.hidden) draw(now / 1000); requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
}
choosePup(pupKind);

// ---------- setup ----------

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(innerWidth * dpr);
  canvas.height = Math.round(innerHeight * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
addEventListener('resize', resize);
resize();

async function createLandmarker() {
  const fileset = await FilesetResolver.forVisionTasks(WASM_PATH);
  const opts = (delegate) => ({
    baseOptions: { modelAssetPath: MODEL_URL, delegate },
    runningMode: 'VIDEO',
    numPoses: 1,
  });
  try {
    return await PoseLandmarker.createFromOptions(fileset, opts('GPU'));
  } catch (err) {
    console.warn('GPU delegate failed, falling back to CPU', err);
    return await PoseLandmarker.createFromOptions(fileset, opts('CPU'));
  }
}

const camera = createCamera({
  video,
  select: document.getElementById('camera'),
  linkEl: document.getElementById('link'),
  onAttach: () => (lastVideoTime = -1),
  onPhoneReady: () => wantStart && state === 'idle' && tryStart(),
  onError: (text) => (msg.textContent = text),
  isActive: () => state !== 'idle',
});

async function tryStart() {
  if (!landmarker) {
    msg.textContent = 'Loading body tracking…';
    landmarker = await createLandmarker();
  }
  msg.textContent = camera.usingPhone() ? 'Connecting to your phone…' : 'Starting camera…';
  if (!(await camera.start())) {
    wantStart = true;
    msg.textContent = 'Waiting for your phone. Scan the QR code below with it (or open the address and type the code), then allow the camera.';
    return;
  }
  wantStart = false;
  newGame();
}

startBtn.addEventListener('click', async () => {
  startBtn.disabled = true;
  try {
    await tryStart();
  } catch (err) {
    console.error(err);
    msg.textContent =
      err?.name === 'NotAllowedError'
        ? 'Camera permission was denied. Allow camera access for this site in your browser settings, then reload.'
        : `Couldn't start: ${err?.message || err}`;
  } finally {
    startBtn.disabled = false;
  }
});

// ---------- game flow ----------

function setState(s) { state = s; stateTime = 0; }

function newGame() {
  score = 0; bonus = 0; coins = 0; maxLives = getMaxLives(); lives = maxLives; invul = 0; shake = 0; flash = 0;
  objects = []; effects = []; gt = 0; distance = 0; speed = 0; nextRowIn = 0; decorIn = 0;
  for (let z = 2; z < SPAWN_Z; z += 7) spawnDecor(z);
  lane = 0; laneVis = 0; bodyX = 0; base = null; calib = [];
  overlay.hidden = true;
  hud.hidden = false;
  updateHud();
  setState('frame');
  if (!looping) {
    looping = true;
    prev = performance.now();
    requestAnimationFrame(loop);
  }
}

function gameOver() {
  setState('over');
  let best = score;
  try { best = Math.max(score, Number(localStorage.getItem(BEST_KEY)) || 0); localStorage.setItem(BEST_KEY, best); } catch {}
  setTimeout(() => {
    hud.hidden = true;
    overlay.querySelector('h1').textContent = 'Great job, pup!';
    msg.textContent = `You ran ${Math.floor(distance)} m and found ${coins} bones! Score ${score} (best ${best}). Play again?`;
    startBtn.textContent = 'Play again';
    overlay.hidden = false;
    setState('idle');
  }, 2000);
}

function updateHud() {
  scoreEl.textContent = String(score);
  distEl.textContent = `${Math.floor(distance)} m`;
  livesEl.textContent = heartsText(lives, maxLives);
}

// ---------- tracking ----------

const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function track(now) {
  if (video.readyState < 2 || video.currentTime === lastVideoTime) return;
  lastVideoTime = video.currentTime;
  const lms = landmarker.detectForVideo(video, now).landmarks?.[0];
  if (!lms) { pose = null; m = null; return; }

  const aspect = (video.videoWidth || 640) / (video.videoHeight || 480);
  const prevPose = pose;
  pose = lms.map((p, i) => {
    let x = (1 - p.x) * aspect; // mirrored: step right → move right on screen
    let y = p.y;
    const old = prevPose?.[i];
    if (old) { // light smoothing against landmark jitter
      x = old.x + (x - old.x) * POSE_SMOOTH;
      y = old.y + (y - old.y) * POSE_SMOOTH;
    }
    return { x, y, v: p.visibility ?? 1, inFrame: p.x > 0.01 && p.x < 0.99 && p.y > 0.01 && p.y < 0.99 };
  });
  const hip = mid(pose[L_HIP], pose[R_HIP]);
  const sh = mid(pose[L_SH], pose[R_SH]);
  m = {
    visible: KEY_POINTS.every((i) => pose[i].v > 0.5 && pose[i].inFrame),
    hipX: hip.x,
    hipY: hip.y,
    noseY: pose[NOSE].y,
    ankleY: (pose[L_ANK].y + pose[R_ANK].y) / 2,
    shoulderW: Math.max(dist(pose[L_SH], pose[R_SH]), 0.01),
    torso: Math.max(dist(sh, hip), 0.01),
    wristY: Math.max(pose[L_WR].y, pose[R_WR].y), // the lower of the two wrists
  };

  if (!base || !m.visible) return;

  // Lanes, with hysteresis so you don't flicker at the edges. bodyX is the
  // continuous position (in lanes) that the avatar follows smoothly.
  const off = (m.hipX - base.hipX) / base.shoulderW;
  bodyX = Math.max(-1.3, Math.min(1.3, off / LANE_STEP));
  if (lane === 0) lane = off > LANE_ENTER ? 1 : off < -LANE_ENTER ? -1 : 0;
  else if (lane === 1) lane = off < -LANE_ENTER ? -1 : off < LANE_EXIT ? 0 : 1;
  else lane = off > LANE_ENTER ? 1 : off > -LANE_EXIT ? 0 : -1;

  const bothArmsUp = m.wristY < m.noseY - base.torso * 0.15; // accessible alternative to jumping
  jumping = ENABLE_JUMP && (base.hipY - m.hipY > base.torso * JUMP_RISE || bothArmsUp);
  ducking = !jumping && m.noseY - base.noseY > base.torso * DUCK_DROP;
}

// ---------- world ----------

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function spawnRow() {
  const z = SPAWN_Z;
  const lanes = [-1, 0, 1];
  const r = Math.random();
  const late = gt > 45;
  if (r < 0.28) {
    const bl = pick(lanes);
    objects.push({ kind: 'block', lane: bl, z });
    const free = lanes.filter((l) => l !== bl);
    coinLine(pick(free), z, 3, false);
  } else if (r < 0.40 && late) {
    const freeLane = pick(lanes);
    for (const l of lanes) if (l !== freeLane) objects.push({ kind: 'block', lane: l, z });
    coinLine(freeLane, z - 4, 2, false);
  } else if (r < 0.62 && ENABLE_JUMP) {
    objects.push({ kind: 'hurdle', z });
    objects.push({ kind: 'coin', lane: pick(lanes), z, high: true });
  } else if (r < (ENABLE_JUMP ? 0.84 : 0.65)) {
    objects.push({ kind: 'bar', z });
  } else {
    coinLine(pick(lanes), z, 5, false);
  }
}

function coinLine(l, z, n, high) {
  for (let i = 0; i < n; i++) objects.push({ kind: 'coin', lane: l, z: z + i * 3, high });
}

function hurt(text) {
  if (invul > 0) return;
  lives -= 1;
  invul = 1.6; shake = 0.4; flash = 0.5;
  effects.push({ text, color: COLORS.red, t: 0, life: 1, x: laneVis, h: 2.4 });
  updateHud();
  if (lives <= 0) gameOver();
}

function update(dt) {
  stateTime += dt;
  invul = Math.max(0, invul - dt);
  shake = Math.max(0, shake - dt);
  flash = Math.max(0, flash - dt);
  effects = effects.filter((e) => (e.t += dt) < e.life);
  // Follow the body continuously, but lean toward the lane the game counts you in,
  // so what you see matches what you collide with.
  const target = base ? bodyX * 0.6 + lane * 0.4 : 0;
  laneVis += (target - laneVis) * (1 - Math.exp(-dt * MOVE_SMOOTH));

  if (state === 'frame') {
    if (m?.visible) { if (stateTime > 0.8) { setState('calibrate'); calib = []; } } else stateTime = 0;
    return;
  }
  if (state === 'calibrate') {
    if (!m?.visible) { setState('frame'); return; }
    calib.push({ ...m });
    if (stateTime > 1.5) {
      const avg = (k) => calib.reduce((s, c) => s + c[k], 0) / calib.length;
      base = {
        hipX: avg('hipX'), hipY: avg('hipY'), noseY: avg('noseY'), ankleY: avg('ankleY'),
        shoulderW: avg('shoulderW'), torso: avg('torso'),
      };
      setState('countdown');
    }
    return;
  }
  if (state === 'countdown') {
    if (stateTime >= 3) { setState('play'); speed = 9; nextRowIn = 12; }
    return;
  }
  if (state !== 'play') return;

  // Pause while the player is out of view.
  if (!m?.visible) { lostFor += dt; return; }
  lostFor = 0;
  gt += dt;

  speed = 9 + Math.min(gt, 120) * 0.05; // world units / second, ramps up gently
  const dz = speed * dt;
  distance += dz;
  nextRowIn -= dz;
  if (nextRowIn <= 0) {
    spawnRow();
    nextRowIn = Math.max(14, 24 - gt * 0.05);
  }
  decorIn -= dz;
  if (decorIn <= 0) { spawnDecor(SPAWN_Z); decorIn = rand(5, 8); }

  const win = speed * WINDOW;
  for (const o of objects) {
    o.z -= dz;
    if (o.done || o.kind === 'decor') continue;
    if (o.kind === 'coin') {
      if (Math.abs(o.z) < 1.2 && lane === o.lane && (!o.high || jumping)) {
        o.done = true; o.taken = true; coins += 1; bonus += 10;
        effects.push({ text: 'Yum! +10', color: COLORS.yellow, t: 0, life: 0.6, x: o.lane, h: o.high ? 2.6 : 1.8 });
      } else if (o.z < -1.2) o.done = true;
    } else if (o.kind === 'block') {
      if (o.z <= 0.6) { o.done = true; if (lane === o.lane) hurt('Oops!'); }
    } else {
      const ok = o.kind === 'hurdle' ? jumping : ducking;
      if (Math.abs(o.z) < win && ok) {
        o.done = true; o.cleared = true; bonus += 25;
        effects.push({ text: o.kind === 'hurdle' ? 'Nice jump! +25' : 'Great ducking! +25', color: COLORS.ok, t: 0, life: 0.9, x: 0, h: 2.8 });
      } else if (o.z < -win) {
        o.done = true;
        hurt(o.kind === 'hurdle' ? 'Oops!' : 'Bonk!');
      }
    }
  }
  objects = objects.filter((o) => o.z > -CAM_BACK + NEAR && !o.taken);
  score = Math.floor(distance) + bonus; // 1 point per meter + bonuses
  updateHud();
}

// ---------- drawing ----------

let view; // projection parameters for this frame

// Chase camera: sits CAM_BACK units behind the player at CAM_HEIGHT, looking
// straight down the track, so the view is low and behind rather than top-down.
const CAM_BACK = 4;      // world units behind the player
const CAM_HEIGHT = 2.3;  // world units above the ground (avatar is ~1.9 tall)
const NEAR = 0.6;        // don't draw things closer to the camera than this

function project(x, h, z) {
  // x: world units across, h: height above ground, z: distance ahead of the player
  const d = Math.max(NEAR, z + CAM_BACK);
  const s = CAM_BACK / d; // 1 at the player's depth
  return {
    x: view.cx + x * view.unit * s,
    y: view.horizon + (CAM_HEIGHT - h) * view.unit * s,
    s,
  };
}

function draw() {
  const W = innerWidth, H = innerHeight;
  // unit = pixels per world unit at the player's depth. Big avatar (~40% of the
  // screen height), but keep the whole track width on screen.
  const unit = Math.min(H * 0.21, (W * 0.47) / (LANE_W * 1.5));
  const ground = H * 0.95; // where the player's feet are
  view = { cx: W / 2, horizon: ground - CAM_HEIGHT * unit, unit };

  ctx.save();
  if (shake > 0) ctx.translate(rand(-1, 1) * shake * 30, rand(-1, 1) * shake * 30);

  drawSky(W, H);
  drawRoad(W, H);

  const ahead = objects.filter((o) => o.z > 0).sort((a, b) => b.z - a.z);
  const behind = objects.filter((o) => o.z <= 0).sort((a, b) => b.z - a.z);
  for (const o of ahead) drawObject(o);
  drawPlayer();
  for (const o of behind) drawObject(o);
  for (const e of effects) drawEffect(e);
  ctx.restore();

  if (flash > 0) {
    ctx.fillStyle = `rgba(255, 90, 95, ${flash * 0.35})`;
    ctx.fillRect(0, 0, W, H);
  }
  drawCameraInset(W, H);
  drawBanner(W, H);
}

// ---------- world: a sunny cartoon town ----------

const GRASS = '#7fd45c', GRASS_DARK = '#68c04a';
const ROAD = '#8c929c', ROAD_HALF = LANE_W * 1.5;

function drawSky(W, H) {
  const g = ctx.createLinearGradient(0, 0, 0, view.horizon);
  g.addColorStop(0, '#4fb8ff');
  g.addColorStop(1, '#c8f0ff');
  ctx.fillStyle = g;
  ctx.fillRect(-50, -50, W + 100, view.horizon + 50);

  // Sun with a soft glow
  const r = Math.min(W, H) * 0.07;
  const sx = W * 0.16, sy = view.horizon * 0.32;
  const sg = ctx.createRadialGradient(sx, sy, r * 0.5, sx, sy, r * 2.6);
  sg.addColorStop(0, 'rgba(255, 240, 150, 0.9)');
  sg.addColorStop(1, 'rgba(255, 240, 150, 0)');
  ctx.fillStyle = sg;
  ctx.fillRect(sx - r * 3, sy - r * 3, r * 6, r * 6);
  ctx.fillStyle = '#ffe14d';
  ctx.beginPath();
  ctx.arc(sx, sy, r, 0, Math.PI * 2);
  ctx.fill();

  // Drifting clouds
  const t = performance.now() / 1000;
  for (let i = 0; i < 5; i++) {
    const span = W + 400;
    const x = ((i * span) / 5 + t * (10 + i * 3)) % span - 200;
    const y = view.horizon * (0.12 + ((i * 37) % 50) / 100);
    cloud(x, y, Math.min(W, H) * (0.05 + (i % 3) * 0.015));
  }

  // Rolling hills, slowly sliding for a little parallax
  const shift = distance * 0.4;
  hills(W, view.horizon, Math.min(W, H) * 0.11, '#a5e07d', shift * 0.5, 0.004);
  hills(W, view.horizon, Math.min(W, H) * 0.06, '#86d062', shift, 0.007);

  ctx.fillStyle = GRASS;
  ctx.fillRect(-50, view.horizon, W + 100, H - view.horizon + 50);
}

function cloud(x, y, r) {
  ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.arc(x + r * 0.9, y + r * 0.2, r * 0.75, 0, Math.PI * 2);
  ctx.arc(x - r * 0.9, y + r * 0.25, r * 0.65, 0, Math.PI * 2);
  ctx.arc(x + r * 0.2, y - r * 0.45, r * 0.7, 0, Math.PI * 2);
  ctx.fill();
}

function hills(W, base, amp, color, shift, freq) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(-50, base + 1);
  for (let x = -50; x <= W + 50; x += 12) {
    const k = (x + shift) * freq;
    ctx.lineTo(x, base - amp * (0.55 + 0.3 * Math.sin(k) + 0.15 * Math.sin(k * 2.7 + 1)));
  }
  ctx.lineTo(W + 50, base + 1);
  ctx.fill();
}

/** Fills a flat strip on the ground from x1..x2, z1..z2 (world units). */
function groundQuad(x1, x2, z1, z2, color) {
  z1 = Math.max(z1, -CAM_BACK + NEAR);
  if (z2 <= z1) return;
  const a = project(x1, 0, z1), b = project(x2, 0, z1), c = project(x2, 0, z2), d = project(x1, 0, z2);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(c.x, c.y); ctx.lineTo(d.x, d.y);
  ctx.fill();
}

function drawRoad() {
  const far = 120, near = -CAM_BACK + NEAR;
  // Mowed grass stripes moving past give the feeling of speed.
  const stripe = 5, phase = distance % (stripe * 2);
  for (let z = -phase - stripe * 2; z < far; z += stripe * 2) {
    groundQuad(-40, 40, z, z + stripe, GRASS_DARK);
  }
  groundQuad(-ROAD_HALF - 0.7, ROAD_HALF + 0.7, near, far, '#f2efe6'); // sidewalks
  groundQuad(-ROAD_HALF - 0.12, ROAD_HALF + 0.12, near, far, '#d9d4c7'); // curbs
  groundQuad(-ROAD_HALF, ROAD_HALF, near, far, ROAD);
  // Dashed lane lines
  const dash = 2.2, gap = 2.8, ph = distance % (dash + gap);
  for (const x of [-LANE_W / 2, LANE_W / 2]) {
    for (let z = -ph - (dash + gap); z < far; z += dash + gap) groundQuad(x - 0.07, x + 0.07, z, z + dash, '#fdfdfd');
  }
  // Solid yellow edge lines
  groundQuad(-ROAD_HALF + 0.1, -ROAD_HALF + 0.22, near, far, '#ffd43b');
  groundQuad(ROAD_HALF - 0.22, ROAD_HALF - 0.1, near, far, '#ffd43b');
}

function outlined(fill, stroke, width, c = ctx) {
  c.fillStyle = fill;
  c.fill();
  c.strokeStyle = stroke;
  c.lineWidth = width;
  c.stroke();
}

function drawObject(o) {
  // Fade in at the horizon, and fade out once past the player so nothing blocks the view.
  const fade = Math.min(1, (SPAWN_Z - o.z) / 10, Math.max(0, 1 + o.z / 0.8));
  if (fade <= 0) return;
  ctx.save();
  ctx.globalAlpha = fade;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  if (o.kind === 'block') drawCones(o);
  else if (o.kind === 'bar') drawBridge(o);
  else if (o.kind === 'coin') drawBone(o);
  else if (o.kind === 'decor') drawDecor(o);
  ctx.restore();
}

// A big traffic cone with a little sawhorse barrier behind it.
function drawCones(o) {
  const x = o.lane * LANE_W;
  const b = project(x, 0, o.z);
  const u = view.unit * b.s;
  const lw = Math.max(1.5, 0.05 * u);
  // Sawhorse
  const sl = project(x - 0.85, 1.05, o.z + 0.4), sr = project(x + 0.85, 1.05, o.z + 0.4);
  const gl = project(x - 0.7, 0, o.z + 0.4), gr = project(x + 0.7, 0, o.z + 0.4);
  ctx.strokeStyle = '#5b4a3a';
  ctx.lineWidth = Math.max(2, 0.08 * u);
  ctx.beginPath();
  ctx.moveTo(gl.x, gl.y); ctx.lineTo(sl.x + 0.15 * u, sl.y);
  ctx.moveTo(gr.x, gr.y); ctx.lineTo(sr.x - 0.15 * u, sr.y);
  ctx.stroke();
  const bh = 0.28 * u;
  ctx.save();
  ctx.beginPath();
  ctx.rect(sl.x, sl.y - bh / 2, sr.x - sl.x, bh);
  ctx.clip();
  ctx.fillStyle = '#fff';
  ctx.fillRect(sl.x, sl.y - bh / 2, sr.x - sl.x, bh);
  ctx.fillStyle = '#ff6b2c';
  for (let sx = sl.x - bh; sx < sr.x; sx += bh * 1.4) {
    ctx.beginPath();
    ctx.moveTo(sx, sl.y + bh / 2); ctx.lineTo(sx + bh * 0.7, sl.y + bh / 2);
    ctx.lineTo(sx + bh * 1.7, sl.y - bh / 2); ctx.lineTo(sx + bh, sl.y - bh / 2);
    ctx.fill();
  }
  ctx.restore();
  ctx.strokeStyle = '#7a3b12';
  ctx.lineWidth = lw;
  ctx.strokeRect(sl.x, sl.y - bh / 2, sr.x - sl.x, bh);

  // Cone
  const h = 1.45 * u, wBase = 0.62 * u, wTop = 0.08 * u;
  const yb = b.y - 0.12 * u, yt = b.y - h;
  const wAt = (k) => wBase + (wTop - wBase) * k; // k: 0 bottom → 1 top
  ctx.beginPath();
  ctx.roundRect(b.x - 0.75 * u, b.y - 0.16 * u, 1.5 * u, 0.18 * u, 0.06 * u);
  outlined('#e8541c', '#7a2a0c', lw);
  ctx.beginPath();
  ctx.moveTo(b.x - wBase, yb); ctx.lineTo(b.x - wTop, yt);
  ctx.quadraticCurveTo(b.x, yt - 0.06 * u, b.x + wTop, yt);
  ctx.lineTo(b.x + wBase, yb);
  ctx.closePath();
  outlined('#ff7a2f', '#7a2a0c', lw);
  for (const [k1, k2] of [[0.3, 0.42], [0.62, 0.72]]) {
    const y1 = yb - (yb - yt) * k1, y2 = yb - (yb - yt) * k2;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(b.x - wAt(k1), y1); ctx.lineTo(b.x - wAt(k2), y2);
    ctx.lineTo(b.x + wAt(k2), y2); ctx.lineTo(b.x + wAt(k1), y1);
    ctx.fill();
  }
  // shine
  ctx.strokeStyle = 'rgba(255,255,255,0.45)';
  ctx.lineWidth = Math.max(1.5, 0.06 * u);
  ctx.beginPath();
  ctx.moveTo(b.x - wBase * 0.45, yb - 0.1 * u); ctx.lineTo(b.x - wTop * 0.6, yt + 0.15 * u);
  ctx.stroke();
}

function drawBone(o) {
  const p = project(o.lane * LANE_W, o.high ? 2.3 : 0.95 + Math.sin(gt * 4 + o.z) * 0.08, o.z);
  const u = view.unit * p.s;
  const len = 0.36 * u, r = 0.11 * u;
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(Math.sin(gt * 3 + o.z) * 0.35);
  ctx.shadowColor = 'rgba(255, 230, 120, 0.9)';
  ctx.shadowBlur = 14;
  ctx.beginPath();
  ctx.rect(-len, -r * 0.65, len * 2, r * 1.3);
  for (const sx of [-len, len]) for (const sy of [-r * 0.75, r * 0.75]) {
    ctx.moveTo(sx + r, sy);
    ctx.arc(sx, sy, r, 0, Math.PI * 2);
  }
  outlined('#fff8e7', '#b5874a', Math.max(1.5, 0.035 * u));
  // redraw the middle so the outline doesn't cross it
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#fff8e7';
  ctx.fillRect(-len, -r * 0.6, len * 2, r * 1.2);
  ctx.restore();
}

// A wooden footbridge across the whole road: duck under it!
const GATE_LOW = 1.25;  // height of the underside (avatar is ~1.9 tall)
const GATE_HIGH = 4.5;

function drawBridge(o) {
  const half = ROAD_HALF + 0.7;
  const deckTop = GATE_LOW + 0.45;
  const bl = project(-half, GATE_LOW, o.z), tr = project(half, deckTop, o.z);
  const u = view.unit * bl.s;
  const lw = Math.max(1.5, 0.05 * u);
  ctx.globalAlpha *= Math.max(0.3, Math.min(1, (o.z + 1) / 5));

  // Warning stripe on the road under the bridge
  if (!o.cleared) {
    for (let i = -3; i < 3; i++) {
      groundQuad(i * 1, i * 1 + 0.5, o.z - 0.4, o.z + 0.4, 'rgba(255, 212, 59, 0.85)');
    }
  }
  // Stone pillars
  for (const sx of [-half, half]) {
    const g = project(sx, 0, o.z), t = project(sx, deckTop, o.z);
    ctx.beginPath();
    ctx.roundRect(g.x - 0.3 * u, t.y, 0.6 * u, g.y - t.y, 0.08 * u);
    outlined('#c9c3b8', '#6f6a62', lw);
    ctx.strokeStyle = 'rgba(111,106,98,0.5)';
    for (let k = 1; k < 5; k++) {
      const y = t.y + ((g.y - t.y) * k) / 5;
      ctx.beginPath(); ctx.moveTo(g.x - 0.3 * u, y); ctx.lineTo(g.x + 0.3 * u, y); ctx.stroke();
    }
  }
  // Railing
  const railTop = project(half, deckTop + 0.55, o.z).y;
  ctx.strokeStyle = '#8a5a2b';
  ctx.lineWidth = Math.max(2, 0.07 * u);
  ctx.beginPath();
  ctx.moveTo(bl.x, railTop); ctx.lineTo(tr.x, railTop);
  for (let x = bl.x; x <= tr.x + 1; x += 0.6 * u) { ctx.moveTo(x, tr.y); ctx.lineTo(x, railTop); }
  ctx.stroke();
  // Deck with planks
  ctx.beginPath();
  ctx.roundRect(bl.x, tr.y, tr.x - bl.x, bl.y - tr.y, 0.06 * u);
  outlined(o.cleared ? '#8fd47a' : '#c98a4b', '#6b4220', lw);
  ctx.strokeStyle = 'rgba(107,66,32,0.45)';
  ctx.lineWidth = Math.max(1, 0.03 * u);
  for (let x = bl.x + 0.5 * u; x < tr.x; x += 0.5 * u) {
    ctx.beginPath(); ctx.moveTo(x, tr.y); ctx.lineTo(x, bl.y); ctx.stroke();
  }
  // Flower boxes on the railing
  for (let x = bl.x + 0.7 * u; x < tr.x - 0.4 * u; x += 1.6 * u) {
    for (let k = 0; k < 3; k++) {
      ctx.fillStyle = ['#ff6fa5', '#ffd43b', '#b07cff'][k];
      ctx.beginPath();
      ctx.arc(x + k * 0.18 * u, tr.y - 0.08 * u, 0.09 * u, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // Sign hanging under the middle
  const label = o.cleared ? '✓' : 'DUCK!';
  ctx.font = `900 ${Math.max(12, Math.round(0.42 * u))}px "Baloo 2", system-ui, sans-serif`;
  const tw = ctx.measureText(label).width + 0.4 * u;
  const sy = bl.y + 0.05 * u;
  ctx.beginPath();
  ctx.roundRect(view.cx - tw / 2, sy, tw, 0.55 * u, 0.15 * u);
  outlined(o.cleared ? '#5cc46a' : '#ff5a5f', '#ffffff', Math.max(2, 0.06 * u));
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, view.cx, sy + 0.29 * u);
}

// Roadside scenery: houses, trees, fire hydrants, flowers.
function spawnDecor(z) {
  for (const side of [-1, 1]) {
    const r = Math.random();
    const kind = r < 0.35 ? 'house' : r < 0.7 ? 'tree' : r < 0.85 ? 'hydrant' : 'flowers';
    const off = kind === 'house' ? rand(5.5, 7.5) : kind === 'tree' ? rand(4.2, 6) : rand(3.6, 4.1);
    objects.push({
      kind: 'decor', type: kind, z: z + rand(-1.5, 1.5), x: side * off,
      color: pick(['#ff8fab', '#ffd166', '#8ecae6', '#b8e986', '#cdb4db', '#ffb4a2']),
      roof: pick(['#e63946', '#3a86ff', '#8338ec', '#fb8500']),
    });
  }
}

function drawDecor(o) {
  const g = project(o.x, 0, o.z);
  const u = view.unit * g.s;
  if (g.y < view.horizon - 2) return;
  const lw = Math.max(1, 0.05 * u);
  if (o.type === 'house') {
    const w = 2.6 * u, h = 1.9 * u;
    ctx.beginPath();
    ctx.rect(g.x - w / 2, g.y - h, w, h);
    outlined(o.color, '#5a4a5a', lw);
    ctx.beginPath();
    ctx.moveTo(g.x - w * 0.62, g.y - h); ctx.lineTo(g.x, g.y - h - 1.2 * u); ctx.lineTo(g.x + w * 0.62, g.y - h);
    ctx.closePath();
    outlined(o.roof, '#5a4a5a', lw);
    ctx.beginPath();
    ctx.roundRect(g.x - 0.28 * u, g.y - 0.95 * u, 0.56 * u, 0.95 * u, [0.25 * u, 0.25 * u, 0, 0]);
    outlined('#8a5a2b', '#5a4a5a', lw);
    for (const sx of [-0.85, 0.85]) {
      ctx.beginPath();
      ctx.rect(g.x + sx * u - 0.3 * u, g.y - 1.45 * u, 0.6 * u, 0.5 * u);
      outlined('#d6f3ff', '#5a4a5a', lw);
    }
  } else if (o.type === 'tree') {
    ctx.beginPath();
    ctx.roundRect(g.x - 0.14 * u, g.y - 1.3 * u, 0.28 * u, 1.3 * u, 0.06 * u);
    outlined('#9c6b3c', '#5e3d1f', lw);
    ctx.beginPath();
    ctx.arc(g.x, g.y - 2.0 * u, 0.85 * u, 0, Math.PI * 2);
    ctx.arc(g.x - 0.55 * u, g.y - 1.55 * u, 0.55 * u, 0, Math.PI * 2);
    ctx.arc(g.x + 0.55 * u, g.y - 1.55 * u, 0.55 * u, 0, Math.PI * 2);
    outlined('#4caf50', '#2e7d32', lw);
    ctx.fillStyle = '#ff5a5f';
    for (const [dx, dy] of [[-0.3, -2.2], [0.35, -1.9], [-0.1, -1.6]]) {
      ctx.beginPath(); ctx.arc(g.x + dx * u, g.y + dy * u, 0.09 * u, 0, Math.PI * 2); ctx.fill();
    }
  } else if (o.type === 'hydrant') {
    ctx.beginPath();
    ctx.roundRect(g.x - 0.2 * u, g.y - 0.75 * u, 0.4 * u, 0.75 * u, 0.08 * u);
    outlined('#ef3b3b', '#7a1515', lw);
    ctx.beginPath();
    ctx.arc(g.x, g.y - 0.75 * u, 0.22 * u, Math.PI, 0);
    outlined('#ef3b3b', '#7a1515', lw);
    ctx.beginPath();
    ctx.roundRect(g.x - 0.34 * u, g.y - 0.55 * u, 0.68 * u, 0.16 * u, 0.06 * u);
    outlined('#d62828', '#7a1515', lw);
  } else {
    for (let k = 0; k < 5; k++) {
      const fx = g.x + (k - 2) * 0.25 * u, fy = g.y - (0.25 + (k % 2) * 0.12) * u;
      ctx.strokeStyle = '#3e9b3e';
      ctx.lineWidth = lw;
      ctx.beginPath(); ctx.moveTo(fx, g.y); ctx.lineTo(fx, fy); ctx.stroke();
      ctx.fillStyle = ['#ff6fa5', '#ffd43b', '#b07cff', '#ff8c42', '#ffffff'][k];
      ctx.beginPath(); ctx.arc(fx, fy, 0.1 * u, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ffd43b';
      ctx.beginPath(); ctx.arc(fx, fy, 0.035 * u, 0, Math.PI * 2); ctx.fill();
    }
  }
}

// ---------- the pups ----------
// Two original pups: a firefighter corgi and a police beagle. Their body follows
// your pose (shoulders, elbows, wrists, hips, knees, ankles, head tilt).

export const PUPS = {
  fire: {
    name: 'Fire pup',
    fur: '#ec9a45', light: '#fff4e2', ear: '#d9822f', earInner: '#ffc2b3', eye: '#4a2c17',
    coat: '#ffc83d', coatDark: '#c99100', trim: '#e8eef5', collar: '#e63946',
  },
  police: {
    name: 'Police pup',
    fur: '#c27c3a', light: '#fffaf2', ear: '#5e3518', earInner: '#5e3518', eye: '#2d1a0e',
    coat: '#3d7bf0', coatDark: '#1f4fb0', trim: '#ffd43b', collar: '#1f3d8a',
  },
};

const ELB_L = 13, ELB_R = 14, KNEE_L = 25, KNEE_R = 26, EYE_L = 2, EYE_R = 5;

function limb(c, a, b, color, w, outline) {
  c.strokeStyle = outline;
  c.lineWidth = w + 2 * Math.max(1.5, w * 0.12);
  c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke();
  c.strokeStyle = color;
  c.lineWidth = w;
  c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke();
}

function paw(c, p, r, color, outline, t) {
  c.beginPath();
  c.ellipse(p.x, p.y, r, r * 0.8, 0, 0, Math.PI * 2);
  c.fillStyle = color; c.fill();
  c.strokeStyle = outline; c.lineWidth = Math.max(1.5, r * 0.18); c.stroke();
  c.strokeStyle = 'rgba(0,0,0,0.25)';
  c.lineWidth = Math.max(1, r * 0.1);
  for (const dx of [-0.3, 0.3]) {
    c.beginPath(); c.moveTo(p.x + dx * r, p.y + r * 0.1); c.lineTo(p.x + dx * r, p.y + r * 0.65); c.stroke();
  }
}

function star(c, x, y, r, fill, stroke) {
  c.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5, rr = i % 2 ? r * 0.45 : r;
    c.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  c.closePath();
  c.fillStyle = fill; c.fill();
  c.strokeStyle = stroke; c.lineWidth = Math.max(1, r * 0.12); c.stroke();
}

/**
 * Draws a pup.
 * @param c     canvas 2D context
 * @param P     (landmarkIndex) => {x, y} screen point
 * @param u     pixels per world unit (the pup is ~1.9 units tall)
 * @param kind  'fire' | 'police'
 * @param time  seconds, for the tail wag and tongue
 */
export function drawPup(c, P, u, kind, time = 0, highlight = null) {
  const k = PUPS[kind] || PUPS.fire;
  const ol = '#3b2a1e';
  const shL = P(L_SH), shR = P(R_SH), hipL = P(L_HIP), hipR = P(R_HIP);
  const elL = P(ELB_L), elR = P(ELB_R), wrL = P(L_WR), wrR = P(R_WR);
  const knL = P(KNEE_L), knR = P(KNEE_R), anL = P(L_ANK), anR = P(R_ANK);
  const hipM = { x: (hipL.x + hipR.x) / 2, y: (hipL.y + hipR.y) / 2 };
  const shM = { x: (shL.x + shR.x) / 2, y: (shL.y + shR.y) / 2 };
  c.save();
  c.lineCap = 'round';
  c.lineJoin = 'round';

  // Wagging tail, peeking out beside the hips
  const wag = Math.sin(time * 12) * 0.35;
  const tailBase = { x: hipM.x + 0.12 * u, y: hipM.y - 0.05 * u };
  const tailTip = { x: tailBase.x + Math.cos(-0.9 + wag) * 0.55 * u, y: tailBase.y + Math.sin(-0.9 + wag) * 0.55 * u };
  limb(c, tailBase, tailTip, k.fur, 0.16 * u, ol);
  c.beginPath(); c.arc(tailTip.x, tailTip.y, 0.08 * u, 0, Math.PI * 2); c.fillStyle = k.light; c.fill();

  // Legs
  for (const [h, kn, an] of [[hipL, knL, anL], [hipR, knR, anR]]) {
    limb(c, h, kn, k.fur, 0.26 * u, ol);
    limb(c, kn, an, k.fur, 0.22 * u, ol);
    paw(c, { x: an.x, y: an.y + 0.02 * u }, 0.16 * u, k.light, ol);
  }

  // Body: rescue coat (fire) or vest (police)
  const pad = 0.12 * u;
  const torso = [
    { x: shL.x + (shL.x < shR.x ? -pad : pad), y: shL.y },
    { x: shR.x + (shR.x < shL.x ? -pad : pad), y: shR.y },
    { x: hipR.x + (hipR.x < hipL.x ? -pad : pad), y: hipR.y + 0.08 * u },
    { x: hipL.x + (hipL.x < hipR.x ? -pad : pad), y: hipL.y + 0.08 * u },
  ];
  c.beginPath();
  torso.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)));
  c.closePath();
  c.lineWidth = 0.22 * u + 4; c.strokeStyle = ol; c.stroke();
  c.lineWidth = 0.22 * u; c.strokeStyle = k.coat; c.stroke();
  c.fillStyle = k.coat; c.fill();
  c.save();
  c.clip();
  const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  if (kind === 'fire') {
    // two reflective stripes and a zip
    for (const t of [0.55, 0.8]) {
      const a = lerp(shL, hipL, t), b = lerp(shR, hipR, t);
      c.strokeStyle = k.trim; c.lineWidth = 0.1 * u;
      c.beginPath(); c.moveTo(a.x - u, a.y); c.lineTo(b.x + u, b.y); c.stroke();
    }
    c.strokeStyle = k.coatDark; c.lineWidth = Math.max(1.5, 0.03 * u);
    c.beginPath(); c.moveTo(shM.x, shM.y); c.lineTo(hipM.x, hipM.y); c.stroke();
  } else {
    // vest pockets + a gold star badge
    const chest = lerp(shM, hipM, 0.3);
    star(c, chest.x + (shR.x - shL.x) * 0.22, chest.y, 0.13 * u, k.trim, '#b8860b');
    const belt = lerp(shM, hipM, 0.85);
    c.fillStyle = k.coatDark;
    c.fillRect(belt.x - u, belt.y - 0.05 * u, 2 * u, 0.1 * u);
  }
  c.restore();
  // Collar with a round tag
  c.strokeStyle = k.collar; c.lineWidth = 0.09 * u;
  c.beginPath(); c.moveTo(shL.x, shM.y - 0.04 * u); c.quadraticCurveTo(shM.x, shM.y + 0.1 * u, shR.x, shM.y - 0.04 * u); c.stroke();
  c.beginPath(); c.arc(shM.x, shM.y + 0.1 * u, 0.07 * u, 0, Math.PI * 2);
  c.fillStyle = '#ffd43b'; c.fill(); c.strokeStyle = '#b8860b'; c.lineWidth = 1.5; c.stroke();

  // Arms: coat sleeves, furry forearms, paws
  for (const [s, e, w] of [[shL, elL, wrL], [shR, elR, wrR]]) {
    limb(c, s, e, k.coat, 0.2 * u, ol);
    limb(c, e, w, k.fur, 0.17 * u, ol);
    paw(c, w, 0.12 * u, k.light, ol);
  }

  // Head
  const nose = P(NOSE), eL = P(EYE_L), eR = P(EYE_R);
  let ang = Math.atan2(eR.y - eL.y, eR.x - eL.x);
  if (ang > Math.PI / 2) ang -= Math.PI;
  if (ang < -Math.PI / 2) ang += Math.PI;
  ang = Math.max(-0.5, Math.min(0.5, ang));
  const R = 0.42 * u;
  // Keep the head sitting on the shoulders even if the nose point jitters.
  const hx = nose.x, hy = Math.min(nose.y - 0.05 * u, shM.y - R * 0.95);
  c.translate(hx, hy);
  c.rotate(ang);

  if (kind === 'fire') {
    // big upright corgi ears (behind the head)
    for (const s of [-1, 1]) {
      // wide, round-tipped corgi ears
      c.beginPath();
      c.moveTo(s * R * 0.2, -R * 0.7);
      c.quadraticCurveTo(s * R * 0.55, -R * 1.65, s * R * 0.98, -R * 1.42);
      c.quadraticCurveTo(s * R * 1.12, -R * 0.9, s * R * 0.95, -R * 0.3);
      c.closePath();
      outlined(k.ear, ol, Math.max(1.5, 0.03 * u), c);
      c.beginPath();
      c.moveTo(s * R * 0.4, -R * 0.68);
      c.quadraticCurveTo(s * R * 0.65, -R * 1.38, s * R * 0.9, -R * 1.25);
      c.quadraticCurveTo(s * R * 0.98, -R * 0.85, s * R * 0.86, -R * 0.45);
      c.closePath();
      c.fillStyle = k.earInner; c.fill();
    }
  }
  // head
  c.beginPath();
  c.ellipse(0, 0, R * 1.05, R, 0, 0, Math.PI * 2);
  outlined(k.fur, ol, Math.max(1.5, 0.035 * u), c);
  // white blaze + muzzle
  c.fillStyle = k.light;
  c.beginPath();
  c.moveTo(-R * 0.12, -R * 0.75); c.lineTo(R * 0.12, -R * 0.75); c.lineTo(R * 0.2, R * 0.1); c.lineTo(-R * 0.2, R * 0.1);
  c.fill();
  c.beginPath(); c.ellipse(0, R * 0.42, R * 0.62, R * 0.46, 0, 0, Math.PI * 2); c.fill();
  c.strokeStyle = 'rgba(59,42,30,0.35)'; c.lineWidth = Math.max(1, 0.02 * u); c.stroke();
  if (kind === 'police') {
    // long floppy beagle ears (in front of the head sides)
    for (const s of [-1, 1]) {
      c.save();
      c.translate(s * R * 0.85, -R * 0.35);
      c.rotate(s * -0.25 + Math.sin(time * 9 + s) * 0.06);
      c.beginPath();
      c.ellipse(s * R * 0.08, R * 0.55, R * 0.3, R * 0.68, 0, 0, Math.PI * 2);
      outlined(k.ear, ol, Math.max(1.5, 0.03 * u), c);
      c.restore();
    }
  }
  // eyes
  for (const s of [-1, 1]) {
    const ex = s * R * 0.36, ey = -R * 0.08;
    c.beginPath(); c.ellipse(ex, ey, R * 0.2, R * 0.24, 0, 0, Math.PI * 2);
    outlined('#fff', ol, Math.max(1, 0.025 * u), c);
    c.beginPath(); c.arc(ex + s * R * 0.02, ey + R * 0.03, R * 0.15, 0, Math.PI * 2);
    c.fillStyle = k.eye; c.fill();
    c.beginPath(); c.arc(ex + s * R * 0.02, ey + R * 0.05, R * 0.08, 0, Math.PI * 2);
    c.fillStyle = '#000'; c.fill();
    c.beginPath(); c.arc(ex - R * 0.04, ey - R * 0.05, R * 0.055, 0, Math.PI * 2);
    c.fillStyle = '#fff'; c.fill();
  }
  // cheeks
  c.fillStyle = 'rgba(255, 120, 140, 0.35)';
  for (const s of [-1, 1]) { c.beginPath(); c.ellipse(s * R * 0.62, R * 0.35, R * 0.14, R * 0.09, 0, 0, Math.PI * 2); c.fill(); }
  // nose + smile + tongue
  c.beginPath(); c.ellipse(0, R * 0.24, R * 0.19, R * 0.13, 0, 0, Math.PI * 2);
  c.fillStyle = '#2b1d14'; c.fill();
  c.beginPath(); c.ellipse(-R * 0.04, R * 0.19, R * 0.04, R * 0.025, 0, 0, Math.PI * 2);
  c.fillStyle = 'rgba(255,255,255,0.7)'; c.fill();
  c.strokeStyle = ol; c.lineWidth = Math.max(1.5, 0.03 * u);
  c.beginPath();
  c.moveTo(0, R * 0.32); c.lineTo(0, R * 0.42);
  c.moveTo(-R * 0.22, R * 0.42); c.quadraticCurveTo(-R * 0.1, R * 0.55, 0, R * 0.42);
  c.quadraticCurveTo(R * 0.1, R * 0.55, R * 0.22, R * 0.42);
  c.stroke();
  const tongue = 0.12 + Math.abs(Math.sin(time * 6)) * 0.06;
  c.beginPath(); c.ellipse(R * 0.05, R * (0.5 + tongue / 2), R * 0.09, R * tongue, 0, 0, Math.PI);
  c.fillStyle = '#ff7a95'; c.fill();

  // Hats
  if (kind === 'fire') {
    // firefighter helmet: dome, brim, front badge
    c.beginPath();
    c.ellipse(0, -R * 0.55, R * 0.82, R * 0.62, 0, Math.PI, 0);
    c.closePath();
    outlined('#e63946', ol, Math.max(1.5, 0.035 * u), c);
    c.strokeStyle = '#ffd43b'; c.lineWidth = Math.max(2, 0.06 * u);
    c.beginPath(); c.moveTo(0, -R * 1.17); c.lineTo(0, -R * 0.6); c.stroke();
    c.beginPath(); c.ellipse(0, -R * 0.55, R * 1.08, R * 0.17, 0, 0, Math.PI * 2);
    outlined('#c1121f', ol, Math.max(1.5, 0.035 * u), c);
    c.beginPath(); c.roundRect(-R * 0.22, -R * 0.98, R * 0.44, R * 0.34, R * 0.08);
    outlined('#ffd43b', '#b8860b', Math.max(1, 0.02 * u), c);
    c.fillStyle = '#e63946';
    c.beginPath(); c.arc(0, -R * 0.81, R * 0.08, 0, Math.PI * 2); c.fill();
  } else {
    // police cap: crown, band, visor, star
    c.beginPath();
    c.moveTo(-R * 0.62, -R * 0.62); c.lineTo(-R * 0.78, -R * 1.12);
    c.quadraticCurveTo(0, -R * 1.42, R * 0.78, -R * 1.12); c.lineTo(R * 0.62, -R * 0.62);
    c.closePath();
    outlined('#1f3d8a', ol, Math.max(1.5, 0.035 * u), c);
    c.beginPath(); c.rect(-R * 0.64, -R * 0.74, R * 1.28, R * 0.16);
    outlined('#14275a', ol, Math.max(1, 0.025 * u), c);
    c.beginPath(); c.ellipse(0, -R * 0.56, R * 0.66, R * 0.13, 0, 0, Math.PI);
    outlined('#111', ol, Math.max(1, 0.025 * u), c);
    star(c, 0, -R * 0.98, R * 0.17, '#ffd43b', '#b8860b');
  }
  c.restore();

  if (highlight) {
    // glow ring while ducking etc.
    c.save();
    c.strokeStyle = highlight; c.lineWidth = 4; c.globalAlpha = 0.8;
    c.beginPath(); c.ellipse(hipM.x, anL.y + 0.05 * u, 0.7 * u, 0.15 * u, 0, 0, Math.PI * 2); c.stroke();
    c.restore();
  }
}

function drawPlayer() {
  if (!pose || !base) return;
  if (invul > 0 && Math.floor(invul * 12) % 2 === 0) return; // blink while invulnerable

  const ground = project(laneVis * LANE_W, 0, 0);
  const bodyH = Math.max(0.05, base.ankleY - base.noseY) * 1.12; // nose→ankle ≈ 89% of height
  const scale = (1.9 * view.unit) / bodyH;                  // the avatar is ~1.9 units tall
  // Feet stay on the ground line: anchor to where your feet are now.
  const footY = Math.max(pose[L_ANK].y, pose[R_ANK].y);
  const P = (i) => ({
    x: ground.x + (pose[i].x - m.hipX) * scale,
    y: ground.y + (pose[i].y - footY) * scale - 0.1 * view.unit,
  });

  // Shadow
  ctx.fillStyle = 'rgba(30, 60, 20, 0.3)';
  ctx.beginPath();
  ctx.ellipse(ground.x, ground.y, view.unit * 0.6, view.unit * 0.13, 0, 0, Math.PI * 2);
  ctx.fill();

  drawPup(ctx, P, view.unit, pupKind, gt + stateTime, ducking ? COLORS.ok : null);
}

function drawEffect(e) {
  const k = e.t / e.life;
  const p = project(e.x * LANE_W, e.h + k * 0.8, 0);
  ctx.save();
  ctx.globalAlpha = 1 - k;
  ctx.font = `800 ${Math.round(view.unit * 0.4)}px "Baloo 2", system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = Math.max(3, view.unit * 0.08);
  ctx.strokeText(e.text, p.x, p.y);
  ctx.fillStyle = e.color;
  ctx.fillText(e.text, p.x, p.y);
  ctx.restore();
}

// Small mirrored camera view so you can see whether you're in frame.
function drawCameraInset(W, H) {
  if (video.readyState < 2) return;
  const vw = video.videoWidth || 640, vh = video.videoHeight || 480;
  const aspect = vw / vh;
  const w = Math.min(W * 0.22, 300), h = (w * vh) / vw;
  const x = W - w - 16, y = 64;
  ctx.save();
  ctx.globalAlpha = 0.9;
  ctx.translate(x + w, y);
  ctx.scale(-1, 1);
  ctx.drawImage(video, 0, 0, w, h);
  ctx.restore();
  ctx.strokeStyle = m?.visible ? COLORS.cyan : COLORS.red;
  ctx.lineWidth = 3;
  ctx.strokeRect(x, y, w, h);
  if (pose) {
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = 2;
    for (const [a, b] of BONES) {
      if (pose[a].v < 0.3 || pose[b].v < 0.3) continue;
      ctx.beginPath();
      ctx.moveTo(x + (pose[a].x / aspect) * w, y + pose[a].y * h);
      ctx.lineTo(x + (pose[b].x / aspect) * w, y + pose[b].y * h);
      ctx.stroke();
    }
  }
  // Lane guide: where you need to stand for each lane
  if (base && state === 'play') {
    for (const l of [-1, 1]) {
      const gx = x + ((base.hipX + l * LANE_ENTER * base.shoulderW) / aspect) * w;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(gx, y);
      ctx.lineTo(gx, y + h);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }
}

function banner(text, sub, color = '#ff8c42') {
  const W = innerWidth, H = innerHeight, u = Math.min(W, H);
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.font = `800 ${Math.round(u * 0.1)}px "Baloo 2", system-ui, sans-serif`;
  ctx.strokeStyle = '#1d3557';
  ctx.lineWidth = u * 0.022;
  ctx.strokeText(text, W / 2, H * 0.2);
  ctx.fillStyle = color;
  ctx.fillText(text, W / 2, H * 0.2);
  if (sub) {
    ctx.font = `700 ${Math.round(u * 0.036)}px "Baloo 2", system-ui, sans-serif`;
    ctx.lineWidth = u * 0.01;
    ctx.strokeText(sub, W / 2, H * 0.2 + u * 0.085);
    ctx.fillStyle = '#fff';
    ctx.fillText(sub, W / 2, H * 0.2 + u * 0.085);
  }
  ctx.restore();
}

// True when an uncleared squat gate will reach the player within ~1.3 s.
function squatSoon() {
  return objects.some((o) => o.kind === 'bar' && !o.done && o.z > 0 && o.z < speed * 1.3);
}

function drawBanner() {
  if (state === 'frame') banner('Hello, pup!', 'Step back so your whole body is in the little picture (top right)');
  else if (state === 'calibrate') banner('Stand still…', 'Stand in the middle', COLORS.cyan);
  else if (state === 'countdown') banner(String(3 - Math.floor(stateTime)), 'Step to the side to move!', '#ffd43b');
  else if (state === 'play' && lostFor > 0.3) banner('Where are you?', 'Come back into the picture!');
  else if (state === 'play' && gt < 1.5) banner("Let's go!", null, COLORS.ok);
  else if (state === 'play' && squatSoon()) banner('DUCK DOWN!', null, Math.floor(gt * 6) % 2 ? COLORS.magenta : '#ffd43b');
  else if (state === 'over') banner('Great job!', `Score: ${score}`, COLORS.ok);
}

// ---------- main loop ----------

let prev = performance.now();
function loop(now) {
  const dt = Math.min((now - prev) / 1000, 0.05);
  prev = now;
  track(now);
  update(dt);
  draw();
  requestAnimationFrame(loop);
}

