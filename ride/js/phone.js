// Phone side: send this phone's camera to the Pose Rider page on a computer via WebRTC.
import { loadScript, PEERJS_URL, ID_PREFIX } from './phonelink.js';

const $ = (id) => document.getElementById(id);
const ui = {
  preview: $('preview'),
  status: $('status'),
  title: $('title'),
  message: $('message'),
  card: $('card'),
  form: $('code-form'),
  code: $('code'),
  retry: $('btn-retry'),
  flip: $('btn-flip'),
  rotate: $('btn-rotate'),
  hide: $('btn-hide'),
};

let code = '';
let facing = 'user'; // 'user' (selfie) | 'environment' (back)
let camStream = null; // what the camera gives
let stream = null;    // what we send: camStream, or a 180°-rotated copy of it
let upsideDown = false; // phone stands upside down (e.g. charging port at the top)
try { upsideDown = localStorage.getItem('phonecam.upsideDown') === '1'; } catch {}
let peer = null;
let call = null;
let wakeLock = null;
let connecting = false;

function setStatus(text, kind = '') {
  ui.status.textContent = text;
  ui.status.className = `pill ${kind}`;
}
function setCard(title, message) {
  ui.title.textContent = title;
  ui.message.textContent = message;
  ui.card.classList.remove('hidden');
}

function readCode() {
  const raw = decodeURIComponent(location.hash.replace(/^#/, '')).trim().toUpperCase();
  return /^[A-Z0-9]{4,12}$/.test(raw) ? raw : '';
}

async function getCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('This browser cannot use the camera. The page must be opened over https.');
  }
  const s = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      facingMode: facing,
      width: { ideal: 640 },
      height: { ideal: 480 },
      frameRate: { ideal: 30, max: 30 },
    },
  });
  const track = s.getVideoTracks()[0];
  if (track && 'contentHint' in track) track.contentHint = 'motion';
  return s;
}

// ---- upside-down mode: redraw each camera frame rotated by 180° on a canvas
// and send the canvas as the video track.
const rot = { video: null, canvas: null, handle: 0, out: null };

function stopRotation() {
  if (rot.video?.cancelVideoFrameCallback && rot.handle) rot.video.cancelVideoFrameCallback(rot.handle);
  cancelAnimationFrame(rot.handle);
  rot.handle = 0;
  rot.out?.getTracks().forEach((t) => t.stop());
  rot.out = null;
}

function rotatedCopy(src) {
  if (!rot.video) {
    rot.video = Object.assign(document.createElement('video'), { muted: true, playsInline: true, autoplay: true });
    rot.video.setAttribute('playsinline', '');
    rot.video.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;';
    document.body.appendChild(rot.video);
    rot.canvas = document.createElement('canvas');
  }
  const v = rot.video, cv = rot.canvas, cx = cv.getContext('2d');
  v.srcObject = src;
  v.play().catch(() => {});
  const set = src.getVideoTracks()[0]?.getSettings() || {};
  cv.width = set.width || 640;
  cv.height = set.height || 480;
  const useVfc = 'requestVideoFrameCallback' in v;
  const draw = () => {
    if (v.videoWidth && (cv.width !== v.videoWidth || cv.height !== v.videoHeight)) {
      cv.width = v.videoWidth; // the phone turned between portrait and landscape
      cv.height = v.videoHeight;
    }
    if (v.readyState >= 2) {
      cx.setTransform(-1, 0, 0, -1, cv.width, cv.height); // rotate 180°
      cx.drawImage(v, 0, 0, cv.width, cv.height);
    }
    rot.handle = useVfc ? v.requestVideoFrameCallback(draw) : requestAnimationFrame(draw);
  };
  draw();
  rot.out = cv.captureStream(30);
  const track = rot.out.getVideoTracks()[0];
  if (track && 'contentHint' in track) track.contentHint = 'motion';
  return rot.out;
}

/** Rebuilds the outgoing stream from camStream and swaps it into a live call. */
async function updateOutput() {
  stopRotation();
  stream = upsideDown ? rotatedCopy(camStream) : camStream;
  showPreview(stream);
  ui.rotate.textContent = upsideDown ? 'Upside down: on' : 'Upside down: off';
  ui.rotate.classList.toggle('on', upsideDown);
  const sender = call?.peerConnection?.getSenders().find((s) => s.track?.kind === 'video' || s.track === null);
  if (sender) await sender.replaceTrack(stream.getVideoTracks()[0]);
}

function showPreview(s) {
  ui.preview.srcObject = s;
  ui.preview.classList.toggle('mirror', facing === 'user');
  ui.preview.play().catch(() => {});
}

async function keepAwake() {
  try {
    if ('wakeLock' in navigator && document.visibilityState === 'visible' && !wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => (wakeLock = null));
    }
  } catch {
    /* not supported or refused: the screen may sleep, nothing else breaks */
  }
}
document.addEventListener('visibilitychange', keepAwake);

function newPeer() {
  return new Promise((resolve, reject) => {
    const p = new window.Peer({ debug: 1 });
    p.once('open', () => resolve(p));
    p.once('error', reject);
  });
}

async function connect() {
  if (connecting) return;
  connecting = true;
  ui.retry.classList.add('hidden');
  ui.form.classList.add('hidden');
  try {
    if (!stream) {
      setStatus('Camera…');
      setCard('Phone camera', 'Allow camera access to use this phone as the game camera.');
      camStream = await getCamera();
      await updateOutput();
      ui.rotate.classList.remove('hidden');
    }
    keepAwake();

    setStatus('Connecting…');
    setCard('Connecting…', `Looking for your computer (code ${code}).`);
    await loadScript(PEERJS_URL);
    if (!peer || peer.destroyed) {
      peer = await newPeer();
      peer.on('error', onPeerError);
    } else if (peer.disconnected) {
      peer.reconnect();
    }

    call?.close();
    const c = (call = peer.call(ID_PREFIX + code, stream));
    if (!c) throw new Error('Could not start the call.');
    watchCall(c);
  } catch (err) {
    console.error(err);
    let msg = err?.message || String(err);
    if (err?.name === 'NotAllowedError') msg = 'Camera permission was denied. Allow camera access for this site in your browser settings.';
    lost('Something went wrong', msg);
  } finally {
    connecting = false;
  }
}

// PeerJS reports an unknown code as a peer error, not on the call.
function onPeerError(err) {
  if (err?.type === 'peer-unavailable') {
    lost('Code not found', `No computer is waiting with code ${code}. Check the code on the game screen and try again.`, true);
  } else {
    console.warn('PeerJS error', err);
  }
}

function watchCall(c) {
  const pc = c.peerConnection;
  const onState = () => {
    if (call !== c) return;
    const s = pc.iceConnectionState;
    if (s === 'connected' || s === 'completed') connected();
    else if (s === 'failed') {
      lost(
        'Could not connect',
        'The phone and computer could not reach each other. Make sure both are on the same Wi-Fi network (guest networks often block this) and try again.',
      );
    } else if (s === 'disconnected') setStatus('Reconnecting…', 'bad');
  };
  pc?.addEventListener('iceconnectionstatechange', onState);
  c.on('close', () => {
    if (call === c) lost('Disconnected', 'The computer closed the connection. Open the phone link again from the game, or tap Reconnect.');
  });
}

function connected() {
  setStatus('Live', 'ok');
  setCard(
    'Connected!',
    'Prop this phone up 1.5–2 m away so it sees you from head to waist with your hands in view. Then play on your computer. Keep this page open.',
  );
  ui.flip.classList.remove('hidden');
  ui.hide.classList.remove('hidden');
}

function lost(title, message, askCode = false) {
  setStatus('Offline', 'bad');
  setCard(title, message);
  ui.retry.classList.remove('hidden');
  if (askCode) showCodeForm();
}

function showCodeForm() {
  ui.form.classList.remove('hidden');
  ui.code.value = code;
}

ui.form.addEventListener('submit', (e) => {
  e.preventDefault();
  const v = ui.code.value.trim().toUpperCase();
  if (!/^[A-Z0-9]{4,12}$/.test(v)) {
    ui.code.focus();
    return;
  }
  code = v;
  history.replaceState(null, '', `#${code}`);
  connect();
});

ui.retry.addEventListener('click', () => {
  if (!code) showCodeForm();
  else connect();
});

ui.flip.addEventListener('click', async () => {
  const prev = facing;
  facing = facing === 'user' ? 'environment' : 'user';
  try {
    camStream?.getTracks().forEach((t) => t.stop());
    camStream = await getCamera();
    await updateOutput();
  } catch (err) {
    console.error(err);
    facing = prev;
    setCard('Could not switch camera', err?.message || String(err));
  }
});

ui.rotate.addEventListener('click', async () => {
  upsideDown = !upsideDown;
  try { localStorage.setItem('phonecam.upsideDown', upsideDown ? '1' : '0'); } catch {}
  try {
    if (camStream) await updateOutput();
    else ui.rotate.textContent = upsideDown ? 'Upside down: on' : 'Upside down: off';
  } catch (err) {
    console.error(err);
    setCard('Could not rotate', err?.message || String(err));
  }
});

ui.hide.addEventListener('click', () => ui.card.classList.add('hidden'));
ui.preview.addEventListener('click', () => ui.card.classList.remove('hidden'));

window.addEventListener('hashchange', () => {
  const c = readCode();
  if (c && c !== code) {
    code = c;
    connect();
  }
});

code = readCode();
if (code) {
  connect();
} else {
  setStatus('Not paired');
  setCard('Phone camera', 'On your computer, open Pose Rider and choose "Use phone as camera". Then scan the QR code, or type the code here.');
  showCodeForm();
}
