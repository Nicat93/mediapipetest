// Hand shapes: a small 2D hand model that draws any pose from finger curls,
// features that compare a pose to a tracked hand, and the level generator.
//
// All points use MediaPipe's 21-landmark layout so the same feature code runs
// on the generated target hands and on the tracked hands.

export const FINGERS = [
  [1, 2, 3, 4], // thumb
  [5, 6, 7, 8], // index
  [9, 10, 11, 12], // middle
  [13, 14, 15, 16], // ring
  [17, 18, 19, 20], // pinky
];

// ---------------------------------------------------------------- the model
// A right hand, palm toward the camera, as seen on the mirrored screen (thumb
// on the left). Units: palm length (wrist to middle knuckle) = 1, y points down.
const MCP = [null, [-0.27, -0.95], [0, -1], [0.24, -0.94], [0.44, -0.8]];
const SEG = [null, [0.38, 0.23, 0.18], [0.42, 0.26, 0.19], [0.4, 0.25, 0.18], [0.31, 0.19, 0.16]];
const LEAN = [null, -9, 0, 8, 17]; // finger direction, degrees from straight up
const BEND = [80, 100, 60]; // joint bends (degrees) of a fully curled finger
const THUMB_CMC = [-0.24, -0.2];
const THUMB_SEG = [0.36, 0.3, 0.26];
const THUMB_TUCK = [[-0.24, -0.2], [-0.38, -0.45], [-0.22, -0.64], [0.02, -0.68]];
const THUMB_DIR = { out: -48, side: -88, up: -20 };

const rad = (d) => (d * Math.PI) / 180;
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));

/**
 * Points of a pose in model units (wrist at the origin).
 * pose: { curl: [thumb, index, middle, ring, pinky] 0 = straight .. 1 = curled,
 *         thumb: 'out' | 'side' | 'up', spread: 0..1.6 }
 */
function modelPoints(pose) {
  const pts = new Array(21);
  pts[0] = [0, 0];
  // thumb: straight in its direction, blended into the tucked shape as it curls
  const t = pose.curl[0];
  const dir = THUMB_DIR[pose.thumb || 'out'];
  let [x, y] = THUMB_CMC;
  const straight = [[x, y]];
  THUMB_SEG.forEach((len, k) => {
    const a = rad(dir + k * 6);
    x += Math.sin(a) * len;
    y -= Math.cos(a) * len;
    straight.push([x, y]);
  });
  for (let k = 0; k < 4; k++) {
    pts[1 + k] = [lerp(straight[k][0], THUMB_TUCK[k][0], t), lerp(straight[k][1], THUMB_TUCK[k][1], t)];
  }
  // fingers: curling folds them toward the camera, so on screen they get shorter
  // and then fold back down over the palm
  const spread = pose.spread ?? 1;
  for (let f = 1; f <= 4; f++) {
    const c = pose.curl[f];
    const a = rad(LEAN[f] * spread);
    const dx = Math.sin(a);
    const dy = -Math.cos(a);
    let [px, py] = MCP[f];
    const base = FINGERS[f][0];
    pts[base] = [px, py];
    let bend = 0;
    SEG[f].forEach((len, k) => {
      bend += BEND[k] * c;
      const along = len * Math.cos(rad(bend));
      px += dx * along;
      py += dy * along;
      pts[base + 1 + k] = [px, py];
    });
  }
  return pts;
}

/**
 * Screen points of a pose: { x, y } centre of the palm in px, palm length
 * `size` in px, `rot` degrees clockwise, `left` = the player's left hand
 * (mirror image).
 */
export function poseHand(pose, { x, y, size, rot = 0, left = false }) {
  const c = Math.cos(rad(rot));
  const s = Math.sin(rad(rot));
  return modelPoints(pose).map(([px, py]) => {
    px = left ? -px : px;
    py += 0.5; // palm centre at the origin
    return { x: x + (px * c - py * s) * size, y: y + (px * s + py * c) * size };
  });
}

// ------------------------------------------------------------- the features
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/** Raw shape numbers of a hand (points in px, any position, size or side). */
function rawFeatures(p) {
  // thumb: how far its tip is from the middle of the palm (tucked thumbs lie over the palm)
  const cx = (p[0].x + p[5].x + p[9].x + p[13].x + p[17].x) / 5;
  const cy = (p[0].y + p[5].y + p[9].y + p[13].y + p[17].y) / 5;
  const r = [Math.hypot(p[4].x - cx, p[4].y - cy) / Math.max(dist(p[0], p[9]), 1e-6)];
  for (let f = 1; f <= 4; f++) {
    const [mcp, , , tip] = FINGERS[f];
    r.push(dist(p[tip], p[0]) / Math.max(dist(p[mcp], p[0]), 1e-6));
  }
  return r;
}

// 0 = curled .. 1 = straight, calibrated on the model's open hand and fist.
const OPEN = rawFeatures(poseHand({ curl: [0, 0, 0, 0, 0] }, { x: 0, y: 0, size: 100 }));
const SHUT = rawFeatures(poseHand({ curl: [1, 1, 1, 1, 1] }, { x: 0, y: 0, size: 100 }));

export function features(p) {
  const raw = rawFeatures(p);
  const cx = (p[0].x + p[5].x + p[9].x + p[13].x + p[17].x) / 5;
  const cy = (p[0].y + p[5].y + p[9].y + p[13].y + p[17].y) / 5;
  return {
    ext: raw.map((v, i) => clamp((v - SHUT[i]) / (OPEN[i] - SHUT[i]))),
    rot: (Math.atan2(p[9].x - p[0].x, -(p[9].y - p[0].y)) * 180) / Math.PI,
    x: cx,
    y: cy,
    size: dist(p[0], p[9]),
  };
}

const angleDiff = (a, b) => Math.abs(((a - b + 540) % 360) - 180);

/**
 * How close a tracked hand is to a target, 0..1, plus a 0..1 match per finger.
 * `unit` is the screen size used for the position check.
 */
export function compare(target, hand, { useRot, usePos, anySide, unit }) {
  const fingers = target.ext.map((e, i) => 1 - clamp((Math.abs(hand.ext[i] - e) - 0.12) / 0.45));
  // the average, pulled down hard by the worst finger: one wrong finger is not a match
  // (the thumb counts a bit less, it is the hardest one to track)
  const mean = (fingers[0] * 0.7 + fingers[1] + fingers[2] + fingers[3] + fingers[4]) / 4.7;
  const worst = Math.min(0.3 + fingers[0] * 0.7, ...fingers.slice(1));
  const fingerScore = Math.max(0, mean - 0.45 * (1 - worst));
  let rotDiff = angleDiff(hand.rot, target.rot);
  if (anySide) rotDiff = Math.min(rotDiff, angleDiff(hand.rot, -target.rot));
  const rotScore = 1 - clamp((rotDiff - (useRot ? 18 : 30)) / 50);
  const posScore = 1 - clamp((Math.hypot(hand.x - target.x, hand.y - target.y) / unit - 0.08) / 0.25);
  const rotW = useRot ? 1.5 : 0.6;
  let score = (fingerScore * 3 + rotScore * rotW) / (3 + rotW);
  if (usePos) score *= 0.45 + 0.55 * posScore; // a hand in the wrong place is not a match
  return { score, fingers, rotOk: rotScore > 0.6, posOk: !usePos || posScore > 0.6 };
}

// ------------------------------------------------------------------- shapes
export const POSES = {
  open: { name: 'High five', emoji: '✋', curl: [0, 0, 0, 0, 0], spread: 1.3, say: 'Give me a high five! Open your hand wide.' },
  fist: { name: 'Fist', emoji: '✊', curl: [1, 1, 1, 1, 1], say: 'Make a fist! Close your hand.' },
  point: { name: 'Pointing finger', emoji: '☝️', curl: [1, 0, 1, 1, 1], say: 'Point up with one finger.' },
  peace: { name: 'Peace', emoji: '✌️', curl: [1, 0, 0, 1, 1], spread: 1.6, say: 'Show two fingers, like a peace sign.' },
  thumb: { name: 'Thumbs up', emoji: '👍', curl: [0, 1, 1, 1, 1], thumb: 'up', say: 'Thumbs up!' },
  three: { name: 'Three fingers', emoji: '3️⃣', curl: [1, 0, 0, 0, 1], spread: 1.3, say: 'Show three fingers.' },
  four: { name: 'Four fingers', emoji: '4️⃣', curl: [1, 0, 0, 0, 0], spread: 1.2, say: 'Show four fingers. Hide your thumb!' },
  rock: { name: 'Bunny ears', emoji: '🐰', curl: [1, 0, 1, 1, 0], spread: 1.3, say: 'Make bunny ears: the first finger and the little finger up.' },
  call: { name: 'Phone', emoji: '🤙', curl: [0, 1, 1, 1, 0], spread: 1.4, say: 'Make a phone: thumb and little finger out.' },
  ell: { name: 'Letter L', emoji: 'L', curl: [0, 0, 1, 1, 1], thumb: 'side', say: 'Make the letter L with your thumb and finger.' },
  claw: { name: 'Tiger claw', emoji: '🐯', curl: [0.3, 0.55, 0.55, 0.55, 0.55], spread: 1.2, say: 'Make a tiger claw! Bend your fingers. Rrroar!' },
  pinky: { name: 'Little finger', emoji: '🐭', curl: [1, 1, 1, 1, 0], say: 'Show only your little finger.' },
};

const SIMPLE = ['open', 'fist', 'point', 'peace', 'thumb'];
const MORE = ['three', 'rock', 'call', 'ell', 'four', 'claw', 'pinky'];
const ALL = [...SIMPLE, ...MORE];
const TILTABLE = ['open', 'point', 'peace', 'three', 'four', 'rock', 'call', 'claw'];

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (r, list) => list[Math.floor(r() * list.length)];
const tilt = (r) => (r() < 0.5 ? -1 : 1) * Math.round(30 + r() * 30);

/**
 * Level n (1-based). Hands: [{ pose, x, y (0..1 of the screen), rot, left }].
 * `pass` is the score that counts as a match.
 */
export function makeLevel(n) {
  const r = rng(n * 7919 + 13);
  const one = (pose, rot = 0) => [{ pose, x: 0.5, y: 0.55, rot, left: false }];
  const two = (a, b, o = {}) => [
    { pose: a, x: 0.3, y: o.ya ?? 0.55, rot: o.ra ?? 0, left: true },
    { pose: b, x: 0.7, y: o.yb ?? 0.55, rot: o.rb ?? 0, left: false },
  ];
  // 1–5: one hand, the easy shapes
  if (n <= 5) return { n, stage: 1, hands: one(SIMPLE[n - 1]), pass: 0.72 };
  // 6–12: one hand, more fingers to think about
  if (n <= 12) return { n, stage: 2, hands: one(MORE[n - 6]), pass: 0.74 };
  // 13–17: one hand, tilted
  if (n <= 17) return { n, stage: 3, hands: one(pick(r, TILTABLE), tilt(r)), pass: 0.74, useRot: true };
  // 18–22: two hands, the same shape
  if (n <= 22) {
    const p = SIMPLE[(n - 18) % SIMPLE.length];
    return { n, stage: 4, hands: two(p, p), pass: 0.74 };
  }
  // 23–28: two hands, different shapes
  if (n <= 28) {
    const a = pick(r, n < 26 ? SIMPLE : ALL);
    let b = pick(r, n < 26 ? SIMPLE : ALL);
    while (b === a) b = pick(r, ALL);
    return { n, stage: 5, hands: two(a, b), pass: 0.75 };
  }
  // 29+: two hands, different shapes, tilted, at different heights
  const a = pick(r, ALL);
  let b = pick(r, ALL);
  while (b === a) b = pick(r, ALL);
  const high = r() < 0.5;
  const tiltA = TILTABLE.includes(a) && r() < 0.6 ? tilt(r) : 0;
  const tiltB = TILTABLE.includes(b) && r() < 0.6 ? tilt(r) : 0;
  return {
    n,
    stage: 6,
    hands: two(a, b, { ya: high ? 0.38 : 0.66, yb: high ? 0.66 : 0.38, ra: -tiltA, rb: tiltB }),
    pass: 0.76,
    useRot: true,
    usePos: true,
  };
}
