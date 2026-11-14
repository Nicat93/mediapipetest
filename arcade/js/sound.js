// Sound for the arcade games: little synthesized effects and quiet ambience
// (no music), all made with the Web Audio API (no audio files).
// Browsers only allow sound after a tap/click, so call unlock() from one.

const KEY = 'arcade.sound'; // '0' = muted, shared by the games

let ac = null, master = null;
let muted = false;
try { muted = localStorage.getItem(KEY) === '0'; } catch {}

function ctx() {
  if (!ac) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ac = new AC();
    master = ac.createGain();
    master.gain.value = muted ? 0 : 0.8;
    master.connect(ac.destination);
  }
  return ac;
}

export function unlock() {
  const c = ctx();
  if (c && c.state === 'suspended') c.resume();
}

export function isMuted() { return muted; }

export function setMuted(m) {
  muted = m;
  try { localStorage.setItem(KEY, m ? '0' : '1'); } catch {}
  if (master) master.gain.setTargetAtTime(m ? 0 : 0.8, ac.currentTime, 0.02);
}

/** Wires a button that toggles the sound and shows 🔊 / 🔇. */
export function soundButton(btn) {
  const show = () => {
    btn.textContent = muted ? '🔇' : '🔊';
    btn.setAttribute('aria-pressed', String(!muted));
  };
  btn.addEventListener('click', (e) => {
    unlock();
    setMuted(!muted);
    show();
    e.currentTarget.blur();
  });
  show();
}

const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);

function tone(freq, dur, { type = 'sine', vol = 0.2, slide = 0, at = 0, attack = 0.005, out = null } = {}) {
  const c = ctx();
  if (!c) return;
  const t = (at || c.currentTime) + 0.001;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(out || master);
  o.start(t);
  o.stop(t + dur + 0.02);
}

let noiseBuf = null;
function noise(dur, { vol = 0.1, at = 0, hp = 6000, out = null } = {}) {
  const c = ctx();
  if (!c) return;
  if (!noiseBuf) {
    noiseBuf = c.createBuffer(1, c.sampleRate * 0.5, c.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const t = at || c.currentTime;
  const s = c.createBufferSource();
  s.buffer = noiseBuf;
  const f = c.createBiquadFilter();
  f.type = 'highpass';
  f.frequency.value = hp;
  const g = c.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f).connect(g).connect(out || master);
  s.start(t);
  s.stop(t + dur + 0.02);
}

// ---- sound effects ----
export const sfx = {
  pickup() { // bone / coin: bright two-note chime
    tone(midi(84), 0.09, { type: 'triangle', vol: 0.22 });
    tone(midi(91), 0.16, { type: 'triangle', vol: 0.2, at: ctx() && ac.currentTime + 0.07 });
  },
  hit() { // soft cartoon "boing"
    tone(320, 0.35, { type: 'sine', vol: 0.35, slide: -200 });
    tone(160, 0.3, { type: 'triangle', vol: 0.2, slide: -80 });
  },
  cleared() { // ducked under: quick happy run up
    const t = ctx() && ac.currentTime;
    [72, 76, 79, 84].forEach((n, i) => tone(midi(n), 0.12, { type: 'square', vol: 0.09, at: t + i * 0.06 }));
  },
  lane() { // whoosh on a lane change
    noise(0.12, { vol: 0.06, hp: 2500 });
  },
  tick() { tone(midi(76), 0.12, { type: 'triangle', vol: 0.25 }); },
  go() {
    const t = ctx() && ac.currentTime;
    tone(midi(79), 0.1, { type: 'square', vol: 0.12, at: t });
    tone(midi(84), 0.3, { type: 'square', vol: 0.12, at: t + 0.1 });
  },
  over() { // a gentle, cheerful ending (no sad trombone)
    const t = ctx() && ac.currentTime;
    [72, 76, 79, 76, 84].forEach((n, i) => tone(midi(n), i === 4 ? 0.5 : 0.16, { type: 'triangle', vol: 0.2, at: t + i * 0.14 }));
  },
};

// ---- ambience: quiet background sounds of the place (no music) ----
// 'town': birds chirping now and then. 'neon': soft wind with a low hum.

let amb = null;

function chirp(at) {
  // a little bird: 2–4 quick rising whistles
  const base = 2600 + Math.random() * 1400;
  const n = 2 + Math.floor(Math.random() * 3);
  for (let i = 0; i < n; i++) {
    tone(base * (1 + Math.random() * 0.1), 0.07, { type: 'sine', vol: 0.05, slide: 900, at: at + i * 0.11, out: ambBus });
  }
}

let ambBus = null;

export function startAmbience(name) {
  const c = ctx();
  if (!c) return;
  stopAmbience();
  ambBus = c.createGain();
  ambBus.gain.value = 0.9;
  ambBus.connect(master);
  const a = { timers: [], nodes: [] };
  if (name === 'town') {
    const next = () => {
      chirp(c.currentTime + 0.05);
      a.timers.push(setTimeout(next, 1500 + Math.random() * 3500));
    };
    a.timers.push(setTimeout(next, 800));
  } else {
    // wind: looping filtered noise, slowly swelling
    noise(0.01, { vol: 0.0001, out: ambBus }); // makes sure the noise buffer exists
    const src = c.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 500;
    const g = c.createGain();
    g.gain.value = 0.05;
    const lfo = c.createOscillator();
    const lfoGain = c.createGain();
    lfo.frequency.value = 0.12;
    lfoGain.gain.value = 0.025;
    lfo.connect(lfoGain).connect(g.gain);
    src.connect(f).connect(g).connect(ambBus);
    // low hum
    const hum = c.createOscillator();
    hum.type = 'sine';
    hum.frequency.value = 55;
    const hg = c.createGain();
    hg.gain.value = 0.03;
    hum.connect(hg).connect(ambBus);
    src.start(); lfo.start(); hum.start();
    a.nodes.push(src, lfo, hum);
  }
  amb = a;
}

export function stopAmbience() {
  if (!amb) return;
  amb.timers.forEach(clearTimeout);
  for (const n of amb.nodes) { try { n.stop(); } catch {} }
  if (ambBus) {
    const bus = ambBus;
    bus.gain.setTargetAtTime(0.0001, ac.currentTime, 0.1);
    setTimeout(() => bus.disconnect(), 600);
  }
  amb = null;
  ambBus = null;
}
