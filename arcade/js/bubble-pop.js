import { FilesetResolver, HandLandmarker } from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.3/vision_bundle.mjs';
import { createCamera } from './camera.js';

const WASM_PATH = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.3/wasm';
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
const ROUND_SECONDS = 60;
const PALM = [0, 5, 9, 13, 17]; // wrist + finger bases: their average is the hand's center

const video = document.getElementById('cam');
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const overlay = document.getElementById('overlay');
const msg = document.getElementById('msg');
const startBtn = document.getElementById('start');
const hud = document.getElementById('hud');
const scoreEl = document.getElementById('score');
const timeEl = document.getElementById('time');

let landmarker = null;
let running = false;
let score = 0;
let endTime = 0;
let lastSpawn = 0;
let lastVideoTime = -1;
let bubbles = [];
let pops = [];
let hands = []; // { x, y, r, points } per tracked hand, in screen pixels

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
    numHands: 2,
  });
  try {
    return await HandLandmarker.createFromOptions(fileset, opts('GPU'));
  } catch (err) {
    console.warn('GPU delegate failed, falling back to CPU', err);
    return await HandLandmarker.createFromOptions(fileset, opts('CPU'));
  }
}

// ---------- camera ----------
// Phone (Wi-Fi) via /phone.html, or any camera the PC sees (see camera.js).

let wantStart = false; // Start was pressed but we're still waiting for the phone

const camera = createCamera({
  video,
  select: document.getElementById('camera'),
  linkEl: document.getElementById('link'),
  onAttach: () => (lastVideoTime = -1),
  onPhoneReady: () => wantStart && !running && tryStart(),
  onError: (text) => (msg.textContent = text),
  isActive: () => running,
});

async function tryStart() {
  if (!landmarker) {
    msg.textContent = 'Loading hand tracking…';
    landmarker = await createLandmarker();
  }
  msg.textContent = camera.usingPhone() ? 'Connecting to your phone…' : 'Starting camera…';
  if (!(await camera.start())) {
    wantStart = true;
    msg.textContent = 'Waiting for your phone. Scan the QR code below with it (or open the address and type the code), then allow the camera.';
    return;
  }
  wantStart = false;
  startRound();
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

// ---------- game ----------

function startRound() {
  score = 0;
  bubbles = [];
  pops = [];
  endTime = performance.now() + ROUND_SECONDS * 1000;
  scoreEl.textContent = '0';
  overlay.hidden = true;
  hud.hidden = false;
  if (!running) {
    running = true;
    requestAnimationFrame(loop);
  }
}

function endRound() {
  running = false;
  hud.hidden = true;
  overlay.querySelector('h1').textContent = `Score: ${score}`;
  msg.textContent = 'Nice! Ready for another round?';
  startBtn.textContent = 'Play again';
  overlay.hidden = false;
  drawFrame(performance.now()); // keep last frame visible behind overlay
}

function spawnBubble() {
  const r = 26 + Math.random() * 30;
  bubbles.push({
    x: r + Math.random() * (innerWidth - 2 * r),
    y: innerHeight + r,
    r,
    vy: 70 + Math.random() * 90 + (ROUND_SECONDS * 1000 - (endTime - performance.now())) / 600,
    wobble: Math.random() * Math.PI * 2,
    hue: Math.floor(Math.random() * 360),
  });
}

// Maps a normalized landmark to screen pixels, matching how the video is drawn
// ("cover" fit, mirrored like a selfie).
function toScreen(lm, fit) {
  const x = fit.dx + lm.x * fit.dw;
  const y = fit.dy + lm.y * fit.dh;
  return { x: innerWidth - x, y };
}

function coverFit() {
  const vw = video.videoWidth || 640;
  const vh = video.videoHeight || 480;
  const scale = Math.max(innerWidth / vw, innerHeight / vh);
  const dw = vw * scale;
  const dh = vh * scale;
  return { dx: (innerWidth - dw) / 2, dy: (innerHeight - dh) / 2, dw, dh };
}

let prev = performance.now();
function loop(now) {
  if (!running) return;
  const dt = Math.min((now - prev) / 1000, 0.05);
  prev = now;

  // Hand tracking (only when a new video frame is available)
  if (video.readyState >= 2 && video.currentTime !== lastVideoTime) {
    lastVideoTime = video.currentTime;
    const result = landmarker.detectForVideo(video, now);
    const fit = coverFit();
    hands = (result.landmarks || []).map((hand) => handArea(hand.map((p) => toScreen(p, fit))));
  }

  // Spawn and move bubbles
  const remaining = Math.max(0, endTime - now);
  const spawnEvery = 900 - (1 - remaining / (ROUND_SECONDS * 1000)) * 550;
  if (now - lastSpawn > spawnEvery) {
    spawnBubble();
    lastSpawn = now;
  }
  for (const b of bubbles) {
    b.y -= b.vy * dt;
    b.wobble += dt * 2;
  }

  // Collisions with the whole hand
  bubbles = bubbles.filter((b) => {
    const bx = b.x + Math.sin(b.wobble) * 10;
    const hit = hands.some((h) => Math.hypot(h.x - bx, h.y - b.y) < b.r + h.r);
    if (hit) {
      score += b.r < 38 ? 3 : 1; // small bubbles are worth more
      pops.push({ x: bx, y: b.y, r: b.r, hue: b.hue, t: 0 });
      if (navigator.vibrate) navigator.vibrate(15);
      return false;
    }
    return b.y > -b.r;
  });
  pops = pops.filter((p) => (p.t += dt) < 0.35);

  scoreEl.textContent = String(score);
  timeEl.textContent = String(Math.ceil(remaining / 1000));

  drawFrame(now);

  if (remaining <= 0) endRound();
  else requestAnimationFrame(loop);
}

// ---------- drawing ----------

function drawFrame() {
  const fit = coverFit();

  // Mirrored camera feed
  ctx.save();
  ctx.translate(innerWidth, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(video, fit.dx, fit.dy, fit.dw, fit.dh);
  ctx.restore();
  ctx.fillStyle = 'rgba(11, 16, 32, 0.25)';
  ctx.fillRect(0, 0, innerWidth, innerHeight);

  for (const b of bubbles) {
    const x = b.x + Math.sin(b.wobble) * 10;
    const g = ctx.createRadialGradient(x - b.r * 0.35, b.y - b.r * 0.35, b.r * 0.1, x, b.y, b.r);
    g.addColorStop(0, `hsla(${b.hue}, 90%, 92%, 0.9)`);
    g.addColorStop(0.7, `hsla(${b.hue}, 85%, 62%, 0.35)`);
    g.addColorStop(1, `hsla(${b.hue}, 85%, 55%, 0.75)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, b.y, b.r, 0, Math.PI * 2);
    ctx.fill();
  }

  for (const p of pops) {
    const k = p.t / 0.35;
    ctx.strokeStyle = `hsla(${p.hue}, 90%, 70%, ${1 - k})`;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r * (1 + k), 0, Math.PI * 2);
    ctx.stroke();
  }

  for (const h of hands) {
    // The hit area: anything a bubble touches inside this circle pops.
    ctx.fillStyle = 'rgba(76, 201, 240, 0.22)';
    ctx.strokeStyle = 'rgba(76, 201, 240, 0.9)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(h.x, h.y, h.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    for (const p of h.points) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

// A circle covering the whole hand: centered on the palm and reaching the
// fingertips, so open hands, fists and swipes all pop bubbles.
function handArea(points) {
  const x = PALM.reduce((s, i) => s + points[i].x, 0) / PALM.length;
  const y = PALM.reduce((s, i) => s + points[i].y, 0) / PALM.length;
  const reach = Math.max(...points.map((p) => Math.hypot(p.x - x, p.y - y)));
  return { x, y, r: Math.max(30, reach * 0.85), points };
}
