// Sound for the arcade games: little synthesized effects and a looping
// background tune, all made with the Web Audio API (no audio files).
// Browsers only allow sound after a tap/click, so call unlock() from one.

const KEY = 'arcade.sound'; // '0' = muted, shared by the games

let ac = null, master = null, musicBus = null;
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
    musicBus = ac.createGain();
    musicBus.gain.value = 0.32;
    musicBus.connect(master);
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

// ---- background music: a simple step sequencer ----
// Songs are original little loops: 16 steps per bar, notes as MIDI numbers (0 = rest).
export const SONGS = {
  // Bouncy, sunny tune for Pup Rescue Run (C major).
  pups: {
    bpm: 128, lead: 'square', bass: 'triangle',
    melody: [
      72, 0, 76, 0, 79, 0, 76, 0, 77, 0, 81, 0, 79, 0, 0, 0,
      76, 0, 79, 0, 84, 0, 79, 0, 81, 79, 77, 0, 76, 0, 0, 0,
      72, 0, 76, 0, 79, 0, 76, 0, 77, 0, 81, 0, 84, 0, 0, 0,
      83, 0, 81, 0, 79, 0, 77, 0, 76, 0, 74, 0, 72, 0, 0, 0,
    ],
    bassline: [48, 55, 52, 55, 53, 57, 55, 59, 48, 55, 52, 55, 53, 55, 48, 43],
  },
  // Driving synthwave loop for Neon Dash (A minor).
  neon: {
    bpm: 118, lead: 'sawtooth', bass: 'sawtooth',
    melody: [
      69, 0, 0, 72, 0, 0, 76, 0, 74, 0, 72, 0, 71, 0, 0, 0,
      69, 0, 0, 72, 0, 0, 76, 0, 79, 0, 77, 0, 76, 0, 0, 0,
      77, 0, 0, 76, 0, 0, 74, 0, 72, 0, 74, 0, 76, 0, 0, 0,
      74, 0, 0, 72, 0, 0, 71, 0, 72, 0, 71, 0, 69, 0, 0, 0,
    ],
    bassline: [45, 45, 45, 45, 41, 41, 41, 41, 48, 48, 48, 48, 43, 43, 43, 43],
  },
};

let seq = null;

export function startMusic(name) {
  const c = ctx();
  if (!c) return;
  stopMusic();
  const song = SONGS[name];
  const stepDur = 60 / song.bpm / 4; // 16th notes
  const s = { song, step: 0, next: c.currentTime + 0.1, timer: 0 };
  const schedule = () => {
    while (s.next < c.currentTime + 0.25) {
      const i = s.step;
      const n = song.melody[i % song.melody.length];
      if (n) tone(midi(n), stepDur * 1.8, { type: song.lead, vol: 0.09, at: s.next, out: musicBus });
      if (i % 4 === 0) {
        const b = song.bassline[Math.floor(i / 4) % song.bassline.length];
        tone(midi(b), stepDur * 3.2, { type: song.bass, vol: 0.16, at: s.next, out: musicBus });
        if (i % 8 === 0) tone(90, 0.12, { type: 'sine', vol: 0.35, slide: -50, at: s.next, out: musicBus }); // kick
      }
      if (i % 2 === 1) noise(0.04, { vol: 0.05, at: s.next, out: musicBus }); // hi-hat
      s.next += stepDur;
      s.step++;
    }
  };
  schedule();
  s.timer = setInterval(schedule, 60);
  seq = s;
}

export function stopMusic() {
  if (seq) clearInterval(seq.timer);
  seq = null;
}
