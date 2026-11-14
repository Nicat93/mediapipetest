// Camera (PC or phone, via ../arcade/js/camera.js) + MediaPipe Hand Landmarker
// -> up to two smoothed on-screen hand cursors, each with a "fist" flag.
//
// Smoothing uses a One Euro filter: strong when the hand is nearly still (no
// jitter while aiming or writing slowly), light when it moves fast (no lag).
import {
  HandLandmarker,
  FilesetResolver,
  DrawingUtils,
} from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs';

const WASM_PATH = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

// Only the middle part of the camera image maps to the whole screen, so small
// arms reach every corner without leaning out of view.
const REGION = { x0: 0.15, x1: 0.85, y0: 0.1, y1: 0.75 };
const PALM = [0, 5, 9, 13, 17];
const TIPS = [8, 12, 16, 20];
const LOST_MS = 400; // keep a cursor alive through brief tracking dropouts
// Fist: fingertips' distance from the wrist in palm lengths. Open ≈ 1.8+, fist ≈ 1.0.
const FIST_CLOSE = 1.3;
const FIST_OPEN = 1.55;

const clamp01 = (v) => Math.max(0, Math.min(1, v));

/** One Euro filter (Casiez et al. 2012) for one value. */
class OneEuro {
  constructor(minCutoff, beta, dCutoff = 1.0) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
    this.x = null;
    this.dx = 0;
    this.t = 0;
  }
  static alpha(cutoff, dt) {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }
  filter(v, t) {
    if (this.x === null) {
      this.x = v;
      this.t = t;
      return v;
    }
    const dt = Math.max(1e-3, (t - this.t) / 1000);
    this.t = t;
    const dv = (v - this.x) / dt;
    this.dx += (dv - this.dx) * OneEuro.alpha(this.dCutoff, dt);
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
    this.x += (v - this.x) * OneEuro.alpha(cutoff, dt);
    return this.x;
  }
}

// Tuned for screen-normalised units (0..1 per screen): still hand -> ~1 Hz
// cutoff (very steady), a quick sweep across the screen -> ~5 Hz.
const SMOOTH = { minCutoff: 1.0, beta: 3.0 };

export class HandTracker {
  constructor(video, canvas) {
    this.video = video;
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.draw = new DrawingUtils(this.ctx);
    this.landmarker = null;
    this.lastVideoTime = -1;
    /** @type {{id:number, x:number, y:number, seen:number, fist:boolean, open:number}[]} 0..1 screen coords */
    this.cursors = [];
    this.nextId = 1;
  }

  /** Opens the chosen camera and loads the model. Resolves false while waiting for the phone. */
  async start(camera, onStatus = () => {}) {
    onStatus(camera.usingPhone() ? 'Telefona qoşulur…' : 'Kamera açılır…');
    const model = this.loadModel();
    const ready = await camera.start();
    onStatus('Əl izləmə yüklənir…');
    await model;
    return ready;
  }

  stop(camera) {
    camera?.stop();
    this.cursors = [];
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

  /** Runs detection on the newest video frame and returns the cursors. */
  update(now) {
    const v = this.video;
    if (this.landmarker && v.srcObject && v.readyState >= 2 && v.currentTime !== this.lastVideoTime) {
      this.lastVideoTime = v.currentTime;
      if (v.videoWidth && this.canvas.width !== v.videoWidth) {
        this.canvas.width = v.videoWidth;
        this.canvas.height = v.videoHeight;
      }
      const result = this.landmarker.detectForVideo(v, now);
      const hands = result.landmarks || [];
      const aspect = v.videoWidth && v.videoHeight ? v.videoWidth / v.videoHeight : 4 / 3;
      this.match(hands.map((lm) => ({ ...this.palmPoint(lm), open: this.openness(lm, aspect) })), now);
      this.render(hands);
    }
    this.cursors = this.cursors.filter((c) => now - c.seen < LOST_MS);
    return this.cursors;
  }

  palmPoint(lm) {
    let x = 0;
    let y = 0;
    for (const i of PALM) {
      x += lm[i].x;
      y += lm[i].y;
    }
    x /= PALM.length;
    y /= PALM.length;
    // Mirror so moving your right hand moves the cursor right.
    return {
      x: clamp01((1 - x - REGION.x0) / (REGION.x1 - REGION.x0)),
      y: clamp01((y - REGION.y0) / (REGION.y1 - REGION.y0)),
    };
  }

  openness(lm, aspect) {
    const d = (a, b) => Math.hypot((a.x - b.x) * aspect, a.y - b.y);
    const palm = Math.max(d(lm[0], lm[9]), 1e-4);
    let sum = 0;
    for (const i of TIPS) sum += d(lm[i], lm[0]);
    return sum / TIPS.length / palm;
  }

  /** Keeps cursor identities stable by pairing each new point with the nearest old cursor. */
  match(points, now) {
    const free = [...this.cursors];
    for (const p of points) {
      let best = null;
      let bestD = 0.35;
      for (const c of free) {
        const d = Math.hypot(c.rawX - p.x, c.rawY - p.y);
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
      if (best) {
        free.splice(free.indexOf(best), 1);
        best.open += (p.open - best.open) * 0.5;
      } else {
        best = {
          id: this.nextId++, x: p.x, y: p.y, open: p.open, fist: false,
          fx: new OneEuro(SMOOTH.minCutoff, SMOOTH.beta), fy: new OneEuro(SMOOTH.minCutoff, SMOOTH.beta),
        };
        this.cursors.push(best);
      }
      best.rawX = p.x;
      best.rawY = p.y;
      best.x = best.fx.filter(p.x, now);
      best.y = best.fy.filter(p.y, now);
      best.seen = now;
      if (best.fist ? best.open > FIST_OPEN : best.open < FIST_CLOSE) best.fist = !best.fist;
    }
  }

  render(hands) {
    const { ctx, canvas } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const lm of hands) {
      this.draw.drawConnectors(lm, HandLandmarker.HAND_CONNECTIONS, { color: '#ffffff', lineWidth: 4 });
      this.draw.drawLandmarks(lm, { radius: 3, color: '#ff8fab', lineWidth: 1 });
    }
  }
}
