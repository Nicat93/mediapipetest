# Making a new game

Every game is a static folder (no build step) that GitHub Pages serves at `/mediapipetest/<folder>/`.
The shared code in [`common/`](../common/) handles the start screen, camera, phone link and MediaPipe,
so a new game only needs its own idea.

## Quick start

1. Copy `template/` to a new folder, e.g. `cp -r template balloons`.
2. Change the title, logo, tag line and Grown-ups text in `balloons/index.html`.
3. Rename the storage keys in `js/main.js` (`template.*` → `balloons.*`).
4. Replace the star logic with the game. Keep the `createShell(...)` block and the `loop(...)`.
5. Add a card to the root `index.html` and a row to the table in the root `README.md`.
6. Test it: run `python3 -m http.server 8000` in the repo root and open http://localhost:8000/balloons/.
   For the camera without a real camera, see [Testing](#testing).

The template (*Star Catcher*) is a complete small game that uses every piece below. It's the quickest
reference.

## Page contract

```html
<link rel="stylesheet" href="../common/kit.css">   <!-- first -->
<link rel="stylesheet" href="style.css">           <!-- the game's own rules and variable overrides -->
<script type="module" src="js/main.js"></script>

<section id="start" class="screen">
  <div class="logo">⭐</div>
  <h1>Name</h1>
  <p class="tag">One line for the child</p>
  <div class="start-buttons">
    <button id="play" class="big"><span class="ico">✋</span>Play<small>uses the camera</small></button>
    <button id="play-touch" class="big alt"><span class="ico">👆</span>Play with touch<small>or a mouse</small></button>
  </div>
  <div class="kit-camera"></div>                <!-- shell.js fills this: picker, QR code, messages -->
  <details class="grown-ups"><summary>Grown-ups</summary> … <a href="../">All games</a></details>
</section>

<section id="game" class="screen hidden"> … </section>
```

- **Required:** `#start` and `#game`. Everything else is optional.
- **Created by the shell:** the hidden `<video id="cam-video">`, the loading overlay and the camera preview. Don't add them yourself.
- **Settings:** use `<label class="opt"><input type="checkbox"> Text <small>hint</small></label>` inside `details.grown-ups`.

## `common/shell.js`: the start screen and camera flow

```js
import { createShell } from '../../common/shell.js';
const shell = createShell({
  lang: 'en',                 // texts for loading / errors: 'en' or 'az' (add more in STRINGS)
  touch: true,                // the game has a touch mode: camera errors say "You can play with touch instead."
  preview: true,              // small mirrored camera picture with the skeleton, bottom right, while playing
  unlock: () => sound.unlock(),            // runs on each play click (browsers need a gesture for audio)
  tracker: (video, preview) => new HandTracker(video, { preview }),   // made once, on the first camera play
  onPlay: ({ camera, arg }) => startLevel(arg ?? 1),  // game screen is already visible
  onHome: () => { stopTimers(); },                    // start screen is already visible
});
$('play').onclick = () => shell.play(savedLevel);  // camera; `arg` is passed through to onPlay
$('play-touch').onclick = () => shell.playTouch();
$('btn-home').onclick = () => shell.home();        // also shell.home('message') shows a message
// each frame:
const hands = shell.track(now);   // tracker results, or [] when not playing with the camera
```

`shell.play()` does all of this:

1. Shows the loading overlay.
2. Loads the model while it opens the camera.
3. If the phone is picked but not connected yet, it shows the QR code and starts by itself once the phone connects.
4. Otherwise it swaps to `#game` and calls `onPlay`.

On any error it returns to the start screen with a readable message.

| Property | What it is |
| --- | --- |
| `shell.mode` | `'off' \| 'camera' \| 'touch'` |
| `shell.tracker` | the tracker, once it exists |
| `shell.video` | the camera `<video>` element |
| `shell.setMessage(text)` | writes under the camera picker |

The picker and pairing themselves are `common/camera.js` and `common/phonelink.js`. The phone page is `common/phone.html`, shared by all games (`arcade/phone.html` and `ride/phone.html` just forward to it). The saved camera choice is shared too.

More options and patterns:

| Need | How |
| --- | --- |
| "Game over, play again?" menu over the last frame, camera kept on | `shell.home('', { keepGame: true })`, then change the start screen's title / text / button label yourself. The arcade games do this. |
| Status messages somewhere else (e.g. the picker is inside a closed Grown-ups box) | Put `<p class="msg kit-msg" role="status"></p>` where you want them; the shell uses it. Pup Rescue Run does this. |
| Custom preview badge text | `badge: (found, tracker) => ['Hands ✓', true]` |
| Your own tracker class | Anything with `kind`, `load()`, `update(now)` and `reset()` works, e.g. a wrapper around `PoseTracker` (see `ride/js/pose.js`). |
| Your own in-game panels (calibrate, pause) | Keep them in the game; the shell only does start ⇄ game. Pose Rider does this. |
| Act only on new camera frames (your own smoothing) | After `tracker.update(now)`, `tracker.fresh` is true on a new frame and `tracker.result` holds MediaPipe's raw result. |

## `common/tracking.js`: MediaPipe

### HandTracker

```js
import { HandTracker } from '../../common/tracking.js';
new HandTracker(video, {
  numHands: 2,
  region: { x0: 0.12, x1: 0.88, y0: 0.08, y1: 0.78 }, // camera area stretched to the full screen (for cursors),
                                                       // so small arms reach the corners. Default: whole picture.
  smoothCursor: { minCutoff: 1.0, beta: 3.0 },         // One Euro filter for the cursor
  smoothLandmarks: { minCutoff: 1.3, beta: 4.0 },      // for all 21 points; false = raw (cheaper if you only need cursors)
  fist: { close: 1.3, open: 1.55 },                    // hysteresis thresholds for `fist`
  lostMs: 300,                                         // keep a hand through short dropouts
  preview: canvasOrNull,                               // the shell passes its preview canvas
});
```

`update(now)` (or `shell.track(now)`) returns one entry per hand:

| Field | Meaning |
| --- | --- |
| `id` | Stable while the hand stays in view. Use it to keep per-hand state (dwell timers, what it holds). |
| `x`, `y` | Cursor (palm centre) in **screen units 0..1, mirrored** (the child moves right, the cursor moves right). Multiply by `innerWidth` / `innerHeight` for px. |
| `fist` | `true` while the hand is closed. Good for grab, draw and press. |
| `open` | How open the hand is: about 1.0 for a fist, 1.8 or more for an open hand. |
| `lm` | 21 smoothed landmarks `{x, y, z}` in **camera units 0..1, not mirrored**. Indices are in `HAND` (`HAND.TIPS`, `HAND.INDEX` …). |
| `raw` | The same landmarks, unsmoothed. |
| `label` | `'Left'` / `'Right'` as MediaPipe reports it. |

### PoseTracker

PoseTracker works the same way for the body:

```js
new PoseTracker(video, { model: 'lite' | 'full', smooth: {...} | false })
```

`update(now)` returns `[{ lm, world, raw }]` (and sets `fresh` / `result` like HandTracker):
- `lm`: 33 points, camera units, not mirrored. Names are in `POSE` (`POSE.L_WRIST`, …).
- `world`: metres, hip-centred.

The shell shows "Loading body tracking…" for it.

### Drawing the camera on a canvas, and matching landmarks to it

```js
const fit = coverFit(video, W, H, 1.15);   // like CSS object-fit: cover, zoomed 15 %
drawVideo(ctx, video, fit, 0.6);           // mirrored, 60 % opacity
const p = toScreen(hand.lm[8], fit);       // index fingertip in screen px, lined up with the picture
const back = toCamera(p, fit);             // inverse (handy in tests)
```

### Other helpers

- `OneEuro`: smooth any value. `new OneEuro(minCutoff, beta).filter(v, timeMs)`. A lower `minCutoff` is steadier when the hand is still; a higher `beta` lags less when it moves fast.
- `HandTracker.openness(lm)` and `HandTracker.palm(lm)`.
- **Frozen video:** when a phone's video stops arriving (track muted), both trackers stop reporting instead of tracking the last frozen frame.
- **Version:** MediaPipe tasks-vision is pinned in `VISION_URL` (1.2.3). Change it there and every game follows.
- **Extra preview drawing:** `afterDraw: (ctx, landmarksList, canvas) => {}` draws on top of the preview skeleton.

## `common/fx.js`: everything else

```js
import { store, createSound, createSpeech, confetti, burst, HandButtons, HandCursors, loop } from '../../common/fx.js';

store.get('game.level', 1); store.set('game.level', 2);       // JSON, never throws

const sound = createSound({ key: 'game.sound' });              // key: remember on/off (optional)
sound.bindButton($('btn-sound'));                              // 🔊/🔇 toggle; speech follows it too
sound.sfx.pop(); sound.sfx.win();                              // press, pop, good, nope, win, star(i)
sound.tone(440, 0.2, { type: 'triangle', slide: 200, at: 0.1, vol: 0.15 });

const speech = createSpeech(sound, { lang: 'en', rate: 0.95, pitch: 1.15 });
speech.say('Find the red balloon!');                           // cancels what was playing
speech.say(['Three!', { text: 'ثلاثة', lang: 'ar', rate: 0.8, fallback: { text: 'səlasə', lang: 'az|tr' } }]);
// 'az|tr' = Azerbaijani voice, else Turkish. speech.voice('ar') tells whether a voice exists.

confetti();                          // falls over the whole screen
burst(x, y, ['✨', '⭐'], 8);         // emoji explosion at screen px; { gentle: true } floats up

const buttons = new HandButtons({ root: $('game'), time: 1.2, fistPress: true });
// buttons with class "hb" fill a gold ring while a hand hovers, then click();
// a fist presses at once (turn off with fistPress: false when a fist means something else).
// data-dwell="1.5" on a button changes its time.
buttons.update(hands.map((h) => ({ id: h.id, x: h.x * innerWidth, y: h.y * innerHeight, fist: h.fist })), dt);

const cursors = new HandCursors();   // ✋ / ✊ pointers that follow the hands
cursors.update(hands);

loop((dt, now) => { … });            // requestAnimationFrame with dt in seconds (max 0.1), errors logged
```

## Look and feel: `common/kit.css`

Re-skin a game by overriding variables in its own `style.css`. Little Chef is the example of a full re-skin.

```css
:root {
  --accent: #ff6b8b; --accent-dark: #d94a6b;   /* main button, title, picker border */
  --alt: #6c8cff; --alt-dark: #4b67d1;         /* second start button (.big.alt) */
  --bg1: #fff4d6; --bg2: #ffe1ec;              /* page gradient */
  --font: "Nunito", system-ui, sans-serif;     /* load it in <head> */
  --title-font: "Lilita One", sans-serif; --title-weight: 400;
}
```

Ready-made themes: the default (light, purple), `<body class="theme-neon">` (dark arcade look: Bubble Pop, Body Blitz,
Neon Dash). Pup Rescue Run (`.pup-theme` in `arcade/style.css`) and Pose Rider (`ride/style.css`) show how to
make another one with the variables, including `--start-bg` for a start screen that sits over a live game scene.

| Class | What it is |
| --- | --- |
| `.big` / `.big.alt` | Start buttons |
| `.tool` | Square white icon button (🏠 🔊) |
| `.pill` | Rounded text button |
| `.go` | Green and pulsing, for "next" |
| `.hb` | Shows the dwell ring |
| `.hidden` | `display: none` |
| `.games-nav` | Row of links to other games under the start screen |
| `.em` / `.ico` | Use the emoji font |

The keyframes `kit-pop`, `kit-pulse`, `kit-bob` and `kit-spin` are available to games too.

## Rules of thumb for these games

The players are 3–5 years old.

- **Reading:** no reading needed. A voice says every instruction, and repeats it after about 10–15 s without progress.
- **Losing:** no losing and no timers. Wrong answers get a gentle "Oops" and another try.
- **Targets:** big targets, at least 100 px. With a camera, map only the middle of the picture to the screen (`region`) so small arms reach the corners.
- **Smoothing:** always smooth the hands; jitter is frustrating. Keep `HandButtons` dwell around 1–1.5 s.
- **Missing hand:** if no hand is seen for about 8 s, say "Show me your hand!"
- **Touch mode:** offer touch / mouse play too where it makes sense (`shell.playTouch()`).
- **Privacy:** the video never leaves the device; say so in the Grown-ups box.
- **Artwork:** don't use characters, names or logos from TV shows. Make original ones.

## Testing

Playwright and Chromium are available in Claude's cloud sessions. To test with a fake camera and a scripted hand:

1. Launch Chromium with `--use-fake-device-for-media-stream --use-fake-ui-for-media-stream`.
2. Grant the `camera` permission.
3. Swap the MediaPipe bundle for a stub with `ctx.route('**/vision_bundle.mjs', …)`. The stub's `HandLandmarker.detectForVideo()` returns `{ landmarks: [[21 points]] }` from `window.__hand`. Remember the camera picture is mirrored: screen x = 1 − camera x.
4. Set `window.__hand` from the test to move the hand.

```js
const stub = `
export class FilesetResolver { static async forVisionTasks() { return {}; } }
export class DrawingUtils { drawConnectors() {} drawLandmarks() {} }
export class HandLandmarker {
  static HAND_CONNECTIONS = [];
  static async createFromOptions() { return new HandLandmarker(); }
  detectForVideo() {
    const h = window.__hand; if (!h) return { landmarks: [] };
    const x = 1 - h.sx, y = h.sy;                    // screen 0..1 -> camera
    const lm = Array.from({ length: 21 }, () => ({ x, y, z: 0 }));
    lm[0] = { x, y: y + 0.05, z: 0 }; lm[9] = { x, y: y - 0.05, z: 0 };
    for (const i of [8, 12, 16, 20]) lm[i] = { x, y: h.fist ? y + 0.02 : y - 0.15, z: 0 };
    return { landmarks: [lm] };
  }
}`;
```

With the default `region` (the whole picture), `{ sx, sy }` are the cursor's screen fractions.
