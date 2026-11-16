// Star Catcher: the starter game. Copy this folder to begin a new game; it
// shows every shared piece from ../common in use (docs/NEW_GAME.md explains them).
import { HandTracker } from '../../common/tracking.js';
import { createShell } from '../../common/shell.js';
import { store, createSound, createSpeech, confetti, burst, HandButtons, HandCursors, loop } from '../../common/fx.js';

const $ = (id) => document.getElementById(id);
const BEST_KEY = 'template.best'; // prefix keys with the folder name

// ---- sound and voice (one 🔊 switch for both)
const sound = createSound({ key: 'template.sound' });
const speech = createSpeech(sound, { lang: 'en' });
sound.bindButton($('btn-sound'));

// ---- hand helpers: pointers on screen, and buttons pressed by hovering / a fist
const cursors = new HandCursors();
const buttons = new HandButtons({ root: $('game'), time: 1.2 });

// ---- game state
let score = 0;
let stars = [];

function addStar() {
  const el = document.createElement('div');
  el.className = 'star';
  el.textContent = '⭐';
  const star = { el, x: 0.15 + Math.random() * 0.7, y: 0.25 + Math.random() * 0.6 };
  el.style.left = `${star.x * 100}%`;
  el.style.top = `${star.y * 100}%`;
  el.addEventListener('pointerdown', () => catchStar(star)); // touch / mouse
  $('field').append(el);
  stars.push(star);
}

function catchStar(star) {
  const r = star.el.getBoundingClientRect();
  burst(r.left + r.width / 2, r.top + r.height / 2, ['✨', '⭐'], 8);
  sound.sfx.pop();
  star.el.remove();
  stars = stars.filter((s) => s !== star);
  score++;
  $('score').textContent = score;
  if (score % 10 === 0) {
    confetti();
    sound.sfx.win();
    speech.say(`${score} stars! Well done!`);
  }
  if (score > store.get(BEST_KEY, 0)) store.set(BEST_KEY, score);
  addStar();
}

// ---- start screen, camera picker, loading, errors: all in the shell
const shell = createShell({
  lang: 'en',
  touch: true, // there is a touch mode, mention it in camera errors
  preview: true, // small camera picture with the hand skeleton
  unlock: () => sound.unlock(),
  tracker: (video, preview) => new HandTracker(video, { numHands: 2, preview }),
  onPlay: ({ camera }) => {
    score = 0;
    $('score').textContent = '0';
    $('field').replaceChildren();
    stars = [];
    for (let i = 0; i < 3; i++) addStar();
    speech.say(camera ? 'Touch the stars with your hands!' : 'Touch the stars!');
  },
  onHome: () => {
    cursors.clear();
    buttons.reset();
  },
});
$('play').addEventListener('click', () => shell.play());
$('play-touch').addEventListener('click', () => shell.playTouch());
$('btn-home').addEventListener('click', () => shell.home());

// ---- every frame
loop((dt, now) => {
  const hands = shell.track(now); // [] unless playing with the camera
  cursors.update(hands);
  const points = hands.map((h) => ({ id: h.id, x: h.x * innerWidth, y: h.y * innerHeight, fist: h.fist }));
  buttons.update(points, dt);
  for (const p of points) {
    const hit = stars.find((s) => Math.hypot(s.x * innerWidth - p.x, s.y * innerHeight - p.y) < 70);
    if (hit) catchStar(hit);
  }
});
