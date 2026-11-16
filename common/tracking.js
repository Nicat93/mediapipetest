// MediaPipe in one place: hand and body (pose) trackers with smoothing,
// stable hand identities, cursors and fist detection, plus helpers to put the
// (mirrored) camera picture on a canvas.
//
//   import { HandTracker } from '../common/tracking.js';
//   const tracker = new HandTracker(video, { numHands: 2 });
//   await tracker.load();                 // the shell (shell.js) does this for you
//   const hands = tracker.update(performance.now());   // call every frame
//
// The MediaPipe bundle is imported lazily in load(), so a page still opens
// (and touch play still works) when the CDN is unreachable.
// See docs/NEW_GAME.md for the coordinate systems and every option.

export const VISION_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.3';
export const MODELS = {
  hand: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
  poseLite: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
  poseFull: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task',
};

/** Hand landmark indices (MediaPipe numbering). */
export const HAND = {
  WRIST: 0,
  THUMB: [1, 2, 3, 4],
  INDEX: [5, 6, 7, 8],
  MIDDLE: [9, 10, 11, 12],
  RING: [13, 14, 15, 16],
  PINKY: [17, 18, 19, 20],
  TIPS: [4, 8, 12, 16, 20],
  PALM: [0, 5, 9, 13, 17],
};
/** Pose landmark indices (MediaPipe numbering). */
export const POSE = {
  NOSE: 0, L_SHOULDER: 11, R_SHOULDER: 12, L_ELBOW: 13, R_ELBOW: 14, L_WRIST: 15, R_WRIST: 16,
  L_HIP: 23, R_HIP: 24, L_KNEE: 25, R_KNEE: 26, L_ANKLE: 27, R_ANKLE: 28,
};

const clamp01 = (v) => Math.max(0, Math.min(1, v));

/**
 * One Euro filter (Casiez et al. 2012) for one value: strong smoothing while
 * the value is nearly still (no jitter), light while it moves fast (no lag).
 * minCutoff: lower = steadier when still. beta: higher = less lag when moving.
 */
export class OneEuro {
  constructor(minCutoff = 1, beta = 3, dCutoff = 1) {
    Object.assign(this, { minCutoff, beta, dCutoff, x: null, dx: 0, t: 0 });
  }
  static alpha(cutoff, dt) {
    return 1 / (1 + 1 / (2 * Math.PI * cutoff) / dt);
  }
  /** v: new value, t: time in ms. Returns the smoothed value. */
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

/** Smooths a list of {x, y, z?} points (one filter per coordinate). */
class PointSmoother {
  constructor({ minCutoff, beta }) {
    this.opts = [minCutoff, beta];
    this.f = [];
  }
  filter(points, t) {
    return points.map((p, i) => {
      const f = (this.f[i] ||= [new OneEuro(...this.opts), new OneEuro(...this.opts), new OneEuro(...this.opts)]);
      const q = { ...p, x: f[0].filter(p.x, t), y: f[1].filter(p.y, t) };
      if (p.z !== undefined) q.z = f[2].filter(p.z, t);
      return q;
    });
  }
}

const cache = new Map();
/** Loads a MediaPipe vision task once (GPU first, CPU if the GPU path fails). */
function createTask(kind, options) {
  const key = kind + JSON.stringify(options);
  if (!cache.has(key)) {
    cache.set(key, (async () => {
      const vision = await import(`${VISION_URL}/vision_bundle.mjs`);
      const fileset = await vision.FilesetResolver.forVisionTasks(`${VISION_URL}/wasm`);
      const Task = vision[kind];
      const make = (delegate) => Task.createFromOptions(fileset, {
        ...options,
        baseOptions: { ...options.baseOptions, delegate },
        runningMode: 'VIDEO',
      });
      try {
        return { task: await make('GPU'), vision };
      } catch (err) {
        console.warn('GPU delegate unavailable, falling back to CPU', err);
        return { task: await make('CPU'), vision };
      }
    })());
    cache.get(key).catch(() => cache.delete(key)); // let a later attempt retry
  }
  return cache.get(key);
}

/** Shared part of the trackers: load once, run detection once per new video frame. */
class Tracker {
  constructor(video, kind) {
    this.video = video;
    this.kind = kind; // 'hands' | 'pose', the shell uses it for the loading text
    this.task = null;
    this.lastVideoTime = -1;
  }
  /** Loads the model. Safe to call many times. */
  async load() {
    if (this.task) return;
    const { task, vision } = await createTask(this.taskName, this.taskOptions());
    this.task = task;
    this.vision = vision;
  }
  /**
   * Runs the model on the newest frame. Returns the raw result, or null when there is no new frame.
   * Afterwards `fresh` says whether this frame had new results and `result` is the latest raw result.
   */
  detect(now) {
    this.fresh = false;
    const v = this.video;
    if (!this.task || !v.srcObject || v.readyState < 2) return null;
    // A phone's video track goes "muted" when its frames stop arriving: don't keep
    // tracking the last frozen frame (results expire after lostMs instead).
    const track = v.srcObject.getVideoTracks?.()[0];
    if (track && (track.muted || track.readyState === 'ended')) return null;
    if (v.currentTime === this.lastVideoTime) return null;
    this.lastVideoTime = v.currentTime;
    this.result = this.task.detectForVideo(v, now);
    this.fresh = true;
    return this.result;
  }
  /** Draws the skeletons on the preview canvas (if there is one). */
  paint(lms, taskName, connections) {
    const cv = this.preview;
    if (!cv) return;
    const v = this.video;
    if (v.videoWidth && cv.width !== v.videoWidth) {
      cv.width = v.videoWidth;
      cv.height = v.videoHeight;
    }
    const ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, cv.width, cv.height);
    const DrawingUtils = this.vision?.DrawingUtils;
    if (DrawingUtils) {
      this.drawer ||= new DrawingUtils(ctx);
      for (const lm of lms) {
        this.drawer.drawConnectors(lm, this.vision[taskName][connections] || [], { color: '#ffffff', lineWidth: 4 });
        this.drawer.drawLandmarks(lm, { radius: 3, color: '#ff8fab', lineWidth: 1 });
      }
    }
    this.afterDraw?.(ctx, lms, cv);
  }

  /** Video aspect ratio (width / height), so distances can be measured in square units. */
  aspect() {
    const v = this.video;
    return v.videoWidth && v.videoHeight ? v.videoWidth / v.videoHeight : 4 / 3;
  }
}

/**
 * Up to `numHands` hands, each:
 *   id      stable while the hand stays in view
 *   lm      21 landmarks {x, y, z}, camera-normalised 0..1, NOT mirrored (smoothed unless smoothLandmarks: false)
 *   raw     the same landmarks unsmoothed
 *   x, y    cursor: palm centre in screen units 0..1, mirrored (move right hand right -> cursor right),
 *           with `region` of the camera stretched to the whole screen, One-Euro smoothed
 *   open    fingertip distance from the wrist in palm lengths (open hand ≈ 1.8+, fist ≈ 1.0)
 *   fist    true while the hand is closed (with hysteresis so it doesn't flicker)
 *   label   'Left' | 'Right' as MediaPipe reports it
 *   seen    time (ms) it was last detected; a hand survives `lostMs` of dropout
 */
export class HandTracker extends Tracker {
  constructor(video, {
    numHands = 2,
    region = { x0: 0, x1: 1, y0: 0, y1: 1 }, // camera area mapped onto the whole screen for cursors
    smoothCursor = { minCutoff: 1.0, beta: 3.0 }, // in screen units
    smoothLandmarks = { minCutoff: 1.3, beta: 4.0 }, // in camera units; false = raw landmarks
    fist = { close: 1.3, open: 1.55 }, // `open` below close -> fist, above open -> open hand
    lostMs = 300,
    matchDist = 0.25, // max palm movement between frames (camera units) to keep the same id
    confidence = 0.5,
    preview = null, // optional <canvas> over a video preview: draws the hand skeletons
    afterDraw = null, // (ctx, landmarksList, canvas) => {} extra drawing on the preview
  } = {}) {
    super(video, 'hands');
    this.taskName = 'HandLandmarker';
    Object.assign(this, { numHands, region, smoothCursor, smoothLandmarks, fist, lostMs, matchDist, confidence, preview, afterDraw });
    this.hands = [];
    this.nextId = 1;
  }

  taskOptions() {
    const c = this.confidence;
    return {
      baseOptions: { modelAssetPath: MODELS.hand },
      numHands: this.numHands,
      minHandDetectionConfidence: c,
      minHandPresenceConfidence: c,
      minTrackingConfidence: c,
    };
  }

  /** Call every frame. Returns the current hands (see the class comment). */
  update(now) {
    const result = this.detect(now);
    if (result) {
      const lms = result.landmarks || [];
      this.match(lms, result.handednesses || result.handedness || [], now);
      this.drawPreview(lms);
    }
    this.hands = this.hands.filter((h) => now - h.seen < this.lostMs);
    return this.hands;
  }

  /** Forget all hands (e.g. when leaving the game). */
  reset() {
    this.hands = [];
    this.preview?.getContext('2d').clearRect(0, 0, this.preview.width, this.preview.height);
  }

  /** Palm centre in camera units. */
  static palm(lm) {
    let x = 0;
    let y = 0;
    for (const i of HAND.PALM) {
      x += lm[i].x;
      y += lm[i].y;
    }
    return { x: x / HAND.PALM.length, y: y / HAND.PALM.length };
  }

  /** Fingertip distance from the wrist, in palm lengths (small = fist). */
  static openness(lm, aspect = 4 / 3) {
    const d = (a, b) => Math.hypot((a.x - b.x) * aspect, a.y - b.y);
    const palm = Math.max(d(lm[0], lm[9]), 1e-4);
    let sum = 0;
    for (const i of [8, 12, 16, 20]) sum += d(lm[i], lm[0]);
    return sum / 4 / palm;
  }

  /** Camera point -> mirrored screen units 0..1 through `region`. */
  toCursor(p) {
    const r = this.region;
    return { x: clamp01((1 - p.x - r.x0) / (r.x1 - r.x0)), y: clamp01((p.y - r.y0) / (r.y1 - r.y0)) };
  }

  match(detected, handedness, now) {
    const free = [...this.hands];
    const aspect = this.aspect();
    detected.forEach((raw, k) => {
      const palm = HandTracker.palm(raw);
      let best = null;
      let bestD = this.matchDist;
      for (const h of free) {
        const d = Math.hypot(h.palm.x - palm.x, h.palm.y - palm.y);
        if (d < bestD) {
          bestD = d;
          best = h;
        }
      }
      const open = HandTracker.openness(raw, aspect);
      if (best) {
        free.splice(free.indexOf(best), 1);
        best.open += (open - best.open) * 0.5;
      } else {
        best = {
          id: this.nextId++, open, fist: false,
          fx: new OneEuro(this.smoothCursor.minCutoff, this.smoothCursor.beta),
          fy: new OneEuro(this.smoothCursor.minCutoff, this.smoothCursor.beta),
          lmFilter: this.smoothLandmarks ? new PointSmoother(this.smoothLandmarks) : null,
        };
        this.hands.push(best);
      }
      const c = this.toCursor(palm);
      best.palm = palm;
      best.raw = raw;
      best.lm = best.lmFilter ? best.lmFilter.filter(raw, now) : raw;
      best.x = best.fx.filter(c.x, now);
      best.y = best.fy.filter(c.y, now);
      best.label = handedness[k]?.[0]?.categoryName;
      best.seen = now;
      if (best.fist ? best.open > this.fist.open : best.open < this.fist.close) best.fist = !best.fist;
    });
  }

  drawPreview(lms) {
    this.paint(lms, 'HandLandmarker', 'HAND_CONNECTIONS');
  }

}

/**
 * Body tracking. update(now) returns up to `numPoses` poses, each:
 *   lm     33 landmarks {x, y, z, visibility}, camera-normalised 0..1, NOT mirrored, smoothed
 *   world  33 landmarks in metres (hip-centred), unsmoothed
 *   seen   time (ms) last detected; a pose survives `lostMs` of dropout
 * Poses are kept in detection order (fine for one player).
 */
export class PoseTracker extends Tracker {
  constructor(video, {
    numPoses = 1,
    model = 'lite', // 'lite' (fast) | 'full' (more accurate)
    smooth = { minCutoff: 1.5, beta: 3.0 }, // false = raw
    lostMs = 400,
    confidence = 0.5,
    preview = null, // optional <canvas> over a video preview: draws the skeleton
    afterDraw = null, // (ctx, landmarksList, canvas) => {} extra drawing on the preview
  } = {}) {
    super(video, 'pose');
    this.taskName = 'PoseLandmarker';
    Object.assign(this, { numPoses, model, smooth, lostMs, confidence, preview, afterDraw });
    this.poses = [];
  }

  taskOptions() {
    const c = this.confidence;
    return {
      baseOptions: { modelAssetPath: this.model === 'full' ? MODELS.poseFull : MODELS.poseLite },
      numPoses: this.numPoses,
      minPoseDetectionConfidence: c,
      minPosePresenceConfidence: c,
      minTrackingConfidence: c,
    };
  }

  update(now) {
    const result = this.detect(now);
    if (result) {
      (result.landmarks || []).forEach((raw, i) => {
        const p = (this.poses[i] ||= { id: i + 1, filter: this.smooth ? new PointSmoother(this.smooth) : null });
        p.raw = raw;
        p.lm = p.filter ? p.filter.filter(raw, now) : raw;
        p.world = result.worldLandmarks?.[i];
        p.seen = now;
      });
      this.drawPreview(result.landmarks || []);
    }
    this.poses = this.poses.filter((p) => now - p.seen < this.lostMs);
    return this.poses;
  }

  reset() {
    this.poses = [];
    this.preview?.getContext('2d').clearRect(0, 0, this.preview.width, this.preview.height);
  }

  drawPreview(lms) {
    this.paint(lms, 'PoseLandmarker', 'POSE_CONNECTIONS');
  }

}

// ------------------------------------------------------- camera on a canvas

/**
 * Where the camera picture sits when it covers a W×H screen (like CSS
 * object-fit: cover), optionally zoomed in to crop the edges.
 * Returns { ox, oy, dw, dh } in screen px.
 */
export function coverFit(video, W, H, zoom = 1) {
  const vw = video.videoWidth || 640;
  const vh = video.videoHeight || 480;
  const s = Math.max(W / vw, H / vh) * zoom;
  const dw = vw * s;
  const dh = vh * s;
  return { ox: (W - dw) / 2, oy: (H - dh) / 2, dw, dh };
}

/** A camera landmark -> screen px for a picture drawn with coverFit and mirrored. */
export const toScreen = (p, fit) => ({ x: fit.ox + (1 - p.x) * fit.dw, y: fit.oy + p.y * fit.dh });
/** The inverse of toScreen: screen px -> camera landmark coordinates. */
export const toCamera = (p, fit) => ({ x: 1 - (p.x - fit.ox) / fit.dw, y: (p.y - fit.oy) / fit.dh });

/** Draws the mirrored camera picture at `fit` (from coverFit). Context must be in screen px. */
export function drawVideo(ctx, video, fit, alpha = 1) {
  if (video.readyState < 2) return false;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(fit.ox + fit.dw, fit.oy);
  ctx.scale(-1, 1);
  ctx.drawImage(video, 0, 0, fit.dw, fit.dh);
  ctx.restore();
  return true;
}
