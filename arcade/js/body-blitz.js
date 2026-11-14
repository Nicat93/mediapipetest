// Body Blitz — full-body game using MediaPipe Pose Landmarker.
// Hit blue targets with your hands, orange targets with your feet,
// and duck under the red lasers. Three lives.
import { FilesetResolver, PoseLandmarker } from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.3/vision_bundle.mjs';
import { createCamera } from './camera.js';

const WASM_PATH = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.3/wasm';
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task';

// Pose landmark indices
const NOSE = 0, L_SHOULDER = 11, R_SHOULDER = 12, L_HIP = 23, R_HIP = 24;
const L_ANKLE = 27, R_ANKLE = 28;
const HAND_POINTS = [15, 16, 19, 20]; // wrists + index knuckles
const FOOT_POINTS = [27, 28, 31, 32]; // ankles + toes
const KEY_POINTS = [NOSE, L_SHOULDER, R_SHOULDER, L_HIP, R_HIP, L_ANKLE, R_ANKLE];

const COLORS = { hand: '#4cc9f0', foot: '#ff9f1c', laser: '#ff3b5c', ok: '#7ee787' };
const START_LIVES = 3;
const TARGET_LIFE = 3.2; // seconds
const LASER_WARN = 1.6;
const LASER_FIRE = 0.35;
const BEST_KEY = 'bodyblitz.best';

const video = document.getElementById('cam');
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const overlay = document.getElementById('overlay');
const msg = document.getElementById('msg');
const startBtn = document.getElementById('start');
const hud = document.getElementById('hud');
const scoreEl = document.getElementById('score');
const multEl = document.getElementById('mult');
const livesEl = document.getElementById('lives');

let landmarker = null;
let looping = false;
let wantStart = false;
let lastVideoTime = -1;
let pose = null;      // latest pose in screen pixels, or null
let body = null;      // derived measurements, or null

// Game state: 'idle' | 'frame' (get in view) | 'countdown' | 'play' | 'over'
let state = 'idle';
let gt = 0;           // game time in seconds; only advances while playing with the body in view
let stateTime = 0;    // seconds spent in the current state
let lostFor = 0;      // seconds the body has been out of view
let score = 0, combo = 0, lives = START_LIVES;
let targets = [], effects = [], laser = null;
let nextSpawn = 0, nextLaser = 0, hurtFlash = 0;

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
    minPoseDetectionConfidence: 0.5,
    minTrackingConfidence: 0.5,
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

function setState(s) {
  state = s;
  stateTime = 0;
}

function newGame() {
  score = 0; combo = 0; lives = START_LIVES;
  targets = []; effects = []; laser = null;
  gt = 0; nextSpawn = 1; nextLaser = 9; lostFor = 0; hurtFlash = 0;
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
  let best = 0;
  try { best = Math.max(score, Number(localStorage.getItem(BEST_KEY)) || 0); localStorage.setItem(BEST_KEY, best); } catch {}
  setTimeout(() => {
    hud.hidden = true;
    overlay.querySelector('h1').textContent = `Score: ${score}`;
    msg.textContent = best > 0 ? `Best: ${best}. Ready for another round?` : 'Ready for another round?';
    startBtn.textContent = 'Play again';
    overlay.hidden = false;
    setState('idle');
  }, 1800);
}

const multiplier = () => Math.min(5, 1 + Math.floor(combo / 5));

function updateHud() {
  scoreEl.textContent = String(score);
  multEl.textContent = `x${multiplier()}`;
  livesEl.textContent = '♥'.repeat(Math.max(0, lives)) + '♡'.repeat(Math.max(0, START_LIVES - lives));
}

// ---------- tracking ----------

// The whole video frame is shown ("contain"), so feet are never cropped off.
function videoRect() {
  const vw = video.videoWidth || 640;
  const vh = video.videoHeight || 480;
  const scale = Math.min(innerWidth / vw, innerHeight / vh);
  const w = vw * scale, h = vh * scale;
  return { x: (innerWidth - w) / 2, y: (innerHeight - h) / 2, w, h };
}

function track(now) {
  if (video.readyState < 2 || video.currentTime === lastVideoTime) return;
  lastVideoTime = video.currentTime;
  const result = landmarker.detectForVideo(video, now);
  const lms = result.landmarks?.[0];
  if (!lms) { pose = null; body = null; return; }

  const r = videoRect();
  // Mirror horizontally so it behaves like a mirror.
  pose = lms.map((p) => ({
    x: r.x + (1 - p.x) * r.w,
    y: r.y + p.y * r.h,
    v: p.visibility ?? 1,
    inFrame: p.x > 0.01 && p.x < 0.99 && p.y > 0.01 && p.y < 0.99,
  }));

  const visible = KEY_POINTS.every((i) => pose[i].v > 0.5 && pose[i].inFrame);
  const sh = Math.hypot(pose[L_SHOULDER].x - pose[R_SHOULDER].x, pose[L_SHOULDER].y - pose[R_SHOULDER].y);
  body = {
    visible,
    shoulderW: Math.max(sh, r.h * 0.06),
    cx: (pose[L_HIP].x + pose[R_HIP].x) / 2,
    headY: pose[NOSE].y,
    shoulderY: (pose[L_SHOULDER].y + pose[R_SHOULDER].y) / 2,
    hipY: (pose[L_HIP].y + pose[R_HIP].y) / 2,
    ankleY: (pose[L_ANKLE].y + pose[R_ANKLE].y) / 2,
    rect: r,
  };
}

const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ---------- gameplay ----------

function spawnTarget() {
  const { shoulderW: s, cx, headY, hipY, ankleY, rect } = body;
  const foot = Math.random() < 0.3;
  const r = Math.max(26, s * 0.32);
  const reach = s * (foot ? 1.4 : 2.0);
  const x = clamp(cx + rand(-1, 1) * reach, rect.x + r, rect.x + rect.w - r);
  const y = foot
    ? clamp(ankleY - rand(0, s * 0.7), rect.y + r, rect.y + rect.h - r)
    : clamp(rand(headY - s * 0.9, hipY), rect.y + r, rect.y + rect.h - r);
  targets.push({ kind: foot ? 'foot' : 'hand', x, y, r, born: gt });
}

function startLaser() {
  // The beam locks at shoulder height: get your head below it before it fires.
  laser = { y: body.shoulderY + body.shoulderW * 0.1, start: gt, fired: false };
  targets = []; // clear the stage so the player can focus on ducking
}

function update(dt) {
  stateTime += dt;
  hurtFlash = Math.max(0, hurtFlash - dt);
  effects = effects.filter((e) => (e.t += dt) < e.life);

  if (state === 'frame') {
    if (body?.visible) { if (stateTime > 1.0) setState('countdown'); } else stateTime = 0;
    return;
  }
  if (state === 'countdown') {
    if (!body?.visible) { setState('frame'); return; }
    if (stateTime >= 3) setState('play');
    return;
  }
  if (state !== 'play') return;

  // Pause the game clock while the player is out of view.
  if (!body?.visible) { lostFor += dt; return; }
  lostFor = 0;
  gt += dt;

  const difficulty = Math.min(1, gt / 90); // ramps up over 90 s

  // Lasers
  if (!laser && gt >= nextLaser) startLaser();
  if (laser) {
    const age = gt - laser.start;
    if (!laser.fired && age >= LASER_WARN) {
      laser.fired = true;
      if (body.headY < laser.y) {
        lives -= 1; combo = 0; hurtFlash = 0.5;
        effects.push({ kind: 'text', text: 'ZAPPED!', x: body.cx, y: laser.y - 40, color: COLORS.laser, t: 0, life: 1 });
        if (lives <= 0) { updateHud(); gameOver(); return; }
      } else {
        score += 25 * multiplier();
        effects.push({ kind: 'text', text: 'Dodged! +' + 25 * multiplier(), x: body.cx, y: laser.y + 50, color: COLORS.ok, t: 0, life: 1 });
      }
      updateHud();
    }
    if (age >= LASER_WARN + LASER_FIRE) {
      laser = null;
      nextLaser = gt + rand(7, 11) - difficulty * 3;
      nextSpawn = gt + 0.6;
    }
  }

  // Targets
  if (!laser && gt >= nextSpawn && targets.length < 4) {
    spawnTarget();
    nextSpawn = gt + rand(1.3, 1.9) - difficulty * 0.8;
  }
  const hit = (t) => {
    const pts = t.kind === 'hand' ? HAND_POINTS : FOOT_POINTS;
    return pts.some((i) => pose[i].v > 0.3 && Math.hypot(pose[i].x - t.x, pose[i].y - t.y) < t.r + body.shoulderW * 0.12);
  };
  targets = targets.filter((t) => {
    if (hit(t)) {
      combo += 1;
      const pts = (t.kind === 'foot' ? 15 : 10) * multiplier();
      score += pts;
      effects.push({ kind: 'burst', x: t.x, y: t.y, r: t.r, color: COLORS[t.kind], t: 0, life: 0.4 });
      effects.push({ kind: 'text', text: '+' + pts, x: t.x, y: t.y - t.r - 10, color: '#fff', t: 0, life: 0.7 });
      updateHud();
      return false;
    }
    if (gt - t.born > TARGET_LIFE) {
      combo = 0;
      effects.push({ kind: 'burst', x: t.x, y: t.y, r: t.r * 0.6, color: 'rgba(255,255,255,0.4)', t: 0, life: 0.3 });
      updateHud();
      return false;
    }
    return true;
  });
}

// ---------- drawing ----------

const BONES = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24],
  [23, 25], [25, 27], [24, 26], [26, 28], [27, 31], [28, 32], [27, 29], [28, 30],
];

function draw() {
  const r = videoRect();
  ctx.fillStyle = '#0b1020';
  ctx.fillRect(0, 0, innerWidth, innerHeight);

  // Mirrored camera feed, dimmed so the game reads clearly on top.
  ctx.save();
  ctx.translate(innerWidth, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(video, innerWidth - r.x - r.w, r.y, r.w, r.h);
  ctx.restore();
  ctx.fillStyle = 'rgba(11, 16, 32, 0.45)';
  ctx.fillRect(r.x, r.y, r.w, r.h);

  if (pose) drawSkeleton();
  for (const t of targets) drawTarget(t);
  if (laser) drawLaser(r);
  for (const e of effects) drawEffect(e);

  if (hurtFlash > 0) {
    ctx.fillStyle = `rgba(255, 59, 92, ${hurtFlash * 0.6})`;
    ctx.fillRect(0, 0, innerWidth, innerHeight);
  }
  drawBanner();
}

function drawSkeleton() {
  const s = body?.shoulderW ?? 60;
  ctx.lineCap = 'round';
  ctx.lineWidth = Math.max(4, s * 0.06);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
  for (const [a, b] of BONES) {
    if (pose[a].v < 0.3 || pose[b].v < 0.3) continue;
    ctx.beginPath();
    ctx.moveTo(pose[a].x, pose[a].y);
    ctx.lineTo(pose[b].x, pose[b].y);
    ctx.stroke();
  }
  const dot = (i, color, rad) => {
    if (pose[i].v < 0.3) return;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(pose[i].x, pose[i].y, rad, 0, Math.PI * 2);
    ctx.fill();
  };
  for (const i of [15, 16]) dot(i, COLORS.hand, Math.max(10, s * 0.14));
  for (const i of [31, 32]) dot(i, COLORS.foot, Math.max(10, s * 0.14));
  dot(NOSE, '#fff', Math.max(8, s * 0.1));
}

function drawTarget(t) {
  const left = 1 - (gt - t.born) / TARGET_LIFE;
  const color = COLORS[t.kind];
  ctx.save();
  ctx.globalAlpha = 0.25;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(t.x, t.y, t.r, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.lineWidth = 6;
  ctx.strokeStyle = color;
  ctx.beginPath();
  ctx.arc(t.x, t.y, t.r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * left); // countdown ring
  ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.font = `700 ${Math.round(t.r * 0.7)}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(t.kind === 'hand' ? '✋' : '🦶', t.x, t.y + 2);
  ctx.restore();
}

function drawLaser(r) {
  const age = gt - laser.start;
  ctx.save();
  if (!laser.fired) {
    const blink = Math.sin(age * (8 + age * 10)) > 0;
    ctx.setLineDash([18, 12]);
    ctx.lineWidth = 4;
    ctx.strokeStyle = blink ? COLORS.laser : 'rgba(255, 59, 92, 0.35)';
    ctx.beginPath();
    ctx.moveTo(r.x, laser.y);
    ctx.lineTo(r.x + r.w, laser.y);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255, 59, 92, 0.12)';
    ctx.fillRect(r.x, r.y, r.w, laser.y - r.y);
  } else {
    const k = 1 - (age - LASER_WARN) / LASER_FIRE;
    ctx.shadowColor = COLORS.laser;
    ctx.shadowBlur = 30;
    ctx.fillStyle = `rgba(255, 59, 92, ${0.9 * k})`;
    ctx.fillRect(r.x, laser.y - 10, r.w, 20);
  }
  ctx.restore();
}

function drawEffect(e) {
  const k = e.t / e.life;
  ctx.save();
  if (e.kind === 'burst') {
    ctx.strokeStyle = e.color;
    ctx.globalAlpha = 1 - k;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(e.x, e.y, e.r * (1 + k * 0.8), 0, Math.PI * 2);
    ctx.stroke();
  } else {
    ctx.globalAlpha = 1 - k;
    ctx.fillStyle = e.color;
    ctx.font = '800 30px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(e.text, e.x, e.y - k * 40);
  }
  ctx.restore();
}

function banner(text, sub, color = '#fff') {
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0,0,0,0.7)';
  ctx.shadowBlur = 12;
  ctx.fillStyle = color;
  ctx.font = `800 ${Math.round(Math.min(innerWidth, innerHeight) * 0.09)}px system-ui, sans-serif`;
  ctx.fillText(text, innerWidth / 2, innerHeight * 0.42);
  if (sub) {
    ctx.fillStyle = '#fff';
    ctx.font = `500 ${Math.round(Math.min(innerWidth, innerHeight) * 0.035)}px system-ui, sans-serif`;
    ctx.fillText(sub, innerWidth / 2, innerHeight * 0.42 + Math.min(innerWidth, innerHeight) * 0.08);
  }
  ctx.restore();
}

function drawBanner() {
  if (state === 'frame') {
    banner('Step into view', 'Your whole body — head to feet — needs to be in the picture');
  } else if (state === 'countdown') {
    banner(String(3 - Math.floor(stateTime)), 'Get ready!');
  } else if (state === 'play') {
    if (lostFor > 0.3) banner('Paused', 'Step back into view to continue');
    else if (laser && !laser.fired) banner('DUCK!', null, COLORS.laser);
    else if (gt < 2) banner('GO!', null, COLORS.ok);
  } else if (state === 'over') {
    banner('Game over', `Score: ${score}`, COLORS.laser);
  }
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
