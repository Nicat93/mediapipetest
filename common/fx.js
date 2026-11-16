// Small helpers every game wants: saved settings, beeps, a talking voice,
// confetti, and buttons pressed by holding a hand over them.
// All of them are optional; import only what you use.

const pick = (a) => a[Math.floor(Math.random() * a.length)];

// ------------------------------------------------------------------ storage
/** localStorage with JSON and without exceptions (private mode, blocked storage). */
export const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v === null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
  },
};

// -------------------------------------------------------------------- sound
/**
 * Beeps with WebAudio, plus the on/off switch that speech also follows.
 *   const sound = createSound({ key: 'mygame.sound' });   // key: remember on/off (optional)
 *   sound.unlock();                         // call from a click (browsers need a gesture)
 *   sound.tone(660, 0.1, { type: 'triangle', slide: 300, at: 0.1, vol: 0.2 });
 *   sound.sfx.win();                        // ready-made: press, pop, good, nope, win, star(i)
 *   sound.bindButton(document.getElementById('btn-sound'));   // 🔊 / 🔇 toggle
 */
export function createSound({ key = null, on = true } = {}) {
  let ctx = null;
  const listeners = new Set();
  const s = {
    on: key ? store.get(key, on) : on,
    unlock() {
      try {
        ctx ||= new (window.AudioContext || window.webkitAudioContext)();
        if (ctx.state === 'suspended') ctx.resume();
      } catch {}
      return ctx;
    },
    tone(freq, dur = 0.12, { type = 'sine', vol = 0.18, at = 0, slide = 0 } = {}) {
      if (!s.on) return;
      const c = s.unlock();
      if (!c) return;
      const t = c.currentTime + at;
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, t);
      if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(c.destination);
      o.start(t);
      o.stop(t + dur + 0.03);
    },
    set(value) {
      s.on = !!value;
      if (key) store.set(key, s.on);
      if (!s.on) window.speechSynthesis?.cancel();
      listeners.forEach((fn) => fn(s.on));
    },
    toggle() { s.set(!s.on); },
    onChange(fn) { listeners.add(fn); fn(s.on); },
    bindButton(btn) {
      s.onChange((v) => (btn.textContent = v ? '🔊' : '🔇'));
      btn.addEventListener('click', () => s.toggle());
    },
  };
  s.sfx = {
    press: () => s.tone(520, 0.08, { type: 'triangle', vol: 0.15 }),
    pop: () => s.tone(660, 0.12, { type: 'triangle', vol: 0.2, slide: 300 }),
    good: () => [660, 880].forEach((f, i) => s.tone(f, 0.14, { type: 'triangle', vol: 0.16, at: i * 0.09 })),
    nope: () => s.tone(300, 0.25, { vol: 0.2, slide: -120 }),
    win: () => [523, 659, 784, 1047].forEach((f, i) => s.tone(f, i === 3 ? 0.45 : 0.22, { type: 'triangle', vol: 0.17, at: i * 0.11 })),
    star: (i = 0) => s.tone(880 + i * 220, 0.18, { type: 'triangle', vol: 0.14 }),
  };
  return s;
}

// ------------------------------------------------------------------- speech
const PREFER = /natural|online|google|female|samantha|zira|aria|jenny|karen|moira/i;
/**
 * Best installed voice for a language. `lang` is a code like 'en', 'ar', or
 * several in order of preference: 'az|tr' (Azerbaijani, else Turkish).
 */
export function findVoice(lang) {
  const all = window.speechSynthesis?.getVoices() || [];
  for (const code of lang.split('|')) {
    const re = new RegExp(`^${code}([-_]|$)`, 'i');
    const vs = all.filter((v) => re.test(v.lang));
    if (vs.length) return vs.find((v) => PREFER.test(v.name)) || vs[0];
  }
  return null;
}

/**
 * The game's voice (browser speech synthesis), silent while `sound` is off.
 *   const speech = createSpeech(sound, { lang: 'en', rate: 0.95, pitch: 1.15 });
 *   speech.say('Show me your hand!');                  // stops what was playing first
 *   speech.say([                                       // several parts, in order
 *     'Well done!',
 *     { text: 'ثلاثة', lang: 'ar', rate: 0.8, fallback: { text: 'səlasə', lang: 'az|tr' } },
 *   ]);
 *   speech.onVoices(() => …);   // the voice list arrives late in some browsers
 */
export function createSpeech(sound, { lang = 'en', rate = 0.95, pitch = 1.15 } = {}) {
  const voices = new Map();
  const listeners = new Set();
  const synth = window.speechSynthesis;
  const refresh = () => {
    voices.clear();
    listeners.forEach((fn) => fn());
  };
  synth?.addEventListener?.('voiceschanged', refresh);
  const voice = (l) => {
    if (!voices.has(l)) voices.set(l, findVoice(l));
    return voices.get(l);
  };
  const sp = {
    voice,
    onVoices(fn) { listeners.add(fn); fn(); },
    cancel() { synth?.cancel(); },
    say(parts, { queue = false } = {}) {
      if (!synth || (sound && !sound.on)) return;
      if (!queue) synth.cancel();
      for (let part of [].concat(parts)) {
        if (typeof part === 'string') part = { text: part };
        let l = part.lang || lang;
        let v = voice(l);
        if (!v && part.fallback) {
          part = { ...part, ...part.fallback };
          l = part.lang || lang;
          v = voice(l);
        }
        const u = new SpeechSynthesisUtterance(part.text);
        if (v) u.voice = v;
        u.lang = v?.lang || l.split('|')[0];
        u.rate = part.rate ?? rate;
        u.pitch = part.pitch ?? pitch;
        synth.speak(u);
      }
    },
  };
  return sp;
}

// ------------------------------------------------------------------ effects
let layer = null;
function fxLayer() {
  if (!layer || !layer.isConnected) {
    layer = document.createElement('div');
    layer.className = 'kit-fx';
    layer.setAttribute('aria-hidden', 'true');
    document.body.append(layer);
  }
  return layer;
}

/** Confetti falling over the whole screen. */
export function confetti(n = 70, colors = ['#7b5cff', '#ffb703', '#2fb36d', '#ff5d8f', '#3fa9f5', '#ff8a3d']) {
  const box = fxLayer();
  for (let i = 0; i < n; i++) {
    const c = document.createElement('i');
    c.className = 'kit-confetti';
    c.style.left = `${Math.random() * 100}vw`;
    c.style.background = pick(colors);
    c.style.setProperty('--dx', `${(Math.random() - 0.5) * 200}px`);
    c.style.setProperty('--rot', `${Math.random() * 900 - 450}deg`);
    c.style.setProperty('--t', `${1.8 + Math.random() * 1.4}s`);
    c.style.animationDelay = `${Math.random() * 0.4}s`;
    box.append(c);
    setTimeout(() => c.remove(), 3800);
  }
}

/** Emoji flying out from (x, y) in screen px. gentle: float upwards instead. */
export function burst(x, y, emojis = ['⭐', '✨'], n = 10, { gentle = false } = {}) {
  const box = fxLayer();
  for (let i = 0; i < n; i++) {
    const p = document.createElement('div');
    p.className = 'kit-particle';
    p.textContent = pick(emojis);
    p.style.left = `${x}px`;
    p.style.top = `${y}px`;
    const a = gentle ? -Math.PI / 2 + (Math.random() - 0.5) : Math.random() * Math.PI * 2;
    const d = gentle ? 60 + Math.random() * 60 : 80 + Math.random() * 120;
    p.style.setProperty('--dx', `${Math.cos(a) * d}px`);
    p.style.setProperty('--dy', `${Math.sin(a) * d}px`);
    p.style.setProperty('--t', `${gentle ? 1.1 : 0.9 + Math.random() * 0.5}s`);
    box.append(p);
    setTimeout(() => p.remove(), 1600);
  }
}

// ------------------------------------------------------------ hand buttons
/**
 * Buttons a child presses by holding a hand over them (a ring fills up), or at
 * once by closing the hand (fist) over them. Give the buttons class "hb"
 * (styled in kit.css); data-dwell="1.5" on a button overrides the time.
 *   const buttons = new HandButtons({ root: document.getElementById('game'), time: 1.2 });
 *   buttons.update(hands.map((h) => ({ id: h.id, x: h.x * innerWidth, y: h.y * innerHeight, fist: h.fist })), dt);
 * A hand must leave a button before it can press it again.
 */
export class HandButtons {
  constructor({ root = document, selector = '.hb', time = 1.2, pad = 12, fistPress = true } = {}) {
    Object.assign(this, { root, selector, time, pad, fistPress });
    this.state = new Map(); // hand id -> { target, dwell, block, wasFist }
  }

  /** The buttons that can be pressed now (visible ones). */
  buttons() {
    return [...this.root.querySelectorAll(this.selector)].filter((b) => b.offsetParent !== null && !b.disabled);
  }

  hit(list, x, y) {
    const p = this.pad;
    return list.find((b) => {
      const r = b.getBoundingClientRect();
      return x >= r.left - p && x <= r.right + p && y >= r.top - p && y <= r.bottom + p;
    }) || null;
  }

  /**
   * points: [{ id, x, y, fist?, skip? }] in screen px (skip: this hand is busy, e.g. drawing).
   * Returns the button each hand is over, as a Map id -> button.
   */
  update(points, dt) {
    const list = this.buttons();
    const over = new Map();
    const progress = new Map();
    for (const p of points) {
      const s = this.state.get(p.id) || { target: null, dwell: 0, block: null, wasFist: false };
      this.state.set(p.id, s);
      const closing = this.fistPress && p.fist && !s.wasFist;
      s.wasFist = !!p.fist;
      let target = p.skip ? null : this.hit(list, p.x, p.y);
      if (target !== s.block) s.block = null;
      if (target && target === s.block) target = null;
      if (target !== s.target) {
        s.target = target;
        s.dwell = 0;
      }
      if (!target) continue;
      over.set(p.id, target);
      const need = Number(target.dataset.dwell) || this.time;
      if (!p.fist) s.dwell += dt;
      if (s.dwell >= need || closing) {
        s.block = target;
        s.target = null;
        s.dwell = 0;
        target.click();
        continue;
      }
      progress.set(target, Math.max(progress.get(target) || 0, s.dwell / need));
    }
    const ids = new Set(points.map((p) => p.id));
    for (const id of this.state.keys()) if (!ids.has(id)) this.state.delete(id);
    for (const b of list) HandButtons.setProgress(b, progress.get(b) || 0);
    return over;
  }

  reset() {
    this.state.clear();
    for (const b of this.root.querySelectorAll(this.selector)) HandButtons.setProgress(b, 0);
  }

  /** Shows the dwell ring on a button (0..1). */
  static setProgress(el, p) {
    if (!el) return;
    el.style.setProperty('--p', p.toFixed(3));
    el.classList.toggle('hot', p > 0);
  }
}

// ------------------------------------------------------------ hand cursors
/**
 * On-screen hand pointers (✋ open, ✊ closed), one per tracked hand.
 *   const cursors = new HandCursors();
 *   cursors.update(hands);            // hands from HandTracker / shell.track()
 *   cursors.get(id)?.classList.add('busy');
 *   cursors.clear();
 */
export class HandCursors {
  constructor({ parent = document.body, open = '✋', closed = '✊' } = {}) {
    this.box = document.createElement('div');
    this.box.className = 'kit-cursors';
    this.box.setAttribute('aria-hidden', 'true');
    parent.append(this.box);
    Object.assign(this, { open, closed });
    this.els = new Map();
  }
  update(hands) {
    const seen = new Set();
    for (const h of hands) {
      seen.add(h.id);
      let e = this.els.get(h.id);
      if (!e) {
        e = document.createElement('div');
        e.className = 'kit-cursor';
        this.box.append(e);
        this.els.set(h.id, e);
      }
      e.style.transform = `translate(${h.x * window.innerWidth}px, ${h.y * window.innerHeight}px)`;
      e.textContent = h.fist ? this.closed : this.open;
      e.classList.toggle('fist', !!h.fist);
    }
    for (const [id, e] of this.els) {
      if (!seen.has(id)) {
        e.remove();
        this.els.delete(id);
      }
    }
  }
  get(id) { return this.els.get(id); }
  clear() { this.update([]); }
}

// --------------------------------------------------------------- game loop
/**
 * requestAnimationFrame loop with dt in seconds (capped at 0.1 so a hidden tab
 * doesn't make things jump). Errors are logged, not fatal.
 *   loop((dt, now) => { … });
 */
export function loop(fn) {
  let last = performance.now();
  const frame = (now) => {
    requestAnimationFrame(frame);
    const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
    last = now;
    try {
      fn(dt, now);
    } catch (err) {
      console.error(err);
    }
  };
  requestAnimationFrame(frame);
}
