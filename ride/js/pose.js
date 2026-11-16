// Body tracking (common/tracking.js PoseTracker) -> handlebar / steering-wheel steering.
// The shell (common/shell.js) opens the camera and loads the model; this turns
// the wrists into a steering value.
import { PoseTracker, POSE } from '../../common/tracking.js';

// Defaults; the games override these from their steering settings.
export const DEAD_ZONE_DEG = 4; // tilt smaller than this counts as straight
export const MAX_TILT_DEG = 30; // tilt at which steering is fully locked
const HANDS_GRACE_MS = 350; // keep "hands visible" through brief dropouts

export class PoseController {
  /** Same interface as a common tracker (load / update / reset / kind), so the shell can drive it. */
  constructor(video, preview = null) {
    this.kind = 'pose';
    this.video = video;
    this.tracker = new PoseTracker(video, {
      model: 'lite',
      smooth: false, // the game smooths the steering itself (Responsiveness setting)
      preview,
      afterDraw: (ctx, lms, cv) => this.drawWrists(ctx, lms[0], cv),
    });
    this.lastHandsSeen = -Infinity;
    this.steer = 0; // -1 (left) .. 1 (right)
    this.deadZone = DEAD_ZONE_DEG;
    this.maxTilt = MAX_TILT_DEG;
    this.tiltDeg = 0;
    this.handsUp = false; // both wrists above the nose
    this.status = 'none'; // 'none' | 'body' | 'hands'
  }

  load() {
    return this.tracker.load();
  }

  reset() {
    this.tracker.reset();
    this.status = 'none';
    this.handsUp = false;
    this.lastHandsSeen = -Infinity;
  }

  handsVisible(now = performance.now()) {
    return now - this.lastHandsSeen < HANDS_GRACE_MS;
  }

  update(now) {
    const poses = this.tracker.update(now);
    if (this.tracker.fresh) this.process(this.tracker.result.landmarks?.[0], now);
    else if (!poses.length) this.status = 'none'; // no frames (e.g. the phone stopped sending)
    return poses;
  }

  process(lm, now) {
    this.handsUp = false;
    if (!lm) {
      this.status = 'none';
      return;
    }
    const seen = (p) => p && (p.visibility ?? 1) > 0.5 && p.x > 0 && p.x < 1 && p.y > 0 && p.y < 1;
    const lw = lm[POSE.L_WRIST];
    const rw = lm[POSE.R_WRIST];
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
    const mag = Math.max(0, Math.abs(deg) - this.deadZone) / Math.max(1, this.maxTilt - this.deadZone);
    this.steer = Math.sign(deg) * Math.min(1, mag);

    const nose = lm[POSE.NOSE];
    this.handsUp = seen(nose) && lw.y < nose.y && rw.y < nose.y;
  }

  /** The yellow "handlebar" line between the wrists in the camera preview. */
  drawWrists(ctx, lm, cv) {
    if (!lm || this.status !== 'hands') return;
    const lw = lm[POSE.L_WRIST];
    const rw = lm[POSE.R_WRIST];
    ctx.strokeStyle = '#ffb703';
    ctx.lineWidth = 8;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(lw.x * cv.width, lw.y * cv.height);
    ctx.lineTo(rw.x * cv.width, rw.y * cv.height);
    ctx.stroke();
  }
}
