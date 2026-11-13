# Pose Rider

A browser bike-riding game you steer with your hands. The webcam image is analysed locally with
[MediaPipe Pose Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker),
and the angle between your wrists becomes the handlebar: tilt it like a steering wheel
(right hand down = turn right, left hand down = turn left).

- Third-person view from behind the rider, or **first-person (FPV)** from the rider's eyes (Three.js).
  Switch with the **FPV / 3rd** button in the top-right corner or the **V** key; the choice is remembered.
- Dodge cones, rocks and barriers, collect coins, 3 lives; the speed slowly increases
- Raise both hands above your head on the game-over screen to ride again
- **Use your phone as the camera** over Wi-Fi (WebRTC), handy when the PC has no webcam
- Keyboard (← → / A D) and touch fallback
- Everything runs in the browser; video is never uploaded to a server

## Phone as webcam

1. On the computer open the game and click **Use phone as camera**. A QR code and a 6-letter code appear.
2. Scan the QR code with the phone (or open `…/mediapipetest/phone.html` and type the code).
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
3. After a minute the game is live at `https://<your-user>.github.io/mediapipetest/`.

GitHub Pages serves over HTTPS, which browsers require for camera access.

## Run locally

Any static file server works, e.g.

```sh
python3 -m http.server 8000
```

then open http://localhost:8000 (camera access is allowed on `localhost`).

## Files

| File | Purpose |
| --- | --- |
| `index.html`, `style.css` | Page, HUD and menus |
| `js/main.js` | Game flow (menu → calibrate → countdown → ride → game over), input, sound, view toggle |
| `js/game.js` | Three.js world, bike + rider model, obstacles, collisions, chase and first-person cameras |
| `js/pose.js` | Video source (webcam or phone stream) + MediaPipe Pose Landmarker, wrist angle → steering |
| `js/phonelink.js` | PC side of the phone link: pairing code, QR code, receiving the WebRTC stream |
| `phone.html`, `phone.css`, `js/phone.js` | Phone side: opens the camera and streams it to the PC |

Libraries (Three.js 0.160, MediaPipe tasks-vision 0.10.14, PeerJS 1.5.4, qrcode-generator 1.4.4) and the pose model load from CDNs, so there is no build step.
Steering sensitivity is set by `DEAD_ZONE_DEG` and `MAX_TILT_DEG` in `js/pose.js`.
