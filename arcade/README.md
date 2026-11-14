# MP Arcade

Three fast camera games: Bubble Pop (hands), Body Blitz and Neon Dash (full body).

| Page | Game | Tracking |
| --- | --- | --- |
| `bubble-pop.html` | **Bubble Pop**: pop as many bubbles as you can with your hands in 60 seconds. | MediaPipe Hand Landmarker (2 hands) |
| `body-blitz.html` | **Body Blitz**: hit blue targets with your hands, orange ones with your feet, and duck under red lasers. | MediaPipe Pose Landmarker (full) |
| `neon-dash.html` | **Neon Dash**: an endless runner. Step left or right to switch lanes, squat under gates, grab coins. | MediaPipe Pose Landmarker (full) |

Stand 2–3 m back for the full-body games so your whole body is in view.

Body Blitz and Neon Dash have a **Lives** picker on the start screen: 1, 2, 3 (default), 5, 10 or ∞ infinite.
The choice is remembered separately for each game. Bubble Pop is a 60-second round, so it has no lives.

## Camera

Pick the camera on each game's start screen; the choice is shared by all three games.

- **PC camera**: any webcam the browser sees, including phone-as-USB-webcam apps.
- **Phone (Wi‑Fi)**: a QR code and a 6-letter code appear. Scan the QR code with the phone (or open
  `…/arcade/phone.html` and type the code), allow the camera and prop the phone up facing you.
  The video goes straight from phone to PC over WebRTC. The free PeerJS server is only used to exchange
  connection details, so both devices need internet access and the same Wi‑Fi network.

## Files

- `bubble-pop.html`, `body-blitz.html`, `neon-dash.html`, `style.css`: game pages
- `js/bubble-pop.js`, `js/body-blitz.js`, `js/neon-dash.js`: the games
- `js/camera.js`: camera picker shared by the games (PC cameras + phone)
- `js/phonelink.js`, `phone.html`, `phone.css`, `js/phone.js`: phone-as-camera pairing (same approach as `ride/`)

MediaPipe (`@mediapipe/tasks-vision` 1.2.3) and the models load from CDNs, so no build step is needed.

These games started as a Vite project with a dev-server relay for the phone link. Here they are plain
static files so they run on GitHub Pages like the other games.
