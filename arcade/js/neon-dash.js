// Neon Dash — a full-body endless runner using MediaPipe Pose Landmarker.
// Step left/right to change lanes, jump over hurdles, squat under bars,
// collect coins. Your avatar is your own skeleton.
import { FilesetResolver, PoseLandmarker } from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.3/vision_bundle.mjs';
import { createCamera } from './camera.js';

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
const START_LIVES = 3;
const LANE_ENTER = 0.75;   // hip offset (in shoulder widths) to move into a side lane
const LANE_EXIT = 0.45;    // ...and to come back to the middle
const ENABLE_JUMP = false; // jumping is switched off for now (no hurdles, no high coins)
const JUMP_RISE = 0.14;    // hip rise (in torso lengths) that counts as a jump
const DUCK_DROP = 0.30;    // head drop (in torso lengths) that counts as a squat
const WINDOW = 0.22;       // seconds of leeway around each hurdle/bar
const SPAWN_Z = 80;        // how far ahead (world units) obstacles appear
const LANE_W = 2;          // world units between lane centers
const COLORS = {
  cyan: '#22e4ff', magenta: '#ff2bd6', orange: '#ff9f1c', yellow: '#ffd23f', red: '#ff3b5c', ok: '#7ee787',
};
const BEST_KEY = 'neondash.best';

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

let landmarker = null;
let looping = false;
let wantStart = false;
let lastVideoTime = -1;

// Tracking
let pose = null;   // landmarks in mirrored video pixels: {x, y, v, inFrame}
let m = null;      // current body measurements
let base = null;   // calibrated standing pose
let calib = [];    // samples while calibrating
let lane = 0, laneVis = 0, jumping = false, ducking = false;

// Game
let state = 'idle'; // idle | frame | calibrate | countdown | play | over
let stateTime = 0, lostFor = 0;
let gt = 0, speed = 0, distance = 0, nextRowIn = 0;
let score = 0, bonus = 0, coins = 0, lives = START_LIVES, invul = 0, shake = 0, flash = 0;
let objects = [], effects = [];

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
  score = 0; bonus = 0; coins = 0; lives = START_LIVES; invul = 0; shake = 0; flash = 0;
  objects = []; effects = []; gt = 0; distance = 0; speed = 0; nextRowIn = 0;
  lane = 0; laneVis = 0; base = null; calib = [];
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
    overlay.querySelector('h1').textContent = `Score: ${score}`;
    msg.textContent = `${Math.floor(distance)} m and ${coins} coins. Best: ${best}. Run again?`;
    startBtn.textContent = 'Run again';
    overlay.hidden = false;
    setState('idle');
  }, 2000);
}

function updateHud() {
  scoreEl.textContent = String(score);
  distEl.textContent = `${Math.floor(distance)} m`;
  livesEl.textContent = '♥'.repeat(Math.max(0, lives)) + '♡'.repeat(Math.max(0, START_LIVES - lives));
}

// ---------- tracking ----------

const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function track(now) {
  if (video.readyState < 2 || video.currentTime === lastVideoTime) return;
  lastVideoTime = video.currentTime;
  const lms = landmarker.detectForVideo(video, now).landmarks?.[0];
  if (!lms) { pose = null; m = null; return; }

  const vw = video.videoWidth || 640, vh = video.videoHeight || 480;
  pose = lms.map((p) => ({
    x: (1 - p.x) * vw, // mirrored: step right → move right on screen
    y: p.y * vh,
    v: p.visibility ?? 1,
    inFrame: p.x > 0.01 && p.x < 0.99 && p.y > 0.01 && p.y < 0.99,
  }));
  const hip = mid(pose[L_HIP], pose[R_HIP]);
  const sh = mid(pose[L_SH], pose[R_SH]);
  m = {
    visible: KEY_POINTS.every((i) => pose[i].v > 0.5 && pose[i].inFrame),
    hipX: hip.x,
    hipY: hip.y,
    noseY: pose[NOSE].y,
    ankleY: (pose[L_ANK].y + pose[R_ANK].y) / 2,
    shoulderW: Math.max(dist(pose[L_SH], pose[R_SH]), 1),
    torso: Math.max(dist(sh, hip), 1),
    wristY: Math.max(pose[L_WR].y, pose[R_WR].y), // the lower of the two wrists
  };

  if (!base || !m.visible) return;

  // Lanes, with hysteresis so you don't flicker at the edges.
  const off = (m.hipX - base.hipX) / base.shoulderW;
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
  const late = gt > 25;
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
  laneVis += (lane - laneVis) * Math.min(1, dt * 12);

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
    if (stateTime >= 3) { setState('play'); speed = 14; nextRowIn = 10; }
    return;
  }
  if (state !== 'play') return;

  // Pause while the player is out of view.
  if (!m?.visible) { lostFor += dt; return; }
  lostFor = 0;
  gt += dt;

  speed = 14 + Math.min(gt, 150) * 0.14; // world units / second, ramps up
  const dz = speed * dt;
  distance += dz;
  nextRowIn -= dz;
  if (nextRowIn <= 0) {
    spawnRow();
    nextRowIn = Math.max(11, 20 - gt * 0.06);
  }

  const win = speed * WINDOW;
  for (const o of objects) {
    o.z -= dz;
    if (o.done) continue;
    if (o.kind === 'coin') {
      if (Math.abs(o.z) < 1.2 && lane === o.lane && (!o.high || jumping)) {
        o.done = true; o.taken = true; coins += 1; bonus += 10;
        effects.push({ text: '+10', color: COLORS.yellow, t: 0, life: 0.6, x: o.lane, h: o.high ? 2.6 : 1.8 });
      } else if (o.z < -1.2) o.done = true;
    } else if (o.kind === 'block') {
      if (o.z <= 0.6) { o.done = true; if (lane === o.lane) hurt('BONK!'); }
    } else {
      const ok = o.kind === 'hurdle' ? jumping : ducking;
      if (Math.abs(o.z) < win && ok) {
        o.done = true; o.cleared = true; bonus += 25;
        effects.push({ text: o.kind === 'hurdle' ? 'Nice jump! +25' : 'Limbo! +25', color: COLORS.ok, t: 0, life: 0.9, x: 0, h: 2.8 });
      } else if (o.z < -win) {
        o.done = true;
        hurt(o.kind === 'hurdle' ? 'TRIPPED!' : 'OUCH!');
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
    ctx.fillStyle = `rgba(255, 59, 92, ${flash * 0.5})`;
    ctx.fillRect(0, 0, W, H);
  }
  drawCameraInset(W, H);
  drawBanner(W, H);
}

function drawSky(W, H) {
  const g = ctx.createLinearGradient(0, 0, 0, view.horizon);
  g.addColorStop(0, '#07051a');
  g.addColorStop(1, '#2a0b4a');
  ctx.fillStyle = g;
  ctx.fillRect(-50, -50, W + 100, view.horizon + 50);

  // Striped sun
  const r = Math.min(W, H) * 0.16;
  const sx = W / 2, sy = view.horizon - r * 0.35;
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, W, view.horizon);
  ctx.clip();
  const sg = ctx.createLinearGradient(0, sy - r, 0, sy + r);
  sg.addColorStop(0, '#ffd23f');
  sg.addColorStop(1, '#ff2bd6');
  ctx.fillStyle = sg;
  ctx.beginPath();
  ctx.arc(sx, sy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#2a0b4a';
  for (let i = 0; i < 6; i++) {
    const y = sy + r * (0.1 + i * 0.16);
    ctx.fillRect(sx - r, y, r * 2, 2 + i * 1.5);
  }
  ctx.restore();

  ctx.fillStyle = '#0d0420';
  ctx.fillRect(-50, view.horizon, W + 100, H - view.horizon + 50);
}

function drawRoad(W, H) {
  const half = LANE_W * 1.5;
  const far = 120;
  const c = project(half, 0, far), d = project(-half, 0, far);
  ctx.fillStyle = '#140a2e';
  ctx.beginPath();
  ctx.moveTo(project(-half, 0, -CAM_BACK).x, H + 50);
  ctx.lineTo(project(half, 0, -CAM_BACK).x, H + 50);
  ctx.lineTo(c.x, c.y);
  ctx.lineTo(d.x, d.y);
  ctx.fill();

  // Moving cross lines give the feeling of speed.
  ctx.strokeStyle = 'rgba(255, 43, 214, 0.55)';
  ctx.lineWidth = 2;
  const spacing = 6;
  const phase = distance % spacing;
  for (let z = -phase - spacing; z < far; z += spacing) {
    if (z < -CAM_BACK + NEAR) continue;
    const l = project(-half, 0, z), r = project(half, 0, z);
    ctx.globalAlpha = Math.min(1, 1.4 - z / far);
    ctx.beginPath();
    ctx.moveTo(l.x, l.y);
    ctx.lineTo(r.x, r.y);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // Lane and edge lines
  for (const x of [-half, -LANE_W / 2, LANE_W / 2, half]) {
    const n = project(x, 0, -CAM_BACK), f = project(x, 0, far);
    const edge = Math.abs(x) === half;
    ctx.strokeStyle = edge ? COLORS.cyan : 'rgba(34, 228, 255, 0.35)';
    ctx.lineWidth = edge ? 4 : 2;
    ctx.shadowColor = COLORS.cyan;
    ctx.shadowBlur = edge ? 12 : 0;
    ctx.beginPath();
    ctx.moveTo(n.x, n.y);
    ctx.lineTo(f.x, f.y);
    ctx.stroke();
  }
  ctx.shadowBlur = 0;
}

function glowStroke(color, width, blur = 14) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.shadowColor = color;
  ctx.shadowBlur = blur;
}

function drawObject(o) {
  // Fade in at the horizon, and fade out once past the player so nothing blocks the view.
  const fade = Math.min(1, (SPAWN_Z - o.z) / 10, Math.max(0, 1 + o.z / 0.8));
  if (fade <= 0) return;
  ctx.save();
  ctx.globalAlpha = fade;
  if (o.kind === 'block') {
    const x = o.lane * LANE_W, w = 0.8, h = 1.7, depth = 1.2;
    const f1 = project(x - w, 0, o.z), f2 = project(x + w, h, o.z);
    const b2 = project(x + w, h, o.z + depth), b1 = project(x - w, h, o.z + depth);
    // top face
    ctx.fillStyle = 'rgba(255, 159, 28, 0.35)';
    ctx.beginPath();
    ctx.moveTo(f1.x, f2.y); ctx.lineTo(f2.x, f2.y); ctx.lineTo(b2.x, b2.y); ctx.lineTo(b1.x, b1.y);
    ctx.fill();
    // front face
    ctx.fillStyle = 'rgba(255, 159, 28, 0.22)';
    ctx.fillRect(f1.x, f2.y, f2.x - f1.x, f1.y - f2.y);
    glowStroke(COLORS.orange, Math.max(2, 5 * f1.s));
    ctx.strokeRect(f1.x, f2.y, f2.x - f1.x, f1.y - f2.y);
    ctx.beginPath();
    ctx.moveTo(f1.x, f1.y); ctx.lineTo(f2.x, f2.y); ctx.moveTo(f2.x, f1.y); ctx.lineTo(f1.x, f2.y);
    ctx.globalAlpha = fade * 0.5;
    ctx.stroke();
  } else if (o.kind === 'bar') {
    drawSquatGate(o);
  } else if (o.kind === 'hurdle') {
    const half = LANE_W * 1.5;
    const hurdle = true;
    const color = o.cleared ? COLORS.ok : COLORS.yellow;
    const lo = 0.45, hi = 0.75;
    const l1 = project(-half, lo, o.z), r2 = project(half, hi, o.z);
    const lg = project(-half, 0, o.z), rg = project(half, 0, o.z);
    glowStroke(color, Math.max(2, 6 * l1.s));
    // posts
    ctx.beginPath();
    ctx.moveTo(lg.x, lg.y); ctx.lineTo(lg.x, r2.y);
    ctx.moveTo(rg.x, rg.y); ctx.lineTo(rg.x, r2.y);
    ctx.stroke();
    // the bar itself
    ctx.fillStyle = color + '55';
    ctx.fillRect(l1.x, r2.y, r2.x - l1.x, l1.y - r2.y);
    ctx.strokeRect(l1.x, r2.y, r2.x - l1.x, l1.y - r2.y);
    // label
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#fff';
    ctx.font = `800 ${Math.max(10, Math.round(view.unit * 0.45 * l1.s))}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = hurdle ? 'bottom' : 'top';
    ctx.fillText(hurdle ? '▲ JUMP ▲' : '▼ SQUAT ▼', view.cx, hurdle ? r2.y - 6 * l1.s : l1.y + 6 * l1.s);
  } else if (o.kind === 'coin') {
    const p = project(o.lane * LANE_W, o.high ? 2.3 : 0.9, o.z);
    const r = 0.32 * view.unit * p.s;
    const spin = Math.abs(Math.cos(gt * 4 + o.z));
    ctx.fillStyle = COLORS.yellow;
    ctx.shadowColor = COLORS.yellow;
    ctx.shadowBlur = 16;
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, Math.max(1, r * (0.25 + 0.75 * spin)), r, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// A big overhead wall spanning the whole track: its glowing bottom edge sits
// just below head height, so the only way through is to squat under it.
const GATE_LOW = 1.25;  // height of the bottom edge (avatar is ~1.9 tall)
const GATE_HIGH = 4.5;  // top of the wall (goes above the camera)

function drawSquatGate(o) {
  const half = LANE_W * 1.5 + 0.3;
  const color = o.cleared ? COLORS.ok : COLORS.magenta;
  const bl = project(-half, GATE_LOW, o.z), tr = project(half, GATE_HIGH, o.z);
  const gl = project(-half, 0, o.z), gr = project(half, 0, o.z);
  const w = tr.x - bl.x, h = bl.y - tr.y;
  const px = view.unit * bl.s; // pixels per world unit at this depth

  // Danger strip on the floor under the gate
  const f1 = project(-half, 0, o.z - 0.6), f2 = project(half, 0, o.z + 0.6);
  ctx.fillStyle = o.cleared ? 'rgba(126, 231, 135, 0.25)' : 'rgba(255, 43, 214, 0.3)';
  ctx.beginPath();
  ctx.moveTo(f1.x, f1.y); ctx.lineTo(project(half, 0, o.z - 0.6).x, f1.y);
  ctx.lineTo(f2.x, f2.y); ctx.lineTo(project(-half, 0, o.z + 0.6).x, f2.y);
  ctx.fill();

  // Posts
  glowStroke(color, Math.max(3, 0.12 * px), 18);
  ctx.beginPath();
  ctx.moveTo(gl.x, gl.y); ctx.lineTo(gl.x, tr.y);
  ctx.moveTo(gr.x, gr.y); ctx.lineTo(gr.x, tr.y);
  ctx.stroke();

  // Wall with hazard stripes (fades as it reaches you so it doesn't cover the screen)
  ctx.save();
  ctx.globalAlpha *= Math.max(0.2, Math.min(1, (o.z + 1) / 6));
  ctx.beginPath();
  ctx.rect(bl.x, tr.y, w, h);
  ctx.clip();
  ctx.fillStyle = o.cleared ? 'rgba(126, 231, 135, 0.3)' : 'rgba(120, 10, 100, 0.75)';
  ctx.fillRect(bl.x, tr.y, w, h);
  ctx.fillStyle = o.cleared ? 'rgba(126, 231, 135, 0.35)' : 'rgba(255, 43, 214, 0.55)';
  const stripe = 0.5 * px;
  for (let x = bl.x - h; x < tr.x; x += stripe * 2) {
    ctx.beginPath();
    ctx.moveTo(x, bl.y); ctx.lineTo(x + stripe, bl.y);
    ctx.lineTo(x + stripe + h, tr.y); ctx.lineTo(x + h, tr.y);
    ctx.fill();
  }
  ctx.restore();

  // The edge you must get under: thick and bright
  glowStroke('#fff', Math.max(3, 0.1 * px), 30);
  ctx.beginPath();
  ctx.moveTo(bl.x, bl.y); ctx.lineTo(tr.x, bl.y);
  ctx.stroke();
  glowStroke(color, Math.max(2, 0.05 * px), 30);
  ctx.strokeRect(bl.x, tr.y, w, h);

  // Label, sitting just above the edge
  ctx.shadowColor = 'rgba(0,0,0,0.9)';
  ctx.shadowBlur = 10;
  ctx.fillStyle = '#fff';
  ctx.font = `900 ${Math.max(12, Math.round(0.55 * px))}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText(o.cleared ? '✓' : '▼ SQUAT ▼', view.cx, bl.y - 0.12 * px);
}

function drawPlayer() {
  if (!pose || !base) return;
  if (invul > 0 && Math.floor(invul * 12) % 2 === 0) return; // blink while invulnerable

  const ground = project(laneVis * LANE_W, 0, 0);
  const bodyH = Math.max(1, base.ankleY - base.noseY) * 1.12; // nose→ankle ≈ 89% of height
  const scale = (1.9 * view.unit) / bodyH;                  // the avatar is ~1.9 units tall
  const rise = ENABLE_JUMP ? Math.max(0, base.ankleY - m.ankleY) * 1.6 : 0; // exaggerate jumps a bit
  const pt = (i) => ({
    x: ground.x + (pose[i].x - m.hipX) * scale,
    y: ground.y + (pose[i].y - base.ankleY - rise) * scale,
  });

  // Shadow
  ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
  ctx.beginPath();
  ctx.ellipse(ground.x, ground.y, view.unit * 0.55, view.unit * 0.12, 0, 0, Math.PI * 2);
  ctx.fill();

  const color = jumping ? COLORS.yellow : ducking ? COLORS.magenta : COLORS.cyan;
  ctx.save();
  ctx.globalAlpha = 0.6; // see-through, so obstacles in your lane stay visible
  ctx.lineCap = 'round';
  glowStroke(color, Math.max(5, view.unit * 0.09), 20);
  for (const [a, b] of BONES) {
    if (pose[a].v < 0.3 || pose[b].v < 0.3) continue;
    const p = pt(a), q = pt(b);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(q.x, q.y);
    ctx.stroke();
  }
  const head = pt(NOSE);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(head.x, head.y, view.unit * 0.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawEffect(e) {
  const k = e.t / e.life;
  const p = project(e.x * LANE_W, e.h + k * 0.8, 0);
  ctx.save();
  ctx.globalAlpha = 1 - k;
  ctx.fillStyle = e.color;
  ctx.shadowColor = 'rgba(0,0,0,0.8)';
  ctx.shadowBlur = 8;
  ctx.font = `800 ${Math.round(view.unit * 0.38)}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText(e.text, p.x, p.y);
  ctx.restore();
}

// Small mirrored camera view so you can see whether you're in frame.
function drawCameraInset(W, H) {
  if (video.readyState < 2) return;
  const vw = video.videoWidth || 640, vh = video.videoHeight || 480;
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
      ctx.moveTo(x + (pose[a].x / vw) * w, y + (pose[a].y / vh) * h);
      ctx.lineTo(x + (pose[b].x / vw) * w, y + (pose[b].y / vh) * h);
      ctx.stroke();
    }
  }
  // Lane guide: where you need to stand for each lane
  if (base && state === 'play') {
    for (const l of [-1, 1]) {
      const gx = x + ((base.hipX + l * LANE_ENTER * base.shoulderW) / vw) * w;
      ctx.strokeStyle = 'rgba(34, 228, 255, 0.5)';
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(gx, y);
      ctx.lineTo(gx, y + h);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }
}

function banner(text, sub, color = '#fff') {
  const W = innerWidth, H = innerHeight, u = Math.min(W, H);
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0,0,0,0.8)';
  ctx.shadowBlur = 14;
  ctx.fillStyle = color;
  ctx.font = `800 ${Math.round(u * 0.09)}px system-ui, sans-serif`;
  ctx.fillText(text, W / 2, H * 0.2);
  if (sub) {
    ctx.fillStyle = '#fff';
    ctx.font = `500 ${Math.round(u * 0.034)}px system-ui, sans-serif`;
    ctx.fillText(sub, W / 2, H * 0.2 + u * 0.08);
  }
  ctx.restore();
}

// True when an uncleared squat gate will reach the player within ~1.3 s.
function squatSoon() {
  return objects.some((o) => o.kind === 'bar' && !o.done && o.z > 0 && o.z < speed * 1.3);
}

function drawBanner() {
  if (state === 'frame') banner('Step into view', 'Head to feet in the camera picture (top right)');
  else if (state === 'calibrate') banner('Hold still…', 'Stand in the middle — this is your center lane', COLORS.cyan);
  else if (state === 'countdown') banner(String(3 - Math.floor(stateTime)), 'Step sideways to switch lanes!');
  else if (state === 'play' && lostFor > 0.3) banner('Paused', 'Step back into view to keep running');
  else if (state === 'play' && gt < 1.5) banner('RUN!', null, COLORS.ok);
  else if (state === 'play' && squatSoon()) banner('SQUAT!', null, Math.floor(gt * 6) % 2 ? COLORS.magenta : '#fff');
  else if (state === 'over') banner('Game over', `Score: ${score}`, COLORS.red);
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

