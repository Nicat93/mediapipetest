# MediaPipe Games

Browser games controlled with your body and hands, using [MediaPipe](https://ai.google.dev/edge/mediapipe/solutions/guide)
tracking that runs entirely in the browser. The root `index.html` is a menu that links to each game.

| Folder | Game | Controls |
| --- | --- | --- |
| [`ride/`](ride/) | **Pose Rider** (bike, `ride/index.html`) and **Pose Driver** (car, `ride/car.html`) | Pose tracking: tilt your hands like handlebars / a steering wheel. Phone-as-camera over Wi-Fi. Keyboard and touch fallback. See [`ride/README.md`](ride/README.md). |
| [`cooking/`](cooking/) | **Little Chef**, a cooking game for 3–5 year olds | Hand tracking: make a fist over food to grab it, open the hand over the pot to drop it in (or just hover), wave to cook. PC webcam or phone over Wi-Fi. Touch / mouse: drag or tap. |
| [`shapes/`](shapes/) | **Copy My Hands**, a hand-shape copying game for 3+ year olds | Hand tracking: make the shape the ghost hand shows and hold it. One hand and easy shapes first, then tilted hands, two hands, and two different shapes at different heights. PC webcam or phone over Wi-Fi. See [`shapes/README.md`](shapes/README.md). |
| [`arabic/`](arabic/) | **Ərəbcə Rəqəmlər** (Arabic numbers), for Azerbaijani-speaking 3–6 year olds | Hand tracking: count the objects, then make a fist to write the Arabic digit (open hand = pen up). PC webcam or phone over Wi-Fi. Touch / mouse too. See [`arabic/README.md`](arabic/README.md). |
| [`arcade/`](arcade/) | **Bubble Pop** (`arcade/bubble-pop.html`), **Body Blitz** (`arcade/body-blitz.html`) and **Neon Dash** (`arcade/neon-dash.html`), **Pup Rescue Run** (`arcade/pup-rescue.html`) | Bubble Pop: hand tracking, pop bubbles with your hands. Body Blitz, Neon Dash and Pup Rescue Run: full-body pose tracking (hit targets, dodge, switch lanes, squat). PC webcam or phone over Wi-Fi. See [`arcade/README.md`](arcade/README.md). |

## Adding a game

Copy [`template/`](template/) (a small working game, *Star Catcher*) to a new folder and follow
[`docs/NEW_GAME.md`](docs/NEW_GAME.md). The shared code in [`common/`](common/) already does the boring parts:

| File | What it gives you |
| --- | --- |
| `common/kit.css` | The look: start screen, big buttons, camera picker, Grown-ups box, tool buttons, hand-dwell rings, loading overlay, camera preview, confetti. Re-skin with CSS variables; `theme-neon` is the dark arcade look. |
| `common/shell.js` | `createShell()`: start screen ⇄ game, camera picker (PC or phone over Wi‑Fi), loading, waiting for the phone, error messages, loading MediaPipe. Uses `camera.js`, `phonelink.js` and the phone page `phone.html`. |
| `common/tracking.js` | `HandTracker` / `PoseTracker`: MediaPipe models, One Euro smoothing, stable hand ids, cursors, fist detection; helpers to draw the mirrored camera on a canvas. |
| `common/fx.js` | Sound on/off, beeps, a talking voice (any language), confetti, emoji bursts, buttons pressed by holding a hand over them, hand pointers, the frame loop, saved settings. |

Every game uses it, so all menus look alike and share one camera picker and phone page (`common/phone.html`).
Add a card for the new game in the root `index.html` and a row in the table above.

## Play on GitHub Pages

1. In the repository go to **Settings → Pages**.
2. Under **Build and deployment**, choose **Deploy from a branch**, branch **main**, folder **/ (root)**, then **Save**.
3. After a minute the menu is live at `https://<your-user>.github.io/mediapipetest/`.

GitHub Pages serves over HTTPS, which browsers require for camera access.

## Run locally

From the repository root:

```sh
python3 -m http.server 8000
```

then open http://localhost:8000 (camera access is allowed on `localhost`).

## Little Chef

Made for a 4-year-old: no reading, no timers, no way to lose.

- A friendly voice (the browser's speech synthesis) says what to do: "Let's make pizza! First, the tomato."
- The recipe card at the top shows the dish and the four foods it needs; each gets a ✓ when it's in.
- The shelf at the bottom has those four foods plus two that don't belong. A wrong one gets a gentle
  "Oops!" and goes back to the shelf.
- When everything is in, wave a hand over the dish (or rub it with a finger) to bake / stir / mix it.
  A ring fills up, then the finished dish pops up with confetti and goes into the sticker row.
- A stuck child gets help: after a few seconds the right food wiggles, and the voice repeats the request.
- Six recipes in a loop: pizza, vegetable soup, smoothie, pancakes, salad and fruit salad.

With the camera, the middle part of the image is mapped to the whole screen so small arms reach every corner,
and both hands can be used. Making a fist over a food grabs it at once; opening the hand lets go (over the pot
it goes in, anywhere else it goes back to the shelf). Buttons press with a fist, or by hovering about a second.
Two switches under **Settings** on the start screen (both on by default, remembered):
- *Auto grab*: holding an open hand over a food for about half a second picks it up too.
- *Auto release*: food drops into the pot as soon as it reaches it. When off, a fist must open over the pot,
  and food picked up by hovering goes in after holding still over the pot for about half a second.
To use a phone as the camera, use the **Camera** picker on the start screen, pick *Phone (Wi‑Fi)* and scan the QR code
(the shared phone page, `common/phone.html`); the game starts as soon as the phone connects.

Files: `cooking/index.html`, `cooking/style.css`, `cooking/js/main.js` (game). Hand tracking and the
start screen / camera flow come from `common/` (see below).
