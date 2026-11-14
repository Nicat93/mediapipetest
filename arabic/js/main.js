// Ərəbcə Rəqəmlər: Arabic numbers 1–10 for small Azerbaijani-speaking children.
// Map -> count the objects (learn) -> write the digit -> next number, plus a
// "How many?" quiz. Works with touch / mouse, or hands on a camera: hover or
// make a fist to press, make a fist to write (open hand = pen up).
import { NUMBERS, PRAISE } from './numbers.js';

const $ = (id) => document.getElementById(id);
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

const ui = {
  start: $('start'), game: $('game'), title: $('title'), startMsg: $('start-msg'),
  loading: $('loading'), loadingText: $('loading-text'), cam: $('cam'), camBadge: $('cam-badge'),
  fx: $('fx'), cursors: $('cursors'), sound: $('btn-sound'),
  views: { map: $('map'), learn: $('learn'), write: $('write'), quiz: $('quiz') },
  nums: $('nums'), objects: $('objects'), quizObjects: $('quiz-objects'), choices: $('choices'),
  btnWrite: $('btn-write'), btnNext: $('btn-next'),
  pad: $('pad'), padCanvas: $('pad-canvas'), padHint: $('pad-hint'),
};

const BUTTON_TIME = 1.0; // seconds a hand hovers over a button to press it (a fist presses at once)
const COUNT_GAP = 0.45; // seconds between two counted objects, so each number is heard
const PEN_DELAY = 0.1; // fist must be held this long before ink starts (closing the hand moves it a bit)
const PEN_TRIM_MS = 150; // ink from the last moments before the hand opened is dropped (opening moves it too)

// ------------------------------------------------------------------ storage
const STARS_KEY = 'arabic.stars';
let stars = {};
try { stars = JSON.parse(localStorage.getItem(STARS_KEY)) || {}; } catch {}
function addStar(n, kind) {
  stars[n] = { ...stars[n], [kind]: true };
  try { localStorage.setItem(STARS_KEY, JSON.stringify(stars)); } catch {}
}

const VOICE_KEY = 'arabic.azVoice';
const optVoice = $('opt-voice');
try { optVoice.checked = localStorage.getItem(VOICE_KEY) !== '0'; } catch { optVoice.checked = true; }
optVoice.addEventListener('change', () => {
  try { localStorage.setItem(VOICE_KEY, optVoice.checked ? '1' : '0'); } catch {}
});

// -------------------------------------------------------------------- sound
let muted = false;
let actx = null;
function audio() {
  try {
    actx ||= new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === 'suspended') actx.resume();
  } catch {}
  return actx;
}
function tone(freq, dur, { type = 'sine', vol = 0.2, at = 0, slide = 0 } = {}) {
  const c = audio();
  if (!c || muted) return;
  const t = c.currentTime + at;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(freq + slide, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(c.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}
const sfx = {
  pop() { tone(660, 0.12, { type: 'triangle', vol: 0.2, slide: 300 }); },
  press() { tone(520, 0.08, { type: 'triangle', vol: 0.15 }); },
  win() { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.22, { type: 'triangle', vol: 0.18, at: i * 0.09 })); },
  nope() { tone(300, 0.25, { vol: 0.2, slide: -120 }); },
};

// Voices: Arabic for the numbers, Azerbaijani (or Turkish, which reads it
// well enough) for the short instructions.
const voices = { ar: null, az: null };
function loadVoices() {
  const all = window.speechSynthesis?.getVoices() || [];
  const best = (re) => {
    const vs = all.filter((v) => re.test(v.lang));
    return vs.find((v) => /natural|google|online/i.test(v.name)) || vs[0] || null;
  };
  voices.ar = best(/^ar\b|^ar-/i);
  voices.az = best(/^az\b|^az-/i) || best(/^tr\b|^tr-/i);
  $('voice-info').textContent =
    `Ərəb səsi: ${voices.ar ? voices.ar.name : 'yoxdur — sözlər oxunuşla (məs. “səlasə”) deyiləcək'}. ` +
    `Azərbaycan/türk səsi: ${voices.az ? voices.az.name : 'yoxdur'}.`;
}
loadVoices();
window.speechSynthesis?.addEventListener?.('voiceschanged', loadVoices);

/** Speaks a list of [text, 'ar' | 'az'] parts in order (cancels what was playing). */
function speak(parts) {
  const synth = window.speechSynthesis;
  if (muted || !synth) return;
  synth.cancel();
  for (const [text, lang, tr] of parts) {
    let v = null;
    let t = text;
    if (lang === 'ar') {
      v = voices.ar;
      if (!v) { t = tr || text; v = voices.az; } // no Arabic voice: say the transliteration
    } else {
      if (!optVoice.checked || !voices.az) continue;
      v = voices.az;
    }
    const u = new SpeechSynthesisUtterance(t);
    if (v) { u.voice = v; u.lang = v.lang; }
    u.rate = lang === 'ar' ? 0.8 : 0.95;
    u.pitch = 1.15;
    synth.speak(u);
  }
}
const arPart = (num) => [num.say, 'ar', num.tr];

ui.sound.addEventListener('click', () => {
  muted = !muted;
  ui.sound.textContent = muted ? '🔇' : '🔊';
  if (muted) window.speechSynthesis?.cancel();
});

// ---------------------------------------------------------------- effects
function burst(x, y, emojis, n) {
  for (let i = 0; i < n; i++) {
    const p = document.createElement('div');
    p.className = 'particle';
    p.textContent = pick(emojis);
    p.style.left = `${x}px`;
    p.style.top = `${y}px`;
    const a = Math.random() * Math.PI * 2;
    const dist = 70 + Math.random() * 110;
    p.style.setProperty('--dx', `${Math.cos(a) * dist}px`);
    p.style.setProperty('--dy', `${Math.sin(a) * dist}px`);
    ui.fx.appendChild(p);
    setTimeout(() => p.remove(), 1400);
  }
}
function confetti(n = 70) {
  const colors = ['#7b5cff', '#ffb703', '#2fb36d', '#ff5d8f', '#3fa9f5', '#ff8a3d'];
  for (let i = 0; i < n; i++) {
    const c = document.createElement('div');
    c.className = 'confetti';
    c.style.left = `${Math.random() * 100}vw`;
    c.style.background = pick(colors);
    c.style.setProperty('--dx', `${(Math.random() - 0.5) * 200}px`);
    c.style.setProperty('--rot', `${Math.random() * 720}deg`);
    c.style.setProperty('--t', `${1.8 + Math.random() * 1.4}s`);
    c.style.animationDelay = `${Math.random() * 0.4}s`;
    ui.fx.appendChild(c);
    setTimeout(() => c.remove(), 3800);
  }
}
const centerOf = (el) => {
  const r = el.getBoundingClientRect();
  return [(r.left + r.right) / 2, (r.top + r.bottom) / 2];
};

// ------------------------------------------------------------------ views
let mode = 'touch'; // 'touch' | 'hands'
let view = 'map';
let cur = 0; // index into NUMBERS
const timers = new Set();
const later = (fn, ms) => {
  const t = setTimeout(() => { timers.delete(t); fn(); }, ms);
  timers.add(t);
};
const clearTimers = () => { timers.forEach(clearTimeout); timers.clear(); };

function show(name, title) {
  clearTimers();
  endAllPens();
  view = name;
  for (const [k, el] of Object.entries(ui.views)) el.classList.toggle('hidden', k !== name);
  ui.title.textContent = title;
}

// ---- map
function showMap() {
  show('map', 'Rəqəm seç');
  ui.nums.replaceChildren(...NUMBERS.map((num, i) => {
    const b = document.createElement('button');
    b.className = 'nb hb';
    const s = stars[num.n] || {};
    b.innerHTML = `<span class="em">${num.emoji}</span><span class="stars">${s.count ? '⭐' : ''}${s.write ? '⭐' : ''}</span>` +
      `<span class="d" lang="ar">${num.digit}</span><span class="az">${num.az}</span>`;
    b.setAttribute('aria-label', `${num.az} — ${num.tr}`);
    b.addEventListener('click', () => { sfx.press(); showLearn(i); });
    return b;
  }));
  speak([['Rəqəm seç!', 'az']]);
}
$('btn-quiz').addEventListener('click', () => { sfx.press(); showQuiz(); });

// ---- learn (count the objects)
let counted = 0;
let countTotal = 0;
let countCool = 0;
let countDone = null;

function fillCard(root, num) {
  root.querySelectorAll('.digit').forEach((d) => { d.textContent = num.digit; d.classList.remove('glow'); });
  const ar = root.querySelector('.ar');
  if (ar) ar.textContent = num.ar;
  const tr = root.querySelector('.tr');
  if (tr) tr.textContent = `${num.tr} · ${num.az}`;
}

/** Fills `box` with n objects to count; `onDone` runs once all are counted. */
function makeObjects(box, n, emoji, onDone) {
  counted = 0;
  countTotal = n;
  countDone = onDone;
  const size = n <= 3 ? 130 : n <= 5 ? 110 : n <= 8 ? 92 : 80;
  box.style.setProperty('--os', `min(${size}px, ${n <= 5 ? 17 : 12}vh)`);
  box.replaceChildren(...Array.from({ length: n }, (_, i) => {
    const o = document.createElement('div');
    o.className = 'obj';
    o.textContent = emoji;
    o.style.animationDelay = `${i * 0.12}s`;
    o.addEventListener('pointerdown', () => countObj(o, true));
    return o;
  }));
}

function countObj(o, force = false) {
  if (o.classList.contains('counted') || counted >= countTotal) return;
  if (!force && countCool > 0) return;
  countCool = COUNT_GAP;
  counted++;
  o.classList.add('counted');
  const badge = document.createElement('span');
  badge.className = 'badge';
  badge.textContent = NUMBERS[counted - 1].digit;
  o.appendChild(badge);
  sfx.pop();
  speak([arPart(NUMBERS[counted - 1])]);
  const [x, y] = centerOf(o);
  burst(x, y, ['✨', '⭐'], 4);
  if (counted === countTotal) later(() => countDone?.(), 700);
}

function showLearn(i) {
  cur = i;
  const num = NUMBERS[i];
  show('learn', 'Say!');
  fillCard(ui.views.learn, num);
  ui.btnWrite.classList.add('hidden');
  makeObjects(ui.objects, num.n, num.emoji, () => {
    ui.views.learn.querySelector('.digit').classList.add('glow');
    sfx.win();
    addStar(num.n, 'count');
    const az = num.az[0].toUpperCase() + num.az.slice(1);
    speak([arPart(num), [`${az}! Ərəbcə: ${num.tr}.`, 'az'], arPart(num), ['İndi yazaq!', 'az']]);
    ui.btnWrite.classList.remove('hidden');
  });
  speak([['Gəl sayaq! Hər birinə toxun.', 'az']]);
}
$('btn-hear').addEventListener('click', () => speak([arPart(NUMBERS[cur])]));
$('btn-hear2').addEventListener('click', () => speak([arPart(NUMBERS[cur])]));
ui.btnWrite.addEventListener('click', () => { sfx.press(); showWrite(cur); });

// ---- write
const pad = {
  ctx: ui.padCanvas.getContext('2d'),
  size: 1,
  paths: [], // smoothed guide paths (0..1 box coords)
  samples: [], // guide points, evenly spaced, for the check
  covered: null,
  guideLen: 0,
  strokes: [], // ink: [{pts: [[x,y,t]], color}]
  inkLen: 0,
  inkNear: 0,
  inkCount: 0,
  done: false,
};
const GUIDE_STEP = 0.02;
const COVER_TOL = 0.08; // ink this close to a guide point covers it (box units)
const NEAR_TOL = 0.12; // ink this close to the guide counts as "on the line"
const INK_COLORS = ['#ff5d8f', '#7b5cff', '#2fb36d', '#ff8a3d', '#3fa9f5'];

function catmull(pts, sub = 8) {
  if (pts.length < 3) return pts.slice();
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    for (let k = 0; k < sub; k++) {
      const t = k / sub, t2 = t * t, t3 = t2 * t;
      const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}
function resample(path, step) {
  const out = [path[0]];
  let carry = 0;
  for (let i = 1; i < path.length; i++) {
    const [ax, ay] = path[i - 1], [bx, by] = path[i];
    const len = Math.hypot(bx - ax, by - ay);
    let d = step - carry;
    while (d <= len) {
      out.push([ax + ((bx - ax) * d) / len, ay + ((by - ay) * d) / len]);
      d += step;
    }
    carry = len - (d - step);
  }
  return out;
}

function showWrite(i) {
  cur = i;
  const num = NUMBERS[i];
  show('write', 'Yaz!');
  fillCard(ui.views.write, num);
  ui.btnNext.classList.add('hidden');
  ui.pad.classList.remove('done');
  pad.paths = num.strokes.map((s) => catmull(s));
  pad.samples = pad.paths.flatMap((p) => resample(p, GUIDE_STEP));
  pad.guideLen = pad.samples.length * GUIDE_STEP;
  clearInk();
  ui.padHint.textContent = mode === 'hands'
    ? '✊ Yumruğunu sıx — yaz.  ✋ Əlini aç — dayan.'
    : '👆 Barmağınla xətt üzrə yaz.';
  sizePad();
  speak([arPart(num), [mode === 'hands' ? 'Yumruğunu sıx və xətt üzrə yaz!' : 'Barmağınla xətt üzrə yaz!', 'az']]);
}

function clearInk() {
  endAllPens();
  pad.strokes = [];
  pad.covered = new Uint8Array(pad.samples.length);
  pad.inkLen = 0;
  pad.inkNear = 0;
  pad.inkCount = 0;
  pad.done = false;
  ui.pad.classList.remove('done');
  drawPad();
}
$('btn-clear').addEventListener('click', () => { sfx.press(); clearInk(); });

function sizePad() {
  const r = ui.padCanvas.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  ui.padCanvas.width = Math.round(r.width * dpr);
  ui.padCanvas.height = Math.round(r.height * dpr);
  pad.size = ui.padCanvas.width;
  drawPad();
}
window.addEventListener('resize', () => { if (view === 'write') sizePad(); });

function drawPad() {
  const { ctx, size: S } = pad;
  ctx.clearRect(0, 0, S, S);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const line = (path) => {
    ctx.beginPath();
    path.forEach(([x, y], i) => (i ? ctx.lineTo(x * S, y * S) : ctx.moveTo(x * S, y * S)));
    ctx.stroke();
  };
  // guide: wide soft road with a dashed middle line
  ctx.strokeStyle = '#eee9ff';
  ctx.lineWidth = S * 0.12;
  pad.paths.forEach(line);
  ctx.strokeStyle = '#c4b6f7';
  ctx.lineWidth = S * 0.012;
  ctx.setLineDash([S * 0.025, S * 0.025]);
  pad.paths.forEach(line);
  ctx.setLineDash([]);
  // covered parts of the guide light up
  ctx.fillStyle = '#ffd166';
  pad.samples.forEach(([x, y], i) => {
    if (!pad.covered?.[i]) return;
    ctx.beginPath();
    ctx.arc(x * S, y * S, S * 0.04, 0, Math.PI * 2);
    ctx.fill();
  });
  // start dots
  pad.paths.forEach((p, i) => {
    const [x, y] = p[0];
    ctx.fillStyle = '#2fb36d';
    ctx.beginPath();
    ctx.arc(x * S, y * S, S * 0.035, 0, Math.PI * 2);
    ctx.fill();
    if (pad.paths.length > 1) {
      ctx.fillStyle = '#fff';
      ctx.font = `800 ${Math.round(S * 0.04)}px "Baloo 2", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(i + 1), x * S, y * S + S * 0.003);
    }
  });
  // ink, smoothed with quadratic curves through the midpoints
  ctx.lineWidth = S * 0.05;
  for (const s of pad.strokes) {
    const p = s.pts;
    if (!p.length) continue;
    ctx.strokeStyle = s.color;
    ctx.fillStyle = s.color;
    if (p.length < 3) {
      ctx.beginPath();
      ctx.arc(p[0][0] * S, p[0][1] * S, S * 0.025, 0, Math.PI * 2);
      ctx.fill();
      continue;
    }
    ctx.beginPath();
    ctx.moveTo(p[0][0] * S, p[0][1] * S);
    for (let i = 1; i < p.length - 1; i++) {
      const mx = (p[i][0] + p[i + 1][0]) / 2, my = (p[i][1] + p[i + 1][1]) / 2;
      ctx.quadraticCurveTo(p[i][0] * S, p[i][1] * S, mx * S, my * S);
    }
    const l = p[p.length - 1];
    ctx.lineTo(l[0] * S, l[1] * S);
    ctx.stroke();
  }
}

/** Screen px -> pad box coords (0..1). */
function toPad(x, y) {
  const r = ui.padCanvas.getBoundingClientRect();
  return [(x - r.left) / r.width, (y - r.top) / r.height];
}
function overPad(x, y, margin = 0.08) {
  const [u, v] = toPad(x, y);
  return u > -margin && u < 1 + margin && v > -margin && v < 1 + margin;
}

function beginStroke() {
  const s = { pts: [], color: INK_COLORS[pad.strokes.length % INK_COLORS.length] };
  pad.strokes.push(s);
  return s;
}
function inkPoint(s, u, v, t) {
  const p = s.pts;
  const last = p[p.length - 1];
  if (last && Math.hypot(u - last[0], v - last[1]) < 0.006) return; // ignore tiny jitter
  p.push([u, v, t]);
  // walk along the new segment so fast moves still cover the guide
  const from = last || [u, v];
  const seg = Math.hypot(u - from[0], v - from[1]);
  const steps = Math.max(1, Math.ceil(seg / 0.01));
  for (let k = 1; k <= steps; k++) {
    const x = from[0] + ((u - from[0]) * k) / steps, y = from[1] + ((v - from[1]) * k) / steps;
    let near = Infinity;
    pad.samples.forEach(([gx, gy], i) => {
      const d = Math.hypot(gx - x, gy - y);
      if (d < near) near = d;
      if (d < COVER_TOL) pad.covered[i] = 1;
    });
    pad.inkCount++;
    if (near < NEAR_TOL) pad.inkNear++;
  }
  pad.inkLen += seg;
  drawPad();
  checkWriting(0.98); // finished the whole line: celebrate without waiting for the pen to lift
}
function finishStroke(s, trimMs = 0) {
  if (trimMs && s.pts.length > 3) {
    const end = s.pts[s.pts.length - 1][2];
    while (s.pts.length > 3 && end - s.pts[s.pts.length - 1][2] < trimMs) s.pts.pop();
    drawPad();
  }
  if (pad.done) return;
  checkWriting(0.85);
  if (pad.done) return;
  // A big scribble far from the line: wipe it and try again, kindly.
  const precision = pad.inkCount ? pad.inkNear / pad.inkCount : 1;
  if (pad.inkLen > pad.guideLen * 2.5 && precision < 0.4) {
    later(() => {
      if (view !== 'write' || pad.done) return;
      clearInk();
      speak([['Gəl bir də yazaq! Xətt üzrə yaz.', 'az']]);
    }, 500);
  }
}

/** Success when at least `need` of the guide is covered and most ink is on the line. */
function checkWriting(need) {
  if (pad.done) return;
  const coverage = pad.covered.reduce((a, b) => a + b, 0) / pad.samples.length;
  const precision = pad.inkCount ? pad.inkNear / pad.inkCount : 0;
  if (coverage >= need && precision >= 0.5) {
    pad.done = true;
    endAllPens();
    const num = NUMBERS[cur];
    ui.pad.classList.add('done');
    pad.covered.fill(1);
    drawPad();
    sfx.win();
    confetti();
    addStar(num.n, 'write');
    speak([[pick(PRAISE), 'az'], arPart(num)]);
    ui.btnNext.classList.remove('hidden');
  }
}
ui.btnNext.addEventListener('click', () => {
  sfx.press();
  if (cur + 1 < NUMBERS.length) showLearn(cur + 1);
  else showMap();
});

// touch / mouse writing
const pointerPens = new Map();
ui.pad.addEventListener('pointerdown', (e) => {
  if (pad.done) return;
  ui.pad.setPointerCapture?.(e.pointerId);
  const s = beginStroke();
  pointerPens.set(e.pointerId, s);
  const [u, v] = toPad(e.clientX, e.clientY);
  inkPoint(s, u, v, performance.now());
});
ui.pad.addEventListener('pointermove', (e) => {
  const s = pointerPens.get(e.pointerId);
  if (!s || pad.done) return;
  for (const ev of e.getCoalescedEvents?.() || [e]) {
    const [u, v] = toPad(ev.clientX, ev.clientY);
    inkPoint(s, u, v, performance.now());
  }
});
const penUp = (e) => {
  const s = pointerPens.get(e.pointerId);
  if (!s) return;
  pointerPens.delete(e.pointerId);
  finishStroke(s);
};
ui.pad.addEventListener('pointerup', penUp);
ui.pad.addEventListener('pointercancel', penUp);

// ---- quiz: how many?
const QUIZ_EMOJI = ['🐶', '🐱', '🐰', '🦊', '🐼', '🐸', '🐵', '🦄', '🐢', '🐙', '🍌', '🍉', '🍒', '🚗', '🚀', '🌸', '🍪', '⚽'];
let quizN = 0;
let quizLocked = false;

function showQuiz() {
  show('quiz', 'Neçədir?');
  quizRound();
}
function quizRound() {
  quizLocked = false;
  let n;
  do n = 1 + Math.floor(Math.random() * NUMBERS.length); while (n === quizN);
  quizN = n;
  makeObjects(ui.quizObjects, n, pick(QUIZ_EMOJI), null);
  const opts = new Set([n]);
  while (opts.size < 3) {
    const d = n + (Math.random() < 0.5 ? -1 : 1) * (1 + Math.floor(Math.random() * 3));
    if (d >= 1 && d <= NUMBERS.length) opts.add(d);
  }
  ui.choices.replaceChildren(...[...opts].sort(() => Math.random() - 0.5).map((k) => {
    const num = NUMBERS[k - 1];
    const b = document.createElement('button');
    b.className = 'choice hb';
    b.innerHTML = `<span class="d" lang="ar">${num.digit}</span><span class="w" lang="ar">${num.ar}</span>`;
    b.setAttribute('aria-label', num.tr);
    b.addEventListener('click', () => answer(b, k));
    return b;
  }));
  speak([['Neçədir? Say və seç!', 'az']]);
}
function answer(btn, k) {
  if (quizLocked) return;
  const num = NUMBERS[k - 1];
  if (k === quizN) {
    quizLocked = true;
    btn.classList.add('right');
    sfx.win();
    confetti(40);
    speak([arPart(num), [pick(PRAISE), 'az']]);
    later(quizRound, 2600);
  } else {
    btn.classList.remove('wrong');
    void btn.offsetWidth;
    btn.classList.add('wrong');
    sfx.nope();
    speak([arPart(num), ['Yox. Yenə say!', 'az']]);
  }
}

$('btn-home').addEventListener('click', () => {
  sfx.press();
  if (view === 'map') toStart();
  else showMap();
});

// ------------------------------------------------------------ hand cursors
let tracker = null;
let camera = null;
let waitingForPhone = false;
let noHandT = 0;
const agents = new Map();

function agentFor(id) {
  let a = agents.get(id);
  if (!a) {
    const el = document.createElement('div');
    el.className = 'hand-cursor';
    el.innerHTML = '<span class="hand">✋</span>';
    ui.cursors.appendChild(el);
    a = { id, el, icon: el.firstChild, target: null, dwell: 0, block: null, wasFist: false, arm: 0, stroke: null };
    agents.set(id, a);
  }
  return a;
}
function dropAgent(a) {
  endPen(a, PEN_TRIM_MS);
  setProgress(a.target, 0);
  a.el.remove();
  agents.delete(a.id);
}
function endPen(a, trim = 0) {
  if (a.stroke) finishStroke(a.stroke, trim);
  a.stroke = null;
  a.arm = 0;
}
function endAllPens() {
  for (const a of agents.values()) { a.stroke = null; a.arm = 0; }
  pointerPens.clear();
}
function setProgress(el, p) {
  if (!el) return;
  el.style.setProperty('--p', p.toFixed(3));
  el.classList.toggle('hot', p > 0);
}

function pressables() {
  const list = [...ui.views[view].querySelectorAll('.hb'), $('btn-home')];
  return list.filter((el) => el.offsetParent !== null && !el.classList.contains('hidden'));
}
function hitAt(list, x, y, pad = 10) {
  for (const el of list) {
    const r = el.getBoundingClientRect();
    if (x >= r.left - pad && x <= r.right + pad && y >= r.top - pad && y <= r.bottom + pad) return el;
  }
  return null;
}

function updateHands(dt, now) {
  const cursors = tracker.update(now);
  const seen = new Set();
  countCool -= dt;
  const buttons = pressables();
  for (const c of cursors) {
    seen.add(c.id);
    const a = agentFor(c.id);
    const x = c.x * window.innerWidth;
    const y = c.y * window.innerHeight;
    a.el.style.transform = `translate(${x}px, ${y}px)`;
    const closing = c.fist && !a.wasFist;
    a.wasFist = c.fist;

    // ---- writing: fist = pen down
    let writing = false;
    if (view === 'write' && !pad.done && (a.stroke || overPad(x, y))) {
      const [u, v] = toPad(x, y);
      if (c.fist) {
        writing = true;
        if (a.stroke) inkPoint(a.stroke, u, v, now);
        else if ((a.arm += dt) >= PEN_DELAY) {
          a.stroke = beginStroke();
          inkPoint(a.stroke, u, v, now);
        }
      } else if (a.stroke) {
        endPen(a, PEN_TRIM_MS);
      } else a.arm = 0;
    } else if (a.stroke) endPen(a, PEN_TRIM_MS);
    a.el.classList.toggle('pen', writing);
    a.el.classList.toggle('fist', c.fist && !writing);
    a.icon.textContent = writing ? '✍️' : c.fist ? '✊' : '✋';

    // ---- counting: touch the objects
    if ((view === 'learn' || view === 'quiz') && countCool <= 0) {
      const box = view === 'learn' ? ui.objects : ui.quizObjects;
      const o = hitAt([...box.querySelectorAll('.obj:not(.counted)')], x, y, 0);
      if (o) countObj(o);
    }

    // ---- buttons: hover to fill the ring, or close the hand to press at once
    let target = writing ? null : hitAt(buttons, x, y);
    if (target !== a.block) a.block = null;
    if (target && target === a.block) target = null; // must leave before pressing again
    if (target !== a.target) {
      setProgress(a.target, 0);
      a.target = target;
      a.dwell = 0;
    }
    if (target) {
      const need = Number(target.dataset.dwell) || BUTTON_TIME;
      a.dwell += c.fist ? 0 : dt;
      setProgress(target, a.dwell / need);
      if (a.dwell >= need || closing) {
        setProgress(target, 0);
        a.block = target;
        a.target = null;
        a.dwell = 0;
        target.click();
      }
    }
  }
  for (const a of [...agents.values()]) if (!seen.has(a.id)) dropAgent(a);

  const ok = cursors.length > 0;
  ui.camBadge.textContent = ok ? '✋ ✓' : '✋ ?';
  ui.camBadge.classList.toggle('ok', ok);
  noHandT = ok ? 0 : noHandT + dt;
  if (noHandT > 8) {
    noHandT = -12;
    speak([['Əlini göstər!', 'az']]);
  }
}

// ------------------------------------------------------------- game flow
function startGame(withHands) {
  mode = withHands ? 'hands' : 'touch';
  ui.start.classList.add('hidden');
  ui.game.classList.remove('hidden');
  ui.cam.classList.toggle('hidden', !withHands);
  showMap();
}

function toStart(message = '') {
  clearTimers();
  window.speechSynthesis?.cancel();
  for (const a of [...agents.values()]) dropAgent(a);
  waitingForPhone = false;
  tracker?.stop(camera);
  mode = 'touch';
  ui.cam.classList.add('hidden');
  ui.game.classList.add('hidden');
  ui.start.classList.remove('hidden');
  ui.startMsg.textContent = message;
}

import('../../arcade/js/camera.js')
  .then(({ createCamera }) => {
    camera = createCamera({
      video: $('cam-video'),
      select: $('camera'),
      linkEl: $('link'),
      isActive: () => mode === 'hands',
      onPhoneReady: () => { if (waitingForPhone) $('play-hands').click(); },
      onError: (text) => (ui.startMsg.textContent = text),
    });
  })
  .catch((err) => console.warn('Camera picker unavailable', err));

$('play-touch').addEventListener('click', () => {
  audio();
  startGame(false);
});
$('play-hands').addEventListener('click', async () => {
  audio();
  waitingForPhone = false;
  ui.startMsg.textContent = '';
  ui.loading.classList.remove('hidden');
  try {
    if (!camera) throw new Error('Kamera kodu yüklənmədi. İnterneti yoxlayıb səhifəni yeniləyin.');
    if (!tracker) {
      ui.loadingText.textContent = 'Yüklənir…';
      const { HandTracker } = await import('./hands.js');
      tracker = new HandTracker($('cam-video'), $('cam-canvas'));
    }
    const ready = await tracker.start(camera, (msg) => (ui.loadingText.textContent = msg));
    ui.loading.classList.add('hidden');
    if (!ready) {
      waitingForPhone = true;
      ui.startMsg.textContent = 'Telefon gözlənilir… QR kodu telefonla skan edin.';
      $('link').scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    startGame(true);
  } catch (err) {
    console.error(err);
    tracker?.stop(camera);
    ui.loading.classList.add('hidden');
    let msg = err?.message || String(err);
    if (err?.name === 'NotAllowedError') msg = 'Kameraya icazə verilmədi.';
    if (err?.name === 'NotFoundError') msg = 'Kamera tapılmadı.';
    toStart(`Kamera açılmadı: ${msg} Toxunaraq da oynamaq olar.`);
  }
});

// -------------------------------------------------------------------- loop
let last = performance.now();
function loop(now) {
  requestAnimationFrame(loop);
  const dt = clamp((now - last) / 1000, 0, 0.1);
  last = now;
  if (mode !== 'hands') { countCool -= dt; return; }
  if (!tracker || ui.game.classList.contains('hidden')) return;
  try {
    updateHands(dt, now);
  } catch (err) {
    console.error(err);
  }
}
requestAnimationFrame(loop);
