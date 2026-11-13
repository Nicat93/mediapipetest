# Pose Rider

A browser bike-riding game you steer with your hands. The webcam image is analysed locally with
[MediaPipe Pose Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker),
and the angle between your wrists becomes the handlebar: tilt it like a steering wheel
(right hand down = turn right, left hand down = turn left).

- Third-person view from behind the rider (Three.js)
- Dodge cones, rocks and barriers, collect coins, 3 lives; the speed slowly increases
- Raise both hands above your head on the game-over screen to ride again
- Keyboard (← → / A D) and touch fallback
- Everything runs in the browser; no video leaves the device

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
| `js/main.js` | Game flow (menu → calibrate → countdown → ride → game over), input, sound |
| `js/game.js` | Three.js world, bike + rider model, obstacles, collisions, camera |
| `js/pose.js` | Webcam + MediaPipe Pose Landmarker, wrist angle → steering |

Libraries (Three.js 0.160, MediaPipe tasks-vision 0.10.14) and the pose model load from CDNs, so there is no build step.
Steering sensitivity is set by `DEAD_ZONE_DEG` and `MAX_TILT_DEG` in `js/pose.js`.
