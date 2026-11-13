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
  hide: $('btn-hide'),
};

let code = '';
let facing = 'user'; // 'user' (selfie) | 'environment' (back)
let stream = null;
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
      stream = await getCamera();
      showPreview(stream);
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
    stream?.getTracks().forEach((t) => t.stop());
    stream = await getCamera();
    showPreview(stream);
    const track = stream.getVideoTracks()[0];
    const sender = call?.peerConnection?.getSenders().find((s) => s.track?.kind === 'video' || s.track === null);
    if (sender) await sender.replaceTrack(track);
  } catch (err) {
    console.error(err);
    facing = prev;
    setCard('Could not switch camera', err?.message || String(err));
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
