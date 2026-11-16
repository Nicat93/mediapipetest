// Camera (PC or phone, via ../arcade/js/camera.js) + MediaPipe Hand Landmarker
// -> up to two hands, each with all 21 landmarks smoothed by a One Euro filter
// (steady when the hand holds still, no lag when it moves).
import {
  HandLandmarker,
  FilesetResolver,
} from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs';

const WASM_PATH = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

const LOST_MS = 300;
// Camera-normalised units: still hand -> ~1.3 Hz cutoff, fast move -> much higher.
const SMOOTH = { minCutoff: 1.3, beta: 4.0 };

class OneEuro {
  constructor(minCutoff, beta, dCutoff = 1.0) {
    Object.assign(this, { minCutoff, beta, dCutoff, x: null, dx: 0, t: 0 });
  }
  static alpha(cutoff, dt) {
    return 1 / (1 + 1 / (2 * Math.PI * cutoff) / dt);
  }
  filter(v, t) {
    if (this.x === null) {
      this.x = v;
      this.t = t;
      return v;
    }
    const dt = Math.max(1e-3, (t - this.t) / 1000);
    this.t = t;
    this.dx += ((v - this.x) / dt - this.dx) * OneEuro.alpha(this.dCutoff, dt);
    this.x += (v - this.x) * OneEuro.alpha(this.minCutoff + this.beta * Math.abs(this.dx), dt);
    return this.x;
  }
}

export class HandTracker {
  constructor(video) {
    this.video = video;
    this.landmarker = null;
    this.lastVideoTime = -1;
    /** @type {{id:number, lm:{x:number,y:number}[], seen:number}[]} camera-normalised, not mirrored */
    this.hands = [];
    this.nextId = 1;
  }

  /** Opens the chosen camera and loads the model. Resolves false while waiting for the phone. */
  async start(camera, onStatus = () => {}) {
    onStatus(camera.usingPhone() ? 'Connecting to the phone…' : 'Opening the camera…');
    const model = this.loadModel();
    const ready = await camera.start();
    onStatus('Loading hand tracking…');
    await model;
    return ready;
  }

  stop(camera) {
    camera?.stop();
    this.hands = [];
  }

  loadModel() {
    this.modelPromise ||= FilesetResolver.forVisionTasks(WASM_PATH).then(async (fileset) => {
      const options = (delegate) => ({
        baseOptions: { modelAssetPath: MODEL_URL, delegate },
        runningMode: 'VIDEO',
        numHands: 2,
        minHandDetectionConfidence: 0.5,
        minHandPresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });
      try {
        this.landmarker = await HandLandmarker.createFromOptions(fileset, options('GPU'));
      } catch (err) {
        console.warn('GPU delegate unavailable, falling back to CPU', err);
        this.landmarker = await HandLandmarker.createFromOptions(fileset, options('CPU'));
      }
    });
    return this.modelPromise;
  }

  update(now) {
    const v = this.video;
    if (this.landmarker && v.srcObject && v.readyState >= 2 && v.currentTime !== this.lastVideoTime) {
      this.lastVideoTime = v.currentTime;
      const result = this.landmarker.detectForVideo(v, now);
      this.match(result.landmarks || [], now);
    }
    this.hands = this.hands.filter((h) => now - h.seen < LOST_MS);
    return this.hands;
  }

  /** Pairs each detected hand with the nearest known hand (by wrist and middle knuckle). */
  match(detected, now) {
    const free = [...this.hands];
    for (const lm of detected) {
      const cx = (lm[0].x + lm[9].x) / 2;
      const cy = (lm[0].y + lm[9].y) / 2;
      let best = null;
      let bestD = 0.25;
      for (const h of free) {
        const d = Math.hypot(h.cx - cx, h.cy - cy);
        if (d < bestD) {
          bestD = d;
          best = h;
        }
      }
      if (best) free.splice(free.indexOf(best), 1);
      else {
        best = {
          id: this.nextId++,
          f: lm.map(() => [new OneEuro(SMOOTH.minCutoff, SMOOTH.beta), new OneEuro(SMOOTH.minCutoff, SMOOTH.beta)]),
        };
        this.hands.push(best);
      }
      best.cx = cx;
      best.cy = cy;
      best.seen = now;
      best.lm = lm.map((p, i) => ({ x: best.f[i][0].filter(p.x, now), y: best.f[i][1].filter(p.y, now) }));
    }
  }
}
