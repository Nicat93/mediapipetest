# Pose Rider & Pose Driver

Two browser games you steer with your hands:

- **Pose Rider** (`index.html`): ride a bike, hands held like gripping handlebars.
- **Pose Driver** (`car.html`): drive an open-top car, hands held on an imaginary steering wheel at 10 and 2.

Each menu links to the other game.

In both games you steer with your hands. The webcam image is analysed locally with
[MediaPipe Pose Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker),
and the angle between your wrists becomes the handlebar: tilt it like a steering wheel
(right hand down = turn right, left hand down = turn left).

- Third-person view from behind, or **first-person (FPV)** from the rider's / driver's eyes (Three.js).
  Switch with the **FPV / 3rd** button in the top-right corner or the **V** key; the choice is remembered.
  In the car's FPV you see the hood, dashboard and the steering wheel turning in the driver's hands.
- **Steering settings** (⚙ button, the menu or the pause screen), saved separately for each game:

  | Setting | Bike default | Car default | What it does |
  | --- | --- | --- | --- |
  | Full turn at | 30° | 45° | Hand tilt that gives a full turn. Lower = more sensitive. |
  | Dead zone | 4° | 3° | Tilts smaller than this count as straight. |
  | Turn speed | 1.00× | 1.00× | How fast you move sideways at full turn (camera, keyboard and touch). |
  | Responsiveness | 9 | 7 | How quickly steering follows your hands. Lower is smoother. |

  The panel shows your live hand tilt and the resulting steering while the camera is on.
- Dodge cones, rocks and barriers, collect coins, 3 lives; the speed slowly increases
- Raise both hands above your head on the game-over screen to ride again
- **Use your phone as the camera** over Wi-Fi (WebRTC), handy when the PC has no webcam
- Keyboard (← → / A D) and touch fallback
- Everything runs in the browser; video is never uploaded to a server

## Phone as webcam

1. On the computer open the game and click **Use phone as camera**. A QR code and a 6-letter code appear.
2. Scan the QR code with the phone (or open `…/mediapipetest/ride/phone.html` and type the code).
3. Allow camera access on the phone and prop it up 1.5–2 m away, facing you. **Switch camera** toggles front/back.
4. The computer starts the handlebar calibration as soon as the video arrives.

How it works: the phone page (`phone.html`) sends its camera stream to the game page with WebRTC.
[PeerJS](https://peerjs.com/)'s free public server (`0.peerjs.com`) is only used to exchange connection details
(the pairing code and network addresses); the video itself travels directly between the two devices.

Notes:
- Both devices should be on the same Wi-Fi. Guest or corporate networks that isolate clients can block the
  direct connection; no TURN relay is configured.
- Phones only allow camera access on https pages, so pair through the GitHub Pages URL rather than a local server.
- If the phone disconnects, the game pauses and shows the code again; reopen the link or tap **Reconnect** on the phone.

## Play on GitHub Pages

1. In the repository go to **Settings → Pages**.
2. Under **Build and deployment**, choose **Deploy from a branch**, branch **main**, folder **/ (root)**, then **Save**.
3. After a minute the games are live at `https://<your-user>.github.io/mediapipetest/` (this folder is `…/mediapipetest/ride/`).

GitHub Pages serves over HTTPS, which browsers require for camera access.

## Run locally

Any static file server works, e.g.

```sh
python3 -m http.server 8000
```

from the repository root, then open http://localhost:8000/ride/ (camera access is allowed on `localhost`).

## Files

| File | Purpose |
| --- | --- |
| `index.html`, `car.html`, `style.css` | Bike and car pages (`<body data-vehicle>` picks the vehicle), HUD and menus |
| `js/main.js` | Game flow (menu → calibrate → countdown → ride → game over), input, sound, view toggle, steering settings |
| `js/game.js` | Three.js world, bike/car models and per-vehicle tuning (`VEHICLES`), obstacles, collisions, chase and first-person cameras |
| `js/pose.js` | Video source (webcam or phone stream) + MediaPipe Pose Landmarker, wrist angle → steering |
| `js/phonelink.js` | PC side of the phone link: pairing code, QR code, receiving the WebRTC stream |
| `phone.html`, `phone.css`, `js/phone.js` | Phone side: opens the camera and streams it to the PC |

Libraries (Three.js 0.160, MediaPipe tasks-vision 0.10.14, PeerJS 1.5.4, qrcode-generator 1.4.4) and the pose model load from CDNs, so there is no build step.
Steering defaults per game are in `DEFAULTS` in `js/main.js`; players change them in the steering settings panel.
