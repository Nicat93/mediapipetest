# MediaPipe Games

Browser games controlled with your body and hands, using [MediaPipe](https://ai.google.dev/edge/mediapipe/solutions/guide)
tracking that runs entirely in the browser. The root `index.html` is a menu that links to each game.

| Folder | Game | Controls |
| --- | --- | --- |
| [`ride/`](ride/) | **Pose Rider** (bike, `ride/index.html`) and **Pose Driver** (car, `ride/car.html`) | Pose tracking: tilt your hands like handlebars / a steering wheel. Phone-as-camera over Wi-Fi. Keyboard and touch fallback. See [`ride/README.md`](ride/README.md). |
| [`cooking/`](cooking/) | **Little Chef**, a cooking game for 3–5 year olds | Hand tracking: hold a hand over food to pick it up, move it to the pot, wave to cook. Touch / mouse: drag or tap. |
| [`arcade/`](arcade/) | **Bubble Pop** (`arcade/bubble-pop.html`), **Body Blitz** (`arcade/body-blitz.html`) and **Neon Dash** (`arcade/neon-dash.html`) | Bubble Pop: hand tracking, pop bubbles with your hands. Body Blitz and Neon Dash: full-body pose tracking (hit targets, dodge, switch lanes, squat). PC webcam or phone over Wi-Fi. See [`arcade/README.md`](arcade/README.md). |

## Adding a game

Create a new folder with its own `index.html` (keep paths relative so it works under `/mediapipetest/<folder>/`),
then add a card for it in the root `index.html` and a row in the table above.

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
and both hands can be used. Picking up takes holding the hand over a food for about half a second; buttons
need about a second. Grown-ups can still help with the mouse or touch at the same time.

Files: `cooking/index.html`, `cooking/style.css`, `cooking/js/main.js` (game), `cooking/js/hands.js`
(webcam + MediaPipe Hand Landmarker → hand cursors).
