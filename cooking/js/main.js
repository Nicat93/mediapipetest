// Little Chef: a no-fail cooking game for small children.
// Put the right food in the dish (drag, tap, or hold a hand over it in front of
// the webcam), then wave/rub over the dish to cook it.

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const pick = (arr) => arr[(Math.random() * arr.length) | 0];
const shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

// Emoji kept to ones Windows 10 can draw. `tint` colours the dish; `liquid`
// items only colour it (no pieces floating on top).
const ITEMS = {
  tomato: { e: '🍅', name: 'tomato', tint: '#e5533d' },
  cheese: { e: '🧀', name: 'cheese', tint: '#ffd25a' },
  mushroom: { e: '🍄', name: 'mushroom' },
  corn: { e: '🌽', name: 'corn' },
  carrot: { e: '🥕', name: 'carrot', tint: '#f4a259' },
  potato: { e: '🥔', name: 'potato' },
  broccoli: { e: '🥦', name: 'broccoli' },
  strawberry: { e: '🍓', name: 'strawberry', tint: '#ff7d9c' },
  banana: { e: '🍌', name: 'banana', tint: '#ffe58a' },
  milk: { e: '🥛', name: 'milk', tint: '#fbf8f0', liquid: true },
  honey: { e: '🍯', name: 'honey', tint: '#f6c445', liquid: true },
  egg: { e: '🥚', name: 'egg', tint: '#ffe08a', liquid: true },
  lettuce: { e: '🥬', name: 'lettuce', tint: '#a6d672' },
  cucumber: { e: '🥒', name: 'cucumber' },
  grapes: { e: '🍇', name: 'grapes' },
  apple: { e: '🍎', name: 'apple' },
};

const RECIPES = [
  { name: 'pizza', done: '🍕', dish: 'pizza', dishWord: 'pizza', base: '#f3d9a4', verb: 'bake', items: ['tomato', 'cheese', 'mushroom', 'corn'] },
  { name: 'vegetable soup', done: '🍲', dish: 'pot', dishWord: 'pot', base: '#bfe3f2', verb: 'stir', items: ['carrot', 'potato', 'broccoli', 'tomato'] },
  { name: 'a smoothie', done: '🥤', dish: 'cup', dishWord: 'blender', base: '#e8f4fb', verb: 'mix', items: ['strawberry', 'banana', 'milk', 'honey'] },
  { name: 'pancakes', done: '🥞', dish: 'pan', dishWord: 'pan', base: '#4a4e60', verb: 'cook', items: ['egg', 'milk', 'honey', 'strawberry'] },
  { name: 'salad', done: '🥗', dish: 'bowl', dishWord: 'bowl', base: '#ffffff', verb: 'toss', items: ['lettuce', 'cucumber', 'tomato', 'carrot'] },
  { name: 'fruit salad', done: '🍧', dish: 'bowl', dishWord: 'bowl', base: '#ffffff', verb: 'mix', items: ['apple', 'grapes', 'banana', 'strawberry'] },
];

const PRAISE = ['Yummy!', 'Great job!', 'Well done!', 'Nice!', 'Super!', 'Mmm!'];
const GRAB_TIME = 0.45; // seconds a hand hovers over food to pick it up
const BUTTON_TIME = 1.0; // seconds a hand hovers over a button to press it
const COOK_WORK = 5; // how many dish-widths of waving/rubbing cooks the dish

const ui = {
  start: $('start'),
  game: $('game'),
  card: $('card'),
  stickers: $('stickers'),
  shelf: $('shelf'),
  dish: $('dish'),
  dishWrap: $('dish-wrap'),
  fill: document.querySelector('#dish .fill'),
  toppings: document.querySelector('#dish .toppings'),
  ring: document.querySelector('#ring'),
  ringCircle: document.querySelector('#ring circle'),
  doneDish: $('done-dish'),
  waveHint: $('wave-hint'),
  next: $('btn-next'),
  sound: $('btn-sound'),
  fx: $('fx'),
  cursors: $('cursors'),
  cam: $('cam'),
  camBadge: $('cam-badge'),
  loading: $('loading'),
  loadingText: $('loading-text'),
  startMsg: $('start-msg'),
};

let tracker = null; // HandTracker, created when "Play with hands" is chosen
let mode = 'touch'; // 'touch' | 'hands'
let phase = 'start'; // start | add | cook | done
let recipeIndex = 0;
let recipe = RECIPES[0];
let added = new Set();
let fill = '#ffffff';
let cookProgress = 0;
let idleT = 0;
let noHandT = 0;
let particleT = 0;
let muted = false;
let last = performance.now();

// ------------------------------------------------------------------ sound
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
function tone(freq, dur, { type = 'sine', vol = 0.15, slide = 0, delay = 0 } = {}) {
  if (muted) return;
  const ctx = audio();
  if (!ctx) return;
  const t = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t + dur);
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(vol, t + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + dur + 0.05);
}
const sfx = {
  pick: () => tone(520, 0.12, { type: 'triangle', slide: 300 }),
  plop: () => {
    tone(700, 0.18, { slide: -480, vol: 0.2 });
    tone(1100, 0.08, { type: 'triangle', vol: 0.06, delay: 0.12 });
  },
  nope: () => {
    tone(330, 0.15, { type: 'triangle' });
    tone(262, 0.22, { type: 'triangle', delay: 0.15 });
  },
  back: () => tone(400, 0.1, { type: 'triangle', slide: -150, vol: 0.08 }),
  sizzle: () => tone(900 + Math.random() * 500, 0.06, { type: 'square', vol: 0.025 }),
  fanfare: () =>
    [523, 659, 784, 1047].forEach((f, i) => tone(f, i === 3 ? 0.5 : 0.16, { type: 'triangle', vol: 0.16, delay: i * 0.13 })),
};

let voice = null;
function chooseVoice() {
  const voices = window.speechSynthesis?.getVoices() || [];
  const en = voices.filter((v) => /^en/i.test(v.lang));
  voice =
    en.find((v) => /female|samantha|zira|aria|jenny|google us english|karen|moira/i.test(v.name)) ||
    en.find((v) => /en-US/i.test(v.lang)) ||
    en[0] ||
    null;
}
window.speechSynthesis?.addEventListener?.('voiceschanged', chooseVoice);
chooseVoice();

function say(text) {
  const synth = window.speechSynthesis;
  if (muted || !synth) return;
  synth.cancel();
  const u = new SpeechSynthesisUtterance(text);
  if (voice) u.voice = voice;
  u.lang = voice?.lang || 'en-US';
  u.rate = 0.9;
  u.pitch = 1.25;
  synth.speak(u);
}

ui.sound.addEventListener('click', () => {
  muted = !muted;
  ui.sound.textContent = muted ? '🔇' : '🔊';
  if (muted) window.speechSynthesis?.cancel();
});

// ----------------------------------------------------------------- colours
function mix(a, b, t) {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (p, s) => (p >> s) & 255;
  const c = (s) => Math.round(ch(pa, s) + (ch(pb, s) - ch(pa, s)) * t);
  return `#${((c(16) << 16) | (c(8) << 8) | c(0)).toString(16).padStart(6, '0')}`;
}

// ------------------------------------------------------------------ recipe
const nextNeeded = () => recipe.items.find((k) => !added.has(k));

function loadRecipe() {
  recipe = RECIPES[recipeIndex % RECIPES.length];
  added = new Set();
  cookProgress = 0;
  idleT = 0;
  phase = 'add';
  fill = recipe.base;

  ui.dish.className = recipe.dish;
  ui.dish.style.opacity = '';
  ui.dish.style.setProperty('--fill', fill);
  ui.toppings.innerHTML = '';
  ui.doneDish.textContent = recipe.done;
  ui.doneDish.classList.remove('show');
  ui.ring.classList.remove('on');
  ui.ringCircle.style.strokeDasharray = '0 100';
  ui.waveHint.classList.add('hidden');
  ui.next.classList.add('hidden');

  ui.card.innerHTML =
    `<span class="goal" title="${recipe.name}">${recipe.done}</span>` +
    recipe.items.map((k) => `<span class="slot" data-key="${k}" title="${ITEMS[k].name}">${ITEMS[k].e}</span>`).join('');

  const others = shuffle(Object.keys(ITEMS).filter((k) => !recipe.items.includes(k))).slice(0, 2);
  ui.shelf.innerHTML = '';
  for (const k of shuffle([...recipe.items, ...others])) {
    const t = document.createElement('button');
    t.className = 'tile';
    t.dataset.key = k;
    t.textContent = ITEMS[k].e;
    t.setAttribute('aria-label', ITEMS[k].name);
    ui.shelf.appendChild(t);
  }
  markNext();
  say(`Let's make ${recipe.name}! First, the ${ITEMS[nextNeeded()].name}.`);
}

function markNext() {
  const next = nextNeeded();
  for (const s of ui.card.querySelectorAll('.slot')) {
    s.classList.toggle('got', added.has(s.dataset.key));
    s.classList.toggle('next', s.dataset.key === next);
  }
  for (const t of ui.shelf.querySelectorAll('.tile.hint')) t.classList.remove('hint');
}

function tileFor(key) {
  return ui.shelf.querySelector(`.tile[data-key="${key}"]`);
}

function dishGeom() {
  const r = ui.dishWrap.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, r: r.width / 2 };
}
function overDish(x, y, scale = 1) {
  const d = dishGeom();
  return Math.hypot(x - d.x, y - d.y) < d.r * scale;
}

function addTopping(key) {
  const it = ITEMS[key];
  if (it.tint) {
    fill = mix(fill, it.tint, 0.6);
    ui.dish.style.setProperty('--fill', fill);
  }
  if (!it.liquid) {
    for (let i = 0; i < 3; i++) {
      const s = document.createElement('span');
      const a = Math.random() * Math.PI * 2;
      const rr = 12 + Math.random() * 26;
      s.textContent = it.e;
      s.style.left = `${50 + Math.cos(a) * rr}%`;
      s.style.top = `${50 + Math.sin(a) * rr}%`;
      s.style.setProperty('--r', `${Math.round(Math.random() * 80 - 40)}deg`);
      s.style.animationDelay = `${i * 0.08}s`;
      ui.toppings.appendChild(s);
    }
  }
  ui.dish.classList.remove('happy');
  void ui.dish.offsetWidth;
  ui.dish.classList.add('happy');
}

/** Food arrives at the dish. Returns true if it belonged in the recipe. */
function tryAdd(held) {
  const { key, tile, el } = held;
  idleT = 0;
  if (phase !== 'add') {
    returnToTile(held);
    return false;
  }
  if (recipe.items.includes(key) && !added.has(key)) {
    added.add(key);
    tile.classList.remove('lifted');
    tile.classList.add('used');
    const d = dishGeom();
    flyTo(el, d.x, d.y, () => {
      el.remove();
      addTopping(key);
      sfx.plop();
      burst(d.x, d.y, ['✨', '⭐'], 6);
      markNext();
      const next = nextNeeded();
      if (next) say(`${pick(PRAISE)} Now the ${ITEMS[next].name}.`);
      else startCooking();
    });
    return true;
  }
  sfx.nope();
  ui.dish.classList.remove('shake');
  void ui.dish.offsetWidth;
  ui.dish.classList.add('shake');
  const next = nextNeeded();
  say(`Oops! No ${ITEMS[key].name} in the ${recipe.dishWord}. Try the ${ITEMS[next].name}!`);
  returnToTile(held);
  hintTile();
  return false;
}

function hintTile() {
  const t = tileFor(nextNeeded());
  t?.classList.add('hint');
}

function startCooking() {
  phase = 'cook';
  idleT = 0;
  cookProgress = 0;
  ui.ring.classList.add('on');
  ui.waveHint.classList.remove('hidden');
  ui.waveHint.textContent = mode === 'hands' ? '👋' : '👆';
  say(cookPrompt(true));
}
function cookPrompt(first) {
  const what = mode === 'hands' ? `Wave your hand over the ${recipe.dishWord}` : `Rub the ${recipe.dishWord} with your finger`;
  return `${first ? 'All in! ' : ''}${what} to ${recipe.verb} it!`;
}

function addCookWork(amount) {
  if (phase !== 'cook') return;
  cookProgress = clamp(cookProgress + amount, 0, 1);
  idleT = 0;
  ui.waveHint.classList.add('hidden');
  ui.dish.classList.add('cooking');
  ui.ringCircle.style.strokeDasharray = `${(cookProgress * 100).toFixed(1)} 100`;
  if (particleT <= 0) {
    particleT = 0.12;
    const d = dishGeom();
    const steamy = ['pot', 'pan'].includes(recipe.dish);
    burst(d.x + (Math.random() - 0.5) * d.r, d.y + (Math.random() - 0.5) * d.r, steamy ? ['💨', '✨'] : ['✨', '⭐'], 1, true);
    sfx.sizzle();
  }
  if (cookProgress >= 1) finishCooking();
}

function finishCooking() {
  phase = 'done';
  ui.dish.classList.remove('cooking');
  ui.ring.classList.remove('on');
  ui.dish.style.opacity = '0.3';
  ui.doneDish.classList.add('show');
  sfx.fanfare();
  confetti();
  const d = dishGeom();
  burst(d.x, d.y, ['⭐', '✨', '💖'], 14);
  const s = document.createElement('span');
  s.textContent = recipe.done;
  ui.stickers.appendChild(s);
  say(`Hooray! You made ${recipe.name}! Yummy yummy!`);
  setTimeout(() => {
    if (phase === 'done') ui.next.classList.remove('hidden');
  }, 1200);
}

ui.next.addEventListener('click', () => {
  if (phase !== 'done') return;
  recipeIndex++;
  sfx.pick();
  loadRecipe();
});

// ----------------------------------------------------------------- effects
function makeFloating(key, x, y) {
  const el = document.createElement('div');
  el.className = 'floating';
  el.textContent = ITEMS[key].e;
  el.style.transform = `translate(${x}px, ${y}px)`;
  ui.fx.appendChild(el);
  return el;
}
function flyTo(el, x, y, done) {
  el.classList.add('fly');
  void el.offsetWidth;
  el.style.transform = `translate(${x}px, ${y}px) scale(0.8)`;
  setTimeout(done, 450);
}
function returnToTile(held) {
  const r = held.tile.getBoundingClientRect();
  sfx.back();
  flyTo(held.el, r.left + r.width / 2, r.top + r.height / 2, () => {
    held.el.remove();
    held.tile.classList.remove('lifted');
  });
}
function burst(x, y, emojis, n, gentle = false) {
  for (let i = 0; i < n; i++) {
    const p = document.createElement('div');
    p.className = 'particle';
    p.textContent = pick(emojis);
    p.style.left = `${x}px`;
    p.style.top = `${y}px`;
    const a = gentle ? -Math.PI / 2 + (Math.random() - 0.5) : Math.random() * Math.PI * 2;
    const dist = gentle ? 60 + Math.random() * 60 : 90 + Math.random() * 120;
    p.style.setProperty('--dx', `${Math.cos(a) * dist}px`);
    p.style.setProperty('--dy', `${Math.sin(a) * dist}px`);
    p.style.setProperty('--t', `${gentle ? 1.1 : 0.9 + Math.random() * 0.6}s`);
    ui.fx.appendChild(p);
    setTimeout(() => p.remove(), 1600);
  }
}
function confetti() {
  const colors = ['#ff6b8b', '#ffb703', '#3bb273', '#6c8cff', '#c77dff', '#ff9f1c'];
  for (let i = 0; i < 70; i++) {
    const c = document.createElement('div');
    c.className = 'confetti';
    c.style.left = `${Math.random() * 100}vw`;
    c.style.background = pick(colors);
    c.style.animationDelay = `${Math.random() * 0.6}s`;
    c.style.setProperty('--t', `${1.8 + Math.random() * 1.4}s`);
    c.style.setProperty('--dx', `${(Math.random() - 0.5) * 200}px`);
    c.style.setProperty('--rot', `${Math.random() * 900 - 450}deg`);
    ui.fx.appendChild(c);
    setTimeout(() => c.remove(), 3800);
  }
}

// ---------------------------------------------------- touch / mouse input
const pointers = new Map(); // pointerId -> { held, tile, t0, x, y }

ui.shelf.addEventListener('pointerdown', (e) => {
  const tile = e.target.closest('.tile');
  if (!tile || tile.classList.contains('used') || tile.classList.contains('lifted') || phase !== 'add') return;
  e.preventDefault();
  audio();
  idleT = 0;
  tile.classList.add('lifted');
  const key = tile.dataset.key;
  const held = { key, tile, el: makeFloating(key, e.clientX, e.clientY) };
  pointers.set(e.pointerId, { held, tile, t0: performance.now(), x: e.clientX, y: e.clientY });
  sfx.pick();
  try {
    ui.shelf.setPointerCapture(e.pointerId);
  } catch {
    /* not capturable (e.g. synthetic event): window listeners still work */
  }
});

window.addEventListener('pointermove', (e) => {
  const p = pointers.get(e.pointerId);
  if (p) {
    p.held.el.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
    p.x = e.clientX;
    p.y = e.clientY;
    return;
  }
  // Rubbing / hovering over the dish while cooking.
  if (phase === 'cook' && overDish(e.clientX, e.clientY, 1.05)) {
    const lastP = lastMove.get(e.pointerId);
    if (lastP) addCookWork(Math.hypot(e.clientX - lastP.x, e.clientY - lastP.y) / (dishGeom().r * 2 * COOK_WORK));
  }
  lastMove.set(e.pointerId, { x: e.clientX, y: e.clientY });
});
const lastMove = new Map();

function endPointer(e) {
  const p = pointers.get(e.pointerId);
  lastMove.delete(e.pointerId);
  if (!p) return;
  pointers.delete(e.pointerId);
  const r = p.tile.getBoundingClientRect();
  const onTile = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
  const quickTap = onTile && performance.now() - p.t0 < 600;
  if (overDish(e.clientX, e.clientY, 1.1) || quickTap) tryAdd(p.held);
  else returnToTile(p.held);
}
window.addEventListener('pointerup', endPointer);
window.addEventListener('pointercancel', endPointer);

ui.dishWrap.addEventListener('pointerdown', () => addCookWork(0.07));

// ---------------------------------------------------------- hand cursors
const hands = new Map(); // cursor id -> agent

function handAgent(id) {
  let a = hands.get(id);
  if (!a) {
    const el = document.createElement('div');
    el.className = 'hand-cursor';
    el.innerHTML = '<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="44" pathLength="100"/></svg><span>✋</span>';
    ui.cursors.appendChild(el);
    a = { id, el, ring: el.querySelector('circle'), icon: el.querySelector('span'), held: null, target: null, dwell: 0, block: null, x: 0, y: 0, px: null, py: null };
    hands.set(id, a);
  }
  return a;
}

function dropHand(a) {
  if (a.held) returnToTile(a.held);
  a.el.remove();
  hands.delete(a.id);
}

function hitTile(x, y) {
  const pad = 10;
  for (const t of ui.shelf.querySelectorAll('.tile:not(.used):not(.lifted)')) {
    const r = t.getBoundingClientRect();
    if (x >= r.left - pad && x <= r.right + pad && y >= r.top - pad && y <= r.bottom + pad) return t;
  }
  return null;
}
function hitButton(x, y) {
  if (ui.next.classList.contains('hidden')) return null;
  const r = ui.next.getBoundingClientRect();
  return x >= r.left - 12 && x <= r.right + 12 && y >= r.top - 12 && y <= r.bottom + 12 ? ui.next : null;
}

function updateHands(dt, now) {
  const cursors = tracker.update(now);
  const seen = new Set();
  for (const c of cursors) {
    seen.add(c.id);
    const a = handAgent(c.id);
    a.x = c.x * window.innerWidth;
    a.y = c.y * window.innerHeight;
    a.el.style.transform = `translate(${a.x}px, ${a.y}px)`;

    if (a.held) {
      a.held.el.style.transform = `translate(${a.x}px, ${a.y - 34}px)`; // food sits on top of the fist
      if (overDish(a.x, a.y, 0.95)) {
        tryAdd(a.held);
        a.held = null;
        a.block = null;
      }
    } else {
      let target = null;
      let need = BUTTON_TIME;
      if (phase === 'add') {
        target = hitTile(a.x, a.y);
        need = GRAB_TIME;
      }
      if (!target) target = hitButton(a.x, a.y);
      if (target !== a.block) a.block = null;
      if (target && target === a.block) target = null; // must leave before pressing again
      if (target !== a.target) {
        a.target = target;
        a.dwell = 0;
      }
      if (target) {
        a.dwell += dt;
        if (a.dwell >= need) {
          a.dwell = 0;
          a.target = null;
          if (target.classList.contains('tile')) {
            idleT = 0;
            target.classList.add('lifted');
            const key = target.dataset.key;
            a.held = { key, tile: target, el: makeFloating(key, a.x, a.y - 34) };
            sfx.pick();
          } else {
            a.block = target;
            target.click();
          }
        }
      }
      a.ring.style.strokeDasharray = `${target ? ((a.dwell / need) * 100).toFixed(1) : 0} 100`;
    }
    a.el.classList.toggle('holding', !!a.held);
    a.icon.textContent = a.held ? '✊' : '✋';

    if (phase === 'cook' && a.px !== null && overDish(a.x, a.y, 1.05)) {
      addCookWork(Math.hypot(a.x - a.px, a.y - a.py) / (dishGeom().r * 2 * COOK_WORK));
    }
    a.px = a.x;
    a.py = a.y;
  }
  for (const a of [...hands.values()]) if (!seen.has(a.id)) dropHand(a);

  const ok = cursors.length > 0;
  ui.camBadge.textContent = ok ? '✋ ✓' : '✋ ?';
  ui.camBadge.classList.toggle('ok', ok);
  noHandT = ok ? 0 : noHandT + dt;
  if (noHandT > 8 && phase !== 'start') {
    noHandT = -12; // don't repeat too often
    say('Hold up your hand so I can see it!');
  }
}

// ------------------------------------------------------------ game flow
function startGame(withHands) {
  mode = withHands ? 'hands' : 'touch';
  ui.start.classList.add('hidden');
  ui.game.classList.remove('hidden');
  ui.cam.classList.toggle('hidden', !withHands);
  ui.stickers.innerHTML = '';
  recipeIndex = 0;
  loadRecipe();
}

function toStart(message = '') {
  phase = 'start';
  window.speechSynthesis?.cancel();
  for (const a of [...hands.values()]) dropHand(a);
  for (const [id, p] of pointers) {
    p.held.el.remove();
    pointers.delete(id);
  }
  ui.fx.innerHTML = '';
  waitingForPhone = false;
  tracker?.stop(camera);
  ui.cam.classList.add('hidden');
  ui.game.classList.add('hidden');
  ui.start.classList.remove('hidden');
  ui.startMsg.textContent = message;
}

$('btn-home').addEventListener('click', () => toStart());
$('play-touch').addEventListener('click', () => {
  audio();
  startGame(false);
});
// Camera picker (PC camera or phone over Wi-Fi), shared with the arcade games.
let camera = null;
let waitingForPhone = false;
import('../../arcade/js/camera.js')
  .then(({ createCamera }) => {
    camera = createCamera({
      video: $('cam-video'),
      select: $('camera'),
      linkEl: $('link'),
      isActive: () => mode === 'hands' && phase !== 'start',
      onPhoneReady: () => {
        if (waitingForPhone) $('play-hands').click();
      },
      onError: (text) => (ui.startMsg.textContent = text),
    });
  })
  .catch((err) => console.warn('Camera picker unavailable', err));

$('play-hands').addEventListener('click', async () => {
  audio();
  if (!waitingForPhone) say('Hello, little chef!');
  waitingForPhone = false;
  ui.startMsg.textContent = '';
  ui.loading.classList.remove('hidden');
  try {
    if (!camera) throw new Error('The camera code did not load. Check the internet connection and reload.');
    if (!tracker) {
      ui.loadingText.textContent = 'Loading…';
      const { HandTracker } = await import('./hands.js');
      tracker = new HandTracker($('cam-video'), $('cam-canvas'));
    }
    const ready = await tracker.start(camera, (msg) => (ui.loadingText.textContent = msg));
    ui.loading.classList.add('hidden');
    if (!ready) {
      // Phone chosen but not connected yet: show the QR code and start once it connects.
      waitingForPhone = true;
      document.querySelector('#start details.grown-ups').open = true;
      ui.startMsg.textContent = 'Waiting for the phone… Scan the QR code below with it.';
      $('link').scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    startGame(true);
  } catch (err) {
    console.error(err);
    tracker?.stop(camera);
    ui.loading.classList.add('hidden');
    let msg = err?.message || String(err);
    if (err?.name === 'NotAllowedError') msg = 'Camera permission was denied.';
    if (err?.name === 'NotFoundError') msg = 'No camera was found.';
    toStart(`Couldn't use the camera: ${msg} You can play with touch instead.`);
  }
});

// ------------------------------------------------------------------ loop
function loop(now) {
  requestAnimationFrame(loop);
  const dt = clamp((now - last) / 1000, 0, 0.1);
  last = now;
  if (phase === 'start') return;
  particleT -= dt;
  idleT += dt;

  if (mode === 'hands' && tracker) {
    try {
      updateHands(dt, now);
    } catch (err) {
      console.error(err);
    }
  }

  if (phase === 'cook' && ui.dish.classList.contains('cooking') && idleT > 0.3) {
    ui.dish.classList.remove('cooking');
  }

  // Gentle help for a child who is stuck: wiggle the right food, then say it again.
  if (phase === 'add') {
    if (idleT > 6) hintTile();
    if (idleT > 14) {
      idleT = 0; // the wiggle stays on until the food goes in
      say(`Can you find the ${ITEMS[nextNeeded()].name}?`);
    }
  } else if (phase === 'cook' && idleT > 10) {
    idleT = 0;
    ui.waveHint.classList.remove('hidden');
    say(cookPrompt(false));
  }
}
requestAnimationFrame(loop);
