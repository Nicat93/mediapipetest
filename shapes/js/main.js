// Copy My Hands: a hand shape appears as a ghost, the child makes the same
// shape with their hand(s). The closer the match, the more stars.
import { POSES, makeLevel, poseHand, features, compare } from './poses.js';
import { HandTracker, coverFit, toScreen, toCamera, drawVideo } from '../../common/tracking.js';
import { createShell } from '../../common/shell.js';
import { store, createSound, createSpeech, confetti, HandButtons, loop } from '../../common/fx.js';

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

const HOLD_TIME = 1.0; // seconds to hold a matching shape
const BUTTON_TIME = 1.5; // seconds to hover a palm over a header button
const ZOOM = 1.15; // crop the camera picture a little so hands reach the edges
const LEVEL_KEY = 'shapes.level';
const STARS_KEY = 'shapes.stars';
const SOUND_KEY = 'shapes.sound';

const ui = {
  start: $('start'),
  game: $('game'),
  stage: $('stage'),
  card: $('card'),
  title: $('title'),
  levelNo: $('level-no'),
  meter: $('meter'),
  meterFill: $('meter-fill'),
  meterText: $('meter-text'),
  meterPass: $('meter-pass'),
  tip: $('tip'),
  win: $('win'),
  winStars: $('win-stars'),
  winText: $('win-text'),
  play: $('play'),
  restart: $('restart'),
};
const g = ui.stage.getContext('2d');
const layer = document.createElement('canvas');
const lg = layer.getContext('2d');

// ------------------------------------------------------------------ storage
let savedLevel = store.get(LEVEL_KEY, 1);
const stars = store.get(STARS_KEY, {});

function showStartButtons() {
  ui.play.querySelector('small').textContent = `Level ${savedLevel}`;
  ui.restart.classList.toggle('hidden', savedLevel <= 1);
}
showStartButtons();

// -------------------------------------------------------------------- sound
const sound = createSound({ key: SOUND_KEY });
const sfx = sound.sfx;
const speech = createSpeech(sound, { lang: 'en', rate: 0.95, pitch: 1.15 });
const speak = (text) => speech.say(text);
sound.bindButton($('btn-sound'));

// ------------------------------------------------------------------- layout
let W = 0;
let H = 0;
let dpr = 1;
function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  W = window.innerWidth;
  H = window.innerHeight;
  for (const c of [ui.stage, layer]) {
    c.width = Math.round(W * dpr);
    c.height = Math.round(H * dpr);
  }
  ui.stage.style.width = `${W}px`;
  ui.stage.style.height = `${H}px`;
  if (level) placeTargets();
  drawCard();
}
window.addEventListener('resize', resize);

/** Where the (mirrored, cropped) camera picture sits on the screen. */
function view() {
  return coverFit($('cam-video'), W, H, ZOOM);
}

// -------------------------------------------------------------------- level
let level = null;
let targets = []; // [{ spec, pts, feat }]
let phase = 'off'; // 'play' | 'won' | 'off'
let score = 0;
let hold = 0;
let holdSum = 0;
let holdN = 0;
let levelT = 0;
let noHandT = 0;
let hintT = 0;
let nextTimer = 0;

const handSize = () => Math.min(W, H) * (level?.hands.length > 1 ? 0.15 : 0.18);

function placeTargets() {
  const size = handSize();
  targets = level.hands.map((spec) => {
    const pts = poseHand(POSES[spec.pose], { x: spec.x * W, y: spec.y * H, size, rot: spec.rot, left: spec.left });
    return { spec, pts, feat: features(pts) };
  });
}

function sayLevel() {
  const names = level.hands.map((h) => POSES[h.pose]);
  if (names.length === 1) speak(names[0].say);
  else if (level.hands[0].pose === level.hands[1].pose) speak(`Both hands! ${names[0].say}`);
  else speak(`Two hands! This hand: ${names[0].name}. That hand: ${names[1].name}.`);
}

function startLevel(n) {
  clearTimeout(nextTimer);
  level = makeLevel(n);
  savedLevel = n;
  store.set(LEVEL_KEY, n);
  placeTargets();
  phase = 'play';
  score = 0;
  hold = 0;
  holdSum = 0;
  holdN = 0;
  levelT = 0;
  hintT = 0;
  ui.levelNo.textContent = n;
  ui.title.innerHTML = '';
  level.hands.forEach((h, i) => {
    if (i) ui.title.append(document.createTextNode(' + '));
    const s = document.createElement('span');
    s.innerHTML = `<span class="em"></span> `;
    s.firstChild.textContent = POSES[h.pose].emoji;
    s.append(POSES[h.pose].name);
    ui.title.append(s);
  });
  ui.meterPass.style.left = `${level.pass * 100}%`;
  ui.win.classList.add('hidden');
  ui.tip.textContent = level.hands.length > 1 ? 'Use both hands!' : '';
  drawCard();
  sayLevel();
}

function win() {
  phase = 'won';
  const avg = holdN ? holdSum / holdN : score;
  const got = avg >= 0.9 ? 3 : avg >= 0.82 ? 2 : 1;
  stars[level.n] = Math.max(stars[level.n] || 0, got);
  store.set(STARS_KEY, stars);
  savedLevel = level.n + 1;
  store.set(LEVEL_KEY, savedLevel);
  ui.winStars.innerHTML = '';
  for (let i = 0; i < 3; i++) {
    const s = document.createElement('span');
    s.textContent = '⭐';
    s.className = i < got ? 'on' : '';
    s.style.animationDelay = `${0.15 + i * 0.2}s`;
    ui.winStars.append(s);
    if (i < got) setTimeout(() => sfx.star(i), 150 + i * 200);
  }
  const praise = got === 3 ? ['Perfect!', 'Amazing!', 'Wow, exactly!'] : got === 2 ? ['Great job!', 'Very good!', 'Well done!'] : ['Good!', 'You did it!', 'Nice!'];
  const word = praise[Math.floor(Math.random() * praise.length)];
  ui.winText.textContent = `${word} ${Math.round(avg * 100)}%`;
  ui.win.classList.remove('hidden');
  sfx.win();
  speak(word);
  confetti(70, ['#7b5cff', '#ff8a3d', '#37c871', '#ffc23d', '#ff5d8f', '#3ab7ff']);
  nextTimer = setTimeout(() => startLevel(level.n + 1), 2800);
}

// ------------------------------------------------------------------ drawing
const CHAINS = [[0, 1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16], [17, 18, 19, 20]];
const PALM = [0, 1, 5, 9, 13, 17];

function path(c, pts, idx, close = false) {
  c.beginPath();
  idx.forEach((i, k) => (k ? c.lineTo(pts[i].x, pts[i].y) : c.moveTo(pts[i].x, pts[i].y)));
  if (close) c.closePath();
}

/** A friendly cartoon hand: thick rounded fingers on a filled palm. */
function drawHand(c, pts, size, { fill, line, fingerFill = [], nails = true }) {
  const w = size * 0.25;
  c.lineJoin = 'round';
  c.lineCap = 'round';
  // outline
  c.strokeStyle = line;
  c.lineWidth = w + size * 0.09;
  path(c, pts, PALM, true);
  c.stroke();
  c.fillStyle = line;
  c.fill();
  for (const ch of CHAINS) {
    path(c, pts, ch);
    c.stroke();
  }
  // body
  c.lineWidth = w;
  c.strokeStyle = fill;
  c.fillStyle = fill;
  path(c, pts, PALM, true);
  c.stroke();
  c.fill();
  CHAINS.forEach((ch, i) => {
    c.strokeStyle = fingerFill[i] || fill;
    path(c, pts, ch);
    c.stroke();
  });
  if (nails) {
    c.fillStyle = 'rgba(255,255,255,0.75)';
    for (const ch of CHAINS) {
      const p = pts[ch[ch.length - 1]];
      c.beginPath();
      c.arc(p.x, p.y, w * 0.22, 0, Math.PI * 2);
      c.fill();
    }
  }
}

function drawGhosts(t) {
  lg.setTransform(dpr, 0, 0, dpr, 0, 0);
  lg.clearRect(0, 0, W, H);
  const size = handSize();
  const pulse = 0.5 + 0.5 * Math.sin(t / 300);
  for (const tg of targets) {
    drawHand(lg, tg.pts, size, { fill: '#ffffff', line: '#7b5cff', nails: false });
  }
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalAlpha = phase === 'won' ? 0.3 : 0.55 + pulse * 0.15;
  g.drawImage(layer, 0, 0);
  g.restore();
}

/** Small picture of the target in the header. */
function drawCard() {
  if (!level) return;
  const c = ui.card.getContext('2d');
  const cw = ui.card.clientWidth || 120;
  const ch = ui.card.clientHeight || 90;
  const r = Math.min(window.devicePixelRatio || 1, 2);
  ui.card.width = Math.round(cw * r);
  ui.card.height = Math.round(ch * r);
  c.setTransform(r, 0, 0, r, 0, 0);
  c.clearRect(0, 0, cw, ch);
  const two = level.hands.length > 1;
  const size = Math.min(ch * 0.36, two ? cw * 0.2 : cw * 0.4);
  level.hands.forEach((spec) => {
    const x = two ? cw * (spec.x < 0.5 ? 0.28 : 0.72) : cw / 2;
    const y = ch * (0.55 + (two ? (spec.y - 0.55) * 0.5 : 0));
    const pts = poseHand(POSES[spec.pose], { x, y, size, rot: spec.rot, left: spec.left });
    drawHand(c, pts, size, { fill: '#ffd8b0', line: '#7b5cff' });
  });
}

function drawBackground(t) {
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const v = $('cam-video');
  g.fillStyle = '#e8ecff';
  g.fillRect(0, 0, W, H);
  if (drawVideo(g, v, t, 0.6)) {
    g.fillStyle = 'rgba(235, 240, 255, 0.35)';
    g.fillRect(0, 0, W, H);
  }
}

// ------------------------------------------------------------------ matching
const GOOD = '#37c871';
const NEAR = '#ffc23d';
const OFF = '#ff7a45';

/** Pairs tracked hands with targets and scores them. */
function scoreHands(hands) {
  const unit = Math.min(W, H);
  const opts = { useRot: !!level.useRot, usePos: !!level.usePos, unit };
  const feats = hands.map((h) => features(h.pts));
  if (targets.length === 1) {
    let best = null;
    feats.forEach((f, i) => {
      const r = compare(targets[0].feat, f, { ...opts, anySide: true });
      if (!best || r.score > best.score) best = { ...r, hand: i };
    });
    return { score: best?.score || 0, results: best ? [best] : [], need: hands.length ? '' : 'hand' };
  }
  if (hands.length < 2) {
    const results = feats.map((f, i) => {
      const r = [0, 1].map((k) => compare(targets[k].feat, f, opts)).sort((a, b) => b.score - a.score)[0];
      return { ...r, hand: i };
    });
    return { score: (results[0]?.score || 0) * 0.5, results, need: 'two' };
  }
  // left-most hand on screen goes with the left-most target
  const order = feats.map((f, i) => i).sort((a, b) => feats[a].x - feats[b].x).slice(0, 2);
  const tOrder = [0, 1].sort((a, b) => targets[a].spec.x - targets[b].spec.x);
  const results = order.map((hi, k) => ({ ...compare(targets[tOrder[k]].feat, feats[hi], opts), hand: hi }));
  return { score: (results[0].score + results[1].score) / 2, results, need: '' };
}

// ------------------------------------------------------------- hand buttons
const buttons = new HandButtons({ root: ui.game, time: BUTTON_TIME, fistPress: false }); // a fist is a shape here

// --------------------------------------------------------------------- loop
loop((dt, now) => {
  if (phase !== 'off' && shell.mode === 'camera') tick(dt, now);
});

function tick(dt, now) {
  const t = view();
  drawBackground(t);
  drawGhosts(now);
  const hands = shell.track(now).map((h) => {
    const pts = h.lm.map((p) => toScreen(p, t));
    return { id: h.id, pts, size: Math.hypot(pts[0].x - pts[9].x, pts[0].y - pts[9].y) };
  });
  buttons.update(hands.map((h) => ({ id: h.id, ...features(h.pts) })), dt);

  const res = scoreHands(hands);
  const k = 1 - Math.exp(-dt / 0.2);
  score += (res.score - score) * k;

  // the player's hands, fingers coloured by how well they match
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  hands.forEach((h, i) => {
    const r = res.results.find((x) => x.hand === i);
    const fingerFill = r ? r.fingers.map((m) => (m > 0.75 ? GOOD : m > 0.4 ? NEAR : OFF)) : [];
    g.globalAlpha = 0.92;
    drawHand(g, h.pts, Math.max(h.size, 20), { fill: '#ffd8b0', line: '#2f2a4a', fingerFill });
  });
  g.globalAlpha = 1;

  if (phase !== 'play') return;
  levelT += dt;
  noHandT = hands.length ? 0 : noHandT + dt;
  hintT += dt;

  // meter
  const pct = Math.round(clamp(score, 0, 1) * 100);
  ui.meterFill.style.width = `${pct}%`;
  ui.meterText.textContent = `${pct}%`;
  const passing = score >= level.pass;
  ui.meter.classList.toggle('pass', passing);
  ui.meter.style.setProperty('--hold', (hold / HOLD_TIME).toFixed(3));

  if (!hands.length) ui.tip.textContent = noHandT > 1 ? 'Show me your hand! ✋' : ui.tip.textContent;
  else if (res.need === 'two') ui.tip.textContent = 'Use both hands! 🙌';
  else if (passing) ui.tip.textContent = 'Hold it… ⭐';
  else if (res.results.some((r) => !r.posOk)) ui.tip.textContent = 'Put your hands where the shapes are';
  else if (level.useRot && res.results.some((r) => !r.rotOk)) ui.tip.textContent = 'Tilt your hand like the picture';
  else ui.tip.textContent = level.hands.length > 1 ? 'Copy both shapes!' : 'Copy the shape!';

  if (noHandT > 8) {
    noHandT = -10;
    speak('Show me your hand!');
  }
  if (hintT > 14 && !passing) {
    hintT = 0;
    sayLevel();
  }

  if (passing) {
    hold += dt;
    holdSum += res.score;
    holdN++;
    if (hold >= HOLD_TIME) win();
  } else {
    hold = Math.max(0, hold - dt * 2);
    if (hold === 0) {
      holdSum = 0;
      holdN = 0;
    }
  }
}

// --------------------------------------------------------------- game flow
$('btn-home').addEventListener('click', () => {
  sfx.press();
  shell.home();
});
$('btn-skip').addEventListener('click', () => {
  sfx.press();
  if (level) startLevel(level.n + 1);
});
$('btn-again').addEventListener('click', () => {
  sfx.press();
  if (level) sayLevel();
});

const shell = createShell({
  lang: 'en',
  unlock: () => sound.unlock(),
  tracker: (video) => new HandTracker(video, { numHands: 2 }),
  onPlay: ({ arg }) => {
    resize();
    startLevel(arg);
  },
  onHome: () => {
    clearTimeout(nextTimer);
    phase = 'off';
    buttons.reset();
    showStartButtons();
  },
});
ui.play.addEventListener('click', () => shell.play(savedLevel));
ui.restart.addEventListener('click', () => shell.play(1));
resize();

// For automated tests: the current targets as camera landmarks.
if (new URLSearchParams(location.search).has('test')) {
  window.__shapes = {
    level: () => level,
    // a pose drawn at (x, y) in screen px, as camera landmarks
    poseCam: (pose, o) => {
      const t = view();
      return poseHand(pose, { size: handSize(), ...o }).map((p) => ({ ...toCamera(p, t), z: 0 }));
    },
    targetsCam: () => {
      const t = view();
      return targets.map((tg) => tg.pts.map((p) => ({ ...toCamera(p, t), z: 0 })));
    },
  };
}
