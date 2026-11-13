// Webcam + MediaPipe Pose Landmarker -> handlebar steering.
import {
  PoseLandmarker,
  FilesetResolver,
  DrawingUtils,
} from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs';

const WASM_PATH = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';

// Landmark indices (see MediaPipe pose landmark model).
const NOSE = 0;
const L_WRIST = 15;
const R_WRIST = 16;

const DEAD_ZONE_DEG = 4; // tilt smaller than this counts as straight
const MAX_TILT_DEG = 30; // tilt at which steering is fully locked
const HANDS_GRACE_MS = 350; // keep "hands visible" through brief dropouts

export class PoseController {
  constructor(video, canvas) {
    this.video = video;
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.draw = new DrawingUtils(this.ctx);
    this.landmarker = null;
    this.lastVideoTime = -1;
    this.lastHandsSeen = -Infinity;
    this.steer = 0; // -1 (left) .. 1 (right)
    this.tiltDeg = 0;
    this.handsUp = false; // both wrists above the nose
    this.status = 'none'; // 'none' | 'body' | 'hands'
  }

  /** Load the pose model (once). Safe to call repeatedly. */
  loadModel() {
    this.modelPromise ||= FilesetResolver.forVisionTasks(WASM_PATH).then((fileset) =>
      this.createLandmarker(fileset),
    );
    return this.modelPromise;
  }

  /** Use this computer's webcam. */
  async useWebcam(onStatus = () => {}) {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('This browser does not support camera access.');
    }
    onStatus('Asking for camera permission…');
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
    });
    await this.setStream(stream);
  }

  /** Use any MediaStream as the video source (e.g. a phone camera received over WebRTC). */
  async setStream(stream) {
    this.stopStream();
    this.video.srcObject = stream;
    this.lastVideoTime = -1;
    this.lastHandsSeen = -Infinity;
    this.status = 'none';
    try {
      await this.video.play();
    } catch (err) {
      console.warn('video.play() failed', err);
    }
  }

  stopStream() {
    const old = this.video.srcObject;
    if (old) old.getTracks().forEach((t) => t.stop());
    this.video.srcObject = null;
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  async init(onStatus = () => {}) {
    const model = this.loadModel();
    await this.useWebcam(onStatus);
    onStatus('Loading body tracking model…');
    await model;
  }

  async createLandmarker(fileset) {
    const options = (delegate) => ({
      baseOptions: { modelAssetPath: MODEL_URL, delegate },
      runningMode: 'VIDEO',
      numPoses: 1,
      minPoseDetectionConfidence: 0.5,
      minPosePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
    try {
      this.landmarker = await PoseLandmarker.createFromOptions(fileset, options('GPU'));
    } catch (err) {
      console.warn('GPU delegate unavailable, falling back to CPU', err);
      this.landmarker = await PoseLandmarker.createFromOptions(fileset, options('CPU'));
    }
  }

  handsVisible(now = performance.now()) {
    return now - this.lastHandsSeen < HANDS_GRACE_MS;
  }

  update(now) {
    const v = this.video;
    if (!this.landmarker || !v.srcObject || v.readyState < 2) return;
    // A remote (phone) track goes "muted" when frames stop arriving: don't keep
    // tracking the last frozen frame, so the game pauses instead.
    const track = v.srcObject.getVideoTracks?.()[0];
    if (track && (track.muted || track.readyState === 'ended')) {
      this.status = 'none';
      return;
    }
    if (v.currentTime === this.lastVideoTime) return;
    this.lastVideoTime = v.currentTime;

    if (this.canvas.width !== v.videoWidth && v.videoWidth) {
      this.canvas.width = v.videoWidth;
      this.canvas.height = v.videoHeight;
    }

    const result = this.landmarker.detectForVideo(v, now);
    const lm = result.landmarks?.[0];
    this.process(lm, now);
    this.render(lm);
  }

  process(lm, now) {
    this.handsUp = false;
    if (!lm) {
      this.status = 'none';
      return;
    }
    const seen = (p) => p && (p.visibility ?? 1) > 0.5 && p.x > 0 && p.x < 1 && p.y > 0 && p.y < 1;
    const lw = lm[L_WRIST];
    const rw = lm[R_WRIST];
    if (!seen(lw) || !seen(rw)) {
      this.status = 'body';
      return;
    }
    this.status = 'hands';
    this.lastHandsSeen = now;

    // Work in mirrored pixel space so "left" is the player's left as they see themselves.
    const W = this.video.videoWidth || 640;
    const H = this.video.videoHeight || 480;
    let a = { x: (1 - lw.x) * W, y: lw.y * H };
    let b = { x: (1 - rw.x) * W, y: rw.y * H };
    if (a.x > b.x) [a, b] = [b, a]; // a = left-most hand, b = right-most hand

    // Positive angle = right hand lower than left = turn right (like a steering wheel).
    const deg = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
    this.tiltDeg = deg;
    const mag = Math.max(0, Math.abs(deg) - DEAD_ZONE_DEG) / (MAX_TILT_DEG - DEAD_ZONE_DEG);
    this.steer = Math.sign(deg) * Math.min(1, mag);

    const nose = lm[NOSE];
    this.handsUp = seen(nose) && lw.y < nose.y && rw.y < nose.y;
  }

  render(lm) {
    const { ctx, canvas } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!lm) return;
    this.draw.drawConnectors(lm, PoseLandmarker.POSE_CONNECTIONS, {
      color: 'rgba(255,255,255,0.75)',
      lineWidth: 3,
    });
    this.draw.drawLandmarks(lm, { radius: 3, color: '#ff6b6b', lineWidth: 1 });

    if (this.status === 'hands') {
      const lw = lm[L_WRIST];
      const rw = lm[R_WRIST];
      ctx.strokeStyle = '#ffb703';
      ctx.lineWidth = 8;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(lw.x * canvas.width, lw.y * canvas.height);
      ctx.lineTo(rw.x * canvas.width, rw.y * canvas.height);
      ctx.stroke();
    }
  }
}
