// Webcam + MediaPipe Hand Landmarker -> up to two on-screen hand cursors.
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
const REGION = { x0: 0.12, x1: 0.88, y0: 0.08, y1: 0.78 };
const PALM = [0, 5, 9, 13, 17];
const LOST_MS = 300; // keep a cursor alive through brief tracking dropouts

const clamp01 = (v) => Math.max(0, Math.min(1, v));

export class HandTracker {
  constructor(video, canvas) {
    this.video = video;
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.draw = new DrawingUtils(this.ctx);
    this.landmarker = null;
    this.lastVideoTime = -1;
    /** @type {{id:number, x:number, y:number, seen:number}[]} normalised 0..1 screen coords */
    this.cursors = [];
    this.nextId = 1;
  }

  /**
   * Opens the camera chosen in the shared picker (PC camera or phone over Wi-Fi,
   * see ../arcade/js/camera.js) and loads the model. Resolves false while we're
   * still waiting for the phone to connect.
   */
  async start(camera, onStatus = () => {}) {
    onStatus(camera.usingPhone() ? 'Connecting to the phone…' : 'Asking for the camera…');
    const model = this.loadModel();
    const ready = await camera.start();
    onStatus('Loading hand tracking…');
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

  /** Run detection on the newest video frame and update `cursors`. */
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
      this.match(hands.map((lm) => this.palmPoint(lm)), now);
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

  /** Keep cursor identities stable by pairing each new point with the nearest old cursor. */
  match(points, now) {
    const free = [...this.cursors];
    for (const p of points) {
      let best = null;
      let bestD = 0.35;
      for (const c of free) {
        const d = Math.hypot(c.x - p.x, c.y - p.y);
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
      if (best) {
        free.splice(free.indexOf(best), 1);
        // Light smoothing: steady but still responsive.
        best.x += (p.x - best.x) * 0.6;
        best.y += (p.y - best.y) * 0.6;
        best.seen = now;
      } else {
        this.cursors.push({ id: this.nextId++, x: p.x, y: p.y, seen: now });
      }
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
